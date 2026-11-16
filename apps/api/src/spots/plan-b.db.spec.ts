import { Client } from 'pg';
import {
  planB,
  PLAN_B_RANKING,
  PLAN_B_RADIUS_M,
  type Queryable,
} from './plan-b';

/**
 * CAMP-524 «План Б» — вибір альтернатив на справжньому PostGIS.
 *
 * 🔴 ФІКСТУРА ПОБУДОВАНА ТАК, ЩОБ КОЖЕН КРИТЕРІЙ І КОЖЕН ФІЛЬТР МАВ
 * ВЛАСНОГО СВІДКА: без нього результат був би іншим, а тест — червоним.
 *
 * Поточний кемпінг «here»: paid, 5 м висоти, море за 500 м (узбережжя).
 *
 *   character — «paid-near» (1 км, найближчий, вище за «here») стояв би
 *               першим без правила про характер місця;
 *   inland    — «camper-coastal» (3 км, вище, camper_stop) стояв би
 *               першим серед своїх без правила про узбережжя;
 *   higher    — «aire-lower» (6 км) стояв би перед «farm-higher» (9 км)
 *               без правила про висоту, бо ближче;
 *   nearer    — «z-paid-near» і «a-paid-far» мають однакові три ключі, а
 *               за алфавітом перший «a-»: без відстані вони поміняються;
 *   radius    — «aire-20km» (camper_stop, 20 км) зайшов би за радіуса 50;
 *               «edge-15100» ледь за межею, «edge-14900» ледь у межах;
 *   дублі     — «dup-same-name» (та сама назва, 60 м, інше джерело, БЕЗ
 *               запису в spot_links) лишається без правила `decide`;
 *               «linked-copy» (інша назва, 100 м, але є запис у
 *               spot_links) — без умови на spot_links; «hidden-secondary»
 *               належить ІНШОМУ кемпінгові, і її знімає `notSecondarySql`;
 *               «sec-primary» — коли сторінка сама secondary.
 */

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const q: Queryable = {
  query: async (sql: string, params?: unknown[]) =>
    (await db.query(sql, params)).rows,
};

const LON = -1;
const LAT = 46;
const M_LAT = 111_320;
const M_LON = M_LAT * Math.cos((LAT * Math.PI) / 180);

type Seed = {
  slug: string;
  name?: string | null;
  type?: string;
  country?: string;
  north?: number;
  east?: number;
  ele?: number;
  sea?: number;
  missing?: boolean;
  region?: string | null;
};

const ids: Record<string, string> = {};

async function put(s: Seed) {
  const ctx: Record<string, unknown> = {};
  if (s.ele !== undefined) ctx.elevation = s.ele;
  if (s.sea !== undefined) ctx.water = { kind: 'sea', m: s.sea };
  const r = await db.query(
    `INSERT INTO camping_spots (osm_ref, name, country, region, slug, type, context,
                                location, missing_since)
     VALUES ($1, $2, $3, $4, $1, $5, $6,
             ST_SetSRID(ST_MakePoint($7, $8), 4326), $9)
     RETURNING id`,
    [
      s.slug,
      s.name === undefined ? s.slug : s.name,
      s.country ?? 'FR',
      s.region === undefined ? 'Charente-Maritime' : s.region,
      s.type ?? 'paid',
      JSON.stringify(ctx),
      LON + (s.east ?? 0) / M_LON,
      LAT + (s.north ?? 0) / M_LAT,
      s.missing ? new Date() : null,
    ],
  );
  ids[s.slug] = r.rows[0].id;
}

const link = (primary: string, secondary: string) =>
  db.query(
    `INSERT INTO spot_links (primary_id, secondary_id) VALUES ($1, $2)`,
    [ids[primary], ids[secondary]],
  );

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `campplanb_${process.pid}_${Date.now()}`;
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
      context jsonb NOT NULL DEFAULT '{}',
      location geometry(Point, 4326) NOT NULL,
      last_seen_at timestamptz, missing_since timestamptz);
    CREATE INDEX ON camping_spots USING gist (location);
    CREATE TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());`);

  await put({ slug: 'here', name: 'Camping Les Pins', ele: 5, sea: 500 });

  // Мають потрапити — у цьому порядку.
  await put({ slug: 'farm-higher', type: 'free', north: 9_000, ele: 40 });
  await put({ slug: 'aire-lower', type: 'camper_stop', east: 6_000, ele: 3 });
  await put({
    slug: 'camper-coastal',
    type: 'camper_stop',
    north: -3_000,
    ele: 100,
    sea: 800,
  });
  await put({ slug: 'paid-near', name: 'Camping Zed', east: -1_000, ele: 80 });
  await put({
    slug: 'z-paid-near',
    name: 'Camping Zulu',
    east: -2_000,
    ele: 80,
  });
  await put({
    slug: 'a-paid-far',
    name: 'Camping Alpha',
    north: 12_000,
    ele: 80,
  });
  await put({ slug: 'no-height', name: 'Camping Nod', east: 13_000 });
  await put({
    slug: 'edge-14900',
    name: 'Camping Edge In',
    east: -14_900,
    ele: 60,
  });

  // Не мають потрапити.
  await put({
    slug: 'aire-20km',
    type: 'camper_stop',
    north: 20_000,
    ele: 400,
  });
  await put({
    slug: 'edge-15100',
    type: 'camper_stop',
    north: -15_100,
    ele: 400,
  });
  await put({
    slug: 'dup-same-name',
    name: 'Camping Les Pins',
    type: 'camper_stop',
    north: 60,
  });
  await put({
    slug: 'linked-copy',
    name: 'Aire de la Plage',
    type: 'camper_stop',
    north: 100,
  });
  await put({ slug: 'gone', type: 'camper_stop', north: 2_000, missing: true });
  await put({
    slug: 'cy-aire',
    type: 'camper_stop',
    north: 2_500,
    country: 'CY',
  });
  await put({
    slug: 'no-region',
    type: 'camper_stop',
    north: 2_600,
    region: null,
  });
  // Чужа пара: primary поза радіусом, secondary — у радіусі й схований.
  await put({ slug: 'other-primary', name: 'Camping Other', north: 30_000 });
  await put({
    slug: 'hidden-secondary',
    name: 'Aire Other',
    type: 'camper_stop',
    north: 4_000,
    ele: 50,
  });
  await link('here', 'linked-copy');
  await link('other-primary', 'hidden-secondary');

  // Сторінка, яка сама є secondary: її primary — за 100 м і не має з'явитися.
  await put({ slug: 'sec-here', name: 'Le Pavillon', east: 30_000, ele: 7 });
  await put({
    slug: 'sec-primary',
    name: 'Domaine du Lac',
    type: 'camper_stop',
    east: 30_100,
    ele: 9,
  });
  await put({
    slug: 'sec-neighbour',
    name: 'Aire Voisine',
    type: 'camper_stop',
    east: 34_000,
    ele: 9,
  });
  await link('sec-primary', 'sec-here');

  await put({ slug: 'lonely', name: 'Camping Seul', north: 500_000 });
});

afterAll(async () => {
  await db?.end();
  if (admin && dbName) {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

const FULL_ORDER = [
  'farm-higher',
  'aire-lower',
  'camper-coastal',
  'paid-near',
  'z-paid-near',
  'a-paid-far',
  'edge-14900',
  'no-height',
];

describe('План Б: вибір', () => {
  it('усі в радіусі, і порядок такий, як каже речення', async () => {
    const view = await planB(q, 'here', 20);
    expect(view).not.toBeNull();
    const items = view!.items;
    expect(items.map((i) => i.slug)).toEqual(FULL_ORDER);
    for (const i of items) {
      expect(i.metres).toBeLessThanOrEqual(PLAN_B_RADIUS_M);
      expect(i.metres).toBeGreaterThan(0);
    }
    expect(PLAN_B_RADIUS_M).toBe(15_000);
  });

  it('за замовчуванням — рівно три, перші з порядку', async () => {
    const view = await planB(q, 'here');
    expect(view!.items.map((i) => i.slug)).toEqual(FULL_ORDER.slice(0, 3));
  });

  it('висота: різниця є лише коли відомі обидві, інакше null', async () => {
    const view = await planB(q, 'here', 20);
    const by = Object.fromEntries(view!.items.map((i) => [i.slug, i]));
    expect(by['farm-higher'].elevationDelta).toBe(35);
    expect(by['aire-lower'].elevationDelta).toBe(-2);
    expect(by['no-height'].elevation).toBeNull();
    expect(by['no-height'].elevationDelta).toBeNull();
  });

  it('жодна з виключених не з’являється', async () => {
    const view = await planB(q, 'here', 50);
    const slugs = view!.items.map((i) => i.slug);
    for (const absent of [
      'here',
      'aire-20km',
      'edge-15100',
      'dup-same-name',
      'linked-copy',
      'gone',
      'cy-aire',
      'no-region',
      'hidden-secondary',
    ]) {
      expect(slugs).not.toContain(absent);
    }
  });

  it('сторінка, що сама є secondary, не пропонує свого primary', async () => {
    const view = await planB(q, 'sec-here', 20);
    expect(view!.items.map((i) => i.slug)).toEqual(['sec-neighbour']);
  });

  it('нічого запропонувати — null, а не порожній блок; невідомий slug — теж null', async () => {
    expect(await planB(q, 'lonely')).toBeNull();
    expect(await planB(q, 'no-such-campsite')).toBeNull();
    expect(await planB(q, 'cy-aire')).toBeNull();
  });

  it('речення про ранжування — рівно таке, і воно називає кожен крок', () => {
    expect(PLAN_B_RANKING).toBe(
      'Ranked by, in this order: camper stops, free and wild places before paid campsites; ' +
        'places not on the coast (sea within 2 km) before coastal ones; ' +
        'places higher than this campsite (where both heights are known) before the rest; ' +
        'then the nearest first. Nothing else moves a place up.',
    );
  });
});
