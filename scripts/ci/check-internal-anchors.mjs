#!/usr/bin/env node
// CAMP-307: `<a>` на внутрішню сторінку, якого вбудоване правило не бачить.
//
//   node scripts/ci/check-internal-anchors.mjs
//   node scripts/ci/check-internal-anchors.mjs --self-test
//
// 🔴 КАРТКА СТВЕРДЖУВАЛА НЕ ТЕ, І ПИСАВ ЇЇ Я. У ній сказано, що
// локальний лінт дає хибне «чисто», а `next build` ловить. Заміряно
// 13.10.2026 на цьому ж дереві: обидва поводяться ОДНАКОВО. Посаджений
// `<a href="/legal/notice">` валить локальну команду тим самим текстом,
// що був у CI.
//
// 🔴 СПРАВЖНЯ МЕЖА ІНША Й ГІРША. `@next/next/no-html-link-for-pages`
// ловить маршрут, лише якщо в його теці є ДИНАМІЧНИЙ нащадок. Заміряно
// по одному href за раз:
//
//   ловить      /guides  /routes  /camping  /legal/notice  /camping/hr
//   пропускає   /about   /contact /gone     /map  /search
//               /tools/camper-packing-list
//
// `/guides` ловиться не тому, що він маршрут, а тому, що поруч лежить
// `[slug]`. Шість листових статичних сторінок не захищені НІЧИМ.
//
// 🔴 ЦЕЙ СТОРОЖ НЕ ЗАМІНЮЄ ПРАВИЛО, А ЗАКРИВАЄ ЙОГО ДІРУ. Правило
// лишається ввімкненим; воно ловить динамічні випадки, яких тут немає.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const SRC = path.join(ROOT, 'apps', 'web', 'src');
const APP = path.join(SRC, 'app');

/**
 * Файли, де `<a>` на внутрішню сторінку правильний.
 *
 * 🔴 ОДИН ФАЙЛ, І ПРИЧИНА НАЗВАНА. `global-error.tsx` замінює кореневий
 * layout цілком, тож контексту роутера в ньому немає і `next/link` там
 * не працює — так каже документація Next. Список винятків, який росте
 * без причини поруч із кожним рядком, перестає бути списком винятків.
 */
export const ANCHOR_IS_RIGHT_HERE = Object.freeze({
  'app/global-error.tsx': 'замінює кореневий layout — роутера й <Link> там немає',
});

/** Маршрути-сторінки, прочитані з файлової системи, а не перелічені. */
export function pageRoutes(dir = APP, read = readdirSync, stat = statSync) {
  const out = [];
  const walk = (abs, url) => {
    let entries;
    try {
      entries = read(abs);
    } catch {
      return;
    }
    if (entries.some((e) => e === 'page.tsx' || e === 'page.ts')) out.push(url === '' ? '/' : url);
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      let isDir = false;
      try {
        isDir = stat(path.join(abs, e)).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      // 🔴 Групи маршрутів `(marketing)` і паралельні `@slot` не дають
      // сегмента в адресі. Порахувати їх сегментом означало б шукати
      // маршрут, якого не існує, і мовчати про той, що існує.
      const segment = /^\(.*\)$/.test(e) || e.startsWith('@') ? '' : `/${e}`;
      walk(path.join(abs, e), url + segment);
    }
  };
  walk(dir, '');
  return [...new Set(out)].sort();
}

/** Чи веде ця адреса на маршрут-сторінку. Динамічні сегменти — теж. */
export function hitsPage(href, routes) {
  if (!href.startsWith('/')) return false;
  const clean = href.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const parts = clean.split('/').filter(Boolean);
  return routes.some((r) => {
    const rp = r.split('/').filter(Boolean);
    if (rp.length !== parts.length) return false;
    return rp.every((seg, i) => (seg.startsWith('[') ? true : seg === parts[i]));
  });
}

const ANCHOR = /<a\s[^>]*href\s*=\s*"(\/[^"]*)"/g;

/** Кожен `<a>` на сторінку, з файлом і рядком. */
export function offenders(files, routes, read = (p) => readFileSync(p, 'utf8')) {
  const bad = [];
  for (const rel of files) {
    if (rel in ANCHOR_IS_RIGHT_HERE) continue;
    const text = read(path.join(SRC, rel));
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(ANCHOR)) {
        if (hitsPage(m[1], routes)) bad.push({ file: rel, line: i + 1, href: m[1] });
      }
    }
  }
  return bad;
}

const tsxUnder = (dir, prefix = '') => {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.')) continue;
    const abs = path.join(dir, e);
    if (statSync(abs).isDirectory()) out.push(...tsxUnder(abs, `${prefix}${e}/`));
    else if (e.endsWith('.tsx')) out.push(`${prefix}${e}`);
  }
  return out;
};

function run() {
  const routes = pageRoutes();
  const bad = offenders(tsxUnder(SRC), routes);
  if (bad.length === 0) {
    console.log(
      `✓ check-internal-anchors: ${routes.length} маршрутів, жодного <a> на сторінку`,
    );
    return 0;
  }
  console.error('✗ `<a>` веде на внутрішню сторінку — має бути <Link>:\n');
  for (const b of bad) console.error(`  src/${b.file}:${b.line}  href="${b.href}"`);
  console.error(
    '\n  Вбудоване правило цього не бачить: воно ловить маршрут, лише якщо\n' +
      '  в його теці є динамічний нащадок (заміряно 13.10.2026).',
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

  const R = ['/', '/about', '/camping/[country]', '/guides', '/guides/[slug]', '/map'];

  is('статична сторінка — влучання', hitsPage('/about', R), true);
  is('кінцева скісна нічого не змінює', hitsPage('/about/', R), true);
  is('запит і якір відрізаються', hitsPage('/about?x=1#y', R), true);
  is('динамічний сегмент ловиться', hitsPage('/camping/hr', R), true);
  is('не маршрут — не влучання', hitsPage('/nope', R), false);
  // 🔴 Глибина має значення: `/guides/a/b` не є `/guides/[slug]`.
  is('зайвий сегмент — не влучання', hitsPage('/guides/a/b', R), false);
  is('зовнішнє посилання не наше', hitsPage('https://example.com/about', R), false);
  // 🔴 ДВІ СПРОБИ, ПЕРШ НІЖ ВИПАДОК СТАВ СПРАВЖНІМ. Мутація «прибрати
  // `startsWith('/')`» пережила і зовнішні адреси, і `mailto:` — вони й
  // так не збігаються довжиною. Потім я написав, що
  // `https://example.com` дає нуль сегментів; теж неправда, `//` дає
  // два. Розрізняють цей рядок рівно ті входи, де ЧИСТА ЧАСТИНА
  // порожня і `|| '/'` робить із них корінь: якір, самий лише запит,
  // відносний шлях і порожній рядок. Усі чотири без перевірки
  // читаються як посилання на головну.
  is('якір — не головна', hitsPage('#top', R), false);
  is('самий запит — не головна', hitsPage('?x=1', R), false);
  is('відносний шлях — не головна', hitsPage('about', R), false);
  is('порожній href — не головна', hitsPage('', R), false);
  is('mailto не наше', hitsPage('mailto:a@b.c', R), false);
  // 🔴 Файл-маршрут не є сторінкою: `/data/warnings.json` віддає
  // обробник, і `<Link>` на нього був би помилкою.
  is('обробник, а не сторінка', hitsPage('/data/warnings.json', R), false);

  const read = (p) => ({
    [path.join(SRC, 'a.tsx')]: '<a href="/about">x</a>',
    [path.join(SRC, 'b.tsx')]: '<a href="/data/x.json">x</a>\n<a href="https://e.com">y</a>',
    [path.join(SRC, 'app/global-error.tsx')]: '<a href="/">home</a>',
    [path.join(SRC, 'c.tsx')]: '<Link href="/about">x</Link>',
  })[p];

  is('ловить <a> на сторінку',
    offenders(['a.tsx'], R, read).map((b) => `${b.file}:${b.line}:${b.href}`),
    ['a.tsx:1:/about']);
  is('не чіпає файли й зовнішнє', offenders(['b.tsx'], R, read), []);
  is('не чіпає <Link>', offenders(['c.tsx'], R, read), []);
  // 🔴 Виняток названий файлом, не правилом «деінде можна».
  is('виняток global-error', offenders(['app/global-error.tsx'], R, read), []);
  is('виняток поіменний, а не загальний',
    offenders(['a.tsx', 'app/global-error.tsx'], R, read).length, 1);

  // Маршрути читаються з файлової системи, групи не дають сегмента.
  const tree = {
    '': ['page.tsx', 'about', '(marketing)', 'camping'],
    about: ['page.tsx'],
    '(marketing)': ['promo'],
    '(marketing)/promo': ['page.tsx'],
    camping: ['[country]'],
    'camping/[country]': ['page.tsx'],
  };
  const rd = (p) => tree[path.relative('/r', p) === '.' ? '' : path.relative('/r', p)] ?? [];
  const st = (p) => ({ isDirectory: () => !path.basename(p).includes('.') });
  is('маршрути з файлової системи', pageRoutes('/r', rd, st),
    ['/', '/about', '/camping/[country]', '/promo']);

  const EXPECTED_CASES = 19;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-internal-anchors self-test: ${cases.length} випадків`);
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
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-internal-anchors.mjs');
  process.exit(action.has('--self-test') ? selfTest() : run());
}
