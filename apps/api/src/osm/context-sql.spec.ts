import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  assertCountryTagsReady,
  CONTEXT_SQL,
  contextParams,
  NEAR_SQL,
  Queryable,
  UNION_PREDICATE,
  UNION_PREDICATE_COUNT,
  withoutUnionFilter,
} from './context-sql';
import { EU_MEMBER_STATES } from './eu';

// CAMP-296 — «найближче місто / магазин / станція» шукається лише в ЄС-27.
//
// 🔴 ЦІ ТЕСТИ ЇДУТЬ ПРОТИ СПРАВЖНЬОЇ БАЗИ, і це не примха. Попередній
// спосіб перевіряти SQL у цьому репозиторії — `expect(sql).toContain(...)`
// (route-poi-sql.spec.ts) — стверджує форму тексту, а не те, що запит
// відповідає. Тут Крылово ставиться ближче за польське місто, запит
// виконується, і перевіряється, ЯКЕ місто повернулось.
//
// 🔴 ФІКСТУРА ПРОХОДИТЬ ТІЄЮ САМОЮ ДОРОГОЮ, ЩО Й ПРОДАКШН. Шари створюються
// без колонки `country` (так їх робить ogr2ogr), полігони країн кладуться в
// osm_country_area, а колонку проставляє справжній tag-ctx-country.sql — той
// самий файл, що запускає завантажувач. Тест, який сам виставив би `country`
// в INSERT-і, перевіряв би запит проти власної уяви про колонку.
//
// 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПАДІННЯ, А НЕ ПРОПУСК. check-skips.mjs існує саме
// тому, що тест, який відмовився бігти, виглядає як тест, що пройшов.
// Потрібна змінна CAMP_TEST_DATABASE_URL (локально) або CI_DATABASE_URL (в
// CI її вже виставлено): будь-яка база з PostGIS, до якої є право
// CREATE DATABASE. Тест створює власну базу `camp296_*` і викидає її;
// у вказаній базі нічого не читає й не пише.
//
// 🔴 МУТАЦІЇ. Кожен тест нижче червонів на мутації, названій над ним, і на
// ній ОДНІЙ — умова на країну прибиралась із РІВНО ОДНОГО join-а.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

const SCRIPTS = join(__dirname, '../../../../scripts/osm-pipeline');
const TAG_SQL = readFileSync(join(SCRIPTS, 'tag-ctx-country.sql'), 'utf8');
const BUILD_SQL = readFileSync(join(SCRIPTS, 'build-country-area.sql'), 'utf8');

let db: Client;
let admin: Client;
let dbName: string;

// Планарна геометрія навмисно проста. Кордон іде по довготі 21.5:
//   PL    18.0–21.5 × 53–57        RU    21.5–25.0 × 53–55  (не член Союзу)
//   LT    21.5–25.0 × 55–57        (член Союзу, сусід з того боку)
// Те, що лежить за 25.0 чи південніше 53, не в жодному полігоні.
const BOXES: [string, number, number, number, number][] = [
  ['pl', 18.0, 53.0, 21.5, 57.0],
  ['ru', 21.5, 53.0, 25.0, 55.0],
  ['lt', 21.5, 55.0, 25.0, 57.0],
  // CAMP-323: Лапландія. Окремо від польської ділянки вище: ті кемпінги й
  // об'єкти лежать за тисячу км звідси й одне одному не заважають.
  ['fi', 20.0, 60.0, 32.0, 71.0],
];

async function insertFeature(
  kind: 'town' | 'shop' | 'station' | 'water',
  name: string,
  lon: number,
  lat: number,
): Promise<void> {
  const pt = `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;
  if (kind === 'town') {
    await db.query(
      `INSERT INTO osm_ctx_place (id, name, place, geom)
       VALUES ($1, $1, 'town', ST_Multi(${pt}))`,
      [name],
    );
  } else if (kind === 'shop') {
    await db.query(
      `INSERT INTO osm_ctx_poi (id, name, shop, geom) VALUES ($1, $1, 'supermarket', ${pt})`,
      [name],
    );
  } else if (kind === 'station') {
    await db.query(
      `INSERT INTO osm_ctx_poi (id, name, railway, geom) VALUES ($1, $1, 'station', ${pt})`,
      [name],
    );
  } else {
    await db.query(
      `INSERT INTO osm_ctx_water (id, name, water, geom) VALUES ($1, $1, 'lake', ${pt})`,
      [name],
    );
  }
}

async function insertSpot(slug: string, lon: number, lat: number) {
  await db.query(
    `INSERT INTO camping_spots (slug, location, country)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), 'PL')`,
    [slug, lon, lat],
  );
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
  dbName = `camp296_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');

  // Колонки — ті, що читає CONTEXT_SQL, з тими самими типами, що в базі:
  // osm_ctx_* робить ogr2ogr (БЕЗ `country`), camping_spots — міграція TypeORM.
  await db.query(`
    CREATE TABLE camping_spots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug varchar,
      location geometry(Point, 4326), context jsonb,
      missing_since timestamptz, country varchar);
    CREATE TABLE osm_ctx_place (
      ogc_fid serial PRIMARY KEY, id varchar, name varchar, place varchar,
      geom geometry(MultiPoint, 4326));
    CREATE TABLE osm_ctx_poi (
      ogc_fid serial PRIMARY KEY, id varchar, name varchar, railway varchar,
      shop varchar, geom geometry(Geometry, 4326));
    CREATE TABLE osm_ctx_water (
      ogc_fid serial PRIMARY KEY, id varchar, name varchar, "natural" varchar,
      water varchar, waterway varchar, geom geometry(Geometry, 4326));
    CREATE TABLE osm_country_area (iso text NOT NULL, geom geometry(Polygon, 4326) NOT NULL);
    CREATE INDEX ON osm_ctx_place USING GIST (geom);
    CREATE INDEX ON osm_ctx_poi USING GIST (geom);
    CREATE INDEX ON osm_ctx_water USING GIST (geom);
    CREATE INDEX ON osm_country_area USING GIST (geom);`);
  for (const [iso, x0, y0, x1, y1] of BOXES) {
    await db.query(
      `INSERT INTO osm_country_area (iso, geom)
       VALUES ($1, ST_MakeEnvelope($2, $3, $4, $5, 4326))`,
      [iso, x0, y0, x1, y1],
    );
  }

  // ── «виключає»: найближчі кандидати лежать за межами Союзу ───────────
  // Кемпінг стоїть на (21.45, 52.9), південніше всіх полігонів. Найближчий —
  // об'єкт ПОЗА будь-яким полігоном (≈22 км), далі — в полігоні `ru`, який у
  // таблиці є, але не в списку Союзу (≈25 км), і лише тоді польський (≈105 км).
  await insertSpot('excludes', 21.45, 52.9);
  // ── «лишає»: найближчий — у ІНШІЙ державі-члені (≈7 км), польський далі ─
  await insertSpot('keeps-neighbour', 21.4, 56.0);

  for (const kind of ['town', 'shop', 'station', 'water'] as const) {
    await insertFeature(kind, `${kind}-nowhere`, 21.45, 52.7);
    await insertFeature(kind, `${kind}-russia`, 21.6, 53.1);
    await insertFeature(kind, `${kind}-poland`, 20.0, 53.2);
    await insertFeature(kind, `${kind}-lithuania`, 21.6, 56.0);
    await insertFeature(kind, `${kind}-poland-far`, 20.0, 56.0);
  }

  // ── CAMP-323: «найближчий» за метрами, а не за градусами ──────────────
  // 1. Той самий кемпінг, що показала картка: spot-n4159830721, 65,9° N, і
  //    два об'єкти на справжніх координатах. Kontiomäki ближче за градусами
  //    (2,22° проти 2,45°), але на 49 км далі за метрами; Kemijärvi — навпаки.
  await insertSpot('spot-n4159830721', 29.7025375, 65.8886597);
  for (const kind of ['town', 'shop', 'station'] as const) {
    await insertFeature(kind, `${kind}-kontiomaki`, 28.1143371, 64.3382641);
    await insertFeature(kind, `${kind}-kemijarvi`, 27.4038461, 66.7241808);
  }

  // 2. Справжній найближчий стоїть на 201-му місці в планарному порядку.
  //    Кемпінг на 69° N; найближчий — на 0,5° довготи на схід (≈19,9 км),
  //    а 200 хибних — на 0,20–0,49° широти на північ (≈22–54 км): за
  //    градусами всі вони ближчі за нього. Жодне фіксоване `LIMIT N` із
  //    розумним N його не знайде; запит має знайти.
  await insertSpot('deep', 27.0, 69.0);
  for (const kind of ['town', 'shop', 'station'] as const) {
    await insertFeature(kind, `${kind}-deep-true`, 27.5, 69.0);
    for (let i = 0; i < 200; i++) {
      await insertFeature(
        kind,
        `${kind}-deep-decoy-${i}`,
        27.0 + i * 1e-5,
        69.2 + (0.29 * i) / 200,
      );
    }
  }

  // 3. Нічия: два об'єкти в ОДНІЙ точці — так виглядає та сама будівля, що
  //    прийшла з OSM двічі, шляхом `w…` і полігоном `a…` (CAMP-253). Відстані
  //    рівні до біта; переможець мусить бути детермінованим — найменший
  //    ogc_fid. UPDATE переносить перший у кінець купи: без явного тай-брейку
  //    перший за порядком читання був би другий.
  await insertSpot('twin', 31.0, 70.3);
  for (const kind of ['town', 'shop', 'station'] as const) {
    await insertFeature(kind, `${kind}-twin-way`, 31.0, 70.4);
    await insertFeature(kind, `${kind}-twin-area`, 31.0, 70.4);
  }
  await db.query(
    `UPDATE osm_ctx_place SET name = name WHERE name = 'town-twin-way';
     UPDATE osm_ctx_poi SET name = name WHERE name IN ('shop-twin-way', 'station-twin-way')`,
  );

  // 4. Хмара випадкових об'єктів і кемпінгів на 60,5–70,5° N — проти оракула
  //    повним перебором. Засіяна, тож фікстура однакова щоразу.
  await db.query(`SELECT setseed(0.323)`);
  await db.query(`
    INSERT INTO camping_spots (slug, location, country)
    SELECT 'cloud-' || i,
           ST_SetSRID(ST_MakePoint(20.5 + random() * 5, 60.5 + random() * 10), 4326), 'FI'
      FROM generate_series(1, 40) i;
    INSERT INTO osm_ctx_place (id, name, place, geom)
    SELECT 'town-cloud-' || i, 'town-cloud-' || i, 'town',
           ST_Multi(ST_SetSRID(ST_MakePoint(20.5 + random() * 5, 60.5 + random() * 10), 4326))
      FROM generate_series(1, 150) i;
    INSERT INTO osm_ctx_poi (id, name, shop, geom)
    SELECT 'shop-cloud-' || i, 'shop-cloud-' || i, 'supermarket',
           ST_SetSRID(ST_MakePoint(20.5 + random() * 5, 60.5 + random() * 10), 4326)
      FROM generate_series(1, 150) i;
    INSERT INTO osm_ctx_poi (id, name, railway, geom)
    SELECT 'station-cloud-' || i, 'station-cloud-' || i, 'station',
           ST_SetSRID(ST_MakePoint(20.5 + random() * 5, 60.5 + random() * 10), 4326)
      FROM generate_series(1, 150) i;`);

  // Країну проставляє справжній файл завантажувача.
  await db.query(TAG_SQL);

  // 🔴 У проді `osm_ctx_water` колонки `country` НЕ має, і не мусить. Тут
  // вона є — лише щоб мутація «додати фільтр до води» ЗАПУСКАЛАСЬ і червоніла
  // по суті (поверне озеро в Польщі), а не від помилки «колонки немає».
  await db.query(`
    ALTER TABLE osm_ctx_water ADD COLUMN country text;
    UPDATE osm_ctx_water x SET country = COALESCE(
      (SELECT min(c.iso) FROM osm_country_area c
        WHERE c.geom && ST_PointOnSurface(x.geom)
          AND ST_Covers(c.geom, ST_PointOnSurface(x.geom))), '');`);
  await db.query('ANALYZE');
}, 60_000);

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

interface Near {
  town_name: string | null;
  shop_name: string | null;
  rail_name: string | null;
  water_name: string | null;
}

async function near(sql: string, params: unknown[], slug: string) {
  const { rows } = await db.query<Near & { slug: string }>(sql, params);
  const row = rows.find((r) => r.slug === slug);
  // 🔴 assert цілі ДО висновку: мутація, що не влучила, схожа на вижилу, а
  // порожній результат — на «не знайшов зайвого».
  expect(row).toBeDefined();
  return row as Near;
}

// 🔴 МУТАЦІЯ на кожен рядок окремо: прибрати `AND ${UNION_PREDICATE}` із
//   join-а `t` (місто), `p` (магазин) або `r` (станція) у context-sql.ts.
//   Кожна червонить свій вид і лише його: рядок результату один, але
//   перевіряється лише його власне поле.
describe.each([
  ['town', 'town_name'],
  ['shop', 'shop_name'],
  ['station', 'rail_name'],
] as const)('CONTEXT_SQL: %s', (kind, field) => {
  // 🔴 Найближчі два кандидати — поза Союзом: один у полігоні країни, якої
  // немає у списку (Крылово), другий взагалі в жодному полігоні. Без умови
  // запит бере ближчого, і сторінка каже відстань до нього.
  it('не бере найближчого, що лежить поза ЄС-27, і бере найближчого всередині', async () => {
    const row = await near(
      CONTEXT_SQL,
      contextParams(null) as unknown[],
      'excludes',
    );
    expect(row[field as keyof Near]).toBe(`${kind}-poland`);
  });

  // 🔴 Умова — «Союз», а не «країна кемпінгу»: литовське місто за 7 км — це
  // справжнє найближче місто, і фільтр не сміє його викинути.
  it('лишає найближчого в ІНШІЙ державі-члені', async () => {
    const row = await near(
      CONTEXT_SQL,
      contextParams(null) as unknown[],
      'keeps-neighbour',
    );
    expect(row[field as keyof Near]).toBe(`${kind}-lithuania`);
  });

  // Той самий запит без умови — інструмент «до» — бере хибного. Без цього
  // тесту два попередні могли б бути зеленими на фікстурі, де фільтр нічого
  // не вирішує.
  it('те саме без фільтра дає найближчого поза Союзом (фікстура справді його дає)', async () => {
    const row = await near(withoutUnionFilter(), [null], 'excludes');
    expect(row[field as keyof Near]).toBe(`${kind}-nowhere`);
  });
});

describe('CONTEXT_SQL: вода', () => {
  // 🔴 РІШЕННЯ, НЕ НЕДОГЛЯД. Озеро за кордоном — найближче озеро, і фільтр
  // його не відсуває. MUTATION: додати UNION_PREDICATE до join-а води — і
  // «найближче озеро за 22 км за кордоном» стане «за 105 км у Польщі»:
  // правду замінено хибою заради консистентності, якої читачеві не треба.
  it('лишає найближчу воду там, де вона є, хоч би й за кордоном', async () => {
    const row = await near(
      CONTEXT_SQL,
      contextParams(null) as unknown[],
      'excludes',
    );
    expect(row.water_name).toBe('water-nowhere');
  });
});

// CAMP-323 — «найближчий» це за метрами на сфероїді, а не за градусами.
//
// 🔴 МУТАЦІЇ (кожна з копії, на одну зміну, з assert, що влучило рівно раз;
// червоніє назване — окрім двох, що вужчають прямокутник: ті червонять ще й
// тести CAMP-296 на польській ділянці, бо 54° N теж чутливі до його ширини):
//   · порядок кроку 2 — `ORDER BY s.location <-> x.geom` замість
//     `ORDER BY m, x.ogc_fid` (повернути планарне): «spot-n4159830721», «201-ше
//     місце», оракул — і лише вони;
//   · `/ cos(…)` прибрано з `dx`: «201-ше місце», оракул, «spot-n4159830721»;
//   · `M_PER_DEGREE_LAT` удвічі більше (прямокутник удвічі менший): те саме;
//   · замість прямокутника — `LIMIT 20` кандидатів за `<->` (рецепт «N
//     кандидатів»): «201-ше місце» на всіх трьох видах;
//   · відстань у градусах замість метрів — у кроці 1 (верхня межа) чи в кроці
//     2: «spot-n4159830721», «201-ше місце», оракул;
//   · прибрати `, x.ogc_fid` із порядку: нічия, і лише вона;
//   · умова на країну лише в кроці 1 або лише в кроці 2: «не бере найближчого,
//     що лежить поза ЄС-27» на всіх трьох видах.
//
// 🔴 ЩО МУТАЦІЯМИ НЕ ПІНИТЬСЯ, І ЦЕ НАЗВАНО:
//   · `+ y.dy` у `dx`. Без нього прямокутник на 0,5% вужчий за запас, який
//     дає `M_PER_DEGREE_LAT`, тож різниці немає ні тут, ні на живих даних (0 із
//     57 082 × 3). Рядок залишено, бо математика потребує його для великих
//     радіусів, але тест його не тримає;
//   · сам прямокутник. Без нього крок 2 перебирає весь шар: запит лишається
//     ПРАВИЛЬНИМ, але повільним. Швидкість міряється заміром у PR, тестом її не
//     втримати — таблиця тут має тисячу рядків, а не двісті п'ятдесят тисяч.
describe.each([
  ['town', 'town_name'],
  ['shop', 'shop_name'],
  ['station', 'rail_name'],
] as const)(
  'CONTEXT_SQL: %s — за метрами, а не за градусами',
  (kind, field) => {
    const table = kind === 'town' ? 'osm_ctx_place' : 'osm_ctx_poi';

    // 🔴 ЦЕЙ ТЕСТ — КОНКРЕТНИЙ КЕМПІНГ ІЗ КАРТКИ. spot-n4159830721 показував
    // станцію за 188,3 км, а справжня найближча в ЄС — Kemijärvi за 139,0 км.
    // Координати кемпінга й обох об'єктів — справжні, з бази.
    it('spot-n4159830721: бере Kemijärvi за 139,0 км, а не Kontiomäki за 188,3 км', async () => {
      const row = (await near(
        CONTEXT_SQL,
        contextParams(null) as unknown[],
        'spot-n4159830721',
      )) as Near & Record<string, unknown>;
      expect(row[field as keyof Near]).toBe(`${kind}-kemijarvi`);
      const metres = { town: 'town_m', shop: 'shop_m', station: 'rail_m' }[
        kind
      ];
      expect(Number(row[metres])).toBe(138959);
    });

    // 🔴 assert анкера: тест нічого не доводить, якщо планарний порядок тут
    // збігається з геодезичним. Kontiomäki має бути ближчим за градусами.
    it('(фікстура справді ставить планарно ближчого далі за метрами)', async () => {
      const planarTo = async (name: string) =>
        (
          await db.query<{ d: number }>(
            `SELECT ST_Distance(s.location, a.geom) AS d
             FROM camping_spots s, ${table} a
            WHERE s.slug = 'spot-n4159830721' AND a.name = $1`,
            [name],
          )
        ).rows[0].d;
      expect(await planarTo(`${kind}-kontiomaki`)).toBeLessThan(
        await planarTo(`${kind}-kemijarvi`),
      );
    });

    // 🔴 «ЛИШЕ ПЕРЕРАНЖУВАТИ N КАНДИДАТІВ» ТУТ НЕ ВИСТАЧАЄ. Справжній найближчий
    // — на 201-му місці за градусами. Запит, що бере N кандидатів за `<->`,
    // програє при будь-якому N до 201; цей — ні, бо кандидатів обмежує
    // відстань у метрах до планарно найближчого, а не число рядків.
    it('бере найближчого, що стоїть 201-м у планарному порядку', async () => {
      const row = await near(
        CONTEXT_SQL,
        contextParams(null) as unknown[],
        'deep',
      );
      expect(row[field as keyof Near]).toBe(`${kind}-deep-true`);
    });

    it('(фікстура справді ставить його 201-м)', async () => {
      const { rows } = await db.query<{ ahead: string }>(
        `SELECT count(*) AS ahead
         FROM camping_spots s, ${table} x, ${table} t
        WHERE s.slug = 'deep' AND t.name = $1 AND x.name LIKE $2
          AND ST_Distance(s.location, x.geom) < ST_Distance(s.location, t.geom)`,
        [`${kind}-deep-true`, `${kind}-deep-decoy-%`],
      );
      expect(rows[0].ahead).toBe('200');
    });

    // 🔴 Дві копії одного об'єкта (шлях `w…` і полігон `a…`, CAMP-253) лежать у
    // тій самій точці, відстані рівні до біта. Переможець — найменший ogc_fid,
    // а не той, кого планувальник прочитав першим: без цього refresh міг би
    // перезаписувати контекст щоразу іншою з двох назв. MUTATION: прибрати
    // `, x.ogc_fid` із ORDER BY кроку 2.
    it('нічия за відстанню: найменший ogc_fid, а не перший за порядком читання', async () => {
      const row = await near(
        CONTEXT_SQL,
        contextParams(null) as unknown[],
        'twin',
      );
      expect(row[field as keyof Near]).toBe(`${kind}-twin-way`);
    });
  },
);

describe('CONTEXT_SQL: оракул повним перебором (CAMP-323)', () => {
  // 🔴 ОРАКУЛ НЕ ДІЛИТЬ ІЗ ЗАПИТОМ НІЧОГО, ЩО МІРЯЄ: ні індексу, ні
  // прямокутника, ні `<->`. Для кожного кемпінга хмари він сортує ВЕСЬ шар за
  // `ST_Distance(::geography)` і бере перший. Запит, що перевіряється, — той
  // самий CONTEXT_SQL, що працює в проді.
  const ORACLE = `
    SELECT s.slug,
      (SELECT x.name FROM osm_ctx_place x
        WHERE x.place IN ('city','town') AND x.country = ANY($1::text[])
        ORDER BY ST_Distance(s.location::geography, x.geom::geography), x.ogc_fid LIMIT 1) AS town_name,
      (SELECT x.name FROM osm_ctx_poi x
        WHERE x.shop = 'supermarket' AND x.country = ANY($1::text[])
        ORDER BY ST_Distance(s.location::geography, x.geom::geography), x.ogc_fid LIMIT 1) AS shop_name,
      (SELECT x.name FROM osm_ctx_poi x
        WHERE x.railway IN ('station','halt') AND x.country = ANY($1::text[])
        ORDER BY ST_Distance(s.location::geography, x.geom::geography), x.ogc_fid LIMIT 1) AS rail_name
      FROM camping_spots s WHERE s.slug LIKE 'cloud-%'`;

  // Той самий запит, але впорядкований планарно, — лише щоб показати, що
  // хмара справді чогось варта: де градуси й метри розходяться.
  const PLANAR = `
    SELECT s.slug,
      (SELECT x.name FROM osm_ctx_place x WHERE x.place IN ('city','town') AND x.country = ANY($1::text[])
        ORDER BY s.location <-> x.geom LIMIT 1) AS town_name,
      (SELECT x.name FROM osm_ctx_poi x WHERE x.shop = 'supermarket' AND x.country = ANY($1::text[])
        ORDER BY s.location <-> x.geom LIMIT 1) AS shop_name,
      (SELECT x.name FROM osm_ctx_poi x WHERE x.railway IN ('station','halt') AND x.country = ANY($1::text[])
        ORDER BY s.location <-> x.geom LIMIT 1) AS rail_name
      FROM camping_spots s WHERE s.slug LIKE 'cloud-%'`;

  const bySlug = (rows: (Near & { slug: string })[]) =>
    new Map(rows.map((r) => [r.slug, r]));

  it('збігається з повним перебором для кожного з 40 кемпінгів і трьох видів', async () => {
    const params = contextParams(null) as unknown[];
    const got = bySlug(
      (await db.query<Near & { slug: string }>(CONTEXT_SQL, params)).rows,
    );
    const want = (
      await db.query<Near & { slug: string }>(ORACLE, [EU_MEMBER_STATES])
    ).rows;
    expect(want).toHaveLength(40);
    for (const w of want) {
      const g = got.get(w.slug);
      expect(g).toBeDefined();
      expect([g?.town_name, g?.shop_name, g?.rail_name]).toEqual([
        w.town_name,
        w.shop_name,
        w.rail_name,
      ]);
    }
  });

  // assert анкера: без розбіжностей між градусами й метрами оракул
  // підтверджував би й старий запит.
  it('(фікстура справді розводить градуси й метри для кожного виду)', async () => {
    const planar = (
      await db.query<Near & { slug: string }>(PLANAR, [EU_MEMBER_STATES])
    ).rows;
    const exact = bySlug(
      (await db.query<Near & { slug: string }>(ORACLE, [EU_MEMBER_STATES]))
        .rows,
    );
    for (const field of ['town_name', 'shop_name', 'rail_name'] as const) {
      const differ = planar.filter(
        (p) => p[field] !== exact.get(p.slug)?.[field],
      );
      expect(differ.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('умова на країну і список', () => {
  // 🔴 Список — той, що у проєкті, а не переписаний. MUTATION: підставити в
  // contextParams літерал або EU_MEMBER_STATES_AND_SUBDIVISIONS.
  it('передає в запит EU_MEMBER_STATES, той самий масив', () => {
    expect(contextParams('PL')[1]).toBe(EU_MEMBER_STATES);
    expect(contextParams('PL')[0]).toBe('PL');
  });

  // Два кроки × три join-и: перший шукає верхню межу, другий — найближчого в
  // прямокутнику. Умова мусить стояти в обох (див. nearestJoin).
  it('умова стоїть у обох кроках кожного з трьох join-ів, а на воді її немає', () => {
    const blocks = CONTEXT_SQL.split('LEFT JOIN LATERAL').slice(1);
    expect(blocks.map((b) => b.split(UNION_PREDICATE).length - 1)).toEqual([
      0, 2, 2, 2,
    ]);
    expect(CONTEXT_SQL.split(UNION_PREDICATE).length - 1).toBe(
      UNION_PREDICATE_COUNT,
    );
  });

  it('withoutUnionFilter кидає, якщо умов не шість', () => {
    const one = CONTEXT_SQL.replace(UNION_PREDICATE, 'true');
    expect(() => withoutUnionFilter(one)).toThrow(
      /exactly 6 places[\s\S]*found 5/,
    );
  });
});

describe('NEAR_SQL', () => {
  // 🔴 refresh-context-near.ts читає NEAR_SQL, а сторінки — те, що записав
  // compute-context із CONTEXT_SQL. Якби фільтр жив лише в одному з них,
  // скрипт «виправлення» записував би те, чого сам compute-context не дасть.
  // MUTATION: дати NEAR_SQL власну копію join-ів без умови.
  it('дає ті самі місто, магазин і станцію, що й повний запит', async () => {
    const params = contextParams(null) as unknown[];
    const full = (await db.query(CONTEXT_SQL, params)).rows;
    const nearRows = (await db.query(NEAR_SQL, params)).rows;
    expect(nearRows.length).toBe(full.length);
    expect(full.length).toBeGreaterThan(0);
    for (const row of full) {
      const other = nearRows.find((r) => r.id === row.id);
      expect(other).toBeDefined();
      expect([other.town_name, other.shop_name, other.rail_name]).toEqual([
        row.town_name,
        row.shop_name,
        row.rail_name,
      ]);
    }
  });

  it('не тягне воду', () => {
    expect(NEAR_SQL).not.toContain('osm_ctx_water');
  });
});

describe('tag-ctx-country.sql', () => {
  // Усе, що ця група робить, відкочується: фікстура вище лишається цілою.
  beforeEach(() => db.query('BEGIN'));
  afterEach(() => db.query('ROLLBACK'));

  const countryOf = async (table: string, id: string) =>
    (
      await db.query<{ country: string | null }>(
        `SELECT country FROM ${table} WHERE id = $1`,
        [id],
      )
    ).rows[0].country;

  // 🔴 MUTATION: у котромусь UPDATE замінити `min(c.iso)` на літерал.
  it('проставляє код країни, у полігоні якої стоїть об’єкт', async () => {
    expect(await countryOf('osm_ctx_place', 'town-poland')).toBe('pl');
    expect(await countryOf('osm_ctx_place', 'town-lithuania')).toBe('lt');
    expect(await countryOf('osm_ctx_poi', 'shop-poland')).toBe('pl');
    expect(await countryOf('osm_ctx_poi', 'station-lithuania')).toBe('lt');
  });

  // Країни, якої немає у списку членів, колонка не ховає: відсікає її запит.
  it('проставляє й код країни, якої нема у списку членів', async () => {
    expect(await countryOf('osm_ctx_place', 'town-russia')).toBe('ru');
  });

  // 🔴 MUTATION: прибрати COALESCE(…, ''). Тоді «в жодному полігоні» стає NULL,
  // а NULL — це «ще не проставлено», і перевірка готовності падає на кожному
  // завантаженні, де є хоч один об'єкт біля кордону.
  it('об’єкт поза всіма полігонами отримує порожній рядок, а не NULL', async () => {
    expect(await countryOf('osm_ctx_place', 'town-nowhere')).toBe('');
    expect(await countryOf('osm_ctx_poi', 'shop-nowhere')).toBe('');
  });

  // 🔴 MUTATION: прибрати другий UPDATE (osm_ctx_poi). Магазини й станції
  // лишились би без країни, і фільтр відкинув би їх усі.
  it('проставляє обидва шари, і NULL не лишається', async () => {
    await db.query(`UPDATE osm_ctx_place SET country = NULL`);
    await db.query(`UPDATE osm_ctx_poi SET country = NULL`);
    await db.query(TAG_SQL);
    const nulls = await db.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM osm_ctx_place WHERE country IS NULL)
            + (SELECT count(*) FROM osm_ctx_poi WHERE country IS NULL) AS n`,
    );
    expect(nulls.rows[0].n).toBe('0');
    expect(await countryOf('osm_ctx_poi', 'station-poland')).toBe('pl');
  });

  // 🔴 load-context.sh пересоздає таблиці без колонки; файл мусить її
  // повернути. MUTATION: прибрати `ADD COLUMN IF NOT EXISTS`.
  it('сам повертає колонку, якої немає, і другий запуск нічого не ламає', async () => {
    await db.query(`ALTER TABLE osm_ctx_place DROP COLUMN country`);
    await db.query(`ALTER TABLE osm_ctx_poi DROP COLUMN country`);
    await db.query(TAG_SQL);
    expect(await countryOf('osm_ctx_place', 'town-poland')).toBe('pl');
    await db.query(TAG_SQL);
    expect(await countryOf('osm_ctx_place', 'town-poland')).toBe('pl');
  });
});

describe('assertCountryTagsReady', () => {
  /** Відповідає за змістом запиту, не за порядком викликів. */
  const answering = (opts: {
    tables?: string[];
    untagged?: number;
    codes?: string[];
  }): Queryable =>
    ({
      query: async (sql: string) => {
        if (sql.includes('information_schema')) {
          return {
            rows: (opts.tables ?? ['osm_ctx_place', 'osm_ctx_poi']).map(
              (table_name) => ({ table_name }),
            ),
          };
        }
        if (sql.includes('IS NULL')) {
          return { rows: [{ n: String(opts.untagged ?? 0) }] };
        }
        return {
          rows: (opts.codes ?? [...EU_MEMBER_STATES]).map((country) => ({
            country,
          })),
        };
      },
    }) as Queryable;

  it('пропускає повний комплект: 27 країн, є порожній рядок і чужа країна', async () => {
    await expect(
      assertCountryTagsReady(
        answering({ codes: [...EU_MEMBER_STATES, 'ru', 'sm', ''] }),
      ),
    ).resolves.toBeUndefined();
  });

  // 🔴 MUTATION: прибрати перевірку колонок. Це ПЕРШИЙ наслідок нового
  // load-context.sh: ogr2ogr -overwrite стирає колонку.
  it('падає, якщо колонки немає, і каже, чим її повернути', async () => {
    await expect(
      assertCountryTagsReady(answering({ tables: ['osm_ctx_poi'] })),
    ).rejects.toThrow(/osm_ctx_place has no country column[\s\S]*--tag-only/);
  });

  // 🔴 MUTATION: прибрати перевірку NULL. Частково проставлені шари тихо
  // губили б усі об'єкти без країни.
  it('падає, якщо є рядки без проставленої країни', async () => {
    await expect(
      assertCountryTagsReady(answering({ untagged: 12 })),
    ).rejects.toThrow(/12 towns, shops or stations have no country yet/);
  });

  // 🔴 MUTATION: прибрати перевірку «кожен член списку є». Без неї країна,
  // проставлена проти неповної таблиці полігонів, тихо втрачає все.
  it('падає, якщо бракує навіть однієї держави-члена, і називає її', async () => {
    const without = EU_MEMBER_STATES.filter((c) => c !== 'fr');
    await expect(
      assertCountryTagsReady(answering({ codes: [...without] })),
    ).rejects.toThrow(/tagged with: fr\b/);
  });

  // 🔴 ЧАСТКОВЕ ЗАВАНТАЖЕННЯ, І ЧОМУ ЦЕ НЕ ДІРКА В СТОРОЖІ.
  //
  // Рецензія PR #238 довела, що третя перевірка вбивала задокументований
  // процес: `load-context.sh europe/slovenia` лишає шари без двадцяти з
  // гаком держав, і `compute-context` падав із порадою, якої неможливо
  // виконати. Послаблення тут НАВМИСНЕ, вузьке й гучне.
  it('з partial: true не падає на неповному переліку, але називає коди', async () => {
    const без = EU_MEMBER_STATES.filter((c) => c !== 'fr' && c !== 'pt');
    const сказано: string[] = [];
    await expect(
      assertCountryTagsReady(answering({ codes: [...без] }), {
        partial: true,
        log: { warn: (m: string) => сказано.push(m) },
      }),
    ).resolves.toBeUndefined();
    expect(сказано.join(' ')).toMatch(/fr, pt/);
    // Мовчазне послаблення = забуте послаблення, тому ім'я змінної має
    // прозвучати в попередженні.
    expect(сказано.join(' ')).toMatch(/CAMPTRIBE_PARTIAL_CONTEXT=1/);
  });

  // 🔴 І ОСЬ ЩО РОБИТЬ ЦЕ ПОСЛАБЛЕННЯ БЕЗПЕЧНИМ: воно вузьке. Прапорець
  // стосується ОДНІЄЇ перевірки з чотирьох. Якби він глушив усі, часткове
  // завантаження ховало б і стерту колонку, і рядки без країни — тобто
  // рівно ті дві поломки, від яких цей сторож і стоїть.
  // 🔴 ЧОГО ТУТ НЕМАЄ НАВМИСНЕ: тесту на проводку. Три точки виклику
  // читають `process.env[PARTIAL_ENV]` самі, і жоден випадок тут не впаде,
  // якщо хтось цей рядок звідти прибере. Я лишаю так свідомо: втрата
  // проводки зсуває поведінку в БЕЗПЕЧНИЙ бік — сторож знову стає суворим,
  // прод лишається прикритим, ламається лише часткове завантаження в
  // розробці, і ламається голосно. Дірка в проводці небезпечна тоді, коли
  // її втрата щось ПОСЛАБЛЮЄ; тут навпаки.
  it('partial: true НЕ глушить ані стерту колонку, ані рядки без країни', async () => {
    await expect(
      assertCountryTagsReady(answering({ tables: ['osm_ctx_poi'] }), {
        partial: true,
      }),
    ).rejects.toThrow(/has no country column/);
    await expect(
      assertCountryTagsReady(answering({ untagged: 12 }), { partial: true }),
    ).rejects.toThrow(/12 towns, shops or stations/);
  });

  // 🔴 MUTATION: прибрати перевірку чужих кодів. `ax` і `el` — члени Союзу
  // під чужою назвою: об'єкт із таким кодом не збігся б зі списком.
  it.each(['ax', 'el'])(
    'падає на коді іншої системи кодування: %s',
    async (code) => {
      await expect(
        assertCountryTagsReady(
          answering({ codes: [...EU_MEMBER_STATES, code] }),
        ),
      ).rejects.toThrow(new RegExp(`does not spell: ${code}`));
    },
  );

  // Справжній запит проти справжньої бази: перевіряє, що SQL гарду взагалі
  // виконується, а не лише що фальшивка відповідає на його текст.
  describe('проти справжньої бази', () => {
    beforeEach(() => db.query('BEGIN'));
    afterEach(() => db.query('ROLLBACK'));

    it('бачить, що колонку стерто', async () => {
      await db.query(`ALTER TABLE osm_ctx_poi DROP COLUMN country`);
      await expect(assertCountryTagsReady(db)).rejects.toThrow(
        /osm_ctx_poi has no country column/,
      );
    });

    it('бачить рядок без країни', async () => {
      await db.query(
        `INSERT INTO osm_ctx_place (id, name, place, geom)
         VALUES ('fresh', 'fresh', 'town', ST_Multi(ST_SetSRID(ST_MakePoint(20, 54), 4326)))`,
      );
      await expect(assertCountryTagsReady(db)).rejects.toThrow(
        /1 towns, shops or stations have no country yet/,
      );
    });

    it('бачить, що у фікстурі немає більшості держав-членів', async () => {
      await expect(assertCountryTagsReady(db)).rejects.toThrow(
        /tagged with: at, be, bg/,
      );
    });
  });
});

describe('build-country-area.sql', () => {
  const square = (x0: number, y0: number, x1: number, y1: number) =>
    `ST_Multi(ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 4326))`;

  /** Кільце з чотирьох ліній — так виглядають шляхи, що їх екстракт не обрізав. */
  const ring = (x0: number, y0: number, x1: number, y1: number) =>
    [
      [x0, y0, x1, y0],
      [x1, y0, x1, y1],
      [x1, y1, x0, y1],
      [x0, y1, x0, y0],
    ]
      .map(
        ([a, b, c, d]) =>
          `ST_Multi(ST_MakeLine(ST_MakePoint(${a}, ${b}), ST_MakePoint(${c}, ${d})))`,
      )
      .map(
        (g) =>
          `INSERT INTO osm_country_lines (iso2, geom) VALUES ('ES-CE', ST_SetSRID(${g}, 4326));`,
      )
      .join('\n');

  async function stage(withCeuta: boolean): Promise<void> {
    await db.query(`
      CREATE TABLE osm_country_staging (iso1 varchar, iso2 varchar, lvl varchar, geom geometry(MultiPolygon, 4326));
      CREATE TABLE osm_country_lines (iso2 text, geom geometry(MultiLineString, 4326));
      INSERT INTO osm_country_staging VALUES
        ('PL', NULL, '2', ST_SetSRID(${square(0, 0, 10, 10)}, 4326)),
        ('RU', NULL, '2', ST_SetSRID(${square(10, 0, 20, 10)}, 4326)),
        (NULL, 'FR-ARA', '4', ST_SetSRID(${square(30, 0, 35, 5)}, 4326)),
        (NULL, 'FR-BRE', '4', ST_SetSRID(${square(35, 0, 40, 5)}, 4326));
      ${withCeuta ? ring(70, 0, 72, 2) : ''}`);
  }

  async function build(eu: string): Promise<void> {
    await db.query(`SELECT set_config('camp.eu', $1, true)`, [eu]);
    await db.query(BUILD_SQL);
  }

  async function covers(iso: string, lon: number, lat: number) {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM osm_country_area
                       WHERE iso = $1 AND ST_Covers(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326))) AS ok`,
      [iso, lon, lat],
    );
    return rows[0].ok;
  }

  // Усе, що ця група робить, відкочується: фікстура вище лишається цілою.
  beforeEach(() => db.query('BEGIN'));
  afterEach(() => db.query('ROLLBACK'));

  // Кожен тест просить лише ті країни, які сам перевіряє. Інакше ворота
  // (DO-блок у файлі) червонили б усі тести групи, щойно зламана будь-яка
  // гілка, і мутація гілки не відрізнялась би від мутації воріт.
  it('бере полігон країни з її власного відношення', async () => {
    await stage(true);
    await build('{pl}');
    expect(await covers('pl', 5, 5)).toBe(true);
    expect(await covers('pl', 15, 5)).toBe(false);
  });

  // 🔴 MUTATION: прибрати гілку 2 (області, коли немає відношення країни).
  // Так виглядають Франція, Іспанія й Нідерланди: відношення країни не
  // збирається, а області — так.
  it('для країни без власного відношення складає її з областей', async () => {
    await stage(true);
    await build('{pl,fr}');
    expect(await covers('fr', 32, 2)).toBe(true);
    expect(await covers('fr', 37, 2)).toBe(true);
  });

  // 🔴 MUTATION: прибрати гілку 3 (полігонізація шляхів). Без неї два
  // кемпінги в Сеуті губили б власне місто: Сеута в Іспанії й у Союзі, а
  // нічим іншим вона не збирається.
  it('перебудовує обрізану область зі шляхів, що лишились', async () => {
    await stage(true);
    await build('{pl,es}');
    expect(await covers('es', 71, 1)).toBe(true);
    expect(await covers('es', 75, 1)).toBe(false);
  });

  // Країни, яких нема у списку членів, у таблиці лишаються (ru): відсікає їх
  // запит, а не завантажувач.
  it('кладе в таблицю й країну, якої нема у списку членів', async () => {
    await stage(true);
    await build('{pl}');
    expect(await covers('ru', 15, 5)).toBe(true);
  });

  // 🔴 MUTATION: прибрати DO-блок із воротами. Без нього відсутня країна не
  // падає ніде: фільтр у compute-context просто вирізає її цілком.
  it('не підміняє таблицю, якщо бракує бодай однієї країни, і лишає попередню', async () => {
    await stage(true);
    await build('{pl}');
    const before = await db.query(`SELECT count(*) AS n FROM osm_country_area`);

    // `it` у стейджингу немає ніде — ні відношення, ні областей, ні шляхів.
    await db.query('SAVEPOINT gate');
    await expect(build('{pl,it}')).rejects.toThrow(/no polygon for it/);
    await db.query('ROLLBACK TO SAVEPOINT gate');

    const after = await db.query(`SELECT count(*) AS n FROM osm_country_area`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(await covers('pl', 5, 5)).toBe(true);
  });
});
