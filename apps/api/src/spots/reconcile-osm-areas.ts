// CAMP-274: один обʼєкт OSM, два рядки — площа й лінія.
//
//   npx ts-node src/spots/reconcile-osm-areas.ts                 # сухий прогін
//   npx ts-node src/spots/reconcile-osm-areas.ts --apply
//   npx ts-node src/spots/reconcile-osm-areas.ts --predict f.json
//   npx ts-node src/spots/reconcile-osm-areas.ts --self-test
//
// 🔴 ЧОМУ ЦЕ ОКРЕМИЙ ПРОХІД, А НЕ НАЛАШТУВАННЯ reconcile-sources.
//
// Той прохід зіставляє рядки з РІЗНИХ джерел за назвою й відстанню —
// тобто здогадується. Тут здогадуватись нема про що: `osmium export`
// віддає замкнену лінію двічі, і номер площі рахується арифметично
// (CAMP-253):
//
//     area = way × 2            для замкненої лінії
//     area = relation × 2 + 1   для мультиполігона
//
// Отже `a299493572` і `w149746786` — це ОДИН обʼєкт за побудовою, а не
// схожа пара. Жодного порогу тут не потрібно, і жоден поріг не зробив
// би це певнішим.
//
// 🔴 І САМЕ ТОМУ ВІДСТАНЬ ТУТ НІЧОГО НЕ ВИРІШУЄ. Заміряно на цих 844
// парах: медіана між двома рядками одного обʼєкта — 88 м, 95-й
// перцентиль 307 м, максимум 831 м, і сім пар далі за 400 м. Площа
// зберігається центром полігона, лінія — своєю точкою; розбіжність у
// сотні метрів тут норма, а не підозра. Поріг за відстанню відкинув би
// справжні тотожності.
//
// 🔴 ПРО БЕЗІМЕННІ. match.ts каже: безіменного кандидата ніколи не
// зливати автоматично, хоч би як близько. Це правило захищає від
// «щось безіменне за 40 м» — тобто там, де доказом є назва. Тут доказом
// є номер обʼєкта, і назва не бере участі взагалі. Заміряно: 552 з 844
// пар безіменні з обох боків, 292 мають однакову назву, різних назв
// немає жодної.

import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';

export const RULE_ID = 'osm-area-id';

/**
 * Номер обʼєкта, з якого побудовано цю площу.
 *
 * Повертає `null` для всього, що не є площею, — бо відмовитись від
 * того, чого не розумієш, дешевше за здогад.
 */
export function sourceOfArea(osmRef: string | null): string | null {
  if (!osmRef || osmRef[0] !== 'a') return null;
  const rest = osmRef.slice(1);
  if (!/^[0-9]+$/.test(rest)) return null;
  const n = BigInt(rest);
  return n % 2n === 0n ? `w${n / 2n}` : `r${(n - 1n) / 2n}`;
}

const SELF_TEST: [string, string | null, string | null][] = [
  ['замкнена лінія: a = w × 2', sourceOfArea('a299493572'), 'w149746786'],
  ['мультиполігон: a = r × 2 + 1', sourceOfArea('a101'), 'r50'],
  ['нуль — теж парне', sourceOfArea('a0'), 'w0'],
  [
    'велике число не ламає арифметику',
    sourceOfArea('a2526792764'),
    'w1263396382',
  ],
  ['не площа — не наша справа', sourceOfArea('w123'), null],
  ['вузол — не наша справа', sourceOfArea('n123'), null],
  ['порожньо', sourceOfArea(null), null],
  ['сміття замість числа', sourceOfArea('aXYZ'), null],
  ['🔴 дробове не приймаємо мовчки', sourceOfArea('a12.5'), null],
];

// 🔴 Усе нижче — лише коли файл ЗАПУЩЕНО, а не імпортовано.
//
// check-script-entrypoints.mjs завалив на цьому CI, і це вже ДРУГИЙ раз
// за добу: та сама помилка була в match-keyless.mjs кілька годин тому.
// Той, хто імпортує sourceOfArea, не має отримати ані прогін тестів,
// ані process.exit() лише тому, що в argv випадково трапився прапорець.
const isMain = require.main === module;

if (isMain && process.argv.includes('--self-test')) {
  let failed = 0;
  for (const [what, got, want] of SELF_TEST) {
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} ${what} (чекав ${want}, дало ${got})`);
  }
  console.log(
    failed
      ? `\n::error::самоперевірка впала на ${failed} випадках`
      : `\n✓ self-test passed: ${SELF_TEST.length} cases`,
  );
  process.exit(failed ? 1 : 0);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const predictAt = process.argv.indexOf('--predict');
  const predictFile = predictAt >= 0 ? process.argv[predictAt + 1] : null;

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // Пари будує база, бо тотожність — це арифметика над ключем, і
    // тягнути 32 413 рядків у памʼять заради неї нема сенсу.
    const { rows } = await db.query<{
      aid: string;
      bid: string;
      aref: string;
      bref: string;
      metres: string;
      linked: boolean;
      primary_taken: boolean;
      secondary_taken: boolean;
    }>(`
      SELECT a.id AS aid, b.id AS bid, a.osm_ref AS aref, b.osm_ref AS bref,
             round(ST_Distance(a.location::geography, b.location::geography))::text AS metres,
             EXISTS (
               SELECT 1 FROM spot_links l
                WHERE l.unlinked_at IS NULL
                  AND ((l.primary_id = a.id AND l.secondary_id = b.id)
                    OR (l.primary_id = b.id AND l.secondary_id = a.id))
             ) AS linked,
             -- 🔴 БІЛЬШЕ НЕ БЛОКУЄ, і історія варта рядка.
             --
             -- Колись idx_spot_links_primary_live був UNIQUE (primary_id)
             -- WHERE unlinked_at IS NULL, тож площа, яка вже склала в
             -- себе рядок DATAtourisme, не могла скласти ще й свою лінію.
             -- Перший прогін цього не врахував: передбачення обіцяло
             -- 844, база прийняла 828, і звірка це спіймала.
             --
             -- CAMP-281 зняв унікальність, бо кемпінг справді буває
             -- трьома рядками, а детермінізм тепер тримає повний порядок
             -- у linkedSecondariesJoin, а не заборона другого рядка.
             -- Отже це поле лишається як ЗВЕДЕННЯ — видно, що площа вже
             -- щось несе, — але воно більше не відмова.
             --
             -- 🔴 І жодних бектиків у цьому коментарі: він усередині
             -- шаблонного рядка. Сусідній reconcile-sources.ts попереджає
             -- про це прямо, бо репозиторій уже ламав так збірку двічі.
             -- Я зламав утретє, а потім і вчетверте.
             --
             EXISTS (
               SELECT 1 FROM spot_links l2
                WHERE l2.unlinked_at IS NULL AND l2.primary_id = a.id
             ) AS primary_taken,
             EXISTS (
               SELECT 1 FROM spot_links l3
                WHERE l3.unlinked_at IS NULL AND l3.secondary_id = b.id
             ) AS secondary_taken
        FROM camping_spots a
        JOIN camping_spots b
          ON b.osm_ref = CASE
               WHEN (substring(a.osm_ref from 2)::bigint) % 2 = 0
                 THEN 'w' || ((substring(a.osm_ref from 2)::bigint) / 2)::text
                 ELSE 'r' || (((substring(a.osm_ref from 2)::bigint) - 1) / 2)::text
             END
       WHERE a.osm_ref ~ '^a[0-9]+$'
       ORDER BY a.osm_ref
    `);

    const linked = rows.filter((r) => r.linked);
    // Відмовляє тільки вторинний бік: idx_spot_links_secondary_live
    // лишився UNIQUE, бо рядок не може бути складеним двічі.
    const blocked = rows.filter((r) => !r.linked && r.secondary_taken);
    const todo = rows.filter((r) => !r.linked && !r.secondary_taken);
    console.log(`  пар «площа ↔ лінія»: ${rows.length}`);
    console.log(`  уже зв'язані:        ${linked.length}`);
    console.log(`  до зв'язування:      ${todo.length}`);
    console.log(
      `  🔴 заблоковані (рядок уже складений деінде): ${blocked.length}`,
    );
    for (const r of blocked.slice(0, 20)) {
      console.log(`      ${r.aref} ↔ ${r.bref}`);
    }

    // 🔴 Первинний — ЗАВЖДИ площа. Не «той, у кого чистіший слаг»:
    // заміряно, що суфікс `-2` лежить на лінії лише в 268 парах із 844,
    // а в решті обидва слаги службові (`spot-<ref>`) або суфіксовані.
    // Правило «площа первинна» збігається з тим, що вже робить
    // нормалізатор імпорту (RANK: площа вища за лінію), тож сайт і
    // імпорт говорять одне й те саме.
    const fingerprint = (r: (typeof todo)[number]) =>
      `${r.aid}|${r.bid}|${r.metres}`;
    const predicted = todo.map(fingerprint).sort();

    if (predictFile && !apply) {
      writeFileSync(predictFile, JSON.stringify(predicted, null, 0));
      console.log(
        `\n  передбачення записано: ${predicted.length} пар → ${predictFile}`,
      );
    }

    if (!apply) {
      console.log('\n(сухий прогін — нічого не записано. Додайте --apply.)');
      return;
    }

    await db.query('BEGIN');
    let written = 0;
    const refused: string[] = [];
    for (const r of todo) {
      // Савпойнт на рядок — та сама причина, що й у reconcile-sources:
      // ON CONFLICT покриває ОДИН індекс, а таблиця має три.
      await db.query('SAVEPOINT one_link');
      try {
        const res = await db.query(
          `INSERT INTO spot_links (primary_id, secondary_id, metres, name_similarity, rule)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (primary_id, secondary_id) DO NOTHING`,
          [r.aid, r.bid, Number(r.metres), 1, RULE_ID],
        );
        written += res.rowCount ?? 0;
        await db.query('RELEASE SAVEPOINT one_link');
      } catch (err) {
        await db.query('ROLLBACK TO SAVEPOINT one_link');
        refused.push(`${r.aref} ↔ ${r.bref}: ${(err as Error).message}`);
      }
    }
    await db.query('COMMIT');
    console.log(
      `\n✓ ${written} зв'язків записано. Жодного рядка кемпінгу не змінено.`,
    );

    if (refused.length > 0) {
      console.log(`\n⚠ ${refused.length} відмовлено базою:`);
      for (const r of refused.slice(0, 20)) console.log(`    ${r}`);
    }

    if (predictFile) {
      const expected = new Set<string>(
        JSON.parse(readFileSync(predictFile, 'utf8')),
      );
      const live = await db.query<{ f: string }>(
        `SELECT primary_id || '|' || secondary_id || '|' || round(metres)::text AS f
           FROM spot_links WHERE rule = $1 AND unlinked_at IS NULL`,
        [RULE_ID],
      );
      const actual = new Set<string>(live.rows.map((x) => String(x.f)));
      const missing = [...expected].filter((f) => !actual.has(f));
      const extra = [...actual].filter((f) => !expected.has(f));
      if (missing.length === 0 && extra.length === 0) {
        console.log(
          `\n✓ звірено з передбаченням: ${expected.size} пар, збіг повний`,
        );
      } else {
        console.log(
          `\n::error::передбачення й факт розійшлись — ` +
            `${missing.length} не записані, ${extra.length} зайві`,
        );
        process.exitCode = 1;
      }
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
