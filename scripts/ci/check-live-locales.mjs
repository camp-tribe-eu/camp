#!/usr/bin/env node
// CAMP-219: мова, оголошена живою, мусить мати сторінки.
//
//   node scripts/ci/check-live-locales.mjs
//   node scripts/ci/check-live-locales.mjs --self-test
//
// 🔴 ОДИН БУЛЕВИЙ ПРАПОРЕЦЬ, І 65 435 СТОРІНОК БРЕШУТЬ ПОШУКАЧЕВІ.
// `LOCALES` в `apps/web/src/lib/i18n.ts` тримає шість мов; `live: true`
// стоїть в однієї. Поставити його другій означає, що `alternatesFor()`
// почне друкувати `<link rel="alternate" hreflang="de" href=".../de/...">`
// на КОЖНІЙ сторінці, а `alternateLinks()` у `sitemap.ts` внесе ті самі
// адреси в мапу сайту — щойно живих мов стане дві.
//
// Заміряно 13.10.2026 на запущеному застосунку: `/de`, `/fr`,
// `/de/camping`, `/de/camping/bg/dobrich/bek21` — **усі 404**. У
// `apps/web/src/app` немає ні сегмента `[locale]`, ні теки мови; у
// `middleware.ts` немає жодної згадки про локалі; теки словників
// перекладів не існує взагалі.
//
// 🔴 І ТЕСТ, ЩО ПОРУЧ, СВЯТКУЄ САМЕ ЦЕ. `tests/unit/i18n.spec.ts:133`
// називається «one flag turns Dutch on everywhere at once» і доводить,
// що прапорець справді вмикає все одразу. Він правий щодо механіки й
// мовчить про те, що вмикає — тож ця перевірка існує, щоб прапорець не
// можна було перемкнути раніше, ніж зʼявляться сторінки.

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const I18N = path.join(ROOT, 'apps', 'web', 'src', 'lib', 'i18n.ts');
const APP = path.join(ROOT, 'apps', 'web', 'src', 'app');

/**
 * Живі мови, прочитані З `i18n.ts`, а не перелічені тут.
 *
 * 🔴 Другий список живих мов розійшовся б із першим мовчки — і саме
 * мовчки, бо розбіжність видно лише тому, хто відкриє обидва файли.
 */
export function liveCodesIn(source) {
  const block = /export const LOCALES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source);
  if (block === null) throw new Error('не знайшов LOCALES у i18n.ts');
  const codes = [];
  for (const line of block[1].split('\n')) {
    const m = /code:\s*'([^']+)'[\s\S]*?live:\s*(true|false)/.exec(line);
    if (m !== null && m[2] === 'true') codes.push(m[1]);
  }
  if (codes.length === 0) throw new Error('жодної живої мови — розбір зламався');
  return codes;
}

/** Мова за замовчуванням, теж із джерела. */
export function defaultCodeIn(source) {
  const m = /export const DEFAULT_LOCALE\s*=\s*'([^']+)'/.exec(source);
  if (m === null) throw new Error('не знайшов DEFAULT_LOCALE у i18n.ts');
  return m[1];
}

/**
 * Чи може маршрутизація взагалі віддати щось під цим префіксом.
 *
 * Два способи, і обидва видно у файловій системі: тека з назвою мови
 * (`app/de/`) або динамічний сегмент верхнього рівня (`app/[locale]/`),
 * який ловить будь-який префікс.
 *
 * 🔴 ВІДПОВІДАЄ «НІ» ЗА ЗАМОВЧУВАННЯМ. Перевірка, що не вміє довести
 * наявність сторінок, мусить це сказати, а не пропустити.
 */
export function servesPrefix(code, segments) {
  return segments.includes(code) || segments.some((s) => /^\[.+\]$/.test(s));
}

export function problems({ source, segments }) {
  const dflt = defaultCodeIn(source);
  return liveCodesIn(source)
    .filter((c) => c !== dflt)
    .filter((c) => !servesPrefix(c, segments))
    .map((c) => ({
      code: c,
      why:
        `мова '${c}' оголошена живою, але ні теки 'app/${c}', ні динамічного ` +
        `сегмента верхнього рівня немає — hreflang вказуватиме на 404`,
    }));
}

const segmentsOf = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

function run() {
  const found = problems({ source: readFileSync(I18N, 'utf8'), segments: segmentsOf(APP) });
  if (found.length === 0) {
    console.log('✓ кожна жива мова має, чим віддати свої сторінки');
    return 0;
  }
  console.error('✗ hreflang вказуватиме на сторінки, яких немає:\n');
  for (const p of found) console.error(`  ${p.why}`);
  console.error(
    '\n  Прапорець `live` — не вмикач перекладу, а обіцянка пошукачеві.\n' +
      '  Спершу сегмент маршруту й зміст, потім прапорець.',
  );
  return 1;
}

function selfTest() {
  const cases = [];
  let rc = 0;
  const is = (name, got, want) => {
    cases.push(name);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      rc = 1;
    }
  };
  const src = (rows, dflt = 'en') =>
    `export const LOCALES: Locale[] = [\n${rows}\n];\n` +
    `export const DEFAULT_LOCALE = '${dflt}';`;
  const row = (code, live) => `  { code: '${code}', label: 'x', live: ${live}, market: 'm' },`;

  // Стан репозиторію на 13.10.2026: лише `en`, і він за замовчуванням.
  is('сьогоднішній стан чистий',
    problems({ source: src([row('en', true), row('de', false)].join('\n')), segments: ['camping'] }),
    []);
  // Те, що станеться від одного прапорця.
  is('de увімкнено без сторінок — скарга',
    problems({ source: src([row('en', true), row('de', true)].join('\n')), segments: ['camping'] })
      .map((p) => p.code),
    ['de']);
  // Тека мови робить її законною.
  is('de з текою app/de — чисто',
    problems({ source: src([row('en', true), row('de', true)].join('\n')), segments: ['camping', 'de'] }),
    []);
  // Динамічний сегмент ловить будь-який префікс.
  is('динамічний сегмент покриває всі мови',
    problems({ source: src([row('en', true), row('de', true), row('fr', true)].join('\n')),
               segments: ['[locale]'] }),
    []);
  // 🔴 Мова за замовчуванням не має префікса й не мусить мати теки.
  is('мова за замовчуванням не потребує теки',
    problems({ source: src(row('nl', true), 'nl'), segments: ['camping'] }),
    []);
  // 🔴 Дві увімкнені без сторінок — обидві названі, не лише перша.
  is('названі обидві',
    problems({ source: src([row('en', true), row('de', true), row('fr', true)].join('\n')),
               segments: ['camping'] }).map((p) => p.code),
    ['de', 'fr']);
  // `live: false` не рахується.
  is('вимкнена мова не скаржиться',
    problems({ source: src([row('en', true), row('de', false), row('fr', false)].join('\n')),
               segments: ['camping'] }),
    []);
  // 🔴 Розбір, що нічого не знайшов, мусить КИНУТИ, а не віддати
  // порожньо: порожній список живих мов виглядає як «усе гаразд».
  //
  // 🔴 ДВА РІЗНІ КИДКИ, І ПЕРША ВЕРСІЯ ЦЬОГО ВИПАДКУ БИЛА НЕ В ТОЙ.
  // Фікстурою був `const LOCALES = [];` — у ній немає `export const
  // LOCALES … = [ … ];`, тож кидало «не знайшов LOCALES», а мутація,
  // що прибирає перевірку на порожній список, вижила. Кожен кидок
  // тепер має власну фікстуру, і текст звіряється, а не сам факт.
  const threwOn = (src) => {
    try {
      liveCodesIn(src);
      return 'не кинуло';
    } catch (e) {
      return e.message;
    }
  };
  is('без блоку LOCALES — кидок про блок',
    threwOn('const LOCALES = [];'), 'не знайшов LOCALES у i18n.ts');
  is('блок є, живих нема — кидок про розбір',
    threwOn("export const LOCALES: Locale[] = [\n  { code: 'en', live: false },\n];"),
    'жодної живої мови — розбір зламався');

  const EXPECTED_CASES = 9;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-live-locales self-test: ${cases.length} випадків`);
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-live-locales.mjs');
  process.exit(action.has('--self-test') ? selfTest() : run());
}
