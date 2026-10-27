// The region hub's filters, sort and pages — as a query string, and back.
//
// 🔴 NO JAVASCRIPT ON THE READER'S SIDE. Every chip, every sort option and
// every page is a plain `<a href>` built here, and the state it carries
// lives in the URL. The card's criterion for the hub is an unaided crawl
// (see `Pagination` in region-listing.tsx); a filter on a click handler
// would be invisible to it and to anyone with scripts off.
//
// 🔴 SAME VOCABULARY AS THE MAP AND THE API — `types=`, `amenities=`,
// `unknown=1` — so one filter is one contract (CAMP-35, `map-filter.ts`,
// apps/api/src/spots/filters.ts). `sort=` and `page=` are the hub's own.
//
// 🔴 ONE ADDRESS PER STATE. Values are written in their declared order,
// not the order a link happened to list them, so {free, wild} and
// {wild, free} are the same URL; no state at all is the region's static
// address and page N of it is `/page/N` — the addresses the build makes.
// Everything else goes to `/filter?…`, the one route that reads
// `searchParams` (and is therefore rendered on request, not at build).

import {
  AMENITY_KEYS,
  AMENITY_LABEL,
  AMENITY_LABEL_SHORT,
  SPOT_TYPE_LABEL,
  SPOT_TYPE_LABEL_SHORT,
  SPOT_TYPES,
  type AmenityKey,
  type SpotType,
} from './api';

/** The orders our data can honestly produce. Mirrors the API's REGION_SORTS. */
export const REGION_SORTS = ['name', 'facilities', 'type'] as const;
export type RegionSort = (typeof REGION_SORTS)[number];

export const SORT_LABEL: Record<RegionSort, string> = {
  name: 'Name',
  facilities: 'Most recorded facilities',
  type: 'Type',
};

export interface HubQuery {
  /** Empty means every type, not no types. */
  types: SpotType[];
  /** Every one of these must be a recorded yes — unless `includeUnknown`. */
  amenities: AmenityKey[];
  /** The reader has seen how many are unrecorded and asked for them too. */
  includeUnknown: boolean;
  sort: RegionSort;
  page: number;
}

export const EMPTY_HUB_QUERY: HubQuery = {
  types: [],
  amenities: [],
  includeUnknown: false,
  sort: 'name',
  page: 1,
};

/** What Next hands a page as `searchParams`, once awaited. */
export type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Values the codebase knows, in the order it declares them. Anything else
 * is dropped, not rejected: a stale link should still open the hub, and
 * an unknown value echoed back in a message is reflected content.
 */
function pick<T extends string>(
  raw: string | undefined,
  known: readonly T[],
): T[] {
  if (!raw) return [];
  const asked = new Set(raw.split(',').map((s) => s.trim()));
  return known.filter((k) => asked.has(k));
}

export function parseHubQuery(searchParams: SearchParams): HubQuery {
  const sort = first(searchParams.sort);
  const page = Number(first(searchParams.page));
  return {
    types: pick(first(searchParams.types), SPOT_TYPES),
    amenities: pick(first(searchParams.amenities), AMENITY_KEYS),
    includeUnknown: first(searchParams.unknown) === '1',
    sort: (REGION_SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as RegionSort)
      : 'name',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function isFiltering(q: HubQuery): boolean {
  return q.types.length > 0 || q.amenities.length > 0;
}

/** Filters or a non-default sort — anything the static page cannot show. */
export function hasState(q: HubQuery): boolean {
  return isFiltering(q) || q.sort !== 'name';
}

/** The parameters, filters first, in a fixed order. Empty for no state. */
function params(q: HubQuery, withPage: boolean): URLSearchParams {
  const p = new URLSearchParams();
  if (q.types.length) p.set('types', q.types.join(','));
  if (q.amenities.length) p.set('amenities', q.amenities.join(','));
  if (q.includeUnknown && q.amenities.length) p.set('unknown', '1');
  if (q.sort !== 'name') p.set('sort', q.sort);
  if (withPage && q.page > 1) p.set('page', String(q.page));
  return p;
}

/**
 * The one address for a state. `base` is the region's static path.
 */
export function hubHref(base: string, q: HubQuery): string {
  if (!hasState(q)) return q.page > 1 ? `${base}/page/${q.page}` : base;
  return `${base}/filter?${params(q, true).toString()}`;
}

/**
 * What the API is asked, after `?page=N`. Same names, same values — the
 * API's `parseRegionQuery` reads exactly this.
 */
export function apiSearch(q: HubQuery): string {
  const p = params(q, false).toString();
  return p ? `&${p}` : '';
}

/** Toggling resets to page 1: page 3 of the old set is nowhere in the new. */
export function withType(q: HubQuery, t: SpotType): HubQuery {
  const on = q.types.includes(t);
  return {
    ...q,
    page: 1,
    types: SPOT_TYPES.filter((x) => (x === t ? !on : q.types.includes(x))),
  };
}

export function withAmenity(q: HubQuery, k: AmenityKey): HubQuery {
  const on = q.amenities.includes(k);
  return {
    ...q,
    page: 1,
    amenities: AMENITY_KEYS.filter((x) =>
      x === k ? !on : q.amenities.includes(x),
    ),
  };
}

export function withSort(q: HubQuery, sort: RegionSort): HubQuery {
  return { ...q, page: 1, sort };
}

export function withUnknown(q: HubQuery, includeUnknown: boolean): HubQuery {
  return { ...q, page: 1, includeUnknown };
}

export function withPage(q: HubQuery, page: number): HubQuery {
  return { ...q, page };
}

export type FilterKind = 'type' | 'amenity';

/** The chip's wording for a filter — what "Remove …" names. */
export function filterLabel(kind: FilterKind, key: string): string {
  return kind === 'type'
    ? SPOT_TYPE_LABEL_SHORT[key as SpotType]
    : AMENITY_LABEL_SHORT[key as AmenityKey];
}

export function without(q: HubQuery, kind: FilterKind, key: string): HubQuery {
  return kind === 'type'
    ? withType(q, key as SpotType)
    : withAmenity(q, key as AmenityKey);
}

// ── sentences ────────────────────────────────────────────────────────────

const lower = (s: string) => (s === 'Wi-Fi' ? s : s[0].toLowerCase() + s.slice(1));

const list = (parts: string[], joiner: 'and' | 'or') =>
  parts.length <= 1
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} ${joiner} ${parts[parts.length - 1]}`;

/** "Free campsites with electricity and showers" — for a `<title>`. */
export function describeQuery(q: HubQuery): string {
  const types = q.types.length
    ? list(
        q.types.map((t) => `${SPOT_TYPE_LABEL[t]}s`),
        'or',
      )
    : 'Campsites';
  const amenities = q.amenities.length
    ? ` with ${list(
        q.amenities.map((k) => lower(AMENITY_LABEL[k])),
        'and',
      )}`
    : '';
  return `${types}${amenities}`;
}

/**
 * The empty state's headline: a true sentence about our records, never
 * a claim about the place. "is recorded with" rather than "has", because
 * an unrecorded shower is not a missing one (CAMP-35).
 */
export function emptyHeadline(q: HubQuery, region: string): string {
  const types = q.types.length
    ? `No ${list(
        q.types.map((t) => lower(SPOT_TYPE_LABEL[t])),
        'or',
      )}`
    : 'No campsite';
  if (!q.amenities.length) return `${types} is listed in ${region}`;
  return `${types} in ${region} is recorded with ${list(
    q.amenities.map((k) => lower(AMENITY_LABEL[k])),
    'and',
  )}`;
}

/** The amenities as a reader reads them: "showers and laundry". */
export function amenityList(q: HubQuery): string {
  return list(
    q.amenities.map((k) => lower(AMENITY_LABEL[k])),
    'and',
  );
}
