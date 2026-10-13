#!/usr/bin/env node
// CAMP-302: чи справді API може завантажити ESM-фетчер.
//
//   node apps/api/test/warnings-loader.probe.cjs
//
// 🔴 ЦЕЙ ФАЙЛ ІСНУЄ ТОМУ, ЩО JEST ЦЬОГО ДОВЕСТИ НЕ МОЖЕ, А ПРОДАКШН
// ЛАМАЄТЬСЯ САМЕ ТУТ.
//
// `apps/api/tsconfig.json` каже `"module": "commonjs"`, тож звичайний
// `await import()` компілюється в `require()` — а фетчер це ESM із
// верхньорівневим await, і `require()` на ньому дає
// `ERR_REQUIRE_ASYNC_MODULE`. Перша редакція служби падала б у
// продакшні при першому ж оберті, і ЖОДЕН тест цього не бачив: кожен
// підставляв свій `loader`.
//
// Обхід — `new Function('s', 'return import(s)')`. Усередині Jest він
// теж не працює (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`), бо Jest
// виконує модулі у власній VM. Тому доказ живе тут: звичайний Node,
// звичайний CommonJS — рівно те, чим є зібраний API.

const { existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');

const RELATIVE = join('scripts', 'meteoalarm', 'fetch-warnings.mjs');

function findFetcher(from) {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, RELATIVE);
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const esmImport = new Function('s', 'return import(s)');

async function main() {
  let bad = 0;
  const ok = (name, cond, detail = '') => {
    console.log(`${cond ? '✓' : '✗'} ${name}${detail && !cond ? `  ${detail}` : ''}`);
    if (!cond) bad += 1;
  };

  const path = findFetcher(__dirname);
  ok('фетчер знайдено вгору від цього файлу', path !== null, String(path));
  if (path === null) process.exit(1);

  const f = await esmImport(pathToFileURL(path).href);

  ok('модуль завантажився з CommonJS', typeof f === 'object' && f !== null);
  ok(
    'і це 27 держав ЄС, а не порожній перелік',
    Array.isArray(f.COUNTRIES) && f.COUNTRIES.length === 27,
    `отримано ${Array.isArray(f.COUNTRIES) ? f.COUNTRIES.length : typeof f.COUNTRIES}`,
  );
  for (const name of ['feedUrl', 'warningsFrom']) {
    ok(`експортує ${name}`, typeof f[name] === 'function', typeof f[name]);
  }

  if (bad === 0) console.log('\n✓ warnings-loader probe: 5 перевірок');
  process.exit(bad === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error(`✗ завантажувач упав: ${e.code ?? e.message}`);
  process.exit(1);
});
