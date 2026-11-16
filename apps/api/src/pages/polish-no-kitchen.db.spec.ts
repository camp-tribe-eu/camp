import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';

// Поліш — міграція, що ховає старий h1-блок головної й забирає кухню з підпису
// топ-кемпінгів та з /contact, проти СПРАВЖНЬОЇ бази.
//
// Усе, що вона обіцяє, — про рядки в `page_section_translations`: що
// пішло, що лишилось, і що не зачеплено, коли власник уже правив текст.
// Мок цього не побачив би. Той самий стенд, що й `consent.db.spec.ts`:
// власна база `camp463_<pid>_<час>`, усі міграції, прибирається за собою.
//
// 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПРОВАЛ, А НЕ ПРОПУСК. Потрібен CAMP_TEST_DATABASE_URL
// (локально) або CI_DATABASE_URL.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

const THIS = '1797920000000-PolishNoKitchen.ts';

type Runner = {
  up(q: QueryRunner): Promise<void>;
  down(q: QueryRunner): Promise<void>;
};

let admin: Client;
let db: Client;
let dbName: string;
let mine: Runner;

const runnerOf = (client: Client) =>
  ({
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  }) as unknown as QueryRunner;

async function loadMigrations(): Promise<
  Array<{ file: string; m: Runner; cls: any }>
> {
  const dir = join(__dirname, '..', 'migrations');
  const out: Array<{ file: string; m: Runner; cls: any }> = [];
  for (const file of readdirSync(dir)
    .filter((f) => /^\d{13}-.*\.ts$/.test(f))
    .sort()) {
    const mod = await import(join(dir, file));
    const Migration = Object.values(mod).find(
      (v): v is new () => Runner =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!Migration) throw new Error(`no migration class in ${file}`);
    out.push({ file, m: new Migration(), cls: Migration });
  }
  return out;
}

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camppolish_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();

  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  // Усі міграції, КРІМ тієї, що перевіряється: база стоїть у стані «до».
  for (const { file, m } of await loadMigrations()) {
    if (file === THIS) {
      mine = m;
      continue;
    }
    await m.up(runnerOf(db));
  }
  if (!mine) throw new Error(`${THIS} not found`);
});

afterAll(async () => {
  await db?.end();
  if (admin) {
    if (dbName)
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

const q1 = async (sql: string, p: unknown[] = []) =>
  (await db.query(sql, p)).rows;

const heroVisible = async () =>
  (
    await q1(
      `SELECT s.visible FROM page_sections s JOIN pages p ON p.id = s.page_id
        WHERE p.slug = 'home' AND p.type = 'page' AND s.type = 'hero'`,
    )
  ).map((r) => r.visible as boolean);

const notableBody = async () =>
  (
    await q1(
      `SELECT t.body FROM page_sections s JOIN pages p ON p.id = s.page_id
         JOIN page_section_translations t ON t.section_id = s.id
        WHERE p.slug = 'home' AND s.slot = 'notable'`,
    )
  )[0]?.body as string;

const contactCard = async () =>
  (
    await q1(
      `SELECT t.body FROM page_sections s JOIN pages p ON p.id = s.page_id
         JOIN page_section_translations t ON t.section_id = s.id
        WHERE p.slug = 'contact' AND s.type = 'card'`,
    )
  )[0]?.body as string;

const rowCounts = async () =>
  (
    await q1(
      `SELECT (SELECT count(*) FROM page_sections)::int AS s,
              (SELECT count(*) FROM page_section_translations)::int AS t`,
    )
  )[0];

const UPLOADS_OLD =
  'Uploads through the site do not exist yet, so email is the whole of it.';
const UPLOADS_NEW = 'Email is all it takes — there is nothing else to fill in.';
const NOTABLE_OLD = 'we have not been to any of them';

test('anchor: before the migration the home page really has the old block and the kitchen', async () => {
  // Без цього «нічого не знайдено» нижче нічого б не доводило.
  expect(await heroVisible()).toEqual([true]);
  expect(await notableBody()).toContain(NOTABLE_OLD);
  // Сторінку /contact могли правити після розкладу: ставимо старе речення,
  // як воно стоїть на такій сторінці.
  await db.query(
    `UPDATE page_section_translations t
        SET body = t.body || ' ' || $1::text
       FROM page_sections s, pages p
      WHERE t.section_id = s.id AND s.page_id = p.id
        AND p.slug = 'contact' AND s.type = 'card'`,
    [UPLOADS_OLD],
  );
  expect(await contactCard()).toContain(UPLOADS_OLD);
});

test('up() hides the hero, drops the kitchen, keeps the ranking explanation, deletes no rows', async () => {
  const before = await rowCounts();
  await mine.up(runnerOf(db));
  expect(await heroVisible()).toEqual([false]);
  const notable = await notableBody();
  expect(notable).not.toContain(NOTABLE_OLD);
  expect(notable).not.toMatch(/no reviews/i);
  expect(notable).toContain('Ranked by how much has actually been recorded');
  const card = await contactCard();
  expect(card).not.toContain(UPLOADS_OLD);
  expect(card).toContain(UPLOADS_NEW);
  expect(await rowCounts()).toEqual(before);
});

test('running it again changes nothing', async () => {
  const once = [await notableBody(), await contactCard(), await rowCounts()];
  await mine.up(runnerOf(db));
  expect([await notableBody(), await contactCard(), await rowCounts()]).toEqual(
    once,
  );
  expect(await heroVisible()).toEqual([false]);
});

test('down() puts the old state back, and twice is the same', async () => {
  await mine.down(runnerOf(db));
  expect(await heroVisible()).toEqual([true]);
  expect(await notableBody()).toContain(NOTABLE_OLD);
  expect(await contactCard()).toContain(UPLOADS_OLD);
  const once = await notableBody();
  await mine.down(runnerOf(db));
  expect(await notableBody()).toBe(once);
});
