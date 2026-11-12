import { Client } from 'pg';
import { HAZARD_TABLE_DDL } from '../migrations/1797100000000-Disturbance';
import {
  DISTURBANCE_RADIUS_M,
  disturbanceSql,
  readDisturbance,
} from './disturbance';

// CAMP-502 — distance to motorway / railway line / airport, run against a REAL
// PostgreSQL. Every expected number is written by hand from the coordinates
// (1 degree of latitude is 111.2 km; of longitude at 58.4 N, 58.3 km) — never
// computed by the SQL under test.
//
// 🔴 TOUCHES NOTHING THAT IS NOT ITS OWN: a schema made for this process, first
// on the search_path, dropped afterwards. An unreachable DB is a FAILING spec.
//
// MUTATIONS (done, see the PR): delete the `ST_DWithin` line → spot d (a
// motorway 1 101 m away, inside the search box) goes red; delete the tunnel
// filter → spot a reports the 222 m tunnel; delete `x.service IS NULL` → the
// 111 m siding wins; delete the `iata` condition → the 111 m airstrip wins;
// order by `<->` instead of geography → spot b picks the 834 m road.

jest.setTimeout(120_000);
const URL =
  process.env.CI_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';
const SCHEMA = `camp502_spec_${process.pid}`;
let db: Client;

const line = (
  cols: Record<string, string | null>,
  wkt: string,
): Promise<unknown> =>
  db.query(
    `INSERT INTO osm_ctx_hazard (geom, name, highway, railway, aeroway, iata, service, tunnel)
     VALUES (ST_SetSRID(ST_GeomFromText($1), 4326), $2, $3, $4, $5, $6, $7, $8)`,
    [
      wkt,
      cols.name ?? null,
      cols.highway ?? null,
      cols.railway ?? null,
      cols.aeroway ?? null,
      cols.iata ?? null,
      cols.service ?? null,
      cols.tunnel ?? null,
    ],
  );

const run = async (spot: string) => {
  const r = await db.query(
    `SELECT ${disturbanceSql('s.location')} AS v FROM spots s WHERE s.id = $1`,
    [spot],
  );
  return readDisturbance(r.rows[0].v);
};
const of = (v: ReturnType<typeof readDisturbance>, k: string) =>
  v.find((e) => e.kind === k);

beforeAll(async () => {
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(`SET search_path = ${SCHEMA}, public`);
  await db.query(HAZARD_TABLE_DDL);
  await db.query(
    `CREATE TABLE spots (id text PRIMARY KEY, location geometry(Point,4326))`,
  );
  await db.query(`INSERT INTO spots VALUES
    ('a', ST_SetSRID(ST_MakePoint(5.0, 50.0), 4326)),
    ('b', ST_SetSRID(ST_MakePoint(5.0, 58.4), 4326)),
    ('c', ST_SetSRID(ST_MakePoint(10.0, 40.0), 4326)),
    ('d', ST_SetSRID(ST_MakePoint(6.0, 50.0), 4326))`);

  // spot a (5.0, 50.0)
  await line(
    { highway: 'motorway', name: 'A1' },
    'LINESTRING(4.9 50.005, 5.1 50.005)',
  ); // 556 m
  await line(
    { highway: 'trunk', tunnel: 'yes' },
    'LINESTRING(4.9 50.002, 5.1 50.002)',
  ); // 222 m, tunnel
  await line({ highway: 'motorway_junction' }, 'POINT(5.0 50.0005)'); // 56 m, not a road
  await line({ railway: 'rail' }, 'LINESTRING(4.9 49.992, 5.1 49.992)'); // 890 m
  await line(
    { railway: 'rail', service: 'siding' },
    'LINESTRING(4.9 50.001, 5.1 50.001)',
  ); // 111 m
  await line({ railway: 'station' }, 'POINT(5.0 50.0001)'); // 11 m, a station
  await line(
    { aeroway: 'aerodrome', iata: 'BRU', name: 'Airport X' },
    'POINT(5.0 50.04)',
  ); // 4 448 m
  await line({ aeroway: 'aerodrome' }, 'POINT(5.0 50.001)'); // 111 m, an airstrip
  // spot b (5.0, 58.4): east 0.0139 deg = 811 m; north 0.0075 deg = 834 m.
  // In DEGREES the north road is nearer (0.0075 < 0.0139); in metres the east one is.
  await line({ highway: 'motorway' }, 'LINESTRING(5.0139 58.3 , 5.0139 58.5)');
  await line({ highway: 'motorway' }, 'LINESTRING(4.9 58.4075, 5.1 58.4075)');
  // spot d (6.0, 50.0): a motorway 0.0099 deg = 1 101 m north — inside the
  // search box, outside the 1 000 m radius
  await line({ highway: 'motorway' }, 'LINESTRING(5.9 50.0099, 6.1 50.0099)');
});

afterAll(async () => {
  await db.query('RESET search_path');
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

test('the thresholds are the ones the comment measured', () => {
  expect(DISTURBANCE_RADIUS_M).toEqual({
    road: 1000,
    rail: 1000,
    airport: 5000,
  });
});

test('spot a: nearest of each kind, in metres, with the point on the object', async () => {
  const v = await run('a');
  expect(v.map((e) => e.kind)).toEqual(['road', 'rail', 'airport']);
  const road = of(v, 'road')!;
  expect(Math.abs(road.metres - 556)).toBeLessThanOrEqual(5);
  expect(Math.abs(road.lon - 5.0)).toBeLessThan(1e-4);
  expect(Math.abs(road.lat - 50.005)).toBeLessThan(1e-4);
  expect(Math.abs(of(v, 'rail')!.metres - 890)).toBeLessThanOrEqual(5);
  const air = of(v, 'airport')!;
  expect(Math.abs(air.metres - 4448)).toBeLessThanOrEqual(15);
  expect(air.name).toBe('Airport X');
});

test('🔴 not a tunnel, not a junction, not a siding, not a station, not an airstrip', async () => {
  const v = await run('a');
  // each of those is nearer than the answer; any one winning changes it
  expect(of(v, 'road')!.metres).toBeGreaterThan(500);
  expect(of(v, 'rail')!.metres).toBeGreaterThan(800);
  expect(of(v, 'airport')!.metres).toBeGreaterThan(4000);
});

test('🔴 nearest by METRES: at 58.4 N the road nearer in degrees is the farther one', async () => {
  const road = of(await run('b'), 'road')!;
  expect(Math.abs(road.metres - 811)).toBeLessThanOrEqual(8);
  expect(road.lon).toBeGreaterThan(5.01); // the east road, not the north one
});

test('🔴 the radius is exact: a road in the search box but past 1 000 m is not reported', async () => {
  expect(await run('d')).toEqual([]);
});

test('nothing anywhere near: an empty list, so no block', async () => {
  expect(await run('c')).toEqual([]);
});

test('a radius that is not a positive integer is refused', () => {
  expect(() =>
    disturbanceSql('s.location', { road: 0, rail: 1, airport: 1 }),
  ).toThrow();
});

test('one bad entry costs one entry', () => {
  expect(
    readDisturbance([
      null,
      { kind: 'ferry', metres: 5, lon: 1, lat: 1 },
      { kind: 'road', metres: 'x', lon: 1, lat: 1 },
      { kind: 'rail', metres: 10, lon: 1, lat: 2 },
    ]).map((e) => e.kind),
  ).toEqual(['rail']);
});
