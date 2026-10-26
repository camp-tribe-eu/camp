#!/usr/bin/env node
// Мітки кешу й `dynamicParams = false` несумісні — і мітки мусять лишатись
// порожніми, поки причину не знято.
//
// 🔴 ЗАМІРЯНО НА ПРОДІ 26.10.2026. Один `revalidateTag('navigation')`
// перевів 55 269 сторінок кемпінгів і 1 256 гайдів у 404 ДО ПЕРЕЗАПУСКУ
// СЛУЖБИ. Мітка `pages` так само клала `/legal/*`. Гине рівно те, що
// мітку споживало; меню живе в кореневому макеті, тож його мітку їсть
// кожна сторінка.
//
// 🔴 І ОЧЕВИДНИЙ РЕМОНТ ХИБНИЙ. Поставити `dynamicParams = true` я вже
// пробував і відкотив: це ламає CAMP-73. Заміряно на `/blog/<неіснуючий>`,
// який уже має `true`: увесь файл 34 399 байт і рядки 404 в ньому Є, але
// БЕЗ `<script>` лишається 1 302 байти і НЕ ЛИШАЄТЬСЯ НІЧОГО. Тобто вміст
// 404 їде в RSC-навантаженні, і без JS сторінка порожня — для робота теж.
//
// Тому сторож стежить за ОБОМА боками: і щоб `false` не прибрали, і щоб
// мітку не повернули, не знявши причини.
import { readFileSync } from 'node:fs';

const SELF_TEST = process.argv.includes('--self-test');

/** Чисте ядро: приймає {tagsSource}, віддає перелік скарг. */
export function audit({ tagsSource } = {}) {
  const problems = [];
  if (typeof tagsSource !== 'string' || tagsSource.length === 0) {
    problems.push('перелік міток не прочитано — збір зламався, а не «все чисто»');
    return problems;
  }
  // Рядки виду ["navigation", NAV_TAG] всередині ALLOWED_TAGS.
  const body = tagsSource.slice(tagsSource.indexOf('ALLOWED_TAGS'));
  const entries = [...body.matchAll(/\[\s*["']([^"']+)["']\s*,/g)].map((m) => m[1]);
  for (const t of entries) {
    problems.push(
      `мітку «${t}» повернуто в ALLOWED_TAGS — її скидання покладе сторінки, ` +
        'що її споживають, у 404 до перезапуску служби (CAMP-396)',
    );
  }
  return problems;
}

if (SELF_TEST) {
  const cases = [
    ['порожній перелік — чисто', { tagsSource: 'export const ALLOWED_TAGS = new Map([\n]);' }, 0, null],
    ['мітку повернули — ловиться', { tagsSource: 'ALLOWED_TAGS = new Map([\n  ["navigation", NAV_TAG],\n]);' }, 1, 'navigation'],
    ['дві мітки — дві скарги', { tagsSource: 'ALLOWED_TAGS = new Map([["navigation",A],["pages",B]]);' }, 2, 'pages'],
    ['згадка у коментарі ВИЩЕ переліку не рахується', { tagsSource: '// колись тут було ["navigation", X]\nexport const ALLOWED_TAGS = new Map([\n]);' }, 0, null],
    ['джерело не прочитано — це провал', {}, 1, 'збір зламався'],
  ];
  let pass = 0, fail = 0;
  for (const [name, input, want, mustSay] of cases) {
    const got = audit(input);
    const ok = got.length === want && (!mustSay || got.some((p) => p.includes(mustSay)));
    if (ok) pass++;
    else { fail++; console.error(`  ✗ ${name}: скарг ${got.length}, чекали ${want} — ${got.join(' | ')}`); }
  }
  console.log(`check-dynamic-params self-test: ran ${pass + fail}, passed ${pass}, failed ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

const problems = audit({
  tagsSource: readFileSync('apps/web/src/lib/revalidate-tags.ts', 'utf8'),
});
for (const p of problems) console.error(`✗ ${p}`);
if (problems.length === 0) {
  console.log('✓ check-dynamic-params: ALLOWED_TAGS порожній — жодна мітка не може покласти каталог');
}
process.exit(problems.length === 0 ? 0 : 1);
