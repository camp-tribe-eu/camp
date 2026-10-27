import { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { SpotsService } from './spots.service';
import { countRegionInsights, NEARBY_M } from './region-insights';

// "Camping in <region>" — the counts, against a REAL PostgreSQL.
//
// 🔴 WHY A DATABASE, and why the rows are typed in by hand. The rule this
// card exists for is "the denominator is what OpenStreetMap recorded, not
// the region" — a statement about which rows a FILTER keeps. The
// expectations below are counted on paper from the fixture as written
// (each row is one line, its value in the open), never by a query of this
// file's own: a test that re-counts with the formula under test confirms
// the formula, not the fact. That is the defect this project was caught
// on the day this file was written.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP (overnight.db.spec.ts
// says why). Needs CAMP_TEST_DATABASE_URL or CI_DATABASE_URL; this file
// creates its own `campinsights_*` database and drops it.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const query = async (sql: string, params: unknown[]) =>
  (await db.query(sql, params)).rows;

const asDataSource = (): DataSource => ({ query }) as unknown as DataSource;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `campinsights_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // The columns the two statements and `regions()` touch, with the real
  // table's types — the hand-made table is the precedent (context-sql,
  // overnight). `spot_links` because `notSecondarySql` reads it.
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

interface Row {
  slug: string;
  country?: string;
  region?: string | null;
  type?: string;
  amenities?: Record<string, string>;
  context?: Record<string, unknown>;
  computedAt?: string | null;
  seenAt?: string;
  gone?: boolean;
}

async function insert(r: Row): Promise<string> {
  const res = await db.query(
    `INSERT INTO camping_spots
       (osm_ref, name, country, region, slug, type, amenities, context,
        context_computed_at, location, last_seen_at, missing_since)
     VALUES ($1, $1, $2, $3, $1, $4, $5, $6, $7,
             ST_SetSRID(ST_MakePoint(14, 45), 4326), $8, $9)
     RETURNING id`,
    [
      r.slug,
      r.country ?? 'SI',
      r.region === undefined ? 'Bovec' : r.region,
      r.type ?? 'paid',
      JSON.stringify(r.amenities ?? {}),
      JSON.stringify(r.context ?? {}),
      r.computedAt ?? null,
      r.seenAt ?? '2026-10-16T14:00:00Z',
      r.gone ? '2026-10-01T00:00:00Z' : null,
    ],
  );
  return res.rows[0].id as string;
}

// ── THE FIXTURE, ONE ROW PER LINE. Count it by eye; the tests do. ──────
//
// Bovec, Slovenia — published rows (missing_since null, not a secondary):
//
//   slug  type         electricity  toilets  shower   supermarket.m  station.m  water
//   b01   paid         yes          yes      yes      500            100        Lake Bohinj 10
//   b02   paid         yes          yes      yes      1999           1500       Lake Bohinj 20
//   b03   paid         yes          yes      no       2000           2500       Lake Bohinj 30
//   b04   paid         yes          yes      (absent) 2001           150000*    Lake Bohinj 40
//   b05   paid         no           yes      unknown  5000           90000      Lake Bohinj 1500
//   b06   paid         no           unknown  unknown  12000          3000       Soča 80
//   b07   rv_park      unknown      unknown  unknown  300            400        Soča 90
//   b08   rv_park      unknown      (absent) unknown  (no context)              —
//   b09   camper_stop  (absent)     unknown  unknown  (no context)              —
//   b10   wild         unknown      unknown  unknown  (no context)              river, no name 50
//
//   * 150 000 m: the per-country extract's "nearest station" artefact.
//     For "within 2 km" it is a correct no, so it stays in the
//     denominator — see the test on it.
//
// Rows that must NOT be counted, all with every amenity = yes:
//   b-gone      Bovec, missing_since set
//   b-secondary Bovec, linked as the secondary of b01
//   k-xx        Kobarid (another region, same country), 3 rows
//   hr-bovec    region "Bovec" in HR (another country)
//
// Hand count for Bovec:
//   spots 10; types paid 6, rv_park 2, camper_stop 1, free 0, wild 1
//   electricity yes 4 (b01-b04), no 2 (b05, b06)   → 4 unknown/absent
//   toilets     yes 5 (b01-b05), no 0
//   shower      yes 2 (b01, b02), no 1 (b03)
//   supermarket known 7 (b01-b07), within 2 000 m: b01 500, b02 1999,
//     b03 2000, b07 300 → 4
//   station known 7 (b01-b07, b04's 150 000 m included); within 2 000:
//     b01 100, b02 1500, b07 400 → 3
//   water named 7 (b01-b07); top "Lake Bohinj" 5 sites, 10 m … 1 500 m
//   readAt = max(last_seen_at) = 2026-10-18 (b07 is the newest)
//   computedAt = max(context_computed_at) = 2026-09-25 (b05)

const ctx = (
  supermarket: number | null,
  station: number | null,
  water: { name?: string; m: number } | null,
) => ({
  ...(supermarket === null
    ? {}
    : { supermarket: { m: supermarket, name: 'Mercator' } }),
  ...(station === null ? {} : { station: { m: station } }),
  ...(water === null ? {} : { water: { kind: 'lake', ...water } }),
});

const lake = (m: number) => ({ name: 'Lake Bohinj', m });
const soca = (m: number) => ({ name: 'Soča', m });

beforeAll(async () => {
  const b01 = await insert({
    slug: 'b01',
    amenities: { electricity: 'yes', toilets: 'yes', shower: 'yes' },
    context: ctx(500, 100, lake(10)),
    computedAt: '2026-09-20T00:00:00Z',
  });
  await insert({
    slug: 'b02',
    amenities: { electricity: 'yes', toilets: 'yes', shower: 'yes' },
    context: ctx(1999, 1500, lake(20)),
    computedAt: '2026-09-20T00:00:00Z',
  });
  await insert({
    slug: 'b03',
    amenities: { electricity: 'yes', toilets: 'yes', shower: 'no' },
    context: ctx(2000, 2500, lake(30)),
    computedAt: '2026-09-20T00:00:00Z',
  });
  await insert({
    slug: 'b04',
    amenities: { electricity: 'yes', toilets: 'yes' },
    context: ctx(2001, 150_000, lake(40)),
    computedAt: '2026-09-20T00:00:00Z',
  });
  await insert({
    slug: 'b05',
    amenities: { electricity: 'no', toilets: 'yes', shower: 'unknown' },
    context: ctx(5000, 90_000, lake(1500)),
    computedAt: '2026-09-25T00:00:00Z',
  });
  await insert({
    slug: 'b06',
    amenities: { electricity: 'no', toilets: 'unknown', shower: 'unknown' },
    context: ctx(12_000, 3000, soca(80)),
    computedAt: '2026-09-20T00:00:00Z',
  });
  await insert({
    slug: 'b07',
    type: 'rv_park',
    amenities: {
      electricity: 'unknown',
      toilets: 'unknown',
      shower: 'unknown',
    },
    context: ctx(300, 400, soca(90)),
    computedAt: '2026-09-20T00:00:00Z',
    seenAt: '2026-10-18T09:00:00Z',
  });
  await insert({
    slug: 'b08',
    type: 'rv_park',
    amenities: { electricity: 'unknown', shower: 'unknown' },
  });
  await insert({
    slug: 'b09',
    type: 'camper_stop',
    amenities: { toilets: 'unknown', shower: 'unknown' },
  });
  await insert({
    slug: 'b10',
    type: 'wild',
    amenities: {
      electricity: 'unknown',
      toilets: 'unknown',
      shower: 'unknown',
    },
    context: { water: { kind: 'river', m: 50 } },
    computedAt: '2026-09-20T00:00:00Z',
  });

  const all = { electricity: 'yes', toilets: 'yes', shower: 'yes' };
  const gone = {
    slug: 'b-gone',
    amenities: all,
    gone: true,
    context: ctx(100, 100, lake(5)),
    computedAt: '2026-10-01T00:00:00Z',
  };
  await insert(gone);
  const secondary = await insert({
    slug: 'b-secondary',
    amenities: all,
    context: ctx(100, 100, lake(5)),
    computedAt: '2026-10-01T00:00:00Z',
  });
  await db.query(
    `INSERT INTO spot_links (primary_id, secondary_id) VALUES ($1, $2)`,
    [b01, secondary],
  );
  for (const k of ['k01', 'k02', 'k03']) {
    await insert({
      slug: k,
      region: 'Kobarid',
      amenities: all,
      context: ctx(100, 100, lake(5)),
      computedAt: '2026-10-01T00:00:00Z',
    });
  }
  await insert({
    slug: 'hr-bovec',
    country: 'HR',
    amenities: all,
    context: ctx(100, 100, lake(5)),
    computedAt: '2026-10-01T00:00:00Z',
  });
});

describe('countRegionInsights over Bovec', () => {
  it('counts the published rows of the region and no others', async () => {
    const i = await countRegionInsights(query, 'si', 'Bovec');
    expect(i.region).toBe('Bovec');
    expect(i.spots).toBe(10);
    expect(i.types).toEqual({
      paid: 6,
      rv_park: 2,
      camper_stop: 1,
      free: 0,
      wild: 1,
    });
  });

  // 🔴 THE RULE. 4 yes, 2 no — and the 4 rows that are unknown or have no
  // key at all are in NEITHER figure. A mutation that counts "not yes" as
  // no (no = 6) or "not no" as yes (yes = 8) turns this red.
  it('🔴 an amenity is yes and no as recorded; unknown and absent are in neither', async () => {
    const i = await countRegionInsights(query, 'si', 'Bovec');
    expect(i.amenities.electricity).toEqual({ yes: 4, no: 2 });
    expect(i.amenities.toilets).toEqual({ yes: 5, no: 0 });
    expect(i.amenities.shower).toEqual({ yes: 2, no: 1 });
    // The denominator the page will add up is NOT the region's 10.
    expect(i.amenities.electricity.yes + i.amenities.electricity.no).toBe(6);
  });

  it('names the day of the newest import, not the oldest', async () => {
    const i = await countRegionInsights(query, 'si', 'Bovec');
    expect(i.readAt).toBe('2026-10-18');
    expect(i.surroundings.computedAt).toBe('2026-09-25');
  });

  it('supermarket: known is rows with a distance, within is ≤ 2 000 m inclusive', async () => {
    expect(NEARBY_M).toBe(2000);
    const i = await countRegionInsights(query, 'si', 'Bovec');
    expect(i.surroundings.supermarket).toEqual({ known: 7, within: 4 });
  });

  // 🔴 THE REVIEW'S FINDING. b04's nearest station is 150 km away — an
  // extract artefact as a distance, but a correct "not within 2 km". The
  // first version cut such rows from the denominator and printed, on
  // fi/Lapland, "of the 63" where 173 rows were computed. The denominator
  // must be the computed rows, the same 7 the supermarket has; a mutation
  // that brings the 100 km cut back reads 6 here and turns this red.
  it('🔴 station: a stop 150 km away stays in the denominator as a no; 2 500 m is not within', async () => {
    const i = await countRegionInsights(query, 'si', 'Bovec');
    expect(i.surroundings.station).toEqual({ known: 7, within: 3 });
    expect(i.surroundings.station.known).toBe(i.surroundings.supermarket.known);
  });

  it('water: only NAMED water is counted, and the top name carries its span', async () => {
    const i = await countRegionInsights(query, 'si', 'Bovec');
    expect(i.surroundings.water).toEqual({
      named: 7,
      top: { name: 'Lake Bohinj', sites: 5, nearestM: 10, farthestM: 1500 },
    });
  });

  it('a region with no context has no computed day and no top water', async () => {
    await insert({
      slug: 'n01',
      region: 'Nowhere',
      amenities: { electricity: 'yes' },
    });
    const i = await countRegionInsights(query, 'si', 'Nowhere');
    expect(i.spots).toBe(1);
    expect(i.readAt).toBe('2026-10-16');
    expect(i.surroundings).toEqual({
      computedAt: null,
      supermarket: { known: 0, within: 0 },
      station: { known: 0, within: 0 },
      water: { named: 0, top: null },
    });
  });

  it('the other region and the other country are counted on their own', async () => {
    const k = await countRegionInsights(query, 'SI', 'Kobarid');
    expect(k.spots).toBe(3);
    expect(k.amenities.electricity).toEqual({ yes: 3, no: 0 });
    const hr = await countRegionInsights(query, 'hr', 'Bovec');
    expect(hr.spots).toBe(1);
  });
});

describe('SpotsService.regionInsights', () => {
  it('resolves the slug the page URL carries, and is null for a slug that is no region', async () => {
    const svc = new SpotsService(asDataSource());
    const i = await svc.regionInsights('si', 'bovec');
    expect(i?.region).toBe('Bovec');
    expect(i?.spots).toBe(10);
    expect(await svc.regionInsights('si', 'no-such-region')).toBeNull();
    expect(await svc.regionInsights('xx', 'bovec')).toBeNull();
  });

  it('counts the same rows the listing shows: the total agrees with regionSpots', async () => {
    const svc = new SpotsService(asDataSource());
    const listing = await svc.regionSpots('si', 'bovec');
    const i = await svc.regionInsights('si', 'bovec');
    expect(listing.total).toBe(10);
    expect(i?.spots).toBe(listing.total);
  });
});
