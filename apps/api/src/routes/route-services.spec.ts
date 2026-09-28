import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildServicesSql,
  MAX_SERVICES_TOTAL,
  parseKinds,
  servicesOverfetch,
} from './route-services';
import { MAX_POINTS } from './route-points';
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

describe('the SQL a stage runs', () => {
  const sql = buildServicesSql([...ROUTE_POI_KINDS]);

  it('names every kind as a literal, so each block can use its index', () => {
    for (const kind of ROUTE_POI_KINDS) {
      expect(sql).toContain(`WHERE r.kind = '${kind}'`);
    }
  });

  it('orders by the KNN operator, which is what the GiST index answers', () => {
    // `<->` is the whole reason this is milliseconds. An ST_DWithin form
    // over a geography cast cannot use the index and took over two
    // minutes for the same points when routes.near() was written.
    expect(sql).toContain('<->');
    expect(sql).not.toMatch(/ST_DWithin/i);
  });

  it('asks for one of each kind and no more', () => {
    expect(SERVICES_PER_KIND).toBe(1);
    // 🔴 Overfetched before re-sorting: `<->` orders by planar degrees
    // because that is what the index holds, and a degree of longitude is
    // 111 km at the equator against 55 km at Uppsala. The page prints
    // the metres, so a planar order would visibly not be in order.
    expect(servicesOverfetch(SERVICES_PER_KIND)).toBeGreaterThan(
      SERVICES_PER_KIND,
    );
    expect(sql).toContain('DISTINCT ON (kind)');
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
  const LONGEST_ROUTE_STAGES = 7;
  const CAMPSITES_ON_THAT_PAGE = 28;

  it('one page cannot reach 100 objects', () => {
    const services =
      LONGEST_ROUTE_STAGES * ROUTE_POI_KINDS.length * SERVICES_PER_KIND;
    expect(services + CAMPSITES_ON_THAT_PAGE).toBeLessThan(100);
  });

  // The API accepts up to MAX_POINTS stages, which is more than any
  // published route has. A crafted request asking for all twelve would
  // otherwise assemble 12 x 7 = 84 objects from one call.
  it('the server-side cap binds before a crafted request could', () => {
    const askable = MAX_POINTS * ROUTE_POI_KINDS.length * SERVICES_PER_KIND;
    expect(MAX_SERVICES_TOTAL).toBeLessThan(askable);
    // …and it must not bind on a real page, or the last stage of the
    // longest route would silently lose its services.
    expect(MAX_SERVICES_TOTAL).toBeGreaterThanOrEqual(
      LONGEST_ROUTE_STAGES * ROUTE_POI_KINDS.length * SERVICES_PER_KIND,
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
