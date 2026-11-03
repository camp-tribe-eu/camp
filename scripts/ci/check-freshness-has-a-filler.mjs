#!/usr/bin/env node
// Бюджет протухання без розкладу — це обіцянка, яку нема кому виконати.
//
//   node scripts/ci/check-freshness-has-a-filler.mjs
//   node scripts/ci/check-freshness-has-a-filler.mjs --self-test
//
// 🔴 ЦЕЙ СТОРОЖ ІСНУЄ ЧЕРЕЗ ТРИ ТИЖНІ ЧЕРВОНОГО, ЗАМІРЯНІ 03.11.2026.
//
//   osm_route_poi   2 274 449 рядків, 18,5 діб, бюджет 10 діб
//   spot_links          4 459 рядків, 22,7 доби, бюджет 10 діб
//
// Обидві протухли не тому, що збирач упав, а тому, що НІХТО ЇХ НЕ
// НАПОВНЮВАВ: юніт POI лежав у репозиторії нерозкладеним, а юніта
// звʼязків не існувало — хоч рецепт і стояв написаний у
// `docs/data-path-to-production.md` словами «юніта ще немає».
//
// 🔴 ЩО САМЕ ТУТ СТЕРЕЖЕТЬСЯ, І ЦЕ НЕ «ЧИ СВІЖІ ДАНІ».
//
// Свіжість міряє `check-data-freshness.mjs` на машині, по базі. Цей
// сторож питає інше й на іншому матеріалі — лише по репозиторію:
//
//   чи є в джерела хоч щось, що МОЖЕ його наповнити вчасно?
//
// Бюджет у 10 діб при тижневому таймері виконуваний. Бюджет у 10 діб
// без таймера — ні, і червоніти він почне рівно на одинадцяту добу,
// щоранку, назавжди. Тривога, яка не може стати зеленою, за тиждень
// перестає бути тривогою.
//
// 🔴 І ЧОМУ «РУКАМИ» — ЦЕ ВІДПОВІДЬ, А НЕ ДІРКА. Джерело без розкладу
// дозволене, але мусить СКАЗАТИ ЦЕ СЛОВАМИ (`manual`). Різниця між
// «ми вирішили запускати руками» і «ми забули» не видна в даних — вона
// видна лише в тексті, якого ніхто не написав.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DB_SOURCES } from './check-data-freshness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UNITS = join(ROOT, 'infra', 'systemd');

/**
 * Період таймера в годинах із рядка `OnCalendar=`.
 *
 * 🔴 РОЗПІЗНАЄМО ТРИ ФОРМИ Й ВІДМОВЛЯЄМО НА ЧЕТВЕРТІЙ. Повний
 * календар systemd сюди не поміститься, а розбір, що «майже розуміє»,
 * дасть число, яке виглядає заміром і ним не є. Невідома форма — це
 * скарга з текстом рядка, а не здогад.
 */
export function periodHours(onCalendar) {
  const s = String(onCalendar ?? '').trim();
  if (/^\*-\*-\* \*:\d{2}:\d{2}/.test(s)) return 1; // щогодини
  if (/^\*-\*-\* \d{2}:\d{2}:\d{2}/.test(s)) return 24; // щодня
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \*-\*-\* \d{2}:\d{2}:\d{2}/.test(s))
    return 7 * 24; // щотижня
  return null;
}

/** Рядок `OnCalendar=` з файла таймера, або `null`. */
export function onCalendarOf(unit, dir = UNITS) {
  const file = join(dir, `${unit}.timer`);
  if (!existsSync(file)) return null;
  const m = /^OnCalendar=(.+)$/m.exec(readFileSync(file, 'utf8'));
  return m ? m[1].trim() : null;
}

/** Усі претензії до переліку джерел, або порожній масив. */
export function faults(sources, read = onCalendarOf) {
  const out = [];
  if (!Array.isArray(sources) || sources.length === 0) {
    return ['перелік джерел порожній — сторож втратив предмет'];
  }
  for (const s of sources) {
    const at = s?.table ?? s?.name ?? '(без імені)';
    const budget =
      typeof s?.budgetHours === 'function' ? s.budgetHours() : s?.budgetHours;
    if (!Number.isFinite(budget) || budget <= 0) {
      out.push(`${at}: бюджет не число — порівнювати нема з чим`);
      continue;
    }
    const hasUnit = typeof s?.unit === 'string' && s.unit !== '';
    if (!hasUnit) {
      // 🔴 Відсутність розкладу дозволена, мовчазна відсутність — ні.
      if (typeof s?.manual !== 'string' || s.manual.trim().length < 20) {
        out.push(
          `${at}: немає ні юніта, ні написаного пояснення. Бюджет ${budget} год ` +
            'нема кому виконати, і тривога червонітиме назавжди',
        );
      }
      continue;
    }
    const cal = read(s.unit);
    if (cal === null) {
      out.push(
        `${at}: названо юніт «${s.unit}», а infra/systemd/${s.unit}.timer ` +
          'не існує або не має OnCalendar — саме так POI протух на 18,5 діб',
      );
      continue;
    }
    const period = periodHours(cal);
    if (period === null) {
      out.push(`${at}: не розібрано OnCalendar «${cal}» у ${s.unit}.timer`);
      continue;
    }
    // 🔴 СУВОРО МЕНШЕ, А НЕ «НЕ БІЛЬШЕ». Рівність означає, що дані
    // протухають рівно в мить наступного запуску: будь-яка затримка
    // таймера дає червоне, і причина буде не в даних.
    if (period >= budget) {
      out.push(
        `${at}: таймер ${s.unit} ходить раз на ${period} год, а бюджет ${budget} год. ` +
          'Джерело протухатиме раніше, ніж його встигнуть оновити',
      );
    }
  }
  return out;
}

function main() {
  const bad = faults(DB_SOURCES);
  if (bad.length) {
    for (const b of bad) console.error(`✗ ${b}`);
    console.error(
      `\n✗ check-freshness-has-a-filler: ${bad.length} джерел(а) з бюджетом, ` +
        'який нема кому виконати',
    );
    process.exit(1);
  }
  const scheduled = DB_SOURCES.filter((s) => s.unit).length;
  console.log(
    `✓ check-freshness-has-a-filler: ${scheduled} із ${DB_SOURCES.length} джерел ` +
      'мають таймер частіший за бюджет, решта пояснені словами',
  );
}

function selfTest() {
  const read = (u) =>
    ({
      weekly: 'Tue *-*-* 04:30:00 UTC',
      daily: '*-*-* 05:00:00 UTC',
      hourly: '*-*-* *:17:00 UTC',
      odd: 'monthly',
    })[u] ?? null;
  const cases = [
    ['щогодини', periodHours('*-*-* *:17:00 UTC'), 1],
    ['щодня', periodHours('*-*-* 05:00:00 UTC'), 24],
    ['щотижня', periodHours('Tue *-*-* 04:30:00 UTC'), 168],
    ['🔴 незнайома форма — null, а не здогад', periodHours('monthly'), null],
    ['порожньо — null', periodHours(''), null],
    ['справжній перелік чистий', faults(DB_SOURCES).length, 0],
    [
      'тижневий таймер під бюджет у 10 діб — добре',
      faults([{ table: 't', budgetHours: 240, unit: 'weekly' }], read).length,
      0,
    ],
    [
      '🔴 таймер РІДШИЙ за бюджет — скарга',
      faults([{ table: 't', budgetHours: 100, unit: 'weekly' }], read).length,
      1,
    ],
    [
      '🔴 РІВНІСТЬ — теж скарга: протухне в мить запуску',
      faults([{ table: 't', budgetHours: 168, unit: 'weekly' }], read).length,
      1,
    ],
    [
      '🔴 юніт названо, таймера немає — скарга',
      faults([{ table: 't', budgetHours: 240, unit: 'ghost' }], read).some((f) =>
        f.includes('не існує'),
      ),
      true,
    ],
    [
      '🔴 ні юніта, ні слів — скарга',
      faults([{ table: 't', budgetHours: 240 }], read).length,
      1,
    ],
    [
      'руками, але пояснено — не скарга',
      faults(
        [{ table: 't', budgetHours: 240, unit: null, manual: 'запускається руками, бо джерело оновлюється раз на рік' }],
        read,
      ).length,
      0,
    ],
    [
      '🔴 відмовка на два слова не рахується за пояснення',
      faults([{ table: 't', budgetHours: 240, unit: null, manual: 'руками' }], read).length,
      1,
    ],
    [
      'бюджет-функція читається',
      faults([{ table: 't', budgetHours: () => 240, unit: 'weekly' }], read).length,
      0,
    ],
    [
      'бюджет не число — скарга, а не аварія',
      faults([{ table: 't', budgetHours: null, unit: 'weekly' }], read).length,
      1,
    ],
    ['порожній перелік — скарга, а не тиша', faults([], read).length, 1],
    [
      '🔴 незнайомий OnCalendar — скарга з текстом рядка',
      faults([{ table: 't', budgetHours: 240, unit: 'odd' }], read).some((f) =>
        f.includes('monthly'),
      ),
      true,
    ],
  ];
  let pass = 0;
  let fail = 0;
  for (const [name, got, want] of cases) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++;
    else {
      fail++;
      console.error(`  ✗ ${name}: «${JSON.stringify(got)}», мало бути «${JSON.stringify(want)}»`);
    }
  }
  console.log(`check-freshness-has-a-filler self-test: ran ${pass + fail}, passed ${pass}, failed ${fail}`);
  if (fail) process.exit(1);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
