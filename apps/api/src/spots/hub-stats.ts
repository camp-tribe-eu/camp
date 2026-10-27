import { notSecondarySql } from './links';
import { overnightStatusSql } from './overnight';
import { DISPLAYABLE_TARIFF_SQL } from './tariffs';

// The figures behind the hub pages' stat tiles and FAQ (design-audit §11,
// screens 1 and 2), counted from OUR rows, one row per region of a
// country. The country page adds the rows up; the region page takes its
// own. The survey these rest on is docs/region-insight-survey.md.
//
// 🔴 THE SAME ROWS `regions()` COUNTS — published, in a region, not a
// secondary copy — so "Campsites" here is the number the region list
// already prints, and the two cannot disagree on one page.
//
// 🔴 RAW COUNTS, NEVER A VERDICT. `yes` and `no` are counted separately;
// `unknown` is "nobody wrote the tag" (osm/import-spots.ts) and is in
// neither. Whether a figure is filled in enough to print — the 20 % gate
// of the card — is decided once, on the web side (lib/hub-stats.ts),
// where one test and one mutation can reach it.
//
// 🔴 A PRICE IS A DATED OVERNIGHT RATE IN EURO, nothing looser. The
// tariff table holds per-week, per-person and per-animal rows, and more
// than half of all rows carry no season (tariffs.ts); "from €1 a night"
// built from a tourist tax or a 2019 tariff would be the lie the card
// forbids. Measured 27.10.2026 on the local base: 1 site of 52 549 has
// one, so the tile prints nowhere today — and prints the day the data
// arrives, through the same gate.

export interface HubRegionStats {
  region: string;
  /** Published campsites of the region: the denominator `type` may use. */
  spots: number;
  /** `YYYY-MM-DD`: the last import that found any of these rows in OSM. */
  readAt: string | null;
  /** `type` is recorded on every row, so this needs no denominator. */
  freeWild: number;
  electricity: { yes: number; no: number };
  overnight: { allowed: number; forbidden: number };
  price: {
    /** Sites with at least one dated overnight rate in EUR. */
    known: number;
    /** The lowest of those rates, as text — money stays `numeric`. */
    minEur: string | null;
  };
}

/** `$1` country, any case. One row per region, largest first. */
export const HUB_STATS_SQL = `
  SELECT s.region,
         count(*)::int AS spots,
         to_char(max(s.last_seen_at), 'YYYY-MM-DD') AS read_at,
         count(*) FILTER (WHERE s.type IN ('free', 'wild'))::int AS free_wild,
         count(*) FILTER (WHERE s.amenities ->> 'electricity' = 'yes')::int
           AS electricity_yes,
         count(*) FILTER (WHERE s.amenities ->> 'electricity' = 'no')::int
           AS electricity_no,
         count(*) FILTER (WHERE ${overnightStatusSql('s')} = 'allowed')::int
           AS overnight_allowed,
         count(*) FILTER (WHERE ${overnightStatusSql('s')} = 'forbidden')::int
           AS overnight_forbidden,
         count(p.min_eur)::int AS price_known,
         min(p.min_eur)::text AS price_min_eur
    FROM camping_spots s
    LEFT JOIN LATERAL (
      SELECT min(t.min_price) AS min_eur
        FROM spot_tariffs t
       WHERE t.spot_id = s.id
         AND t.currency = 'EUR'
         AND t.mode = 'Overnight'
         AND t.min_price > 0
         AND ${DISPLAYABLE_TARIFF_SQL}
    ) p ON true
   WHERE lower(s.country) = lower($1)
     AND s.region IS NOT NULL AND s.missing_since IS NULL
     AND ${notSecondarySql('s')}
   GROUP BY s.region
   ORDER BY 2 DESC, 1`;

type Row = {
  region: string;
  spots: number;
  read_at: string | null;
  free_wild: number;
  electricity_yes: number;
  electricity_no: number;
  overnight_allowed: number;
  overnight_forbidden: number;
  price_known: number;
  price_min_eur: string | null;
};

export async function countHubStats(
  query: (sql: string, params: unknown[]) => Promise<Row[]>,
  country: string,
): Promise<HubRegionStats[]> {
  const rows = await query(HUB_STATS_SQL, [country]);
  return rows.map((r) => ({
    region: r.region,
    spots: r.spots,
    readAt: r.read_at ?? null,
    freeWild: r.free_wild,
    electricity: { yes: r.electricity_yes, no: r.electricity_no },
    overnight: {
      allowed: r.overnight_allowed,
      forbidden: r.overnight_forbidden,
    },
    price: { known: r.price_known, minEur: r.price_min_eur ?? null },
  }));
}
