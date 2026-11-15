// CAMP-455: що індекс пошуку НЕ віддає — на справжніх рядках.
//
// 🔴 КОЖЕН ОЧІКУВАНИЙ РЯДОК РАХОВАНО РУКАМИ З ФІКСТУРИ нижче, а не
// виведено повторним запуском того, що тестується. Фікстура збудована
// так, щоб кожна гілка правила коштувала рівно один рядок і щоб кожен
// виняток мав свій рядок-пастку:
//
//   • голий код БЕЗ сліду кемпінгу — геть («P1», «E01», «B», «Nr 49», «72»);
//   • голий код ІЗ слідом (сайт у `contact`, сайт у колонці, пошта,
//     опис, зірки) — лишається: «OP29», «LF13», «Oz» справжні кемпінги,
//     і перша редакція правила викинула б їх за самою формою назви;
//   • мийка без слова про ночівлю — геть; мийка зі словом «sosta camper»
//     — лишається, бо запис сам себе називає стоянкою;
//   • безіменний — лишається (рішення CAMP-67);
//   • грецька назва — лишається: правило не сміє залежати від локалі.
//
// 🔴 ВІДСУТНЯ БАЗА — ПАДІННЯ, А НЕ ПРОПУСК, як в усіх `.db.spec.ts`.
// Потрібен CAMP_TEST_DATABASE_URL (локально) або CI_DATABASE_URL (CI).
// Файл створює власну `campsearch_*` базу з реальних міграцій і
// видаляє її; у названій базі він нічого не читає й не пише.

import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { SpotsService } from './spots.service';

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

let admin: Client;
let db: DataSource;
let dbName: string;

interface Row {
  slug: string;
  name: string | null;
  type?: string;
  website?: string | null;
  description?: string | null;
  stars?: number | null;
  contact?: Record<string, unknown>;
  region?: string | null;
  country?: string;
}

// ── Лишаються (13) ────────────────────────────────────────────────────
const KEEP: Row[] = [
  { slug: 'real-camp', name: 'Camping Bari Sud' },
  { slug: 'unnamed', name: null },
  { slug: 'greek', name: 'Κάμπινγκ Ωκεανός' },
  // Голий код, але за ним є кемпінг:
  { slug: 'op29', name: 'OP29', contact: { website: 'https://www.op29.nl/' } },
  { slug: 'lf13', name: 'LF13', contact: { email: 'camping@lf13.nl' } },
  { slug: 'oz', name: 'Oz', website: 'https://ozvamaveche.ro/' },
  {
    slug: 'p7-described',
    name: 'P7',
    description: 'A small family site by the lake.',
  },
  { slug: 'x9-starred', name: 'X9', stars: 3 },
  // Мийка, що сама себе називає стоянкою:
  {
    slug: 'daniele',
    name: 'Daniele Autolavagaggio a mano e sosta camper',
    type: 'rv_park',
  },
  // «wash» як частина іншого слова — не мийка:
  { slug: 'washington', name: 'Washingtonia', type: 'paid' },
  // Мийка, але з «camping-car» у назві — це стоянка:
  {
    slug: 'aire-lavage',
    name: 'Aire de service et lavage camping-car',
    type: 'camper_stop',
  },
  // Трилітерна назва: не код.
  { slug: 'koa', name: 'KOA' },
  // Назва з цифрою, але зі словом: не голий код.
  { slug: 'camping-2', name: 'Camping 2' },
];

// ── Йдуть (9) ─────────────────────────────────────────────────────────
const DROP: Row[] = [
  { slug: 'p1', name: 'P1', type: 'rv_park' },
  { slug: 'e01', name: 'E01', type: 'rv_park' },
  { slug: 'z211', name: 'Z211', type: 'rv_park' },
  { slug: 'b', name: 'B' },
  { slug: 'nr49', name: 'Nr 49' },
  { slug: 'num72', name: '72', type: 'rv_park' },
  { slug: 'hobby', name: 'Hobby Park Wash', type: 'rv_park' },
  { slug: 'cavalcante', name: 'Autolavaggio Cavalcante', type: 'rv_park' },
  { slug: 'carwash-de', name: 'Waschstraße Mitte', type: 'rv_park' },
];

// ── Не в індексі з інших причин, і це НЕ мусить змінитись (3) ─────────
const ELSEWHERE: Row[] = [
  { slug: 'no-region', name: 'Camping Without Region', region: null },
  { slug: 'cyprus', name: 'Camping Cyprus', country: 'CY' },
  { slug: 'gone', name: 'Camping Gone' },
];

const insert = async (r: Row) => {
  await db.query(
    `INSERT INTO camping_spots
       (name, country, region, slug, type, location, osm_ref, website,
        description, description_lang, stars, contact, missing_since)
     VALUES ($1, $2, $3, $4, $5::camping_spots_type_enum,
             ST_SetSRID(ST_MakePoint(16.87, 41.12), 4326), $6, $7,
             $8, $9, $10, $11::jsonb, $12)`,
    [
      r.name,
      r.country ?? 'IT',
      r.region === undefined ? 'Bari' : r.region,
      r.slug,
      r.type ?? 'paid',
      `t-${r.slug}`,
      r.website ?? null,
      r.description ?? null,
      r.description ? 'en' : null,
      r.stars ?? null,
      JSON.stringify(r.contact ?? {}),
      r.slug === 'gone' ? new Date('2026-01-01') : null,
    ],
  );
};

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `campsearch_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;

  // Справжня схема з справжніх міграцій, а не рукотворна таблиця, що
  // могла б розійтись із тією, яку читає запит у проді.
  db = new DataSource({
    ...AppDataSource.options,
    url: url.toString(),
  } as never);
  await db.initialize();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.runMigrations();

  for (const r of [...KEEP, ...DROP, ...ELSEWHERE]) await insert(r);
});

afterAll(async () => {
  await db?.destroy();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

const served = async () => {
  const docs = await new SpotsService(db).searchDocuments();
  return docs;
};

describe('searchDocuments: що з бази не йде в пошук', () => {
  it('лишаються рівно 13 рядків — і саме ті, що названі в KEEP', async () => {
    const docs = await served();
    expect(docs.map((d) => d.slug).sort()).toEqual(
      KEEP.map((r) => r.slug).sort(),
    );
    expect(docs).toHaveLength(13);
  });

  it('жоден із 9 «голих кодів» і «мийок» не дійшов до відповіді', async () => {
    const slugs = new Set((await served()).map((d) => d.slug));
    // Перелік тих, що ЗАЛИШИЛИСЬ, — порожній, і саме він друкується в
    // повідомленні про падіння.
    const stillThere = DROP.filter((r) => slugs.has(r.slug)).map((r) => r.name);
    expect(stillThere).toEqual([]);
  });

  it('голий код зі слідом кемпінгу лишається: сайт, пошта, опис, зірки', async () => {
    const names = (await served()).map((d) => d.name);
    const lost = ['OP29', 'LF13', 'Oz', 'P7', 'X9'].filter(
      (n) => !names.includes(n),
    );
    expect(lost).toEqual([]);
  });

  it('мийка, що називає себе стоянкою, лишається; мийка без цього — ні', async () => {
    const names = (await served()).map((d) => d.name);
    expect(names).toContain('Daniele Autolavagaggio a mano e sosta camper');
    expect(names).toContain('Aire de service et lavage camping-car');
    expect(names).not.toContain('Hobby Park Wash');
    expect(names).not.toContain('Autolavaggio Cavalcante');
  });

  it('безіменний лишається, грецька назва лишається', async () => {
    const docs = await served();
    expect(docs.find((d) => d.slug === 'unnamed')?.name).toBeNull();
    expect(docs.map((d) => d.name)).toContain('Κάμπινγκ Ωκεανός');
  });

  it('те, що виходило з пошуку й раніше, виходить і зараз', async () => {
    const slugs = (await served()).map((d) => d.slug);
    for (const r of ELSEWHERE) {
      expect(slugs).not.toContain(r.slug);
    }
  });
});
