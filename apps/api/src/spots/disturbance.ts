// CAMP-502: "Possible disturbance" — distance from a campsite to the nearest
// motorway or trunk road, railway LINE and airport.
//
// 🔴 WHAT THIS IS, AND WHAT IT IS NOT. It is a DISTANCE we computed from
// OpenStreetMap geometry. It is NOT a noise or air measurement and the page
// says so, in words that live in the CMS (page `camp-disturbance`, slot
// `caveat`). A block that gives the numbers without that sentence is a claim
// about silence we cannot back, so the page draws nothing when the sentence is
// missing (apps/web/src/lib/disturbance.ts).
//
// No Nest imports, no database: a pure builder, so a spec can read the SQL.
//
// 🔴 EXACT METRES, NOT A KNN ORDER. `<->` orders by DEGREES; at 50 N a degree of
// longitude is 71 km against 111 km of latitude (CAMP-323, and CAMP-503 hit it
// again). The search box (index scan) bounds the candidates, the geography
// distance picks the nearest and is the number printed.
//
// 🔴 THE THRESHOLDS ARE A JUDGEMENT, MEASURED ONLY FOR HOW OFTEN THEY FIRE
// (12.11.2026, scratch DB, Belgium + Slovenia + Luxembourg + Malta extracts,
// 1 237 campsites): share of campsites with at least one object within
//
//              300 m  500 m   1 km   2 km   5 km  10 km
//   road         4%     6%    13%    23%
//   rail                14%    23%    34%
//   airport                            0.5%   2.4%   9%
//
// Roads and railways: 1 km — the order of distance at which traffic and trains
// are commonly heard; 2 km would put a block on one page in three and make the
// word "possible" meaningless. Airports: 5 km — flight paths carry far
// further than a road does, and 10 km would flag one campsite in eleven.
// These are not a noise model and the page does not call them one.
//
// WHAT COUNTS (the layer `osm_ctx_hazard` is a plain copy of the tags, see
// scripts/osm-pipeline/load-context.sh; the rules are here):
//   road     highway = motorway | trunk, not in a tunnel.
//   rail     railway = rail (a LINE; stations are another layer and a thing a
//            traveller wants), not yards/sidings/spurs/crossovers (`service`),
//            not in a tunnel.
//   airport  aeroway = aerodrome WITH an `iata` code (scheduled flights), not
//            every grass strip.

export const DISTURBANCE_KINDS = ['road', 'rail', 'airport'] as const;
export type DisturbanceKind = (typeof DISTURBANCE_KINDS)[number];

export const DISTURBANCE_RADIUS_M: Record<DisturbanceKind, number> = {
  road: 1_000,
  rail: 1_000,
  airport: 5_000,
};

const FILTER: Record<DisturbanceKind, string> = {
  road: `x.highway IN ('motorway','trunk') AND (x.tunnel IS NULL OR x.tunnel = 'no')`,
  rail: `x.railway = 'rail' AND x.service IS NULL AND (x.tunnel IS NULL OR x.tunnel = 'no')`,
  airport: `x.aeroway = 'aerodrome' AND x.iata IS NOT NULL`,
};

export interface DisturbancePoint {
  kind: DisturbanceKind;
  /** Straight-line metres to the nearest piece of the object (PostGIS). */
  metres: number;
  /** The nearest point ON the object, for the map. */
  lon: number;
  lat: number;
  name: string | null;
}
export interface DisturbancePayload {
  radiusM: Record<DisturbanceKind, number>;
  /** Only kinds with a computed distance inside their radius. `[]` = no block. */
  items: DisturbancePoint[];
}

/** One scalar subquery: a JSON array, `[]` when nothing is in range. */
export function disturbanceSql(
  spotLocationExpr: string,
  radius: Record<DisturbanceKind, number> = DISTURBANCE_RADIUS_M,
): string {
  const entries = DISTURBANCE_KINDS.map((kind) => {
    const m = radius[kind];
    if (!Number.isInteger(m) || m <= 0)
      throw new Error(`${kind} radius must be a positive integer, got ${m}`);
    const deg = `(${m} / (111320.0 * greatest(cos(radians(ST_Y(${spotLocationExpr}))), 0.05)))`;
    return `(
      SELECT jsonb_build_object('kind', '${kind}',
               'metres', round(ST_Distance(${spotLocationExpr}::geography, x.geom::geography))::int,
               'lon', ST_X(ST_ClosestPoint(x.geom, ${spotLocationExpr})),
               'lat', ST_Y(ST_ClosestPoint(x.geom, ${spotLocationExpr})),
               'name', x.name)
        FROM osm_ctx_hazard x
       WHERE ${FILTER[kind]}
         AND x.geom && ST_Expand(${spotLocationExpr}, ${deg})
         AND ST_DWithin(${spotLocationExpr}::geography, x.geom::geography, ${m})
       ORDER BY ST_Distance(${spotLocationExpr}::geography, x.geom::geography), x.ogc_fid
       LIMIT 1)`;
  });
  return `(
    SELECT coalesce(jsonb_agg(e.v), '[]'::jsonb)
      FROM (${entries.map((e) => `SELECT ${e} AS v`).join('\n      UNION ALL\n      ')}) e
     WHERE e.v IS NOT NULL
  )`;
}

/** What the API sends: the SQL's array, checked, never a bare cast. */
export function readDisturbance(raw: unknown): DisturbancePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: DisturbancePoint[] = [];
  for (const e of raw) {
    // 🔴 One bad entry costs one entry, not the page.
    if (e === null || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const kind = (DISTURBANCE_KINDS as readonly unknown[]).find(
      (k) => k === o.kind,
    ) as DisturbanceKind | undefined;
    if (!kind) continue;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const metres = num(o.metres);
    const lon = num(o.lon);
    const lat = num(o.lat);
    if (metres === null || metres < 0 || lon === null || lat === null) continue;
    out.push({
      kind,
      metres,
      lon,
      lat,
      name: typeof o.name === 'string' && o.name.trim() !== '' ? o.name : null,
    });
  }
  return out;
}
