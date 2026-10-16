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

import { tagParts, tagPartsSql } from './route-poi-facilities';

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
  /**
   * The values that count — each read as an ELEMENT of the tag.
   *
   * 🔴 CAMP-327: EVERY RULE READS ITS KEY AS A `;` LIST, AND ANY ELEMENT
   * COUNTS. THERE IS NO OTHER READING, SO THERE IS NO FLAG FOR IT.
   *
   * OpenStreetMap writes several values for one key as `a;b`:
   * `amenity=restaurant;ice_cream`, `shop=convenience;gas`,
   * `tourism=hotel;camp_site`. A rule that compares the whole tag
   * (`amenity IN ('restaurant')`) misses every such object, and the tag
   * filter the pipeline hands osmium was the same equality, so the object
   * never reached staging at all. CAMP-258 found this for `shop=gas`, where it
   * cost the gas layer a third of its objects, and fixed it for that one rule
   * with a flag, `list`, because reading EVERY rule that way moves rows that
   * exist from one kind to another and that was a decision with a cost. This
   * card is that decision (numbers in the PR; the rule is one line: a kind is
   * the FIRST branch of the CASE that matches, whichever way the tag was
   * written, so a hotel with `amenity=restaurant;bar` is food exactly as a
   * hotel with `amenity=restaurant` already was).
   *
   * Read as the elements of the tag split on `;`, blanks off and ASCII
   * letters folded — `tagPartsSql`, the reading `access` already has. Not a
   * substring (`internet_cafe` is not a cafe), not a `,` list
   * (`camp_site,caravan_site`), not a value that holds `key=value` itself.
   * The loader refuses those three on purpose and counts what it refused
   * (see LIST_RULES_SUMMARY_SQL).
   */
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
 * legacy kind that can be folded for free. `gas_exchange` (CAMP-258) is
 * here because it is NEW: no price and no page is keyed on its rows, so
 * there is nothing a fold could move, and its count is then a count of
 * objects — the thing a card quotes it as.
 */
export const CANONICAL_REF_KINDS = [
  'dump',
  'rest_area',
  'service_area',
  'gas_exchange',
] as const;

/**
 * 🔴 CAMP-258: KINDS THE TABLE HOLDS AND NO PAGE ASKS FOR — YET.
 *
 * `gas_exchange` is `shop=gas`: a shop that sells and swaps bottled gas.
 * It is stored and not served, the way `rest_area` and `service_area` were
 * for the first half of CAMP-119 (PR #234), and for the same reason: a kind
 * in ROUTE_POI_KINDS changes three things at once — `parseKinds` defaults
 * to every kind in it, `buildServicesSql` writes one index scan per kind
 * into the stage query, and MAX_SERVICE_POINTS is derived from its length
 * so the ODbL floor cannot be crossed. The second half of this work (a
 * point on the map, a mention in the guides) is the card that decides
 * whether the page grows by a tenth kind; this one only makes the data
 * exist and be queryable.
 *
 * 🔴 IT IS LAST IN THE CASE, AND THAT IS NOT A DETAIL. 8 938 distinct
 * objects (nodes and ways) in the 27 extracts say `gas` in their `shop` tag
 * — 6 108 as the whole tag and 2 830 as an element of a `;` list
 * (`convenience;gas`; measured 15.10.2026: `osmium tags-filter -R
 * nwr/shop=*gas*` over every `*.osm.pbf`, parsed and de-duplicated by OSM id).
 * 6 816 of them are ALSO `amenity=fuel` (4 014 + 2 802) — mostly French
 * hypermarket forecourts: Intermarché, Carrefour, E.Leclerc, Super U. A CASE
 * returns its first match, so those stay the fuel stations they were before
 * this card. Putting `gas_exchange` ahead of `fuel` would move them out of
 * `fuel`, and on production the price rows are keyed on the `fuel` row's
 * `osm_ref` with no foreign key to say so (see buildRoutePoiInsertSql).
 *
 * So `gas_exchange` holds the gas shops that are nothing else — 2 114 rows in
 * camptribe_dev. The card's "6 119" is the sum of the whole-tag objects over
 * the extracts (4 019 forecourts + 2 100 others, border duplicates included),
 * and it is itself too small: it was counted with an osmium filter that is
 * the same whole-tag equality as the rule was, so the 2 831 list-valued rows
 * are in neither number.
 *
 * 🔴 WHY THERE IS A KIND AND ALSO A COLUMN, AND WHY NEITHER IS SPARE.
 * The row's `kind` says WHAT THE POINT IS; one object has one kind (the
 * primary key is `osm_ref`), and a forecourt is a fuel station. The column
 * `cylinder_swap` says WHAT CAN BE DONE THERE, and an object can say that
 * about itself whatever kind it ended up with. Without the column, the 6 800
 * forecourts that also say `shop=gas` would lose that fact altogether — they
 * are `fuel`, and `fuel` has nowhere to put it — and a map layer could show
 * 2 114 bottle-swap points where the data holds 8 925 (11 511 rows). Without
 * the KIND, a lone gas shop would be a row of some other kind with a flag,
 * and "what is this point" would have no answer. The layer is therefore
 * `kind = 'gas_exchange' OR cylinder_swap = 'yes'` — and because the flag is
 * derived from the same rule as the kind (rulesTestSql), `gas_exchange`
 * implies `yes`, so `cylinder_swap = 'yes'` alone is the same set. Removing
 * either one as redundant is how three quarters of the points go missing.
 */
export const STORED_ONLY_KINDS = ['gas_exchange'] as const;

/**
 * Everything the table can hold. Order is the CASE's order: legacy first,
 * then CAMP-119's two, then what is stored and not shown.
 *
 * 🔴 It answers a different question from ROUTE_POI_KINDS — what the
 * LOADER classifies and must find at least one row of, against what a PAGE
 * shows — and since CAMP-258 the two lists differ by `gas_exchange`.
 * Everything that asked "is this a kind the table holds" (the loader's
 * empty-kind check, the CASE, the tag-list spec, the index spec) reads this
 * one; everything that asked "is this a kind a page may request" still reads
 * ROUTE_POI_KINDS and is unchanged.
 */
export const STORED_POI_KINDS = [
  ...ROUTE_POI_KINDS,
  ...STORED_ONLY_KINDS,
] as const;

export type StoredPoiKind = (typeof STORED_POI_KINDS)[number];

/** Every kind's rules. The loader classifies with this. */
export const STORED_POI_RULES: Record<StoredPoiKind, TagRule[]> = {
  ...ROUTE_POI_RULES,
  // CAMP-258. `gas` among the elements of `shop`, and nothing else:
  // `amenity=fuel` objects that also carry it are classified `fuel` before
  // this branch is reached — and, since CAMP-327, `shop=convenience;gas` is a
  // `groceries`: every rule reads lists, and `groceries` comes first. 17 of the
  // 2 114 gas_exchange objects moved there on the full reload of 16.10.2026
  // (2 097 stay); the flag `cylinder_swap` kept all 17 in the gas layer, which
  // is the reason it exists: the layer was 8 925 objects before and after.
  gas_exchange: [{ key: 'shop', values: ['gas'] }],
};

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
  // 🔴 Every STORED kind, legacy ones first. A CASE returns its first
  // match, so an object tagged both `amenity=fuel` and `highway=services`
  // stays the fuel station it was before CAMP-119 and its row — and the
  // price keyed on it — does not move.
  const branches = STORED_POI_KINDS.map(
    (kind) =>
      `WHEN ${rulesTestSql(STORED_POI_RULES[kind], alias)} THEN '${kind}'`,
  );

  return `CASE ${branches.join(' ')} END`;
}

/**
 * One kind's rules as a SQL predicate over a staging row — the elements of
 * the tag against the values, joined with OR. Shared between the CASE that
 * picks an object's KIND and the `cylinder_swap` flag (CAMP-258), which asks
 * the same question of the same rule without being the first match — so the
 * two cannot disagree about what counts as a gas shop.
 *
 * 🔴 CAMP-327: AN ELEMENT OF THE `;` LIST FOR EVERY RULE. NULL for a NULL tag,
 * which a CASE reads as not-matched.
 */
export function rulesTestSql(rules: readonly TagRule[], alias = 's'): string {
  return rules
    .map(
      (rule) =>
        `${tagPartsSql(`${alias}."${rule.key}"`)} && ${arraySql(rule.values)}`,
    )
    .join(' OR ');
}

/** A closed list of plain words as a SQL array — checked, never escaped. */
export function arraySql(values: readonly string[]): string {
  const safe = (v: string) => {
    if (!/^[a-z_]+$/.test(v)) {
      throw new Error(`route-poi: unsafe tag value ${JSON.stringify(v)}`);
    }
    return `'${v}'`;
  };
  return `ARRAY[${values.map(safe).join(', ')}]::text[]`;
}

/**
 * The tag filters osmium has to be given for a rule — `key=*value*`, for
 * EVERY value, because osmium matches the WHOLE value and `amenity=restaurant`
 * selects nothing that says `amenity=restaurant;ice_cream`. The `*` form is a
 * substring match: it also pulls in `amenity=internet_cafe` and
 * `amenity=device_charging_station`, which the classifier then refuses (20 of
 * 69 196 objects in the Austrian extract). A spec compares this with the list
 * in load-route-poi.sh, and the self-test of that script checks that the `*`s
 * reach osmium.
 */
export function osmiumFiltersFor(rule: TagRule): string[] {
  return rule.values.map((v) => `${rule.key}=*${v}*`);
}

/** One row of GAS_LAYER_SUMMARY_SQL: Postgres hands counts back as text. */
export interface GasLayerSummary {
  own_kind: string;
  other_kinds: string;
  missing: string;
  extra: string;
  wide_objects: string;
  wide_only: string;
  layer: string;
  layer_objects: string;
}

/**
 * 🔴 CAMP-258: THE GAS LAYER, CHECKED AGAINST THE TAG — IN BOTH DIRECTIONS,
 * AND WITH A READING WIDER THAN THE RULE'S.
 *
 * The flag `cylinder_swap` exists so the forecourts that also say `shop=gas`
 * (kind `fuel`) stay in the layer. It can go wrong in three ways, all silent —
 * every table of numbers still looks fine:
 *
 *   · `missing`: an object that says `gas` in `shop` and whose row does not say
 *     yes. Written for the kind only, this is 5 000 forecourts: the layer is a
 *     third short, all the `gas_exchange` points still say yes.
 *   · `extra`: a row that says yes and that no staged `gas` explains. A flag
 *     built from the wrong rule (the dump rule; gas_exchange plus groceries)
 *     puts supermarkets in a layer of gas shops.
 *   · `wide_only`: objects whose `shop` mentions `gas` and that the rule does
 *     not mark. THIS is the one the first two cannot see, because they read the
 *     tag the same way the rule does: `shop` is a `;` list, `convenience;gas`
 *     was 2 804 objects (3 755 rows) the rule's equality walked past, and the
 *     guard said `missing = 0` over a layer short by a third.
 *
 * `missing` and `extra` are code, and fail at any count. `wide_only` is data:
 * a handful of oddly written values must cost those records and not the run:
 * measured 15.10.2026 on the 27 raw extracts, 7 of 8 945 objects mention `gas`
 * as a word in `shop` without having it as a list element (`gas_bottle`,
 * `gas bottle shop`, `industrial_gas`, `fuel & liquid gas`, `gas station`…) and
 * 6 more contain it only inside another word (`magasin_…`, `gasvending=fuel`). So it is reported (the loader prints it) and fails only when it is
 * SYSTEMATIC: at least GAS_WIDE_MIN_OBJECTS objects AND more than
 * GAS_WIDE_MAX_PERCENT of the objects that mention gas. The rule read as an
 * equality would have been 2 804 of 8 912, 31% (staging); today it is 7 of
 * 8 945, under 0.1%.
 *
 * Both counts come from GAS_LAYER_SUMMARY_SQL, which reads the staging table's
 * `shop` by its own two implementations — see the note there.
 *
 * Returns the failure message, or null.
 */
export const GAS_WIDE_MIN_OBJECTS = 10;
export const GAS_WIDE_MAX_PERCENT = 1;

export function gasLayerError(s: GasLayerSummary): string | null {
  const missing = Number(s.missing);
  const extra = Number(s.extra);
  const wide = Number(s.wide_objects);
  const wideOnly = Number(s.wide_only);
  if (missing > 0) {
    return (
      `${missing} rows of objects that say shop=gas do not say ` +
      `cylinder_swap=yes — the gas layer has lost them (the flag is written ` +
      `for one kind only, or from another rule than shop=gas).`
    );
  }
  if (extra > 0) {
    return (
      `${extra} rows say cylinder_swap=yes and no staged object says ` +
      `shop=gas — the flag is written from another rule than shop=gas, and ` +
      `the gas layer holds things that are not gas shops.`
    );
  }
  if (
    wideOnly >= GAS_WIDE_MIN_OBJECTS &&
    wideOnly * 100 > wide * GAS_WIDE_MAX_PERCENT
  ) {
    return (
      `${wideOnly} of ${wide} staged objects mention gas as a word in shop ` +
      `and the rule does not mark them — the rule reads shop more narrowly ` +
      `than OpenStreetMap writes it (a ';' list, a ',' list, another case).`
    );
  }
  return null;
}

/**
 * One row of LIST_RULES_SUMMARY_SQL, one per stored kind. Postgres hands
 * counts back as text.
 */
export interface ListRulesSummary {
  kind: string;
  listed: string;
  missed: string;
  extra: string;
  wide_objects: string;
  wide_only: string;
}

/**
 * The same two thresholds as the gas guard's, for the same reason, and kept
 * as their own constants: the two guards answer different questions and may
 * need to move apart.
 */
export const LIST_WIDE_MIN_OBJECTS = 10;
export const LIST_WIDE_MAX_PERCENT = 1;

/**
 * 🔴 CAMP-327: EVERY KIND'S RULE, CHECKED AGAINST THE TAG — WITH A READING
 * THAT IS NOT THE RULE'S, ON THE OBJECTS STAGING HOLDS.
 *
 * The gas guard (gasLayerError) checks one rule and one flag. This is the
 * same idea for all ten kinds, and it answers three questions per kind, each
 * from LIST_RULES_SUMMARY_SQL, which reads the staged tags by two readings of
 * its own (see the note there):
 *
 *   · `missed`  (code, fails at any count): staged objects that say one of the
 *     kind's words as an ELEMENT of its tag and that the CASE gave NO kind at
 *     all. This is the rule read as an equality: `amenity=restaurant;ice_cream`
 *     was 9 of 30 such objects in the Austrian extract, and every other check
 *     in this file is silent about them, because none of them has a row.
 *   · `extra`   (code, fails at any count): objects the CASE made this kind
 *     although none of its tags holds one of its words as an element — a rule
 *     broadened to a substring (`internet_cafe` a cafe), or pointed at the
 *     wrong key. The twin of `missed`, and the one that makes the substring
 *     filter safe: osmium is asked for `*cafe*`, the classifier must refuse it.
 *   · `wide_only` (data, thresholded): objects whose tag mentions a word of
 *     the kind as a WORD — between any characters that are not letters,
 *     digits or `_` — and that the element reading does not take:
 *     `restaurant,cafe` with a comma, `bar / cafe`, `cafe restaurant`. (A longer
 *     word is not a mention: `internet_cafe` is its own value.) A handful is
 *     data and costs those records, never the run; it fails only when
 *     SYSTEMATIC: at least LIST_WIDE_MIN_OBJECTS objects AND more than
 *     LIST_WIDE_MAX_PERCENT of the objects the kind's words are mentioned in.
 *
 * A kind with no row is a kind nobody checked, and that reads exactly like a
 * kind that passed: it is an error too.
 *
 * Returns the failure message, or null.
 */
export function listRulesError(
  rows: readonly ListRulesSummary[],
  kinds: readonly string[] = STORED_POI_KINDS,
): string | null {
  const problems: string[] = [];
  for (const kind of kinds) {
    const r = rows.find((row) => row.kind === kind);
    if (r === undefined) {
      problems.push(`no row for kind ${kind} — it was not checked`);
      continue;
    }
    const missed = Number(r.missed);
    const extra = Number(r.extra);
    const wide = Number(r.wide_objects);
    const wideOnly = Number(r.wide_only);
    if (missed > 0) {
      problems.push(
        `${kind}: ${missed} staged objects say its words as an element of a ';' ` +
          `list and the rule gave them no kind — the rule reads the tag more ` +
          `narrowly than OpenStreetMap writes it (the whole value, not its elements)`,
      );
    }
    if (extra > 0) {
      problems.push(
        `${kind}: ${extra} objects were made ${kind} although no element of ` +
          `their tags is one of its words — the rule reads more than a ';' ` +
          `element (a substring? the wrong key?)`,
      );
    }
    if (
      wideOnly >= LIST_WIDE_MIN_OBJECTS &&
      wideOnly * 100 > wide * LIST_WIDE_MAX_PERCENT
    ) {
      problems.push(
        `${kind}: ${wideOnly} of ${wide} staged objects mention its words and ` +
          `the rule does not take them — a systematic spelling the rule does ` +
          `not read (a ',' list, another case, a space)`,
      );
    }
  }
  return problems.length === 0 ? null : problems.join('; ');
}
