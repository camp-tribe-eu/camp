import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

// CAMP-427: цифру рейтингу не можна покласти в рядок без дати письмового
// дозволу — і це мусить доводити PostgreSQL, а не читання міграції.
//
// 🔴 ЧОМУ ТЕСТ БЕРЕ SQL ІЗ САМОЇ МІГРАЦІЇ, А НЕ МАЄ ВЛАСНОЇ КОПІЇ.
// Копія обмеження в тесті перевіряла б копію: видали `CHECK` із міграції —
// і тест лишиться зеленим, стережучи текст, якого в базі вже немає. Тому
// звідси читається ФАЙЛ МІГРАЦІЇ, з нього вирізаються його ж `CREATE TYPE`
// і `CREATE TABLE`, і виконується те, що справді поїде на прод.
//
// 🔴 Що саме стережеться. Умови Trustpilot (прочитані в першоджерелі
// 02.11.2026) забороняють і збір, і показ TrustScore без їхнього прямого
// дозволу; Google дозволяє показ лише через платний Places API. Рішення
// власника того ж дня: назва джерела й посилання — так, цифри — ні.
// Правило, що живе лише в коді сторінки, обходиться одним INSERT.
//
// A MISSING DATABASE IS A FAILURE, NOT A SKIP (див. account.db.spec.ts).

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

const MIGRATION = join(
  __dirname,
  '..',
  'migrations',
  '1794000000000-RentalProviders.ts',
);

/**
 * Вирізає з міграції один її оператор за назвою обʼєкта.
 *
 * Оператори лежать усередині `queryRunner.query(\`…\`)`, тому береться вміст
 * зворотних лапок, що містять потрібне імʼя. Нуль або два збіги — помилка:
 * тест мусить знати, що саме він виконує.
 */
export function statementFor(text: string, needle: string): string {
  const blocks = [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  const found = blocks.filter((b) => b.includes(needle));
  if (found.length !== 1) {
    throw new Error(
      `у міграції знайдено ${found.length} операторів із «${needle}», а треба рівно один`,
    );
  }
  return found[0];
}

let db: Client;
let providerId: string;

/** Чи прийняла база рядок. Помилка обмеження — це «ні», а не аварія. */
async function accepts(sql: string, params: unknown[] = []): Promise<boolean> {
  try {
    await db.query(sql, params);
    return true;
  } catch {
    return false;
  }
}

const PROFILES = 'rental_provider_review_profiles';
const insert = `INSERT INTO ${PROFILES}
  (provider_id, source, profile_url, permission_confirmed_on, rating, review_count)
  VALUES ($1, $2, $3, $4, $5, $6)`;

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  const text = readFileSync(MIGRATION, 'utf8');
  db = new Client({ connectionString: URL });
  await db.connect();

  await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  // Тип статусу належить іншій міграції; тут він лише передумова.
  await db.query(`
    DO $$ BEGIN
      CREATE TYPE "public"."content_status_enum" AS ENUM ('draft','published');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  // Назва типу сама по собі трапляється тричі: у CREATE TYPE, у колонці
  // таблиці й у DROP TYPE з `down()`. Тому шукаємо повний оператор.
  for (const needle of [
    'CREATE TYPE "public"."rental_service_availability_enum"',
    'CREATE TYPE "public"."rental_review_source_enum"',
  ]) {
    const create = statementFor(text, needle).trim();
    await db.query(
      `DO $$ BEGIN ${create}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
  }
  await db.query(`DROP TABLE IF EXISTS ${PROFILES}, rental_providers CASCADE`);
  await db.query(statementFor(text, 'CREATE TABLE "rental_providers"'));
  await db.query(statementFor(text, `CREATE TABLE "${PROFILES}"`));

  const r = await db.query(
    `INSERT INTO rental_providers (slug, name, home_country, website, source_url)
     VALUES ('t-provider', 'T', 'BE', 'https://example.invalid', 'https://example.invalid/about')
     RETURNING id`,
  );
  providerId = (r.rows[0] as { id: string }).id;
});

afterAll(async () => {
  await db?.query(`DROP TABLE IF EXISTS ${PROFILES}, rental_providers CASCADE`);
  await db?.end();
});

describe('🔴 цифра рейтингу не існує без дати письмового дозволу', () => {
  it('рейтинг без дозволу база НЕ приймає', async () => {
    expect(
      await accepts(insert, [
        providerId,
        'trustpilot',
        'https://example.invalid/a',
        null,
        '4.6',
        null,
      ]),
    ).toBe(false);
  });

  it('кількість відгуків без дозволу база НЕ приймає', async () => {
    expect(
      await accepts(insert, [
        providerId,
        'google',
        'https://example.invalid/b',
        null,
        null,
        120,
      ]),
    ).toBe(false);
  });

  it('саме посилання без цифр приймається — це те, що нам дозволено сьогодні', async () => {
    expect(
      await accepts(insert, [
        providerId,
        'trustpilot',
        'https://example.invalid/c',
        null,
        null,
        null,
      ]),
    ).toBe(true);
  });

  it('🔴 з датою дозволу ті самі цифри проходять: замок відмикається датою, а не правкою схеми', async () => {
    expect(
      await accepts(insert, [
        providerId,
        'google',
        'https://example.invalid/d',
        '2026-12-01',
        '4.6',
        120,
      ]),
    ).toBe(true);
  });
});

describe('решта обмежень профілю', () => {
  beforeEach(async () => {
    await db.query(`DELETE FROM ${PROFILES} WHERE source = 'google'`);
  });

  it('рейтинг поза шкалою 0–5 не приймається навіть із дозволом', async () => {
    expect(
      await accepts(insert, [
        providerId,
        'google',
        'https://example.invalid/e',
        '2026-12-01',
        '9.9',
        null,
      ]),
    ).toBe(false);
  });

  it('посилання не на https не приймається', async () => {
    expect(
      await accepts(insert, [
        providerId,
        'google',
        'http://example.invalid/f',
        null,
        null,
        null,
      ]),
    ).toBe(false);
  });
});

describe('🔴 сам вирізальник теж перевіряється', () => {
  it('оператора немає — помилка з назвою, а не тиха порожнеча', () => {
    expect(() =>
      statementFor('`CREATE TABLE "a"`', 'CREATE TABLE "b"'),
    ).toThrow(/знайдено 0 операторів/);
  });

  it('двозначність — теж помилка: тест мусить знати, що саме виконує', () => {
    expect(() => statementFor('`x needle`\n`y needle`', 'needle')).toThrow(
      /знайдено 2 операторів/,
    );
  });
});
