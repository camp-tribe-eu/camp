import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';

// CAMP-463 (коло 2) — міграція двох текстів у CMS проти СПРАВЖНЬОЇ бази:
// крок «Plan the drive» на головній і примітка про походження допису.
// Тих самих рядків мок не побачив би. Той самий стенд, що й
// `tools-page-no-kitchen.db.spec.ts`: власна база `camp463_<pid>_<час>`,
// усі міграції, прибирається за собою.
//
// 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПРОВАЛ, А НЕ ПРОПУСК. Потрібен CAMP_TEST_DATABASE_URL
// (локально) або CI_DATABASE_URL.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

const THIS = '1797450000000-KitchenTwoTexts.ts';

type Runner = {
  up(q: QueryRunner): Promise<void>;
  down(q: QueryRunner): Promise<void>;
};

let admin: Client;
let db: Client;
let dbName: string;
let mine: Runner;
let OLD_HOME_STEP: string;
let NEW_HOME_STEP: string;
let OLD_POST_NOTE: string;
let NEW_POST_NOTE: string;

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

/** Тексти кроків головної так, як їх бачить читач. */
async function homeSteps(): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT st.items
       FROM page_sections s
       JOIN pages p ON p.id = s.page_id
       JOIN page_section_translations st ON st.section_id = s.id
      WHERE p.slug = 'home' AND p.type = 'page' AND s.type = 'steps'`,
  );
  return rows.flatMap((r) =>
    (r.items as Array<{ text: string }>).map((i) => i.text),
  );
}

/** Примітки про походження всіх дописів. */
async function postNotes(): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT st.body
       FROM page_sections s
       JOIN pages p ON p.id = s.page_id
       JOIN page_section_translations st ON st.section_id = s.id
      WHERE p.type = 'post' AND s.variant = 'provenance'
      ORDER BY p.slug`,
  );
  return rows.map((r) => r.body as string);
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
      OLD_HOME_STEP = cls.OLD_HOME_STEP;
      NEW_HOME_STEP = cls.NEW_HOME_STEP;
      OLD_POST_NOTE = cls.OLD_POST_NOTE;
      NEW_POST_NOTE = cls.NEW_POST_NOTE;
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

test('anchor: before the migration the seeded texts really are the old ones', async () => {
  // 🔴 Без цього «нічого не знайдено» нижче нічого б не доводило: може,
  // сіялка вже інша, і нема що міняти.
  expect(await homeSteps()).toContain(OLD_HOME_STEP);
  const notes = await postNotes();
  expect(notes.length).toBe(5);
  for (const n of notes) expect(n).toBe(OLD_POST_NOTE);
});

test('the migration replaces both texts and nothing else', async () => {
  const stepsBefore = await homeSteps();
  await mine.up(runnerOf(db));
  const steps = await homeSteps();
  expect(steps).not.toContain(OLD_HOME_STEP);
  expect(steps).toContain(NEW_HOME_STEP);
  expect(steps.join(' ')).not.toMatch(/pretends|being built/i);
  // решта кроків і їх кількість — ті самі
  expect(steps.length).toBe(stepsBefore.length);
  expect(steps.filter((t) => t !== NEW_HOME_STEP)).toEqual(
    stepsBefore.filter((t) => t !== OLD_HOME_STEP),
  );

  const notes = await postNotes();
  expect(notes.length).toBe(5);
  for (const n of notes) expect(n).toBe(NEW_POST_NOTE);
  // 🔴 Примітка НЕ зникла й не порожня: check-post-provenance її вимагає.
  expect(NEW_POST_NOTE.length).toBeGreaterThan(40);
  expect(NEW_POST_NOTE).toMatch(/AI/);
  expect(notes.join(' ')).not.toMatch(/composed/i);
});

test('running it again changes nothing', async () => {
  const s = await homeSteps();
  const n = await postNotes();
  await mine.up(runnerOf(db));
  expect(await homeSteps()).toEqual(s);
  expect(await postNotes()).toEqual(n);
});

test('down() puts the old texts back', async () => {
  await mine.down(runnerOf(db));
  expect(await homeSteps()).toContain(OLD_HOME_STEP);
  for (const n of await postNotes()) expect(n).toBe(OLD_POST_NOTE);
});

test('🔴 an owner edit made in the CMS is NOT overwritten', async () => {
  // Власник переписав один крок і одну примітку сам.
  await db.query(
    `UPDATE page_section_translations st
        SET items = replace(st.items::text, $1::text, 'Our own words.')::jsonb
       FROM page_sections s, pages p
      WHERE st.section_id = s.id AND s.page_id = p.id
        AND p.slug = 'home' AND p.type = 'page'`,
    [OLD_HOME_STEP],
  );
  await db.query(
    `UPDATE page_section_translations st
        SET body = 'Written by the owner.'
       FROM page_sections s, pages p
      WHERE st.section_id = s.id AND s.page_id = p.id
        AND p.type = 'post' AND s.variant = 'provenance'
        AND p.slug = 'camper-over-3-5-tonnes'`,
  );
  const steps = await homeSteps();
  const notes = await postNotes();
  await mine.up(runnerOf(db));
  expect(await homeSteps()).toEqual(steps);
  expect(await homeSteps()).toContain('Our own words.');
  const after = await postNotes();
  expect(after).toContain('Written by the owner.');
  // …а решта приміток, не правлених власником, змінилась.
  expect(after.filter((n) => n === NEW_POST_NOTE).length).toBe(
    notes.filter((n) => n === OLD_POST_NOTE).length,
  );
  expect(after.filter((n) => n === OLD_POST_NOTE).length).toBe(0);
});
