// CAMP-113: which OpenStreetMap tags become a route service, and which
// deliberately do not.
//
// 🔴 No Nest imports in this file, for the reason spelled out at the top
// of routes/route-points.ts: the service layer pulls in @nestjs/typeorm,
// which ships ESM that Jest will not parse here, so anything reachable
// only through the service has no test while appearing to have one.
//
// ── THE SELECTION, AND THE COUNTS THAT DECIDED IT ────────────────────────
//
// The card's first open question is "how many POI types before the map
// becomes soup", and names park4night's failure: half its points are
// water taps. So this was chosen from measured counts, not from a
// wishlist. 3 131 834 candidate objects were pulled from the 27 EU-27
// Geofabrik extracts on 28.09.2026 and counted per tag:
//
//   amenity=restaurant        601 023      shop=bakery         126 299
//   amenity=cafe              219 853      amenity=pharmacy    126 271
//   shop=supermarket          214 569      shop=car_repair     125 095
//   amenity=drinking_water    205 156      tourism=guest_house 110 731
//   amenity=fast_food         197 312      tourism=picnic_site 107 704
//   amenity=toilets           182 187      man_made=water_well  89 398
//   tourism=hotel             172 929      highway=rest_area    22 968
//   shop=convenience          171 650      amenity=shower       21 128
//   amenity=charging_station  161 074      shop=laundry         20 013
//   amenity=fuel              156 654      tourism=hostel       19 424
//                                          man_made=water_tap   19 274
//                                          highway=services     13 290
//                                          amenity=sanitary_
//                                            dump_station        7 597
//
// 🔴 WHAT WAS LEFT OUT, AND WHY — this list is the actual decision.
//
//   amenity=toilets (182 187)  A toilet is not a stop anybody plans, and
//                              every campsite on the page already has
//                              one. 8.7% carry opening hours and 0.3% a
//                              phone, so the row would say "unknown,
//                              unknown" 99 times in 100. This is exactly
//                              the soup the card names.
//   man_made=water_well        A well is not drinking water and OSM
//     (89 398)                 makes no claim that it is. Publishing
//                              89 398 of them under a tap symbol is the
//                              invented fact this project keeps refusing.
//   tourism=picnic_site        Scenery, not a service. 0.1% have hours.
//     (107 704)
//   amenity=pharmacy,          Real needs, but not the question "where
//     shop=bakery,             do I stop between two campsites", and
//     shop=car_repair,         seven kinds is already the ceiling the
//     shop=laundry             per-page cap allows (see ODbL note below).
//   highway=rest_area,         A services area is a wrapper around the
//     highway=services         fuel, food and toilets already listed, so
//     (36 258)                 it would show the same stop twice under
//                              two names.
//   amenity=shower (21 128)    Same argument as toilets, at a tenth the
//                              count.
//
// 🔴 `access` is filtered, not shown. A private or employees-only fuel
// station is not a place a stranger can fill up; 9 874 of the candidates
// say so and they are dropped rather than listed with a caveat nobody
// reads.
//
// 🔴 WHAT THE SELECTION ACTUALLY HOLDS, after the access filter and
// CAMP-118's EU-27 filter — 2 248 490 rows:
//
//   food      1 009 469    charging  154 814
//   groceries   385 266    fuel      154 172
//   shelter     306 806    dump        7 519
//   water       230 444
//
// The spread is the point. `dump` is 0.3% of the table and it is the one
// a camper cannot improvise; `food` is 45% of it and is near-tautological
// in a town. Showing ONE of each (see SERVICES_PER_KIND) is what keeps
// the second from burying the first.

// 🔴 THERE IS NO CAMPER-DIMENSION FILTER, AND THAT IS THE ANSWER TO THE
// CARD'S SECOND QUESTION RATHER THAN A GAP IN THE WORK.
//
// The card asks whether to filter by vehicle size — "a petrol station
// with a low canopy is useless to a six-metre van" — and whether OSM
// carries `maxheight` on these at all. It does, on almost nothing.
// Measured across the same 3 131 834 candidates on 28.09.2026:
//
//   amenity=fuel              306 of 156 654    0.20%
//   amenity=charging_station   45 of 161 074    0.03%
//   shop=car_repair            10 of 125 095    0.01%
//   everything else                        0    0.00%
//
// And 8 of the 306 fuel values are not a number at all — they say
// `default` or `below_default`, which is a statement about a national
// legal limit rather than about that canopy. The one tag with real
// coverage is `amenity=parking_entrance` at 22.77%, which is a barrier
// on a car-park ramp and not a service anybody drives to.
//
// A "fits my van" filter over 0.2% coverage does not narrow the list to
// the stations a six-metre van can use. It either hides 99.8% of the
// fuel in Europe or, switched the other way, silently does nothing — and
// a control that silently does nothing is worse than an absent one,
// because the driver believes the result. So the honest position is to
// say the data is not there. If `maxheight` coverage ever reaches a
// useful fraction the column is one import away; this comment is the
// measurement to re-run before anybody builds the control.

/** The closed list of service kinds. Order is the order a page shows them. */
export const ROUTE_POI_KINDS = [
  'fuel',
  'charging',
  'water',
  'dump',
  'groceries',
  'food',
  'shelter',
] as const;

export type RoutePoiKind = (typeof ROUTE_POI_KINDS)[number];

export const ROUTE_POI_KIND_SET: ReadonlySet<string> = new Set(ROUTE_POI_KINDS);

export function isRoutePoiKind(value: unknown): value is RoutePoiKind {
  return typeof value === 'string' && ROUTE_POI_KIND_SET.has(value);
}

/**
 * The OSM tags each kind is built from.
 *
 * 🔴 Written as data rather than as a SQL string, because two things
 * read it: the loader (which turns it into a CASE) and the spec (which
 * asserts every kind has at least one rule and no tag is claimed by two
 * kinds). A CASE expression typed by hand satisfies neither.
 */
export interface TagRule {
  /** The OSM key, as the staging table columns are named. */
  key: 'amenity' | 'shop' | 'tourism' | 'man_made';
  /** The values that count. */
  values: string[];
}

export const ROUTE_POI_RULES: Record<RoutePoiKind, TagRule[]> = {
  fuel: [{ key: 'amenity', values: ['fuel'] }],
  charging: [{ key: 'amenity', values: ['charging_station'] }],
  // Three tags for one idea: somewhere to fill a tank or a bottle.
  // `man_made=water_well` is NOT here — see the note above.
  water: [
    { key: 'amenity', values: ['drinking_water', 'water_point'] },
    { key: 'man_made', values: ['water_tap'] },
  ],
  dump: [{ key: 'amenity', values: ['sanitary_dump_station'] }],
  groceries: [{ key: 'shop', values: ['supermarket', 'convenience'] }],
  food: [{ key: 'amenity', values: ['restaurant', 'cafe', 'fast_food'] }],
  shelter: [
    { key: 'tourism', values: ['hotel', 'motel', 'hostel', 'guest_house'] },
  ],
};

/**
 * `access` values that mean "not you".
 *
 * `customers` and `permissive` are deliberately absent: a supermarket
 * car park is customers-only and a driver buying groceries is a customer.
 */
export const ACCESS_EXCLUDED = ['private', 'no', 'employees', 'permit'];

/**
 * 🔴 ONE POINT OF EACH KIND PER STAGE, AND THE REASON IS LEGAL.
 *
 * A route page is a Produced Work under ODbL §4.5(a), and that rests on
 * the page showing a handful of objects picked by our own criteria
 * rather than a systematic extract. `lib/routes.ts` puts our own floor
 * for "Substantial" at 100 objects, and the longest route in the library
 * has 7 stages already showing 4 campsites each — 28.
 *
 * Seven kinds at ONE each is 7 × 7 = 49, for 77 objects on the largest
 * page. At two each it would be 98 + 28 = 126, over our own line. So the
 * number is not a layout preference; it is what the licence position can
 * carry, and there is a test that fails if a route or a kind is added
 * that would push a page past the floor.
 *
 * It is also the right answer to the question. "The nearest charger is
 * 4 km away" is the fact a driver needs; a directory of the nearest six
 * is not more useful, it is the soup.
 */
export const SERVICES_PER_KIND = 1;

/**
 * The SQL CASE that turns a staging row into a kind, built from
 * ROUTE_POI_RULES so the rules exist in exactly one place.
 *
 * 🔴 Values are checked against a literal whitelist before they are
 * interpolated. Nothing here comes from a request — the rules are a
 * constant in this file — but a SQL string assembled by concatenation is
 * one careless edit away from being the thing that does, and this repo
 * is public.
 */
export function classifyCaseSql(alias = 's'): string {
  const safe = (v: string) => {
    if (!/^[a-z_]+$/.test(v)) {
      throw new Error(`route-poi: unsafe tag value ${JSON.stringify(v)}`);
    }
    return `'${v}'`;
  };

  const branches = ROUTE_POI_KINDS.map((kind) => {
    const tests = ROUTE_POI_RULES[kind].map(
      (rule) => `${alias}.${rule.key} IN (${rule.values.map(safe).join(', ')})`,
    );
    return `WHEN ${tests.join(' OR ')} THEN '${kind}'`;
  });

  return `CASE ${branches.join(' ')} END`;
}
