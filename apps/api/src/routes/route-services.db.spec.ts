import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { FuelStationPrices1790662801000 } from '../migrations/1790662801000-FuelStationPrices';
import { RoutePoi1790572800000 } from '../migrations/1790572800000-RoutePoi';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { ROUTE_POI_KINDS } from '../osm/route-poi';
import {
  buildServicesSql,
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
