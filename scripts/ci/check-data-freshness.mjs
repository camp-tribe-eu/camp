#!/usr/bin/env node
// Дані, які протухають мовчки, — це сайт, що бреше читачеві.
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ, І ЧОМУ САМЕ ТАК. Заміряно 25.10.2026: пожежі були
// старші за свій бюджет на 27 днів, ціни пального на 34, посуха на 44.
// Розкладу для них не існувало ВЗАГАЛІ — файли згенерували один раз
// 05.10 і відтоді не чіпали. Сайт при цьому чесно писав читачеві «No
// fresh wildfire data» і «These prices are out of date» — тобто код
// відпрацював правильно, а не помітив ніхто.
//
// 🔴 БЮДЖЕТИ НЕ ВИГАДАНІ ТУТ. Вони вже оголошені в коді, який їх
// споживає, і беруться звідти:
//   wildfires  FRESH_FOR_HOURS = 72   (lib/wildfires.ts:120)
//   fuel       STALE_AFTER_DAYS = 21  (lib/fuel.ts:86)
// Друга копія числа розійшлася б із першою мовчки — саме той дефект,
// проти якого стоять решта наших сторожів.
import { readFileSync } from 'node:fs';

const SELF_TEST = process.argv.includes('--self-test');

/** Чисте ядро: приймає світ, віддає перелік скарг. Самотест міряє його. */
export function audit(files, now) {
  const problems = [];
  for (const f of files) {
    if (f.stamp === null || f.stamp === undefined) {
      problems.push(`${f.name}: мітки часу немає — вік невідомий, отже недоведений`);
      continue;
    }
    const t = Date.parse(f.stamp);
    if (Number.isNaN(t)) {
      problems.push(`${f.name}: мітка «${f.stamp}» не читається як дата`);
      continue;
    }
    const hours = (now - t) / 36e5;
    if (hours < 0) {
      problems.push(`${f.name}: мітка в майбутньому (${f.stamp}) — годинник або збирач бреше`);
      continue;
    }
    if (hours > f.budgetHours) {
      const d = Math.floor(hours / 24);
      problems.push(
        `${f.name}: ${d} діб від ${f.stamp}, бюджет ${Math.round(f.budgetHours / 24)} діб`,
      );
    }
  }
  return problems;
}

function budgetFromSource(path, name) {
  const src = readFileSync(path, 'utf8');
  const m = src.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`не знайшов ${name} у ${path} — бюджет мусить жити там, де його читає код`);
  return Number(m[1]);
}

if (SELF_TEST) {
  const NOW = Date.parse('2026-10-25T00:00:00Z');
  const ok = (s) => new Date(NOW - s * 36e5).toISOString();
  let p = 0, f = 0;
  const t = (what, got, want) => {
    if (got === want) { p += 1; console.log(`  ✓ ${what}`); }
    else { f += 1; console.error(`  ✗ ${what}: ${got}, мало бути ${want}`); }
  };
  t('свіжий файл не скаржиться',
    audit([{ name: 'a', stamp: ok(10), budgetHours: 72 }], NOW).length, 0);
  t('протухлий ловиться',
    audit([{ name: 'a', stamp: ok(100), budgetHours: 72 }], NOW).length, 1);
  t('рівно на межі ще проходить',
    audit([{ name: 'a', stamp: ok(72), budgetHours: 72 }], NOW).length, 0);
  t('відсутня мітка ловиться',
    audit([{ name: 'a', stamp: null, budgetHours: 72 }], NOW).length, 1);
  t('нечитана мітка ловиться',
    audit([{ name: 'a', stamp: 'позавчора', budgetHours: 72 }], NOW).length, 1);
  t('🔴 мітка в МАЙБУТНЬОМУ ловиться',
    audit([{ name: 'a', stamp: ok(-50), budgetHours: 72 }], NOW).length, 1);
  t('дві поломки дають дві скарги',
    audit([{ name: 'a', stamp: ok(100), budgetHours: 72 },
           { name: 'b', stamp: null, budgetHours: 24 }], NOW).length, 2);
  console.log(`check-data-freshness self-test: ran ${p + f}, passed ${p}, failed ${f}`);
  process.exit(f === 0 ? 0 : 1);
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const FILES = [
  { name: 'wildfires.json',
    stamp: read('apps/web/src/data/wildfires.json')?.meta?.fetchedAt ?? null,
    budgetHours: budgetFromSource('apps/web/src/lib/wildfires.ts', 'FRESH_FOR_HOURS') },
  { name: 'fuel-prices.json',
    stamp: read('apps/web/src/data/fuel-prices.json')?.fetchedAt ?? null,
    budgetHours: budgetFromSource('apps/web/src/lib/fuel.ts', 'STALE_AFTER_DAYS') * 24 },
];

const problems = audit(FILES, Date.now());
if (problems.length > 0) {
  console.error('✗ Дані протухли:\n');
  for (const p of problems) console.error(`  🔴 ${p}`);
  console.error('\n  Сайт покаже читачеві «дані застаріли». Це не косметика:');
  console.error('  мапа з протухлими пожежами гірша за мапу без шару пожеж.');
  console.error('  Запусти збирач або перевір, чому розклад не спрацював.');
  process.exit(1);
}
console.log(`✓ дані свіжі: ${FILES.map((f) => f.name).join(', ')}`);
