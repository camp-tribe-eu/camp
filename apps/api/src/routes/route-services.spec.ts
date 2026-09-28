import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildServicesSql,
  FUEL_PRICE_SUBQUERY,
  MAX_SERVICE_POINTS,
  MAX_SERVICES_TOTAL,
  ODBL_SUBSTANTIAL_FLOOR,
  parseKinds,
  servicesOverfetch,
} from './route-services';
import { DEFAULT_PER_POINT, MAX_POINTS } from './route-points';
import {
  ACCESS_EXCLUDED,
  classifyCaseSql,
  ROUTE_POI_KINDS,
  ROUTE_POI_RULES,
  SERVICES_PER_KIND,
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
      const label = /SELECT '([a-z]+)'::text AS kind/.exec(block)?.[1];
      const where = /WHERE r\.kind = '([a-z]+)'/.exec(block)?.[1];
      expect(label).toBeTruthy();
      expect(label).toBe(where);
    }
    // …and between them they cover every kind exactly once.
    const labels = blocks.map(
      (b) => /SELECT '([a-z]+)'::text AS kind/.exec(b)?.[1],
    );
    expect(labels.sort()).toEqual([...ROUTE_POI_KINDS].sort());
  });

  it('orders by the KNN operator, which is what the GiST index answers', () => {
    // `<->` is the whole reason this is milliseconds. An ST_DWithin form
    // over a geography cast cannot use the index and took over two
    // minutes for the same points when routes.near() was written.
    expect(sql).toContain('<->');
    expect(sql).not.toMatch(/ST_DWithin/i);
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
    const tags = ROUTE_POI_KINDS.flatMap((kind) =>
      ROUTE_POI_RULES[kind].flatMap((rule) =>
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
    const classified = new Set(
      ROUTE_POI_KINDS.flatMap((kind) =>
        ROUTE_POI_RULES[kind].flatMap((rule) =>
          rule.values.map((v) => `${rule.key}=${v}`),
        ),
      ),
    );
    expect([...classified].sort()).toEqual([...filtered].sort());
  });

  it('builds a CASE that names every kind', () => {
    const sql = classifyCaseSql('s');
    for (const kind of ROUTE_POI_KINDS) expect(sql).toContain(`THEN '${kind}'`);
    expect(sql.startsWith('CASE ')).toBe(true);
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

// 🔴 A kind without its partial index is not an error, it is a
// sequential scan over 2.26 million rows — the failure that does not
// announce itself. The migration declares one index per kind; this
// asserts the two lists are the same list.
describe('every kind has the index its query needs', () => {
  it('the migration creates one partial GiST index per kind', () => {
    const migration = readFileSync(
      join(__dirname, '../migrations/1790572800000-RoutePoi.ts'),
      'utf8',
    );
    const declared = migration.match(
      /static readonly KINDS = \[([\s\S]*?)\] as const/,
    );
    expect(declared).not.toBeNull();
    const kinds = [...(declared?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map(
      (m) => m[1],
    );
    expect(kinds).toEqual([...ROUTE_POI_KINDS]);
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
      join(__dirname, '../migrations/1790662800000-FuelStationPrices.ts'),
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
      join(__dirname, '../migrations/1790662800000-FuelStationPrices.ts'),
      'utf8',
    );
    expect(migration).not.toMatch(/osm_ref\s+text\s+NOT NULL/);
  });
});
