import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
// 🔴 THE TABLE IS FILLED BY THE REAL LOADER, NOT BY THIS FILE (review of #557).
// The first version built the table from the migration's DDL and INSERTed into
// it, so it tested a table production never had: `ogr2ogr -overwrite` made the
// real one, with a column only for a tag the export contained, and an export
// with no tunnel answered `column x.tunnel does not exist` on every campsite
// page. Here the fixture is a GeoJSONSeq file — what `osmium export` writes —
// pushed through `scripts/osm-pipeline/load-hazard.mjs` as a subprocess, into
// a table that starts in the WORST shape there is: the one ogr2ogr left behind,
// without `tunnel`, `service` and `railway`.
//
// 🔴 TOUCHES NOTHING THAT IS NOT ITS OWN: a schema made for this process, first
// on the search_path (the loader gets it through PGOPTIONS), dropped
// afterwards. An unreachable DB is a FAILING spec.
//
// MUTATIONS (done, see the PRs): delete the `ST_DWithin` line → spot d (a
// motorway 1 101 m away, inside the search box) goes red; delete the road's
// tunnel filter → spot a reports the 222 m tunnel; delete the RAILWAY's tunnel
// filter → spot a reports the 334 m rail tunnel; `highway IN ('motorway')`
// without `trunk` → spot e loses its only road; delete `x.service IS NULL` →
// the 111 m siding wins; delete the `iata` condition → the 111 m airstrip wins;
// order by `<->` instead of geography → spot b picks the 834 m road.

jest.setTimeout(120_000);
const URL =
  process.env.CI_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';
const SCHEMA = `camp502_spec_${process.pid}`;
const LOADER = join(
  __dirname,
  '../../../../scripts/osm-pipeline/load-hazard.mjs',
);
let db: Client;
let dir: string;

type Tags = Record<string, string>;
const feature = (properties: Tags, geometry: object): string =>
  JSON.stringify({ type: 'Feature', properties, geometry });
const line = (tags: Tags, ...c: Array<[number, number]>): string =>
  feature(tags, { type: 'LineString', coordinates: c });
const point = (tags: Tags, lon: number, lat: number): string =>
  feature(tags, { type: 'Point', coordinates: [lon, lat] });

/** The real loader, as a subprocess, into this spec's schema. */
const load = (name: string, rows: string[], extra: string[] = []) => {
  const file = join(dir, name);
  writeFileSync(file, rows.join('\n') + '\n');
  const r = spawnSync(process.execPath, [LOADER, '--file', file, ...extra], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: URL,
      PGOPTIONS: `-c search_path=${SCHEMA},public`,
    },
  });
  return { rc: r.status, text: `${r.stdout}${r.stderr}` };
};

const run = async (spot: string) => {
  const r = await db.query(
    `SELECT ${disturbanceSql('s.location')} AS v FROM spots s WHERE s.id = $1`,
    [spot],
  );
  return readDisturbance(r.rows[0].v);
};
const of = (v: ReturnType<typeof readDisturbance>, k: string) =>
  v.find((e) => e.kind === k);

const FIXTURE: string[] = [
  // spot a (5.0, 50.0)
  line({ highway: 'motorway', name: 'A1' }, [4.9, 50.005], [5.1, 50.005]), // 556 m
  line({ highway: 'trunk', tunnel: 'yes' }, [4.9, 50.002], [5.1, 50.002]), // 222 m, tunnel
  point({ highway: 'motorway_junction' }, 5.0, 50.0005), // 56 m, not a road
  line({ railway: 'rail' }, [4.9, 49.992], [5.1, 49.992]), // 890 m
  line({ railway: 'rail', tunnel: 'yes' }, [4.9, 49.997], [5.1, 49.997]), // 334 m, a RAIL tunnel
  line({ railway: 'rail', service: 'siding' }, [4.9, 50.001], [5.1, 50.001]), // 111 m
  point({ railway: 'station' }, 5.0, 50.0001), // 11 m, a station
  point({ aeroway: 'aerodrome', iata: 'BRU', name: 'Airport X' }, 5.0, 50.04), // 4 448 m
  point({ aeroway: 'aerodrome' }, 5.0, 50.001), // 111 m, an airstrip
  // spot b (5.0, 58.4): east 0.0139 deg = 811 m; north 0.0075 deg = 834 m.
  // In DEGREES the north road is nearer (0.0075 < 0.0139); in metres the east one is.
  line({ highway: 'motorway' }, [5.0139, 58.3], [5.0139, 58.5]),
  line({ highway: 'motorway' }, [4.9, 58.4075], [5.1, 58.4075]),
  // spot d (6.0, 50.0): a motorway 0.0099 deg = 1 101 m north — inside the
  // search box, outside the 1 000 m radius
  line({ highway: 'motorway' }, [5.9, 50.0099], [6.1, 50.0099]),
  // spot e (7.0, 50.0): its ONLY road is a trunk road in the open,
  // 0.004 deg = 445 m north. Nothing else is near it.
  line({ highway: 'trunk', name: 'N4' }, [6.9, 50.004], [7.1, 50.004]),
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'camp502-spec-'));
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(`SET search_path = ${SCHEMA}, public`);
  // 🔴 The shape `ogr2ogr -overwrite` left from an export that held no
  // tunnel, no service and no railway: three columns the query reads are
  // absent. Reviewer's reproduction, word for word.
  await db.query(
    `CREATE TABLE osm_ctx_hazard (ogc_fid serial PRIMARY KEY,
       geom geometry(Geometry, 4326), name varchar, highway varchar,
       aeroway varchar, iata varchar)`,
  );
  await db.query(
    `CREATE TABLE spots (id text PRIMARY KEY, location geometry(Point,4326))`,
  );
  await db.query(`INSERT INTO spots VALUES
    ('a', ST_SetSRID(ST_MakePoint(5.0, 50.0), 4326)),
    ('b', ST_SetSRID(ST_MakePoint(5.0, 58.4), 4326)),
    ('c', ST_SetSRID(ST_MakePoint(10.0, 40.0), 4326)),
    ('d', ST_SetSRID(ST_MakePoint(6.0, 50.0), 4326)),
    ('e', ST_SetSRID(ST_MakePoint(7.0, 50.0), 4326))`);
  const r = load('fixture.geojsonl', FIXTURE);
  if (r.rc !== 0) throw new Error(`the loader refused the fixture: ${r.text}`);
});

afterAll(async () => {
  await db.query('RESET search_path');
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
  rmSync(dir, { recursive: true, force: true });
});

test('🔴 the fixture went through the loader: every line is a row', async () => {
  const r = await db.query(`SELECT count(*)::int AS n FROM osm_ctx_hazard`);
  expect(r.rows[0].n).toBe(FIXTURE.length);
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

test('🔴 a trunk road counts as a road: spot e has nothing else', async () => {
  const v = await run('e');
  expect(v.map((e) => e.kind)).toEqual(['road']);
  expect(Math.abs(v[0].metres - 445)).toBeLessThanOrEqual(5);
  expect(v[0].name).toBe('N4');
});

test('🔴 the radius is exact: a road in the search box but past 1 000 m is not reported', async () => {
  expect(await run('d')).toEqual([]);
});

test('nothing anywhere near: an empty list, so no block', async () => {
  expect(await run('c')).toEqual([]);
});

// 🔴 THE REVIEWER'S CASE, ON THE TABLE THE MIGRATION MAKES. An export with no
// tunnel, no service and no railway anywhere in it (Malta is close to that)
// used to produce a table without those columns. LAST in the file on purpose:
// it replaces the rows the tests above stand on.
test('🔴 an export with no tunnel / service / railway still answers, on the migration table', async () => {
  await db.query('DROP TABLE osm_ctx_hazard');
  await db.query(HAZARD_TABLE_DDL);
  const r = load(
    'no-tags.geojsonl',
    [line({ highway: 'motorway', name: 'A1' }, [4.9, 50.005], [5.1, 50.005])],
    ['--allow-shrink'],
  );
  expect(r.text).toContain('1 рядків із 1');
  expect(r.rc).toBe(0);
  const v = await run('a');
  expect(v.map((e) => e.kind)).toEqual(['road']);
  expect(Math.abs(v[0].metres - 556)).toBeLessThanOrEqual(5);
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
