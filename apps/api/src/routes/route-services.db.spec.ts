import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { FuelStationPrices1790662801000 } from '../migrations/1790662801000-FuelStationPrices';
import { RoutePoi1790572800000 } from '../migrations/1790572800000-RoutePoi';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { ROUTE_POI_KINDS } from '../osm/route-poi';
import {
  buildServicesSql,
  FACILITY_FIELDS,
  rowToRouteService,
  servicesOverfetch,
  type RouteService,
} from './route-services';

// CAMP-119 — the route-services query, against a REAL PostgreSQL.
//
// 🔴 WHY A DATABASE. The unit spec next to this one can say that the five
// facility columns are NAMED in the SQL. It cannot say that a rest area's
// `toilets='no'` comes out as "no" while a rest area nobody described
// comes out as "unknown", or that the nearest of two rest areas is the
// one chosen, or that a 25 km radius excludes a place 33 km away — those
// are statements about what PostgreSQL returns, and a string that
// contains the right column names is satisfied by a UNION whose blocks
// disagree about them.
//
// 🔴 EVERY STATEMENT UNDER TEST IS IMPORTED. `buildServicesSql` is the
// endpoint's own query and `rowToRouteService` is its own mapping; the
// tables are made by the real migrations' `up()`. Nothing is retyped.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP: a skipped test reads as
// a passed one. Needs CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL
// (CI sets it): any PostGIS database you may CREATE DATABASE in. This
// file creates its own `camp119b_*` database and drops it; it reads and
// writes nothing in the one you name.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const runner = (): QueryRunner =>
  ({ query: async (sql: string) => db.query(sql) }) as unknown as QueryRunner;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp119b_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');

  // FuelStationPrices1790662801000 tidies TypeORM's own bookkeeping table
  // (`DELETE FROM migrations …`), which a database this file made does not
  // have. An empty one, shaped as TypeORM makes it, is all it asks for.
  await db.query(
    `CREATE TABLE migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)`,
  );

  // The real migrations, in the order they ran in production.
  await new RoutePoi1790572800000().up(runner());
  await new FuelStationPrices1790662801000().up(runner());
  await new RoutePoiFacilities1791400000000().up(runner());

  // The query point is (lon 14, lat 45). Distances below are written by
  // hand from the coordinates: 0.01° of latitude is about 1.11 km, and
  // 0.02° of longitude at 45° N is about 1.57 km.
  const poi = (
    ref: string,
    kind: string,
    lon: number,
    lat: number,
    facilities: Record<string, string> = {},
    name: string | null = null,
  ) => {
    const cols = ['osm_ref', 'kind', 'name', 'location', 'country'];
    const vals: unknown[] = [ref, kind, name, `POINT(${lon} ${lat})`, 'hr'];
    for (const [col, value] of Object.entries(facilities)) {
      cols.push(col);
      vals.push(value);
    }
    const marks = vals.map((_, i) =>
      i === 3 ? `ST_GeomFromText($${i + 1}, 4326)` : `$${i + 1}`,
    );
    return db.query(
      `INSERT INTO osm_route_poi (${cols.join(', ')}) VALUES (${marks.join(', ')})`,
      vals,
    );
  };

  // Two rest areas north of the point. The NEARER one is described, and
  // partly: toilets and drinking water, a written "no" for the shower,
  // and nothing at all for the dump point and the fee.
  await poi(
    'n10',
    'rest_area',
    14.0,
    45.01,
    { toilets: 'yes', shower: 'no', drinking_water: 'yes' },
    'Aire du Nord',
  );
  // The FARTHER one says "no" to everything. If the query ever picked it
  // the test below would see five "no" where it expects a mix.
  await poi('n11', 'rest_area', 14.0, 45.05, {
    toilets: 'no',
    shower: 'no',
    drinking_water: 'no',
    sanitary_dump_station: 'no',
    fee: 'no',
  });
  // A service area to the east, described only by its toilets.
  await poi('w20', 'service_area', 14.02, 45.0, { toilets: 'yes' });
  // A fuel station whose row HAS a toilets column saying yes. It must not
  // come out of the endpoint carrying one.
  await poi('n30', 'fuel', 14.0, 45.002, { toilets: 'yes' });
  await poi('n31', 'dump', 14.0, 45.003, { fee: 'yes' });

  // A second query point, (lon 16, lat 45), with ONE rest area 33 km away
  // — outside the 25 km radius the page asks for.
  await poi('n40', 'rest_area', 16.0, 45.3, { toilets: 'yes' });

  // A third, (lon 18, lat 45), with one rest area that says "no" to all
  // five. A written no is an answer and must survive as one.
  await poi('n50', 'rest_area', 18.0, 45.001, {
    toilets: 'no',
    shower: 'no',
    drinking_water: 'no',
    sanitary_dump_station: 'no',
    fee: 'no',
  });
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

/** The endpoint's own query and mapping, for one stage, as `services()` runs them. */
async function stage(
  lon: number,
  lat: number,
  kinds: readonly (typeof ROUTE_POI_KINDS)[number][] = ROUTE_POI_KINDS,
  radius = 25_000,
): Promise<RouteService[]> {
  const rows = (
    await db.query(buildServicesSql([...kinds]), [
      lon,
      lat,
      servicesOverfetch(1),
      radius,
    ])
  ).rows as Record<string, unknown>[];
  return rows.map(rowToRouteService);
}

const kindOf = (services: RouteService[], kind: string) =>
  services.find((s) => s.kind === kind);

describe('CAMP-119: the stopping places come out of the stage query', () => {
  it('returns the nearest rest area and service area, with a straight-line distance', async () => {
    const services = await stage(14.0, 45.0);

    const rest = kindOf(services, 'rest_area');
    // The nearer one, not the one that says "no" to everything.
    expect(rest?.osmRef).toBe('n10');
    expect(rest?.name).toBe('Aire du Nord');
    // 0.01° of latitude, by hand: about 1 111 m.
    expect(rest?.metres).toBeGreaterThan(1100);
    expect(rest?.metres).toBeLessThan(1125);

    const service = kindOf(services, 'service_area');
    expect(service?.osmRef).toBe('w20');
    // 0.02° of longitude at 45° N, by hand: about 1 574 m.
    expect(service?.metres).toBeGreaterThan(1550);
    expect(service?.metres).toBeLessThan(1600);
  });

  // 🔴 THE CARD, AS VALUES. A written yes is yes, a written no is no, and
  // a tag nobody wrote is "unknown" — in the SAME row, from the SAME query.
  it('says yes, no and unknown from one row, each for its own facility', async () => {
    const rest = kindOf(await stage(14.0, 45.0), 'rest_area');
    expect(rest?.facilities).toEqual({
      toilets: 'yes',
      shower: 'no',
      drinkingWater: 'yes',
      // never written for this row: the column DEFAULT, 'unknown'
      dumpStation: 'unknown',
      fee: 'unknown',
    });
  });

  it('says unknown for four of five on a place described by its toilets alone', async () => {
    const service = kindOf(await stage(14.0, 45.0), 'service_area');
    expect(service?.facilities).toEqual({
      toilets: 'yes',
      shower: 'unknown',
      drinkingWater: 'unknown',
      dumpStation: 'unknown',
      fee: 'unknown',
    });
  });

  // 🔴 A WRITTEN NO IS NOT A GAP. If the query collapsed the third state
  // into the second — or the second into the third — this is the row that
  // says so: five written "no"s must come out as five "no"s.
  it('keeps a written no as no', async () => {
    const rest = kindOf(await stage(18.0, 45.0), 'rest_area');
    expect(rest?.osmRef).toBe('n50');
    expect(rest?.facilities).toEqual({
      toilets: 'no',
      shower: 'no',
      drinkingWater: 'no',
      dumpStation: 'no',
      fee: 'no',
    });
  });

  // 🔴 THE OTHER SEVEN KINDS CARRY NO FACILITIES, even when their own row
  // has a column that says yes. A customer toilet at a fuel station is not
  // a claim about the road.
  it('puts no facilities on a fuel station or a dump point', async () => {
    const services = await stage(14.0, 45.0);
    expect(kindOf(services, 'fuel')?.osmRef).toBe('n30');
    expect(kindOf(services, 'fuel')).not.toHaveProperty('facilities');
    expect(kindOf(services, 'dump')?.osmRef).toBe('n31');
    expect(kindOf(services, 'dump')).not.toHaveProperty('facilities');
  });

  // 🔴 The page says "within 25 km". A rest area 33 km away is not within
  // it, and an answer that included it would make that sentence false.
  it('leaves out a stopping place beyond the radius', async () => {
    const services = await stage(16.0, 45.0);
    expect(kindOf(services, 'rest_area')).toBeUndefined();
  });

  it('asks for the stopping places alone when it is told to', async () => {
    const services = await stage(14.0, 45.0, ['rest_area', 'service_area']);
    expect(services.map((s) => s.kind).sort()).toEqual([
      'rest_area',
      'service_area',
    ]);
  });
});

// 🔴 The default a row has when no writer named the column. It is what the
// 2.2 million rows already in the table say until a full import has run, and
// the card's whole point is that it is not "no".
describe('CAMP-119: a row no importer has described', () => {
  it('stores unknown in all nine columns', async () => {
    await db.query(
      `INSERT INTO osm_route_poi (osm_ref, kind, location, country)
       VALUES ('n60', 'rest_area', ST_GeomFromText('POINT(20 45)', 4326), 'hr')`,
    );
    const row = (
      await db.query(`SELECT * FROM osm_route_poi WHERE osm_ref = 'n60'`)
    ).rows[0];
    for (const col of [
      'toilets',
      'shower',
      'drinking_water',
      'sanitary_dump_station',
      'fee',
      'access',
      'hgv',
      'maxheight',
      'maxlength',
    ]) {
      expect(`${col}=${row[col]}`).toBe(`${col}=unknown`);
    }
  });
});

// ── THE INDEXES, READ FROM THE CATALOG ──────────────────────────────────
//
// 🔴 WHY THIS BLOCK EXISTS (CAMP-119 review, defect D1). Deleting the whole
// `CREATE INDEX` loop out of RoutePoiFacilities.up() left 68 suites and
// 1 889 tests green. The guard the spec had for it —
// `route-services.spec.ts`, "every kind has the index its query needs" —
// reads the migration FILE with a regex and only for the literal
// `static readonly KINDS = [...]`. It pins a LIST of kinds, and a list of
// kinds is not an index: take `'service_area'` out of that literal and one
// test goes red, take the `CREATE INDEX` statement out and none does.
//
// What an index missing here costs is not an error. It is
//   WHERE r.kind = 'rest_area' ORDER BY location <-> point
// as a sequential scan over 2.26 million rows on every stage of every
// route page — the failure this table's first migration already paid for
// once (9 699 ms for one page, measured) and which nothing announces.
//
// So this asks PostgreSQL. The tables here are made by the real migrations'
// `up()`, which is the one place those statements run, and the question is
// put to the catalog — not to the migration's text, and not to a table
// whose size makes the answer depend on the planner's mood.
//
// 🔴 THE LIST BEING CHECKED IS THE ENDPOINT'S, NOT THE MIGRATION'S.
// `ROUTE_POI_KINDS` is what `buildServicesSql` asks about. Checking the
// migrations' own `KINDS` against the migrations' own indexes would be a
// corpus that shares its field with the thing it measures: a kind added to
// the endpoint and to neither migration would pass.

/** `kind` → the index name that is partial on it, from the catalog. */
async function partialGistIndexes(): Promise<{
  byKind: Map<string, string>;
}> {
  const { rows } = await db.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'osm_route_poi'`,
  );
  const byKind = new Map<string, string>();
  for (const row of rows) {
    // How PostgreSQL prints `USING GIST (location) WHERE kind = 'x'`:
    //   … USING gist (location) WHERE (kind = 'x'::text)
    const m =
      /USING gist \(location\) WHERE \(kind = '([a-z_]+)'::text\)$/.exec(
        row.indexdef,
      );
    if (m) byKind.set(m[1], row.indexname);
  }
  return { byKind };
}

describe('CAMP-119: every kind the endpoint asks about has its partial GiST index', () => {
  it('the catalog holds one on location, partial on the kind, for each of them', async () => {
    const { byKind } = await partialGistIndexes();
    // Anchor: there are kinds to look for. An empty list would make
    // `missing` empty for the wrong reason.
    expect(ROUTE_POI_KINDS.length).toBeGreaterThan(0);
    const missing = ROUTE_POI_KINDS.filter((kind) => !byKind.has(kind));
    // The names go in the value: Jest's `expect` takes ONE argument.
    expect(missing).toEqual([]);
  });

  // 🔴 Having the index is not the same as the query being able to use it.
  // The 9 699 ms was an index that existed and a predicate the planner
  // could not prove, because the kind was a join column and not a literal.
  // This plans the endpoint's OWN statement with sequential scans switched
  // off — which makes the answer independent of how many rows there are,
  // the thing the CAMP-32 check has to load 55 000 rows to get around —
  // and requires every kind's block to name the index that is partial on
  // it, and the table to be read by no sequential scan at all.
  it('the endpoint’s own statement plans an index scan on each of them', async () => {
    const { byKind } = await partialGistIndexes();
    await db.query('SET enable_seqscan = off');
    let plan: PlanNode;
    try {
      const res = await db.query(
        `EXPLAIN (FORMAT JSON) ${buildServicesSql([...ROUTE_POI_KINDS])}`,
        [14, 45, servicesOverfetch(1), 25_000],
      );
      plan = res.rows[0]['QUERY PLAN'][0].Plan;
    } finally {
      await db.query('RESET enable_seqscan');
    }
    const used = new Set<string>();
    const seqScans: string[] = [];
    walkPlan(plan, (n) => {
      if (n['Index Name']) used.add(n['Index Name']);
      if (
        n['Node Type'] === 'Seq Scan' &&
        n['Relation Name'] === 'osm_route_poi'
      ) {
        seqScans.push(n['Relation Name']);
      }
    });
    expect(ROUTE_POI_KINDS.length).toBeGreaterThan(0);
    const unused = ROUTE_POI_KINDS.filter((kind) => {
      const name = byKind.get(kind);
      return name === undefined || !used.has(name);
    });
    expect(unused).toEqual([]);
    expect(seqScans).toEqual([]);
  });
});

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

function walkPlan(node: PlanNode, visit: (n: PlanNode) => void) {
  visit(node);
  for (const child of node.Plans ?? []) walkPlan(child, visit);
}

// ── ONE OSM OBJECT IS ONE ROW, IN ONE KIND ──────────────────────────────
//
// 🔴 CAMP-119 review, defect D3: nothing stops a fuel station and a service
// area that are ONE OpenStreetMap object from being printed as two rows.
// Checked rather than assumed, and the premise does not hold — twice over:
//
//   1. The schema. `osm_ref` is this table's PRIMARY KEY, so a stage cannot
//      be handed the same object under two kinds. This is the direct
//      assertion of that, on the table the page reads.
//   2. The loader. An object tagged both `amenity=fuel` and
//      `highway=services` is classified by the FIRST matching branch and
//      stored once, as `fuel` — pinned against a real PostgreSQL by case
//      `n11` in osm/route-poi-sql.db.spec.ts.
//
// Measured on the real region extract the CAMP-119 fixture was cut from
// (18 189 OSM objects, 18 189 distinct ids): zero objects carry both tags.
// What does occur is a service area and a fuel station that are DIFFERENT
// objects a few metres apart — 55 of the 64 `highway=services` objects have
// one within 150 m, and none of the 132 such pairs shares a name. That is
// two true statements about one place, not one statement printed twice, and
// it has a different osmRef each time, so no rule on `osmRef` could remove
// it.
describe('CAMP-119: one OSM object is one row', () => {
  it('refuses a second row with the same osm_ref, whatever its kind', async () => {
    const insert = (kind: string) =>
      db.query(
        `INSERT INTO osm_route_poi (osm_ref, kind, name, location, country)
         VALUES ('n70', $1, 'Same object', ST_GeomFromText('POINT(22 45)', 4326), 'hr')`,
        [kind],
      );
    await insert('fuel');
    await expect(insert('service_area')).rejects.toMatchObject({
      code: '23505', // unique_violation
    });
    const rows = (
      await db.query(`SELECT kind FROM osm_route_poi WHERE osm_ref = 'n70'`)
    ).rows;
    expect(rows).toEqual([{ kind: 'fuel' }]);
  });
});

// ── THE CI FIXTURE, LOADED AND READ BACK ────────────────────────────────
//
// 🔴 CAMP-119 review, defect D2. The five facility keys are named twice, by
// hand — the API's FACILITY_FIELDS and the page's FACILITY_KEYS — and the
// only thing that makes a disagreement between them visible is a row that
// says yes or no for the key in question. The fixture CI builds the site
// from had `toilets` and then `'unknown'` four times over, in all four
// rows, so for four keys of five nothing anywhere could tell a renamed key
// from a key nobody had written down: both print "Not known".
//
// This loads the REAL fixture file into PostgreSQL (inside a transaction,
// rolled back) and reads the columns back, rather than parsing the SQL:
// what the page can be told is what the database holds after the file has
// run. It asks two things of the corpus, one for each way it could stop
// being able to see:
//
//   - every facility column says yes on some row and no on some row,
//     or a key renamed on one side still prints the same word it did;
//   - no two columns have the same pattern down the rows, or two keys
//     swapped on the way to the page print the same words in another order.
//
// The columns checked are the API's own list, not the fixture's: the thing
// being measured must not choose what it is measured against.
describe('CAMP-119: the CI fixture passes every facility key through yes and through no', () => {
  const FIXTURE = join(__dirname, '../../test/fixtures/ci-seed-route-poi.sql');

  it('says yes and no for each of the five columns, in a different pattern for each', async () => {
    const columns = FACILITY_FIELDS.map((f) => f.column);
    expect(columns.length).toBe(5);
    const patterns: string[] = [];
    const blind: string[] = [];
    await db.query('BEGIN');
    try {
      await db.query(readFileSync(FIXTURE, 'utf8'));
      // The fixture's rows are the French ones; this file's own are 'hr'.
      const where = `kind IN ('rest_area', 'service_area') AND country = 'fr'`;
      const loaded = await db.query(
        `SELECT count(*)::int AS n FROM osm_route_poi WHERE ${where}`,
      );
      // Anchor: the fixture put its stopping places into the table. An
      // empty read would make every count below zero for the wrong reason.
      expect(loaded.rows[0].n).toBeGreaterThan(0);

      for (const column of columns) {
        const r = await db.query(
          `SELECT count(*) FILTER (WHERE ${column} = 'yes')::int AS yes,
                  count(*) FILTER (WHERE ${column} = 'no')::int  AS no,
                  string_agg(${column}, ',' ORDER BY osm_ref)    AS pattern
             FROM osm_route_poi WHERE ${where}`,
        );
        if (r.rows[0].yes === 0) blind.push(`${column} never says yes`);
        if (r.rows[0].no === 0) blind.push(`${column} never says no`);
        patterns.push(r.rows[0].pattern);
      }
    } finally {
      await db.query('ROLLBACK');
    }
    // The names go in the value: Jest's `expect` takes ONE argument.
    expect(blind).toEqual([]);
    // Five columns, five different patterns.
    expect(new Set(patterns).size).toBe(columns.length);
  });
});
