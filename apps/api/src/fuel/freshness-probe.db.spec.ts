import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

// The freshness check reads `fuel_station_prices` through ONE query, and the
// claim that query makes — "the table is as old as its oldest source" — is
// about what PostgreSQL returns, not about what the string looks like. So the
// query that ships is taken from the script that ships (not copied here) and
// run against a real table.
//
// A temp table named like the real one shadows it for this session only.
// A MISSING DATABASE IS A FAILURE, NOT A SKIP (see account.db.spec.ts).

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
const SCRIPT = pathToFileURL(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'scripts',
    'ci',
    'check-data-freshness.mjs',
  ),
).href;

type Source = {
  table: string;
  column: string;
  groupBy?: string;
  name: string;
  acceptedGroups?: Record<string, { until: string; why: string }>;
};
type Mod = {
  probeSql: (s: Source, now?: number) => string;
  DB_SOURCES: readonly Source[];
};

/**
 * 🔴 ЧАС ПЕРЕДАЄТЬСЯ, А НЕ БЕРЕТЬСЯ З ГОДИННИКА. `probeSql` тепер викидає
 * із запиту групи, чиє прийняття ще живе, і без явного `now` цей файл
 * перевіряв би СЬОГОДНІШНЮ поведінку: до 01.12.2026 одну, після — іншу,
 * без жодної правки коду. Тест, який міняє предмет разом із календарем,
 * нічого не стереже; обидва стани перевіряються тут поіменно.
 */
const WHILE_ACCEPTED = Date.parse('2026-11-02T00:00:00Z');
const AFTER_ACCEPTED = Date.parse('2026-12-02T00:00:00Z');

let db: Client;
let mod: Mod;
let fuel: Source;

const probe = async (now: number = AFTER_ACCEPTED) => {
  const r = await db.query(mod.probeSql(fuel, now));
  const row = r.rows[0] as Record<string, string | null>;
  const [rows, stamp, oldestGroup] = Object.values(row);
  return { rows: Number(rows), stamp, oldestGroup };
};

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  mod = (await import(SCRIPT)) as Mod;
  fuel = mod.DB_SOURCES.find(
    (s) => s.table === 'fuel_station_prices',
  ) as Source;
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query(
    `CREATE TEMP TABLE fuel_station_prices (source text NOT NULL, fetched_at timestamptz NOT NULL)`,
  );
});
afterAll(async () => {
  await db?.end();
});

describe('the fuel freshness probe', () => {
  it('reads an empty table as no rows and no stamp, so it is "never run"', async () => {
    expect(await probe()).toEqual({ rows: 0, stamp: null, oldestGroup: null });
  });

  it('is the age of the OLDEST source, not of the newest row', async () => {
    await db.query(
      `INSERT INTO fuel_station_prices VALUES
         ('es-minetur',       '2026-10-28 06:59:27+00'),
         ('fr-data-economie', '2026-10-28 06:59:27+00'),
         ('it-mimit',         '2026-10-13 09:59:39+00')`,
    );
    // 🔴 І воно НАЗИВАЄ винного. Без цього поля лист сторожа писав
    // «вся таблиця протухла», коли протухла одна країна з трьох.
    expect(await probe()).toEqual({
      rows: 3,
      stamp: '2026-10-13T09:59:39Z',
      oldestGroup: 'it-mimit',
    });
  });

  // 🔴 ПРИЙНЯТТЯ ГРУПИ — ПРОТИ СПРАВЖНЬОЇ БАЗИ, а не лише проти рядка SQL.
  // `check-data-freshness --self-test` перевіряє, що в запиті є `NOT IN`.
  // Що саме PostgreSQL із цим зробить — інше питання, і відповідає на
  // нього лише PostgreSQL. 02.11.2026 `it-mimit` приймається до 01.12:
  // Італія виходить із рахунку, а Іспанія з Францією лишаються під
  // повним бюджетом.
  it('🔴 while a group is accepted it leaves the age, and the row count stays whole', async () => {
    expect(await probe(WHILE_ACCEPTED)).toEqual({
      rows: 3,
      stamp: '2026-10-28T06:59:27Z',
      oldestGroup: 'es-minetur',
    });
    // Той самий рядок бази, інша дата — і прийняття вже не діє.
    expect(await probe(AFTER_ACCEPTED)).toEqual({
      rows: 3,
      stamp: '2026-10-13T09:59:39Z',
      oldestGroup: 'it-mimit',
    });
  });

  it('turns fresh again only when the stale source is read', async () => {
    await db.query(
      `UPDATE fuel_station_prices SET fetched_at = '2026-10-28 07:10:00+00' WHERE source = 'it-mimit'`,
    );
    // Тепер найстаріші дві — Іспанія і Франція, з ОДНАКОВОЮ міткою.
    // Ім'я мусить бути сталим, а не випадковим з двох: інакше лист
    // змінював би винного без жодної зміни в даних.
    expect(await probe()).toEqual({
      rows: 3,
      stamp: '2026-10-28T06:59:27Z',
      oldestGroup: 'es-minetur',
    });
  });
});
