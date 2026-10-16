import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { SpotOvernight1791500000000 } from '../migrations/1791500000000-SpotOvernight';
import { SpotRecordEdited1791800000000 } from '../migrations/1791800000000-SpotRecordEdited';
import {
  assertStoredEditDates,
  UPSERT_SPOT_SQL,
  upsertSpotParams,
} from './import-spots';
import {
  loadDateVerdict,
  MIN_RECORDS_TO_JUDGE,
  recentShare,
} from './record-age';

// CAMP-256 — the OSM edit date, against a REAL PostgreSQL.
//
// 🔴 THE QUESTION IS ABOUT WHAT THE DATABASE STORES. The card's named
// failure — "if every record is suddenly 2026, the import wrote the load
// date instead of the OSM edit date; it looks like success" — is a
// statement about two columns in one row and which instant each one holds.
// A test of the SQL's text cannot tell `$13` from `$9`; this one stores a
// date from 2023 in a run that started in 2026 and reads both back.
//
// 🔴 THE THREE COLUMNS ARE ONE FACT (date, version, and the object they belong
// to: `osm_record_ref`). They are asserted TOGETHER, in one `toEqual`, so a
// version that moved without its ref — or a ref that is `osm_ref` by habit
// where a merged row's differs — cannot hide behind a test of one column.
//
// 🔴 EVERY STATEMENT UNDER TEST IS IMPORTED, NOT RETYPED: the real
// migration's `up()`, the importer's own `UPSERT_SPOT_SQL` and the one
// function that builds its parameters. Only the pre-existing columns of
// the table are declared here, the way overnight.db.spec.ts does it.
//
// 🔴 EVERY DATE BELOW IS TYPED. `2023-06-14T10:11:12.000Z` is written out
// in the assertion, not computed from the value that was passed in.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI sets it): any
// PostGIS database you may CREATE DATABASE in. This file creates its own
// `camp256_*` database and drops it.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const runner = (): QueryRunner =>
  ({ query: async (sql: string) => db.query(sql) }) as unknown as QueryRunner;

const MIGRATION = new SpotRecordEdited1791800000000();

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp256_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');

  // The columns the importer's UPSERT touches, with the types the real
  // table has. NOT the overnight or the edit-date ones: those come from the
  // real migrations below.
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
      content_changed_at timestamptz)`);
  // 🔴 A row that existed BEFORE the migration, with the columns a writer of
  // that day knew. It must come out of the migration reading "not known".
  await db.query(
    `INSERT INTO camping_spots (osm_ref, country, slug, type, location, last_seen_at)
     VALUES ('n-legacy', 'HR', 'legacy', 'paid',
             ST_SetSRID(ST_MakePoint(14, 45), 4326), '2026-10-05T04:00:00Z')`,
  );
  await new SpotOvernight1791500000000().up(runner());
  await MIGRATION.up(runner());
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

/** One run of the importer's statement for one campsite. */
async function upsert(
  osmRef: string,
  /** The object's own edit, or `null` for "not known". Its ref is `osmRef`. */
  record: { editedAt: Date; version: number | null } | null,
  opts: { startedAt?: string; name?: string; recordRef?: string } = {},
) {
  const res = await db.query(
    UPSERT_SPOT_SQL,
    upsertSpotParams({
      name: opts.name ?? `Camp ${osmRef}`,
      country: 'HR',
      region: 'Istria',
      slug: `camp-${osmRef}`,
      type: 'paid',
      amenities: {},
      pointWkt: 'POINT(14 45)',
      osmRef,
      seenAt: opts.startedAt ?? '2026-10-12T05:00:00Z',
      contact: {},
      overnightStatus: 'unknown',
      overnightSource: null,
      // The ref is the row's own osm_ref unless the test says this row was
      // built from several objects and the date is another one's.
      record:
        record === null ? null : { ref: opts.recordRef ?? osmRef, ...record },
    }),
  );
  return res.rows[0] as { was_insert: boolean; content_changed: boolean };
}

/** The two dates of one row, with the version and ref beside them, as Postgres would print them in UTC. */
const datesOf = async (osmRef: string) =>
  (
    await db.query(
      `SELECT to_char(osm_record_edited_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited,
              to_char(last_seen_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS seen,
              osm_record_version AS version,
              osm_record_ref AS ref,
              content_changed_at
         FROM camping_spots WHERE osm_ref = $1`,
      [osmRef],
    )
  ).rows[0] as {
    edited: string | null;
    seen: string | null;
    version: number | null;
    ref: string | null;
    content_changed_at: Date;
  };

const EDITED_2023 = new Date('2023-06-14T10:11:12Z');

describe('the migration', () => {
  it('adds the three columns, nullable, with no default — and the four constraints', async () => {
    const cols = (
      await db.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'camping_spots' AND column_name LIKE 'osm_record_%'
          ORDER BY column_name`,
      )
    ).rows;
    // Anchor: all three columns, or every assertion after this reads nothing.
    expect(cols.map((c) => c.column_name)).toEqual([
      'osm_record_edited_at',
      'osm_record_ref',
      'osm_record_version',
    ]);
    expect(cols[0]).toMatchObject({
      data_type: 'timestamp with time zone',
      is_nullable: 'YES',
      column_default: null,
    });
    // The ref is the same type as osm_ref, so `osm_record_ref = osm_ref`
    // compares like with like.
    expect(cols[1]).toMatchObject({
      data_type: 'character varying',
      is_nullable: 'YES',
      column_default: null,
    });
    expect(cols[2]).toMatchObject({
      data_type: 'integer',
      is_nullable: 'YES',
      column_default: null,
    });

    const cons = (
      await db.query(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'camping_spots'::regclass
            AND conname LIKE '%osm_record%' ORDER BY conname`,
      )
    ).rows.map((r) => r.conname);
    expect(cons).toEqual([
      'camping_spots_osm_record_edited_range_check',
      'camping_spots_osm_record_origin_check',
      'camping_spots_osm_record_ref_check',
      'camping_spots_osm_record_version_check',
    ]);
  });

  it('🔴 a row that existed before it reads "not known" — never last_seen_at, never now()', async () => {
    const r = await datesOf('n-legacy');
    // The legacy row HAS a last_seen_at (2026-10-05); that must not have
    // been copied across.
    expect(r.seen).toBe('2026-10-05T04:00:00Z');
    expect(r.edited).toBeNull();
    expect(r.version).toBeNull();
    expect(r.ref).toBeNull();
  });

  it('the column says in the catalogue that it is NOT last_seen_at', async () => {
    const c = (
      await db.query(
        `SELECT col_description('camping_spots'::regclass,
                  (SELECT attnum FROM pg_attribute
                    WHERE attrelid = 'camping_spots'::regclass
                      AND attname = 'osm_record_edited_at')) AS comment`,
      )
    ).rows[0].comment as string;
    expect(c).toContain('NOT last_seen_at');
  });

  it('🔴 the ref column says in the catalogue that it is NOT always osm_ref', async () => {
    const c = (
      await db.query(
        `SELECT col_description('camping_spots'::regclass,
                  (SELECT attnum FROM pg_attribute
                    WHERE attrelid = 'camping_spots'::regclass
                      AND attname = 'osm_record_ref')) AS comment`,
      )
    ).rows[0].comment as string;
    expect(c).toContain('EXCEPT');
    expect(c).toContain('not on osm_ref');
  });

  it('up is idempotent, and down takes the columns and the constraints away', async () => {
    await MIGRATION.up(runner());
    await MIGRATION.up(runner());
    await MIGRATION.down(runner());
    const left = (
      await db.query(
        `SELECT
           (SELECT count(*)::int FROM information_schema.columns
             WHERE table_name = 'camping_spots'
               AND column_name LIKE 'osm_record_%') AS cols,
           (SELECT count(*)::int FROM pg_constraint
             WHERE conrelid = 'camping_spots'::regclass
               AND conname LIKE '%osm_record%') AS cons`,
      )
    ).rows[0];
    expect(left).toEqual({ cols: 0, cons: 0 });
    await MIGRATION.down(runner());
    await MIGRATION.up(runner());
    const back = (
      await db.query(
        `SELECT count(*)::int AS n FROM pg_constraint
          WHERE conrelid = 'camping_spots'::regclass
            AND conname LIKE '%osm_record%'`,
      )
    ).rows[0];
    expect(back.n).toBe(4);
  });

  it('🔴 a database that already holds the FIRST shape (dates and versions, no ref) comes out with those NULL — not a date kept under a ref it never had', async () => {
    // dev did, from 15.10.2026. Isolated in its own schema, so the rows the
    // other tests hold are not touched.
    await db.query('CREATE SCHEMA first_shape');
    try {
      await db.query('SET search_path TO first_shape, public');
      await db.query(`
        CREATE TABLE camping_spots (
          osm_ref varchar UNIQUE,
          osm_record_edited_at timestamptz,
          osm_record_version integer)`);
      await db.query(`
        INSERT INTO camping_spots VALUES
          ('n-dated',   '2023-06-14T10:11:12Z', 7),
          ('n-nover',   '2021-01-02T03:04:05Z', NULL),
          ('n-vonly',   NULL,                   4),
          ('n-unknown', NULL,                   NULL)`);
      await MIGRATION.up(runner());
      const rows = (
        await db.query(
          `SELECT osm_ref, osm_record_edited_at AS at, osm_record_version AS v,
                  osm_record_ref AS ref
             FROM camping_spots ORDER BY osm_ref`,
        )
      ).rows;
      // Anchor: all four rows are still there — nulled, not deleted.
      expect(rows.map((r) => r.osm_ref)).toEqual([
        'n-dated',
        'n-nover',
        'n-unknown',
        'n-vonly',
      ]);
      expect(
        rows.every((r) => r.at === null && r.v === null && r.ref === null),
      ).toBe(true);
      // …and the new invariant is now in force on that table.
      await expect(
        db.query(
          `INSERT INTO camping_spots VALUES ('n-late', '2023-06-14T10:11:12Z', 7)`,
        ),
      ).rejects.toThrow(/camping_spots_osm_record_ref_check/);
    } finally {
      await db.query('RESET search_path');
      await db.query('DROP SCHEMA first_shape CASCADE');
    }
  });

  it('…and a second run changes nothing: a row that HAS its ref keeps its date', async () => {
    await upsert('n-rerun', { editedAt: EDITED_2023, version: 7 });
    await MIGRATION.up(runner());
    await MIGRATION.up(runner());
    expect(await datesOf('n-rerun')).toMatchObject({
      edited: '2023-06-14T10:11:12Z',
      version: 7,
      ref: 'n-rerun',
    });
  });
});

describe('the table refuses a date that cannot be an OSM edit', () => {
  /**
   * `ref` left out means the row's own osm_ref when there is a date, none when
   * there is not — the shape the importer writes. Pass `null` or another
   * string to write the shapes the table must refuse.
   */
  const insert = (
    slug: string,
    osmRef: string | null,
    editedAt: string | null,
    version: number | null,
    ref?: string | null,
  ) =>
    db.query(
      `INSERT INTO camping_spots
         (osm_ref, country, slug, type, location,
          osm_record_edited_at, osm_record_version, osm_record_ref)
       VALUES ($1, 'HR', $2, 'paid', ST_SetSRID(ST_MakePoint(14, 45), 4326),
               $3::timestamptz, $4::integer, $5::text)`,
      [
        osmRef,
        slug,
        editedAt,
        version,
        ref === undefined ? (editedAt === null ? null : osmRef) : ref,
      ],
    );

  it('anchor: a plausible date and version on an OSM row are stored', async () => {
    await insert('ok-1', 'n-ok-1', '2023-06-14T10:11:12Z', 7);
    expect(await datesOf('n-ok-1')).toMatchObject({
      edited: '2023-06-14T10:11:12Z',
      version: 7,
      ref: 'n-ok-1',
    });
  });

  it('🔴 the year 1970 is refused (a zero that survived a cast) — edited_range', async () => {
    await expect(
      insert('bad-1', 'n-bad-1', '1970-01-01T00:00:00Z', 1),
    ).rejects.toThrow(/camping_spots_osm_record_edited_range_check/);
  });

  it('🔴 a year in the tens of thousands is refused (milliseconds read as seconds) — edited_range', async () => {
    await expect(
      db.query(
        `INSERT INTO camping_spots
           (osm_ref, country, slug, type, location,
            osm_record_edited_at, osm_record_ref)
         VALUES ('n-bad-2', 'HR', 'bad-2', 'paid',
                 ST_SetSRID(ST_MakePoint(14, 45), 4326),
                 to_timestamp(1787953167000), 'n-bad-2')`,
      ),
    ).rejects.toThrow(/camping_spots_osm_record_edited_range_check/);
  });

  it('the first day of OpenStreetMap is the floor: 2004-08-01 passes, 2004-07-31 does not', async () => {
    await insert('floor-ok', 'n-floor-ok', '2004-08-01T00:00:00Z', 1);
    await expect(
      insert('floor-bad', 'n-floor-bad', '2004-07-31T23:59:59Z', 1),
    ).rejects.toThrow(/camping_spots_osm_record_edited_range_check/);
  });

  it('🔴 version 0 is refused — version_check', async () => {
    await expect(
      insert('bad-3', 'n-bad-3', '2023-06-14T10:11:12Z', 0),
    ).rejects.toThrow(/camping_spots_osm_record_version_check/);
  });

  it('🔴 a date on a row with no OSM object is refused — origin_check', async () => {
    await expect(
      insert('bad-4', null, '2023-06-14T10:11:12Z', 7),
    ).rejects.toThrow(/camping_spots_osm_record_origin_check/);
  });

  it('…and so is a version alone', async () => {
    await expect(insert('bad-5', null, null, 7)).rejects.toThrow(
      /camping_spots_osm_record_origin_check/,
    );
  });

  it('🔴 a date with no ref is refused — ref_check: a pair nobody can look up', async () => {
    await expect(
      insert('bad-6', 'n-bad-6', '2023-06-14T10:11:12Z', 7, null),
    ).rejects.toThrow(/camping_spots_osm_record_ref_check/);
  });

  it('🔴 a ref with no date is refused — ref_check: an object named for nothing', async () => {
    await expect(
      insert('bad-7', 'n-bad-7', null, null, 'n-bad-7'),
    ).rejects.toThrow(/camping_spots_osm_record_ref_check/);
  });

  it("a ref that is NOT the row's osm_ref is accepted — that is what a merged row is", async () => {
    await insert(
      'merged-1',
      'w-merged-1',
      '2026-09-30T10:11:12Z',
      2,
      'n-merged-1',
    );
    expect(await datesOf('w-merged-1')).toMatchObject({
      edited: '2026-09-30T10:11:12Z',
      version: 2,
      ref: 'n-merged-1',
    });
  });

  it('a row with no OSM object and no date is fine — that is every DATAtourisme row', async () => {
    await insert('datatourisme-1', null, null, null);
    const r = (
      await db.query(
        `SELECT osm_record_edited_at FROM camping_spots WHERE slug = 'datatourisme-1'`,
      )
    ).rows[0];
    expect(r.osm_record_edited_at).toBeNull();
  });
});

describe('the weekly upsert writes the EDIT date, and not the date of the run', () => {
  it('🔴 a record edited in 2023, imported in 2026, holds BOTH dates, each its own', async () => {
    await upsert(
      'n-2023',
      { editedAt: EDITED_2023, version: 7 },
      { startedAt: '2026-10-12T05:00:00Z' },
    );
    // An UNMERGED row: the object the date belongs to is the row's own.
    expect(await datesOf('n-2023')).toMatchObject({
      edited: '2023-06-14T10:11:12Z',
      seen: '2026-10-12T05:00:00Z',
      version: 7,
      ref: 'n-2023',
    });
  });

  it('🔴 a row built from SEVERAL objects stores the date, the version and the ref of the NEWEST one: osm_ref w, osm_record_ref n', async () => {
    // Review's case. The row is keyed on the way; the date and version are the
    // node's, and the row says so.
    await upsert(
      'w-merged',
      { editedAt: new Date('2026-09-30T10:11:12Z'), version: 2 },
      { recordRef: 'n-merged-away' },
    );
    expect(await datesOf('w-merged')).toEqual(
      expect.objectContaining({
        edited: '2026-09-30T10:11:12Z',
        version: 2,
        ref: 'n-merged-away',
      }),
    );
    const keyed = (
      await db.query(
        `SELECT osm_ref, osm_record_ref FROM camping_spots WHERE osm_ref = 'w-merged'`,
      )
    ).rows[0];
    expect(keyed).toEqual({
      osm_ref: 'w-merged',
      osm_record_ref: 'n-merged-away',
    });
  });

  it('🔴 the ref moves WITH the date on the next import: the newest object of a cluster changes, and so do all three', async () => {
    await upsert(
      'w-move',
      { editedAt: new Date('2026-09-30T10:11:12Z'), version: 2 },
      { recordRef: 'n-move-1' },
    );
    await upsert(
      'w-move',
      { editedAt: new Date('2026-10-10T01:02:03Z'), version: 5 },
      { recordRef: 'n-move-2', startedAt: '2026-10-19T05:00:00Z' },
    );
    expect(await datesOf('w-move')).toMatchObject({
      edited: '2026-10-10T01:02:03Z',
      version: 5,
      ref: 'n-move-2',
    });
  });

  it('🔴 not known stays not known: no date in, no date out — not the run date', async () => {
    await upsert('n-nodate', null, { startedAt: '2026-10-12T05:00:00Z' });
    const r = await datesOf('n-nodate');
    expect(r.edited).toBeNull();
    expect(r.version).toBeNull();
    expect(r.ref).toBeNull();
    // …and last_seen_at DID move, so the two columns really are two.
    expect(r.seen).toBe('2026-10-12T05:00:00Z');
  });

  it('a mapper edits the object: the next import carries the new date and version', async () => {
    await upsert('n-edit', { editedAt: EDITED_2023, version: 7 });
    await upsert(
      'n-edit',
      { editedAt: new Date('2026-09-30T06:07:08Z'), version: 8 },
      { startedAt: '2026-10-19T05:00:00Z' },
    );
    expect(await datesOf('n-edit')).toMatchObject({
      edited: '2026-09-30T06:07:08Z',
      seen: '2026-10-19T05:00:00Z',
      version: 8,
      ref: 'n-edit',
    });
  });

  it("🔴 a row's name, edit date and version always come from the SAME import — a rename never keeps the old date", async () => {
    // Review's real row: Arlberg, a relation. The extract of 24.09 had version 2
    // (2022-09-08) under the name "Campingplatz Arlberg @ EuroParcs"; by the next
    // import it was version 3 (2026-10-08) under "Austria Parks Arlberg". The row
    // that reached the page had the NEW name and the OLD date and version — a
    // caption about one version over data from another, which reads as a fact.
    await upsert(
      'n-arlberg',
      { editedAt: new Date('2022-09-08T10:35:19Z'), version: 2 },
      { name: 'Campingplatz Arlberg @ EuroParcs' },
    );
    await upsert(
      'n-arlberg',
      { editedAt: new Date('2026-10-08T14:48:38Z'), version: 3 },
      { name: 'Austria Parks Arlberg', startedAt: '2026-10-19T05:00:00Z' },
    );
    const row = (
      await db.query(
        `SELECT name, osm_record_version AS version,
                osm_record_ref AS ref,
                to_char(osm_record_edited_at AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited
           FROM camping_spots WHERE osm_ref = 'n-arlberg'`,
      )
    ).rows[0];
    // All of them are the second import's, together.
    expect(row).toEqual({
      name: 'Austria Parks Arlberg',
      version: 3,
      ref: 'n-arlberg',
      edited: '2026-10-08T14:48:38Z',
    });
  });

  it('🔴 re-reading an UNCHANGED record a week later moves last_seen_at and leaves the edit date alone', async () => {
    await upsert(
      'n-same',
      { editedAt: EDITED_2023, version: 7 },
      { startedAt: '2026-10-12T05:00:00Z' },
    );
    await upsert(
      'n-same',
      { editedAt: EDITED_2023, version: 7 },
      { startedAt: '2026-10-19T05:00:00Z' },
    );
    expect(await datesOf('n-same')).toMatchObject({
      edited: '2023-06-14T10:11:12Z',
      seen: '2026-10-19T05:00:00Z',
      version: 7,
    });
  });

  it("🔴 an extract that no longer carries the date CLEARS it: last import's date is not left under this import's", async () => {
    await upsert('n-lost', { editedAt: EDITED_2023, version: 7 });
    await upsert('n-lost', null, { startedAt: '2026-10-19T05:00:00Z' });
    const r = await datesOf('n-lost');
    expect(r.edited).toBeNull();
    expect(r.version).toBeNull();
    // …and the ref goes with them: a ref kept under no date is refused.
    expect(r.ref).toBeNull();
  });

  it('a date with no version is stored as the date alone — the version is not invented', async () => {
    await upsert('n-nover', { editedAt: EDITED_2023, version: null });
    expect(await datesOf('n-nover')).toMatchObject({
      edited: '2023-06-14T10:11:12Z',
      version: null,
      ref: 'n-nover',
    });
  });

  it('🔴 the FIRST load of the column does not move content_changed_at — no sitemap storm', async () => {
    // A campsite imported before the column existed: same name, same
    // everything, no edit date. Then the load that fills it in.
    const first = await upsert('n-lastmod', null);
    expect(first.was_insert).toBe(true);
    const before = (await datesOf('n-lastmod')).content_changed_at;

    const second = await upsert(
      'n-lastmod',
      { editedAt: EDITED_2023, version: 7 },
      { startedAt: '2026-10-19T05:00:00Z' },
    );
    expect(second.was_insert).toBe(false);
    // The importer reports this as "content did not change"…
    expect(second.content_changed).toBe(false);
    // …and the column a sitemap's <lastmod> is built from did not move.
    const after = (await datesOf('n-lastmod')).content_changed_at;
    expect(after.toISOString()).toBe(before.toISOString());
    // Anchor: the date really did land in that very statement.
    expect((await datesOf('n-lastmod')).edited).toBe('2023-06-14T10:11:12Z');
  });

  it('anchor for the case above: a changed NAME does move content_changed_at', async () => {
    await upsert('n-name', { editedAt: EDITED_2023, version: 7 });
    const second = await upsert(
      'n-name',
      { editedAt: EDITED_2023, version: 7 },
      { startedAt: '2026-10-19T05:00:00Z', name: 'Renamed' },
    );
    expect(second.content_changed).toBe(true);
  });
});

describe('🔴 the importer refuses a country whose STORED dates are the date of the load', () => {
  // The card's named failure, put in the table by the real statement and
  // caught by the real read-back. The substitution is made in the STATEMENT
  // (the one place an input-side check could not see it): `$13`, the edit
  // date, is swapped for `$9`, the run's start.
  // (`$13` stays referenced, inside a COALESCE whose first argument is never
  // null, so Postgres can still type every parameter and the statement runs —
  // a mutation that crashed would be "caught" by the crash, not by the check.)
  const SUBSTITUTED = UPSERT_SPOT_SQL.replace(
    '$13::timestamptz, $14::integer',
    'COALESCE($9::timestamptz, $13::timestamptz), $14::integer',
  );

  /** `n` campsites upserted by one run, each with the edit date `dateOf(i)`. */
  async function run(
    sql: string,
    startedAt: string,
    n: number,
    dateOf: (i: number) => Date,
    prefix: string,
  ) {
    for (let i = 0; i < n; i++) {
      await db.query(
        sql,
        upsertSpotParams({
          name: `Camp ${prefix}${i}`,
          country: 'HR',
          region: 'Istria',
          slug: `camp-${prefix}${i}`,
          type: 'paid',
          amenities: {},
          pointWkt: 'POINT(14 45)',
          osmRef: `n-${prefix}${i}`,
          seenAt: startedAt,
          contact: {},
          overnightStatus: 'unknown',
          overnightSource: null,
          record: {
            ref: `n-${prefix}${i}`,
            editedAt: dateOf(i),
            version: 3,
          },
        }),
      );
    }
  }

  /** Real-looking dates: one a day, going back from March 2026. */
  const spread = (i: number) =>
    new Date(Date.UTC(2026, 2, 1) - i * 86_400_000 - 7 * 3_600_000);

  it('anchor: the mutation lands — the substituted statement really differs from the real one', () => {
    expect(SUBSTITUTED).not.toBe(UPSERT_SPOT_SQL);
    expect(SUBSTITUTED).toContain(
      'COALESCE($9::timestamptz, $13::timestamptz)',
    );
  });

  it('real dates: the read-back returns every stored date and does not refuse', async () => {
    const START = '2026-10-13T05:00:00Z';
    await run(UPSERT_SPOT_SQL, START, 150, spread, 'real-');
    const dates = await assertStoredEditDates(db, new Date(START), 'HR');
    expect(dates).toHaveLength(150);
    expect(dates.every((d) => d !== null)).toBe(true);
  });

  it('🔴 the load date written over 150 rows by the STATEMENT is refused, naming the country', async () => {
    const START = '2026-10-14T05:00:00Z';
    await run(SUBSTITUTED, START, 150, spread, 'sub-');
    // The table now says every one of them was edited at 05:00 on the 14th.
    const held = (
      await db.query(
        `SELECT count(*)::int AS n FROM camping_spots
          WHERE osm_ref LIKE 'n-sub-%'
            AND osm_record_edited_at = $1::timestamptz`,
        [START],
      )
    ).rows[0].n;
    expect(held).toBe(150);
    await expect(
      assertStoredEditDates(db, new Date(START), 'HR'),
    ).rejects.toThrow(
      /^HR: 150 of 150 dated records claim an edit within 48 hours/,
    );
  });

  it('🔴 …and on exactly 10 rows — the floor — it is refused too', async () => {
    // The size of a country is not the point (the smallest we hold moves: see
    // MIN_RECORDS_TO_JUDGE); the floor is. Ten is judged, nine is not (next test).
    const START = '2026-10-15T05:00:00Z';
    await run(SUBSTITUTED, START, 10, spread, 'floor-');
    await expect(
      assertStoredEditDates(db, new Date(START), 'XX'),
    ).rejects.toThrow(
      /^XX: 10 of 10 dated records claim an edit within 48 hours/,
    );
  });

  it('the same substitution on 9 rows is not judged: too few to say', async () => {
    const START = '2026-10-16T05:00:00Z';
    await run(SUBSTITUTED, START, 9, spread, 'few-');
    const dates = await assertStoredEditDates(db, new Date(START), 'HR');
    expect(dates).toHaveLength(9);
  });

  it("only THIS run's rows are read: an earlier run's are not in the sum", async () => {
    // 'real-' rows were stamped 13 October; a run that started on the 20th
    // wrote none, and reads none of them.
    const dates = await assertStoredEditDates(
      db,
      new Date('2026-10-20T05:00:00Z'),
      'HR',
    );
    expect(dates).toEqual([]);
  });
});

describe('🔴 edit-date-distribution.sql, the statement a person runs after a load', () => {
  // Review found it blind exactly where the mistake happens. An import runs per
  // COUNTRY, and section 4 aggregated all of them: one country at 100% among
  // twenty-six honest ones moved the percentage to 3.81% and printed `ok`.
  // Its floor of 100 rows also made it blind to every country the importer's own
  // guard could not judge.
  //
  // This runs THE FILE — read from disk, its psql meta-commands stripped, its
  // `:'only'` variable bound — not a retyped copy of the query, and it runs it
  // against the importer's own rule (`loadDateVerdict`).
  const FILE = join(
    __dirname,
    '../../../../scripts/osm-pipeline/edit-date-distribution.sql',
  );

  /** The statement that carries the verdict, ready for pg: `:'only'` -> $1. */
  function verdictSql(): string {
    const statements = readFileSync(FILE, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('\\'))
      .join('\n')
      .split(/;\s*\n/)
      .filter((st) => /AS verdict/.test(st));
    // Anchor: exactly one statement carries a verdict, or this reads nothing.
    expect(statements).toHaveLength(1);
    return statements[0].split(":'only'").join('$1::text');
  }

  const RUN_AT = '2026-10-15T05:00:00Z';

  /**
   * `n` dated OSM rows for one country; `recent` of them edited `minutesBefore`
   * minutes before the run (an hour unless said), the rest years before.
   */
  async function seedCountry(
    code: string,
    n: number,
    recent: number,
    minutesBefore = 60,
  ) {
    await db.query(
      `INSERT INTO camping_spots
         (osm_ref, country, slug, type, location, last_seen_at,
          osm_record_edited_at, osm_record_version, osm_record_ref)
       SELECT $1::text || i::text, $1::text, $1::text || '-s' || i::text, 'paid',
              ST_SetSRID(ST_MakePoint(14, 45), 4326), $4::timestamptz,
              CASE WHEN i <= $3::int
                   THEN $4::timestamptz - ($5::int * interval '1 minute')
                   ELSE '2019-03-01T00:00:00Z'::timestamptz - (i::text || ' days')::interval
              END,
              3,
              $1::text || i::text
         FROM generate_series(1, $2::int) AS i`,
      [code, n, recent, RUN_AT, minutesBefore],
    );
  }

  const verdicts = async (prefix: string) =>
    Object.fromEntries(
      (
        await db.query<{ country: string; verdict: string }>(verdictSql(), [''])
      ).rows
        .filter((r) => r.country.startsWith(prefix))
        .map((r) => [r.country, r.verdict]),
    );

  it('🔴 one substituted country among twenty-six honest ones is RED — and the honest ones are not', async () => {
    for (let i = 0; i < 26; i++) {
      await seedCountry(`HN${String(i).padStart(2, '0')}`, 300, 1);
    }
    await seedCountry('HNXX', 150, 150);
    const v = await verdicts('HN');
    expect(Object.keys(v)).toHaveLength(27);
    expect(v.HNXX).toMatch(/^RED/);
    expect(
      Object.entries(v)
        .filter(([c]) => c !== 'HNXX')
        .map(([, x]) => x),
    ).toEqual(Array(26).fill('ok'));
    // …which is exactly what the old all-countries percentage could not say:
    // 150 recent of 7 950 dated rows is under 2%.
    const overall = (
      await db.query(
        `SELECT 100.0 * count(*) FILTER (WHERE osm_record_edited_at >= last_seen_at - interval '48 hours')
                / count(*) AS pct
           FROM camping_spots WHERE country LIKE 'HN%'`,
      )
    ).rows[0].pct;
    expect(Number(overall)).toBeLessThan(3);
  });

  it('🔴 a country is RED at 100% at EVERY size from the floor up — not at the sizes the countries happened to have', async () => {
    // It was "Malta 14, Cyprus 55, Luxembourg 83": three numbers about live data
    // (two of them wrong the day they were checked), and a test that held on
    // them said nothing about the size in between. The rule is about EVERY
    // size, so every size from 10 to 60 is a country of its own here.
    const sizes = Array.from({ length: 51 }, (_, i) => 10 + i);
    for (const n of sizes) await seedCountry(`SZ${n}`, n, n);
    const v = await verdicts('SZ');
    // Anchor: all 51 are there, or "none of them is wrong" reads nothing.
    expect(Object.keys(v)).toHaveLength(sizes.length);
    expect(
      Object.entries(v)
        .filter(([, verdict]) => !/^RED/.test(verdict))
        .map(([country]) => country),
    ).toEqual([]);
  });

  it('below the floor it is SUSPECT, never ok: nine rows at 100% is not a clean bill of health', async () => {
    await seedCountry('UNI', 9, 9);
    await seedCountry('UNJ', 9, 2);
    const v = await verdicts('UN');
    expect(v.UNI).toMatch(/^SUSPECT/);
    expect(v.UNJ).toBe('ok');
  });

  it('`-v only=XX` narrows it to one country', async () => {
    const rows = (await db.query(verdictSql(), ['HNXX'])).rows;
    expect(rows.map((r) => r.country)).toEqual(['HNXX']);
  });

  it("🔴 the file's verdict and the importer's agree on every case around the line, and on the floor", async () => {
    // (n, recent) pairs straddling the 90% line and the floor. Each is
    // seeded as its own country, judged by THE FILE, and judged by
    // `loadDateVerdict` on the same dates — RED must mean "the importer
    // would refuse it", and SUSPECT "it is under the floor and over the line".
    const cases: [number, number, number][] = [];
    for (const n of [5, 9, 10, 11, 19, 20, 27, 30, 99, 100, 101, 250]) {
      for (const recent of new Set([
        0,
        Math.max(0, Math.floor(0.9 * n) - 1),
        Math.floor(0.9 * n),
        Math.ceil(0.9 * n),
        Math.min(n, Math.ceil(0.9 * n) + 1),
        n,
      ])) {
        cases.push([n, recent, 60]);
      }
    }
    // The WINDOW, as well as the line and the floor: every recent row sits
    // 47 h, exactly 48 h, 48 h and a minute, and 72 h before the run. Review's
    // mutation — the file's window shortened to an hour — survived the grid
    // above, because every "recent" row in it was an hour old.
    for (const minutes of [47 * 60, 48 * 60, 48 * 60 + 1, 72 * 60]) {
      cases.push([100, 100, minutes], [20, 18, minutes], [13, 13, minutes]);
    }
    for (const [i, [n, recent, minutes]] of cases.entries()) {
      await seedCountry(`TW${String(i).padStart(3, '0')}`, n, recent, minutes);
    }
    const v = await verdicts('TW');
    expect(Object.keys(v)).toHaveLength(cases.length);

    const started = new Date(RUN_AT);
    const disagreements: string[] = [];
    let red = 0;
    let suspect = 0;
    for (const [i, [n, recent, minutes]] of cases.entries()) {
      const dates = [
        ...Array.from(
          { length: recent },
          () => new Date(started.getTime() - minutes * 60_000),
        ),
        ...Array.from(
          { length: n - recent },
          () => new Date('2019-01-01T00:00:00Z'),
        ),
      ];
      const importerRefuses = loadDateVerdict(dates, started) !== null;
      // "Over the line" as the IMPORTER counts recent rows, window included.
      const counted = recentShare(dates, started);
      const overLine = 10 * counted.recent >= 9 * counted.dated;
      const want = importerRefuses
        ? 'RED'
        : n < MIN_RECORDS_TO_JUDGE && overLine
          ? 'SUSPECT'
          : 'ok';
      const got = v[`TW${String(i).padStart(3, '0')}`].split(':')[0];
      if (got !== want)
        disagreements.push(
          `n=${n} recent=${recent} at ${minutes} min: file ${got}, importer ${want}`,
        );
      if (want === 'RED') red++;
      if (want === 'SUSPECT') suspect++;
    }
    expect(disagreements).toEqual([]);
    // Anchor: the grid really contains all three outcomes, or "they agree"
    // could mean "they agree that nothing is wrong".
    expect(red).toBeGreaterThan(8);
    expect(suspect).toBeGreaterThanOrEqual(2); // n=5 and n=9, each at its first count over the line
    expect(cases.length - red - suspect).toBeGreaterThan(20);
  });
});
