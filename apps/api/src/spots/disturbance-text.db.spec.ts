import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import {
  DISTURBANCE_SECTIONS,
  DISTURBANCE_SLUG,
} from '../migrations/1797100000000-Disturbance';

// CAMP-502 — the disturbance block's words are in the CMS after the migrations,
// exactly the slots the page reads, and the hazard table EXISTS (empty) so the
// detail query cannot fail on a database nobody has imported into yet. Every migration runs, in order,
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
  dbName = `camp502_${process.pid}_${Date.now()}`;
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

test('the page holds exactly the seeded slots, and the caveat says we did not measure', async () => {
  const { rows } = await db.query(
    `SELECT s.slot, st.heading, st.body
       FROM pages p
       JOIN page_sections s ON s.page_id = p.id
       JOIN page_section_translations st ON st.section_id = s.id
      WHERE p.slug = $1 AND p.type = 'page' AND p.status = 'published' AND s.visible
      ORDER BY s.sort`,
    [DISTURBANCE_SLUG],
  );
  expect(rows.map((r) => r.slot)).toEqual(
    DISTURBANCE_SECTIONS.map((s) => s.slot),
  );
  const caveat = rows.find((r) => r.slot === 'caveat');
  expect(caveat.body).toMatch(/not measured noise or air/);
  expect(caveat.body).toMatch(/OpenStreetMap/);
});

test('🔴 the hazard table exists and is empty: no import yet means no block, not an error', async () => {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM osm_ctx_hazard',
  );
  expect(rows[0].n).toBe(0);
});
