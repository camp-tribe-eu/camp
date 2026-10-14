#!/usr/bin/env node
// CAMP-318: внутрішнє посилання, що веде в порожнечу.
//
//   node scripts/ci/check-internal-links.mjs
//   node scripts/ci/check-internal-links.mjs --self-test
//
// 🔴 ЗВІДКИ ЦЕ ВЗЯЛОСЬ. На сторінці кемпінга без фото стояла кнопка
// «You own this site? Add your photos» → `/owner/claim`. Теки
// `app/owner` не існує і ніколи не існувало. Тобто власник кемпінга —
// рівно та людина, яку ми просимо про допомогу — натискав і отримував
// 404. Фото мають 0.4% кемпінгів, тож кнопка показувалась майже на
// кожній сторінці сайту.
//
// 🔴 ЧОМУ ЦЬОГО НІХТО НЕ СПІЙМАВ, І ЦЕ ВАЖЛИВІШЕ ЗА САМУ КНОПКУ.
// Сусідній сторож `check-internal-anchors.mjs` (CAMP-307) питає, чи
// вжито `<Link>` замість `<a>` — тобто перевіряє ФОРМУ посилання. Чи
// існує ЦІЛЬ, не питав ніхто. Дефект був не в тому, що хтось
// помилився, а в тому, що помилитись було нічим не заборонено.
//
// 🔴 ЩО САМЕ ВВАЖАЄТЬСЯ ЦІЛЛЮ. Маршрут із `app/**/page.tsx` чи
// `route.ts`, АБО файл із `public/`. Без другого сторож червонів би на
// `/fonts/archivo-latin.woff2` і за день став би тим, що всі
// ігнорують — а запобіжник, який навчились прогортати, гірший за
// відсутній.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const WEB = path.join(ROOT, 'apps', 'web');

/**
 * Лише рядкові літерали. Вираз у фігурних дужках ми не вгадуємо.
 *
 * 🔴 ДВА НАПИСАННЯ, І ДРУГЕ Я СПЕРШУ ПРОПУСТИВ. `href="/x"` це атрибут у
 * розмітці, а `href: '/x'` — поле обʼєкта, і саме так написане головне
 * меню (`components/site-chrome.tsx`). Перша версія брала лише знак
 * рівності, тож ЖОДНЕ посилання шапки не перевірялось: підкинутий у
 * меню `/nope-dead-link` пройшов із «усі 19 ведуть кудись», rc=0
 * (заміряно 14.10.2026, у день, коли цей сторож і зʼявився).
 *
 * Знайшов це агент, що додавав `/plan` у ту саму шапку — тобто перший
 * же, хто торкнувся меню. Сторож, сліпий на найпомітніші посилання
 * сайту, гірший за відсутній: він дає впевненість, якої не покриває.
 */
const HREF = /href\s*[:=]\s*["'](\/[^"'{}\s]*)["']/g;

/** `/a/b/` і `/a/b` — одне й те саме; `#` і `?` до маршруту не належать. */
/**
 * Код без коментарів.
 *
 * 🔴 ЦЕ ДРУГА ПОМИЛКА ПОСПІЛЬ У ЦЬОМУ Ж ФАЙЛІ, І ВОНА В МЕНЕ ЗАПИСАНА.
 * Щойно регулярка навчилась бачити `href:` у полях обʼєкта, вона
 * почала скаржитись на `/plan` і `/rentals` — а вони ЗАКОМЕНТОВАНІ в
 * `site-chrome.tsx` під рядком «Added as each ships, not before». Тобто
 * сторож поскаржився на намір, а не на код.
 *
 * Той самий дефект уже був у перевірці CEMS: вона матчила згадку в
 * коментарі й зупинила чужий PR.
 *
 * 🔴 ЧОМУ НЕ ПРОСТО ВИРІЗАТИ ВІД `//` ДО КІНЦЯ РЯДКА. Усередині рядка
 * трапляється `https://`, і наївне правило обрізало б рядок на `//`,
 * сховавши все, що написане після нього. Тому стан рядка тут
 * відстежується: що в лапках — те не коментар.
 */
export function stripComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (quote !== null) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

export function normalise(href) {
  const clean = href.split('#')[0].split('?')[0];
  const cut = clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
  return cut === '' ? '/' : cut;
}

/**
 * Маршрути з файлової системи — як їх бачить Next.
 *
 * `[slug]` зіставляється з одним сегментом, `[...rest]` — з одним або
 * кількома, `[[...rest]]` — із нуля або кількох.
 */
export function routePattern(dir) {
  const r = dir === '' ? '/' : `/${dir}`;
  if (!r.includes('[')) return r;

  // 🔴 ЧЕРЕЗ МІТКИ, А НЕ ЗАМІНАМИ ПІДРЯД. Перша версія підставляла
  // `[^/]+` і наступна ж заміна `\[[^\]]+\]` зʼїдала цей самий
  // `[^/]` як динамічний сегмент: `/docs/[...rest]` давав
  // `[^/]++` і падав із «Nothing to repeat». Сегмент розбирається
  // цілком, і лише потім мітка стає регуляркою.
  const ONE = '\u0000ONE';
  const ALL = '\u0000ALL';
  const OPT = '\u0000OPT';
  const body = r
    .split('/')
    .map((seg) => {
      if (/^\[\[\.\.\..+\]\]$/.test(seg)) return OPT;
      if (/^\[\.\.\..+\]$/.test(seg)) return ALL;
      if (/^\[.+\]$/.test(seg)) return ONE;
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/')
    .replace(new RegExp(`/${OPT}`, 'g'), '(?:/[^/]+)*')
    .replace(new RegExp(ALL, 'g'), '[^/]+(?:/[^/]+)*')
    .replace(new RegExp(ONE, 'g'), '[^/]+');
  return new RegExp(`^${body}$`);
}

export function routesIn(appDir, walk = readdirSync) {
  const out = [];
  const visit = (abs, rel) => {
    for (const name of walk(abs, { withFileTypes: true })) {
      if (name.isDirectory()) visit(path.join(abs, name.name), rel ? `${rel}/${name.name}` : name.name);
      else if (name.name === 'page.tsx' || name.name === 'route.ts') out.push(routePattern(rel));
    }
  };
  visit(appDir, '');
  return out;
}

/** Чи веде href у маршрут. */
export const hitsRoute = (href, routes) =>
  routes.some((r) => (typeof r === 'string' ? r === href : r.test(href)));

/** Чи веде href у справжній файл із `public/`. */
export const hitsAsset = (href, publicDir, exists = existsSync) =>
  href !== '/' && exists(path.join(publicDir, href));

/**
 * Посилання, яким нікуди вести.
 *
 * 🔴 Повертає ще й ФАЙЛ, де воно написане. «Є биті посилання» без
 * адреси — це повідомлення, після якого однаково доведеться грепати.
 */
export function offenders(found, routes, publicDir, exists = existsSync) {
  const bad = [];
  for (const [href, files] of found) {
    if (hitsRoute(href, routes)) continue;
    if (hitsAsset(href, publicDir, exists)) continue;
    bad.push({ href, files: [...files].sort() });
  }
  return bad.sort((a, b) => a.href.localeCompare(b.href));
}

/** Усі внутрішні href у дереві, з файлами, де вони трапились. */
/**
 * 🔴 ЧИТАЧ ІН'ЄКТОВАНИЙ, І ЦЕ НЕ ПРИКРАСА. Мутація «прибрати
 * `stripComments` із читання файлів» ловилась лише СПРАВЖНІМ прогоном:
 * випадки самоперевірки кликали `stripComments` напряму, тож проводка
 * між читанням і прибиранням не перевірялась нічим. Заміряно
 * 14.10.2026: справжній прогін rc=1, самоперевірка rc=0.
 */
function collect(srcDir, read = (f) => readFileSync(f, 'utf8'), walk = readdirSync) {
  const found = new Map();
  const visit = (abs) => {
    for (const e of walk(abs, { withFileTypes: true })) {
      const full = path.join(abs, e.name);
      if (e.isDirectory()) visit(full);
      else if (/\.tsx?$/.test(e.name)) {
        const text = stripComments(read(full));
        for (const m of text.matchAll(HREF)) {
          const href = normalise(m[1]);
          if (!found.has(href)) found.set(href, new Set());
          found.get(href).add(path.relative(ROOT, full));
        }
      }
    }
  };
  visit(srcDir);
  return found;
}

function run(log = console) {
  const routes = routesIn(path.join(WEB, 'src', 'app'));
  const found = collect(path.join(WEB, 'src'));
  const bad = offenders(found, routes, path.join(WEB, 'public'));

  if (bad.length === 0) {
    log.log(
      `✓ ${found.size} внутрішніх посилань, усі ведуть у маршрут або у файл public/ ` +
        `(${routes.length} маршрутів)`,
    );
    return 0;
  }
  log.error(`✗ ${bad.length} посилан(ня) ведуть у порожнечу:\n`);
  for (const b of bad) log.error(`  ${b.href}\n     ← ${b.files.join('\n     ← ')}`);
  log.error(
    '\n  Читач, який туди натисне, отримає 404. Або створи сторінку, або\n' +
      '  направ посилання в ту, що існує — але не лишай обіцянку без адреси.',
  );
  return 1;
}

function selfTest() {
  let rc = 0;
  const cases = [];
  const check = (cond, m) => {
    cases.push(m);
    if (!cond) {
      console.error(`✗ REHEARSAL FAILED: ${m}`);
      rc = 1;
    }
  };

  const routes = ['/', '/contact', routePattern('camping/[country]/[region]'), routePattern('legal/[slug]'), routePattern('docs/[...rest]')];
  const noAssets = () => false;
  const asBad = (href, exists = noAssets) =>
    offenders(new Map([[href, new Set(['x.tsx'])]]), routes, '/pub', exists).length;

  check(normalise('/a/b/') === '/a/b', 'кінцева скісна не робить інший маршрут');
  check(normalise('/') === '/', 'корінь лишається коренем');
  check(normalise('/a?x=1#y') === '/a', 'запит і якір до маршруту не належать');

  check(asBad('/contact') === 0, 'статичний маршрут знайдено');
  // 🔴 Той самий випадок, що вбив кнопку власника.
  check(asBad('/owner/claim') === 1, '🔴 неіснуючий маршрут — скарга');
  check(asBad('/camping/hr/istria') === 0, '🔴 динамічні сегменти зіставляються');
  check(asBad('/camping/hr') === 1, 'замало сегментів — не той маршрут');
  check(asBad('/legal/notice') === 0, 'один динамічний сегмент');
  check(asBad('/docs/a/b/c') === 0, '🔴 catch-all бере кілька сегментів');
  // 🔴 Без цього сторож червонів би на шрифтах і його б навчились гортати.
  check(asBad('/fonts/x.woff2', (p) => p === '/pub/fonts/x.woff2') === 0,
    '🔴 файл із public/ — це ціль, а не діра');
  check(asBad('/fonts/x.woff2') === 1, 'відсутній файл public/ — все одно скарга');

  const named = offenders(new Map([['/nope', new Set(['b.tsx', 'a.tsx'])]]), routes, '/pub', noAssets);
  check(named[0].files.join() === 'a.tsx,b.tsx', '🔴 скарга називає файли, і в сталому порядку');

  // ── CAMP-318, друга хвиля: шапка сайту й коментарі ────────────────
  //
  // 🔴 Обидва випадки нижче — це дефекти, які цей файл мав у день, коли
  // зʼявився. Перший: регулярка брала лише `href=`, тож ЖОДНЕ посилання
  // головного меню не перевірялось. Другий: коли навчилась бачити
  // `href:`, почала скаржитись на закоментовані наміри.
  const seen = (src) => [...stripComments(src).matchAll(HREF)].map((m) => m[1]);

  check(seen(`{ href: '/map', label: 'Map' }`).join() === '/map',
    '🔴 поле обʼєкта `href:` видно — так написане головне меню');
  check(seen(`<a href="/map">`).join() === '/map', 'атрибут `href=` видно, як і раніше');
  check(seen(`//   { href: '/plan' },`).length === 0,
    '🔴 закоментований намір — не посилання');
  check(seen(`/* { href: '/plan' }, */`).length === 0, 'блоковий коментар теж');
  check(seen(`const a='https://x//y'; const b={ href: '/map' };`).join() === '/map',
    '🔴 `//` усередині рядка не ховає те, що написане після нього');
  check(seen(`const s='it\\'s // no'; const b={ href: '/map' };`).join() === '/map',
    'екранована лапка не ламає стан розбору');

  // 🔴 ВЕСЬ ШЛЯХ, А НЕ ЛИШЕ `stripComments`. Випадки вище кличуть його
  // напряму, тож мутація «не прибирати коментарі ПРИ ЧИТАННІ» їх не
  // валила — її ловив лише справжній прогін.
  {
    const fakeWalk = () => [{ name: 'x.tsx', isDirectory: () => false }];
    const fakeRead = () => "//  { href: '/dead-on-purpose' }\nconst a = { href: '/map' };";
    const found = collect('/fake', fakeRead, fakeWalk);
    check(!found.has('/dead-on-purpose'), '🔴 закоментоване не доходить і через читання файлу');
    check(found.has('/map'), 'справжнє посилання через читання файлу доходить');
  }

  const EXPECTED_CASES = 20;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-internal-links self-test: ${cases.length} випадків`);
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
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  process.exit(run());
}
