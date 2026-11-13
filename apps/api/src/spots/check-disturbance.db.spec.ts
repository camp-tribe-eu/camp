import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { HAZARD_TABLE_DDL } from '../migrations/1797100000000-Disturbance';
import {
  DisturbanceCoverage,
  main,
  measure,
  MIN_COUNTRY_LIVE,
  verdict,
} from './check-disturbance';

// CAMP-502 — the sentry that says the «Possible disturbance» block is drawn
// nowhere. Run against a REAL PostgreSQL: the counts come from the page's own
// SQL, so a stub would only confirm the formula it was written from.
//
// 🔴 TOUCHES NOTHING THAT IS NOT ITS OWN: a schema made for this process.
//
// MUTATIONS (done, see the PR): `rows === 0` branch removed → the empty-layer
// test goes red; `dark.length > 0` branch removed → the one-country test goes
// red; the population filter replaced by `true` → the denominator test counts
// the dead row; `return v.ok ? 0 : 1` → `return 0` → the exit-code test.

jest.setTimeout(120_000);
const URL =
  process.env.CI_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';
const SCHEMA = `camp502_guard_${process.pid}`;
// The sentry opens its own connection; this is how it lands in our schema.
const SCOPED = `${URL}${URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
let db: Client;

/** `main()` with its output captured, against this spec's schema. */
const cli = async (argv: string[] = [], url: string | null = SCOPED) => {
  const out: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((x) => {
    out.push(String(x));
  });
  const err = jest.spyOn(console, 'error').mockImplementation((x) => {
    out.push(String(x));
  });
  const had = process.env.DATABASE_URL;
  if (url === null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = url;
  try {
    return { rc: await main(argv), text: out.join('\n') };
  } finally {
    if (had === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = had;
    log.mockRestore();
    err.mockRestore();
  }
};

/** n campsites of one country in a 0.0001-degree row starting at (lon, lat). */
const spots = (
  country: string,
  n: number,
  lon: number,
  lat: number,
  extra = `'r', NULL`,
) =>
  db.query(
    `INSERT INTO camping_spots (country, region, missing_since, location)
     SELECT $1, ${extra}, ST_SetSRID(ST_MakePoint($2 + g * 0.0001, $3), 4326)
       FROM generate_series(1, $4) g`,
    [country, lon, lat, n],
  );
const hazard = (cols: string, vals: string, wkt: string) =>
  db.query(
    `INSERT INTO osm_ctx_hazard (geom, ${cols})
     VALUES (ST_SetSRID(ST_GeomFromText($1), 4326), ${vals})`,
    [wkt],
  );

beforeAll(async () => {
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(`SET search_path = ${SCHEMA}, public`);
  await db.query(HAZARD_TABLE_DDL);
  await db.query(`CREATE TABLE camping_spots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), country varchar NOT NULL,
    region varchar, missing_since timestamptz,
    location geometry(Point, 4326) NOT NULL)`);
  await db.query(`CREATE TABLE spot_links (
    primary_id uuid, secondary_id uuid, unlinked_at timestamptz)`);
  // BE: 120 campsites along 50.0 N from 5.0 E; FR: 110 along 45.0 N from 2.0 E.
  await spots('BE', 120, 5.0, 50.0);
  await spots('FR', 110, 2.0, 45.0);
  // Never counted anywhere: a campsite OSM dropped, and one without a region.
  await spots('BE', 7, 5.0, 50.0, `'r', now()`);
  await spots('BE', 5, 5.0, 50.0, `NULL, NULL`);
  // MT: 3 campsites with nothing near — too few to be an alarm.
  await spots('MT', 3, 14.4, 35.9);
});

afterAll(async () => {
  await db.query('RESET search_path');
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

const total = (c: DisturbanceCoverage, k: 'live' | 'drawn') =>
  c.countries.reduce((a, x) => a + x[k], 0);

test('🔴 an EMPTY layer is red, and says on how many pages the block is missing', async () => {
  const c = await measure(db);
  expect(c.rows).toBe(0);
  // 🔴 the denominator: 120 + 110 + 3 with a page; the 7 dead and 5 regionless are not in it
  expect(total(c, 'live')).toBe(233);
  const r = await cli();
  expect(r.rc).toBe(1);
  expect(r.text).toContain('osm_ctx_hazard is EMPTY (0 rows)');
  expect(r.text).toContain('0 of 233 campsite pages');
});

test('🔴 a layer loaded for ONE country is red and names the other', async () => {
  // a motorway 556 m north of the Belgian row, a railway 890 m south, an airport 4.4 km north
  await hazard('highway', `'motorway'`, 'LINESTRING(4.9 50.005, 5.2 50.005)');
  await hazard('railway', `'rail'`, 'LINESTRING(4.9 49.992, 5.2 49.992)');
  await hazard('aeroway, iata', `'aerodrome', 'BRU'`, 'POINT(5.0 50.04)');
  const c = await measure(db);
  expect(c.byKind).toEqual({ road: 1, rail: 1, airport: 1 });
  expect(c.countries).toEqual([
    { country: 'BE', live: 120, drawn: 120 },
    { country: 'FR', live: 110, drawn: 0 },
    { country: 'MT', live: 3, drawn: 0 },
  ]);
  const r = await cli();
  expect(r.rc).toBe(1);
  expect(r.text).toContain('FR (0 of 110)');
  // Malta has 3 campsites: an honest nothing, not an alarm
  expect(r.text).not.toContain('MT');
});

test('🔴 green prints the denominators: campsites, countries, rows', async () => {
  await hazard('highway', `'trunk'`, 'LINESTRING(1.9 45.005, 2.2 45.005)');
  const r = await cli();
  expect(r.text).toContain('✓ block on 230 of 233 campsites with a page');
  expect(r.text).toContain(
    `countries with the block: 2 of 2 that have ${MIN_COUNTRY_LIVE}+ campsites`,
  );
  expect(r.text).toContain(
    '4 rows, of which the page reads road 2, rail 1, airport 1',
  );
  expect(r.rc).toBe(0);
});

test('🔴 a kind the page would read nowhere is red: rows the filter drops do not count', async () => {
  await db.query(
    `UPDATE osm_ctx_hazard SET iata = NULL WHERE aeroway IS NOT NULL`,
  );
  const r = await cli();
  expect(r.rc).toBe(1);
  expect(r.text).toContain(
    'holds no airport the page would read (0 of 4 rows)',
  );
  await db.query(
    `UPDATE osm_ctx_hazard SET iata = 'BRU' WHERE aeroway IS NOT NULL`,
  );
});

test('🔴 rows that are nowhere near any campsite: red, with the count', async () => {
  await db.query(`UPDATE osm_ctx_hazard SET geom = ST_Translate(geom, 0, 20)`);
  const r = await cli();
  expect(r.rc).toBe(1);
  expect(r.text).toContain('block on 0 of 233 campsites with a page');
  await db.query(`UPDATE osm_ctx_hazard SET geom = ST_Translate(geom, 0, -20)`);
});

test('a hidden secondary is not a page and is not in the denominator', async () => {
  await db.query(`INSERT INTO spot_links (primary_id, secondary_id)
    SELECT (SELECT id FROM camping_spots WHERE country = 'FR' AND region IS NOT NULL ORDER BY id LIMIT 1),
           (SELECT id FROM camping_spots WHERE country = 'MT' ORDER BY id LIMIT 1)`);
  expect(total(await measure(db), 'live')).toBe(232);
  await db.query('DELETE FROM spot_links');
});

test('🔴 no DATABASE_URL, or an argument it does not know: refused, never green', async () => {
  expect((await cli([], null)).rc).toBe(2);
  expect((await cli(['--stale-only'])).rc).toBe(2);
});

test('verdict: "0 of 0" is a sentry without a subject, not a pass', () => {
  const v = verdict({
    rows: 10,
    byKind: { road: 1, rail: 1, airport: 1 },
    countries: [],
  });
  expect(v.ok).toBe(false);
  expect(v.lines.join('\n')).toContain('0 campsites with a page');
});

// ── the unit that runs it on the machine ──────────────────────────────
const REPO = join(__dirname, '..', '..', '..', '..');
const unitPath = (name: string): string => join(REPO, 'infra', 'systemd', name);
const directives = (name: string): string[] =>
  (existsSync(unitPath(name)) ? readFileSync(unitPath(name), 'utf8') : '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

test('🔴 the sentry runs SOMEWHERE: a unit and a daily timer, from the release', () => {
  const service = directives('camptribe-disturbance-check.service');
  expect(service.filter((l) => l.startsWith('ExecStart='))).toEqual([
    'ExecStart=/usr/bin/node dist/spots/check-disturbance.js',
  ]);
  expect(service).toContain('WorkingDirectory=/srv/camptribe/current/apps/api');
  expect(service).toContain(
    'EnvironmentFile=/srv/camptribe/current/apps/api/.env',
  );
  // a red run must reach a person
  expect(service).toContain('OnFailure=camptribe-failed@%n.service');
  const timer = directives('camptribe-disturbance-check.timer');
  expect(timer.filter((l) => l.startsWith('OnCalendar=')).length).toBe(1);
  expect(timer).toContain('Persistent=true');
  expect(timer).toContain('WantedBy=timers.target');
});

test('the compiled entry point the unit names is what the build emits', () => {
  // nest build maps src/spots/check-disturbance.ts → dist/spots/check-disturbance.js
  expect(
    existsSync(join(REPO, 'apps/api/src/spots/check-disturbance.ts')),
  ).toBe(true);
});
