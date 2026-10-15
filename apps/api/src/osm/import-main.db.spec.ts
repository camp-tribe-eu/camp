import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { SpotOvernight1791500000000 } from '../migrations/1791500000000-SpotOvernight';
import { SpotRecordEdited1791800000000 } from '../migrations/1791800000000-SpotRecordEdited';

// CAMP-256 — the importer's `main()`, RUN.
//
// 🔴 WHY THE SCRIPT ITSELF, AND NOT ITS PARTS. The guard that refuses a country
// whose stored dates are the date of the load (`assertStoredEditDates`) is a
// tested function — and the line in `main()` that CALLS it was tested by
// nothing. Review replaced
//
//     storedEditDates = await assertStoredEditDates(db, startedAt, COUNTRY);
//
// with `storedEditDates = [];` and 89 of 89 tests stayed green, while no CI
// step runs `main()` at all. A guard that can be removed by deleting its call,
// with every test green, is a comment with an exit code. The same blindness
// once let import-release.mjs ship a `main()` that died on its first line while
// seventy-three tests of its helpers passed.
//
// So this starts the real script — `ts-node src/osm/import-spots.ts HR <table>`
// as a child process, the way the weekly import and import-release.mjs do —
// against a real PostgreSQL holding a staging table, and reads what it printed,
// how it exited and what the table holds afterwards.
//
// 🔴 EVERY EXPECTED DATE IS TYPED. The staging timestamps are Unix seconds
// written out (1686737472 = 2023-06-14T10:11:12Z, worked out with Python's
// calendar.timegm), and the assertions read the dates back out of the table.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs CAMP_TEST_DATABASE_URL
// (locally) or CI_DATABASE_URL (CI sets it): any PostGIS database you may
// CREATE DATABASE in. This file creates its own `camp256m_*` database and drops
// it. The child process gets the database URL through its ENVIRONMENT, never
// its argument list.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(240_000);

const API_DIR = join(__dirname, '../..');
const TS_NODE = require.resolve('ts-node/dist/bin.js');

let admin: Client;
let db: Client;
let dbName: string;
let dbUrl: string;

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
  dbName = `camp256m_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  dbUrl = url.toString();
  db = new Client({ connectionString: dbUrl });
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
      location geometry(Point, 4326) NOT NULL,
      contact jsonb NOT NULL DEFAULT '{}',
      sources jsonb NOT NULL DEFAULT '[]',
      warning_areas text[],
      last_seen_at timestamptz, missing_since timestamptz,
      content_changed_at timestamptz);
    CREATE TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());
    -- The admin-1 layer the importer reads region and country from: one
    -- polygon over every point below.
    CREATE TABLE ne_admin1 (
      name text, iso_a2 text, geom geometry(MultiPolygon, 4326));
    INSERT INTO ne_admin1 VALUES ('Istria', 'HR',
      ST_Multi(ST_GeomFromText('POLYGON((13 44, 17 44, 17 47, 13 47, 13 44))', 4326)));`);
  await new SpotOvernight1791500000000().up(runner());
  await new SpotRecordEdited1791800000000().up(runner());
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

/** 2023-06-14T10:11:12Z, and a point a month later for each following row. */
const BASE = 1686737472;
const MONTH = 2_592_000;

type Stage = {
  table: string;
  /** Unix seconds per row; `null` leaves the value NULL. */
  stamps: (number | null)[];
  /** Create the two edit columns at all? An extract built before CAMP-256 has none. */
  withEditColumns?: boolean;
};

/** A staging table as ogr2ogr lands one: integers for the two attributes. */
async function stage({ table, stamps, withEditColumns = true }: Stage) {
  await db.query(
    `CREATE TABLE ${table} (
       id varchar, geom geometry(Point, 4326), name varchar, tourism varchar
       ${withEditColumns ? ', "@timestamp" integer, "@version" integer' : ''})`,
  );
  for (const [i, ts] of stamps.entries()) {
    await db.query(
      withEditColumns
        ? `INSERT INTO ${table} VALUES ($1, ST_SetSRID(ST_MakePoint($2, 45), 4326), $3, 'camp_site', $4, 5)`
        : `INSERT INTO ${table} (id, geom, name, tourism)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2, 45), 4326), $3, 'camp_site')`,
      withEditColumns
        ? [`n-${table}-${i}`, 14 + i * 0.05, `Camp ${table} ${i}`, ts]
        : [`n-${table}-${i}`, 14 + i * 0.05, `Camp ${table} ${i}`],
    );
  }
}

/**
 * Run the real importer on a staging table, as a child process — invoked
 * exactly as import-release.mjs does (`ts-node src/osm/import-spots.ts <CC>
 * <table>`, no `--transpile-only`: TypeScript 6 refuses that mode here with
 * TS5011, which is also what the real invocation must never need).
 */
function runImporter(table: string) {
  const r = spawnSync(
    process.execPath,
    [TS_NODE, 'src/osm/import-spots.ts', 'HR', table],
    {
      cwd: API_DIR,
      encoding: 'utf8',
      timeout: 120_000,
      // The database goes in the ENVIRONMENT, never the argument list (a URL
      // carries a password in CI). The rest of the environment is inherited
      // — `pg` takes the user name from it when the URL has none — except
      // NODE_OPTIONS, which would carry jest's `--experimental-vm-modules`
      // into a process that does not want it.
      env: { ...process.env, NODE_OPTIONS: '', DATABASE_URL: dbUrl },
    },
  );
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const stored = async (table: string) =>
  (
    await db.query<{
      i: number;
      edited: string | null;
      v: number | null;
    }>(
      `SELECT split_part(osm_ref, '-', 3)::int AS i,
              to_char(osm_record_edited_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited,
              osm_record_version AS v
         FROM camping_spots WHERE osm_ref LIKE $1 ORDER BY 1`,
      [`n-${table}-%`],
    )
  ).rows;

describe('the importer, run', () => {
  it('🔴 anchor: an honest extract imports — exit 0, every date stored as it was staged, last_seen_at left to the run', async () => {
    await stage({
      table: 'honest',
      stamps: Array.from({ length: 12 }, (_, i) => BASE + i * MONTH),
    });
    const r = runImporter('honest');
    expect({ status: r.status, err: r.err.split('\n')[0] }).toEqual({
      status: 0,
      err: '',
    });
    expect(r.out).toContain('inserted           12');
    expect(r.out).toMatch(/OSM edit date\s+dated 12 · not known 0/);
    expect(r.out).toMatch(/edited ≤48 h before this run\s+0 of 12 dated/);

    const rows = await stored('honest');
    expect(rows).toHaveLength(12);
    // Typed: row 0 is 2023-06-14T10:11:12Z, row 1 is 30 days later.
    expect(rows[0]).toEqual({ i: 0, edited: '2023-06-14T10:11:12Z', v: 5 });
    expect(rows[1]).toEqual({ i: 1, edited: '2023-07-14T10:11:12Z', v: 5 });
    // …and the two dates of a row are two: the run is today, the edit is 2023.
    const seen = (
      await db.query(
        `SELECT bool_and(last_seen_at > now() - interval '1 hour') AS today,
                bool_and(osm_record_edited_at < now() - interval '1 year') AS old
           FROM camping_spots WHERE osm_ref LIKE 'n-honest-%'`,
      )
    ).rows[0];
    expect(seen).toEqual({ today: true, old: true });
  });

  it('🔴 an extract whose every "edit" is an hour old is REFUSED by main(): exit non-zero, the reason on stderr, nothing written', async () => {
    // The shape the card names — every record "edited" at the moment of the
    // load — arriving in the staging table. This is the call in `main()` that
    // nothing exercised: take `assertStoredEditDates` out of it and this
    // import exits 0 and commits twelve rows with the load date as their date.
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    await stage({ table: 'loaddate', stamps: Array(12).fill(hourAgo) });
    const r = runImporter('loaddate');

    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(
      /HR: 12 of 12 dated records claim an edit within 48 hours of this import/,
    );
    expect(r.err).toContain('the load date');
    // Rolled back: the country is exactly as it was.
    expect(await stored('loaddate')).toEqual([]);
    // …and the importer did start and did get as far as writing, or "nothing
    // written" would also be true of a script that never ran.
    expect(r.out).not.toContain('OSM edit date');
  });

  it('a country that is refused does not stop the next one: the same script, honest data, again', async () => {
    await stage({
      table: 'honest2',
      stamps: Array.from({ length: 12 }, (_, i) => BASE + i * MONTH),
    });
    expect(runImporter('honest2').status).toBe(0);
    expect(await stored('honest2')).toHaveLength(12);
  });

  it('🔴 a staging table with no @timestamp column (a release built before CAMP-256) imports with NULL dates and SAYS so', async () => {
    await stage({
      table: 'oldrelease',
      stamps: Array(12).fill(null),
      withEditColumns: false,
    });
    const r = runImporter('oldrelease');
    expect(r.status).toBe(0);
    expect(r.out).toContain('has no "@timestamp" column');
    expect(r.out).toMatch(/OSM edit date\s+dated 0 · not known 12/);
    expect(r.out).toMatch(/not known because\s+missing\s+12/);
    const rows = await stored('oldrelease');
    expect(rows).toHaveLength(12);
    expect(rows.every((x) => x.edited === null && x.v === null)).toBe(true);
  });

  it('🔴 one corrupt value costs one record its date, never the run: a zero and a date from next year among ten good ones', async () => {
    const stamps = Array.from({ length: 12 }, (_, i) => BASE + i * MONTH);
    stamps[3] = 0; // the year 1970: a failed cast
    stamps[7] = Math.floor(Date.now() / 1000) + 400 * 86_400; // next year
    await stage({ table: 'corrupt', stamps });
    const r = runImporter('corrupt');
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/OSM edit date\s+dated 10 · not known 2/);
    expect(r.out).toMatch(/not known because\s+before-openstreetmap\s+1/);
    expect(r.out).toMatch(/not known because\s+in-the-future\s+1/);

    const rows = await stored('corrupt');
    expect(rows).toHaveLength(12);
    expect(rows.filter((x) => x.edited === null).map((x) => x.i)).toEqual([
      3, 7,
    ]);
    // The ten good ones keep exactly the date they were staged with.
    expect(rows[0].edited).toBe('2023-06-14T10:11:12Z');
    expect(rows[11].edited).toBe('2024-05-09T10:11:12Z');
  });
});
