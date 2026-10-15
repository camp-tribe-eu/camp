import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { SpotOvernight1791500000000 } from '../migrations/1791500000000-SpotOvernight';
import { SpotRecordEdited1791800000000 } from '../migrations/1791800000000-SpotRecordEdited';
import {
  assertStoredEditDates,
  UPSERT_SPOT_SQL,
  upsertSpotParams,
} from './import-spots';

// CAMP-256 — the OSM edit date, against a REAL PostgreSQL.
//
// 🔴 THE QUESTION IS ABOUT WHAT THE DATABASE STORES. The card's named
// failure — "if every record is suddenly 2026, the import wrote the load
// date instead of the OSM edit date; it looks like success" — is a
// statement about two columns in one row and which instant each one holds.
// A test of the SQL's text cannot tell `$13` from `$9`; this one stores a
// date from 2023 in a run that started in 2026 and reads both back.
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
  record: { editedAt: Date | null; version: number | null },
  opts: { startedAt?: string; name?: string } = {},
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
      record,
    }),
  );
  return res.rows[0] as { was_insert: boolean; content_changed: boolean };
}

/** The two dates of one row, as the strings Postgres would print in UTC. */
const datesOf = async (osmRef: string) =>
  (
    await db.query(
      `SELECT to_char(osm_record_edited_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited,
              to_char(last_seen_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS seen,
              osm_record_version AS version,
              content_changed_at
         FROM camping_spots WHERE osm_ref = $1`,
      [osmRef],
    )
  ).rows[0] as {
    edited: string | null;
    seen: string | null;
    version: number | null;
    content_changed_at: Date;
  };

const EDITED_2023 = new Date('2023-06-14T10:11:12Z');

describe('the migration', () => {
  it('adds the two columns, nullable, with no default — and the three constraints', async () => {
    const cols = (
      await db.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'camping_spots' AND column_name LIKE 'osm_record_%'
          ORDER BY column_name`,
      )
    ).rows;
    // Anchor: both columns, or every assertion after this reads nothing.
    expect(cols.map((c) => c.column_name)).toEqual([
      'osm_record_edited_at',
      'osm_record_version',
    ]);
    expect(cols[0]).toMatchObject({
      data_type: 'timestamp with time zone',
      is_nullable: 'YES',
      column_default: null,
    });
    expect(cols[1]).toMatchObject({
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
    expect(back.n).toBe(3);
  });
});

describe('the table refuses a date that cannot be an OSM edit', () => {
  const insert = (
    slug: string,
    osmRef: string | null,
    editedAt: string | null,
    version: number | null,
  ) =>
    db.query(
      `INSERT INTO camping_spots
         (osm_ref, country, slug, type, location,
          osm_record_edited_at, osm_record_version)
       VALUES ($1, 'HR', $2, 'paid', ST_SetSRID(ST_MakePoint(14, 45), 4326),
               $3::timestamptz, $4::integer)`,
      [osmRef, slug, editedAt, version],
    );

  it('anchor: a plausible date and version on an OSM row are stored', async () => {
    await insert('ok-1', 'n-ok-1', '2023-06-14T10:11:12Z', 7);
    expect((await datesOf('n-ok-1')).edited).toBe('2023-06-14T10:11:12Z');
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
           (osm_ref, country, slug, type, location, osm_record_edited_at)
         VALUES ('n-bad-2', 'HR', 'bad-2', 'paid',
                 ST_SetSRID(ST_MakePoint(14, 45), 4326),
                 to_timestamp(1787953167000))`,
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
    expect(await datesOf('n-2023')).toMatchObject({
      edited: '2023-06-14T10:11:12Z',
      seen: '2026-10-12T05:00:00Z',
      version: 7,
    });
  });

  it('🔴 not known stays not known: no date in, no date out — not the run date', async () => {
    await upsert(
      'n-nodate',
      { editedAt: null, version: null },
      { startedAt: '2026-10-12T05:00:00Z' },
    );
    const r = await datesOf('n-nodate');
    expect(r.edited).toBeNull();
    expect(r.version).toBeNull();
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
    await upsert(
      'n-lost',
      { editedAt: null, version: null },
      { startedAt: '2026-10-19T05:00:00Z' },
    );
    const r = await datesOf('n-lost');
    expect(r.edited).toBeNull();
    expect(r.version).toBeNull();
  });

  it('a date with no version is stored as the date alone — the version is not invented', async () => {
    await upsert('n-nover', { editedAt: EDITED_2023, version: null });
    expect(await datesOf('n-nover')).toMatchObject({
      edited: '2023-06-14T10:11:12Z',
      version: null,
    });
  });

  it('🔴 the FIRST load of the column does not move content_changed_at — no sitemap storm', async () => {
    // A campsite imported before the column existed: same name, same
    // everything, no edit date. Then the load that fills it in.
    const first = await upsert('n-lastmod', { editedAt: null, version: null });
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
          record: { editedAt: dateOf(i), version: 3 },
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

  it('the same substitution on 99 rows is not judged: too few to say', async () => {
    const START = '2026-10-15T05:00:00Z';
    await run(SUBSTITUTED, START, 99, spread, 'few-');
    const dates = await assertStoredEditDates(db, new Date(START), 'HR');
    expect(dates).toHaveLength(99);
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
