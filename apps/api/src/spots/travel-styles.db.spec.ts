// CAMP-520 — travel styles against a REAL PostgreSQL.
//
// 🔴 THE CARD'S OWN CHECK IS THE FIRST TEST HERE: «проставити мітку без
// джерела, сторож червоніє». The sentry is a CHECK constraint, so the
// only honest test is an INSERT the database refuses.
//
// 🔴 EVERY EXPECTED NUMBER IS COUNTED BY HAND from the rows seeded below.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI). Creates its
// own `camp520_*` database from the real migrations and drops it.

import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { UPSERT_SPOT_SQL, upsertSpotParams } from '../osm/import-spots';
import { mapTravelStyles } from '../osm/travel-styles';
import { TRAVEL_STYLES_CHECK } from '../migrations/1797500000000-SpotTravelStyles';
import {
  TRAVEL_STYLES_SECTIONS,
  TRAVEL_STYLES_SLUG,
} from '../migrations/1797500100000-TravelStylesText';
import {
  isStyleOffered,
  listRegion,
  NO_FILTERS,
  parseRegionQuery,
  STYLE_MIN_KNOWN_SHARE,
  type RegionQuery,
} from './region-listing';

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

let admin: Client;
let db: DataSource;
let dbName: string;

const REGION = 'Winterland';
const THIN = 'Thinland';

const insert = (slug: string, region: string, styles: unknown) =>
  db.query(
    `INSERT INTO camping_spots (name, country, region, slug, type, amenities, location, osm_ref, travel_styles)
     VALUES ($1, 'SI', $2, $3, 'paid', '{}'::jsonb,
             ST_SetSRID(ST_MakePoint(14.1, 46.1), 4326), $4, $5::jsonb)`,
    [slug, region, slug, `t-${slug}`, JSON.stringify(styles)],
  );

const yes = (source: string) => ({ winter: { value: 'yes', source } });
const no = (source: string) => ({ winter: { value: 'no', source } });

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp520_${process.pid}_${Date.now()}`;
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

  // Winterland, 6 rows: 2 sourced yes, 1 sourced no, 3 with no record.
  //   known 3 of 6 = 50 % → offered.
  await insert('w-yes-1', REGION, yes('osm:seasonal=no'));
  await insert('w-yes-2', REGION, yes('osm:opening_hours=24/7'));
  await insert('w-no', REGION, no('osm:opening_hours=Apr-Oct'));
  await insert('w-unknown-1', REGION, {});
  await insert('w-unknown-2', REGION, {});
  await insert('w-unknown-3', REGION, {});

  // Thinland, 25 rows: 1 sourced yes, 24 with no record.
  //   known 1 of 25 = 4 % → below the 5 % floor → not offered.
  await insert('t-yes', THIN, yes('osm:seasonal=no'));
  for (let i = 0; i < 24; i++) await insert(`t-unknown-${i}`, THIN, {});
});

afterAll(async () => {
  await db?.destroy();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

const q = (over: Partial<RegionQuery['filters']> = {}): RegionQuery => ({
  page: 1,
  sort: 'name',
  filters: { ...NO_FILTERS, ...over },
});

describe('🔴 a label without a source cannot be stored', () => {
  it.each([
    ['no source key', { winter: { value: 'yes' } }],
    ['a null source', { winter: { value: 'yes', source: null } }],
    ['an empty source', { winter: { value: 'yes', source: '' } }],
    ['a source with no evidence', { winter: { value: 'yes', source: 'osm:' } }],
    ['a bare word for the entry', { winter: 'yes' }],
    ['a third value', { winter: { value: 'probably', source: 'osm:x=y' } }],
    [
      'one good entry beside one bad',
      {
        winter: { value: 'yes', source: 'osm:seasonal=no' },
        adultsOnly: { value: 'yes' },
      },
    ],
  ])('%s is refused by the table', async (name, styles) => {
    await expect(
      insert(`bad-${name.replace(/\W+/g, '-')}`, 'Nowhere', styles),
    ).rejects.toThrow(TRAVEL_STYLES_CHECK);
  });

  it('and the refusals left nothing behind', async () => {
    const [r] = await db.query(
      `SELECT count(*)::int AS n FROM camping_spots WHERE region = 'Nowhere'`,
    );
    expect(r.n).toBe(0);
  });
});

describe('the importer writes what the tags state, and unwrites it', () => {
  const base = {
    name: 'Import Me',
    country: 'SI',
    region: 'Importland',
    slug: 'import-me',
    type: 'paid',
    amenities: {},
    pointWkt: 'POINT(14.3 46.3)',
    osmRef: 'n520',
    contact: {},
    overnightStatus: 'unknown',
    overnightSource: null,
    record: null,
  };
  const stored = async () =>
    (
      await db.query(
        `SELECT travel_styles FROM camping_spots WHERE osm_ref = 'n520'`,
      )
    )[0].travel_styles;

  it('seasonal=no and min_age=18 arrive with their sources', async () => {
    await db.query(
      UPSERT_SPOT_SQL,
      upsertSpotParams({
        ...base,
        seenAt: new Date('2026-11-01T00:00:00Z'),
        travelStyles: mapTravelStyles({ seasonal: 'no', min_age: '18' }),
      }),
    );
    expect(await stored()).toEqual({
      winter: { value: 'yes', source: 'osm:seasonal=no' },
      adultsOnly: { value: 'yes', source: 'osm:min_age=18' },
    });
  });

  it('the next run, with the tags gone, leaves no label behind', async () => {
    await db.query(
      UPSERT_SPOT_SQL,
      upsertSpotParams({
        ...base,
        seenAt: new Date('2026-11-08T00:00:00Z'),
        travelStyles: mapTravelStyles({}),
      }),
    );
    expect(await stored()).toEqual({});
  });
});

describe('the hub filter shows only sourced yes', () => {
  it('styles=winter: the 2 sourced yes, not the no, not the 3 unrecorded', async () => {
    const r = await listRegion(db, 'si', REGION, q({ styles: ['winter'] }));
    expect(r.total).toBe(6);
    expect(r.matched).toBe(2);
    expect(r.items.map((i) => i.slug).sort()).toEqual(['w-yes-1', 'w-yes-2']);
    expect(r.dropOne).toEqual([{ kind: 'style', key: 'winter', matched: 6 }]);
  });

  it('🔴 unknown=1 does not let the unrecorded in', async () => {
    const r = await listRegion(
      db,
      'si',
      REGION,
      parseRegionQuery({ styles: 'winter', unknown: '1' }),
    );
    expect(r.matched).toBe(2);
    expect(r.unknownExcluded).toBe(0);
  });

  it('the coverage is the region’s own, whatever is filtered', async () => {
    for (const filters of [
      q(),
      q({ styles: ['winter'] }),
      q({ types: ['wild'] }),
    ]) {
      const r = await listRegion(db, 'si', REGION, filters);
      expect(r.facets.styles.winter).toMatchObject({
        known: 3,
        yes: 2,
        offered: true,
      });
    }
  });

  it('the chip’s number predicts the click, both ways', async () => {
    const off = await listRegion(db, 'si', REGION, q());
    expect(off.facets.styles.winter.toggled).toBe(2);
    const on = await listRegion(db, 'si', REGION, q({ styles: ['winter'] }));
    expect(on.facets.styles.winter.toggled).toBe(6);
  });

  it('adults only: nothing recorded here, so nothing offered', async () => {
    const r = await listRegion(db, 'si', REGION, q());
    expect(r.facets.styles.adultsOnly).toEqual({
      toggled: 0,
      known: 0,
      yes: 0,
      offered: false,
    });
  });

  it('🔴 a thin region does not offer the style: 1 known of 25 is 4 %', async () => {
    const r = await listRegion(db, 'si', THIN, q());
    expect(r.total).toBe(25);
    expect(r.facets.styles.winter).toEqual({
      toggled: 1,
      known: 1,
      yes: 1,
      offered: false,
    });
    // The floor itself, at its edge: 5 of 100 is offered, 4 of 100 is not.
    expect(STYLE_MIN_KNOWN_SHARE).toBe(0.05);
    expect(isStyleOffered(5, 1, 100)).toBe(true);
    expect(isStyleOffered(4, 1, 100)).toBe(false);
    // Plenty known, but every answer is a no: there is nothing to show.
    expect(isStyleOffered(50, 0, 100)).toBe(false);
  });

  // 🔴 LAST, because it removes the constraint: the reader's own guard.
  // A table without the CHECK (a restore from before the migration, a
  // hand-made copy) must still not put an unsourced row under the filter.
  it('🔴 with the CHECK gone, an unsourced yes is still not shown and not counted', async () => {
    await db.query(
      `ALTER TABLE camping_spots DROP CONSTRAINT ${TRAVEL_STYLES_CHECK}`,
    );
    await insert('w-unsourced', REGION, { winter: { value: 'yes' } });
    const r = await listRegion(db, 'si', REGION, q({ styles: ['winter'] }));
    expect(r.total).toBe(7);
    expect(r.matched).toBe(2);
    expect(r.items.map((i) => i.slug)).not.toContain('w-unsourced');
    expect(r.facets.styles.winter).toMatchObject({ known: 3, yes: 2 });
  });
});

describe('the filter’s words are in the CMS', () => {
  it('the page is published and holds exactly the slots the hub reads', async () => {
    const rows: { slot: string; heading: string; body: string | null }[] =
      await db.query(
        `SELECT s.slot, t.heading, t.body
           FROM pages p
           JOIN page_sections s ON s.page_id = p.id
           JOIN page_section_translations t ON t.section_id = s.id
          WHERE p.slug = $1 AND p.status = 'published' AND p.noindex
            AND s.visible AND t.language_code = 'en'
          ORDER BY s.sort`,
        [TRAVEL_STYLES_SLUG],
      );
    expect(rows).toEqual(TRAVEL_STYLES_SECTIONS.map((s) => ({ ...s })));
    expect(rows.map((r) => r.slot)).toEqual([
      'group',
      'style-winter',
      'style-adults-only',
      'coverage',
      'map-note',
    ]);
    const coverage = rows.find((r) => r.slot === 'coverage')!;
    for (const key of ['{{label}}', '{{known}}', '{{total}}']) {
      expect(coverage.body).toContain(key);
    }
    // A heading is substituted from the site's fixed list and throws on
    // any other key (page-content.ts): no template may sit in one.
    for (const r of rows) expect(r.heading).not.toContain('{{');
  });
});
