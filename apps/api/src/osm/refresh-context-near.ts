#!/usr/bin/env node
/**
 * CAMP-296 — перерахувати місто, супермаркет і станцію в уже обчисленому
 * `context`, тепер лише всередині ЄС-27.
 *
 * 🔴 ЧОМУ ОКРЕМИЙ СКРИПТ, А НЕ `compute-context --all`.
 *
 * Зміна запиту не доходить до сторінок сама: `compute-context` пропускає
 * кемпінг, чиї координати не зсунулись, а `--all` ходить по висоту в
 * Open-Meteo на КОЖЕН кемпінг — дев'ять координат на штуку, на 57 082
 * кемпінгах це понад місяць квоти. А висота не змінилась: змінились три
 * числа, які PostGIS рахує безкоштовно. Тож цей скрипт перечитує лише їх і
 * не чіпає ні `at`, ні висоти, ні рельєфу, ні води.
 *
 *   npx ts-node src/osm/refresh-context-near.ts                # сухий прогін
 *   npx ts-node src/osm/refresh-context-near.ts --apply
 *   npx ts-node src/osm/refresh-context-near.ts --apply --with-drift
 *
 * 🔴 ЗА ЗАМОВЧУВАННЯМ — ЛИШЕ ТЕ, ЩО ЗМІНИЛА УМОВА НА КРАЇНУ. Заміряно
 * 15.10.2026 на копії продакшн-бази: збережений контекст відстає від
 * завантажених шарів, бо compute-context не перечитує кемпінг, що не
 * зсунувся. Із 1 195 кемпінгів, чиї місто/магазин/станція відрізняються
 * від свіжих, 117 відрізняються через CAMP-296, а 1 078 — просто тому, що
 * шари перезавантажувались після останнього обчислення. Друге — теж правда,
 * але це окреме рішення з окремою площею ураження (тисяча сторінок, які
 * мінялись би без жодного рядка в рецензії). Тож без `--with-drift` ключ
 * змінюється лише тоді, коли запит із умовою й без неї дають ЙОМУ різні
 * відповіді; решта розбіжностей лічиться й друкується, але не пишеться.
 *
 * 🔴🔴 CAMP-323: ПІСЛЯ ВИПРАВЛЕННЯ ПОРЯДКУ ЦЕЙ СКРИПТ БЕЗ `--with-drift`
 * ПОЧТИ НІЧОГО НЕ ВИПРАВЛЯЄ. Збережені значення було обрано за градусами
 * (`<->`), а NEAR_SQL тепер обирає за метрами. Але `legacy` тут — той самий
 * NEAR_SQL без умови на країну, тож і він геодезичний: ключ, у якого змінився
 * лише порядок (Kontiomäki → Kemijärvi), у «що змінила умова» не потрапляє, а
 * лічиться у «розходяться зі свіжим запитом». Заміряно 15.10.2026 на копії
 * бази (57 082 кемпінги, 1 473 без обчисленого контексту):
 *
 *   без --with-drift     38 кемпінгів змінюється (місто 1, магазин 6, станція 31),
 *                        23 982 розходяться і НЕ чіпаються
 *   з   --with-drift   24 013 кемпінгів (місто 8 195, магазин 9 516, станція 13 390)
 *
 * Щоб записати виправлені відстані, потрібен `--apply --with-drift`, і це
 * вже не «тисяча сторінок без рядка в рецензії»: це двадцять чотири тисячі, і
 * рядок у рецензії — CAMP-323. Другий прогін після цього міняє 0.
 *
 * За замовчуванням СУХИЙ: скрипт пише в продакшн-базу. Ідемпотентний — другий
 * прогін нічого не змінює, бо порівнює збережене з тим, що дає запит.
 *
 * 🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО ЗАПИСУ. Кожен UPDATE у власному
 * try/catch і в власній транзакції (автокоміт): падіння на одному кемпінгу
 * друкується з його id, лічиться, і прогін іде далі. Код виходу ненульовий,
 * якщо хоч один не записався, — але решта вже записана.
 *
 * 🔴 UPDATE ПОРІВНЮЄ `context` ІЗ ТИМ, ЩО БУЛО ПРОЧИТАНО. Поки скрипт читав
 * 57 тисяч рядків, `compute-context` міг переписати котрийсь із них, і
 * наша копія — вже застаріла: запис її поверх затер би свіжу висоту. Такий
 * рядок лічиться як `stale` і лишається до наступного прогону.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { feature, saysSomething } from './compute-context';
import {
  assertCountryTagsReady,
  PARTIAL_ENV,
  contextParams,
  NEAR_SQL,
  withoutUnionFilter,
} from './context-sql';
import type { NearestFeature, SpotContext } from './spot-context';

type NearKey = 'town' | 'supermarket' | 'station';
const KEYS: readonly NearKey[] = ['town', 'supermarket', 'station'];

export type FreshNear = Partial<Record<NearKey, NearestFeature>>;

const same = (a?: NearestFeature, b?: NearestFeature): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.m === b.m && a.name === b.name;

export interface NearChange {
  next: SpotContext;
  /** Які з трьох ключів змінились. */
  changed: NearKey[];
  /** Ключ був, а в ЄС-27 для цього кемпінгу об'єкта немає зовсім. */
  removed: NearKey[];
  /** Після зміни нічого не лишилось казати: контекст стає порожнім. */
  emptied: boolean;
}

/**
 * Накласти свіжі місто / магазин / станцію на збережений контекст.
 *
 * Чиста функція: нічого не читає з бази, не пише, не псує вхід. Усе, крім
 * трьох ключів, переходить у `next` як є; а з трьох — лише ті, що в `only`.
 *
 * 🔴 `removed` — це «порожнє не малюємо». Якщо в ЄС-27 для кемпінгу немає
 * жодного міста, ключ зникає, а не лишається зі старим числом до об'єкта поза
 * Союзом.
 *
 * 🔴 Контекст, у якому після зміни нічого не лишилось, стає `{}`, а НЕ
 * `{ at }`. Сторінка читає «порожній» як `context = '{}'` (CAMP-105), а
 * контекст лише з `at` — непорожній і зняв би noindex з порожньої сторінки.
 * Це інша сторона `saysSomething`: там стару відповідь лишають, коли нової
 * немає, а тут стара відповідь і є хибою.
 */
export function applyNear(
  context: SpotContext,
  fresh: FreshNear,
  only: readonly NearKey[] = KEYS,
): NearChange {
  const next: SpotContext = { ...context };
  const changed: NearKey[] = [];
  const removed: NearKey[] = [];

  for (const key of only) {
    if (same(context[key], fresh[key])) continue;
    changed.push(key);
    if (fresh[key] === undefined) {
      delete next[key];
      removed.push(key);
    } else {
      next[key] = fresh[key];
    }
  }

  if (changed.length > 0 && !saysSomething(next)) {
    return { next: {}, changed, removed, emptied: true };
  }
  return { next, changed, removed, emptied: false };
}

interface Row {
  id: string;
  slug: string;
  context: SpotContext | null;
  town_m: number | null;
  town_name: string | null;
  shop_m: number | null;
  shop_name: string | null;
  rail_m: number | null;
  rail_name: string | null;
}

export const freshOf = (r: Row): FreshNear => {
  const out: FreshNear = {};
  const town = feature(r.town_m, r.town_name);
  if (town) out.town = town;
  const shop = feature(r.shop_m, r.shop_name);
  if (shop) out.supermarket = shop;
  const rail = feature(r.rail_m, r.rail_name);
  if (rail) out.station = rail;
  return out;
};

/**
 * Які ключі чіпати: ті, на яких умова на країну МІНЯЄ відповідь запиту
 * (`legacy` — запит без умови, `fresh` — з нею), або всі, якщо просили
 * `--with-drift`.
 */
export function keysToTouch(
  legacy: FreshNear,
  fresh: FreshNear,
  withDrift: boolean,
): readonly NearKey[] {
  return withDrift ? KEYS : KEYS.filter((k) => !same(legacy[k], fresh[k]));
}

async function main(apply: boolean, withDrift: boolean): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await assertCountryTagsReady(db, {
      // Прапорець ставить людина, що запустила часткове завантаження;
      // з даних його не вгадати. Див. PARTIAL_ENV у context-sql.ts.
      partial: process.env[PARTIAL_ENV] === '1',
    });

    const { rows } = await db.query<Row>(
      NEAR_SQL,
      contextParams(null) as unknown[],
    );
    // Той самий запит без умови: чим він відповів би до CAMP-296. Потрібен,
    // щоб відрізнити «змінила умова» від «шари перезавантажились».
    const legacyById = new Map<string, Row>(
      (await db.query<Row>(withoutUnionFilter(NEAR_SQL), [null])).rows.map(
        (r): [string, Row] => [r.id, r],
      ),
    );

    const zero = (): Record<NearKey, number> => ({
      town: 0,
      supermarket: 0,
      station: 0,
    });
    const perKey = zero();
    const removedPerKey = zero();
    const driftPerKey = zero();
    let touched = 0;
    let driftSpots = 0;
    let emptied = 0;
    let skipped = 0;
    let written = 0;
    let stale = 0;
    let failed = 0;

    for (const row of rows) {
      // Контекст без `at` ще не обчислювався: його зробить compute-context.
      if (!row.context?.at) {
        skipped++;
        continue;
      }
      const fresh = freshOf(row);
      const legacyRow = legacyById.get(row.id);
      // Немає двійника в запиті без умови — не повинно бути, але тоді не
      // вгадуємо, що змінила умова: чіпаємо лише при --with-drift.
      const legacy = legacyRow ? freshOf(legacyRow) : fresh;
      const scope = keysToTouch(legacy, fresh, withDrift);

      // Що ЛИШИЛОСЬ б розбіжним, але не зачіпається: збережене відстає від шарів.
      const rest = applyNear(
        row.context,
        fresh,
        KEYS.filter((k) => !scope.includes(k)),
      );
      if (rest.changed.length > 0) driftSpots++;
      for (const k of rest.changed) driftPerKey[k]++;

      const change = applyNear(row.context, fresh, scope);
      if (change.changed.length === 0) continue;

      touched++;
      for (const k of change.changed) perKey[k]++;
      for (const k of change.removed) removedPerKey[k]++;
      if (change.emptied) emptied++;
      if (!apply) continue;

      try {
        const res = await db.query(
          `UPDATE camping_spots
              SET context = $2::jsonb, context_computed_at = now()
            WHERE id = $1 AND context = $3::jsonb`,
          [row.id, JSON.stringify(change.next), JSON.stringify(row.context)],
        );
        if (res.rowCount === 1) written++;
        else stale++;
      } catch (err) {
        failed++;
        console.error(
          `  ✗ ${row.id} (${row.slug}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(
      `${apply ? 'ЗАПИСАНО' : 'СУХИЙ ПРОГІН'}${withDrift ? ' (--with-drift)' : ''}: ` +
        `${rows.length} кемпінгів прочитано, ${skipped} без обчисленого контексту пропущено`,
    );
    console.log(`  кемпінгів змінюється          ${touched}`);
    for (const k of KEYS) {
      console.log(
        `  ${k.padEnd(12)} змінюється   ${String(perKey[k]).padStart(5)}` +
          `   з них у ЄС-27 об'єкта немає зовсім ${removedPerKey[k]}`,
      );
    }
    console.log(`  контекст порожнім             ${emptied}`);
    if (!withDrift) {
      console.log(
        `  розходяться зі свіжим запитом, НЕ чіпаю  ${driftSpots}` +
          `  (місто ${driftPerKey.town}, магазин ${driftPerKey.supermarket}, станція ${driftPerKey.station}) — це --with-drift: ` +
          'шари перезавантажились після обчислення АБО (CAMP-323) метри замість градусів',
      );
    }
    if (apply) {
      console.log(`  записано                      ${written}`);
      console.log(`  застаріло за час прогону      ${stale}`);
      console.log(`  не записалось                 ${failed}`);
    }
    if (failed > 0) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

// 🔴 Сторож точки входу: нічого не виконується на import — той самий, що в
// compute-context.ts.
if (require.main === module) {
  main(
    process.argv.includes('--apply'),
    process.argv.includes('--with-drift'),
  ).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
