import { Client } from 'pg';
import { countRegionInsights } from './region-insights';

// "Driving a camper here" (CAMP-404) — the MEDIAN distances, against a REAL
// PostgreSQL. The sentence is built on the web side; what this file pins is
// the one number the web cannot check: that the API's figure is a median of
// the rows that HAVE a distance, and that one absurd row does not move it.
//
// 🔴 EVERY EXPECTED NUMBER IS COUNTED BY HAND from the rows below, never
// by a query of this file's own. A test that re-derives the median with
// the formula under test confirms the formula, not the fact.
//
// 🔴 THE MUTATIONS THIS FILE EXISTS FOR (matrix in the pull request):
//   · percentile_cont(0.5) → avg(...)         supermarket 700 → 378 061
//   · percentile_cont(0.5) → percentile_disc  town 2 500 → 2 000
//   · `known` counted over all rows            supermarket 5 → 6, town 4 → 6
//
// Needs CAMP_TEST_DATABASE_URL or CI_DATABASE_URL (any PostGIS database
// you may CREATE DATABASE in); this file makes its own `campdriving_*`
// database and drops it. A missing database is a FAILURE, not a skip.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const query = async (sql: string, params: unknown[]) =>
  (await db.query(sql, params)).rows;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `campdriving_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(`
    CREATE TYPE camping_spots_type_enum AS ENUM
      ('free', 'paid', 'wild', 'camper_stop', 'rv_park');
    CREATE TABLE camping_spots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      osm_ref varchar UNIQUE,
      name varchar, country varchar NOT NULL, region varchar,
      slug varchar NOT NULL UNIQUE,
      type camping_spots_type_enum NOT NULL,
      amenities jsonb NOT NULL DEFAULT '{}',
      context jsonb NOT NULL DEFAULT '{}',
      context_computed_at timestamptz,
      location geometry(Point, 4326) NOT NULL,
      last_seen_at timestamptz, missing_since timestamptz,
      overnight_status varchar NOT NULL DEFAULT 'unknown',
      overnight_source varchar, overnight_checked_at date);
    CREATE TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());`);
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

async function insert(
  slug: string,
  region: string,
  type: string,
  context: Record<string, unknown>,
  gone = false,
) {
  await db.query(
    `INSERT INTO camping_spots
       (osm_ref, name, country, region, slug, type, context,
        context_computed_at, location, last_seen_at, missing_since)
     VALUES ($1, $1, 'SI', $2, $1, $3, $4, '2026-09-25T00:00:00Z',
             ST_SetSRID(ST_MakePoint(14, 45), 4326), '2026-10-16T14:00:00Z', $5)`,
    [
      slug,
      region,
      type,
      JSON.stringify(context),
      gone ? '2026-10-01T00:00:00Z' : null,
    ],
  );
}

const near = (supermarket: number | null, town: number | null) => ({
  ...(supermarket === null ? {} : { supermarket: { m: supermarket } }),
  ...(town === null ? {} : { town: { m: town } }),
});

// ── THE FIXTURE, ONE ROW PER LINE. Count it by eye; the tests do. ──────
//
// Trenta, Slovenia — published rows:
//
//   slug  type         supermarket.m  town.m
//   t01   rv_park      500            1000
//   t02   paid         600            2000
//   t03   paid         700            3000
//   t04   paid         800            4000
//   t05   paid         1 887 707 *    (none)
//   t06   camper_stop  (no context)
//   t-gone  paid, missing_since set   1       1      ← must change nothing
//
//   * the survey's largest distance (1 887 707 m, a per-country extract
//     artefact): one record 1 888 km away.
//
// Hand count:
//   spots 6
//   supermarket known 5 (t01–t05). Sorted 500, 600, 700, 800, 1 887 707 →
//     the middle is the third: 700. The mean would be
//     1 890 307 / 5 = 378 061.4.
//   town known 4 (t01–t04). Sorted 1 000, 2 000, 3 000, 4 000 → the
//     middle two are 2 000 and 3 000 → 2 500. (percentile_disc: 2 000.)
//   The gone row, had it counted: supermarket known 6, median
//     (600 + 700) / 2 = 650; town known 5, median 2 000.
beforeAll(async () => {
  await insert('t01', 'Trenta', 'rv_park', near(500, 1000));
  await insert('t02', 'Trenta', 'paid', near(600, 2000));
  await insert('t03', 'Trenta', 'paid', near(700, 3000));
  await insert('t04', 'Trenta', 'paid', near(800, 4000));
  await insert('t05', 'Trenta', 'paid', near(1_887_707, null));
  await insert('t06', 'Trenta', 'camper_stop', {});
  await insert('t-gone', 'Trenta', 'paid', near(1, 1), true);
  // A region where nothing is computed.
  await insert('v01', 'Vipava', 'paid', {});
});

describe('the median distances of a region', () => {
  it('🔴 the supermarket figure is the MEDIAN: one record 1 888 km away does not move it', async () => {
    const i = await countRegionInsights(query, 'si', 'Trenta');
    expect(i.spots).toBe(6);
    expect(i.surroundings.supermarket.medianM).toBe(700);
    // The number a mean would have printed, so the contrast is in the test.
    expect(i.surroundings.supermarket.medianM).not.toBe(378_061);
  });

  it('🔴 an even count takes the middle two: 1 000, 2 000, 3 000, 4 000 → 2 500', async () => {
    const i = await countRegionInsights(query, 'si', 'Trenta');
    expect(i.surroundings.town.medianM).toBe(2500);
  });

  it("🔴 `known` is the rows WITH a distance — 5 and 4 — never the region's 6", async () => {
    const i = await countRegionInsights(query, 'si', 'Trenta');
    expect(i.surroundings.supermarket.known).toBe(5);
    expect(i.surroundings.town.known).toBe(4);
    expect(i.spots).toBe(6);
  });

  it('a row gone from OpenStreetMap is in neither the count nor the median', async () => {
    const i = await countRegionInsights(query, 'si', 'Trenta');
    // Had t-gone counted: 6 and 650 for the shop, 5 and 2 000 for the town.
    expect(i.surroundings.supermarket).toMatchObject({
      known: 5,
      medianM: 700,
    });
    expect(i.surroundings.town).toMatchObject({ known: 4, medianM: 2500 });
  });

  it('a region with nothing computed has no median — null, not 0', async () => {
    const i = await countRegionInsights(query, 'si', 'Vipava');
    expect(i.spots).toBe(1);
    expect(i.surroundings.supermarket).toEqual({
      known: 0,
      within: 0,
      medianM: null,
    });
    expect(i.surroundings.town).toEqual({ known: 0, medianM: null });
  });
});
