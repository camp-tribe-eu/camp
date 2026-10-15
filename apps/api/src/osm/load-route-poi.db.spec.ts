import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { RoutePoi1790572800000 } from '../migrations/1790572800000-RoutePoi';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { RoutePoiLpg1791700000000 } from '../migrations/1791700000000-RoutePoiLpg';
import { exportedTags } from './route-poi-export';

// CAMP-258 — THE LOADER ITSELF, RUN AS A PROGRAM.
//
// 🔴 WHY A CHILD PROCESS. `load-route-poi.ts` opens a connection and runs on
// import-by-`node`, so nothing inside it can be unit-tested, and the two
// checks this card put into it — "a kind that loaded nothing rolls the run
// back" and "a fuel population with no lpg=yes rolls it back" — are exactly
// the kind of line that survives deletion with every other test green: the
// functions they call are covered, the CALL is not. route-poi-sql.db.spec.ts
// says the same of the statement; this is the same remedy for the script.
//
// 🔴 IT RUNS THE REAL FILE, against a schema made for this process. The
// connection string carries `search_path`, so the loader's unqualified
// `osm_route_poi` is the spec's table and never the real one, whichever
// database the URL names. Everything is dropped afterwards.
//
// 🔴 THE STAGED OBJECTS ARE WRITTEN OUT BY HAND, one per kind, and not
// derived from STORED_POI_RULES: a fixture generated from the rules would
// stage a kind the day it is added to them, and "a kind that loaded
// nothing" could then never be seen to fail.
//
// A missing database is a FAILURE, not a skip (a skipped test reads as a
// passed one): CI_DATABASE_URL, else DATABASE_URL, else local dev.

jest.setTimeout(180_000);

const BASE_URL =
  process.env.CI_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';

const SCHEMA = `camp258_loader_${process.pid}`;
const API_ROOT = join(__dirname, '../..');
const TS_NODE = require.resolve('ts-node/dist/bin.js');

let db: Client;

/** The loader's own database URL: this process's schema first. */
function loaderUrl(): string {
  const url = new URL(BASE_URL);
  url.searchParams.set('options', `-c search_path=${SCHEMA},public`);
  return url.toString();
}

function runLoader() {
  const res = spawnSync(
    process.execPath,
    [TS_NODE, 'src/osm/load-route-poi.ts'], // as load-route-poi.sh runs it
    {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: loaderUrl() },
      encoding: 'utf8',
      timeout: 150_000,
    },
  );
  return { status: res.status, out: res.stdout, err: res.stderr };
}

/** One object per kind, inside the Slovenian box below. */
const OBJECTS: { id: string; tags: Record<string, string> }[] = [
  { id: 'n1', tags: { amenity: 'fuel', name: 'Petrol' } },
  { id: 'n2', tags: { amenity: 'charging_station' } },
  { id: 'n3', tags: { amenity: 'drinking_water' } },
  { id: 'n4', tags: { amenity: 'sanitary_dump_station' } },
  { id: 'n5', tags: { shop: 'supermarket' } },
  { id: 'n6', tags: { amenity: 'restaurant' } },
  { id: 'n7', tags: { tourism: 'hotel' } },
  { id: 'n8', tags: { highway: 'rest_area' } },
  { id: 'n9', tags: { highway: 'services' } },
  { id: 'n10', tags: { shop: 'gas', name: 'Plin' } },
];

async function stageObject(
  id: string,
  tags: Record<string, string>,
  k: number,
) {
  const cols = Object.keys(tags);
  const names = ['id', 'geom', ...cols.map((c) => `"${c}"`)].join(', ');
  const holders = [
    '$1',
    `ST_Multi(ST_GeomFromText($2, 4326))`,
    ...cols.map((_, i) => `$${i + 3}`),
  ].join(', ');
  await db.query(
    `INSERT INTO osm_route_poi_staging (${names}) VALUES (${holders})`,
    [
      id,
      `POINT(${13.5 + (k % 30) * 0.1} ${45.5 + Math.floor(k / 30) * 0.05})`,
      ...cols.map((c) => tags[c]),
    ],
  );
}

/** `count` fuel stations that say nothing about LPG, spread over the box. */
async function stageFuel(count: number) {
  await db.query(
    `INSERT INTO osm_route_poi_staging (id, geom, amenity)
     SELECT 'n1' || lpad(g::text, 6, '0'),
            ST_Multi(ST_SetSRID(ST_MakePoint(13.2 + (g % 100) * 0.03, 45.2 + (g / 100) * 0.03), 4326)),
            'fuel'
       FROM generate_series(1, $1) g`,
    [count],
  );
}

async function resetStaging(opts: { gas: boolean }) {
  await db.query('TRUNCATE osm_route_poi_staging');
  await db.query('TRUNCATE osm_route_poi');
  let k = 0;
  for (const o of OBJECTS) {
    if (!opts.gas && o.tags.shop === 'gas') continue;
    k += 1;
    await stageObject(o.id, o.tags, k);
  }
}

beforeAll(async () => {
  db = new Client({ connectionString: BASE_URL });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(`SET search_path = ${SCHEMA}, public`);

  const qr = {
    query: (sql: string) => db.query(sql),
  } as unknown as QueryRunner;
  await new RoutePoi1790572800000().up(qr);
  await new RoutePoiFacilities1791400000000().up(qr);
  await new RoutePoiLpg1791700000000().up(qr);

  await db.query(
    `CREATE TABLE ne_admin1 (geom geometry(MultiPolygon, 4326), iso_a2 text, admin text)`,
  );
  await db.query(
    `INSERT INTO ne_admin1
     VALUES (ST_Multi(ST_MakeEnvelope(13, 45, 17, 47, 4326)), 'SI', 'Slovenia')`,
  );
  // A column for every tag the export carries — `fuel:lpg` included, from
  // the file osmium is given — so a tag dropped from it is a column missing
  // here and the loader fails naming it.
  const tagColumns = exportedTags()
    .map((t) => `"${t}" text`)
    .join(', ');
  await db.query(
    `CREATE TABLE osm_route_poi_staging (id text, geom geometry, ${tagColumns})`,
  );
});

afterAll(async () => {
  if (!db) return;
  await db.query('RESET search_path');
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

describe('the loader, run as a program (CAMP-258)', () => {
  // 🔴 MUTATION: delete the `if (lpgFailure !== null) throw` line in
  // load-route-poi.ts — or the `lpgArrivalError` call above it. Every unit
  // test of `lpgArrivalError` stays green and a run in which `fuel:lpg`
  // never arrived commits 154 000 stations that all say `unknown`.
  it('rolls back, and publishes nothing, when 1 000 fuel stations arrive and none says lpg=yes', async () => {
    await resetStaging({ gas: true });
    await stageFuel(999); // + n1 = 1 000 fuel rows, the floor
    const run = runLoader();
    expect({ status: run.status, err: run.err }).toEqual({
      status: 1,
      err: expect.stringContaining('1000 fuel rows and not one says lpg=yes'),
    });
    // rolled back: the table is exactly what it was — empty — and not the
    // ten kinds the INSERT had already written when the guard fired
    expect(
      (await db.query('SELECT count(*)::int AS n FROM osm_route_poi')).rows[0]
        .n,
    ).toBe(0);
  });

  // 🔴 The same population, one station short of the floor: not a finding.
  it('does not refuse a small population with no lpg=yes in it', async () => {
    await resetStaging({ gas: true });
    await stageFuel(998); // + n1 = 999
    const run = runLoader();
    expect({ status: run.status, err: run.err }).toEqual({
      status: 0,
      err: expect.not.stringContaining('lpg=yes'),
    });
  });

  // 🔴 MUTATION: stop printing the distribution, or print it from the wrong
  // column. What is asserted is the DATABASE'S answer and the loader's
  // printed one, side by side: they must agree.
  it('publishes the run, and says what the fuel stations said about LPG', async () => {
    await resetStaging({ gas: true });
    await stageFuel(1000); // + n1 = 1 001 fuel rows
    await db.query(
      `UPDATE osm_route_poi_staging SET "fuel:lpg" = 'yes' WHERE id IN ('n1000001', 'n1000002', 'n1000003')`,
    );
    await db.query(
      `UPDATE osm_route_poi_staging SET "fuel:lpg" = 'no' WHERE id IN ('n1000004', 'n1000005')`,
    );
    // a closed way arrives twice (`w900`, and the area `a1800` = way 900 × 2)
    // and the older kinds are not folded: two ROWS, one OBJECT, both saying yes
    await stageObject('w900', { amenity: 'fuel', 'fuel:lpg': 'yes' }, 41);
    await stageObject('a1800', { amenity: 'fuel', 'fuel:lpg': 'yes' }, 41);
    const run = runLoader();
    expect(run.status).toBe(0);
    const by = (
      await db.query(
        `SELECT lpg, count(*)::int AS n FROM osm_route_poi WHERE kind = 'fuel' GROUP BY 1 ORDER BY 1`,
      )
    ).rows;
    expect(by).toEqual([
      { lpg: 'no', n: 2 },
      { lpg: 'unknown', n: 996 },
      { lpg: 'yes', n: 5 },
    ]);
    // five rows say yes and they are FOUR stations: the two closed-way twins
    // are one. Only the second number is comparable with a count of objects.
    expect(run.out).toContain(
      'fuel lpg (rows / objects): yes 5 / 4  no 2 / 2  unknown 996 / 996',
    );
    // …and the new kind is in the table, and in the printed counts
    expect(
      (
        await db.query(
          `SELECT osm_ref FROM osm_route_poi WHERE kind = 'gas_exchange'`,
        )
      ).rows,
    ).toEqual([{ osm_ref: 'n10' }]);
    expect(run.out).toMatch(/gas_exchange\s+1\n/);
  });

  // 🔴 THE CARD'S OWN CHECK, RUN: "gas_exchange non-empty". With no gas shop
  // staged — which is what an osmium filter that forgot `shop=gas` produces —
  // the run must abort naming the kind, and publish nothing. It is the
  // loader's per-kind check; what makes STORED_POI_KINDS the list it reads
  // is the one line this test is for.
  //
  // 🔴 MUTATION: make that check read ROUTE_POI_KINDS instead of
  // STORED_POI_KINDS. The ten kinds the table holds become the nine a page
  // shows and a missing gas shop passes unnoticed.
  it('aborts when a run loaded no gas_exchange at all', async () => {
    await resetStaging({ gas: false });
    await stageFuel(10);
    await db.query(
      `UPDATE osm_route_poi_staging SET "fuel:lpg" = 'yes' WHERE id = 'n1000001'`,
    );
    const run = runLoader();
    expect({ status: run.status, err: run.err }).toEqual({
      status: 1,
      err: expect.stringContaining('these kinds loaded nothing: gas_exchange'),
    });
    expect(
      (await db.query('SELECT count(*)::int AS n FROM osm_route_poi')).rows[0]
        .n,
    ).toBe(0);
  });
});
