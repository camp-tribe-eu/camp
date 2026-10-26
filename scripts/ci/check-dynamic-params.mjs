#!/usr/bin/env node
// `dynamicParams = false` несумісний зі скиданням кешу за міткою.
//
// 🔴 ЦЕ НЕ СМАК І НЕ СТИЛЬ. Заміряно на проді 26.10.2026: один виклик
// `revalidateTag('navigation')` поклав 55 269 сторінок кемпінгів і 1 256
// гайдів у 404 — ДО ПЕРЕЗАПУСКУ СЛУЖБИ. Мітка `pages` так само клала
// `/legal/*`, не чіпаючи решти: гине рівно те, що мітку споживало.
//
// Механізм названий документацією Next, не здогадом:
//   • під час перевалідації `generateStaticParams` НЕ викликається знову;
//   • ворота Next: `fallback === false && !isPrerendered → NoFallbackError`.
// Разом: знецінений запис нема з чого перевивести, і сторінка 404-ить.
//
// 🔴 ЧОМУ ПОВЕРНУТИ `false` БУДЕ СПОКУСЛИВО. У коді довго стояло
// обґрунтування CAMP-73: з `true` невідома адреса віддавала клієнтську
// оболонку помилки, порожню без JS. Засновку переміряно 26.10.2026 на
// Next 15.5.28: `/blog/<неіснуючий>` → HTTP 404 і 34 418 байт РОЗМІТКИ з
// «404» і «page is not here». Тобто ця ціна вже не стягується.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SELF_TEST = process.argv.includes('--self-test');

/** Чисте ядро: приймає [{file, text}], віддає перелік скарг. */
export function audit(files) {
  const problems = [];
  if (!Array.isArray(files) || files.length === 0) {
    problems.push('сторінок не знайдено жодної — обхід дерева зламався, а не «все чисто»');
    return problems;
  }
  for (const f of files) {
    if (/export\s+const\s+dynamicParams\s*=\s*false/.test(f.text)) {
      problems.push(
        `${f.file}: \`dynamicParams = false\` — будь-який revalidateTag, ` +
          'мітку якого споживає ця сторінка, покладе її в 404 до перезапуску служби (CAMP-396)',
      );
    }
  }
  return problems;
}

if (SELF_TEST) {
  const cases = [
    ['чисто', [{ file: 'a.tsx', text: 'export const dynamicParams = true;' }], 0, null],
    ['false ловиться', [{ file: 'b.tsx', text: 'export const dynamicParams = false;' }], 1, 'b.tsx'],
    ['пробіли не рятують', [{ file: 'c.tsx', text: 'export  const   dynamicParams =  false ;' }], 1, 'c.tsx'],
    ['згадка в коментарі НЕ ловиться', [{ file: 'd.tsx', text: '// колись тут був dynamicParams = false\nexport const dynamicParams = true;' }], 0, null],
    ['порожній обхід — це провал, а не чистота', [], 1, 'обхід дерева зламався'],
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

const ROOT = 'apps/web/src/app';
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });

const files = walk(ROOT).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
const problems = audit(files);
for (const p of problems) console.error(`✗ ${p}`);
if (problems.length === 0) {
  console.log(`✓ check-dynamic-params: ${files.length} сторінок, жодна не має dynamicParams = false`);
}
process.exit(problems.length === 0 ? 0 : 1);
