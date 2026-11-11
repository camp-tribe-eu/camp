import { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { SpotsService } from './spots.service';

/**
 * «Campsites nearby» впорядковані ТИМ САМИМ числом, яке надруковане
 * поруч із назвою — CAMP-453.
 *
 * 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Запит сортував по «<->» на geometry — це
 * ПЛАНАРНА відстань у ГРАДУСАХ, — а показував
 * «round(ST_Distance(::geography))», тобто справжні метри. Порядок і
 * підпис рахували різне, і сторінка друкувала зростаючий список, у
 * якому числа не зростали.
 *
 * Власник побачив це у ревʼю 05.11.2026 і назвав прямо: «969 m стоїть
 * перед 900 m». Заміряно на проді 11.11 для
 * «aire-aiguillon-sur-mer-le-port»: 100 → 873 → 955 → 957 → 969 → 900.
 *
 * 🔴 ФІКСТУРА ПОБУДОВАНА ТАК, ЩОБ ДВІ МЕТРИКИ ДАВАЛИ ПРОТИЛЕЖНИЙ
 * ПОРЯДОК. Інакше тест зеленів би й на зламаному запиті.
 *
 * Центр на 60° пн. ш. — найпівнічніша широта, де в нас є кемпінги
 * (північ Швеції й Фінляндії), і там спотворення найбільше: градус
 * довготи коротший за градус широти рівно вдвічі, бо cos(60°) = 0.5.
 *
 *   сусід «north» — 969 м НА ПІВНІЧ  → 0.008704° (менше в градусах)
 *   сусід «east»  — 900 м НА СХІД    → 0.016169° (більше в градусах)
 *
 * За метрами першим має йти «east» (900 < 969). За градусами — «north».
 * Тобто повернення старого «ORDER BY location <-> me» робить цей тест
 * червоним, а не просто іншим.
 *
 * 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПАДІННЯ, А НЕ ПРОПУСК, за тією самою
 * конвенцією, що й `hub-stats.db.spec.ts`: пропущений тест читається
 * як пройдений.
 */

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const asDataSource = (): DataSource =>
  ({
    query: async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params)).rows,
  }) as unknown as DataSource;

/** Метри на градус широти — число, з якого рахується фікстура. */
const M_PER_DEG_LAT = 111_320;
/** На 60° пн. ш. градус довготи рівно вдвічі коротший. */
const M_PER_DEG_LON_AT_60 = M_PER_DEG_LAT * 0.5;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `campnear_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
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
      last_seen_at timestamptz, missing_since timestamptz);
    CREATE TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());`);

  const put = async (slug: string, lon: number, lat: number) => {
    await db.query(
      `INSERT INTO camping_spots (osm_ref, name, country, region, slug, type, location)
       VALUES ($1, $1, 'SE', 'Norrbotten', $1, 'paid',
               ST_SetSRID(ST_MakePoint($2, $3), 4326))`,
      [slug, lon, lat],
    );
  };

  const LON = 20;
  const LAT = 60;
  await put('centre', LON, LAT);
  // 969 м на північ: менша відстань у ГРАДУСАХ, більша в МЕТРАХ.
  await put('north-969', LON, LAT + 969 / M_PER_DEG_LAT);
  // 900 м на схід: більша відстань у ГРАДУСАХ, менша в МЕТРАХ.
  await put('east-900', LON + 900 / M_PER_DEG_LON_AT_60, LAT);
});

afterAll(async () => {
  await db?.end();
  if (admin && dbName) {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

describe('nearby: порядок рахує те саме число, що й підпис', () => {
  it('ближчий У МЕТРАХ іде першим, навіть коли він далі в градусах', async () => {
    const svc = new SpotsService(asDataSource());
    const rows = await svc.nearby('centre', 6);

    const order = rows.map((r) => r.slug);
    const metres = rows.map((r) => Number(r.metres));

    expect(order).toEqual(['east-900', 'north-969']);

    // 🔴 І головне твердження, заради якого все це: надруковані числа
    // зростають. Саме цього власник не побачив на сторінці.
    expect(metres).toEqual([...metres].sort((a, b) => a - b));

    // Фікстура справді ставить пастку: у градусах порядок зворотний.
    const planar = await db.query(
      `SELECT s.slug FROM camping_spots s, camping_spots me
        WHERE me.slug = 'centre' AND s.slug <> 'centre'
        ORDER BY s.location <-> me.location`,
    );
    expect(planar.rows.map((r: { slug: string }) => r.slug)).toEqual([
      'north-969',
      'east-900',
    ]);
  });
});
