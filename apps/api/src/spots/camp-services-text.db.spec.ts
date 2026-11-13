import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import {
  CAMP_SERVICES_SECTIONS,
  CAMP_SERVICES_SLUG,
} from '../migrations/1796900000000-CampServicesText';
import {
  CAMP_SERVICES_ADDED_SECTIONS,
  NEW_INTRO_HEADING,
} from '../migrations/1797000100000-CampServicesGroups';
import {
  NEW_GROCERIES_BODY,
  NEW_GROCERIES_HEADING,
  NEW_INTRO_BODY,
  OLD_GROCERIES_HEADING,
  OLD_INTRO_BODY,
  OLD_SOURCE_HEADING,
  WITHIN_SECTION,
} from '../migrations/1797140000000-CampServicesOnSiteTruth';

// CAMP-503 — the block's words are in the CMS after the migrations, and
// are exactly the slots the page reads. Every migration runs, in order,
// against a database made for this process and dropped after.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
jest.setTimeout(180_000);

let admin: Client;
let db: Client;
let dbName: string;

const runnerOf = (c: Client) =>
  ({
    query: async (sql: string, p?: unknown[]) => (await c.query(sql, p)).rows,
  }) as unknown as QueryRunner;

beforeAll(async () => {
  if (!ADMIN_URL)
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL. This suite FAILS instead of skipping.',
    );
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp503_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  const dir = join(__dirname, '..', 'migrations');
  for (const file of readdirSync(dir)
    .filter((f) => /^\d{13}-.*\.ts$/.test(f))
    .sort()) {
    const mod = await import(join(dir, file));
    const M = Object.values(mod).find(
      (v): v is new () => { up(q: QueryRunner): Promise<void> } =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!M) throw new Error(`no migration class in ${file}`);
    await new M().up(runnerOf(db));
  }
});

afterAll(async () => {
  await db?.end();
  if (admin) {
    if (dbName)
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

test('the page exists, is published, and holds exactly the slots the page reads', async () => {
  const { rows } = await db.query(
    `SELECT s.slot, st.heading, st.body
       FROM pages p
       JOIN page_sections s ON s.page_id = p.id
       JOIN page_section_translations st ON st.section_id = s.id
      WHERE p.slug = $1 AND p.type = 'page' AND p.status = 'published' AND s.visible
      ORDER BY s.sort`,
    [CAMP_SERVICES_SLUG],
  );
  expect(rows.map((r) => r.slot).sort()).toEqual(
    [...CAMP_SERVICES_SECTIONS, ...CAMP_SERVICES_ADDED_SECTIONS, WITHIN_SECTION]
      .map((s) => s.slot)
      .sort(),
  );
  // 🔴 Review of #555: the words no longer promise "on site" by distance.
  // MUTATION (done): drop the intro UPDATE from the migration → the first two
  // go red; drop the groceries UPDATE → the heading one does.
  const intro = rows.find((r) => r.slot === 'intro').body as string;
  expect(intro).toBe(NEW_INTRO_BODY);
  expect(intro).not.toMatch(/On site:[^.]*\bor within\b/);
  expect(intro).toMatch(/said only where OpenStreetMap maps one/);
  expect(intro).toMatch(/does not tell whether it belongs to the campsite/);
  expect(intro).toContain('{{onsite}}');
  expect(intro).toContain('{{nearby}}');
  const within = rows.find((r) => r.slot === 'within');
  expect(within.body).toContain('{{onsite}}');
  expect(within.body).toMatch(/by distance/);
  expect(`${within.heading} ${within.body}`).not.toMatch(/on site/i);
  const groc = rows.find((r) => r.slot === 'kind-groceries');
  expect(groc.heading).toBe(NEW_GROCERIES_HEADING);
  expect(groc.body).toBe(NEW_GROCERIES_BODY);
  expect(groc.body).toMatch(/supermarkets only/);
  expect(rows.find((r) => r.slot === 'intro').heading).toBe(NEW_INTRO_HEADING);
  // 🔴 A template the page fills itself is a BODY: the web's loader throws on
  // an unknown {{key}} in a heading (that is how the block went missing).
  // MUTATION (done): drop the `source` UPDATE from the migration → red.
  for (const r of rows) expect(String(r.heading)).not.toContain('{{');
  expect(rows.find((r) => r.slot === 'source').body).toBe(
    'OpenStreetMap, imported {{date}}',
  );
  for (const r of rows) expect(String(r.heading).trim()).not.toBe('');
  expect(rows.find((r) => r.slot === 'kind-ev_charging').body).toMatch(
    /not a mains hookup/,
  );
});

test("re-running leaves an editor's words alone", async () => {
  await db.query(
    `UPDATE page_section_translations SET heading = 'Edited'
      WHERE section_id IN (SELECT s.id FROM page_sections s JOIN pages p ON p.id = s.page_id
                            WHERE p.slug = $1 AND s.slot = 'onsite')`,
    [CAMP_SERVICES_SLUG],
  );
  const { CampServicesText1796900000000: M } =
    await import('../migrations/1796900000000-CampServicesText');
  await new M().up(runnerOf(db));
  const { rows } = await db.query(
    `SELECT st.heading FROM page_sections s JOIN pages p ON p.id = s.page_id
       JOIN page_section_translations st ON st.section_id = s.id
      WHERE p.slug = $1 AND s.slot = 'onsite'`,
    [CAMP_SERVICES_SLUG],
  );
  expect(rows).toEqual([{ heading: 'Edited' }]);
});

test("🔴 CAMP-506: the top-up leaves an editor's intro heading and adds nothing twice", async () => {
  await db.query(
    `UPDATE page_section_translations SET heading = 'My intro'
      WHERE section_id IN (SELECT s.id FROM page_sections s JOIN pages p ON p.id = s.page_id
                            WHERE p.slug = $1 AND s.slot = 'intro')`,
    [CAMP_SERVICES_SLUG],
  );
  const { CampServicesGroups1797000100000: M } =
    await import('../migrations/1797000100000-CampServicesGroups');
  await new M().up(runnerOf(db));
  const { rows } = await db.query(
    `SELECT s.slot, st.heading FROM page_sections s JOIN pages p ON p.id = s.page_id
       JOIN page_section_translations st ON st.section_id = s.id
      WHERE p.slug = $1 AND s.slot IN ('intro', 'group-before')`,
    [CAMP_SERVICES_SLUG],
  );
  expect(rows.sort((a, b) => a.slot.localeCompare(b.slot))).toEqual([
    { slot: 'group-before', heading: 'Before you arrive' },
    { slot: 'intro', heading: 'My intro' },
  ]);
});

test('🔴 the on-site correction replaces only the seeded words, adds nothing twice, and `down` undoes only its own', async () => {
  const { CampServicesOnSiteTruth1797140000000: M } =
    await import('../migrations/1797140000000-CampServicesOnSiteTruth');
  const read = async () =>
    (
      await db.query(
        `SELECT s.slot, st.heading, st.body FROM page_sections s JOIN pages p ON p.id = s.page_id
           JOIN page_section_translations st ON st.section_id = s.id
          WHERE p.slug = $1 AND s.slot IN ('intro', 'within', 'kind-groceries', 'source')
          ORDER BY s.slot`,
        [CAMP_SERVICES_SLUG],
      )
    ).rows as Array<{ slot: string; heading: string; body: string | null }>;
  const set = (slot: string, col: 'heading' | 'body', v: string) =>
    db.query(
      `UPDATE page_section_translations SET ${col} = $3
        WHERE section_id IN (SELECT s.id FROM page_sections s JOIN pages p ON p.id = s.page_id
                              WHERE p.slug = $1 AND s.slot = $2)`,
      [CAMP_SERVICES_SLUG, slot, v],
    );

  // down: back to what the earlier migrations seeded, and the slot is gone
  await new M().down(runnerOf(db));
  let rows = await read();
  expect(rows.map((r) => r.slot)).toEqual([
    'intro',
    'kind-groceries',
    'source',
  ]);
  expect(rows[0].body).toBe(OLD_INTRO_BODY);
  expect(rows[1]).toMatchObject({ heading: OLD_GROCERIES_HEADING, body: null });
  expect(rows[2]).toMatchObject({ heading: OLD_SOURCE_HEADING, body: null });

  // an editor rewrote the intro and the groceries heading: `up` leaves both
  await set('intro', 'body', 'My own intro, {{onsite}} and {{nearby}}.');
  await set('kind-groceries', 'heading', 'Shops');
  await new M().up(runnerOf(db));
  await new M().up(runnerOf(db)); // twice: still one `within`
  rows = await read();
  expect(rows.map((r) => r.slot)).toEqual([
    'intro',
    'kind-groceries',
    'source',
    'within',
  ]);
  expect(rows[0].body).toBe('My own intro, {{onsite}} and {{nearby}}.');
  // 🔴 no note of ours under a heading that is not ours
  expect(rows[1]).toMatchObject({ heading: 'Shops', body: null });
  expect(rows[2]).toMatchObject({
    heading: 'Source',
    body: OLD_SOURCE_HEADING,
  });
  expect(rows[3]).toMatchObject({ ...WITHIN_SECTION });
});
