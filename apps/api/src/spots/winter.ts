import { NEARBY_RADIUS_M, FILTER } from './camp-services';
import { notSecondarySql } from './links';
import { publishedCountrySql } from './unpublished-countries';
import { styleKnownSql, styleYesSql } from '../osm/travel-styles';

// CAMP-525: /camping/winter — which campsites are RECORDED as open in
// winter, country by country, and what the winter-confirmed ones have
// around them for the three things winter camping runs out of: drinking
// water, a waste-water dump and a gas-bottle swap.
//
// 🔴 ONE RULE, ONE DENOMINATOR, SHARED WITH THE CHIP (CAMP-520).
// `yes` is `styleYesSql('winter')` and `known` is `styleKnownSql('winter')` —
// the same two functions the region hub counts its chip with, over the same
// rows (`REGION_WHERE` of region-listing.ts: published, in a region, not
// dropped by OSM, not a secondary copy). A country's figure here is the SUM
// of its regions' chip figures, and the DB spec asserts exactly that sum.
//
// 🔴 A CAMPSITE THAT NO SOURCE SAID WAS OPEN IN WINTER IS NOT IN THIS
// PAYLOAD AS A CAMPSITE. The API sends counts and, for the regions worth a
// link, a region's name and slug — never a row of a campsite whose winter
// value is not a sourced yes. The card's check: «показує лише тих, хто це
// підтвердив».
//
// 🔴 THE SERVICE FIGURES ANSWER ONE QUESTION, AND THE DENOMINATOR IS IN THE
// SENTENCE. «Of the N winter-confirmed campsites of this country, W have
// a drinking-water point within 10 km.» Straight-line distance from the
// campsite's marked point, the same radius and the same per-kind row filter
// as the campsite page's services block (camp-services.ts), so the two
// pages cannot disagree about what «nearby» means. NOTHING here says the
// tap runs in winter: OpenStreetMap does not record whether a tap is
// switched off for the cold, and the page says so in its own words (CMS).

/** `kind` of the services block → the key this page uses. */
export const WINTER_SERVICES = [
  { key: 'water', kind: 'water' },
  { key: 'dump', kind: 'dump' },
  { key: 'gas', kind: 'gas' },
] as const;
export type WinterServiceKey = (typeof WINTER_SERVICES)[number]['key'];

/** Regions per country that carry a link to the filtered hub. */
export const WINTER_TOP_REGIONS = 5;

export interface WinterRegion {
  region: string;
  slug: string;
  /** Campsites of the region (the chip's total). */
  spots: number;
  /** Campsites with a sourced yes OR no. */
  known: number;
  /** Campsites with a sourced yes: at least 1 for every region listed. */
  yes: number;
}

export interface WinterCountry {
  /** Lower-case ISO 3166-1 alpha-2, as in the URL. */
  country: string;
  spots: number;
  known: number;
  yes: number;
  /** Regions with at least one sourced yes, most first. */
  regions: WinterRegion[];
  /** Of the `yes` campsites: those with a point of the kind inside the radius. */
  withinRadius: Record<WinterServiceKey, number>;
}

export interface WinterPayload {
  radiusM: number;
  /** `YYYY-MM-DD`: the last import that saw any of the counted campsites. */
  readAt: string | null;
  /** Every published country, including those with no `yes` at all. */
  countries: WinterCountry[];
}

/** The rows the region chip counts, one row per region. */
export const WINTER_REGIONS_SQL = `
  SELECT lower(s.country) AS country,
         s.region,
         count(*)::int AS spots,
         count(*) FILTER (WHERE ${styleKnownSql('winter')})::int AS known,
         count(*) FILTER (WHERE ${styleYesSql('winter')})::int AS yes,
         to_char(max(s.last_seen_at), 'YYYY-MM-DD') AS read_at
    FROM camping_spots s
   WHERE s.region IS NOT NULL
     AND ${publishedCountrySql('s')}
     AND s.missing_since IS NULL
     AND ${notSecondarySql('s')}
   GROUP BY lower(s.country), s.region`;

/**
 * Per country: the winter-confirmed campsites, and how many have each kind
 * of point within the radius.
 *
 * 🔴 THE KIND IS A LITERAL IN THE TEXT (camp-services.ts FILTER): a partial
 * index is usable only when the planner can prove the query implies its
 * predicate against a constant. The box (`&&` on an expanded point) is what
 * lets the GiST index bound the walk; the geography distance decides.
 */
export function winterServicesSql(radiusM: number = NEARBY_RADIUS_M): string {
  if (!Number.isInteger(radiusM) || radiusM <= 0) {
    throw new Error(`winter radius must be a positive integer, got ${radiusM}`);
  }
  const deg = `(${radiusM} / (111320.0 * greatest(cos(radians(ST_Y(y.location))), 0.05)))`;
  const has = (kind: (typeof WINTER_SERVICES)[number]['kind']) => `EXISTS (
           SELECT 1 FROM osm_route_poi p
            WHERE ${FILTER[kind]}
              AND p.location && ST_Expand(y.location, ${deg})
              AND ST_DWithin(y.location::geography, p.location::geography, ${radiusM}))`;
  const cols = WINTER_SERVICES.map(
    (s) => `count(*) FILTER (WHERE ${has(s.kind)})::int AS "${s.key}"`,
  );
  return `
  WITH y AS (
    SELECT lower(s.country) AS country, s.location
      FROM camping_spots s
     WHERE s.region IS NOT NULL
       AND ${publishedCountrySql('s')}
       AND s.missing_since IS NULL
       AND ${notSecondarySql('s')}
       AND ${styleYesSql('winter')}
  )
  SELECT y.country,
         ${cols.join(',\n         ')}
    FROM y
   GROUP BY y.country`;
}

type RegionRow = {
  country: string;
  region: string;
  spots: number;
  known: number;
  yes: number;
  read_at: string | null;
};
type ServiceRow = { country: string } & Record<WinterServiceKey, number>;

export async function countWinter(
  query: (sql: string) => Promise<unknown[]>,
  slugify: (region: string) => string,
  radiusM: number = NEARBY_RADIUS_M,
): Promise<WinterPayload> {
  const regionRows = (await query(WINTER_REGIONS_SQL)) as RegionRow[];
  const serviceRows = (await query(winterServicesSql(radiusM))) as ServiceRow[];
  const services = new Map(serviceRows.map((r) => [r.country, r]));

  const byCountry = new Map<string, WinterCountry>();
  let readAt: string | null = null;
  for (const r of regionRows) {
    let c = byCountry.get(r.country);
    if (!c) {
      const s = services.get(r.country);
      c = {
        country: r.country,
        spots: 0,
        known: 0,
        yes: 0,
        regions: [],
        withinRadius: {
          water: s?.water ?? 0,
          dump: s?.dump ?? 0,
          gas: s?.gas ?? 0,
        },
      };
      byCountry.set(r.country, c);
    }
    c.spots += r.spots;
    c.known += r.known;
    c.yes += r.yes;
    if (r.yes > 0) {
      c.regions.push({
        region: r.region,
        slug: slugify(r.region),
        spots: r.spots,
        known: r.known,
        yes: r.yes,
      });
    }
    if (r.read_at && (readAt === null || r.read_at > readAt))
      readAt = r.read_at;
  }
  const countries = [...byCountry.values()].sort((a, b) =>
    a.country.localeCompare(b.country),
  );
  for (const c of countries) {
    c.regions.sort((a, b) => b.yes - a.yes || a.region.localeCompare(b.region));
    c.regions = c.regions.slice(0, WINTER_TOP_REGIONS);
  }
  return { radiusM, readAt, countries };
}
