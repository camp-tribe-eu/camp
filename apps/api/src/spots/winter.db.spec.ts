// CAMP-525 — /camping/winter's figures against a REAL PostgreSQL + PostGIS.
//
// 🔴 THREE THINGS ARE PROVED HERE, EACH WITH A MUTATION THAT TURNS IT RED
// (run by hand and recorded in the PR):
//
//   1. ONLY A SOURCED YES IS COUNTED. A «no» (closed in winter), a row with
//      no record, a dropped row, a row with no region and a hidden country
//      are all seeded and none of them is in a figure.
//   2. THE COUNTRY FIGURES ARE THE SUM OF THE REGION CHIPS. The expected
//      numbers are written by hand from the rows below, and are compared
//      with what `listRegion` — the code the region hub's chip reads —
//      says for each region.
//   3. THE SERVICE FIGURES ARE A DISTANCE. Points are placed with
//      ST_Project from the campsite's own point at 9 900 m (in) and
//      10 100 m (out), and the answer is checked against an ORACLE that
//      shares no text with the query under test: a cross join with a plain
//      ST_Distance, no bounding box, no EXISTS.
//
// 🔴 EVERY EXPECTED NUMBER IS COUNTED BY HAND from the rows seeded in
// `beforeAll`, not read back from the code.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI). Creates its
// own `camp525_*` database from the real migrations and drops it.

import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { slugifyRegion } from './canonical';
import { listRegion, NO_FILTERS } from './region-listing';
import {
  countWinter,
  WINTER_TOP_REGIONS,
  winterServicesSql,
  type WinterPayload,
} from './winter';

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

let admin: Client;
let db: DataSource;
let dbName: string;

const yes = (source: string) => ({ winter: { value: 'yes', source } });
const no = (source: string) => ({ winter: { value: 'no', source } });

interface Spot {
  slug: string;
  country: string;
  region: string | null;
  lon: number;
  lat: number;
  styles: unknown;
  dropped?: boolean;
}

const insert = async (s: Spot) => {
  const [row] = await db.query(
    `INSERT INTO camping_spots
       (name, country, region, slug, type, amenities, location, osm_ref,
        travel_styles, missing_since, last_seen_at)
     VALUES ($1, $2, $3, $4, 'paid', '{}'::jsonb,
             ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8::jsonb,
             CASE WHEN $9 THEN now() ELSE NULL END,
             '2026-11-10 12:00:00+00')
     RETURNING id`,
    [
      s.slug,
      s.country,
      s.region,
      s.slug,
      s.lon,
      s.lat,
      `t-${s.slug}`,
      JSON.stringify(s.styles),
      s.dropped === true,
    ],
  );
  return row.id as string;
};

/**
 * A route POI placed `metres` from a campsite's own point, due north unless a
 * bearing (radians) is given. A diagonal point 10 100 m away is INSIDE the
 * bounding box the query uses to bound the index walk and OUTSIDE the circle:
 * only the distance test can refuse it.
 */
const poi = (
  ref: string,
  kind: string,
  spotId: string,
  metres: number,
  extra: { gas?: boolean; country?: string; bearing?: number } = {},
) =>
  db.query(
    `INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, cylinder_swap)
     SELECT $1, $2, NULL,
            ST_Project(s.location::geography, $3::float8, $7::float8)::geometry,
            $4, $5
       FROM camping_spots s WHERE s.id = $6`,
    [
      ref,
      kind,
      metres,
      extra.country ?? 'si',
      extra.gas ? 'yes' : 'unknown',
      spotId,
      extra.bearing ?? 0,
    ],
  );

let payload: WinterPayload;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp525_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new DataSource({
    ...AppDataSource.options,
    url: url.toString(),
  } as never);
  await db.initialize();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.runMigrations();

  // ── SI · Winterland: 5 rows. 2 sourced yes (A, B), 1 sourced no (C), 2 blank.
  const A = await insert({
    slug: 'a',
    country: 'SI',
    region: 'Winterland',
    lon: 14.1,
    lat: 46.1,
    styles: yes('osm:seasonal=no'),
  });
  const B = await insert({
    slug: 'b',
    country: 'SI',
    region: 'Winterland',
    lon: 14.5,
    lat: 46.1,
    styles: yes('osm:opening_hours=24/7'),
  });
  const C = await insert({
    slug: 'c',
    country: 'SI',
    region: 'Winterland',
    lon: 14.3,
    lat: 46.3,
    styles: no('osm:opening_hours=Apr-Oct'),
  });
  await insert({
    slug: 'd1',
    country: 'SI',
    region: 'Winterland',
    lon: 14.31,
    lat: 46.31,
    styles: {},
  });
  await insert({
    slug: 'd2',
    country: 'SI',
    region: 'Winterland',
    lon: 14.32,
    lat: 46.32,
    styles: {},
  });

  // ── SI · Thinland: 21 rows. 1 sourced yes (T), 20 blank.
  const T = await insert({
    slug: 't',
    country: 'SI',
    region: 'Thinland',
    lon: 15.0,
    lat: 45.5,
    styles: yes('osm:seasonal=no'),
  });
  for (let i = 0; i < 20; i++) {
    await insert({
      slug: `t-blank-${i}`,
      country: 'SI',
      region: 'Thinland',
      lon: 15.1 + i / 1000,
      lat: 45.6,
      styles: {},
    });
  }

  // ── Rows that must NOT be in any figure, each a sourced yes on its own.
  const GONE = await insert({
    slug: 'gone',
    country: 'SI',
    region: 'Winterland',
    lon: 14.2,
    lat: 46.2,
    styles: yes('osm:seasonal=no'),
    dropped: true,
  });
  const REGIONLESS = await insert({
    slug: 'regionless',
    country: 'SI',
    region: null,
    lon: 14.6,
    lat: 46.4,
    styles: yes('osm:seasonal=no'),
  });
  await insert({
    slug: 'cyprus',
    country: 'CY',
    region: 'Paphos',
    lon: 32.4,
    lat: 34.8,
    styles: yes('osm:seasonal=no'),
  });

  // ── HR · Coldland: 3 rows, none with a record. A country with data and no winter.
  for (let i = 0; i < 3; i++) {
    await insert({
      slug: `h${i}`,
      country: 'HR',
      region: 'Coldland',
      lon: 16 + i / 100,
      lat: 45.8,
      styles: {},
    });
  }

  // ── Services. Hand-placed, every distance measured from the spot's own point.
  // A: water 3 km (in), dump 20 km (out), gas 5 km (in).
  await poi('n-a-water', 'water', A, 3_000);
  await poi('n-a-dump', 'dump', A, 20_000);
  await poi('n-a-gas', 'groceries', A, 5_000, { gas: true });
  // B: dump 5.5 km (in). Decoys: a fuel station and a bottle shop that does NOT swap.
  await poi('n-b-dump', 'dump', B, 5_500);
  await poi('n-b-fuel', 'fuel', B, 1_000);
  await poi('n-b-shop', 'groceries', B, 1_000);
  // T: the edge. dump 9 900 m (in); water and gas 10 100 m (out).
  await poi('n-t-dump', 'dump', T, 9_900);
  await poi('n-t-water', 'water', T, 10_100, { bearing: Math.PI / 4 });
  await poi('n-t-gas', 'groceries', T, 10_100, {
    gas: true,
    bearing: Math.PI / 4,
  });
  // The campsites that are not counted have water next to them, so counting
  // them would move the water figure from 1 to 3.
  // C is recorded CLOSED in winter and has all three beside it: it is not a
  // winter-confirmed campsite, so it is in no service figure.
  await poi('n-c-water', 'water', C, 500);
  await poi('n-c-dump', 'dump', C, 500);
  await poi('n-c-gas', 'groceries', C, 500, { gas: true });
  await poi('n-gone-water', 'water', GONE, 500);
  await poi('n-regionless-water', 'water', REGIONLESS, 500);

  payload = await countWinter((sql) => db.query(sql), slugifyRegion);
});

afterAll(async () => {
  await db?.destroy();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

const country = (code: string) =>
  payload.countries.find((c) => c.country === code);

describe('🔴 only a sourced yes is counted', () => {
  it('SI: 3 yes (A, B, T), 4 known (+ the sourced no), 26 campsites — and not the dropped, regionless or Cypriot yes', () => {
    const si = country('si');
    expect(si).toMatchObject({ spots: 26, known: 4, yes: 3 });
  });

  it('a country with records and no winter yes is present with 0, and lists no region', () => {
    expect(country('hr')).toMatchObject({
      spots: 3,
      known: 0,
      yes: 0,
      regions: [],
    });
  });

  it('a hidden country is not in the payload at all', () => {
    expect(country('cy')).toBeUndefined();
    expect(payload.countries.map((c) => c.country).sort()).toEqual([
      'hr',
      'si',
    ]);
  });

  it("the regions listed are those with a yes, most first, and carry the chip's own counts", () => {
    expect(country('si')?.regions).toEqual([
      { region: 'Winterland', slug: 'winterland', spots: 5, known: 3, yes: 2 },
      { region: 'Thinland', slug: 'thinland', spots: 21, known: 1, yes: 1 },
    ]);
  });

  it('the payload carries no campsite: no field of any country or region names one', () => {
    const text = JSON.stringify(payload);
    for (const slug of [
      '"a"',
      '"c"',
      'd1',
      'gone',
      'regionless',
      'cyprus',
      'Paphos',
      't-blank',
    ]) {
      expect(text).not.toContain(slug);
    }
  });
});

describe('🔴 the country figures are the sum of what the region chips say', () => {
  it.each([
    ['si', 'Winterland'],
    ['si', 'Thinland'],
    ['hr', 'Coldland'],
  ])(
    '%s / %s: the hub chip counts the same known, yes and total',
    async (cc, region) => {
      const listing = await listRegion(db, cc, region, {
        page: 1,
        sort: 'name',
        filters: NO_FILTERS,
      });
      const c = country(cc)!;
      const mine = c.regions.find((r) => r.region === region);
      const chip = listing.facets.styles.winter;
      expect(chip.yes).toBe(mine?.yes ?? 0);
      expect(chip.known).toBe(mine?.known ?? 0);
      if (mine) expect(listing.total).toBe(mine.spots);
    },
  );

  it('the country is exactly the sum of its regions', async () => {
    let known = 0;
    let yesN = 0;
    let spots = 0;
    for (const region of ['Winterland', 'Thinland']) {
      const l = await listRegion(db, 'si', region, {
        page: 1,
        sort: 'name',
        filters: NO_FILTERS,
      });
      known += l.facets.styles.winter.known;
      yesN += l.facets.styles.winter.yes;
      spots += l.total;
    }
    expect(country('si')).toMatchObject({ spots, known, yes: yesN });
  });
});

describe('🔴 the service figures are a distance, of winter-confirmed campsites only', () => {
  it('SI: water 1 of 3, dump 2 of 3, gas 1 of 3 — the 10 100 m points are out, the 9 900 m one is in', () => {
    expect(country('si')?.withinRadius).toEqual({ water: 1, dump: 2, gas: 1 });
  });

  it('a country with no winter yes has zero on every service, whatever is mapped near its campsites', () => {
    expect(country('hr')?.withinRadius).toEqual({ water: 0, dump: 0, gas: 0 });
  });

  it('no figure exceeds the campsites it is a share of', () => {
    for (const c of payload.countries) {
      for (const v of Object.values(c.withinRadius))
        expect(v).toBeLessThanOrEqual(c.yes);
    }
  });

  it('agrees with an oracle that shares no text with the query: cross join, plain ST_Distance', async () => {
    const [oracle] = await db.query(
      `SELECT
         count(DISTINCT s.id) FILTER (WHERE p.kind = 'water')::int AS water,
         count(DISTINCT s.id) FILTER (WHERE p.kind = 'dump')::int AS dump,
         count(DISTINCT s.id) FILTER (WHERE p.cylinder_swap = 'yes')::int AS gas
       FROM camping_spots s
       JOIN osm_route_poi p
         ON ST_Distance(s.location::geography, p.location::geography) <= 10000
      WHERE lower(s.country) = 'si'
        AND s.region IS NOT NULL AND s.missing_since IS NULL
        AND s.travel_styles -> 'winter' ->> 'value' = 'yes'`,
    );
    expect(country('si')?.withinRadius).toEqual(oracle);
  });

  it('the radius is a positive integer or the SQL is not built', () => {
    expect(() => winterServicesSql(0)).toThrow();
    expect(() => winterServicesSql(1.5)).toThrow();
  });
});

describe('payload shape', () => {
  it('says the radius it counted with and the day the rows were last seen', () => {
    expect(payload.radiusM).toBe(10_000);
    expect(payload.readAt).toBe('2026-11-10');
  });

  it(`links at most ${WINTER_TOP_REGIONS} regions per country`, async () => {
    // Seven more regions with one yes each, in a country of their own.
    for (let i = 0; i < 7; i++) {
      await insert({
        slug: `m${i}`,
        country: 'AT',
        region: `Region ${i}`,
        lon: 13 + i / 10,
        lat: 47.5,
        styles: yes('osm:seasonal=no'),
      });
    }
    const wide = await countWinter((sql) => db.query(sql), slugifyRegion);
    const at = wide.countries.find((c) => c.country === 'at')!;
    expect(at.yes).toBe(7);
    expect(at.regions).toHaveLength(WINTER_TOP_REGIONS);
  });
});
