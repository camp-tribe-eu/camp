import { Client } from 'pg';
import type { DataSource, QueryRunner } from 'typeorm';
import { SpotOvernight1791500000000 } from '../migrations/1791500000000-SpotOvernight';
import { UPSERT_SPOT_SQL } from '../osm/import-spots';
import { mapOvernight } from '../osm/tag-mapping';
import { MapQueryService } from './map.service';
import { SpotsService } from './spots.service';
import {
  OVERNIGHT_DAY_SQL,
  overnightStatusSql,
  toOvernightView,
  UNKNOWN_OVERNIGHT,
} from './overnight';
import { SPOT_DETAIL_SQL } from './detail-query';
import { filterSql, NO_FILTERS } from './filters';

// CAMP-255 — overnight stay, against a REAL PostgreSQL.
//
// 🔴 WHY A DATABASE. The rule this card exists for — "unknown is never
// turned into an answer, and an answer never exists without a source" —
// is a statement about what PostgreSQL stores and returns. A test that
// asserts the SHAPE of a SQL string is satisfied by a CASE whose branches
// are in the wrong order. So: the real migration, the real UPSERT, the
// real region counts, the real map query.
//
// 🔴 EVERY STATEMENT UNDER TEST IS IMPORTED, NOT RETYPED. `UPSERT_SPOT_SQL`
// comes from the importer, `overnightStatusSql` from the module every
// reader uses, and the table gets its overnight columns from the real
// migration's `up()`. Only the pre-existing columns are declared here, the
// way context-sql.spec.ts does — a hand-made table is the precedent; a
// hand-made copy of the migration would be testing the copy.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP: a skipped test reads as
// a passed one. Needs CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL
// (CI sets it): any PostGIS database you may CREATE DATABASE in. This file
// creates its own `camp255_*` database and drops it; it reads and writes
// nothing in the one you name.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

/** The `DataSource` surface the services use: `query` returning rows. */
const asDataSource = (): DataSource =>
  ({
    query: async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params)).rows,
  }) as unknown as DataSource;

/** The migration's `up`/`down`, run through the one method it calls. */
const runner = (): QueryRunner =>
  ({ query: async (sql: string) => db.query(sql) }) as unknown as QueryRunner;

const MIGRATION = new SpotOvernight1791500000000();

/** Covers every fixture below: lon 14.0-14.7, lat 45. */
const BOX = { minLon: 13, minLat: 44, maxLon: 15, maxLat: 46 };

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp255_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');

  // The columns the importer's UPSERT and the map/region queries touch,
  // with the types the real table has. NOT the overnight ones — see above.
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
      contact jsonb NOT NULL DEFAULT '{}',
      sources jsonb NOT NULL DEFAULT '[]',
      warning_areas text[],
      last_seen_at timestamptz, missing_since timestamptz,
      content_changed_at timestamptz);
    CREATE TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());`);
  await MIGRATION.up(runner());
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

/** The import's own statement, fed what `main()` feeds it. */
async function upsert(
  osmRef: string,
  tags: Record<string, string>,
  opts: {
    startedAt?: string;
    region?: string | null;
    lon?: number;
    amenities?: Record<string, string>;
  } = {},
) {
  const o = mapOvernight(tags);
  const res = await db.query(UPSERT_SPOT_SQL, [
    `Camp ${osmRef}`,
    'HR',
    opts.region === undefined ? 'Istria' : opts.region,
    `camp-${osmRef}`,
    'paid',
    JSON.stringify(opts.amenities ?? {}),
    `POINT(${opts.lon ?? 14} 45)`,
    osmRef,
    opts.startedAt ?? '2026-10-12T05:00:00Z',
    '{}',
    o.status,
    o.source,
  ]);
  return res.rows[0] as { was_insert: boolean; content_changed: boolean };
}

const rowOf = async (osmRef: string) =>
  (
    await db.query(
      `SELECT overnight_status AS status, overnight_source AS source,
              to_char(overnight_checked_at, 'YYYY-MM-DD') AS day,
              content_changed_at, sources
         FROM camping_spots WHERE osm_ref = $1`,
      [osmRef],
    )
  ).rows[0];

describe('the migration', () => {
  it('creates the columns with the right defaults and the three constraints', async () => {
    const cols = (
      await db.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'camping_spots' AND column_name LIKE 'overnight_%'
          ORDER BY column_name`,
      )
    ).rows;
    // Anchor: three columns, or every assertion after this one reads an
    // empty list.
    expect(cols.map((c) => c.column_name)).toEqual([
      'overnight_checked_at',
      'overnight_source',
      'overnight_status',
    ]);
    const status = cols.find((c) => c.column_name === 'overnight_status')!;
    expect(status.is_nullable).toBe('NO');
    expect(status.column_default).toContain("'unknown'");

    const cons = (
      await db.query(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'camping_spots'::regclass AND conname LIKE '%overnight%'
          ORDER BY conname`,
      )
    ).rows.map((r) => r.conname);
    expect(cons).toEqual([
      'camping_spots_overnight_evidence_check',
      'camping_spots_overnight_source_shape_check',
      'camping_spots_overnight_status_check',
    ]);
  });

  it('a row that existed before it reads unknown, with no source and no date', async () => {
    // Insert with the column list a pre-CAMP-255 writer would use.
    await db.query(
      `INSERT INTO camping_spots (osm_ref, country, slug, type, location)
       VALUES ('n-legacy', 'HR', 'legacy', 'paid', ST_SetSRID(ST_MakePoint(14, 45), 4326))`,
    );
    expect(await rowOf('n-legacy')).toMatchObject({
      status: 'unknown',
      source: null,
      day: null,
    });
  });

  it('up is idempotent, and down takes the columns and the constraints away', async () => {
    await MIGRATION.up(runner());
    await MIGRATION.up(runner());
    await MIGRATION.down(runner());
    const left = (
      await db.query(
        `SELECT
           (SELECT count(*)::int FROM information_schema.columns
             WHERE table_name = 'camping_spots' AND column_name LIKE 'overnight_%') AS cols,
           (SELECT count(*)::int FROM pg_constraint
             WHERE conrelid = 'camping_spots'::regclass AND conname LIKE '%overnight%') AS cons`,
      )
    ).rows[0];
    expect(left).toEqual({ cols: 0, cons: 0 });
    // Down twice is also safe, and up brings everything back.
    await MIGRATION.down(runner());
    await MIGRATION.up(runner());
    const back = (
      await db.query(
        `SELECT count(*)::int AS n FROM pg_constraint
          WHERE conrelid = 'camping_spots'::regclass AND conname LIKE '%overnight%'`,
      )
    ).rows[0];
    expect(back.n).toBe(3);
  });
});

describe('the table refuses a claim with nothing behind it', () => {
  const insert = (
    slug: string,
    status: string,
    source: string | null,
    day: string | null,
  ) =>
    db.query(
      `INSERT INTO camping_spots
         (osm_ref, country, slug, type, location,
          overnight_status, overnight_source, overnight_checked_at)
       VALUES ($1, 'HR', $1, 'paid', ST_SetSRID(ST_MakePoint(14, 45), 4326),
               $2, $3, $4)`,
      [slug, status, source, day],
    );

  // Anchor: the same statement accepts a complete answer, so the refusals
  // below are about the field they vary and not about a broken INSERT.
  it('anchor: a complete answer is stored', async () => {
    await insert('c-ok-allowed', 'allowed', 'osm:motorhome=yes', '2026-10-12');
    await insert(
      'c-ok-forbidden',
      'forbidden',
      'osm:motorhome=no',
      '2026-10-12',
    );
    expect((await rowOf('c-ok-allowed')).status).toBe('allowed');
    expect((await rowOf('c-ok-forbidden')).status).toBe('forbidden');
  });

  // 🔴 One test per constraint, each varying ONE thing, so removing one
  // constraint turns exactly one test red and says which.
  it('🔴 allowed without a source is refused (evidence_check)', async () => {
    await expect(
      insert('c-no-source', 'allowed', null, '2026-10-12'),
    ).rejects.toThrow(/camping_spots_overnight_evidence_check/);
  });

  it('🔴 allowed without a date is refused (evidence_check)', async () => {
    await expect(
      insert('c-no-date', 'allowed', 'osm:motorhome=yes', null),
    ).rejects.toThrow(/camping_spots_overnight_evidence_check/);
  });

  it('🔴 forbidden without a source is refused too', async () => {
    await expect(
      insert('c-no-source-f', 'forbidden', null, '2026-10-12'),
    ).rejects.toThrow(/camping_spots_overnight_evidence_check/);
  });

  it('an unknown carrying a source is refused — the pair is an equivalence', async () => {
    await expect(
      insert('c-unknown-source', 'unknown', 'osm:motorhome=yes', null),
    ).rejects.toThrow(/camping_spots_overnight_evidence_check/);
    await expect(
      insert('c-unknown-day', 'unknown', null, '2026-10-12'),
    ).rejects.toThrow(/camping_spots_overnight_evidence_check/);
  });

  it('a fourth word is refused (status_check)', async () => {
    await expect(
      insert('c-maybe', 'maybe', 'osm:motorhome=yes', '2026-10-12'),
    ).rejects.toThrow(/camping_spots_overnight_status_check/);
  });

  it('an empty or spaced source is refused (source_shape_check)', async () => {
    for (const [i, bad] of [
      '',
      'osm',
      'osm:',
      'osm: motorhome=yes',
      'OSM:x',
    ].entries()) {
      await expect(
        insert(`c-shape-${i}`, 'allowed', bad, '2026-10-12'),
      ).rejects.toThrow(/camping_spots_overnight_source_shape_check/);
    }
  });
});

describe('the weekly upsert', () => {
  it('🔴 writes an answer with its source, the day it was read, and credits OSM for it', async () => {
    await upsert('n-yes', { motorhome: 'yes' });
    const r = await rowOf('n-yes');
    expect(r).toMatchObject({
      status: 'allowed',
      source: 'osm:motorhome=yes',
      day: '2026-10-12',
    });
    expect(r.sources[0].fields).toContain('overnight');
  });

  it('writes a no the same way', async () => {
    await upsert('n-no', { motorhome: 'no' });
    expect(await rowOf('n-no')).toMatchObject({
      status: 'forbidden',
      source: 'osm:motorhome=no',
      day: '2026-10-12',
    });
  });

  it('🔴 an untagged campsite is unknown, with no source, no day and NO credit for a field OSM did not give', async () => {
    await upsert('n-untagged', { tourism: 'camp_site' });
    const r = await rowOf('n-untagged');
    expect(r).toMatchObject({ status: 'unknown', source: null, day: null });
    expect(r.sources[0].fields).not.toContain('overnight');
    // …and the fields it DID supply are still declared.
    expect(r.sources[0].fields).toEqual(
      expect.arrayContaining(['name', 'location', 'amenities', 'contact']),
    );
  });

  it('🔴 a tag the mapper deletes stops being an answer on the next run', async () => {
    await upsert('n-withdrawn', { motorhome: 'yes' });
    expect((await rowOf('n-withdrawn')).status).toBe('allowed');
    await upsert('n-withdrawn', {}, { startedAt: '2026-10-19T05:00:00Z' });
    expect(await rowOf('n-withdrawn')).toMatchObject({
      status: 'unknown',
      source: null,
      day: null,
    });
  });

  // 🔴 CAMP-255 review. Through the real UPSERT, because "written to the
  // database as allowed" is what the finding says happened.
  it('🔴 a yes beside `access=private;customers` is stored as unknown, not allowed', async () => {
    await upsert('n-access-list', {
      motorhome: 'yes',
      access: 'private;customers',
    });
    expect(await rowOf('n-access-list')).toMatchObject({
      status: 'unknown',
      source: null,
      day: null,
    });
    // Anchor: the same row WITHOUT the list is an allowed, so the line
    // above is about the veto and not about a broken fixture.
    await upsert('n-access-open', { motorhome: 'yes', access: 'customers' });
    expect((await rowOf('n-access-open')).status).toBe('allowed');
  });

  it('a yes that turns into a no is rewritten, source and all', async () => {
    await upsert('n-flip', { motorhome: 'designated' });
    await upsert(
      'n-flip',
      { motorhome: 'no' },
      { startedAt: '2026-10-19T05:00:00Z' },
    );
    expect(await rowOf('n-flip')).toMatchObject({
      status: 'forbidden',
      source: 'osm:motorhome=no',
      day: '2026-10-19',
    });
  });

  // 🔴 <lastmod> (CAMP-39). The day moves every import; if it counted as a
  // change, every confirmed page would be restamped every Monday.
  it('🔴 re-reading the same answer a week later does NOT move content_changed_at, but moves the day', async () => {
    await upsert(
      'n-stable',
      { motorhome: 'yes' },
      { startedAt: '2026-10-12T05:00:00Z' },
    );
    const first = await rowOf('n-stable');
    const again = await upsert(
      'n-stable',
      { motorhome: 'yes' },
      { startedAt: '2026-10-19T05:00:00Z' },
    );
    const second = await rowOf('n-stable');
    expect(again.was_insert).toBe(false);
    expect(again.content_changed).toBe(false);
    expect(second.content_changed_at).toEqual(first.content_changed_at);
    expect(second.day).toBe('2026-10-19');
  });

  it('a changed answer DOES count as a change a reader would notice', async () => {
    await upsert(
      'n-moves',
      { motorhome: 'yes' },
      { startedAt: '2026-10-12T05:00:00Z' },
    );
    const changed = await upsert(
      'n-moves',
      { motorhome: 'no' },
      { startedAt: '2026-10-19T05:00:00Z' },
    );
    expect(changed.content_changed).toBe(true);
  });
});

describe('one gate, two implementations, one table of cases', () => {
  // The same cases drive `overnightStatusSql` (run by Postgres) and
  // `toOvernightView` (run by Node). A status the page shows and a status
  // the map shows cannot disagree without one of these turning red.
  const CASES: {
    name: string;
    status: string;
    source: string | null;
    day: string | null;
    expected: 'allowed' | 'forbidden' | 'unknown';
  }[] = [
    {
      name: 'allowed, sourced',
      status: 'allowed',
      source: 'osm:motorhome=yes',
      day: '2026-10-12',
      expected: 'allowed',
    },
    {
      name: 'forbidden, sourced',
      status: 'forbidden',
      source: 'osm:motorhome=no',
      day: '2026-10-12',
      expected: 'forbidden',
    },
    {
      name: 'unknown',
      status: 'unknown',
      source: null,
      day: null,
      expected: 'unknown',
    },
    {
      name: 'allowed, no source',
      status: 'allowed',
      source: null,
      day: '2026-10-12',
      expected: 'unknown',
    },
    {
      name: 'allowed, no day',
      status: 'allowed',
      source: 'osm:motorhome=yes',
      day: null,
      expected: 'unknown',
    },
    {
      name: 'forbidden, no source',
      status: 'forbidden',
      source: null,
      day: '2026-10-12',
      expected: 'unknown',
    },
    {
      name: 'a word nobody defined',
      status: 'maybe',
      source: 'osm:motorhome=yes',
      day: '2026-10-12',
      expected: 'unknown',
    },
    {
      name: 'empty status',
      status: '',
      source: 'osm:motorhome=yes',
      day: '2026-10-12',
      expected: 'unknown',
    },
  ];

  it('anchor: the table has both answers and the fallback, or it proves nothing', () => {
    expect(new Set(CASES.map((c) => c.expected))).toEqual(
      new Set(['allowed', 'forbidden', 'unknown']),
    );
  });

  it.each(CASES)('$name → $expected, in SQL and in TypeScript', async (c) => {
    // A VALUES row, not an INSERT: the table's CHECK would refuse the
    // inconsistent ones, and the gate exists for the day it is not there.
    const sqlRow = (
      await db.query(
        `SELECT ${overnightStatusSql('s')} AS status,
                ${OVERNIGHT_DAY_SQL('s')} AS day
           FROM (VALUES ($1::text, $2::text, $3::date))
                AS s(overnight_status, overnight_source, overnight_checked_at)`,
        [c.status, c.source, c.day],
      )
    ).rows[0];
    expect(sqlRow.status).toBe(c.expected);

    const view = toOvernightView({
      overnight_status: c.status,
      overnight_source: c.source,
      overnight_checked_at: sqlRow.day,
    });
    expect(view.status).toBe(c.expected);
    if (c.expected === 'unknown') {
      expect(view).toEqual(UNKNOWN_OVERNIGHT);
    } else {
      expect(view).toEqual({
        status: c.expected,
        source: c.source,
        checkedAt: c.day,
      });
    }
  });

  it('the page query selects through the same gate', () => {
    expect(SPOT_DETAIL_SQL).toContain(overnightStatusSql('s'));
    expect(SPOT_DETAIL_SQL).toContain(OVERNIGHT_DAY_SQL('s'));
  });
});

describe('what the counts and the map say', () => {
  // A clean slate: other describes inserted rows of their own.
  beforeAll(async () => {
    await db.query('DELETE FROM camping_spots');
    // Region "Istria": 2 allowed, 1 forbidden, 3 unknown (one of them
    // carries a CONDITIONAL tag). Region "Malta-like": nothing known.
    const rows: [string, Record<string, string>, string, number][] = [
      ['i1', { motorhome: 'yes' }, 'Istria', 14.0],
      ['i2', { motorhome: 'designated' }, 'Istria', 14.1],
      ['i3', { motorhome: 'no' }, 'Istria', 14.2],
      ['i4', {}, 'Istria', 14.3],
      ['i5', { motorhome: 'customers' }, 'Istria', 14.4],
      ['i6', { motorhome: 'yes', access: 'private' }, 'Istria', 14.5],
      ['m1', {}, 'Gozo', 14.6],
      ['m2', { caravans: 'no' }, 'Gozo', 14.7],
    ];
    for (const [ref, tags, region, lon] of rows) {
      await upsert(ref, tags, { region, lon, amenities: { shower: 'yes' } });
    }
  });

  it('anchor: the fixture holds what the cases below count', async () => {
    const n = (await db.query('SELECT count(*)::int AS n FROM camping_spots'))
      .rows[0].n;
    expect(n).toBe(8);
  });

  it('🔴 region counts: allowed, forbidden — and unknown is what is left, never counted as either', async () => {
    const regions = await new SpotsService(asDataSource()).regions('HR');
    const istria = regions.find((r) => r.region === 'Istria')!;
    expect(istria).toMatchObject({
      spots: 6,
      overnightAllowed: 2,
      overnightForbidden: 1,
      overnightReadAt: '2026-10-12',
    });
    // 3 unknown: untagged, `customers`, and the vetoed `yes`+private.
    expect(
      istria.spots - istria.overnightAllowed - istria.overnightForbidden,
    ).toBe(3);
  });

  it('🔴 a region where nothing is known says zero and zero, not nothing', async () => {
    const gozo = (await new SpotsService(asDataSource()).regions('HR')).find(
      (r) => r.region === 'Gozo',
    )!;
    expect(gozo).toMatchObject({
      spots: 2,
      overnightAllowed: 0,
      overnightForbidden: 0,
    });
  });

  it('markers carry the status, and unknown stays unknown', async () => {
    const res = await new MapQueryService(asDataSource()).points(
      BOX,
      NO_FILTERS,
    );
    const by = Object.fromEntries(
      res.markers.map((m) => [m.slug, m.overnight]),
    );
    expect(by).toEqual({
      'camp-i1': 'allowed',
      'camp-i2': 'allowed',
      'camp-i3': 'forbidden',
      'camp-i4': 'unknown',
      'camp-i5': 'unknown',
      'camp-i6': 'unknown',
      'camp-m1': 'unknown',
      'camp-m2': 'unknown',
    });
  });

  it('🔴 the overnight filter returns the confirmed ones only', async () => {
    const res = await new MapQueryService(asDataSource()).points(BOX, {
      ...NO_FILTERS,
      overnight: true,
    });
    expect(res.markers.map((m) => m.slug).sort()).toEqual([
      'camp-i1',
      'camp-i2',
    ]);
  });

  // 🔴 CAMP-255 review. `filterSql` is called from queries that alias the
  // table (`FROM camping_spots s`, all the runtime ones) AND from the
  // hand-comparison in verify-filters.ts, which does not. This condition
  // was the one that named the alias, so the second caller died with
  // "missing FROM-clause entry" and CAMP-35's check never ran on the one
  // filter that carries a legal claim. Both shapes, same rows.
  it('🔴 the overnight condition runs with a table alias and without one, and agrees', async () => {
    const f = filterSql({ ...NO_FILTERS, overnight: true }, 0);
    const slugs = async (from: string) =>
      (
        await db.query(
          `SELECT slug ${from} WHERE missing_since IS NULL${f.where} ORDER BY slug`,
          f.params,
        )
      ).rows.map((r) => r.slug);

    const aliased = await slugs('FROM camping_spots s');
    const bare = await slugs('FROM camping_spots');
    // Anchor: a comparison of two empty lists would pass for ever.
    expect(aliased).toEqual(['camp-i1', 'camp-i2']);
    expect(bare).toEqual(aliased);
  });

  // 🔴 The rule, against the database: ticking "include places where the
  // shower is not recorded" must not smuggle unknown-overnight places in.
  it('🔴 and it stays that way when the reader also loosened an amenity', async () => {
    const res = await new MapQueryService(asDataSource()).points(BOX, {
      ...NO_FILTERS,
      amenities: ['shower'],
      includeUnknown: true,
      overnight: true,
    });
    expect(res.markers.map((m) => m.slug).sort()).toEqual([
      'camp-i1',
      'camp-i2',
    ]);
  });
});
