import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { SpotOvernight1791500000000 } from '../migrations/1791500000000-SpotOvernight';
import { SpotRecordEdited1791800000000 } from '../migrations/1791800000000-SpotRecordEdited';
import { SpotOutline1792100000000 } from '../migrations/1792100000000-SpotOutline';
import { assertStoredOutlines } from './import-spots';

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
  // 🔴 CAMP-352. Схема тут пишеться руками, а міграції прикладаються
  // ПОІМЕННО, тож нова до списку сама не вступає. Коли імпортер почав
  // писати outline, усі вісім тестів упали зі статусом 1 — не тому, що
  // зламався імпортер, а тому, що в цій таблиці не було колонки.
  await new SpotOutline1792100000000().up(runner());
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
      ref: string | null;
    }>(
      `SELECT split_part(osm_ref, '-', 3)::int AS i,
              to_char(osm_record_edited_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited,
              osm_record_version AS v,
              osm_record_ref AS ref
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
    // Typed: row 0 is 2023-06-14T10:11:12Z, row 1 is 30 days later. Nothing
    // here was merged, so each row's ref is its own osm_ref.
    expect(rows[0]).toEqual({
      i: 0,
      edited: '2023-06-14T10:11:12Z',
      v: 5,
      ref: 'n-honest-0',
    });
    expect(rows[1]).toEqual({
      i: 1,
      edited: '2023-07-14T10:11:12Z',
      v: 5,
      ref: 'n-honest-1',
    });
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
    expect(
      rows.every((x) => x.edited === null && x.v === null && x.ref === null),
    ).toBe(true);
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

describe("🔴 the importer, run on a campsite mapped twice: the date, the version and the ref are ONE object's", () => {
  // Review's case (16.10.2026), through the real script, the real dedupe and a
  // real table: a way `w2` (2012, version 9) holds the row; a node `n1` that
  // adds no tag of its own is the newer object (2026-09-30, version 2). The row
  // was reading `osm_ref = w2` over a date and version that were in the history
  // of no object `w2` could be looked up as. Every Unix second below is written
  // out (calendar.timegm), and every stored value is read back out of the table.
  const W2_2012 = 1333606028; // 2012-04-05T06:07:08Z
  const N1_2026 = 1790763072; // 2026-09-30T10:11:12Z
  const W2_2015 = 1430802305; // 2015-05-05T05:05:05Z
  const N1_2022 = 1643767322; // 2022-02-02T02:02:02Z
  const N3_2026 = 1790816461; // 2026-10-01T01:01:01Z

  type Obj = {
    id: string;
    lon: number;
    ts: number | null;
    version: number | null;
    website?: string;
    toilets?: string;
  };

  async function stageObjects(table: string, objects: Obj[]) {
    await db.query(
      `CREATE TABLE ${table} (
         id varchar, geom geometry(Point, 4326), name varchar, tourism varchar,
         website varchar, toilets varchar,
         "@timestamp" integer, "@version" integer)`,
    );
    for (const o of objects) {
      await db.query(
        `INSERT INTO ${table}
           (id, geom, name, tourism, website, toilets, "@timestamp", "@version")
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, 45), 4326), 'Camp Twice',
                 'camp_site', $3, $4, $5, $6)`,
        [o.id, o.lon, o.website ?? null, o.toilets ?? null, o.ts, o.version],
      );
    }
  }

  const rowsOf = async (prefix: string) =>
    (
      await db.query(
        `SELECT osm_ref, osm_record_ref AS ref, osm_record_version AS v,
                to_char(osm_record_edited_at AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited
           FROM camping_spots WHERE osm_ref LIKE $1 ORDER BY osm_ref`,
        [`${prefix}-%`],
      )
    ).rows;

  it('🔴 w2 (2012, v9) + n1 with no tag of its own (2026-09-30, v2): the row is keyed on w2, and names n1 as the owner of the date and version', async () => {
    await stageObjects('twice', [
      {
        id: 'w-twice-2',
        lon: 14.0,
        ts: W2_2012,
        version: 9,
        website: 'https://bovec.example',
        toilets: 'yes',
      },
      { id: 'n-twice-1', lon: 14.0002, ts: N1_2026, version: 2 },
      // An unmerged neighbour, far away: its ref is its own osm_ref.
      { id: 'n-twice-9', lon: 14.5, ts: W2_2015, version: 14 },
    ]);
    const r = runImporter('twice');
    expect({ status: r.status, err: r.err.split('\n')[0] }).toEqual({
      status: 0,
      err: '',
    });
    // Anchor: the pair REALLY merged (two rows from three objects) — or this
    // is the one-object path and proves nothing about merging.
    expect(r.out).toMatch(/merged duplicates\s+1/);

    expect(await rowsOf('n-twice')).toEqual([
      {
        osm_ref: 'n-twice-9',
        ref: 'n-twice-9',
        v: 14,
        edited: '2015-05-05T05:05:05Z',
      },
    ]);
    expect(await rowsOf('w-twice')).toEqual([
      // Keyed on the way; the pair — date, version, ref — is the node's, whole.
      {
        osm_ref: 'w-twice-2',
        ref: 'n-twice-1',
        v: 2,
        edited: '2026-09-30T10:11:12Z',
      },
    ]);
  });

  it('🔴 three objects, the newest a node at version 1: a fresh date over version 1 names the node, which is where version 1 is', async () => {
    await stageObjects('three', [
      { id: 'w-three-2', lon: 14.0, ts: W2_2015, version: 14 },
      { id: 'n-three-1', lon: 14.0001, ts: N1_2022, version: 6 },
      { id: 'n-three-3', lon: 14.0002, ts: N3_2026, version: 1 },
    ]);
    const r = runImporter('three');
    expect(r.status).toBe(0);
    expect(await rowsOf('w-three')).toEqual([
      {
        osm_ref: 'w-three-2',
        ref: 'n-three-3',
        v: 1,
        edited: '2026-10-01T01:01:01Z',
      },
    ]);
    expect(await rowsOf('n-three')).toEqual([]);
  });

  it("🔴 one of the objects has no date: the row has NO date, no version and no ref — not the other's", async () => {
    await stageObjects('undated', [
      { id: 'w-undated-2', lon: 14.0, ts: W2_2012, version: 9 },
      { id: 'n-undated-1', lon: 14.0002, ts: null, version: null },
    ]);
    const r = runImporter('undated');
    expect(r.status).toBe(0);
    expect(await rowsOf('w-undated')).toEqual([
      { osm_ref: 'w-undated-2', ref: null, v: null, edited: null },
    ]);
  });
});

// CAMP-352. Контур ділянки, наскрізно: від staging до колонки.
//
// 🔴 geom тут geometry(Geometry), а не geometry(Point), і це вся суть
// фікстури. Решта staging-таблиць у цьому файлі тримають самі точки, тож
// полігонна гілка на них не виконується жодного разу — вони б лишились
// зеленими і тоді, коли контур не пишеться взагалі.
describe('🔴 CAMP-352: імпортер пише контур ділянки', () => {
  const TABLE = 'outline_mix';

  beforeAll(async () => {
    await db.query(
      `CREATE TABLE ${TABLE} (
         id varchar, geom geometry(Geometry, 4326), name varchar,
         tourism varchar, "@timestamp" integer, "@version" integer)`,
    );
    await db.query(
      `INSERT INTO ${TABLE} VALUES
         ('a-outline-1',
          ST_GeomFromText(
            'POLYGON((14 45,14.002 45,14.002 45.002,14 45.002,14 45))', 4326),
          'Camp Area', 'camp_site', 1700000000, 3),
         ('n-outline-2',
          ST_SetSRID(ST_MakePoint(15, 45), 4326),
          'Camp Node', 'camp_site', 1700000000, 3),
         -- 🔴 Третій рядок — ПЕРЕДУМОВА всієї картки, і без нього
         -- фікстура не розрізняла правило, заради якого написана.
         -- osmium export віддає закритий way двічі, і коли площа вижила
         -- під a..., вижилий w... це LineString. Відбір «усе, що не
         -- вузол» (тобто isPolygon) дав би йому ST_Multi(LineString) =
         -- MULTILINESTRING і завалив би імпорт на typmod колонки —
         -- рівно та помилка, що названа в картці. З самими лише POLYGON
         -- і POINT префікс і тип геометрії збігаються, і мутація
         -- проходила непоміченою.
         ('w-outline-3',
          ST_GeomFromText('LINESTRING(14.5 45, 14.52 45.01)', 4326),
          'Camp Line', 'camp_site', 1700000000, 3)`,
    );
  });

  it('🔴 площа отримує MULTIPOLYGON, точка не отримує нічого', async () => {
    const r = runImporter(TABLE);
    expect(r.status).toBe(0);
    const rows = await db.query(
      `SELECT osm_ref, GeometryType(outline) AS t
         FROM camping_spots WHERE osm_ref LIKE '%-outline-%'
        ORDER BY osm_ref`,
    );
    expect(rows.rows).toEqual([
      { osm_ref: 'a-outline-1', t: 'MULTIPOLYGON' },
      { osm_ref: 'n-outline-2', t: null },
      { osm_ref: 'w-outline-3', t: null },
    ]);
  });

  it('🔴 збережена точка лежить НА збереженому контурі', async () => {
    // Не формальність: CHECK міграції порівнює з допуском 0.0001 градуса,
    // тобто пропустив би точку за ~11 м від ділянки. Тут питаємо саму
    // відстань, і вона мусить бути нулем — ST_PointOnSurface інакше не
    // буває, а будь-яке інше число означає, що пару зібрано з двох різних
    // обʼєктів.
    const r = await db.query(
      `SELECT ST_Distance(outline, location) AS d
         FROM camping_spots WHERE osm_ref = 'a-outline-1'`,
    );
    expect(Number(r.rows[0].d)).toBe(0);
  });
});

// 🔴 CAMP-352. Поведінкова пара до текстових сторожів у юніт-спеці.
//
// Ті читають ТЕКСТ statement, і цього мало: заміна `OR NOT ST_Equals(…)`
// на `AND NOT ST_Equals(…)` лишає обидва regex збіжними, а умову —
// назавжди не-істинною (`ST_Equals(x, NULL)` віддає NULL). Перемальований
// мапером контур тоді вже ніколи не рухав би <lastmod>, і жоден тест про
// це не сказав би. CAMP-256 на сусідніх рядках має таку пару; тепер має і
// CAMP-352.
describe('🔴 CAMP-352: контур і <lastmod>', () => {
  const T = 'outline_lastmod';
  const REF = 'a-lastmod-1';
  // Більший полігон, що МІСТИТЬ точку на поверхні першого, тож CHECK
  // міграції його приймає. Міняється лише контур — точка стоїть.
  const WIDER =
    'POLYGON((14.29 44.99,14.31 44.99,14.31 45.01,14.29 45.01,14.29 44.99))';

  /**
   * 🔴 Питаємо ВЛАСТИВІСТЬ, а не дві мітки часу.
   *
   * Перша версія порівнювала content_changed_at до і після прогону,
   * обрізаний до секунди, — і флейкувала у 2 прогонах із 5. Критерій був
   * мій, і він був хибний: <lastmod> ставиться РІВНО в last_seen_at того
   * прогону, який побачив зміну. Тож питання не «чи відрізняється від
   * попереднього значення», а «чи дорівнює стемпу ЦЬОГО прогону» — а це
   * не залежить ні від роздільності годинника, ні від того, скільки
   * тривав попередній крок.
   */
  const movedThisRun = async () =>
    (
      await db.query<{ moved: boolean }>(
        `SELECT content_changed_at = last_seen_at AS moved
           FROM camping_spots WHERE osm_ref = $1`,
        [REF],
      )
    ).rows[0].moved;

  const outlineType = async () =>
    (
      await db.query<{ t: string | null }>(
        `SELECT GeometryType(outline) AS t
           FROM camping_spots WHERE osm_ref = $1`,
        [REF],
      )
    ).rows[0].t;

  beforeAll(async () => {
    await db.query(
      `CREATE TABLE ${T} (
         id varchar, geom geometry(Geometry, 4326), name varchar,
         tourism varchar, "@timestamp" integer, "@version" integer)`,
    );
    await db.query(
      `INSERT INTO ${T} VALUES ($1,
         ST_GeomFromText(
           'POLYGON((14.3 45,14.302 45,14.302 45.002,14.3 45.002,14.3 45))',
           4326),
         'Camp Lastmod', 'camp_site', 1700000000, 3)`,
      [REF],
    );
    expect(runImporter(T).status).toBe(0);
  });

  it('🔴 ПЕРШЕ заповнення контуру не рухає <lastmod>', async () => {
    // Стан після міграції #289: точка вже порахована з тієї ж фігури,
    // колонка порожня, бо її не існувало. Рухаємо РІВНО одну змінну —
    // перша версія цієї перевірки рухала ще й точку, і <lastmod> зсувався
    // через location, не через контур.
    await db.query(
      `UPDATE camping_spots SET outline = NULL WHERE osm_ref = $1`,
      [REF],
    );
    expect(runImporter(T).status).toBe(0);

    expect(await outlineType()).toBe('MULTIPOLYGON');
    expect(await movedThisRun()).toBe(false);
  });

  it('🔴 ПЕРЕМАЛЬОВАНИЙ контур рухає <lastmod>', async () => {
    await db.query(
      `UPDATE camping_spots
          SET outline = ST_Multi(ST_GeomFromText($2, 4326))
        WHERE osm_ref = $1`,
      [REF, WIDER],
    );
    expect(runImporter(T).status).toBe(0);

    expect(await outlineType()).toBe('MULTIPOLYGON');
    expect(await movedThisRun()).toBe(true);
  });

  it('🔴 ТОЙ САМИЙ контур удруге НЕ рухає <lastmod>', async () => {
    // Прогалина, яку назвала рецензія: три попередні випадки міняли
    // контур, тож хибний ПОЗИТИВ — щотижневий перезапис тієї самої
    // фігури — не перевіряв ніхто. Жодних UPDATE перед прогоном: і
    // staging, і таблиця лишаються як є.
    expect(runImporter(T).status).toBe(0);

    expect(await outlineType()).toBe('MULTIPOLYGON');
    expect(await movedThisRun()).toBe(false);
  });

  it('🔴 ЗНИКЛИЙ контур рухає <lastmod> — обрис зі сторінки щез', async () => {
    // Площу перемалювали в крапку. Точка береться та сама, щоб
    // зрушив саме контур: ST_PointOnSurface(POINT) це той самий POINT.
    await db.query(
      `UPDATE ${T} SET geom = (SELECT location FROM camping_spots
                                WHERE osm_ref = $1) WHERE id = $1`,
      [REF],
    );
    expect(runImporter(T).status).toBe(0);

    expect(await outlineType()).toBeNull();
    expect(await movedThisRun()).toBe(true);
  });
});

// 🔴 CAMP-352. РЕПЕТИЦІЯ сторожа, а не його переказ.
//
// Перша версія годувала підмінник, що віддавав готові {n, off} — тобто
// відповідь, а не сирі рядки, — і SQL із ST_Distance не виконувався
// ніде. Сторож, якого жодного разу не змусили спрацювати, не доведений:
// з таким самим успіхом він міг би рахувати не ту множину або впасти на
// синтаксисі. Прецедент поруч робить це правильно — assertStoredEditDates
// репетирується на справжній базі.
describe('🔴 CAMP-352: сторож збережених контурів', () => {
  const STAMP = new Date('2026-03-03T03:03:03.000Z');
  const BOX = 'POLYGON((14.3 45,14.302 45,14.302 45.002,14.3 45.002,14.3 45))';

  const plant = async (ref: string, lon: number, lat: number) => {
    await db.query(
      `INSERT INTO camping_spots
         (osm_ref, name, country, region, slug, type, location, outline,
          last_seen_at)
       VALUES ($1, 'Сторож', 'HR', 'Istria', $2, 'paid',
               ST_SetSRID(ST_MakePoint($3, $4), 4326),
               ST_Multi(ST_GeomFromText($5, 4326)), $6)`,
      [ref, ref, lon, lat, BOX, STAMP],
    );
  };

  afterAll(async () => {
    await db.query(`DELETE FROM camping_spots WHERE last_seen_at = $1`, [
      STAMP,
    ]);
  });

  it('рахує лише рядки ЦЬОГО прогону і лише ті, що мають контур', async () => {
    await plant('guard-ok-1', 14.301, 45.001);
    await db.query(
      `INSERT INTO camping_spots
         (osm_ref, name, country, region, slug, type, location, last_seen_at)
       VALUES ('guard-nil-2', 'Без контуру', 'HR', 'Istria', 'guard-nil-2',
               'paid', ST_SetSRID(ST_MakePoint(14.9, 45), 4326), $1)`,
      [STAMP],
    );
    await expect(assertStoredOutlines(db, STAMP)).resolves.toBe(1);
    // Чужий прогін — не наша справа.
    await expect(
      assertStoredOutlines(db, new Date('2026-03-04T03:03:03.000Z')),
    ).resolves.toBe(0);
  });

  it('🔴 кидає на парі, яку CHECK міграції пропускає', async () => {
    // 0,00005 градуса за межею ділянки: ST_DWithin(…, 0.0001) ІСТИННИЙ,
    // тобто обмеження бази таку пару приймає мовчки. Саме цю щілину
    // сторож і закриває — інакше «точка на контурі» це обіцянка, яку
    // ніхто не перевіряє.
    await plant('guard-off-3', 14.30205, 45.001);
    await expect(assertStoredOutlines(db, STAMP)).rejects.toThrow(
      /1 rows carry an outline/,
    );
  });

  it('🔴 бере й рядки, що лягли під ЧУЖИМ кодом країни', async () => {
    // Прикордонна смуга екстракту: country тут не CLI-аргумент, а те,
    // що сказала геометрія. Фільтр по країні лишив би ці рядки поза
    // сторожем — а це найімовірніше місце для зібраної пари.
    await db.query(`DELETE FROM camping_spots WHERE osm_ref = 'guard-off-3'`);
    await db.query(
      `UPDATE camping_spots SET country = 'SI' WHERE osm_ref = 'guard-ok-1'`,
    );
    await expect(assertStoredOutlines(db, STAMP)).resolves.toBe(1);
  });
});
