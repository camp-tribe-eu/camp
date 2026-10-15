import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildServicesSql,
  FACILITY_FIELDS,
  facilitiesFromRow,
  FUEL_PRICE_SUBQUERY,
  MAX_SERVICE_POINTS,
  MAX_SERVICES_TOTAL,
  ODBL_SUBSTANTIAL_FLOOR,
  parseKinds,
  readFacilityState,
  rowToRouteService,
  servicesOverfetch,
  WATER_BOX_METRES,
  WATER_CHECKED_KIND,
  WATER_NEAR_DUMP_RADIUS_M,
  WATER_NEAR_SUBQUERY,
  waterBoxSql,
  waterNearField,
} from './route-services';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { TRISTATE_COLUMNS } from '../osm/route-poi-facilities';
import { DEFAULT_PER_POINT, MAX_POINTS } from './route-points';
import { SOURCES } from '../fuel/stations';
import {
  ACCESS_EXCLUDED,
  classifyCaseSql,
  REST_STOP_KINDS,
  ROUTE_POI_KINDS,
  ROUTE_POI_RULES,
  SERVICES_PER_KIND,
  STORED_POI_KINDS,
  STORED_POI_RULES,
} from '../osm/route-poi';

// CAMP-113 — the rules of the services endpoint, checked without a
// database.
//
// 🔴 Three things are defended here, and none of them is "PostGIS
// measures distance correctly". They are the three that would be
// invisible until they had already done damage: a query that stops using
// its index, a kind that exists in one place and not the others, and a
// page that quietly grows past the object count its own licence note
// claims.

describe('the kinds a caller may ask for', () => {
  it('defaults to all of them', () => {
    expect(parseKinds(undefined)).toEqual([...ROUTE_POI_KINDS]);
    expect(parseKinds('')).toEqual([...ROUTE_POI_KINDS]);
  });

  it('keeps the ones we hold, in our own order', () => {
    expect(parseKinds('food,fuel')).toEqual(['fuel', 'food']);
  });

  // 🔴 A typo must not look like "this stop has no services". An empty
  // list renders seven "we hold none within 25 km" lines, which is a
  // statement about the ground, and it would be false.
  it('falls back to everything when nothing recognisable was asked for', () => {
    expect(parseKinds('petrol,ev')).toEqual([...ROUTE_POI_KINDS]);
    expect(parseKinds(42)).toEqual([...ROUTE_POI_KINDS]);
    expect(parseKinds(['fuel'])).toEqual([...ROUTE_POI_KINDS]);
  });

  // 🔴 THE ONE THAT MATTERS. The kind is written into the SQL as a
  // literal, because a partial index cannot be proven usable against a
  // parameter — measured, 9 699 ms against 8 ms for one route page. A
  // literal in SQL is only safe while it can only come from this list.
  it('never lets an unknown kind reach the SQL', () => {
    expect(parseKinds("fuel'; DROP TABLE camping_spots; --")).toEqual([
      ...ROUTE_POI_KINDS,
    ]);
    expect(() =>
      // Cast, because this is the call the type system already refuses;
      // the guard exists for the day somebody widens the signature.
      buildServicesSql(['fuel', "x'--"] as never),
    ).toThrow(/unknown kind/);
  });

  // 🔴 `cand AS ()` is a syntax error, and it would arrive as a 500 from
  // a route page during the build rather than as the mistake it is.
  it('refuses to build a query for no kinds at all', () => {
    expect(() => buildServicesSql([])).toThrow(/no kinds/);
  });
});

// 🔴 Every test below was written against a MUTATION and shown to turn
// red on it. Review demonstrated four that the first version of this
// file let through green — `LIMIT $3 → LIMIT 1`, `ORDER BY kind, metres
// → kind, osm_ref`, deleting `WHERE metres <= $4`, and labelling every
// block 'fuel'. A SQL builder is exactly the kind of code where a test
// that merely calls the function proves nothing.
describe('the SQL a stage runs', () => {
  const sql = buildServicesSql([...ROUTE_POI_KINDS]);
  // One block per kind, split on the UNION the builder joins them with.
  const blocks = sql
    .slice(sql.indexOf('cand AS ('), sql.indexOf('measured AS ('))
    .split('UNION ALL');

  it('names every kind as a literal, so each block can use its index', () => {
    for (const kind of ROUTE_POI_KINDS) {
      expect(sql).toContain(`WHERE r.kind = '${kind}'`);
    }
  });

  // 🔴 MUTATION: label every block 'fuel'. Each block's own label and
  // its WHERE must agree, or a charging point is served up as fuel.
  it('labels each block with the kind that block actually selects', () => {
    expect(blocks).toHaveLength(ROUTE_POI_KINDS.length);
    for (const block of blocks) {
      // 🔴 `[a-z_]+`, and the underscore is CAMP-119's: `rest_area` is two
      // words, and `[a-z]+` read it as nothing — which this test reports
      // as a missing label rather than as a regex that cannot see it.
      const label = /SELECT '([a-z_]+)'::text AS kind/.exec(block)?.[1];
      const where = /WHERE r\.kind = '([a-z_]+)'/.exec(block)?.[1];
      expect(label).toBeTruthy();
      expect(label).toBe(where);
    }
    // …and between them they cover every kind exactly once.
    const labels = blocks.map(
      (b) => /SELECT '([a-z_]+)'::text AS kind/.exec(b)?.[1],
    );
    expect(labels.sort()).toEqual([...ROUTE_POI_KINDS].sort());
  });

  it('orders by the KNN operator, which is what the GiST index answers', () => {
    // `<->` is the whole reason this is milliseconds. An ST_DWithin form
    // over a geography cast cannot use the index and took over two
    // minutes for the same points when routes.near() was written.
    expect(sql).toContain('<->');
    // 🔴 The ban is on the CANDIDATE WALK — the `cand` blocks the sentence
    // above is about — and no longer on the whole statement. CAMP-254's
    // `water_near_m` is the one place ST_DWithin is allowed, because it
    // runs once per stage on the single picked row and carries its own
    // `&&` prefilter on the partial index; its guards are the CAMP-254
    // block below and the plan check in route-services.db.spec.ts. Were it
    // to appear inside a block, every stage would be a 230 431-row cast.
    for (const block of blocks) expect(block).not.toMatch(/ST_DWithin/i);
  });

  // 🔴 MUTATION: `LIMIT $3` → `LIMIT 1`. That deletes the overfetch this
  // file's own comment spends a paragraph defending, and the symptom is
  // a list printed out of the order it claims — at Nordic latitudes,
  // where a degree of longitude is half what it is at the equator.
  it('every block takes the overfetch parameter, not a fixed one', () => {
    for (const block of blocks) {
      expect(block).toContain('LIMIT $3');
      expect(block).not.toMatch(/LIMIT \d/);
    }
    expect(servicesOverfetch(SERVICES_PER_KIND)).toBeGreaterThan(
      SERVICES_PER_KIND,
    );
  });

  // 🔴 MUTATION: `ORDER BY kind, metres` → `kind, osm_ref`. Still one row
  // per kind, still plausible, and no longer the nearest one.
  //
  // 🔴 The anchor used to be `\s*$` — this ORDER BY was the last thing
  // in the query. CAMP-154 wrapped the selection in a `picked` CTE so a
  // price could be attached to the chosen row, and that moved it off
  // the end. Re-anchoring on the CTE keeps the assertion about the
  // thing it was always about (the DISTINCT ON and its ORDER BY are the
  // same statement, so the nearest wins) rather than about where the
  // string happens to stop.
  it('picks the NEAREST of each kind, not an arbitrary one', () => {
    const picked = sql.slice(sql.indexOf('picked AS ('));
    expect(picked).toContain('DISTINCT ON (kind)');
    expect(picked).toMatch(/ORDER BY kind, metres\s*\)/);
  });

  // 🔴 MUTATION: delete `WHERE metres <= $4`. The radius disappears and
  // the page's own "within 25 km" sentence becomes false — the nearest
  // dump station in Lapland is 300 km away and would be printed.
  it('applies the radius the caller asked for', () => {
    expect(sql).toContain('WHERE metres <= $4');
  });

  it('asks for one of each kind and no more', () => {
    expect(SERVICES_PER_KIND).toBe(1);
  });
});

// 🔴 The ODbL boundary, as arithmetic rather than as a comment.
//
// A route page is a Produced Work under §4.5(a) because it shows a
// handful of objects chosen on our own criteria. Our own note draws the
// line at "fewer than 100 objects", and the campsites already take 28 of
// them on the longest route. This is the test that fails the day
// somebody adds an eighth kind or raises SERVICES_PER_KIND to 2.
describe('🔴 the caps that keep a route page a Produced Work', () => {
  // 🔴 The API's OWN ceiling, not today's longest route.
  //
  // This said `LONGEST_ROUTE_STAGES = 7`, which is a fact about the
  // twelve routes in the repository rather than about what the endpoint
  // will answer. A nine-stage route passed this spec and the web one and
  // then silently lost its ninth stage to the total cap. The per-route
  // arithmetic belongs in the web suite, which can see the real routes;
  // what belongs here is the worst case the API itself permits.
  it('the worst page the API permits cannot reach the Substantial floor', () => {
    // 🔴 Per STAGE, because that is how a page grows: 4 campsites plus
    // one of each service kind. The old form multiplied a hard-coded 7
    // stages and so never noticed that the real ceiling is nine.
    const perStage = DEFAULT_PER_POINT + ROUTE_POI_KINDS.length;
    expect(MAX_SERVICE_POINTS * perStage).toBeLessThan(ODBL_SUBSTANTIAL_FLOOR);
  });

  // …and it is the LARGEST number that satisfies that, so the cap is
  // derived rather than picked conservatively and forgotten.
  it('allows as many stages as the floor actually permits', () => {
    const perStage = DEFAULT_PER_POINT + ROUTE_POI_KINDS.length;
    expect((MAX_SERVICE_POINTS + 1) * perStage).toBeGreaterThanOrEqual(
      ODBL_SUBSTANTIAL_FLOOR,
    );
  });

  // 🔴 The points parser will hand us up to MAX_POINTS. The services
  // endpoint must cap tighter than that, or the ODbL arithmetic above is
  // about a number nothing enforces.
  it('caps stages tighter than the points parser does', () => {
    expect(MAX_SERVICE_POINTS).toBeLessThan(MAX_POINTS);
  });

  // 🔴 THE CAP MUST NOT BE ABLE TO BIND ON AN ACCEPTED REQUEST.
  //
  // It was 56 against an askable 84, and past stage 8 it dropped whole
  // kinds — alphabetically last, so shelter and water first — leaving
  // the page to print "our database holds no hotel… within 25 km" about
  // stops nothing had looked at. The old test asserted the opposite of
  // this and passed, because it compared against a hard-coded
  // LONGEST_ROUTE_STAGES = 7 rather than against the API's own ceiling:
  // a nine-stage route satisfied both this spec and the web one (36 + 63
  // = 99 < 100) and then tripped the cap at stage 9.
  it('cannot truncate a request the API has already accepted', () => {
    const askable =
      MAX_SERVICE_POINTS * ROUTE_POI_KINDS.length * SERVICES_PER_KIND;
    expect(MAX_SERVICES_TOTAL).toBeGreaterThanOrEqual(askable);
  });

  // …while still staying inside the floor the licence note claims.
  it('still cannot assemble a Substantial extract', () => {
    expect(MAX_SERVICES_TOTAL).toBeLessThan(ODBL_SUBSTANTIAL_FLOOR);
  });

  // The number is derived from the two caps rather than typed, so it
  // cannot drift away from them.
  it('is the arithmetic ceiling, not a number somebody chose', () => {
    expect(MAX_SERVICES_TOTAL).toBe(
      MAX_SERVICE_POINTS * ROUTE_POI_KINDS.length * SERVICES_PER_KIND,
    );
  });
});

describe('the tag rules behind each kind', () => {
  it('gives every kind at least one rule', () => {
    for (const kind of ROUTE_POI_KINDS) {
      expect(ROUTE_POI_RULES[kind].length).toBeGreaterThan(0);
      for (const rule of ROUTE_POI_RULES[kind]) {
        expect(rule.values.length).toBeGreaterThan(0);
      }
    }
  });

  // 🔴 A tag claimed by two kinds would put the same object under two
  // headings at the same stop, and which one won would depend on the
  // order of a CASE expression nobody reads.
  it('never lets two kinds claim the same tag', () => {
    const tags = STORED_POI_KINDS.flatMap((kind) =>
      STORED_POI_RULES[kind].flatMap((rule) =>
        rule.values.map((v) => `${rule.key}=${v}`),
      ),
    );
    // 🔴 Jest's `expect` takes ONE argument and throws on a second, so
    // the explanation goes in the value rather than in a message the
    // way the Playwright suites write it.
    expect(tags.filter((t, i) => tags.indexOf(t) !== i)).toEqual([]);
  });

  // 🔴 The two lists that cannot be checked from a page. A tag filtered
  // by the shell script and not classified here is a wasted row; a tag
  // classified here and not filtered there is a kind that silently holds
  // nothing, which reads exactly like an honest gap. The loader refuses
  // an empty kind at import time; this catches it at commit time.
  it('matches the tag list the pipeline actually filters for', () => {
    const script = readFileSync(
      join(__dirname, '../../../../scripts/osm-pipeline/load-route-poi.sh'),
      'utf8',
    );
    const filtered = new Set(
      [...script.matchAll(/^\s{2}([a-z_]+=[a-z_]+)$/gm)].map((m) => m[1]),
    );
    // 🔴 CAMP-119: every STORED kind, not only the ones a page shows. The
    // two lists this guards are the shell's FILTERS and what the loader
    // classifies, and the loader now classifies the stopping places too.
    const classified = new Set(
      STORED_POI_KINDS.flatMap((kind) =>
        STORED_POI_RULES[kind].flatMap((rule) =>
          rule.values.map((v) => `${rule.key}=${v}`),
        ),
      ),
    );
    expect([...classified].sort()).toEqual([...filtered].sort());
  });

  it('builds a CASE that names every kind', () => {
    const sql = classifyCaseSql('s');
    for (const kind of STORED_POI_KINDS)
      expect(sql).toContain(`THEN '${kind}'`);
    expect(sql.startsWith('CASE ')).toBe(true);
  });

  // 🔴 CAMP-119. A CASE returns its FIRST match, so the order of the
  // branches is a decision: an object tagged both `amenity=fuel` and
  // `highway=services` is the fuel station it was before this card, and
  // its row — and the price keyed on it — does not move.
  it('tries the kinds that existed before the stopping places first', () => {
    const sql = classifyCaseSql('s');
    // 🔴 The seven, and not "every kind but the new two" computed from
    // REST_STOP_KINDS: if the list those are subtracted from were wrong,
    // so would the subtraction be. Written out, the way the test above
    // this block writes the page's own list out.
    const legacy = [
      'fuel',
      'charging',
      'water',
      'dump',
      'groceries',
      'food',
      'shelter',
    ];
    expect(ROUTE_POI_KINDS.slice(0, legacy.length)).toEqual(legacy);
    for (const rest of REST_STOP_KINDS) {
      for (const before of legacy) {
        expect(sql.indexOf(`THEN '${before}'`)).toBeLessThan(
          sql.indexOf(`THEN '${rest}'`),
        );
      }
    }
  });

  it('refuses a tag value it cannot safely quote', () => {
    const original = ROUTE_POI_RULES.fuel[0].values.slice();
    ROUTE_POI_RULES.fuel[0].values = ["fuel'; DROP TABLE camping_spots; --"];
    try {
      expect(() => classifyCaseSql('s')).toThrow(/unsafe tag value/);
    } finally {
      ROUTE_POI_RULES.fuel[0].values = original;
    }
  });

  it('excludes the access values that mean "not you"', () => {
    expect(ACCESS_EXCLUDED).toContain('private');
    // 🔴 `customers` must NOT be excluded: a supermarket car park is
    // customers-only and a driver buying food is a customer. Dropping
    // them would delete a chunk of the groceries layer for a word.
    expect(ACCESS_EXCLUDED).not.toContain('customers');
    expect(ACCESS_EXCLUDED).not.toContain('permissive');
  });
});

// 🔴 CAMP-119: THE STOPPING PLACES ARE ON THE ROUTE PAGE, AND THIS IS THE
// TEST THAT WAS RIGHT UNTIL THEY WERE.
//
// This block used to say "the stopping places stay off the route page",
// and pinned ROUTE_POI_KINDS to its seven. That pin was correct for the
// first half of the card, which loaded 'rest_area' and 'service_area'
// into the table and had no page to show them on; it was also the reason
// the card stayed open after that half merged, because the data reached
// the database and stopped there. Flipped, not deleted: it still pins the
// list, now to the nine the page has to know.
//
// What is asserted instead is what a reader and the licence need from
// that decision, each against the code that carries it.
describe('the stopping places are on the route page', () => {
  it('serves rest_area and service_area, after the seven it always did', () => {
    expect([...ROUTE_POI_KINDS]).toEqual([
      'fuel',
      'charging',
      'water',
      'dump',
      'groceries',
      'food',
      'shelter',
      'rest_area',
      'service_area',
    ]);
    // …and they are what the facility mapping treats as stopping places.
    expect([...REST_STOP_KINDS]).toEqual(['rest_area', 'service_area']);
  });

  // 🔴 The two are now ASKED FOR by default: `parseKinds` of nothing is
  // every kind, which is what the web page sends.
  it('asks for them by default, and when they are named', () => {
    expect(parseKinds(undefined)).toContain('rest_area');
    expect(parseKinds(undefined)).toContain('service_area');
    expect(parseKinds('rest_area,service_area')).toEqual([
      'rest_area',
      'service_area',
    ]);
  });

  it('puts one index scan per stopping place into a stage query', () => {
    const sql = buildServicesSql([...REST_STOP_KINDS]);
    for (const kind of REST_STOP_KINDS) {
      // The literal, not a parameter: a partial index cannot be proven
      // usable against `$n` (9 699 ms on one route page, measured).
      expect(sql).toContain(`WHERE r.kind = '${kind}'`);
    }
  });

  // 🔴 The query still refuses a kind that is not on the list. Widening
  // the list did not widen what may reach the SQL.
  it('still refuses a kind it does not hold', () => {
    expect(() => buildServicesSql(['parking' as never])).toThrow(
      /unknown kind/,
    );
  });

  // 🔴 THE LICENCE ARITHMETIC MOVED, AND ON PURPOSE. 4 campsites + 9
  // kinds is 13 objects a stage, so the stages a page may ask about fell
  // from 9 to 7 — the number of stages on the longest route in the
  // library. If this is red somebody changed the kinds or the per-point
  // count; read the ODbL note in route-services.ts before touching it.
  it('lets a page ask about as many stages as the longest route has', () => {
    expect(MAX_SERVICE_POINTS).toBe(7);
    expect(
      MAX_SERVICE_POINTS * (DEFAULT_PER_POINT + ROUTE_POI_KINDS.length),
    ).toBeLessThan(ODBL_SUBSTANTIAL_FLOOR);
  });
});

// 🔴 A kind without its partial index is not an error, it is a
// sequential scan over 2.26 million rows — the failure that does not
// announce itself.
//
// 🔴 WHAT THIS BLOCK DOES AND DOES NOT SEE (CAMP-119 review, D1). It reads
// the migrations' `KINDS` literals off disk and compares them with the
// endpoint's list. That pins two LISTS. It does not see an index: deleting
// the `CREATE INDEX` loop out of `up()` leaves every assertion here green,
// and did — 68 suites, 1 889 tests. The indexes themselves are asserted in
// `route-services.db.spec.ts`, which runs the real `up()`s against
// PostgreSQL and reads `pg_indexes` and the plan of the endpoint's own
// statement. Do not read this block as the guard for them.
//
// 🔴 TWO MIGRATIONS NOW, NOT ONE. The original seven are in
// 1790572800000-RoutePoi.ts and CAMP-119's two are in
// 1791400000000-RoutePoiFacilities.ts. This used to read the first alone
// and compare it with the whole list, which is exactly the comparison
// that goes red the day a kind is added by a later migration — and the
// tempting fix is to loosen it. It is widened to read both instead, and
// stays an EQUALITY: a kind missing from the two lists, or listed that
// nobody asks about, is still a failure.
describe('the migrations’ KINDS lists are the kinds the endpoint serves', () => {
  const declaredIn = (file: string): string[] => {
    const migration = readFileSync(
      join(__dirname, '../migrations', file),
      'utf8',
    );
    const declared = migration.match(
      /static readonly KINDS = \[([\s\S]*?)\] as const/,
    );
    // The explanation goes in the value: Jest's `expect` takes ONE argument.
    expect(declared === null ? `${file} declares no KINDS` : 'declared').toBe(
      'declared',
    );
    // `[a-z_]+`: `rest_area` has an underscore, and `[a-z]+` reads it as
    // nothing — which would shrink the list quietly and not fail.
    return [...(declared?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };

  it('the two migrations between them list every kind the endpoint serves, once', () => {
    const first = declaredIn('1790572800000-RoutePoi.ts');
    const second = declaredIn('1791400000000-RoutePoiFacilities.ts');
    // Anchors: each file contributed, or the equality below is satisfied
    // by one of them being empty and the other being wrong.
    expect(first).toHaveLength(7);
    expect(second).toEqual([...REST_STOP_KINDS]);
    expect([...first, ...second]).toEqual([...ROUTE_POI_KINDS]);
  });
});

// 🔴 CAMP-119 review, D2: the fixture CI loads is `ci-seed.sql`, and the
// rows this block's neighbours describe live in `ci-seed-route-poi.sql`,
// which `regenerate.sh` appends to it verbatim. Two files holding one set of
// rows is one of them out of date the day somebody edits the other — and
// the one CI reads is the one nobody opens. route-services.db.spec.ts loads
// the small file; this is what says the big one is carrying the same text.
describe('the route-POI fixture CI loads is the one the specs read', () => {
  it('ci-seed.sql carries ci-seed-route-poi.sql verbatim', () => {
    const dir = join(__dirname, '../../test/fixtures');
    const part = readFileSync(join(dir, 'ci-seed-route-poi.sql'), 'utf8');
    const whole = readFileSync(join(dir, 'ci-seed.sql'), 'utf8');
    // Anchor: the part is the file with the INSERTs in it, not an empty
    // string — which `includes` finds in anything.
    expect(part).toContain('INSERT INTO osm_route_poi');
    expect(whole.includes(part)).toBe(true);
  });
});

// ── CAMP-154: THE PRICE ON THE FUEL ROW ─────────────────────────────────
//
// 🔴 Three things are asserted, and each of them is a way the query
// could keep working while telling a reader something false.

describe('the per-station price the fuel row carries', () => {
  const sql = buildServicesSql([...ROUTE_POI_KINDS]);

  // 🔴 MUTATION PROVEN: delete `WHERE p.kind = 'fuel'` from
  // FUEL_PRICE_SUBQUERY and this fails. Without it every kind probes
  // fuel_station_prices — six index lookups per stage that exist to
  // return nothing, on a table where one plausible-looking lookup has
  // already cost this project 9 699 ms.
  it('looks up a price for the fuel row and no other kind', () => {
    expect(FUEL_PRICE_SUBQUERY).toContain("p.kind = 'fuel'");
    expect(sql).toContain('AS prices');
  });

  // 🔴 MUTATION PROVEN: change `f.price_eur::text` to `f.price_eur` and
  // this fails. `json_build_object` on a numeric emits an unquoted JSON
  // number; `JSON.parse` turns it into a float; the page then prints
  // whatever the float says. The column is numeric(6,3) precisely so
  // that nothing between the ministry and the reader has an opinion
  // about the third decimal.
  it('sends the price as text, never as a JSON number', () => {
    expect(FUEL_PRICE_SUBQUERY).toContain("'price', f.price_eur::text");
    expect(FUEL_PRICE_SUBQUERY).not.toMatch(/'price',\s*f\.price_eur\s*[,)]/);
  });

  // 🔴 "Every displayed price carries its measurement date and its
  // source." The page cannot print what the query does not send, so the
  // obligation is enforced at the point the data leaves the database.
  it('cannot send a price without its date and its source', () => {
    expect(FUEL_PRICE_SUBQUERY).toContain("'measuredAt', f.measured_at");
    expect(FUEL_PRICE_SUBQUERY).toContain("'source', f.source");
    expect(FUEL_PRICE_SUBQUERY).toContain("'product', f.product");
  });

  // 🔴 MUTATION PROVEN: drop `ORDER BY f.grade` and this fails. Without
  // it the order is whatever the index returns, so two stages of one
  // route can list diesel and petrol the other way round — which reads
  // as a difference between the stations rather than between the plans.
  it('orders the grades the same way at every stage', () => {
    expect(FUEL_PRICE_SUBQUERY).toContain('ORDER BY f.grade');
  });

  // 🔴 THE REFUSED-COUNTRY GATE LIVES HERE, NOT ONLY IN THE RENDERER.
  //
  // Review found it only in the web app's `displayPrices`, which drops a
  // price whose source has no attribution entry — protecting the route
  // page and nothing else. The API is public: `/routes/services` would
  // have served an Austrian row, for a country where NO CONSUMER LICENCE
  // EXISTS, to any caller. A permission is a property of the data, so
  // the gate belongs where the data leaves.
  it('serves prices only from the three licensed sources', () => {
    expect(FUEL_PRICE_SUBQUERY).toContain('f.source IN (');
    for (const s of SOURCES) {
      expect(FUEL_PRICE_SUBQUERY).toContain(`'${s.id}'`);
    }
  });

  it('cannot serve a country whose licence does not exist', () => {
    // Austria's endpoint is open, unkeyed and unthrottled, which makes
    // it the one most likely to be added in a hurry. An HTTP 200 is not
    // permission.
    expect(FUEL_PRICE_SUBQUERY).not.toMatch(/e-control|spritpreis|'at-/);
    expect(FUEL_PRICE_SUBQUERY).not.toMatch(/dgeg|holtankoljak/);
  });

  // The join is on the OSM ref we just picked, not on a coordinate.
  // Matching is decided once at import time — see fuel/match.ts — and a
  // spatial join here would redo it per page with a different rule.
  it('joins on the OpenStreetMap ref, not on geometry', () => {
    expect(FUEL_PRICE_SUBQUERY).toContain('f.osm_ref = p.osm_ref');
    expect(FUEL_PRICE_SUBQUERY).not.toContain('ST_Distance');
  });
});

// 🔴 The unique index is the invariant that makes a broken matcher a
// FAILED IMPORT rather than a wrong number on a forecourt. Asserted
// against the migration text, because it is the migration that has to
// carry it into every database.
describe('one OSM fuel point cannot carry two stations’ prices', () => {
  it('the migration declares the unique index that enforces it', () => {
    const migration = readFileSync(
      join(__dirname, '../migrations/1790662801000-FuelStationPrices.ts'),
      'utf8',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_station_prices_osm_grade',
    );
    expect(migration).toContain('ON fuel_station_prices (osm_ref, grade)');
    expect(migration).toContain('WHERE osm_ref IS NOT NULL');
  });

  // 🔴 A coverage figure computed from a table that cannot hold the
  // misses is not a measurement. `osm_ref` must stay nullable, so an
  // unmatched station is a row that exists and can be counted.
  it('keeps osm_ref nullable so the unmatched stations are countable', () => {
    const migration = readFileSync(
      join(__dirname, '../migrations/1790662801000-FuelStationPrices.ts'),
      'utf8',
    );
    expect(migration).not.toMatch(/osm_ref\s+text\s+NOT NULL/);
  });
});

// ── CAMP-119: WHAT A STOPPING PLACE SAYS ABOUT ITSELF ───────────────────
//
// 🔴 The rule is the card's own sentence: where OpenStreetMap says a thing
// about a toilet, a shower, a disposal point or a fee, it is shown; where
// it does not, the answer is "not known" — and "not known" is never
// "no". Everything here is about the line between those two.

describe('CAMP-119: the five facilities of a stopping place', () => {
  // 🔴 THE COLUMNS ARE THE MIGRATION'S, NOT A COPY. A column the page
  // shows and the table does not have is a 500 from a route page; a
  // tri-state column the table has and the page does not show is a
  // facility somebody decided about by omission.
  it('are exactly the table’s yes/no/unknown columns', () => {
    const columns = FACILITY_FIELDS.map((f) => f.column);
    expect(columns.sort()).toEqual(
      [...RoutePoiFacilities1791400000000.TRISTATE].sort(),
    );
    expect(columns.sort()).toEqual([...TRISTATE_COLUMNS].sort());
    // …each sent under a key of its own.
    expect(new Set(FACILITY_FIELDS.map((f) => f.key)).size).toBe(5);
  });

  // 🔴 THE QUERY CARRIES THEM, through all three stages it has. A UNION ALL
  // needs the same columns in every block, and `measured` and `picked` are
  // what the row passes through on the way out: leave them off any one of
  // the three and the page gets five `unknown`s that look exactly like a
  // rest area nobody described. The DB spec proves the values arrive; this
  // names the places.
  it('are selected in every block and carried through `measured`', () => {
    const sql = buildServicesSql([...ROUTE_POI_KINDS]);
    const cand = sql.slice(
      sql.indexOf('cand AS ('),
      sql.indexOf('measured AS ('),
    );
    const measured = sql.slice(
      sql.indexOf('measured AS ('),
      sql.indexOf('picked AS ('),
    );
    for (const f of FACILITY_FIELDS) {
      expect(cand.split(`r.${f.column}`)).toHaveLength(
        ROUTE_POI_KINDS.length + 1,
      );
      expect(measured).toContain(`c.${f.column}`);
    }
  });

  describe('readFacilityState', () => {
    it('keeps a written yes and a written no', () => {
      expect(readFacilityState('yes')).toBe('yes');
      expect(readFacilityState('no')).toBe('no');
    });

    // 🔴 MUTATION: make the fall-through `'no'`. The state a reader is
    // told for a gap would flip from "not known" to "no", for every one
    // of these — which is the whole card in one character.
    const GAPS: [unknown, string][] = [
      ['unknown', 'the stored word'],
      [null, 'null'],
      [undefined, 'a column the query did not select'],
      ['', 'an empty string'],
      [' yes', 'a padded yes'],
      ['YES', 'an upper-case yes'],
      ['No', 'a capitalised no'],
      [true, 'a boolean'],
      [0, 'a zero'],
      ['designated', 'an OSM word that is not one of the three'],
    ];
    it.each(GAPS)('reads %p (%s) as not known, never as no', (raw) => {
      expect(readFacilityState(raw)).toBe('unknown');
    });
  });

  // 🔴 FIVE DIFFERENT ANSWERS, so a swap of two columns is a red test.
  // `split().length === 3` was the shape of the check this repository
  // wrote before it learned that a shape is not a value: it passed a
  // column swap and `[object Object]` alike.
  it('maps each column to its own key', () => {
    expect(
      facilitiesFromRow({
        toilets: 'yes',
        shower: 'no',
        drinking_water: 'unknown',
        sanitary_dump_station: 'yes',
        fee: 'no',
        // a column that is not a facility must not leak in
        access: 'customers',
      }),
    ).toEqual({
      toilets: 'yes',
      shower: 'no',
      drinkingWater: 'unknown',
      dumpStation: 'yes',
      fee: 'no',
    });
    expect(
      facilitiesFromRow({
        toilets: 'no',
        shower: 'yes',
        drinking_water: 'yes',
        sanitary_dump_station: 'no',
        fee: 'yes',
      }),
    ).toEqual({
      toilets: 'no',
      shower: 'yes',
      drinkingWater: 'yes',
      dumpStation: 'no',
      fee: 'yes',
    });
  });

  it('says not known for all five when the row says nothing', () => {
    expect(facilitiesFromRow({})).toEqual({
      toilets: 'unknown',
      shower: 'unknown',
      drinkingWater: 'unknown',
      dumpStation: 'unknown',
      fee: 'unknown',
    });
  });
});

describe('CAMP-119: which rows carry the facilities', () => {
  const row = (kind: string, extra: Record<string, unknown> = {}) => ({
    kind,
    osm_ref: 'n1',
    name: null,
    lat: 45,
    lon: 14,
    metres: 1234.4,
    phone: null,
    website: null,
    opening_hours: null,
    toilets: 'yes',
    shower: 'no',
    drinking_water: 'unknown',
    sanitary_dump_station: 'no',
    fee: 'yes',
    ...extra,
  });

  // 🔴 MUTATION: `isRestStopKind(kind)` → `false`. The facility words
  // never reach the page and the card is open again, with every other
  // test in this file green.
  it.each([...REST_STOP_KINDS])('puts all five on a %s', (kind) => {
    expect(rowToRouteService(row(kind)).facilities).toEqual({
      toilets: 'yes',
      shower: 'no',
      drinkingWater: 'unknown',
      dumpStation: 'no',
      fee: 'yes',
    });
  });

  // 🔴 MUTATION: `isRestStopKind(kind)` → `true`. A fuel station would
  // carry five "not known"s, and a supermarket's customer toilet would be
  // published as a statement about the road.
  it.each([
    'fuel',
    'charging',
    'water',
    'dump',
    'groceries',
    'food',
    'shelter',
  ])('puts none on a %s, whatever its columns say', (kind) => {
    expect(rowToRouteService(row(kind))).not.toHaveProperty('facilities');
  });

  // 🔴 A rest area whose columns did not arrive is five "not known", not
  // a missing object: a page cannot tell "no facilities block" from "no
  // facilities", so the block is always there.
  it('gives a rest area with no facility columns five "not known"', () => {
    const bare = row('rest_area');
    for (const f of FACILITY_FIELDS)
      delete (bare as Record<string, unknown>)[f.column];
    expect(rowToRouteService(bare).facilities).toEqual({
      toilets: 'unknown',
      shower: 'unknown',
      drinkingWater: 'unknown',
      dumpStation: 'unknown',
      fee: 'unknown',
    });
  });

  it('keeps what the endpoint always sent, rounded as it always was', () => {
    const s = rowToRouteService(
      row('rest_area', { name: 'Aire de la Palmyre' }),
    );
    expect(s).toMatchObject({
      kind: 'rest_area',
      osmRef: 'n1',
      name: 'Aire de la Palmyre',
      metres: 1234,
      phone: null,
      website: null,
      openingHours: null,
    });
    // a fuel row's price is still only ever on a fuel row
    expect(rowToRouteService(row('rest_area'))).not.toHaveProperty('prices');
  });
});

// ── CAMP-254: DRINKING WATER NEAR THE DISPOSAL POINT ─────────────────────
//
// 🔴 What is defended here is the SHAPE of the statement and of the field.
// What PostgreSQL answers for it — 180 m is 180 m, 800 m is "none", a tap
// that is not a tap does not count — is route-services.db.spec.ts's, and
// that one runs a real PostGIS. Each test below names the mutation it
// answers, because a string test that no edit makes red is decoration.
describe('CAMP-254: the drinking-water subquery', () => {
  const sub = WATER_NEAR_SUBQUERY;
  const sql = buildServicesSql([...ROUTE_POI_KINDS]);

  // 🔴 MUTATION: `geography` → `geometry` on either call. `ST_DWithin(a, b,
  // 500)` on geometry is 500 DEGREES — every point on Earth — and
  // `ST_Distance` on geometry is degrees too. The statement must put the
  // cast on BOTH arguments of BOTH, and it is read argument by argument,
  // not as "the word geography appears somewhere".
  it('measures with geography at both ends, in both calls', () => {
    const calls = [
      ...sub.matchAll(
        /ST_(DWithin|Distance)\(([^;]*?)\)(?=\s*(?:\)|AND|,|$))/g,
      ),
    ];
    // Anchor: both calls were found. A regex that finds nothing must not
    // read as "no call is wrong".
    expect(calls.map((c) => c[1]).sort()).toEqual(['DWithin', 'Distance']);
    // The names go in the value: Jest's `expect` takes ONE argument.
    const notGeography = calls
      .filter(([, , args]) =>
        args
          .split(',')
          .slice(0, 2)
          .some((a) => !a.trim().endsWith('::geography')),
      )
      .map(([call]) => call);
    expect(notGeography).toEqual([]);
  });

  // 🔴 MUTATION: delete the `&&` line. The statement still answers
  // correctly and is a sequential scan of 230 431 casts per stage; only
  // the plan check in the database spec sees it, and this is the cheap
  // second place.
  it('carries the && prefilter on the water rows’ own geometry', () => {
    expect(sub).toMatch(/w\.location && ST_Buffer\(/);
  });

  // 🔴 MUTATION: 500 → 5000 in ONE of the two places. The verdict is the
  // radius constant, and the box is the radius WIDENED (WATER_BOX_METRES) —
  // never the same number and never a smaller one. What the text can say
  // is only that: the real guard of "the box is not narrower than the
  // verdict" is the latitude sweep and the 70.05° N case in the database
  // spec, because a literal that reads 525 can still be too narrow on the
  // ground (a box of exactly 500 was, above 70° N).
  it('takes the verdict from the one radius constant and the box from its widened form', () => {
    expect(WATER_NEAR_DUMP_RADIUS_M).toBe(500);
    expect(WATER_BOX_METRES).toBeGreaterThan(WATER_NEAR_DUMP_RADIUS_M);
    const numbers = [
      ...sub.matchAll(
        /(?:ST_Buffer\(here\.g::geography,|here\.g::geography,)\s*(\d+)\)/g,
      ),
    ].map((m) => Number(m[1]));
    // the box first, then the verdict, as the statement orders them
    expect(numbers).toEqual([WATER_BOX_METRES, WATER_NEAR_DUMP_RADIUS_M]);
    expect(waterBoxSql('here.g')).toContain(`, ${WATER_BOX_METRES})::geometry`);
  });

  // 🔴 MUTATION: `w.kind = 'water'` → anything else, or deleted. A bench
  // or a fuel station would be "drinking water".
  it('looks only at drinking water', () => {
    expect(sub).toContain("w.kind = 'water'");
  });

  // 🔴 MUTATION: delete `p.kind = 'dump'`. Every kind would be probed for
  // water that the mapper then throws away.
  it('runs for the disposal point and for no other kind', () => {
    expect(WATER_CHECKED_KIND).toBe('dump');
    expect(
      (ROUTE_POI_KINDS as readonly string[]).includes(WATER_CHECKED_KIND),
    ).toBe(true);
    expect(sub).toContain(`p.kind = '${WATER_CHECKED_KIND}'`);
  });

  // 🔴 MUTATION: `min(` → `max(`. Still a number, no longer the nearest.
  it('answers with the NEAREST water, not an arbitrary one', () => {
    expect(sub).toMatch(/SELECT min\(ST_Distance\(/);
  });

  // 🔴 MUTATION: drop `AS water_near_m` from the final select. The mapper
  // then sees no column and — by design — sends no field, which the page
  // prints as "we did not check". The disposal point silently stops
  // answering and nothing else in this file notices.
  it('is selected into the statement the endpoint runs, as water_near_m', () => {
    expect(sql).toContain(`${WATER_NEAR_SUBQUERY} AS water_near_m`);
    // …on the FINAL row, after the nearest of each kind has been picked.
    expect(sql.indexOf('AS water_near_m')).toBeGreaterThan(
      sql.indexOf('picked AS ('),
    );
  });
});

describe('CAMP-254: the field a disposal point carries', () => {
  const row = (kind: string, extra: Record<string, unknown> = {}) => ({
    kind,
    osm_ref: 'n1',
    name: null,
    lat: 45,
    lon: 14,
    metres: 1234.4,
    phone: null,
    website: null,
    opening_hours: null,
    ...extra,
  });

  // 🔴 MUTATION: `Math.round(m)` → `m`. The page would print 179.62 m.
  // 🔴 MUTATION: delete `radiusMetres`. The page would not know which
  // radius the "none" sentence is about.
  // The wire keys are written out by hand, not read from the interface.
  it('sends the distance, rounded, with the radius it was searched in', () => {
    expect(
      rowToRouteService(row('dump', { water_near_m: 179.62 }))
        .drinkingWaterNear,
    ).toEqual({ radiusMetres: 500, metres: 180 });
  });

  // 🔴 MUTATION: the `raw === null` branch returns `{}`. "Searched, found
  // none" would become "did not ask", and the page would stop saying the
  // one thing this card is for.
  it('says "searched, none within the radius" when the query came back NULL', () => {
    expect(
      rowToRouteService(row('dump', { water_near_m: null })).drinkingWaterNear,
    ).toEqual({ radiusMetres: 500, metres: null });
  });

  it('keeps zero metres as zero: a tap on the very point is an answer', () => {
    expect(
      rowToRouteService(row('dump', { water_near_m: 0.2 })).drinkingWaterNear,
    ).toEqual({ radiusMetres: 500, metres: 0 });
  });

  it('keeps a distance given as text, as a numeric column would be', () => {
    expect(
      rowToRouteService(row('dump', { water_near_m: '311.4' }))
        .drinkingWaterNear,
    ).toEqual({ radiusMetres: 500, metres: 311 });
  });

  // 🔴 MUTATION: `raw === null` → `raw == null`, so a column the query
  // never selected (`undefined`) reads as "searched, found none". A
  // MISSING COLUMN IS NOT "NONE": it would put "our database holds no
  // drinking water within 500 m" on every disposal point of every route
  // page whenever the SQL and the mapper drift apart.
  it('sends NO field for a row from a query that never asked', () => {
    expect(rowToRouteService(row('dump'))).not.toHaveProperty(
      'drinkingWaterNear',
    );
    expect(waterNearField({})).toEqual({});
  });

  // 🔴 …and the same for a value that is not a distance inside the
  // radius. Each of these is something a different driver, column type or
  // bug could hand over; none may print a distance or a "none".
  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['blanks', '   '],
    ['text that is not a number', 'near'],
    ['a boolean', true],
    ['an object', {}],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a negative distance', -3],
    ['a distance beyond the radius', 500.5],
    ['a far distance', 800],
  ])('sends NO field when the value is %s', (_why, value) => {
    expect(
      rowToRouteService(row('dump', { water_near_m: value })),
    ).not.toHaveProperty('drinkingWaterNear');
  });

  it('keeps a distance of exactly the radius', () => {
    expect(
      rowToRouteService(row('dump', { water_near_m: 500 })).drinkingWaterNear,
    ).toEqual({ radiusMetres: 500, metres: 500 });
  });

  // 🔴 MUTATION: `kind === WATER_CHECKED_KIND` → `true`. A fuel station
  // would carry "no drinking water within 500 m" about itself — on a
  // forecourt row, where the page has no sentence for it and the API
  // would have published a claim nobody asked for.
  it.each(ROUTE_POI_KINDS.filter((k) => k !== 'dump'))(
    'puts none on a %s, whatever its columns say',
    (kind) => {
      expect(
        rowToRouteService(row(kind, { water_near_m: 120 })),
      ).not.toHaveProperty('drinkingWaterNear');
      expect(
        rowToRouteService(row(kind, { water_near_m: null })),
      ).not.toHaveProperty('drinkingWaterNear');
    },
  );

  // The ODbL arithmetic, with the water counted. The page names a distance
  // to one more OSM object per stage that has a disposal point; the
  // distance is all that is printed, but this repository's line is "objects
  // used", not "objects shown", so the worst page is counted WITH it.
  // Today: 7 stages x (4 + 9 + 1) = 98, under 100. A tenth kind makes it
  // 105 and this says so, the way the derived cap does for the first nine.
  it('keeps the worst page under the Substantial floor with the water counted', () => {
    const perStage = DEFAULT_PER_POINT + ROUTE_POI_KINDS.length + 1;
    expect(MAX_SERVICE_POINTS * perStage).toBeLessThan(ODBL_SUBSTANTIAL_FLOOR);
  });
});
