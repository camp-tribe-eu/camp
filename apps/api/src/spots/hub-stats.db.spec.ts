import { Client } from 'pg';
import type { DataSource, QueryRunner } from 'typeorm';
import { SpotOvernight1791500000000 } from '../migrations/1791500000000-SpotOvernight';
import { SpotsService } from './spots.service';

// The hub pages' figures, against a REAL PostgreSQL — the same reason
// overnight.db.spec.ts gives: what is counted and what is left out is a
// statement about rows, and a test on the SHAPE of the SQL string would
// pass a FILTER with the wrong column in it.
//
// 🔴 EVERY EXPECTED NUMBER IS COUNTED BY HAND from the fixture below,
// never re-derived here. The fixture is built so that each exclusion
// costs exactly one row: a missing site, a secondary copy, a site with
// no region; and each price rule costs exactly one tariff: per week,
// undated, not in euro.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI sets it): any
// PostGIS database you may CREATE DATABASE in. This file creates its own
// `camphub_*` database and drops it; it reads and writes nothing in the
// one you name.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const asDataSource = (): DataSource =>
  ({
    query: async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params)).rows,
  }) as unknown as DataSource;

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
  dbName = `camphub_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');

  // The columns the query touches, with the types the real tables have
  // (`spot_tariffs.min_price` is numeric(10,2): "9.50" must come back as
  // written). The overnight columns come from the real migration.
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
      location geometry(Point, 4326) NOT NULL,
      last_seen_at timestamptz, missing_since timestamptz);
    CREATE TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE spot_tariffs (
      id serial PRIMARY KEY,
      spot_id uuid NOT NULL,
      mode text, currency text NOT NULL,
      min_price numeric(10,2),
      valid_from date, valid_until date);`);
  await new SpotOvernight1791500000000().up(runner());

  const spot = async (
    slug: string,
    type: string,
    o: {
      region?: string | null;
      electricity?: string;
      overnight?: ['allowed' | 'forbidden', string];
      seen?: string | null;
      missing?: string;
    } = {},
  ): Promise<string> => {
    const r = await db.query(
      `INSERT INTO camping_spots
         (osm_ref, country, region, slug, type, amenities, location,
          last_seen_at, missing_since,
          overnight_status, overnight_source, overnight_checked_at)
       VALUES ($1, 'HR', $2, $1, $3::camping_spots_type_enum, $4,
               ST_SetSRID(ST_MakePoint(14, 45), 4326), $5, $6,
               $7, $8, $9)
       RETURNING id`,
      [
        slug,
        o.region === undefined ? 'Istria' : o.region,
        type,
        o.electricity ? { electricity: o.electricity } : {},
        o.seen === undefined ? '2026-10-12T05:00:00Z' : o.seen,
        o.missing ?? null,
        o.overnight?.[0] ?? 'unknown',
        o.overnight ? 'osm:motorhome=yes' : null,
        o.overnight?.[1] ?? null,
      ],
    );
    return r.rows[0].id as string;
  };
  const tariff = (
    spotId: string,
    mode: string | null,
    currency: string,
    min: string,
    dates: { from?: string; until?: string } = {},
  ) =>
    db.query(
      `INSERT INTO spot_tariffs (spot_id, mode, currency, min_price, valid_from, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [spotId, mode, currency, min, dates.from ?? null, dates.until ?? null],
    );

  // ── Istria: three counted sites ────────────────────────────────────
  // s1 paid · electricity yes · allowed · dated overnight €12.00 (counted),
  //    per-week €80 (not), undated overnight €5.00 (not)
  const s1 = await spot('s1', 'paid', {
    electricity: 'yes',
    overnight: ['allowed', '2026-10-12'],
  });
  await tariff(s1, 'Overnight', 'EUR', '12.00', { from: '2026-04-01' });
  await tariff(s1, 'PerWeek', 'EUR', '80.00', { from: '2026-04-01' });
  await tariff(s1, 'Overnight', 'EUR', '5.00');
  // s2 free · electricity no · forbidden · dated overnight €9.50 (counted: the lowest)
  const s2 = await spot('s2', 'free', {
    electricity: 'no',
    overnight: ['forbidden', '2026-10-10'],
    seen: '2026-10-10T05:00:00Z',
  });
  await tariff(s2, 'Overnight', 'EUR', '9.50', { until: '2026-10-30' });
  // s3 wild · nothing recorded · dated overnight in USD (not counted)
  const s3 = await spot('s3', 'wild', { seen: '2026-10-01T05:00:00Z' });
  await tariff(s3, 'Overnight', 'USD', '3.00', { from: '2026-04-01' });

  // ── Istria: three rows the page must not count ─────────────────────
  // s4 missing since September — electricity yes, dated €1 would flatter
  // both figures if it leaked in
  const s4 = await spot('s4', 'camper_stop', {
    electricity: 'yes',
    missing: '2026-09-01T00:00:00Z',
  });
  await tariff(s4, 'Overnight', 'EUR', '1.00', { from: '2026-04-01' });
  // s5 a secondary copy of s1
  const s5 = await spot('s5', 'rv_park', { electricity: 'yes' });
  await db.query(
    'INSERT INTO spot_links (primary_id, secondary_id) VALUES ($1, $2)',
    [s1, s5],
  );
  // s6 no region: has no page, is in no hub
  await spot('s6', 'paid', { region: null, electricity: 'yes' });

  // ── Dalmatia: two sites with nothing recorded, read in September ───
  await spot('d1', 'paid', {
    region: 'Dalmatia',
    seen: '2026-09-01T05:00:00Z',
  });
  await spot('d2', 'paid', {
    region: 'Dalmatia',
    seen: '2026-08-15T05:00:00Z',
  });
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

describe('hub stats, one row per region', () => {
  it('anchor: the fixture holds what the cases below count', async () => {
    const n = (await db.query('SELECT count(*)::int AS n FROM camping_spots'))
      .rows[0].n;
    expect(n).toBe(8);
    const t = (await db.query('SELECT count(*)::int AS n FROM spot_tariffs'))
      .rows[0].n;
    expect(t).toBe(6);
  });

  it('🔴 Istria: 3 sites, 2 free & wild, electricity 1 yes + 1 no, overnight 1 + 1, price on 2 from €9.50', async () => {
    const rows = await new SpotsService(asDataSource()).hubStats('hr');
    expect(rows.map((r) => r.region)).toEqual(['Istria', 'Dalmatia']);
    expect(rows[0]).toEqual({
      region: 'Istria',
      slug: 'istria',
      spots: 3,
      readAt: '2026-10-12',
      freeWild: 2,
      electricity: { yes: 1, no: 1 },
      overnight: { allowed: 1, forbidden: 1 },
      price: { known: 2, minEur: '9.50' },
    });
  });

  it('🔴 the missing site, the secondary copy and the site with no region are in NO figure', async () => {
    // Were s4 or s5 counted, electricity yes would be 2 or 3 and the
    // price 1.00; were s6 counted, Istria could not stay at 3.
    const [istria] = await new SpotsService(asDataSource()).hubStats('HR');
    expect(istria.spots).toBe(3);
    expect(istria.electricity.yes).toBe(1);
    expect(istria.price).toEqual({ known: 2, minEur: '9.50' });
  });

  it('a region where nothing is recorded says zero, zero and null — not nothing', async () => {
    const rows = await new SpotsService(asDataSource()).hubStats('hr');
    expect(rows[1]).toEqual({
      region: 'Dalmatia',
      slug: 'dalmatia',
      spots: 2,
      readAt: '2026-09-01',
      freeWild: 0,
      electricity: { yes: 0, no: 0 },
      overnight: { allowed: 0, forbidden: 0 },
      price: { known: 0, minEur: null },
    });
  });

  it('a country we hold nothing for is an empty list', async () => {
    expect(await new SpotsService(asDataSource()).hubStats('xx')).toEqual([]);
  });
});
