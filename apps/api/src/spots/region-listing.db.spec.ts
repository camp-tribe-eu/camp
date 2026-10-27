// The region hub's filters, against real rows.
//
// 🔴 EVERY EXPECTED NUMBER BELOW IS COUNTED BY HAND FROM THE FIVE ROWS
// SEEDED HERE, not by running the module under test twice. The rows are
// chosen so that strict and lenient differ (Charlie has no shower
// record), so that a single-type filter is not the whole region, and so
// that one combination (wild + laundry) is empty while each half of it
// is not — which is the case the empty state exists for.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP, exactly as in
// overnight.db.spec.ts: a skipped test reads as a passed one. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI). This file
// creates its own `camphub_*` database from the real migrations and
// drops it; it reads and writes nothing in the one you name.

import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import {
  countsSql,
  listRegion,
  NO_FILTERS,
  parseRegionQuery,
  type RegionQuery,
} from './region-listing';

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

let admin: Client;
let db: DataSource;
let dbName: string;

const COUNTRY = 'si';
const REGION = 'Testland';

/** Five rows. The comments are the hand count the assertions rest on. */
const ROWS: {
  slug: string;
  name: string | null;
  type: string;
  amenities: Record<string, string>;
}[] = [
  // paid, shower yes, water yes                → 2 recorded
  { slug: 'alpha', name: 'Alpha', type: 'paid', amenities: { shower: 'yes', water: 'yes' } },
  // free, shower yes                           → 1 recorded
  { slug: 'bravo', name: 'Bravo', type: 'free', amenities: { shower: 'yes' } },
  // free, shower NOT recorded                  → 0 recorded; lenient-only for shower
  { slug: 'charlie', name: 'Charlie', type: 'free', amenities: {} },
  // wild, shower no, nameless                  → 0 recorded
  { slug: 'delta', name: null, type: 'wild', amenities: { shower: 'no' } },
  // camper_stop, shower + laundry + electricity → 3 recorded
  {
    slug: 'echo',
    name: 'Echo',
    type: 'camper_stop',
    amenities: { shower: 'yes', laundry: 'yes', electricity: 'yes' },
  },
];

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

  // The real schema, from the real migrations — not a hand-made table
  // that could drift from the one the hub queries in production.
  db = new DataSource({ ...AppDataSource.options, url: url.toString() } as never);
  await db.initialize();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.runMigrations();

  for (const r of ROWS) {
    await db.query(
      `INSERT INTO camping_spots (name, country, region, slug, type, amenities, location, osm_ref)
       VALUES ($1, $2, $3, $4, $5::camping_spots_type_enum, $6::jsonb,
               ST_SetSRID(ST_MakePoint(14.1, 46.1), 4326), $7)`,
      [r.name, 'SI', REGION, r.slug, r.type, JSON.stringify(r.amenities), `t-${r.slug}`],
    );
  }
  // A row in another region, so a count that forgot the region shows.
  await db.query(
    `INSERT INTO camping_spots (name, country, region, slug, type, amenities, location, osm_ref)
     VALUES ('Elsewhere', 'SI', 'Otherland', 'elsewhere', 'free', '{"shower":"yes"}',
             ST_SetSRID(ST_MakePoint(14.2, 46.2), 4326), 't-elsewhere')`,
  );
});

afterAll(async () => {
  await db?.destroy();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

const q = (over: Partial<RegionQuery['filters']> = {}, sort: RegionQuery['sort'] = 'name', page = 1): RegionQuery => ({
  page,
  sort,
  filters: { ...NO_FILTERS, ...over },
});

const slugs = (items: { slug: string }[]) => items.map((i) => i.slug);

describe('listRegion: a filter narrows the same region', () => {
  it('no filter: all 5 of the region, named first, nothing from next door', async () => {
    const r = await listRegion(db, COUNTRY, REGION, q());
    expect(r.total).toBe(5);
    expect(r.matched).toBe(5);
    expect(r.unknownExcluded).toBe(0);
    expect(slugs(r.items)).toEqual(['alpha', 'bravo', 'charlie', 'echo', 'delta']);
    expect(r.dropOne).toEqual([]);
  });

  it('🔴 types=free: 2 of the 5, and only those two', async () => {
    const all = await listRegion(db, COUNTRY, REGION, q());
    const free = await listRegion(db, COUNTRY, REGION, q({ types: ['free'] }));
    expect(all.matched).toBe(5);
    expect(free.matched).toBe(2);
    expect(free.matched).toBeLessThan(all.matched);
    expect(slugs(free.items).sort()).toEqual(['bravo', 'charlie']);
    // The region's size does not change because the reader filtered it.
    expect(free.total).toBe(5);
  });

  it('🔴 amenities=shower: strict 3, and 1 excluded only for want of data', async () => {
    const r = await listRegion(db, COUNTRY, REGION, q({ amenities: ['shower'] }));
    expect(r.matched).toBe(3);
    expect(slugs(r.items).sort()).toEqual(['alpha', 'bravo', 'echo']);
    // Charlie: no record. Delta: a recorded no — not "unknown".
    expect(r.unknownExcluded).toBe(1);
  });

  it('unknown=1 brings the unrecorded one back and stops counting it as excluded', async () => {
    const r = await listRegion(
      db,
      COUNTRY,
      REGION,
      q({ amenities: ['shower'], includeUnknown: true }),
    );
    expect(r.matched).toBe(4);
    expect(slugs(r.items).sort()).toEqual(['alpha', 'bravo', 'charlie', 'echo']);
    expect(r.unknownExcluded).toBe(0);
  });
});

describe('listRegion: the numbers beside the chips', () => {
  it('type facets count each type under the amenity filter', async () => {
    const r = await listRegion(db, COUNTRY, REGION, q({ amenities: ['shower'] }));
    // With a recorded shower: alpha (paid), bravo (free), echo (camper_stop).
    expect(r.facets.types).toEqual({
      free: 1,
      paid: 1,
      camper_stop: 1,
      rv_park: 0,
      wild: 0,
    });
  });

  it('amenity facets answer "how many if I add this"', async () => {
    const r = await listRegion(db, COUNTRY, REGION, q({ types: ['free'] }));
    // Free: bravo (shower yes), charlie (nothing recorded).
    expect(r.facets.amenities.shower).toBe(1);
    expect(r.facets.amenities.laundry).toBe(0);
    // Unfiltered: shower yes on alpha, bravo, echo; laundry on echo only.
    const all = await listRegion(db, COUNTRY, REGION, q());
    expect(all.facets.amenities.shower).toBe(3);
    expect(all.facets.amenities.laundry).toBe(1);
    expect(all.facets.amenities.electricity).toBe(1);
    expect(all.facets.types.free).toBe(2);
  });
});

describe('listRegion: the empty result names what to drop', () => {
  it('🔴 wild + laundry matches nothing; dropping either half gives one back', async () => {
    const r = await listRegion(
      db,
      COUNTRY,
      REGION,
      q({ types: ['wild'], amenities: ['laundry'] }),
    );
    expect(r.matched).toBe(0);
    expect(r.items).toEqual([]);
    expect(r.dropOne).toEqual([
      // Without "wild": laundry alone → echo.
      { kind: 'type', key: 'wild', matched: 1 },
      // Without "laundry": wild alone → delta.
      { kind: 'amenity', key: 'laundry', matched: 1 },
    ]);
    // Delta's laundry is unrecorded, so it is the one that "might".
    expect(r.unknownExcluded).toBe(1);
  });
});

describe('listRegion: sort', () => {
  it('facilities: the most recorded first, then by name', async () => {
    const r = await listRegion(db, COUNTRY, REGION, q({}, 'facilities'));
    // echo 3, alpha 2, bravo 1, then charlie 0 and delta 0 — charlie is
    // named, so it comes before the nameless delta.
    expect(slugs(r.items)).toEqual(['echo', 'alpha', 'bravo', 'charlie', 'delta']);
  });

  it("type: the card's order (free, paid, camper stop, RV park, wild)", async () => {
    const r = await listRegion(db, COUNTRY, REGION, q({}, 'type'));
    expect(slugs(r.items)).toEqual(['bravo', 'charlie', 'alpha', 'echo', 'delta']);
  });

  it('pages: page 2 of 2-per-page, matched still the whole count', async () => {
    const r = await listRegion(db, COUNTRY, REGION, q({}, 'name', 2), 2);
    expect(slugs(r.items)).toEqual(['charlie', 'echo']);
    expect(r.matched).toBe(5);
  });
});

describe('parseRegionQuery and countsSql (no database)', () => {
  it('reads the map vocabulary, forces overnight off, defaults the rest', () => {
    const p = parseRegionQuery({
      types: 'free,bogus',
      amenities: 'shower',
      unknown: '1',
      overnight: 'allowed',
      sort: 'facilities',
      page: '3',
    });
    expect(p.filters.types).toEqual(['free']);
    expect(p.filters.amenities).toEqual(['shower']);
    expect(p.filters.includeUnknown).toBe(true);
    expect(p.filters.overnight).toBe(false);
    expect(p.sort).toBe('facilities');
    expect(p.page).toBe(3);
    expect(parseRegionQuery({ sort: 'price', page: '-2' })).toMatchObject({
      sort: 'name',
      page: 1,
    });
  });

  it('one statement carries one column per facet and per active filter', () => {
    const c = countsSql({ ...NO_FILTERS, types: ['wild'], amenities: ['laundry'] });
    // total, matched, lenient, 5 types, 10 amenities, 2 drop-ones.
    expect(c.columns).toHaveLength(3 + 5 + 10 + 2);
    expect(c.columns).toContain('drop:t:wild');
    expect(c.columns).toContain('drop:a:laundry');
    // Placeholders are numbered without a gap or a repeat.
    const nums = [...c.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...nums)).toBe(c.params.length + 2);
  });
});
