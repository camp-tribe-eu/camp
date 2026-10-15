import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { feature } from '../osm/compute-context';
import {
  CONTEXT_SQL,
  contextParams,
  STATION_RAILWAY_VALUES,
  TOWN_PLACE_VALUES,
} from '../osm/context-sql';
import { loadMeasuredReasons, reasonsOf } from './reasons';
import { COMPONENTS } from './scoring';

// CAMP-245 — from a row of the OSM layer to the sentence a reader sees, with
// the SQL that writes `camping_spots.context` in between.
//
// 🔴 WHY THIS IS A DATABASE TEST. The review of PR #256 measured that
// `context.station` is `railway=station` OR `railway=halt` (3 163 of 9 838
// station reasons stood on a halt) and `context.town` is `place=city` OR
// `place=town` (197 of 3 524 on a city), while the sentence said "Railway
// station" and "Town" for all of them. A spec that handed `reasonsOf` a
// context object it had typed would have agreed with that: the object has no
// kind, so nothing in it could be wrong. The fact lives in the LAYER, so the
// rows here are put in the layer, run through the real CONTEXT_SQL and the
// importer's own `feature()`, and only then read.
//
// What is proved, and what is not: the stored context carries NO kind (a
// spec says so), so one sentence has to be true for both; each case below
// names the OSM value its campsite stands on and shows the row really came
// from it. That the layer's filter admits these values and no others is
// pinned from the constants the SQL is built from.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI): any PostGIS
// database you may CREATE DATABASE in. This file creates its own
// `camp245l_*` database and drops it.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
const SCRIPTS = join(__dirname, '../../../../scripts/osm-pipeline');
const TAG_SQL = readFileSync(join(SCRIPTS, 'tag-ctx-country.sql'), 'utf8');

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

/** Each campsite stands 25-35 m from ITS feature and 100+ km from the others. */
const CASES: Array<{
  spot: string;
  layer: 'poi' | 'place';
  kind: string;
  name: string;
  lon: number;
}> = [
  { spot: 'by-halt', layer: 'poi', kind: 'halt', name: 'Hamnen', lon: 2.0 },
  { spot: 'by-station', layer: 'poi', kind: 'station', name: 'Gare', lon: 4.0 },
  {
    spot: 'by-city',
    layer: 'place',
    kind: 'city',
    name: 'Lyonville',
    lon: 6.0,
  },
  { spot: 'by-town', layer: 'place', kind: 'town', name: 'Bourg', lon: 8.0 },
];
const LAT = 45;
/** 0.0004 degrees of longitude at 45°N: about 31 m. */
const SIDE = 0.0004;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp245l_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // The columns CONTEXT_SQL reads, with the types the real tables have; the
  // layers have no `country` until the loader's own tagging file adds it.
  await db.query(`
    CREATE TABLE camping_spots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug varchar,
      location geometry(Point, 4326), context jsonb,
      missing_since timestamptz, country varchar);
    CREATE TABLE osm_ctx_place (
      ogc_fid serial PRIMARY KEY, id varchar, name varchar, place varchar,
      geom geometry(MultiPoint, 4326));
    CREATE TABLE osm_ctx_poi (
      ogc_fid serial PRIMARY KEY, id varchar, name varchar, railway varchar,
      shop varchar, geom geometry(Geometry, 4326));
    CREATE TABLE osm_ctx_water (
      ogc_fid serial PRIMARY KEY, id varchar, name varchar, "natural" varchar,
      water varchar, waterway varchar, geom geometry(Geometry, 4326));
    CREATE TABLE osm_country_area (iso text NOT NULL, geom geometry(Polygon, 4326) NOT NULL);
    CREATE INDEX ON osm_ctx_place USING GIST (geom);
    CREATE INDEX ON osm_ctx_poi USING GIST (geom);
    CREATE INDEX ON osm_ctx_water USING GIST (geom);
    INSERT INTO osm_country_area (iso, geom)
      VALUES ('fr', ST_MakeEnvelope(0, 40, 10, 50, 4326));`);
  for (const c of CASES) {
    const pt = `ST_SetSRID(ST_MakePoint(${c.lon}, ${LAT}), 4326)`;
    if (c.layer === 'poi') {
      await db.query(
        `INSERT INTO osm_ctx_poi (id, name, railway, geom) VALUES ($1, $2, $3, ${pt})`,
        [`n-${c.spot}`, c.name, c.kind],
      );
    } else {
      await db.query(
        `INSERT INTO osm_ctx_place (id, name, place, geom)
         VALUES ($1, $2, $3, ST_Multi(${pt}))`,
        [`n-${c.spot}`, c.name, c.kind],
      );
    }
    await db.query(
      `INSERT INTO camping_spots (slug, location, country)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), 'FR')`,
      [c.spot, c.lon + SIDE, LAT],
    );
  }
  // The loader's own file stamps the country on the layers.
  await db.query(TAG_SQL);
  await db.query('ANALYZE');
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

interface Row {
  slug: string;
  town_m: number | null;
  town_name: string | null;
  shop_m: number | null;
  shop_name: string | null;
  rail_m: number | null;
  rail_name: string | null;
}

/** The context the importer would store for this campsite, and what it reads as. */
async function reasonsFor(slug: string) {
  const { rows } = await db.query<Row>(
    CONTEXT_SQL,
    contextParams(null) as unknown[],
  );
  const r = rows.find((x) => x.slug === slug);
  expect(r).toBeDefined();
  // The three the context job writes from these columns (compute-context.ts).
  const context = {
    town: feature(r.town_m, r.town_name),
    supermarket: feature(r.shop_m, r.shop_name),
    station: feature(r.rail_m, r.rail_name),
  };
  return {
    row: r,
    context,
    reasons: reasonsOf(
      { amenities: {}, stars: null, context },
      loadMeasuredReasons(),
      COMPONENTS,
    ),
  };
}

describe('the layer admits exactly these kinds, and the sentence is written for all of them', () => {
  it('stations and halts; cities and towns — pinned from the constants the SQL is built from', () => {
    expect([...STATION_RAILWAY_VALUES]).toEqual(['station', 'halt']);
    expect([...TOWN_PLACE_VALUES]).toEqual(['city', 'town']);
    expect(CONTEXT_SQL).toContain("x.railway IN ('station','halt')");
    expect(CONTEXT_SQL).toContain("x.place IN ('city','town')");
  });

  it('anchor: each campsite’s feature really is of the kind its name says', async () => {
    const poi = await db.query(
      `SELECT name, railway FROM osm_ctx_poi ORDER BY name`,
    );
    expect(poi.rows).toEqual([
      { name: 'Gare', railway: 'station' },
      { name: 'Hamnen', railway: 'halt' },
    ]);
    const place = await db.query(
      `SELECT name, place FROM osm_ctx_place ORDER BY name`,
    );
    expect(place.rows).toEqual([
      { name: 'Bourg', place: 'town' },
      { name: 'Lyonville', place: 'city' },
    ]);
  });

  it('the stored context has no kind: `{ m, name }` is all there is to say it with', async () => {
    const { context } = await reasonsFor('by-halt');
    expect(Object.keys(context.station).sort()).toEqual(['m', 'name']);
  });
});

describe('🔴 railway=halt and railway=station get the same, true, sentence', () => {
  it('a HALT: the row came from the halt, and the sentence does not call it a station', async () => {
    const { row, reasons } = await reasonsFor('by-halt');
    expect(row.rail_name).toBe('Hamnen');
    const r = reasons.find((x) => x.field === 'context.station');
    expect(r?.text).toBe(
      `Railway stop (Hamnen) ${Math.round(row.rail_m)} m away in a straight line`,
    );
    expect(r?.text).not.toMatch(/station/i);
    // The distance is the SQL's: tens of metres, not a figure typed here.
    expect(row.rail_m).toBeGreaterThan(20);
    expect(row.rail_m).toBeLessThan(40);
  });

  it('a STATION: the same words — the label does not depend on what the context cannot say', async () => {
    const { row, reasons } = await reasonsFor('by-station');
    expect(row.rail_name).toBe('Gare');
    const r = reasons.find((x) => x.field === 'context.station');
    expect(r?.text).toBe(
      `Railway stop (Gare) ${Math.round(row.rail_m)} m away in a straight line`,
    );
  });
});

describe('🔴 place=city and place=town get the same, true, sentence', () => {
  it('a CITY: the row came from the city, and the sentence does not call it a town', async () => {
    const { row, reasons } = await reasonsFor('by-city');
    expect(row.town_name).toBe('Lyonville');
    const r = reasons.find((x) => x.field === 'context.town');
    expect(r?.text).toBe(
      `City or town (Lyonville) ${Math.round(row.town_m)} m away in a straight line`,
    );
    expect(r?.text).not.toMatch(/^Town\b/);
    expect(row.town_m).toBeGreaterThan(20);
    expect(row.town_m).toBeLessThan(40);
  });

  it('a TOWN: the same words', async () => {
    const { row, reasons } = await reasonsFor('by-town');
    expect(row.town_name).toBe('Bourg');
    const r = reasons.find((x) => x.field === 'context.town');
    expect(r?.text).toBe(
      `City or town (Bourg) ${Math.round(row.town_m)} m away in a straight line`,
    );
  });
});

describe('a feature that is not near is not said', () => {
  it('the halt campsite has no town reason: the nearest town is 200 km away', async () => {
    const { row, reasons } = await reasonsFor('by-halt');
    expect(row.town_m).toBeGreaterThan(100_000);
    expect(reasons.map((r) => r.field)).toEqual(['context.station']);
  });
});
