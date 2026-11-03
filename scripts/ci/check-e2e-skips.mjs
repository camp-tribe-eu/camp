#!/usr/bin/env node
// Тест, що відмовився бігти, — це зелене CI ні про що. CAMP-134.
//
//   node scripts/ci/check-e2e-skips.mjs
//   node scripts/ci/check-e2e-skips.mjs --update     # опустити бюджет
//   node scripts/ci/check-e2e-skips.mjs --self-test
//
// 🔴 ЦЕ ТРЕТІЙ НАПРЯМОК ТІЄЇ САМОЇ КАРТКИ, І ВІН БУВ НАЗВАНИЙ, АЛЕ НЕ
// ЗМІРЯНИЙ. `docs/scale-check.md` писав 27.09.2026:
//
//   «tests/e2e has 23 test.skip sites … Until then, CI can still go
//    green over an e2e test that declined to run.»
//
// 🔴 І САМЕ «23» НЕ ВІДТВОРЮЄТЬСЯ. Цим сторожем, напущеним на той самий
// коміт, де рядок зʼявився (1c74ae1), місць **29**, а не 23. Тобто число
// в документі міряли лінійкою, якої ніхто не записав, — рівно те, про що
// каже закон «число бреше, поки його не розсудив хтось ззовні».
//
// Однією лінійкою, цим файлом:
//
//   1c74ae1  файлів e2e 23, місць пропуску 29
//   сьогодні файлів e2e 46, місць пропуску 38
//
// Файлів удвічі більше, пропусків +9. Тобто тести росли швидше за
// пропуски — але ніхто цього не знав, бо ніхто не рахував. Речення в
// документі не рахує нічого; ось число, яке рахує.
//
// 🔴 ЧОМУ ПРОСТО ЧИСЛО, А НЕ РОЗБІР «ЦЕЙ ПРОПУСК ЧЕСНИЙ, А ЦЕЙ НІ».
//
// Пропуски тут двох родин:
//
//   середовище — «WebKit on Linux cannot photograph a canvas»,
//                «no WebGL2 in this browser». Чесні: браузер справді
//                не вміє, і жодні дані цього не змінять.
//   дані       — «this build holds no gone campsites», «no open-data
//                campsite in this build», «Nothing paginates at the
//                current data volume». ОЦЕ предмет картки: тест стоїть
//                осторонь, бо фікстурі бракує випадку.
//
// Розрізнити їх автоматично можна лише вгадуванням за текстом причини —
// а розбір, що «майже розуміє», дає число, яке виглядає заміром і ним
// не є. Тому стережеться СУМА, вона може лише меншати, а розкладку за
// причинами сторож друкує, щоб наступний бачив, які з них про дані.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const E2E = join(ROOT, 'apps', 'web', 'tests', 'e2e');
export const BUDGET_FILE = join(ROOT, 'scripts', 'ci', 'e2e-skip-budget.json');

/** Усі `.ts` під теками e2e, за алфавітом. */
export function specFiles(dir = E2E) {
  const out = [];
  const walk = (d) => {
    // 🔴 Теки немає — це теж «сторож втратив предмет», а не нуль пропусків.
    // Без цього `readdirSync` кидав стек, і причина тонула в ньому.
    let names;
    try {
      names = readdirSync(d).sort();
    } catch (e) {
      throw new Error(`не прочитати ${d}: ${e.code ?? e.message} — предмет заміру зник`);
    }
    for (const name of names) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Місця `test.skip` у тексті.
 *
 * 🔴 Рахуємо ВХОДЖЕННЯ, а не рядки: `test.skip(` з переносом аргументів
 * займає кілька рядків, і підрахунок рядків дав би менше, ніж є.
 */
export const SKIP_CALL =
  /\b(?:testInfo\.(?:skip|fixme)|test\.describe\.(?:skip|fixme)|test\.(?:skip|fixme))\s*\(/g;

export function skipsIn(source) {
  return [...source.matchAll(new RegExp(SKIP_CALL.source, 'g'))].length;
}

// 🔴 ЦЕЙ ПЕРЕЛІК ФОРМ — НЕ ПРИКРАСА, ЙОГО БРАК КОШТУВАВ ЖИВОГО ОБХОДУ.
//
// Перша версія знала лише `test.skip(`. Рецензія знайшла в дереві ДВА
// справжні пропуски, яких вона не бачила:
//
//   apps/web/tests/e2e/error-reporting.spec.ts:72   testInfo.skip(…)
//   apps/web/tests/e2e/rate-limit.spec.ts:75        testInfo.skip(…)
//
// Кожен знімає цілий `describe` на пʼяти проєктах із шести. Тобто
// «36» було насправді 38, а бюджет мав обхід: дописаний `testInfo.skip(`
// проходив із exit 0, той самий пропуск як `test.skip(` — ні. Сторож,
// повз якого є дорога, стереже лише тих, хто про неї не знає.
//
// Гірше: мій же самотест це ОСВЯЧУВАВ випадком «чужий skip не
// рахується», тобто доводив, що сліпота — задум. Межа, названа в коді
// (про коментарі), була не та, що боліла.

// 🔴 МЕЖА ЦЬОГО ІНСТРУМЕНТА, НАЗВАНА, А НЕ ЗАМОВЧАНА.
//
// Це пошук по тексту, а не розбір JS. Він НЕ побачить різниці між живим
// викликом і `test.skip(` всередині коментаря. Заміряно на справжньому
// дереві: такий випадок сьогодні один — `site-map-attribution.spec.ts:49`
// згадує «`test.skip`» у коментарі БЕЗ дужки, і сторож його не рахує, а
// `grep` по рядках рахував і давав 37 замість 36.
//
// Будувати тут розбір JS коштувало б дорожче за дефект: помилка в бік
// «порахував зайве» лише зробить бюджет суворішим, а в бік «не порахував»
// неможлива, поки виклик пишуть звичайно. Хибне спрацювання коштує одного
// коміту з `--update`; пропущене зростання коштує тесту, що мовчки не біг.

/** Причина пропуску, як її написали, — для розкладки у виводі. */
export function reasonsIn(source) {
  const out = [];
  for (const m of source.matchAll(
    /\btest\.(?:skip|fixme)\s*\(([\s\S]{0,220}?)\)\s*;/g,
  )) {
    const args = m[1].replace(/\s+/g, ' ').trim();
    const quoted = /["'`]([^"'`]{3,})["'`]/.exec(args);
    out.push(quoted ? quoted[1] : args.slice(0, 60));
  }
  return out;
}

export function tally(files, read = (f) => readFileSync(f, 'utf8')) {
  let total = 0;
  const reasons = new Map();
  for (const f of files) {
    const src = read(f);
    total += skipsIn(src);
    for (const r of reasonsIn(src)) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  return { total, reasons };
}

export function verdict(total, budget) {
  if (total > budget) return { ok: false, why: 'grew' };
  if (total < budget) return { ok: true, why: 'shrank' };
  return { ok: true, why: 'same' };
}

// 🔴 ЗІПСОВАНИЙ ФАЙЛ БЮДЖЕТУ — ЦЕ ЗБІЙ, А НЕ «БЮДЖЕТ undefined».
//
// Рецензія: з ключем `max_skips` замість `maxSkips` сторож друкував
// «✓ пропусків у e2e 38, бюджет undefined: не виріс» і виходив 0 —
// бо `38 > undefined` це `false`. А `--update` на тому ж файлі писав
// «✓ бюджет опущено: undefined → 38», тобто ПІДНІМАВ його до 38.
// Зіпсований файл спершу давав зелене, а потім сам себе «лікував»
// угору. Порівняння з `undefined` мовчазно хибне в обидва боки.
export function budgetFrom(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`бюджет не читається як JSON: ${e.message}`);
  }
  const n = parsed?.maxSkips;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new Error(
      `у бюджеті немає числа maxSkips (прочитано ${JSON.stringify(n)}) — ` +
        'порівняння з ним було б мовчазно хибним',
    );
  }
  return n;
}

function readBudget() {
  return budgetFrom(readFileSync(BUDGET_FILE, 'utf8'));
}

function main(argv) {
  const files = specFiles();
  // 🔴 Нуль файлів — це збій пошуку, а не «пропусків немає».
  if (files.length === 0) {
    console.error('✗ у tests/e2e не знайдено жодного .ts — сторож втратив предмет');
    return 1;
  }
  const { total, reasons } = tally(files);
  if (argv.includes('--update')) {
    const cur = readBudget();
    if (total > cur) {
      console.error(`✗ --update лише ОПУСКАЄ бюджет: зараз ${total}, у файлі ${cur}`);
      return 1;
    }
    writeFileSync(BUDGET_FILE, `${JSON.stringify({ maxSkips: total }, null, 2)}\n`);
    console.log(`✓ бюджет опущено: ${cur} → ${total}`);
    return 0;
  }
  const budget = readBudget();
  const v = verdict(total, budget);
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [why, n] of top) console.log(`  ${String(n).padStart(2)} × ${why}`);
  if (!v.ok) {
    console.error(
      `\n✗ пропусків у e2e ${total}, бюджет ${budget}. Тест, що відмовився бігти, ` +
        'не відрізнити від тесту, що пройшов: CI зеленіє над випадком, якого ніхто не перевірив. ' +
        'Якщо пропуск справді потрібен — опусти щось інше й поясни в коміті.',
    );
    return 1;
  }
  console.log(
    v.why === 'shrank'
      ? `\n✓ пропусків ${total} при бюджеті ${budget} — менше. Опусти бюджет: --update`
      : `\n✓ пропусків у e2e ${total}, бюджет ${budget}: не виріс (файлів ${files.length})`,
  );
  return 0;
}

function selfTest() {
  const cases = [
    ['рахує просте місце', skipsIn('test.skip(!gone, "x");'), 1],
    ['і з переносом аргументів', skipsIn('test.skip(\n  a,\n  "b",\n);'), 1],
    ['🔴 рахує ВХОДЖЕННЯ, а не рядки', skipsIn('test.skip(\n a,\n "b");\ntest.skip(c,"d");'), 2],
    ['fixme теж', skipsIn('test.fixme(a, "b");'), 1],
    ['чужий skip не рахується', skipsIn('page.skip(); foo.test.skipped(x);'), 0],
    ['🔴 testInfo.skip — справжній пропуск (error-reporting.spec.ts:72)',
      skipsIn('testInfo.skip(testInfo.project.name !== "chromium-desktop");'), 1],
    ['🔴 testInfo.skip із причиною (rate-limit.spec.ts:75)',
      skipsIn('    testInfo.skip(\n      a !== b,\n      "server behaviour",\n    );'), 1],
    ['🔴 test.describe.skip знімає цілий блок — теж місце',
      skipsIn('test.describe.skip("усе це", () => {});'), 1],
    ['testInfo.fixme теж', skipsIn('testInfo.fixme(a, "b");'), 1],
    ['🔴 зіпсований ключ — збій, а не «бюджет undefined»',
      (() => { try { budgetFrom('{"max_skips": 36}'); return 'пройшло'; }
               catch { return 'впало'; } })(), 'впало'],
    ['🔴 не-JSON — теж збій',
      (() => { try { budgetFrom('{'); return 'пройшло'; } catch { return 'впало'; } })(), 'впало'],
    ['справний бюджет читається', budgetFrom('{"maxSkips": 38}'), 38],
    ['нуль — законний бюджет', budgetFrom('{"maxSkips": 0}'), 0],
    ['🔴 згадка без дужки (справжній випадок з site-map-attribution) — не місце',
      skipsIn('// ДИФЕРЕНЦІЙНО, а не `test.skip`: там, де мапи бути не може'), 0],
    ['а от у коментарі з дужкою — порахується, і це відома межа',
      skipsIn('// колись тут було test.skip(x, "y");'), 1],
    ['порожній текст — нуль', skipsIn(''), 0],
    ['причину видно', reasonsIn('test.skip(!gone, "this build holds no gone campsites");')[0],
      'this build holds no gone campsites'],
    ['🔴 зростання — провал', verdict(38, 37).ok, false],
    ['рівність — не провал', verdict(37, 37).ok, true],
    ['зменшення — не провал, і це сказано', verdict(36, 37).why, 'shrank'],
    ['сума по файлах складається', tally(['a', 'b'], () => 'test.skip(x,"y");').total, 2],
    // 🔴 Якір: сторож міряє СПРАВЖНЮ теку, а не порожнечу.
    ['справжніх файлів e2e більше десяти', specFiles().length > 10, true],
    ['і в них є пропуски, інакше стерегти нічого', tally(specFiles()).total > 0, true],
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
  console.log(`check-e2e-skips self-test: ran ${pass + fail}, passed ${pass}, failed ${fail}`);
  return fail === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  try {
    process.exit(main(argv));
  } catch (e) {
    // Стек тут нічого не додає: причина завжди в одному файлі бюджету.
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
