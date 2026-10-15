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
//   highway=rest_area,         WAS LEFT OUT HERE, AND IS NOT ANY MORE.
//     highway=services         The argument was that a services area wraps
//     (36 258)                 the fuel, food and toilets already listed,
//                              so it would show the same stop twice under
//                              two names. CAMP-119 stored them and then
//                              put them on the page; the reasoning for
//                              why that was allowed to change is at
//                              REST_STOP_KINDS below, where it can be
//                              read next to the numbers it rests on.
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

import { tagParts } from './route-poi-facilities';

/**
 * The closed list of service kinds. Order is the order a page shows them.
 *
 * 🔴 THE LAST TWO ARE CAMP-119'S, AND THEY ARE LAST ON PURPOSE. The list
 * is also the order `classifyCaseSql` tries them in, and a CASE returns
 * its FIRST match: an object tagged both `amenity=fuel` and
 * `highway=services` must stay the fuel station it was before this card,
 * so that its row — and the price keyed on it — does not move. Putting a
 * new kind anywhere but the end would re-classify objects that already
 * have a row.
 */
export const ROUTE_POI_KINDS = [
  'fuel',
  'charging',
  'water',
  'dump',
  'groceries',
  'food',
  'shelter',
  'rest_area',
  'service_area',
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
  key: 'amenity' | 'shop' | 'tourism' | 'man_made' | 'highway';
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
  // CAMP-119. `highway=services` is stored as `service_area`, and the
  // reason for the name is in the block below.
  rest_area: [{ key: 'highway', values: ['rest_area'] }],
  service_area: [{ key: 'highway', values: ['services'] }],
};

// ── CAMP-119: STOPPING PLACES — STORED, AND SHOWN ────────────────────────
//
// `highway=rest_area` (a lay-by or motorway rest area) and
// `highway=services` (a motorway service area) are loaded into the same
// table, carry the nine facility columns of migration 1791400000000, and
// are in ROUTE_POI_KINDS, so a route page lists the nearest of each at
// every stage with its straight-line distance and what OpenStreetMap says
// about toilets, showers, drinking water, a disposal point and a fee.
//
// 🔴 THEY WERE STORED FIRST AND KEPT OFF THE PAGE ON PURPOSE, AND THIS IS
// WHY THAT STOPPED BEING TRUE. The first half of this card (PR #234)
// loaded them and left ROUTE_POI_KINDS alone, because adding two
// kinds to that list changes three things at once: `parseKinds` defaults
// to every kind in it, `buildServicesSql` writes one index scan per kind
// into the stage query, and MAX_SERVICE_POINTS is derived from its length
// so the ODbL "Substantial" floor (100 objects a page) cannot be crossed.
// A spec pinned the list, and the pin was right for as long as the page
// had no way to say what a rest area is. It was also the reason the card
// stayed open after that PR merged: the data was in the database and no
// reader could see any of it.
//
// What the pin protected, and what now carries it instead:
//
//   · THE QUERY. The two partial GiST indexes exist
//     (1791400000000-RoutePoiFacilities.ts) and the spec that checks "a
//     kind without its index is a sequential scan over 2.26 million rows"
//     now reads BOTH migrations' lists against this one.
//   · THE LICENCE. MAX_SERVICE_POINTS is derived, so it fell from 9 to 7
//     on its own. 7 is the number of stages on the longest route in the
//     library, and `routes.spec.ts` in the web app fails a route that
//     outgrows it: 7 stages × (4 campsites + 9 kinds) is 91 objects
//     against our own line of 100.
//   · THE DUPLICATE. "A services area wraps the fuel and the food already
//     listed, so it would show the same stop twice under two names" is
//     TRUE of `highway=services`: the CAMP-119 reconnaissance of
//     14.10.2026 reports `amenity=fuel` inside most of them (85.4% by its
//     own count, quoted from the card and not re-measured here). It is
//     NOT true of `highway=rest_area`, which is a lay-by and holds
//     nothing — and that is the object the owner asked for ("I may need
//     the toilet just on the road"). Two things make the repeat tolerable
//     for the first: the row carries what the fuel row cannot, the
//     facility states, and an object tagged both is classified once, as
//     fuel, by the CASE order. The remaining overlap is a polygon and a
//     pin for one forecourt; it is named here rather than hidden, and it
//     is the price of showing the rest areas.
//
// 🔴 THE NAMES. `rest_area` is OSM's own word and kept. `highway=services`
// is stored as `service_area`, NOT `services`: in this codebase "services"
// already means everything a route page lists (`route-services.ts`,
// `/routes/services`, `RouteService`), and a `kind: 'services'` inside a
// `services[]` would read as the whole thing and the part at once.
//
// 🔴 `amenity=parking` IS NOT HERE. 3.1 million objects, and not the same
// conversation: it needs its own count of what a camper can actually
// park a van on.
//
// 🔴 THE `dump` NUMBER, AND WHAT IT IS.
//
// `dump` is `amenity=sanitary_dump_station` on a NODE or a WAY, one row
// per OSM object, minus `access` in ACCESS_EXCLUDED, inside the EU-27.
// That is one formula, and the loader prints the number it gives.
//
// It is NOT the `sanitary_dump_station=*` KEY on any object. That tag is
// also written on campsites, rest areas and service areas ("this place has
// a dump point"), where it is a facility of somewhere else, not a point of
// its own — it lands in the `sanitary_dump_station` COLUMN of whatever row
// it sits on, as yes/no/unknown, and is never counted as a dump station.
// The two were measured on 14.10.2026 over the 27 raw extracts and they
// differ by a factor of two (7 306 objects with `amenity=`, 14 910 with
// the key), which is why a card that quoted "17 579" could not be
// reproduced by either: it was never one formula.
//
// A closed way is one object. `osmium export` hands it out twice (CAMP-253),
// as `w123` and `a246`. The kinds in CANONICAL_REF_KINDS are folded to one
// row per object by `canonicalRefSql`; the other six are left as they were
// written, because `fuel_station_prices.osm_ref` is keyed on the fuel rows
// among them and re-keying is a decision with a cost (see
// buildRoutePoiInsertSql).
//
// 🔴 `dump` IS FOLDED, WHICH IS WHAT MAKES ITS NUMBER AN OBJECT COUNT.
// Left as written, the live table holds 7 525 `dump` rows and 311 of
// them are the second copy of a closed way (measured 14.10.2026 on
// camptribe_dev: 311 `w` rows each with its `a` twin) — so a formula that
// says "one row per object" beside that count would be a label and not a
// description. Nothing is keyed on a dump row (`fuel_station_prices` joins
// fuel points only), so of the seven kinds it is the one where the fold
// costs nothing and the number stops being a label.

/**
 * The one sentence the `dump` row count is the answer to. The loader
 * prints it next to the number, so the number never travels without its
 * formula.
 */
export const DUMP_FORMULA =
  'amenity=sanitary_dump_station on a node or a way, one row per OSM ' +
  'object, access not in private/no/employees/permit, inside the EU-27';

/**
 * The kinds CAMP-119 added: the ones whose rows carry facility states a
 * page prints. A subset of ROUTE_POI_KINDS, named because the page, the
 * API mapping and the loader all need to ask "is this a stopping place".
 *
 * 🔴 The facility columns are on EVERY row — the loader writes them for
 * every kind — and a page prints them for THESE TWO ONLY, because the
 * same words mean different things. `toilets=yes` on a rest area is the
 * reason the place exists; on a fuel station or a supermarket it is a
 * customer toilet, which is a different claim and one the card did not
 * ask us to make. `fee` on a `dump` row is meaningful and is not asked
 * for either; it is the obvious next kind to add here, and a deliberate
 * omission rather than an oversight.
 */
export const REST_STOP_KINDS = ['rest_area', 'service_area'] as const;

export type RestStopKind = (typeof REST_STOP_KINDS)[number];

export function isRestStopKind(value: unknown): value is RestStopKind {
  return (
    typeof value === 'string' &&
    (REST_STOP_KINDS as readonly string[]).includes(value)
  );
}

/**
 * 🔴 The kinds whose rows are keyed on the CANONICAL object id — `w123`,
 * `r456` — and so hold one row per OSM object. `dump` is here although it
 * is older than this card: see the note above on why it is the one
 * legacy kind that can be folded for free.
 */
export const CANONICAL_REF_KINDS = [
  'dump',
  'rest_area',
  'service_area',
] as const;

/**
 * Everything the table can hold. Order is the CASE's order: legacy first.
 *
 * 🔴 TODAY THIS IS THE SAME LIST AS ROUTE_POI_KINDS, and it is kept as a
 * name of its own because it answers a different question: what the
 * LOADER classifies and must find at least one row of, against what a
 * PAGE shows. The day a kind is stored and not shown (`amenity=parking`,
 * which a comment above declines for now) this is where it goes, and
 * nothing that reads either list has to change its mind.
 */
export const STORED_POI_KINDS = ROUTE_POI_KINDS;

export type StoredPoiKind = (typeof STORED_POI_KINDS)[number];

/** Every kind's rules. The loader classifies with this. */
export const STORED_POI_RULES: Record<StoredPoiKind, TagRule[]> =
  ROUTE_POI_RULES;

/**
 * `access` values that mean "not you".
 *
 * `customers` and `permissive` are deliberately absent: a supermarket
 * car park is customers-only and a driver buying groceries is a customer.
 */
export const ACCESS_EXCLUDED = ['private', 'no', 'employees', 'permit'];

/**
 * 🔴 WHETHER AN `access` VALUE KEEPS THE PLACE OUT — THE ONE RULE THE
 * LOADER'S FILTER, THE `access` COLUMN AND THE RAW-EXTRACT COUNTER ALL
 * USE (CAMP-119 review, defect 3; the SQL twin is `tagPartsSql`).
 *
 * The filter used to compare the RAW tag to the list while the column was
 * written as `lower(btrim(...))`. `access='Private'` was published, and
 * the column beside it read `private`; the canonical `'private'` was
 * rejected correctly, which is why nothing looked wrong on canonical data.
 * And `count-rest-stops.mjs` normalised before the same list — so the
 * oracle counted a rule the loader did not apply. Now all three read the
 * value through `tagParts`: blanks off, ASCII letters folded, split on `;`.
 *
 * 🔴 A LIST IS EXCLUDED WHEN ANY PART OF IT IS. `access=private;customers`
 * means somebody said "private" about this place, and the part that follows
 * cannot unsay it. Measured 14.10.2026 on the staging table of
 * camptribe_dev (2 285 391 rows, 123 477 with an `access`): 9 rows carry a
 * `;` list, and 5 of them name an excluded word — `private;customers`,
 * `customers;private`, `delivery;private`, `no;yes`, `students;employees`.
 * Two of those five are rows of `osm_route_poi` today (a charging station
 * tagged `no;yes`, and the "Restaurant Universitaire de Kergoat", a
 * university canteen, tagged `students;employees` — not a place a
 * stranger eats); the other three carry no classifying tag in that old
 * staging (it has no `highway` column) and say nothing about what they
 * are until the CAMP-119 export is loaded. The other four rows
 * (`customers;visitors;members`) name nothing excluded and stay. Run
 * through the old filter and the new one, the staging table passes
 * 2 274 129 rows and 2 274 124: exactly those five, and none the other way.
 *
 * Why "any" and not "every part": a wrong "published" sends a driver to a
 * barrier and puts a private place on a public page; a wrong "kept out"
 * costs one stop among 2.2 million. `countrySql` took the same side for
 * the same reason — "when we cannot tell, we do not publish it". Reading a
 * list as excluded only when EVERY part is would publish the canteen,
 * because `students` alone is not on the list.
 */
export function isAccessExcluded(
  raw: string | null | undefined,
  excluded: readonly string[] = ACCESS_EXCLUDED,
): boolean {
  return tagParts(raw).some((part) => excluded.includes(part));
}

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

  // 🔴 Every STORED kind, legacy ones first. A CASE returns its first
  // match, so an object tagged both `amenity=fuel` and `highway=services`
  // stays the fuel station it was before CAMP-119 and its row — and the
  // price keyed on it — does not move.
  const branches = STORED_POI_KINDS.map((kind) => {
    const tests = STORED_POI_RULES[kind].map(
      (rule) => `${alias}.${rule.key} IN (${rule.values.map(safe).join(', ')})`,
    );
    return `WHEN ${tests.join(' OR ')} THEN '${kind}'`;
  });

  return `CASE ${branches.join(' ')} END`;
}
