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
  WATER_NEAR_SUBQUERY,
  type RouteService,
} from './route-services';

// CAMP-254 — drinking water near the disposal point, against a REAL PostGIS.
//
// 🔴 WHY A DATABASE. route-services.spec.ts can say that the statement
// contains `::geography` and `500`. It cannot say that 180 m comes out as
// 180, that 800 m comes out as "none within 500", or that a fuel station
// 50 m from the disposal point is not "drinking water" — those are
// statements about what PostGIS returns. And the one mistake this card is
// most likely to hide, `geometry` where `geography` belongs, is a statement
// that still parses, still runs, still returns a number.
//
// 🔴 EVERY STATEMENT UNDER TEST IS IMPORTED. `buildServicesSql` is the
// endpoint's own query and `rowToRouteService` is its own mapping; the
// tables are made by the real migrations' `up()`.
//
// 🔴 THE COORDINATES ARE WRITTEN BY HAND AND WERE CHECKED BY SOMETHING
// ELSE. The fixture is not generated from the radius or from PostGIS: each
// offset below was computed on the WGS84 ellipsoid with an independent
// Vincenty implementation (python, 15.10.2026) from the disposal point at
// (14.0, 45.01):
//
//     north 180 m  → lat 45.0116197    east 490 m  → lon 14.0062152
//     north 300 m  → lat 45.0126994    north 510 m → lat 45.0145892
//     south 180 m  → lat 45.0083803    north 800 m → lat 45.0171986
//     north  50 m  → lat 45.0104499    east   50 m → lon 14.0006342
//     NE 450 m (318 N + 318 E) → (lat 45.0128634, lon 14.0040363)
//     NE 600 m (424 N + 424 E) → (lat 45.0138178, lon 14.0053818)
//
// (each came back as its stated distance to within 0.05 m). The corpus
// therefore shares no field with the thing that measures it.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP: a skipped test reads as a
// passed one. Needs CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI
// sets it): any PostGIS database you may CREATE DATABASE in. This file
// creates its own `camp254_*` database and drops it; it reads and writes
// nothing in the one you name.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const runner = (): QueryRunner =>
  ({ query: async (sql: string) => db.query(sql) }) as unknown as QueryRunner;

/** One OSM point into the table the page reads. */
function poi(ref: string, kind: string, lon: number, lat: number) {
  return db.query(
    `INSERT INTO osm_route_poi (osm_ref, kind, name, location, country)
     VALUES ($1, $2, NULL, ST_GeomFromText($3, 4326), 'hr')`,
    [ref, kind, `POINT(${lon} ${lat})`],
  );
}

// Each scene has its own stage at (lon, 45.0) and its own disposal point
// 1.11 km north of it at (lon, 45.01). Scenes are a whole degree of
// longitude apart — 78 km at 45° N, three times the 25 km the page looks
// — so no scene's stage can find another scene's points.
const STAGE_LAT = 45.0;
const DUMP_LAT = 45.01;

const SCENE = {
  north180: 15.0,
  east490: 16.0,
  north510: 17.0,
  north800: 18.0,
  nothing: 19.0,
  nearestOfTwo: 20.0,
  wrongKinds: 21.0,
  nearestDump: 22.0,
  onThePoint: 23.0,
  fuelWithWater: 24.0,
  diagonal450: 25.0,
  diagonal600: 26.0,
} as const;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp254_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // FuelStationPrices1790662801000 tidies TypeORM's bookkeeping table,
  // which a database this file made does not have.
  await db.query(
    `CREATE TABLE migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)`,
  );
  await new RoutePoi1790572800000().up(runner());
  await new FuelStationPrices1790662801000().up(runner());
  await new RoutePoiFacilities1791400000000().up(runner());

  // 1. The card's first case: drinking water 180 m north of the disposal
  //    point. Found, and the answer is the distance.
  await poi('n1d', 'dump', SCENE.north180, DUMP_LAT);
  await poi('n1w', 'water', SCENE.north180, 45.0116197);

  // 2. 490 m EAST — the far side of the radius, in the direction where a
  //    degree of longitude is shortest. A box or a verdict that is a few
  //    percent too small misses it.
  await poi('n2d', 'dump', SCENE.east490, DUMP_LAT);
  await poi('n2w', 'water', SCENE.east490 + 0.0062152, DUMP_LAT);

  // 3. 510 m north: ten metres outside. Pins the radius from the other
  //    side — 180 and 800 alone would let it be anything from 181 to 799.
  await poi('n3d', 'dump', SCENE.north510, DUMP_LAT);
  await poi('n3w', 'water', SCENE.north510, 45.0145892);

  // 4. The card's second case: water at 800 m. It IS in the table, and it
  //    is not "within 500 m", so the answer is "none".
  await poi('n4d', 'dump', SCENE.north800, DUMP_LAT);
  await poi('n4w', 'water', SCENE.north800, 45.0171986);

  // 5. The card's third case: no water anywhere near.
  await poi('n5d', 'dump', SCENE.nothing, DUMP_LAT);

  // 6. Two waters inside the radius: 300 m north, inserted FIRST and with
  //    the lower osm_ref, and 180 m south, inserted second. The answer is
  //    the nearer one.
  await poi('n6d', 'dump', SCENE.nearestOfTwo, DUMP_LAT);
  await poi('n6a', 'water', SCENE.nearestOfTwo, 45.0126994);
  await poi('n6b', 'water', SCENE.nearestOfTwo, 45.0083803);

  // 7. Four things 50 m from the disposal point that are NOT drinking
  //    water: a fuel station, a shop, a place to sleep, and a SECOND
  //    disposal point (north of the first, so the first is the one the
  //    stage picks). None of them is a tap.
  await poi('n7d', 'dump', SCENE.wrongKinds, DUMP_LAT);
  await poi('n7x', 'dump', SCENE.wrongKinds, 45.0104499);
  await poi('n7f', 'fuel', SCENE.wrongKinds, 45.0104499);
  await poi('n7g', 'groceries', SCENE.wrongKinds + 0.0006342, DUMP_LAT);
  await poi('n7s', 'shelter', SCENE.wrongKinds - 0.0006342, DUMP_LAT);

  // 8. Two disposal points inside 25 km of the stage. The NEARER (1.11 km)
  //    has no water; the FARTHER (about 5 km east) has a tap 50 m away. The
  //    page prints the nearer one, so the answer is about the nearer one:
  //    none. Borrowing the other's tap would be a true tap at the wrong
  //    place.
  await poi('n8d', 'dump', SCENE.nearestDump, DUMP_LAT);
  await poi('n8e', 'dump', SCENE.nearestDump + 0.0634, DUMP_LAT);
  await poi('n8w', 'water', SCENE.nearestDump + 0.0634, 45.0104499);

  // 9. A tap on the very coordinates of the disposal point. A distance of
  //    zero is an answer, not an absence.
  await poi('n9d', 'dump', SCENE.onThePoint, DUMP_LAT);
  await poi('n9w', 'water', SCENE.onThePoint, DUMP_LAT);

  // 10. A fuel station with a tap 100 m from IT (and 790 m from the
  //     scene's disposal point, so the disposal point's answer is
  //     unchanged). The fuel row must carry no water field of its own.
  await poi('na_d', 'dump', SCENE.fuelWithWater, DUMP_LAT);
  await poi('na_f', 'fuel', SCENE.fuelWithWater, 45.002);
  await poi('na_w', 'water', SCENE.fuelWithWater, 45.0029);

  // 11 and 12. THE CORNERS OF THE BOX. The `&&` prefilter is a SQUARE
  // (about 1 000 m a side) and the radius is a CIRCLE; a tap 424 m north
  // AND 424 m east is inside the square (each offset is under 500) and 600
  // m from the disposal point, outside the circle. Everything on the axes
  // above — north, east — is inside the square AND inside the circle or
  // outside both, so none of it can tell a circle from a square. These
  // two can: 450 m on the diagonal is inside both, 600 m is inside only
  // the box.
  await poi('nb_d', 'dump', SCENE.diagonal450, DUMP_LAT);
  await poi('nb_w', 'water', SCENE.diagonal450 + 0.0040363, 45.0128634);
  await poi('nc_d', 'dump', SCENE.diagonal600, DUMP_LAT);
  await poi('nc_w', 'water', SCENE.diagonal600 + 0.0053818, 45.0138178);
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

/** The endpoint's own query and mapping, for one stage, as `services()` runs them. */
async function stage(lon: number): Promise<RouteService[]> {
  const rows = (
    await db.query(buildServicesSql([...ROUTE_POI_KINDS]), [
      lon,
      STAGE_LAT,
      servicesOverfetch(1),
      25_000,
    ])
  ).rows as Record<string, unknown>[];
  return rows.map(rowToRouteService);
}

const dumpOf = (services: RouteService[]) =>
  services.find((s) => s.kind === 'dump');

describe('CAMP-254: the disposal point says how far its drinking water is', () => {
  // 🔴 MUTATION: `geography` → `geometry` in the ST_DWithin. 500 becomes
  // 500 degrees and every point on Earth is "near": cases 3, 4 and 8
  // answer a distance where they must answer none.
  // 🔴 MUTATION: `geography` → `geometry` in the ST_Distance. The metres
  // come back as degrees and round to 0: this case reads 0, not 180.
  it('1. water 180 m north: found, and the distance is the geodesic one', async () => {
    const dump = dumpOf(await stage(SCENE.north180));
    expect(dump?.osmRef).toBe('n1d');
    // By hand, from the Vincenty check: 180.0 m.
    expect(dump?.drinkingWaterNear?.metres).toBeGreaterThanOrEqual(179);
    expect(dump?.drinkingWaterNear?.metres).toBeLessThanOrEqual(181);
    // The wire shape, key by key, written out and not derived.
    expect(Object.keys(dump?.drinkingWaterNear ?? {}).sort()).toEqual([
      'metres',
      'radiusMetres',
    ]);
    expect(dump?.drinkingWaterNear?.radiusMetres).toBe(500);
  });

  // 🔴 MUTATION: replace the `&&` box with one too small — or the buffer
  // with a box that is directional. 490 m EAST is where it would show.
  it('2. water 490 m east: found, at the far edge of the radius', async () => {
    const dump = dumpOf(await stage(SCENE.east490));
    expect(dump?.osmRef).toBe('n2d');
    expect(dump?.drinkingWaterNear?.metres).toBeGreaterThanOrEqual(488);
    expect(dump?.drinkingWaterNear?.metres).toBeLessThanOrEqual(491);
  });

  // 🔴 MUTATION: 500 → 5000. Water at 510 m would be found.
  // 🔴 MUTATION: 500 → 400. Water at 490 m (case 2) would be missed.
  // Between them the radius is pinned to within 10 m of 500.
  it('3. water 510 m north: NOT within 500 m, so the answer is none', async () => {
    const dump = dumpOf(await stage(SCENE.north510));
    expect(dump?.osmRef).toBe('n3d');
    expect(dump?.drinkingWaterNear).toEqual({
      radiusMetres: 500,
      metres: null,
    });
  });

  it('4. water 800 m north: it is in the table and it is not near, so none', async () => {
    const dump = dumpOf(await stage(SCENE.north800));
    expect(dump?.osmRef).toBe('n4d');
    expect(dump?.drinkingWaterNear).toEqual({
      radiusMetres: 500,
      metres: null,
    });
  });

  // 🔴 The second and the third case have the SAME answer on the wire, on
  // purpose. The page says "no drinking water within 500 m" for both,
  // because that is the whole of what was asked: it does not say "the
  // nearest is 800 m away", because nothing farther than 500 m was
  // looked for. Written as an assertion so the choice is a decision with
  // a test and not an accident of the query.
  it('5. and 4. and 3. answer identically: a tap beyond the radius is no tap', async () => {
    const nothing = dumpOf(await stage(SCENE.nothing));
    expect(nothing?.osmRef).toBe('n5d');
    expect(nothing?.drinkingWaterNear).toEqual({
      radiusMetres: 500,
      metres: null,
    });
    const far = dumpOf(await stage(SCENE.north800));
    const nearMiss = dumpOf(await stage(SCENE.north510));
    expect(far?.drinkingWaterNear).toEqual(nothing?.drinkingWaterNear);
    expect(nearMiss?.drinkingWaterNear).toEqual(nothing?.drinkingWaterNear);
  });

  // 🔴 MUTATION: `min(` → `max(`: this reads 300. An arbitrary pick —
  // first inserted, lowest osm_ref — reads 300 too.
  it('6. two waters inside the radius: the NEARER one is reported', async () => {
    const dump = dumpOf(await stage(SCENE.nearestOfTwo));
    expect(dump?.osmRef).toBe('n6d');
    expect(dump?.drinkingWaterNear?.metres).toBeGreaterThanOrEqual(179);
    expect(dump?.drinkingWaterNear?.metres).toBeLessThanOrEqual(181);
  });

  // 🔴 MUTATION: delete `w.kind = 'water'`. A fuel station, a shop, a bed
  // and another disposal point, each 50 m away, would be "drinking water".
  it('7. a fuel station, a shop, a bed and another disposal point 50 m away are not drinking water', async () => {
    const dump = dumpOf(await stage(SCENE.wrongKinds));
    expect(dump?.osmRef).toBe('n7d');
    expect(dump?.drinkingWaterNear).toEqual({
      radiusMetres: 500,
      metres: null,
    });
  });

  // 🔴 The tap belongs to the disposal point the PAGE PRINTS. Borrowing
  // the farther one's tap would answer a true thing about the wrong place.
  it('8. the answer is about the nearest disposal point, not any inside 25 km', async () => {
    const dump = dumpOf(await stage(SCENE.nearestDump));
    expect(dump?.osmRef).toBe('n8d');
    expect(dump?.drinkingWaterNear).toEqual({
      radiusMetres: 500,
      metres: null,
    });
  });

  it('9. a tap on the very coordinates of the disposal point is 0 m, not none', async () => {
    const dump = dumpOf(await stage(SCENE.onThePoint));
    expect(dump?.osmRef).toBe('n9d');
    expect(dump?.drinkingWaterNear).toEqual({ radiusMetres: 500, metres: 0 });
  });

  // 🔴 MUTATION: delete `p.kind = 'dump'` AND widen the mapper to every
  // kind. Only the disposal point carries the field; a fuel station with a
  // tap 100 m from it does not.
  it('10. no other kind carries the field, even with a tap 100 m away', async () => {
    const services = await stage(SCENE.fuelWithWater);
    const fuel = services.find((s) => s.kind === 'fuel');
    expect(fuel?.osmRef).toBe('na_f');
    expect(fuel).not.toHaveProperty('drinkingWaterNear');
    expect(
      services.filter((s) => s.kind !== 'dump' && 'drinkingWaterNear' in s),
    ).toEqual([]);
    // …while the scene's own disposal point still answers: its nearest tap
    // is 790 m away, so none.
    expect(dumpOf(services)?.drinkingWaterNear).toEqual({
      radiusMetres: 500,
      metres: null,
    });
  });

  // 🔴 MUTATION: `geography` → `geometry` in the ST_DWithin — THE ONE THE
  // CARD NAMES, and it is only this case that sees it. With the `&&` box
  // in front, a geometry ST_DWithin ("within 500 DEGREES") returns exactly
  // what the box lets through, and the box is a square: every case on an
  // axis agrees with the circle. A tap 600 m away on the diagonal is in
  // the square and not in the circle, so with the unit wrong it is found
  // — as 600 m, under a sentence that says "within 500 m".
  it('12. water 600 m away on the diagonal is inside the box and outside the radius: none', async () => {
    const dump = dumpOf(await stage(SCENE.diagonal600));
    expect(dump?.osmRef).toBe('nc_d');
    expect(dump?.drinkingWaterNear).toEqual({
      radiusMetres: 500,
      metres: null,
    });
  });

  // …and the other side of the same corner: 450 m on the diagonal is
  // inside the circle, so a verdict that is too tight (a box, a smaller
  // radius, a buffer approximated from inside) loses it.
  it('11. water 450 m away on the diagonal is inside the radius: found', async () => {
    const dump = dumpOf(await stage(SCENE.diagonal450));
    expect(dump?.osmRef).toBe('nb_d');
    expect(dump?.drinkingWaterNear?.metres).toBeGreaterThanOrEqual(449);
    expect(dump?.drinkingWaterNear?.metres).toBeLessThanOrEqual(451);
  });

  // A stage with no disposal point inside 25 km has no row to carry a
  // field, which is the page's own "our database holds none" and not a
  // water answer.
  it('a stage with no disposal point has no water answer to give', async () => {
    const services = await stage(40.0);
    expect(dumpOf(services)).toBeUndefined();
  });
});

// ── THE PLAN ─────────────────────────────────────────────────────────────
//
// 🔴 `&&` is what makes this a lookup and not a walk of every water point,
// and "the plan uses the water index" does NOT tell the two apart. Measured
// 15.10.2026 on camptribe_dev with the `&&` deleted: still
// `Index Scan using idx_osm_route_poi_water`, still no Seq Scan — and
// `Rows Removed by Filter: 230431`, 3 422 ms for one stage, against 0.025 ms
// with it. The first version of this block asserted only the index name and
// the absence of a sequential scan, and survived the deletion of the very
// line it exists for. What differs between the two plans is the INDEX
// CONDITION: the box is in it, or nothing is.
//
// The endpoint's whole statement is planned with sequential scans off in
// route-services.db.spec.ts; this plans the water subquery ALONE, so that a
// statement whose one `&&` was deleted cannot hide behind the other eight
// kinds' blocks, which use `idx_osm_route_poi_water` too.
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Plans?: PlanNode[];
}

function walkPlan(node: PlanNode, visit: (n: PlanNode) => void) {
  visit(node);
  for (const child of node.Plans ?? []) walkPlan(child, visit);
}

describe('CAMP-254: the water lookup is an index LOOKUP on the water rows', () => {
  it('plans idx_osm_route_poi_water with the box as its Index Cond, and no sequential scan', async () => {
    await db.query('SET enable_seqscan = off');
    let plan: PlanNode;
    try {
      const res = await db.query(
        `EXPLAIN (FORMAT JSON)
         SELECT ${WATER_NEAR_SUBQUERY} AS water_near_m
           FROM (VALUES ('dump'::text, 15.0::float8, 45.01::float8))
                AS p(kind, lon, lat)`,
      );
      plan = res.rows[0]['QUERY PLAN'][0].Plan;
    } finally {
      await db.query('RESET enable_seqscan');
    }
    const scans: { index: string; cond: string | undefined }[] = [];
    const seqScans: string[] = [];
    walkPlan(plan, (n) => {
      if (n['Index Name']) {
        scans.push({ index: n['Index Name'], cond: n['Index Cond'] });
      }
      if (
        n['Node Type'] === 'Seq Scan' &&
        n['Relation Name'] === 'osm_route_poi'
      ) {
        seqScans.push(n['Relation Name']);
      }
    });
    // Anchor: the plan has an index scan at all.
    expect(scans.length).toBeGreaterThan(0);
    expect(scans.map((s) => s.index)).toEqual(['idx_osm_route_poi_water']);
    // The condition the index is searched BY: the box, on `location`.
    // Absent, the same index is read end to end and filtered.
    expect(scans[0].cond ?? '').toMatch(/\(location && /);
    expect(seqScans).toEqual([]);
  });
});
