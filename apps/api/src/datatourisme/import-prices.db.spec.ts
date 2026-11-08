import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { SpotTariffFetchedAt1794600000000 } from '../migrations/1794600000000-SpotTariffFetchedAt';
import { insertBatch, type Row } from './import-prices';

// CAMP-400, пункт 2 — `spot_tariffs.fetched_at` проти СПРАВЖНЬОЇ бази.
//
// 🔴 ПИТАННЯ — ПРО ТЕ, ЩО ЛИШАЄТЬСЯ В РЯДКУ після повторного імпорту.
// Сторож свіжості читає `max(fetched_at)`; імпорт — `ON CONFLICT DO
// UPDATE`. Заміряно на проді 08.11.2026: `created_at` при цьому не
// рухається (дві дати на 13 104 рядки), тож тест SQL-тексту тут нічого
// не вартий — він не відрізнить колонку, яку UPDATE перелічив, від тієї,
// яку забув. Цей спек пише рядок двічі справжнім `insertBatch` і читає
// обидві дати назад.
//
// 🔴 МІГРАЦІЯ ВИКОНУЄТЬСЯ СПРАВЖНЯ, і ДО неї в таблиці вже лежить рядок:
// засів `fetched_at` має бути `created_at`, а не мить міграції, інакше
// старі рядки проду читалися б свіжими, яких ніхто не звіряв.
//
// 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПРОВАЛ, А НЕ ПРОПУСК. Потрібен CAMP_TEST_DATABASE_URL
// (локально) або CI_DATABASE_URL (CI): будь-яка PostGIS-база, у якій можна
// CREATE DATABASE. Спек створює власну `camp400t_*` і прибирає її.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

const THIS_MIGRATION = '1794600000000-SpotTariffFetchedAt.ts';

let admin: Client;
let db: Client;
let dbName: string;
let spotId: string;

type Runner = { up(q: QueryRunner): Promise<void> };

const runnerOf = (client: Client) =>
  ({
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  }) as unknown as QueryRunner;

/** Усі міграції репозиторію за порядком, крім названих. */
async function migrateAllExcept(client: Client, skip: string[]) {
  const dir = join(__dirname, '..', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await client.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  for (const file of files) {
    if (skip.includes(file)) continue;
    const mod = await import(join(dir, file));
    const Migration = Object.values(mod).find(
      (v): v is new () => Runner =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!Migration) throw new Error(`no migration class in ${file}`);
    await new Migration().up(runnerOf(client));
  }
}

const SOURCE = 'datatourisme';
const REF = 'https://data.datatourisme.fr/spec/test-tariff-1';
const LEGACY_CREATED = '2026-09-28T15:31:49.000Z';

const row = (ref: string, min: string): Row => [
  spotId,
  SOURCE,
  ref,
  'emplacement',
  null,
  null,
  min,
  null,
  'EUR',
  '2026-04-01',
  '2026-10-31',
  null,
  null,
  '2026-10-24',
];

async function dates(ref: string) {
  const r = await db.query<{
    created_at: Date;
    fetched_at: Date;
    min_price: string;
  }>(
    `SELECT created_at, fetched_at, min_price FROM spot_tariffs
      WHERE spot_id = $1 AND source_id = $2 AND source_ref = $3`,
    [spotId, SOURCE, ref],
  );
  expect(r.rowCount).toBe(1);
  return r.rows[0];
}

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp400t_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();

  await migrateAllExcept(db, [THIS_MIGRATION]);

  const spot = await db.query<{ id: string }>(
    `INSERT INTO camping_spots (name, country, slug, type, location)
     VALUES ('Camping de test', 'FR', 'camping-de-test-400', 'paid',
             ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326))
     RETURNING id`,
  );
  spotId = spot.rows[0].id;

  // 🔴 Рядок, що існував ДО міграції, з датою створення проду 28.09.
  await db.query(
    `INSERT INTO spot_tariffs
       (spot_id, source_id, source_ref, min_price, currency,
        valid_from, valid_until, source_updated_at, created_at)
     VALUES ($1, $2, $3, 13.50, 'EUR', '2026-04-01', '2026-10-31', '2026-09-20', $4)`,
    [spotId, SOURCE, REF, LEGACY_CREATED],
  );

  await new SpotTariffFetchedAt1794600000000().up(runnerOf(db));
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

describe('spot_tariffs.fetched_at (CAMP-400)', () => {
  it('🔴 міграція засіває fetched_at датою створення, а не миттю міграції', async () => {
    const d = await dates(REF);
    expect(d.created_at.toISOString()).toBe(LEGACY_CREATED);
    expect(d.fetched_at.toISOString()).toBe(LEGACY_CREATED);
  });

  it('🔴 повторний імпорт того самого тарифу рухає fetched_at і НЕ рухає created_at', async () => {
    const before = await dates(REF);
    const started = new Date();
    await insertBatch(db, [row(REF, '14.00')]);
    const after = await dates(REF);

    // Той самий рядок: ключ (spot, source, ref) зійшовся, ціну переказано.
    expect(after.min_price).toBe('14.00');
    expect(after.created_at.toISOString()).toBe(LEGACY_CREATED);
    expect(after.fetched_at.getTime()).toBeGreaterThanOrEqual(
      started.getTime() - 1000,
    );
    expect(after.fetched_at.getTime()).toBeGreaterThan(
      before.fetched_at.getTime(),
    );
  });

  it('новий тариф отримує fetched_at у мить запису', async () => {
    const ref = `${REF}-new`;
    const started = new Date();
    await insertBatch(db, [row(ref, '9.00')]);
    const d = await dates(ref);
    expect(d.fetched_at.getTime()).toBeGreaterThanOrEqual(
      started.getTime() - 1000,
    );
    expect(d.created_at.getTime()).toBeGreaterThanOrEqual(
      started.getTime() - 1000,
    );
  });

  it('🔴 max(fetched_at) по таблиці — те, що читає сторож — дорівнює миті останнього імпорту, а не першого', async () => {
    const r = await db.query<{ created: Date; fetched: Date }>(
      'SELECT max(created_at) AS created, max(fetched_at) AS fetched FROM spot_tariffs',
    );
    expect(r.rows[0].fetched.getTime()).toBeGreaterThanOrEqual(
      r.rows[0].created.getTime(),
    );
    // І давній рядок, який фід щойно переказав, уже не тягне максимум назад:
    const legacy = await dates(REF);
    expect(legacy.fetched_at.getTime()).toBeGreaterThan(
      Date.parse(LEGACY_CREATED),
    );
  });
});
