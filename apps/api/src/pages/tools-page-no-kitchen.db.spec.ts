import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';

// CAMP-463 — міграція, що забирає кухню з /tools, проти СПРАВЖНЬОЇ бази.
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

const THIS = '1796100000000-ToolsPageNoKitchen.ts';

type Runner = {
  up(q: QueryRunner): Promise<void>;
  down(q: QueryRunner): Promise<void>;
};

let admin: Client;
let db: Client;
let dbName: string;
let mine: Runner;
let OLD_CLOSING: string;
let OLD_INTRO_TAIL: string;

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

/** Тексти сторінки /tools у тому вигляді, в якому їх бачить читач. */
async function toolsBodies(): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT st.body
       FROM page_sections s
       JOIN pages p ON p.id = s.page_id
       JOIN page_section_translations st ON st.section_id = s.id
      WHERE p.slug = 'tools' AND st.body IS NOT NULL
      ORDER BY s.sort`,
  );
  return rows.map((r) => r.body as string);
}

const sectionCount = async () =>
  Number(
    (
      await db.query(
        `SELECT count(*) AS n FROM page_sections s JOIN pages p ON p.id = s.page_id WHERE p.slug = 'tools'`,
      )
    ).rows[0].n,
  );

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp463_${process.pid}_${Date.now()}`;
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
  for (const { file, m, cls } of await loadMigrations()) {
    if (file === THIS) {
      mine = m;
      OLD_CLOSING = cls.OLD_CLOSING;
      OLD_INTRO_TAIL = cls.OLD_INTRO_TAIL;
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

const KITCHEN = [
  /served as plain HTML/i,
  /without JavaScript/i,
  /partners we have not integrated/i,
  /planned alongside/i,
];

test('anchor: before the migration the page really carries the kitchen', async () => {
  // 🔴 Без цього «нічого не знайдено» нижче нічого б не доводило: може,
  // сіялка вже інша, і нема що забирати.
  const text = (await toolsBodies()).join('\n');
  for (const re of KITCHEN) expect(text).toMatch(re);
  expect(await sectionCount()).toBe(4);
});

test('the migration removes the kitchen and keeps the rest of the page', async () => {
  const before = await toolsBodies();
  await mine.up(runnerOf(db));
  const after = await toolsBodies();
  const text = after.join('\n');
  for (const re of KITCHEN) expect(text).not.toMatch(re);

  // Лишилось усе, про що читач прийшов: вступ (зі значенням, що
  // розгортається), картки, підпис до переліку країн.
  expect(await sectionCount()).toBe(3);
  expect(text).toContain('Both are free and need no account.');
  expect(text).toContain('{{fuel.bulletin}}');
  expect(text).toContain(', with a table of all 27 countries.');
  expect(text).toContain('One page for each of the {{count}} member states');
  // …і нічого більше не зникло: різниця рівно в одному завершальному блоці.
  expect(before.length - after.length).toBe(1);
  expect(before.filter((b) => !after.includes(b))).toEqual(
    expect.arrayContaining([OLD_CLOSING]),
  );
});

test('running it again changes nothing', async () => {
  const once = await toolsBodies();
  await mine.up(runnerOf(db));
  expect(await toolsBodies()).toEqual(once);
  expect(await sectionCount()).toBe(3);
});

test('down() puts back exactly what up() took, once', async () => {
  await mine.down(runnerOf(db));
  const text = (await toolsBodies()).join('\n');
  expect(text).toContain(OLD_CLOSING);
  expect(text).toContain(OLD_INTRO_TAIL);
  expect(await sectionCount()).toBe(4);
  // повторний down не дублює блок
  await mine.down(runnerOf(db));
  expect(await sectionCount()).toBe(4);
});

test('🔴 an owner edit made in the CMS is NOT overwritten', async () => {
  // Власник уже переписав завершальний абзац і вступ сам.
  await db.query(
    `UPDATE page_section_translations st
        SET body = 'Our own words about the tools.'
       FROM page_sections s, pages p
      WHERE st.section_id = s.id AND s.page_id = p.id
        AND p.slug = 'tools' AND st.body = $1`,
    [OLD_CLOSING],
  );
  await db.query(
    `UPDATE page_section_translations st
        SET body = 'Free and without an account. Reads without JavaScript, as written by the owner.'
       FROM page_sections s, pages p
      WHERE st.section_id = s.id AND s.page_id = p.id
        AND p.slug = 'tools' AND st.body LIKE '%Both are free%'`,
  );
  const before = await toolsBodies();
  await mine.up(runnerOf(db));
  expect(await toolsBodies()).toEqual(before);
  expect(await sectionCount()).toBe(4);
});
