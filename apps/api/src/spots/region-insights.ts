import { notSecondarySql } from './links';

// CAMP — "Camping in <region>": what a region page may say about its
// campsites, counted from OUR rows. The survey this card stands on is
// docs/region-insight-survey.md (27.10.2026); the limits below are its.
//
// 🔴 ONLY FIELDS THAT ARE FILLED, AND ONLY WITH THE DENOMINATOR THEY
// HAVE. Elevation, terrain and laundry are each recorded on ~2 % of rows
// and are not counted here at all; nothing can be said about a region
// from three measured heights. An amenity is counted as `yes` and `no`
// SEPARATELY, never as "the rest": `unknown` is "nobody wrote the tag"
// (osm/import-spots.ts), and the page derives the denominator from
// yes + no, so a site nobody tagged is in neither figure. Sea, lake,
// river and reservoir are the NEAREST water of every site — a map
// property, not a campsite one — so water is reported only by NAME, with
// its distance.
//
// 🔴 "WITHIN 2 KM" KEEPS EVERY COMPUTED ROW IN ITS DENOMINATOR. A
// nearest station 1 888 km away is an artefact of the per-country extract
// (576 rows), and for a sentence "the nearest station is N km away" it
// would be garbage — but for "within 2 km" it is a correct NO, and the
// rows it would remove are exactly the ones with no station nearby.
// Review of the first version measured the cut on fi/Lapland: 173 rows
// computed, 63 printed, the share flattered in 15 regions. So the station
// denominator is the same as the supermarket's: rows with the distance
// computed at all.
//
// 🔴 RAW COUNTS, NOT SENTENCES. The one place that decides whether a
// figure is large enough to print (five known values, the survey's
// threshold) is apps/web/src/lib/region-insights.ts — one lock, one test,
// one mutation that turns it red. This file counts and names the day.

export const INSIGHT_AMENITIES = ['electricity', 'toilets', 'shower'] as const;
export type InsightAmenity = (typeof INSIGHT_AMENITIES)[number];

export const SPOT_TYPES = [
  'paid',
  'rv_park',
  'camper_stop',
  'free',
  'wild',
] as const;
export type InsightSpotType = (typeof SPOT_TYPES)[number];

/** Metres: "within walking distance" for a supermarket or a railway stop. */
export const NEARBY_M = 2000;

export interface RegionInsights {
  region: string;
  /** Every published campsite of the region: the one denominator `type` may use. */
  spots: number;
  /** `YYYY-MM-DD`: the last import that found any of these rows in OSM. */
  readAt: string | null;
  types: Record<InsightSpotType, number>;
  /** `yes` and `no` as recorded; the page adds them up for the denominator. */
  amenities: Record<InsightAmenity, { yes: number; no: number }>;
  surroundings: {
    /** `YYYY-MM-DD`: the last time a context was computed for any row here. */
    computedAt: string | null;
    supermarket: { known: number; within: number };
    station: { known: number; within: number };
    water: {
      /** Rows whose nearest water carries a name. */
      named: number;
      /** The name that is nearest for most of them, with its distance span. */
      top: {
        name: string;
        sites: number;
        nearestM: number;
        farthestM: number;
      } | null;
    };
  };
}

const amenityCols = INSIGHT_AMENITIES.map(
  (k) =>
    `count(*) FILTER (WHERE s.amenities ->> '${k}' = 'yes')::int AS ${k}_yes,
     count(*) FILTER (WHERE s.amenities ->> '${k}' = 'no')::int AS ${k}_no`,
).join(',\n');

const typeCols = SPOT_TYPES.map(
  (t) => `count(*) FILTER (WHERE s.type = '${t}')::int AS type_${t}`,
).join(',\n');

/** `$1` country (any case), `$2` the region as stored. One row, always. */
export const REGION_INSIGHTS_SQL = `
  SELECT count(*)::int AS spots,
         to_char(max(s.last_seen_at), 'YYYY-MM-DD') AS read_at,
         to_char(max(s.context_computed_at), 'YYYY-MM-DD') AS computed_at,
         ${typeCols},
         ${amenityCols},
         count(*) FILTER (WHERE s.context -> 'supermarket' ->> 'm' IS NOT NULL)::int
           AS supermarket_known,
         count(*) FILTER (WHERE (s.context -> 'supermarket' ->> 'm')::numeric <= ${NEARBY_M})::int
           AS supermarket_within,
         count(*) FILTER (WHERE s.context -> 'station' ->> 'm' IS NOT NULL)::int
           AS station_known,
         count(*) FILTER (WHERE (s.context -> 'station' ->> 'm')::numeric <= ${NEARBY_M})::int
           AS station_within,
         count(*) FILTER (WHERE s.context -> 'water' ->> 'name' IS NOT NULL)::int
           AS water_named
    FROM camping_spots s
   WHERE lower(s.country) = lower($1) AND s.region = $2
     AND s.missing_since IS NULL
     AND ${notSecondarySql('s')}`;

/** Same rows: the named water that is nearest for the most of them. */
export const REGION_TOP_WATER_SQL = `
  SELECT s.context -> 'water' ->> 'name' AS name,
         count(*)::int AS sites,
         min((s.context -> 'water' ->> 'm')::numeric)::int AS nearest_m,
         max((s.context -> 'water' ->> 'm')::numeric)::int AS farthest_m
    FROM camping_spots s
   WHERE lower(s.country) = lower($1) AND s.region = $2
     AND s.missing_since IS NULL
     AND ${notSecondarySql('s')}
     AND s.context -> 'water' ->> 'name' IS NOT NULL
   GROUP BY 1
   ORDER BY 2 DESC, 1
   LIMIT 1`;

type Row = Record<string, number | string | null>;

export async function countRegionInsights(
  query: (sql: string, params: unknown[]) => Promise<Row[]>,
  country: string,
  region: string,
): Promise<RegionInsights> {
  const [row] = await query(REGION_INSIGHTS_SQL, [country, region]);
  const [water] = await query(REGION_TOP_WATER_SQL, [country, region]);
  const n = (k: string) => row[k] as number;
  return {
    region,
    spots: n('spots'),
    readAt: (row.read_at as string | null) ?? null,
    types: Object.fromEntries(
      SPOT_TYPES.map((t) => [t, n(`type_${t}`)]),
    ) as Record<InsightSpotType, number>,
    amenities: Object.fromEntries(
      INSIGHT_AMENITIES.map((k) => [
        k,
        { yes: n(`${k}_yes`), no: n(`${k}_no`) },
      ]),
    ) as Record<InsightAmenity, { yes: number; no: number }>,
    surroundings: {
      computedAt: (row.computed_at as string | null) ?? null,
      supermarket: {
        known: n('supermarket_known'),
        within: n('supermarket_within'),
      },
      station: { known: n('station_known'), within: n('station_within') },
      water: {
        named: n('water_named'),
        top: water
          ? {
              name: water.name as string,
              sites: water.sites as number,
              nearestM: water.nearest_m as number,
              farthestM: water.farthest_m as number,
            }
          : null,
      },
    },
  };
}
