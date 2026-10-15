#!/usr/bin/env node
/**
 * CAMP-296 — скільки кемпінгів «дивляться» за межі ЄС-27, по кожному з
 * чотирьох запитів: місто, магазин, станція, вода.
 *
 *   npx ts-node src/osm/audit-context-near.ts
 *
 * Тільки читає. Той самий інструмент ДО й ПІСЛЯ:
 *   до    — NEAR_SQL без умови на країну (withoutUnionFilter);
 *   після — NEAR_SQL, яким він є.
 * Різниця — рівно шість підстановок (два кроки в кожному з трьох join-ів),
 * див. withoutUnionFilter. Порядок в обох — геодезичний (CAMP-323).
 *
 * 🔴 «ПОЗА СОЮЗОМ» ТУТ ВИЗНАЧАЄ ІНША ФОРМУЛА, НЕ ТА, ЩО В ЗАПИТІ.
 * Запит відбирає за колонкою `country`, проставленою на завантаженні. Аудит
 * бере ЗНАЙДЕНИЙ запитом об'єкт (його id приходить із самого запиту) і
 * питає живу геометрію: `NOT EXISTS … ST_Intersects` проти osm_country_area.
 * Якби аудит читав ту саму колонку, `після` було б нулем за побудовою —
 * перевірка, що підтверджує сама себе. Так зіпсована, застаріла чи
 * неповна колонка видна: об'єкт у Росії з `country = 'pl'` рахується тут як
 * «поза Союзом».
 *
 * Окремо друкується розбіжність колонки з геометрією по всьому шару.
 *
 * 🔴 ВОДА — ДО НАЙБЛИЖЧОЇ ТОЧКИ НА НІЙ, а не до «центра» озера: ріка й берег
 * перетинають кордон, і «де лежить вода» — це «де лежить найближчий її
 * шматок». Для води є лише `до`: її навмисно не фільтруємо (див. CONTEXT_SQL).
 */
import 'dotenv/config';
import { Client } from 'pg';
import {
  assertCountryTagsReady,
  PARTIAL_ENV,
  contextParams,
  NEAR_SQL,
  STATION_FILTER,
  TOWN_FILTER,
  WATER_FID_SQL,
  withoutUnionFilter,
} from './context-sql';
import { EU_MEMBER_STATES } from './eu';

interface Row {
  id: string;
  town_fid: number | null;
  shop_fid: number | null;
  rail_fid: number | null;
  water_fid: number | null;
}

const LAYERS = [
  { kind: 'місто', col: 'town_fid', table: 'osm_ctx_place' },
  { kind: 'магазин', col: 'shop_fid', table: 'osm_ctx_poi' },
  { kind: 'станція', col: 'rail_fid', table: 'osm_ctx_poi' },
] as const;

const NOT_IN_UNION = `NOT EXISTS (
    SELECT 1 FROM osm_country_area c
     WHERE c.iso = ANY($2::text[])
       AND ST_Intersects(c.geom, ST_PointOnSurface(x.geom)))`;

/** Які з цих об'єктів лежать поза Союзом. */
async function outsideFids(
  db: Client,
  table: (typeof LAYERS)[number]['table'],
  fids: number[],
): Promise<Set<number>> {
  if (fids.length === 0) return new Set();
  const { rows } = await db.query<{ ogc_fid: number }>(
    `SELECT x.ogc_fid FROM ${table} x
      WHERE x.ogc_fid = ANY($1::int[]) AND ${NOT_IN_UNION}`,
    [fids, EU_MEMBER_STATES],
  );
  return new Set(rows.map((r) => r.ogc_fid));
}

/** Кемпінги, чия найближча вода — найближчим шматком — лежить поза Союзом. */
async function spotsWithWaterOutside(db: Client, rows: Row[]): Promise<number> {
  const pairs = rows.filter((r) => r.water_fid !== null);
  const { rows: out } = await db.query<{ n: string }>(
    `SELECT count(*) AS n
       FROM unnest($1::text[], $2::int[]) AS p(spot_id, fid)
       JOIN camping_spots s ON s.id::text = p.spot_id
       JOIN osm_ctx_water w ON w.ogc_fid = p.fid
      WHERE NOT EXISTS (
              SELECT 1 FROM osm_country_area c
               WHERE c.iso = ANY($3::text[])
                 AND ST_Intersects(c.geom,
                       ST_ClosestPoint(w.geom, s.location::geometry)))`,
    [pairs.map((r) => r.id), pairs.map((r) => r.water_fid), EU_MEMBER_STATES],
  );
  return Number(out[0].n);
}

const nonNull = (xs: (number | null)[]): number[] => [
  ...new Set(xs.filter((x): x is number => x !== null)),
];

/**
 * Колонка `country` проти живої геометрії, по всьому шару: у скількох рядків
 * «член Союзу чи ні» за колонкою не збігається з тим, що кажуть полігони.
 * Нуль означає, що колонка не застаріла відносно osm_country_area.
 */
async function disagreement(
  db: Client,
  table: string,
  where: string,
): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} x
      WHERE ${where}
        AND (x.country = ANY($1::text[]))
            IS DISTINCT FROM EXISTS (
              SELECT 1 FROM osm_country_area c
               WHERE c.iso = ANY($1::text[])
                 AND ST_Intersects(c.geom, ST_PointOnSurface(x.geom)))`,
    [EU_MEMBER_STATES],
  );
  return Number(rows[0].n);
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await assertCountryTagsReady(db, {
      // Прапорець ставить людина, що запустила часткове завантаження;
      // з даних його не вгадати. Див. PARTIAL_ENV у context-sql.ts.
      partial: process.env[PARTIAL_ENV] === '1',
    });

    const t0 = Date.now();
    const before = (await db.query<Row>(withoutUnionFilter(NEAR_SQL), [null]))
      .rows;
    const t1 = Date.now();
    const after = (
      await db.query<Row>(NEAR_SQL, contextParams(null) as unknown[])
    ).rows;
    const t2 = Date.now();

    console.log(
      `кемпінгів ${before.length} (до) / ${after.length} (після); ` +
        `NEAR_SQL без фільтра ${((t1 - t0) / 1000).toFixed(1)} с, ` +
        `з фільтром ${((t2 - t1) / 1000).toFixed(1)} с`,
    );
    console.log(
      'вид      | є відповідь до | після | кемпінгів дивляться поза ЄС-27: до | після',
    );

    for (const { kind, col, table } of LAYERS) {
      const outB = await outsideFids(
        db,
        table,
        nonNull(before.map((r) => r[col])),
      );
      const outA = await outsideFids(
        db,
        table,
        nonNull(after.map((r) => r[col])),
      );
      const answeredB = before.filter((r) => r[col] !== null).length;
      const answeredA = after.filter((r) => r[col] !== null).length;
      // Кемпінгів, а не об'єктів: один об'єкт буває найближчим для багатьох.
      const spotsB = before.filter(
        (r) => r[col] !== null && outB.has(r[col]),
      ).length;
      const spotsA = after.filter(
        (r) => r[col] !== null && outA.has(r[col]),
      ).length;
      console.log(
        `${kind.padEnd(8)} | ${String(answeredB).padStart(14)} | ${String(answeredA).padStart(5)} | ` +
          `${String(spotsB).padStart(34)} | ${spotsA}`,
      );
    }

    const t3 = Date.now();
    const water = (await db.query<Row>(WATER_FID_SQL, [null])).rows;
    const waterOut = await spotsWithWaterOutside(db, water);
    console.log(
      `вода (не фільтрується) | є відповідь ${water.filter((r) => r.water_fid !== null).length} | ` +
        `найближчий шматок води поза ЄС-27: ${waterOut} ` +
        `(${((Date.now() - t3) / 1000).toFixed(1)} с)`,
    );

    console.log('розбіжність колонки `country` з живими полігонами:');
    console.log(
      `  місто   ${await disagreement(db, 'osm_ctx_place', TOWN_FILTER)}`,
    );
    console.log(
      `  магазин ${await disagreement(db, 'osm_ctx_poi', "x.shop = 'supermarket'")}`,
    );
    console.log(
      `  станція ${await disagreement(db, 'osm_ctx_poi', STATION_FILTER)}`,
    );
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
