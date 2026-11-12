// CAMP-503: what a campsite page says about fuel, EV charging, water, grey-water
// dump and gas — "where in the campsite itself and where nearby".
//
// No Nest imports, no database: pure builders, so a spec can read the SQL.
//
// 🔴 EV CHARGING IS NOT THE CAMPER'S HOOKUP. `osm_route_poi.kind = 'charging'`
// is `amenity=charging_station`: a public charger for ELECTRIC CARS. A camper
// plugs into the pitch's mains socket (CEE 16 A), which on the campsite page is
// `amenities.electricity`. Two different needs, two different words: this
// module names its kind `ev_charging`, never `charging` or `electricity`, so a
// label cannot slide from one to the other, and a spec fails if the word
// "electricity" or "hookup" reaches the SQL. Voltage, power and price of the
// pitch hookup are the OWNER's fields (owner-overrides.ts, `hookup`): OSM has
// none of them on a campsite and we do not invent them.
//
// 🔴 NOT A KNN ORDER. `p.location <-> spot` orders by distance in DEGREES, and a
// degree of longitude is shorter than one of latitude away from the equator:
// measured 12.11.2026 at 58.4 N, it handed back a charger 8 585 m away while one
// 7 156 m away existed. The search box (an index scan) bounds the candidates and
// the exact geography distance chooses among them — the box is a few km², so the
// sort is over a handful of rows.
//
// 🔴 THE TWO NUMBERS BELOW ARE MEASURED, 12.11.2026, on camptribe_dev
// (63 159 campsites, 2 286 000 route POI) — and an estimate, not a law.
//
// NEARBY_RADIUS_M = 10 000. Share of a 1 104-campsite sample (every 60th by
// hash of id) with at least one point of the kind inside the radius:
//
//              2 km    5 km   10 km   25 km
//   fuel        46%     81%     96%     100%
//   ev charging 49%     73%     90%      98%
//   water       53%     78%     93%      99%
//   dump        24%     41%     62%      87%
//   gas         14%     29%     46%      67%
//
// 10 km is about twenty minutes in a camper: the point where "nearby" is still
// a plan for the evening. 25 km is a different trip, and it would make every
// campsite look equally supplied. Distance is straight-line, and the page says
// so.
//
// ONSITE_RADIUS_M = 150, used where the campsite has NO outline (the usual
// case). Where one exists, "on site" is the exact test — the point lies INSIDE
// the outline — and the radius is not used at all. Measured on the 1 292
// campsites that have an outline in that database: of the points inside an
// outline, distance from the campsite's own point is p50 73 m / p90 201 m for
// water, 75 / 170 for dump, 137 / 251 for charging. 150 m keeps roughly four in
// five of the true ones. It is chosen LOW on purpose: a false "on site" promises
// a tap that belongs to the neighbour; a point shown as "nearby" at 180 m costs
// the reader nothing.

export const NEARBY_RADIUS_M = 10_000;
export const ONSITE_RADIUS_M = 150;

// CAMP-506: THE KINDS ARE GROUPED BY WHAT THE TRAVELLER NEEDS, NOT BY OSM TAG.
//
//   before  — before arriving: fuel, groceries (supermarket / convenience),
//             EV charging, gas bottle swap. A thing you buy on the way.
//   stay    — at the campsite: drinking water, waste-water dump. (The pitch
//             mains socket is the owner's `hookup`, shown below the list.)
//   trouble — when something goes wrong: pharmacy, car repair.
//
// Group order and the kinds inside each are the page order. A kind belongs to
// exactly one group (spec). The words of the group headings are CMS slots
// `group-<group>`, never JSX.
//
// 🔴 `pharmacy` is `amenity=pharmacy`, `car_repair` is `shop=car_repair`; both
// are stored-only kinds of osm_route_poi (osm/route-poi.ts) and exist in the
// table only after the weekly import that carries this card. Until then the
// two simply have no rows and the page draws nothing for them. Nothing in
// OSM marks a repair shop as one that works on campervans / RVs
// (`shop=caravan` is a dealer), so the label says "car repair" and no more.

export const CAMP_SERVICE_GROUPS = [
  { group: 'before', kinds: ['fuel', 'groceries', 'ev_charging', 'gas'] },
  { group: 'stay', kinds: ['water', 'dump'] },
  { group: 'trouble', kinds: ['pharmacy', 'car_repair'] },
] as const;
export type CampServiceGroup = (typeof CAMP_SERVICE_GROUPS)[number]['group'];

/** Closed list, page order (groups flattened). `ev_charging` — see above. */
export const CAMP_SERVICE_KINDS = CAMP_SERVICE_GROUPS.flatMap(
  (g) => g.kinds,
) as unknown as readonly [
  'fuel',
  'groceries',
  'ev_charging',
  'gas',
  'water',
  'dump',
  'pharmacy',
  'car_repair',
];
export type CampServiceKind = (typeof CAMP_SERVICE_KINDS)[number];

export const groupOf = (kind: CampServiceKind): CampServiceGroup =>
  CAMP_SERVICE_GROUPS.find((g) =>
    (g.kinds as readonly string[]).includes(kind),
  )!.group;

/**
 * The row filter per kind. The kind is a LITERAL in the text on purpose:
 * a partial index is usable only when the planner can prove the query implies
 * its predicate against a constant (RoutePoi migration: 9.7 s when it was a
 * join variable). `gas` is `cylinder_swap = 'yes'`, the layer's definition
 * (route-poi.ts STORED_ONLY_KINDS).
 */
const FILTER: Record<CampServiceKind, string> = {
  fuel: `p.kind = 'fuel'`,
  groceries: `p.kind = 'groceries'`,
  ev_charging: `p.kind = 'charging'`,
  water: `p.kind = 'water'`,
  dump: `p.kind = 'dump'`,
  gas: `p.cylinder_swap = 'yes'`,
  pharmacy: `p.kind = 'pharmacy'`,
  car_repair: `p.kind = 'car_repair'`,
};

export interface CampServicePoint {
  name: string | null;
  /** Straight-line metres from the campsite's point. */
  metres: number;
  /**
   * CAMP-506: the day OUR import last saw this object (`last_seen_at`, UTC,
   * `YYYY-MM-DD`) — "OpenStreetMap, imported on …". Not the mapper's edit
   * date, which the table does not hold. `null` when unreadable.
   */
  seen: string | null;
}
export interface CampServiceView {
  kind: CampServiceKind;
  group: CampServiceGroup;
  /** Nearest point inside the campsite, or null. */
  onSite: CampServicePoint | null;
  /** Nearest point outside it, within NEARBY_RADIUS_M, or null. */
  nearby: CampServicePoint | null;
}

export interface CampServicesPayload {
  nearbyM: number;
  onSiteM: number;
  /** Kinds with at least one point. `[]` = the page draws nothing. */
  items: CampServiceView[];
}

const assertPositiveInt = (name: string, n: number): void => {
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${name} must be a positive integer, got ${n}`);
};

/**
 * One scalar subquery: a JSON array with an entry for each kind that has at
 * least one point (on site or nearby). `[]` when none — the page then draws
 * nothing.
 */
export function campServicesSql(
  spotLocationExpr: string,
  spotOutlineExpr: string,
  nearbyM: number = NEARBY_RADIUS_M,
  onSiteM: number = ONSITE_RADIUS_M,
): string {
  assertPositiveInt('nearby radius', nearbyM);
  assertPositiveInt('on-site radius', onSiteM);
  // Degrees wide enough to cover `m` metres in both axes at this latitude.
  // A superset box — the exact test is the geography distance — so it only
  // has to be generous, and it is what lets the GiST index bound the walk.
  const deg = (m: number): string =>
    `(${m} / (111320.0 * greatest(cos(radians(ST_Y(${spotLocationExpr}))), 0.05)))`;
  const onSite = `(CASE WHEN ${spotOutlineExpr} IS NOT NULL
                        THEN ST_Covers(${spotOutlineExpr}, p.location)
                        ELSE ST_DWithin(${spotLocationExpr}::geography, p.location::geography, ${onSiteM})
                   END)`;
  const metres = `round(ST_Distance(${spotLocationExpr}::geography, p.location::geography))::int`;
  const point = (kind: CampServiceKind, where: string): string => `(
        SELECT jsonb_build_object('name', p.name, 'metres', ${metres},
                 'seen', to_char(p.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
          FROM osm_route_poi p
         WHERE ${FILTER[kind]}
           AND ${where}
         ORDER BY ST_Distance(${spotLocationExpr}::geography, p.location::geography), p.osm_ref
         LIMIT 1)`;
  const entries = CAMP_SERVICE_KINDS.map((kind) => {
    const inside = point(
      kind,
      `p.location && ST_Expand(coalesce(${spotOutlineExpr}, ${spotLocationExpr}), ${deg(onSiteM)})
           AND ${onSite}`,
    );
    const around = point(
      kind,
      `p.location && ST_Expand(${spotLocationExpr}, ${deg(nearbyM)})
           AND NOT ${onSite}
           AND ST_DWithin(${spotLocationExpr}::geography, p.location::geography, ${nearbyM})`,
    );
    return `SELECT '${kind}' AS kind, ${inside} AS on_site, ${around} AS nearby`;
  });
  return `(
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'kind', e.kind, 'onSite', e.on_site, 'nearby', e.nearby
           ) ORDER BY array_position(
             ARRAY[${CAMP_SERVICE_KINDS.map((k) => `'${k}'`).join(',')}], e.kind)), '[]'::jsonb)
      FROM (${entries.join('\n      UNION ALL\n      ')}) e
     WHERE e.on_site IS NOT NULL OR e.nearby IS NOT NULL
  )`;
}

/** What the API sends: the SQL's array, checked, never a bare cast. */
export function readCampServices(raw: unknown): CampServiceView[] {
  if (!Array.isArray(raw)) return [];
  const known: readonly string[] = CAMP_SERVICE_KINDS;
  const point = (v: unknown): CampServicePoint | null => {
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (typeof o.metres !== 'number' || !Number.isFinite(o.metres)) return null;
    return {
      name: typeof o.name === 'string' && o.name.trim() !== '' ? o.name : null,
      metres: o.metres,
      seen:
        typeof o.seen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.seen)
          ? o.seen
          : null,
    };
  };
  const out: CampServiceView[] = [];
  for (const e of raw) {
    // 🔴 One bad entry costs one entry, not the page.
    if (e === null || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.kind !== 'string' || !known.includes(o.kind)) continue;
    const onSite = point(o.onSite);
    const nearby = point(o.nearby);
    if (onSite === null && nearby === null) continue;
    const kind = o.kind as CampServiceKind;
    out.push({ kind, group: groupOf(kind), onSite, nearby });
  }
  return out;
}
