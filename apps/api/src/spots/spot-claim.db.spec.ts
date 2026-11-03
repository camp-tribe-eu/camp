import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { statementFor } from '../migration-sql';

// CAMP-51: «підтверджений власник на кемпінг рівно один» і «маска не є
// адресою» мусить доводити PostgreSQL, а не читання міграції.
//
// 🔴 ЧОМУ SQL БЕРЕТЬСЯ З ФАЙЛУ МІГРАЦІЇ. Копія обмеження в тесті
// перевіряла б копію: прибери `CHECK` із міграції — і тест лишиться
// зеленим, стережучи текст, якого в базі вже немає.
//
// 🔴 І ЧОМУ ВЛАСНА СХЕМА, А НЕ `public`. Той самий урок, що записаний у
// `review-permission.db.spec.ts`: проба, яка прибирає за собою в спільній
// базі CI, забирає схему в наступних кроків.
//
// A MISSING DATABASE IS A FAILURE, NOT A SKIP.

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
const MIGRATION = join(
  __dirname,
  '..',
  'migrations',
  '1794300000000-SpotClaims.ts',
);
const PROBE = 'spot_claims_probe';

let db: Client;
const SPOT = '22222222-2222-2222-2222-222222222222';
const SPOT_B = '33333333-3333-3333-3333-333333333333';
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '44444444-4444-4444-4444-444444444444';

async function accepts(sql: string, params: unknown[] = []): Promise<boolean> {
  try {
    await db.query(sql, params);
    return true;
  } catch {
    return false;
  }
}

const insert = (masked: string, used: boolean, spot = SPOT, user = USER_A) =>
  db.query(
    `INSERT INTO spot_claims
       (camping_spot_id, user_id, code_hash, sent_to_masked, expires_at, used_at)
     VALUES ($1, $2, repeat('a', 64), $3, now() + interval '1 day', ${
       used ? 'now()' : 'NULL'
     })
     RETURNING id`,
    [spot, user, masked],
  );

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await db.query(`DROP SCHEMA IF EXISTS ${PROBE} CASCADE`);
  await db.query(`CREATE SCHEMA ${PROBE}`);
  // 🔴 `, public` ОБОВʼЯЗКОВЕ. Без нього `uuid_generate_v4()` не
  // знаходиться: розширення живе в `public`, а `search_path` із однієї
  // схеми ховає його. Усі сім випадків падали саме на цьому.
  await db.query(`SET search_path TO ${PROBE}, public`);

  // Батьківські таблиці — рівно стільки, скільки тримають зовнішні ключі.
  await db.query(`CREATE TABLE users ("id" uuid PRIMARY KEY)`);
  await db.query(`CREATE TABLE camping_spots ("id" uuid PRIMARY KEY)`);
  await db.query(`INSERT INTO users VALUES ($1), ($2)`, [USER_A, USER_B]);
  await db.query(`INSERT INTO camping_spots VALUES ($1), ($2)`, [SPOT, SPOT_B]);

  const text = readFileSync(MIGRATION, 'utf8');
  for (const needle of [
    'CREATE TABLE "spot_claims"',
    'IDX_spot_claims_one_owner',
  ]) {
    const sql = statementFor(text, needle).trim();
    // 🔴 ТЕКСТ ФАЙЛУ — ЦЕ НЕ ТЕ, ЩО ВИКОНАЄ TYPESCRIPT.
    //
    // Усередині шаблонного рядка `\\*` стає `\*` ще до бази. Тест читає
    // файл, тобто бачить ПЕРШЕ; прод виконує ДРУГЕ. Поки екранування
    // немає, обидва збігаються — і єдиний спосіб не дати цьому тихо
    // розʼїхатись — заборонити зворотний скісний у стережених
    // операторах. Це вже коштувало сімох червоних випадків на
    // правильних даних.
    expect(sql).not.toContain('\\');
    await db.query(sql);
  }
});

afterAll(async () => {
  if (!db) return;
  try {
    await db.query(`DROP SCHEMA IF EXISTS ${PROBE} CASCADE`);
    // 🔴 Доводимо, що `public` переживає пробу: саме цього й не зробила
    // перша редакція сусіднього тесту, і CI впав через добу.
    const { rows } = await db.query(
      `SELECT to_regclass('public.camping_spots') AS still_there`,
    );
    if (rows[0].still_there === null) {
      throw new Error('проба знесла public.camping_spots — це і є той дефект');
    }
  } finally {
    await db.end();
  }
});

describe('spot_claims: маска не є адресою, і база на цьому наполягає', () => {
  it('приймає маску', async () => {
    expect(await accepts(`SELECT 1`)).toBe(true);
    await expect(insert('i***@c***.de', false)).resolves.toBeTruthy();
  });

  it('🔴 відмовляє, коли замість маски поклали адресу', async () => {
    await expect(insert('info@camping.de', false)).rejects.toThrow(
      /spot_claims_masked_is_masked/,
    );
  });

  it('🔴 і коли маски немає зовсім', async () => {
    for (const bad of ['', 'nope', 'i***@c***', '***@***.de'])
      await expect(insert(bad, false)).rejects.toThrow(/masked_is_masked/);
  });
});

describe('spot_claims: підтверджений власник на кемпінг рівно один', () => {
  it('перший підтверджений проходить', async () => {
    await expect(
      insert('a***@b***.de', true, SPOT_B, USER_A),
    ).resolves.toBeTruthy();
  });

  it('🔴 другий підтверджений на той самий кемпінг — ні, навіть від іншого акаунта', async () => {
    await expect(insert('c***@d***.de', true, SPOT_B, USER_B)).rejects.toThrow(
      /IDX_spot_claims_one_owner/,
    );
  });

  it('а другий НЕпідтверджений — так: пробувати може не один', async () => {
    await expect(
      insert('e***@f***.de', false, SPOT_B, USER_B),
    ).resolves.toBeTruthy();
  });

  it('🔴 із двох, що забирають один код, виграє рівно один', async () => {
    // Саме заради цього `UPDATE … WHERE used_at IS NULL` стоїть у коді,
    // а не перевірка «а чи вже використано» перед ним: між SELECT і
    // UPDATE встигає другий запит.
    const { rows } = await insert('g***@h***.de', false, SPOT, USER_B);
    const id = rows[0].id;
    const take = `UPDATE spot_claims SET used_at = now()
                   WHERE id = $1 AND used_at IS NULL RETURNING id`;
    const [one, two] = await Promise.all([
      db.query(take, [id]),
      db.query(take, [id]),
    ]);
    expect(one.rowCount + two.rowCount).toBe(1);
  });
});
