import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { RoutePoi1790572800000 } from '../migrations/1790572800000-RoutePoi';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { RoutePoiGas1791700000000 } from '../migrations/1791700000000-RoutePoiGas';
import { RoutePoiHelp1797000000000 } from '../migrations/1797000000000-RoutePoiHelp';
import {
  CAMP_SERVICE_KINDS,
  RADIUS_KINDS,
  campServicesSql,
  NEARBY_RADIUS_M,
  ONSITE_RADIUS_M,
  readCampServices,
} from './camp-services';

// CAMP-503 — the campsite's services block, run against a REAL PostgreSQL.
//
// 🔴 Every expected number is written by hand from the coordinates (1 degree
// of latitude is 111.3 km; of longitude at 46 N, 77.3 km) — never computed by
// the SQL under test, never read from the payload it judges.
//
// 🔴 TOUCHES NOTHING THAT IS NOT ITS OWN: a schema made for this process,
// first on the search_path, dropped afterwards. An unreachable database is a
// FAILING spec, not a skipped one.
//
// MUTATION (done, see the PR): delete `AND ST_DWithin(… ${nearbyM})` from the
// `around` branch → the fuel point 11.8 km away (inside the search box, outside
// the radius) appears and "no fuel" goes red. Delete the radius distance test
// (`ST_DWithin(… ${onSiteM})`) → the 400 m tap becomes "within the radius".
//
// Review of #555 (13.11.2026), each done and red:
//   * `outline IS NULL AND` dropped from the radius test (the radius applied
//     beside an outline — the CASE→OR mutation that had survived) → spot b's
//     tap over the fence, 77 m from the point and OUTSIDE the outline, stops
//     being "nearby".
//   * RADIUS_KINDS widened to every kind → spot f's fuel station at 120 m
//     gets a `withinRadius`.
//   * `onSite` taken from the radius where there is no outline (the rule as
//     it was merged) → spot a's and spot f's `onSite` are no longer null.

jest.setTimeout(120_000);
const URL =
  process.env.CI_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';
const SCHEMA = `camp503_spec_${process.pid}`;

let db: Client;

const poi = (
  ref: string,
  kind: string,
  name: string | null,
  lon: number,
  lat: number,
  swap = 'no',
) =>
  db.query(
    `INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, cylinder_swap)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'SI', $6)`,
    [ref, kind, name, lon, lat, swap],
  );

const run = async (spot: 'a' | 'b' | 'c' | 'd' | 'e' | 'f') => {
  const r = await db.query(
    `SELECT ${campServicesSql('s.location', 's.outline')} AS v FROM spots s WHERE s.id = $1`,
    [spot],
  );
  return readCampServices(r.rows[0].v);
};
const of = (v: ReturnType<typeof readCampServices>, k: string) =>
  v.find((e) => e.kind === k);

beforeAll(async () => {
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(`SET search_path = ${SCHEMA}, public`);
  const qr = {
    query: (sql: string) => db.query(sql),
  } as unknown as QueryRunner;
  await new RoutePoi1790572800000().up(qr);
  await new RoutePoiFacilities1791400000000().up(qr);
  await new RoutePoiGas1791700000000().up(qr);
  await new RoutePoiHelp1797000000000().up(qr);
  await db.query(
    `CREATE TABLE spots (id text PRIMARY KEY, location geometry(Point,4326), outline geometry(MultiPolygon,4326))`,
  );
  // a: no outline, at 14.0 / 46.0.  b: outline 14.1-14.106 x 46.0-46.002.
  // c: nothing anywhere near.
  await db.query(`INSERT INTO spots VALUES
    ('a', ST_SetSRID(ST_MakePoint(14.0, 46.0), 4326), NULL),
    ('b', ST_SetSRID(ST_MakePoint(14.1005, 46.0005), 4326),
          ST_Multi(ST_MakeEnvelope(14.1, 46.0, 14.106, 46.002, 4326))),
    ('c', ST_SetSRID(ST_MakePoint(16.5, 46.5), 4326), NULL),
    ('d', ST_SetSRID(ST_MakePoint(20.0, 46.0), 4326), NULL),
    ('e', ST_SetSRID(ST_MakePoint(12.0, 58.4), 4326), NULL),
    ('f', ST_SetSRID(ST_MakePoint(15.0, 47.0), 4326), NULL)`);

  // spot a
  await poi('n1', 'water', 'Tap A near', 14.001, 46.0); // 77 m  -> on site
  await poi('n2', 'water', 'Tap A far', 14.01, 46.0); // 773 m -> nearby
  await poi('n3', 'water', 'Tap A out', 14.2, 46.0); // 15.5 km -> nothing
  await poi('n4', 'water', 'Tap 400', 14.0, 46.0036); // 401 m: not on site
  await poi('n5', 'charging', 'EV A', 14.0, 46.0015); // 167 m -> nearby
  await poi('n6', 'dump', 'Dump A', 14.02, 46.0); // 1 546 m
  // spot d's only fuel: the search-box corner, inside ±0.129 deg yet 11.8 km
  // away — only the exact distance test can refuse it
  await poi('n7', 'fuel', 'Fuel corner', 20.1, 46.08);
  // gas: a fuel station that swaps bottles, 5.6 km north
  await poi('n8', 'fuel', 'Fuel+gas', 14.0, 46.05, 'yes');
  // spot e, 58.4 N: planar (degree) distance and metres DISAGREE. East-west
  // 0.0975 deg + north-south 0.0388 deg is 7.14 km; 0.0756 + 0.066 is 8.6 km —
  // but in degrees the second is the nearer. Hand-computed: 4.32 km north-south,
  // 0.0975 * 111.32 * cos(58.4) = 5.68 km east-west.
  await poi('n11', 'dump', 'Dump true nearest', 11.9025, 58.3612);
  await poi('n12', 'dump', 'Dump planar nearest', 11.9244, 58.334);
  // spot b: inside the outline but 390 m from the point; and just outside
  await poi('n9', 'water', 'Tap inside', 14.1055, 46.001);
  await poi('n10', 'water', 'Tap outside', 14.1075, 46.001);
  // CAMP-506, spot a: a pharmacy 1 113 m north-ish (0.01 deg lat), a repair
  // shop 9.5 km away (inside the 10 km radius) and one 10.6 km away (outside),
  // a supermarket 556 m away. Known import day on the pharmacy.
  await poi('n13', 'pharmacy', 'Lekarna', 14.0, 46.01); // 1 113 m
  await db.query(
    `UPDATE osm_route_poi SET last_seen_at = '2026-11-05T23:30:00Z' WHERE osm_ref = 'n13'`,
  );
  await poi('n14', 'car_repair', 'Garage in range', 14.0, 46.0853); // 9.50 km
  await poi('n15', 'car_repair', 'Garage too far', 14.0, 46.0952); // 10.60 km
  await poi('n16', 'groceries', 'Spar', 14.0, 46.005); // 556 m
  // Review of #555, spot b: OUTSIDE the outline (west of 14.1) yet 77 m from
  // the campsite's point (0.001 deg of longitude at 46 N) — closer than the
  // radius. With an outline the radius must not exist.
  await poi('n17', 'water', 'Tap over the fence', 14.0995, 46.0005);
  // Review of #555, spot f: NO outline, and everything a road has within the
  // 150 m radius, all due north (1 deg of latitude = 111.3 km): a fuel station
  // that swaps bottles 120 m away, a kiosk 100 m, a charger 90 m, a dump 60 m.
  await poi('n18', 'fuel', 'Shell 120', 15.0, 47.00108, 'yes');
  await poi('n19', 'groceries', 'Kiosk 100', 15.0, 47.0009);
  await poi('n20', 'charging', 'EV 90', 15.0, 47.00081);
  await poi('n21', 'dump', 'Dump 60', 15.0, 47.00054);
});

afterAll(async () => {
  await db.query('RESET search_path');
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

test('the constants are the ones the comment measured', () => {
  expect(NEARBY_RADIUS_M).toBe(10_000);
  expect(ONSITE_RADIUS_M).toBe(150);
  expect(CAMP_SERVICE_KINDS).toEqual([
    'fuel',
    'groceries',
    'ev_charging',
    'gas',
    'water',
    'dump',
    'pharmacy',
    'car_repair',
  ]);
});

test('spot a (no outline): water within the radius is a DISTANCE, never "on site"', async () => {
  const v = await run('a');
  const w = of(v, 'water')!;
  // 🔴 no outline, so nothing is claimed to be inside the campsite
  expect(w.onSite).toBeNull();
  expect(w.withinRadius).toEqual({
    name: 'Tap A near',
    metres: expect.any(Number),
    seen: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
  expect(Math.abs(w.withinRadius!.metres - 77)).toBeLessThanOrEqual(3);
  // 🔴 the 400 m tap is NOT within the radius and the nearest "nearby" is the 401 m one,
  // not the 773 m one: nearest means nearest.
  expect(w.nearby!.name).toBe('Tap 400');
  expect(Math.abs(w.nearby!.metres - 401)).toBeLessThanOrEqual(4);
});

test('🔴 the distance filter: nothing beyond the radius is "nearby"', async () => {
  const v = await run('a');
  // the only fuel row inside the search box is 11.8 km away; the 5.6 km one
  // is also gas — so fuel is the 5.6 km one and the far one never wins
  const f = of(v, 'fuel')!;
  expect(f.onSite).toBeNull();
  expect(f.nearby!.name).toBe('Fuel+gas');
  expect(Math.abs(f.nearby!.metres - 5565)).toBeLessThanOrEqual(30);
  // remove the fuel+gas row's competitor: a kind whose only point is out of
  // range does not appear at all — checked on spot c below and here by water
  expect(v.map((e) => e.nearby?.name)).not.toContain('Tap A out');
});

test('🔴 a point inside the search box but past 10 km is not "nearby"', async () => {
  // spot d has exactly one POI: 11.8 km away. Nothing to say, so nothing.
  expect(await run('d')).toEqual([]);
});

test('🔴 EV charging is its own kind and never the hookup', async () => {
  const v = await run('a');
  const c = of(v, 'ev_charging')!;
  expect(c.onSite).toBeNull();
  expect(c.nearby!.name).toBe('EV A');
  expect(Math.abs(c.nearby!.metres - 167)).toBeLessThanOrEqual(3);
  expect(v.map((e) => e.kind)).not.toContain('charging');
  expect(v.map((e) => e.kind)).not.toContain('electricity');
  expect(campServicesSql('s.location', 's.outline')).not.toMatch(
    /electricity|hookup/i,
  );
});

test('gas is cylinder_swap, not a kind of its own row', async () => {
  const g = of(await run('a'), 'gas')!;
  expect(g.nearby!.name).toBe('Fuel+gas');
  expect(g.onSite).toBeNull();
});

test('dump has only a nearby point, in the right place in the list', async () => {
  const v = await run('a');
  expect(of(v, 'dump')!.nearby!.name).toBe('Dump A');
  // page order: the groups' order, not the order of the rows
  expect(v.map((e) => e.kind)).toEqual([
    'fuel',
    'groceries',
    'ev_charging',
    'gas',
    'water',
    'dump',
    'pharmacy',
    'car_repair',
  ]);
  expect(v.map((e) => e.group)).toEqual([
    'before',
    'before',
    'before',
    'before',
    'stay',
    'stay',
    'trouble',
    'trouble',
  ]);
});

test('spot b: with an outline, "on site" means inside it, whatever the distance', async () => {
  const w = of(await run('b'), 'water')!;
  expect(w.onSite!.name).toBe('Tap inside'); // 390 m from the point, > 150
  expect(Math.abs(w.onSite!.metres - 390)).toBeLessThanOrEqual(6);
  // 🔴 the tap over the fence is 77 m from the point — inside the 150 m
  // radius — and OUTSIDE the outline: it is "nearby", and it is the nearest
  // nearby (the other outside tap is 541 m away). The radius is not used.
  expect(w.withinRadius).toBeNull();
  expect(w.nearby!.name).toBe('Tap over the fence');
  expect(Math.abs(w.nearby!.metres - 77)).toBeLessThanOrEqual(3);
  for (const e of await run('b')) expect(e.withinRadius).toBeNull();
});

test('🔴 no outline: fuel, groceries, EV charging and gas 60–120 m away are "nearby" — nothing is claimed on site', async () => {
  const v = await run('f');
  const near = (k: string) => {
    const e = of(v, k)!;
    expect(e.onSite).toBeNull();
    expect(e.withinRadius).toBeNull();
    return e.nearby!;
  };
  expect(near('fuel').name).toBe('Shell 120');
  expect(Math.abs(near('fuel').metres - 120)).toBeLessThanOrEqual(3);
  expect(near('gas').name).toBe('Shell 120');
  expect(near('groceries').name).toBe('Kiosk 100');
  expect(Math.abs(near('groceries').metres - 100)).toBeLessThanOrEqual(3);
  expect(near('ev_charging').name).toBe('EV 90');
  expect(Math.abs(near('ev_charging').metres - 90)).toBeLessThanOrEqual(3);
  // the dump station is one of the two radius kinds: a distance, still not
  // "on site", and it is not repeated as "nearby"
  const d = of(v, 'dump')!;
  expect(d.onSite).toBeNull();
  expect(d.withinRadius!.name).toBe('Dump 60');
  expect(Math.abs(d.withinRadius!.metres - 60)).toBeLessThanOrEqual(3);
  expect(d.nearby).toBeNull();
  expect([...RADIUS_KINDS]).toEqual(['water', 'dump']);
});

test('🔴 spot c: nothing in range is an empty list, so the page draws nothing', async () => {
  expect(await run('c')).toEqual([]);
});

test('🔴 nearest is nearest in METRES, not in degrees (58.4 N)', async () => {
  const d = of(await run('e'), 'dump')!;
  expect(d.nearby!.name).toBe('Dump true nearest');
  expect(Math.abs(d.nearby!.metres - 7140)).toBeLessThanOrEqual(40);
});

test('🔴 CAMP-506: pharmacy, car repair and groceries — nearest, with metres and the import day', async () => {
  const v = await run('a');
  const ph = of(v, 'pharmacy')!;
  expect(ph.nearby!.name).toBe('Lekarna');
  expect(Math.abs(ph.nearby!.metres - 1113)).toBeLessThanOrEqual(12);
  // UTC day of the stamp, not the server's zone
  expect(ph.nearby!.seen).toBe('2026-11-05');
  expect(ph.group).toBe('trouble');
  const g = of(v, 'groceries')!;
  expect(g.nearby!.name).toBe('Spar');
  expect(Math.abs(g.nearby!.metres - 556)).toBeLessThanOrEqual(6);
  expect(g.group).toBe('before');
});

test('🔴 CAMP-506: the radius holds for the new kinds (9.5 km in, 10.6 km out)', async () => {
  const cr = of(await run('a'), 'car_repair')!;
  expect(cr.nearby!.name).toBe('Garage in range');
  expect(Math.abs(cr.nearby!.metres - 9500)).toBeLessThanOrEqual(60);
  // a campsite whose only repair shop is out of range gets no car_repair entry
  await db.query(`DELETE FROM osm_route_poi WHERE osm_ref = 'n14'`);
  try {
    expect(of(await run('a'), 'car_repair')).toBeUndefined();
  } finally {
    await poi('n14', 'car_repair', 'Garage in range', 14.0, 46.0853);
  }
});

test('a kind with no rows at all (the table before the import) is simply absent', async () => {
  const v = await run('e');
  expect(of(v, 'pharmacy')).toBeUndefined();
  expect(of(v, 'car_repair')).toBeUndefined();
});
