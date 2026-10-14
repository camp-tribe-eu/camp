#!/usr/bin/env node
// CAMP-308: кількість кемпінгів, надрукована руками там, де її читають
// люди й пошуковики.
//
//   node scripts/ci/check-hardcoded-counts.mjs
//   node scripts/ci/check-hardcoded-counts.mjs --self-test
//
// 🔴 ЗВІДКИ ЦЕ ВЗЯЛОСЬ. У `description` сторінки `/routes` стояло «from
// our own database of 61 422» — число, заміряне 27.09.2026 і набране
// руками. Імпорт щотижневий, тож таке число бреше в середньому пів
// тижня, і бреше перед Google: опис потрапляє у видачу. Коли знайшли,
// живих копій було більше, ніж одна, а розійтись вони встигли раніше,
// ніж із базою. Рахувати число руками — це не помилка однієї людини,
// це шлях, яким п'ята копія зʼявиться знову.
//
// 🔴 ЩО ВВАЖАЄТЬСЯ ПОМИЛКОЮ. Число з чотирьох і більше цифр у ТЕКСТІ, який
// дійде до читача чи пошуковика, якщо в тому ж тексті є слово, що
// називає те, що ми рахуємо (campsite, site, spot, page, record,
// database…). Текст — це рядкові літерали, шаблонні рядки й JSX-текст.
//
// 🔴 ЧОМУ НЕ «БУДЬ-ЯКЕ ЧОТИРИЗНАКОВЕ ЧИСЛО». Перша ж така перевірка на
// цьому коді червоніла б на «3 500 kg» (ліцензійна межа ваги), «2 200
// metres» (висота перевалу) і поштовому індексі. Те саме вже траплялось:
// перша редакція перевірки на сторінці «про нас» падала на «2000
// Antwerpen». Число саме по собі нічого не каже; каже число поруч зі
// словом про кемпінги.
//
// 🔴 ЧОМУ СИНТАКСИЧНЕ ДЕРЕВО, А НЕ «ВИРІЗАТИ КОМЕНТАРІ Й ШУКАТИ». У коді
// є ПРАВИЛЬНІ вживання таких чисел — коментарі із заміром і датою («61
// 422 live campsites, 27.09.2026»), і вони мусять лишатись зеленими.
// `stripComments` із `check-internal-links.mjs` слідкує за лапками, і
// для коду він правильний — `//` усередині рядка не обрізає рядок. Але
// JSX-текст — не код: апостроф у прозі («Don't») для нього відкриває
// «рядок», який не закривається до наступного апострофа, і все, що
// лежить між ними, перестає бути коментарем. Заміряно на цій же
// функції 14.10.2026:
//
//   stripComments("<p>Don't</p>\n{/* 61 422 campsites, 27.09.2026 */}\n<p>Can't</p>")
//   → коментар лишається на місці
//
// Тобто датований коментар став би червоним — рівно те, чого не можна.
// Розбір, який знає, що таке рядок, що таке JSX-текст і що таке
// коментар, не вгадує: коментарі в ньому взагалі не вузли, тож їх не
// треба «вирізати», і `//` у `https://` нічого не обрізає.
//
// 🔴 ЩО СТОРОЖ НЕ БАЧИТЬ, І ЦЕ НАЗВАНО, А НЕ ЗАМОВЧАНО:
//   · число в одному елементі, а іменник в іншому
//     (`<dd>61 422</dd>` поруч із `<dt>Campsites</dt>`);
//   · число, що живе в константі й виводиться виразом (`{TOTAL}`);
//   · числа прописом («sixty-one thousand») і скорочення («61k»);
//   · `src/data/**` — див. `EXCLUDED` нижче.
// Кожне з цього — окрема діра, а не вигадка: зашита константа пройшла б
// повз, і цей сторож не замінює дисципліни «число береться з даних».

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const SRC = path.join(ROOT, 'apps', 'web', 'src');

/**
 * Теки, які сторож не читає, і причина поруч із кожною.
 *
 * 🔴 ОДНА ТЕКА, І ПРИЧИНА НАЗВАНА. `src/data/routes/*.ts` — редакційна
 * проза маршрутів («our database holds 102 sites within 25 km of Zadar»,
 * «3 761 sites» для Нідерландів). Це зрізи по етапах, їх неможливо
 * порахувати на збірці без того, щоб писати маршрут із коду, і кожна
 * сторінка маршруту друкує внизу «Route last reviewed by a person on
 * <дата>». Список винятків, який росте без причини поруч із рядком,
 * перестає бути списком винятків.
 *
 * Усе інше під `src/` читається ЗА ЗАМОВЧУВАННЯМ — нова тека потрапляє
 * під сторожа сама, а не лишається поза ним, поки хтось не згадає її
 * дописати.
 */
export const EXCLUDED = Object.freeze({
  data: 'редакційні набори: зріз із датою, яку друкує сторінка («Route last reviewed on …»)',
});

/**
 * Слова, що називають те, що ми рахуємо.
 *
 * 🔴 «camper», «caravan», «motorhome» ПООДИНЦІ СЮДИ НЕ ВХОДЯТЬ. «Motor
 * caravan up to 3 500 kg» — це про транспорт, і з ними сторож червонів
 * би на сторінці прокату авто (заміряно на цьому ж дереві: два
 * хибних спрацювання з двох). Лише фрази про місце: «camper stop»,
 * «motorhome park».
 */
const WORD = new RegExp(
  '\\b(?:campsites?|campgrounds?|camping|motorhome\\s+parks?|camper\\s+stops?|' +
    'rv\\s+parks?|aires?|pitch(?:es)?|sites?|spots?|listings?|records?|entries|pages?|' +
    'database|dataset)\\b',
  'i',
);

/**
 * Іменник, що робить із «2012» кількість, а не рік.
 *
 * 🔴 ВПРИТУЛ, без слів між ними. З дозволом на «слово-два» між числом і
 * іменником «in 2026 for campsites» читалось би як «2026 campsites», і
 * кожен датований рядок про кемпінги став би червоним.
 */
const NOUN_AFTER = /^\s+(?:campsites?|sites?|spots?|pages?|records?|pitch(?:es)?|listings?|entries)\b/i;

/**
 * Число, яким пишуть кількість: з роздільниками тисяч (пробіл, нерозривний
 * пробіл, вузький пробіл, кома, крапка) або просто з чотирьох і більше
 * цифр. Не частина більшого числа, дати чи координати: перед ним не
 * цифра, крапка чи кома.
 */
const NUMBER = /(?<![\d.,])(?:\d{1,3}(?:[ ,.\u00a0\u2009\u202f]\d{3})+|\d{4,})(?!\d)/g;

const YEAR = /^(?:19|20)\d{2}$/;

/**
 * HTML-сутності в JSX-тексті, якими пишуть пробіл у числі.
 *
 * 🔴 `61&nbsp;422` читається людиною як «61 422», а регулярка бачить
 * `61&nbsp;422` і не бачить числа. Розкодовується ВСЕ числове й чотири
 * іменовані пробіли, бо інших у цьому коді не пишуть; невідоме лишається
 * як є.
 */
export function decodeEntities(s) {
  return s
    .replace(/&(?:nbsp|thinsp|ensp|emsp);/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (w, h) => safeCodePoint(parseInt(h, 16), w))
    .replace(/&#(\d+);/g, (w, d) => safeCodePoint(parseInt(d, 10), w));
}

function safeCodePoint(n, whole) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return whole;
  }
}

/**
 * Числа в одному тексті, які виглядають як надрукована кількість.
 * Чиста функція: нічого не знає про файли.
 */
export function typedCounts(unit) {
  if (!WORD.test(unit)) return [];
  const out = [];
  for (const m of unit.matchAll(NUMBER)) {
    if (YEAR.test(m[0])) {
      // Рік, поки за ним не стоїть іменник: «2012 campsites» — це
      // кількість, «in 2026 for campsites» — ні.
      if (!NOUN_AFTER.test(unit.slice(m.index + m[0].length))) continue;
    }
    out.push({ number: m[0], index: m.index });
  }
  return out;
}

/**
 * Усі тексти, що можуть дійти до читача, з номером рядка.
 *
 * 🔴 КОМЕНТАРІ ТУТ НЕ ВУЗЛИ. Саме тому вони не потребують «вирізання»:
 * обхід бачить рядки, шаблони й JSX-текст, і нічого іншого.
 */
export function textUnits(source, fileName = 'x.tsx') {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const lineAt = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const units = [];

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      units.push({ text: node.text, line: lineAt(node.getStart(sf)), kind: 'string' });
    } else if (ts.isTemplateExpression(node)) {
      // Шматки між `${…}` склеєні роздільником, який не слово й не цифра:
      // «${n} of the 61 422 campsites» — одне речення, а не три рядки.
      const text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('\u0001');
      units.push({ text, line: lineAt(node.getStart(sf)), kind: 'template' });
    } else if (ts.isJsxText(node)) {
      // `node.pos` — це початок самого тексту разом із пробілами перед
      // ним, а не початок першого слова: рахуємо рядки від нього.
      units.push({ text: decodeEntities(node.text), line: lineAt(node.pos), kind: 'jsx' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return units;
}

/** Кожне надруковане руками число в одному файлі: рядок, число, витяг. */
export function findings(source, fileName = 'x.tsx') {
  const out = [];
  for (const u of textUnits(source, fileName)) {
    for (const hit of typedCounts(u.text)) {
      const before = u.text.slice(0, hit.index);
      const line = u.line + (before.match(/\n/g)?.length ?? 0);
      const from = Math.max(0, hit.index - 40);
      const excerpt = u.text
        .slice(from, hit.index + hit.number.length + 25)
        .replace(/\s+/g, ' ')
        .replace(/\u0001/g, '${…}')
        .trim();
      out.push({ line, number: hit.number, kind: u.kind, excerpt });
    }
  }
  return out;
}

/**
 * Чим є файл під `src/`.
 *
 * 🔴 «НЕВІДОМЕ» — ЦЕ ПОМИЛКА, А НЕ ПОРОЖНЕЧА. Файл `.mdx` із текстом
 * сторінки був би невидимим для цього сторожа так само, як був би
 * невидимим для людини, що гортає `.ts`. Список відомих не-кодових
 * типів короткий і названий; усе інше зупиняє прогін і просить
 * вирішити, чи читати це.
 */
export function classify(rel) {
  const top = rel.split('/')[0];
  if (Object.hasOwn(EXCLUDED, top) && rel.includes('/')) return 'excluded';
  if (/\.tsx?$/.test(rel)) return 'code';
  if (/\.(?:json|css|ico)$/.test(rel)) return 'skip';
  return 'unknown';
}

/**
 * Прохід по дереву. Читач і обхід інʼєктовані, щоб самоперевірка
 * проганяла ВЕСЬ шлях — від імені файлу до скарги, — а не лише чисті
 * функції, на які він спирається.
 */
export function scan(srcDir, read = (f) => readFileSync(f, 'utf8'), walk = readdirSync) {
  const result = { found: [], problems: [], scanned: 0, excluded: 0, pages: 0, routes: 0 };
  const visit = (abs, rel) => {
    for (const e of walk(abs, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        visit(full, relPath);
        continue;
      }
      const kind = classify(relPath);
      if (kind === 'excluded') {
        result.excluded += 1;
        continue;
      }
      if (kind === 'skip') continue;
      if (kind === 'unknown') {
        result.problems.push({ file: relPath, why: 'тип файлу не розібрано: читати його чи ні — рішення, а не мовчання' });
        continue;
      }
      // 🔴 Один нечитаний файл коштує одного файлу, а не всього прогону.
      let text;
      try {
        text = read(full);
      } catch (err) {
        result.problems.push({ file: relPath, why: `не прочитався: ${err.message}` });
        continue;
      }
      result.scanned += 1;
      if (e.name === 'page.tsx') result.pages += 1;
      if (e.name === 'route.ts') result.routes += 1;
      for (const f of findings(text, e.name)) result.found.push({ file: relPath, ...f });
    }
  };
  visit(srcDir, '');
  result.found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return result;
}

/**
 * Порожній прохід — це не «чисто».
 *
 * 🔴 Сторож, що читає не ту теку, повідомляє «нічого не знайдено» так
 * само впевнено, як сторож, що дивиться правильно. Сторінка й обробник
 * маршруту — те, без чого `src/app` порожній, а порожній `src/app` — це
 * не стан, у якому можна казати «усе гаразд».
 */
export function structuralProblems(r) {
  const out = [];
  if (r.pages === 0) out.push({ file: '(усе дерево)', why: 'жодного page.tsx не прочитано — прохід дивився не туди' });
  if (r.routes === 0) out.push({ file: '(усе дерево)', why: 'жодного route.ts не прочитано — прохід дивився не туди' });
  return out;
}

/**
 * Скарга як текст. Окремо від `run`, щоб її можна було прочитати в
 * самоперевірці: «є таке» без адреси — це повідомлення, після якого
 * однаково доведеться грепати.
 */
export function report(found, problems) {
  const out = [];
  if (found.length > 0) {
    out.push(`✗ ${found.length} число(а) кемпінгів надруковано руками в тексті, який читають:\n`);
    for (const f of found) {
      out.push(`  apps/web/src/${f.file}:${f.line}   "${f.number}"\n     …${f.excerpt}…`);
    }
    out.push(
      '\n  Таке число застаріває зі своїм тижнем імпорту, а читач і Google читають\n' +
        '  його як сьогоднішнє. Або порахуй на збірці (див. lib/campsite-count.ts, де\n' +
        '  пояснено, яке з ТРЬОХ чисел доречне), або надрукуй разом із датою заміру.\n' +
        '  Коментар із заміром і датою цього сторожа не цікавить.',
    );
  }
  if (problems.length > 0) {
    out.push(`\n✗ ${problems.length} проблем(а) з самим оглядом:`);
    for (const p of problems) out.push(`  ${p.file}: ${p.why}`);
  }
  return out;
}

function run(log = console) {
  const r = scan(SRC);
  const problems = [...r.problems, ...structuralProblems(r)];

  if (r.found.length === 0 && problems.length === 0) {
    log.log(
      `✓ check-hardcoded-counts: ${r.scanned} файлів (з них ${r.pages} сторінок, ` +
        `${r.routes} обробників), жодного надрукованого руками числа кемпінгів; ` +
        `поза оглядом ${r.excluded} файлів із ${Object.keys(EXCLUDED).join(', ')}/`,
    );
    return 0;
  }
  for (const line of report(r.found, problems)) log.error(line);
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
  const numbers = (src, file = 'x.tsx') => findings(src, file).map((f) => f.number);

  // ── що мусить бути червоним ──────────────────────────────────────

  // 🔴 Дефект, заради якого сторож написаний: `description` у метаданих.
  is('🔴 число в description, форма /routes',
    numbers("export const metadata = { description: 'the real campsites near every stop, from our own database of 61 422.' };"),
    ['61 422']);
  // …і те саме речення без слова «campsites» — слова «database» досить.
  is('слово «database» теж називає те, що ми рахуємо',
    numbers("export const d = 'from our own database of 61 422.';"),
    ['61 422']);
  // 🔴 Друга форма — текст сторінки.
  is('🔴 число в JSX-тексті, форма сторінки кемпінга',
    numbers('export default function P() { return <p>Of 61 422 publishable campsite pages, 28 808 carry nothing.</p>; }'),
    ['61 422', '28 808']);

  // Кожен спосіб написати роздільник — окремий випадок, бо мутація
  // «забути один» не повинна ховатись за решту.
  is('роздільник: кома', numbers("export const d = '61,422 campsites';"), ['61,422']);
  is('роздільник: крапка', numbers("export const d = '61.422 campsites';"), ['61.422']);
  is('роздільник: без нього', numbers("export const d = '61422 campsites';"), ['61422']);
  is('роздільник: нерозривний пробіл', numbers("export const d = '61\u00a0422 campsites';"), ['61\u00a0422']);
  is('роздільник: вузький нерозривний', numbers("export const d = '61\u202f422 campsites';"), ['61\u202f422']);
  is('роздільник: тонкий пробіл', numbers("export const d = '61\u2009422 campsites';"), ['61\u2009422']);
  is('🔴 `&nbsp;` у JSX-тексті', numbers('export default () => <p>61&nbsp;422 campsites</p>;'), ['61 422']);

  // 🔴 КОЖЕН ІМЕННИК — ОКРЕМИЙ ВИПАДОК. Один список слів у регулярці:
  // викинь із нього «aires» чи «pitches», і єдине, що це побачить, —
  // випадок із цим словом, а не підсумок «усе зелене».
  for (const [noun, sentence] of [
    ['camp site', 'we list 61 422 camp sites'],
    ['campgrounds', 'we list 61 422 campgrounds'],
    ['camping', 'we list 61 422 camping places'],
    ['motorhome parks', 'we list 61 422 motorhome parks'],
    ['camper stops', 'we list 61 422 camper stops'],
    ['RV parks', 'we list 61 422 RV parks'],
    ['aires', 'we list 61 422 aires'],
    ['pitches', 'we list 61 422 pitches'],
    ['sites', 'we list 61 422 sites'],
    ['spots', 'we list 61 422 spots'],
    ['listings', 'we list 61 422 listings'],
    ['records', 'we list 61 422 records'],
    ['entries', 'we list 61 422 entries'],
    ['pages', 'we list 61 422 pages'],
    ['dataset', 'a dataset of 61 422'],
  ]) {
    is(`іменник «${noun}» називає те, що ми рахуємо`,
      numbers(`export const d = '${sentence}';`), ['61 422']);
  }

  is('число в шаблонному рядку з підстановкою',
    numbers('export const d = `${n} of the 61 422 campsites`;'), ['61 422']);
  // 🔴 Підстановка розрізає цифри: «12${a}345 sites» — не «12345 sites».
  // Без роздільника між шматками шаблону склеєні половинки читались би
  // як число, якого в тексті немає.
  is('🔴 підстановка розрізає цифри — це не число',
    numbers('export const d = `${a}12${b}345 sites`;'), []);
  is('число в атрибуті', numbers('export default () => <a aria-label="61 422 campsites">x</a>;'), ['61 422']);

  // 🔴 Наївне вирізання від `//` до кінця рядка сховало б усе після
  // `https://` — і число разом із ним.
  is('🔴 `//` усередині рядка не ховає число після нього',
    numbers("export const d = 'see https://example.org — 61 422 campsites';"), ['61 422']);

  // 🔴 Апостроф у прозі не псує розбір решти файлу: саме це ламає
  // `stripComments` на JSX.
  is('🔴 після апострофів у прозі справжній рядок усе ще видно',
    numbers("export default () => <p>Don't</p>;\nexport const d = 'from the 61 422 campsites';"), ['61 422']);

  // Рік стає кількістю, коли за ним іде іменник.
  is('«2012 campsites» — кількість, а не рік', numbers("export const d = '2012 campsites';"), ['2012']);

  // Номер рядка — той, де саме число, а не де починається текст.
  is('🔴 рядок числа в багаторядковому JSX-тексті',
    findings('export default () => (\n  <p>\n    the campsites\n    we hold: 61 422 today\n  </p>\n);').map((f) => f.line),
    [4]);
  is('рядок числа у файлі з кількох рядків',
    findings("const a = 1;\nexport const d = '61 422 campsites';").map((f) => f.line), [2]);

  // ── що мусить лишатись зеленим ───────────────────────────────────

  // 🔴 Правильне вживання: заміряно, з датою, у коментарі.
  is('🔴 рядковий коментар із заміром і датою',
    numbers('// measured 27.09.2026 against 61 422 live campsites\nexport const a = 1;'), []);
  is('блоковий коментар', numbers('/* 61 422 campsites, 27.09.2026 */\nexport const a = 1;'), []);
  is('🔴 JSX-коментар',
    numbers('export default () => <main>{/* 🔴 Of 61 422 publishable campsite pages, measured 04.10.2026 */}<p>x</p></main>;'), []);
  is('🔴 датований коментар ПІСЛЯ апострофів у прозі лишається коментарем',
    numbers("export default () => (<>\n<p>Don't</p>\n{/* 61 422 campsites, measured 27.09.2026 */}\n<p>Can't</p>\n</>);"), []);

  // Порахований рядок: числа в тексті немає.
  is('порахована кількість у шаблоні',
    numbers('export const d = `${total} campsites across ${n} countries`;'), []);
  is('порахована кількість у JSX',
    numbers("export default () => <p>{total.toLocaleString('en-GB')} campsites</p>;"), []);

  is('мале число', numbers("export const d = 'between 23 and 45 sites within 25 km';"), []);
  // 🔴 Те, на чому спіткнулась перша редакція перевірки «про нас».
  is('🔴 поштовий індекс без слова про кемпінги', numbers("export const d = '2000 Antwerpen';"), []);
  is('🔴 вага з одиницею, слово «camper» не рахується',
    numbers("export const d = 'camper vans up to 3 500 kg';"), []);
  is('рік, коли за ним не іменник', numbers("export const d = 'Measured in 2026 for campsites across the EU';"), []);
  is('дата з числом місяця', numbers("export const d = 'campsites, as of 27.09.2026';"), []);
  is('координата', numbers("export const d = 'campsite at 45.8150, 15.9819';"), []);

  // ── область ──────────────────────────────────────────────────────

  is('src/data/ поза оглядом', classify('data/routes/x.ts'), 'excluded');
  // 🔴 Виняток тримається за ТЕКУ, а не за збіг імені: файл `data.ts`
  // верхнього рівня — це код, а не набір.
  is('файл із імʼям «data» — не тека', classify('data.ts'), 'code');
  is('сторінка — код', classify('app/routes/page.tsx'), 'code');
  is('json — не текст сторінки', classify('generated/gone.json'), 'skip');
  is('🔴 невідомий тип — не мовчання', classify('content/guide.mdx'), 'unknown');

  // 🔴 ВЕСЬ ШЛЯХ: від імені файлу до скарги. Випадки вище кличуть
  // `findings` напряму, і мутація «не розбирати файл» їх не торкається.
  {
    const tree = {
      '/s': [['app', 'd'], ['data', 'd']],
      '/s/app': [['a', 'd'], ['b', 'd'], ['c', 'd'], ['x.json', 'f']],
      '/s/app/a': [['page.tsx', 'f']],
      '/s/app/b': [['page.tsx', 'f'], ['route.ts', 'f']],
      '/s/app/c': [['page.tsx', 'f']],
      '/s/data': [['routes.ts', 'f']],
    };
    const files = {
      '/s/app/a/page.tsx': "export const d = 'from our own database of 61 422.';",
      '/s/app/b/page.tsx': '// 61 422 campsites, 27.09.2026\nexport default () => <p>ok</p>;',
      '/s/app/b/route.ts': 'export const GET = () => 1;',
      '/s/data/routes.ts': "export const d = '3 761 sites for a small country';",
    };
    const walk = (dir) =>
      (tree[dir] ?? []).map(([name, t]) => ({ name, isDirectory: () => t === 'd' }));
    const read = (f) => {
      if (f === '/s/app/c/page.tsx') throw new Error('EACCES');
      return files[f];
    };
    const r = scan('/s', read, walk);

    is('🔴 через читання файлу: тільки те, що лежить поза коментарем і поза data/',
      r.found.map((f) => `${f.file}:${f.line}:${f.number}`), ['app/a/page.tsx:1:61 422']);
    is('🔴 один нечитаний файл — одна проблема, а решта прочитана',
      [r.problems.map((p) => p.file), r.scanned], [['app/c/page.tsx'], 3]);
    is('виключене пораховане, а не загублене', r.excluded, 1);
    is('сторінки й обробники пораховані, нечитаний не рахується', [r.pages, r.routes], [2, 1]);
    is('повний прохід структурних проблем не має', structuralProblems(r), []);
  }
  {
    const walk = () => [{ name: 'guide.mdx', isDirectory: () => false }];
    const r = scan('/s', () => '', walk);
    is('🔴 невідомий тип у проході — проблема з іменем файлу',
      r.problems.map((p) => p.file), ['guide.mdx']);
  }
  is('🔴 порожній прохід — не «чисто»',
    structuralProblems({ pages: 0, routes: 0 }).length, 2);
  is('сторінки без обробників — теж зауваження',
    structuralProblems({ pages: 5, routes: 0 }).length, 1);

  // Скарга називає файл, рядок і число — «є таке» без адреси змушує
  // грепати. Читається те, що друкує `report`, а не рядок, який я сам
  // сюди вписав.
  {
    const r = scan(
      '/s',
      () => "export const d = 'from our own database of 61 422.';",
      (dir) =>
        dir === '/s'
          ? [{ name: 'app', isDirectory: () => true }]
          : dir === '/s/app'
            ? [{ name: 'page.tsx', isDirectory: () => false }]
            : [],
    );
    const said = report(r.found, r.problems).join('\n');
    is('🔴 скарга називає шлях від кореня репозиторію, рядок і число',
      [said.includes('apps/web/src/app/page.tsx:1'), said.includes('"61 422"')], [true, true]);
    is('скарга каже, куди йти', said.includes('lib/campsite-count.ts'), true);
    is('нічого не знайдено — нічого й не друкується', report([], []), []);
  }

  const EXPECTED_CASES = 61;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-hardcoded-counts self-test: ${cases.length} випадків`);
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
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-hardcoded-counts.mjs');
  process.exit(action.has('--self-test') ? selfTest() : run());
}
