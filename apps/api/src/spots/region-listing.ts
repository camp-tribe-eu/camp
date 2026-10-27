// The region hub, filtered: what /spots/:country/:region answers when the
// page carries `types=`, `amenities=`, `unknown=`, `sort=` and `page=`.
//
// 🔴 The SAME vocabulary as the map (`filters.ts`, CAMP-35) and the same
// rule about an unrecorded amenity: it is unknown, not a no. A region
// hub that filtered on `shower = 'yes'` alone would silently claim that
// most of a region has no shower — the map refused exactly that, and so
// does this. The strict count is what the page shows as "N sites match";
// the lenient count minus the strict one is "M more where nobody
// recorded it", and `unknown=1` is the reader's decision to include them.
//
// 🔴 EVERY NUMBER HERE IS A COUNT THE DATABASE MADE, in one statement,
// over the same WHERE the items come from. The page prints them; it
// never derives one from the length of the list it was handed — a page
// holds 24 of the 314 that match, and 24 is not the answer to "how many".
//
// Pure where it can be: parsing, sorting vocabulary and the SQL assembly
// take no database, so `region-listing.spec.ts` drives them dry;
// `region-listing.db.spec.ts` runs the whole thing against real rows.

import { AMENITY_KEYS, type AmenityKey } from '../osm/tag-mapping';
import {
  filterSql,
  type MapFilters,
  NO_FILTERS,
  parseFilters,
  SPOT_TYPES,
  type SpotType,
} from './filters';
import { mergedNameSql, notSecondarySql } from './links';
import type { SpotCard } from './spots.service';

/**
 * How a hub list can be ordered. Only orders our data can honestly
 * produce: no "nearest to me" (no reader location on a static page), no
 * price (we hold tariffs for a fraction of sites), no altitude (not
 * recorded).
 *
 *   name        named sites first, A–Z — the order the hub always had;
 *   facilities  the sites we know most about first, which is the same
 *               rule the home page's "Notable" block uses (CAMP-41);
 *   type        grouped by type in the card's order, then by name.
 */
export const REGION_SORTS = ['name', 'facilities', 'type'] as const;
export type RegionSort = (typeof REGION_SORTS)[number];

/**
 * The order `sort=type` groups in — the card's reading order, the same
 * one apps/web/src/lib/api.ts `SPOT_TYPES` lists the chips in. NOT
 * `filters.SPOT_TYPES`, which mirrors the enum's declaration order and
 * puts wild camping third.
 */
export const TYPE_ORDER: readonly SpotType[] = [
  'free',
  'paid',
  'camper_stop',
  'rv_park',
  'wild',
];

export function parseRegionSort(raw: unknown): RegionSort {
  return typeof raw === 'string' &&
    (REGION_SORTS as readonly string[]).includes(raw)
    ? (raw as RegionSort)
    : 'name';
}

export function parsePage(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export interface RegionQuery {
  page: number;
  filters: MapFilters;
  sort: RegionSort;
}

/**
 * Everything the hub route reads off its query string.
 *
 * 🔴 `overnight` is NOT offered here and is forced off whatever the query
 * says. The hub has no counter beside it to say how many are unknown,
 * and CAMP-255 forbids an "allowed" list without that honesty.
 */
export function parseRegionQuery(query: Record<string, unknown>): RegionQuery {
  const f = parseFilters(query);
  return {
    page: parsePage(query.page),
    filters: { ...f, overnight: false },
    sort: parseRegionSort(query.sort),
  };
}

export interface RegionFacets {
  /**
   * For each type: how many sites of that type pass the amenity filters.
   * The number a reader would see after choosing that type alone.
   */
  types: Record<SpotType, number>;
  /**
   * For each amenity: how many would match with it added to the current
   * filters. For one already chosen, this equals `matched`.
   */
  amenities: Record<AmenityKey, number>;
}

export interface DropOne {
  kind: 'type' | 'amenity';
  key: SpotType | AmenityKey;
  /** How many match with only this filter removed. */
  matched: number;
}

export interface RegionListing {
  region: string | null;
  /** Every live site in the region, filters ignored. */
  total: number;
  /** Sites that pass the filters — the "N sites match" number. */
  matched: number;
  /**
   * Sites that failed only for want of data: no requested amenity is a
   * recorded no, at least one is unrecorded. 0 when the reader has
   * already asked to include them (they are then in `matched`).
   */
  unknownExcluded: number;
  items: SpotCard[];
  facets: RegionFacets;
  /**
   * One entry per active filter: what dropping just that one gives back.
   * Empty when nothing is filtered. This is what lets an empty result say
   * `Remove "Laundry" and 64 sites come back` instead of "no results".
   */
  dropOne: DropOne[];
  sort: RegionSort;
}

export function isFiltering(f: MapFilters): boolean {
  return f.types.length > 0 || f.amenities.length > 0;
}

/** `WHERE` for the region itself; `$1` country, `$2` region name. */
const REGION_WHERE = `lower(country) = lower($1) AND region = $2
          AND missing_since IS NULL
          AND ${notSecondarySql('s')}`;

/**
 * A filter as a boolean expression, parameters numbered from `next + 1`.
 * `filterSql` hands back ` AND a AND b` for a WHERE clause; a `FILTER
 * (WHERE …)` wants the bare expression, and no filter at all is TRUE.
 */
function cond(
  f: MapFilters,
  next: number,
): { expr: string; params: unknown[] } {
  const built = filterSql(f, next);
  return {
    expr: built.where ? built.where.replace(/^ AND /, '') : 'TRUE',
    params: built.params,
  };
}

/** The recorded-facility count: how many amenities are a definite yes. */
function recordedSql(alias: string): string {
  // Keys come from AMENITY_KEYS, a constant in this codebase, never from
  // the request — which is why they may be spliced in as text.
  return (
    '(' +
    AMENITY_KEYS.map(
      (k) => `(${alias}.amenities ->> '${k}' IS NOT DISTINCT FROM 'yes')::int`,
    ).join(' + ') +
    ')'
  );
}

/**
 * The ORDER BY for a sort, and the parameters it needs (`type` sorts by
 * TYPE_ORDER, passed as an array so the order lives in one constant
 * rather than in a CASE copied from it).
 */
export function orderBySql(
  sort: RegionSort,
  alias: string,
  next: number,
): { orderBy: string; params: unknown[] } {
  const name = mergedNameSql(alias);
  const byName = `(${name} IS NULL), ${name}, ${alias}.slug`;
  switch (sort) {
    case 'facilities':
      return { orderBy: `${recordedSql(alias)} DESC, ${byName}`, params: [] };
    case 'type':
      return {
        orderBy: `array_position($${next + 1}::text[], ${alias}.type::text), ${byName}`,
        params: [[...TYPE_ORDER]],
      };
    default:
      return { orderBy: byName, params: [] };
  }
}

/**
 * The one counting statement: total, matched, lenient, every facet and
 * every drop-one, as `count(*) FILTER (WHERE …)` columns over the region.
 *
 * Exported so the dry spec can read the SQL it builds; `listRegion`
 * below is the only runtime caller.
 */
export function countsSql(filters: MapFilters): {
  sql: string;
  params: unknown[];
  /** Column name → what it is, in the order the SELECT lists them. */
  columns: string[];
} {
  const cols: string[] = ['count(*)::int AS total'];
  const names: string[] = ['total'];
  const params: unknown[] = [];
  // $1 and $2 are the region.
  let n = 2;

  const add = (name: string, f: MapFilters) => {
    const c = cond(f, n);
    n += c.params.length;
    params.push(...c.params);
    cols.push(`count(*) FILTER (WHERE ${c.expr})::int AS "${name}"`);
    names.push(name);
  };

  add('matched', filters);
  add('lenient', { ...filters, includeUnknown: true });

  for (const t of SPOT_TYPES) {
    add(`t:${t}`, { ...filters, types: [t] });
  }
  for (const k of AMENITY_KEYS) {
    const amenities = filters.amenities.includes(k)
      ? filters.amenities
      : [...filters.amenities, k];
    add(`a:${k}`, { ...filters, amenities });
  }
  for (const t of filters.types) {
    add(`drop:t:${t}`, {
      ...filters,
      types: filters.types.filter((x) => x !== t),
    });
  }
  for (const k of filters.amenities) {
    add(`drop:a:${k}`, {
      ...filters,
      amenities: filters.amenities.filter((x) => x !== k),
    });
  }

  return {
    sql: `SELECT ${cols.join(',\n              ')}
         FROM camping_spots s
        WHERE ${REGION_WHERE}`,
    params,
    columns: names,
  };
}

/** The `query` half of a DataSource — all this module needs. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
}

/**
 * Campsites of one region, a page at a time, filtered and sorted.
 *
 * `region` is the resolved display name — the service resolves the slug,
 * because that is where the one slug function lives (see `regionSpots`).
 */
export async function listRegion(
  db: Queryable,
  country: string,
  region: string,
  q: RegionQuery,
  perPage = 24,
): Promise<RegionListing> {
  const { filters, sort, page } = q;

  const counts = countsSql(filters);
  const [row] = (await db.query(counts.sql, [
    country,
    region,
    ...counts.params,
  ])) as Record<string, number>[];

  const num = (name: string) => Number(row?.[name] ?? 0);

  const types = {} as Record<SpotType, number>;
  for (const t of SPOT_TYPES) types[t] = num(`t:${t}`);
  const amenities = {} as Record<AmenityKey, number>;
  for (const k of AMENITY_KEYS) amenities[k] = num(`a:${k}`);

  const dropOne: DropOne[] = [
    ...filters.types.map((t): DropOne => ({
      kind: 'type',
      key: t,
      matched: num(`drop:t:${t}`),
    })),
    ...filters.amenities.map((k): DropOne => ({
      kind: 'amenity',
      key: k,
      matched: num(`drop:a:${k}`),
    })),
  ];

  const matched = num('matched');
  // Never negative: lenient is a superset of strict by construction, but
  // a reader who already included the unknown is not "excluding" them.
  const unknownExcluded = filters.includeUnknown
    ? 0
    : Math.max(0, num('lenient') - matched);

  const where = cond(filters, 2);
  const order = orderBySql(sort, 's', 2 + where.params.length);
  const limitAt = 2 + where.params.length + order.params.length;
  const items = (await db.query(
    `SELECT s.slug, ${mergedNameSql('s')} AS name,
            s.country, s.region, s.type, s.amenities
       FROM camping_spots s
      WHERE ${REGION_WHERE}
        AND ${where.expr}
      ORDER BY ${order.orderBy}
      LIMIT $${limitAt + 1} OFFSET $${limitAt + 2}`,
    [
      country,
      region,
      ...where.params,
      ...order.params,
      perPage,
      (page - 1) * perPage,
    ],
  )) as SpotCard[];

  return {
    region,
    total: num('total'),
    matched,
    unknownExcluded,
    items,
    facets: { types, amenities },
    dropOne,
    sort,
  };
}

export { NO_FILTERS };
