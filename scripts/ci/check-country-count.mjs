#!/usr/bin/env node
// CAMP-240: порахували КОДИ, а сказали КРАЇНИ.
//
//   node scripts/ci/check-country-count.mjs
//   node scripts/ci/check-country-count.mjs --self-test
//
// 🔴 ЗВІДКИ ЦЕ ВЗЯЛОСЬ. `/spots/countries` віддає коди, які несуть рядки
// кемпінгів. Станом на 15.10.2026 їх 28: двадцять сім держав-членів і
// `ax` — Аландські острови, самоврядний регіон Фінляндії з власним
// ISO-кодом і 19 кемпінгами. Тобто `countries.length` — це кількість
// КОДІВ, і вона не дорівнює кількості КРАЇН. Сайт, область якого ЄС-27,
// друкував «28 countries» читачеві й пошуковику.
//
// Копій було чотири, і виправляли їх двома заходами: CAMP-240 знайшов
// одну (/search) і полагодив одну, а решта три — /camping, /map,
// llms.txt — поїхали окремим PR. Саме так зʼявляється пʼята: не тому,
// що хтось не знав правила, а тому, що правило ніде не записане кодом.
//
// 🔴 ЩО ВВАЖАЄТЬСЯ ПОМИЛКОЮ. `.length` або `.size`, взяте зі списку, що
// походить від `/spots/countries`, і використане як КІЛЬКІСТЬ. Правильно
// — `memberStateCount(codes)` з `apps/web/src/lib/campsite-count.ts`: він
// зводить `ax` до `fi` і рахує держави.
//
// 🔴 ЧОМУ ОЗНАКА — ПОХОДЖЕННЯ СПИСКУ, А НЕ ФОРМА РЯДКА. Напрошується
// простіше правило: «будь-яке надруковане число країн мусить іти через
// `memberStateCount`». Воно заміряне на цьому ж дереві й хибне. У
// `/guides` стоїть РІВНО ТА САМА синтаксична форма:
//
//   apps/web/src/app/guides/page.tsx:80
//     {guides.length.toLocaleString('en-GB')} guides across{' '}
//     {countries.length} countries.
//
// і вона ПРАВИЛЬНА: той список зібрано з `getGuides()` (`byCountry`), а
// не з `/spots/countries`, і `ax` у ньому немає — 1256 гайдів, 26 кодів,
// заміряно 15.10.2026. Те саме в `guides/topic/[topic]/page.tsx:106`
// (`groups.length`, з Map по `g.facets.country`) і в llms.txt:204
// (`FUEL_COUNTRIES.length` — це рівно ЄС-27). Правило по формі зробило б
// червоними три правильні місця.
//
// Вісь, яка ділить вхід, — звідки ВЗЯВСЯ список. Один файл показує обидві
// сторони цієї осі, і це найкоротший доказ, що вісь саме та:
//
//   llms.txt/route.ts:52   `${countries.length} … countries`      ← хибно
//   llms.txt/route.ts:204  `${FUEL_COUNTRIES.length} member states` ← вірно
//
// 🔴 ЧОМУ СИНТАКСИЧНЕ ДЕРЕВО. Сторож мусить читати КОД. Згадка
// «countries.length» у коментарі (а цей файл і картка повні таких
// згадок) чи в рядку з прозою не сміє його запускати: у розборі
// коментарі взагалі не вузли, а рядок — не звернення до властивості.
// Тут це вже коштувало: сторож, що матчив текст, зупинив чужий PR через
// слова в коментарі.
//
// 🔴 ЩО ЗАЛИШАЄТЬСЯ ЗЕЛЕНИМ НАВМИСНО: перевірка на порожнечу.
// `countries.length === 0` питає, чи список порожній, а не скільки в нас
// держав, — і такі дві перевірки живуть поруч із дефектом
// (`camping/page.tsx:44`, `page.tsx:201`). Порівняння з будь-яким іншим
// числом — це вже твердження про кількість, тож `=== 1` (вибір
// однини/множини) сторож ловить.
//
// 🔴 ЩО СТОРОЖ НЕ БАЧИТЬ, І ЦЕ НАЗВАНО, А НЕ ЗАМОВЧАНО:
//   · походження простежується В МЕЖАХ ОДНОГО ФАЙЛУ. Список, переданий
//     у хелпер в іншому файлі й порахований там, пройде повз;
//   · аргументи `console.*` — навмисний виняток, і він має адресу:
//     `app/data/places.json/route.ts:43` друкує на збірці
//     «places: 28 countries». Це журнал збірки, не читач і не Google,
//     тож сторож його не валить. Рядок усе одно каже неправду, і це
//     окрема дрібна картка, а не привід тримати сторожа червоним;
//   · походження тримається за ІМЕНЕМ, а не за областю видимості, тож
//     однойменна незаражена змінна в тому ж файлі теж буде помічена.
//     Помилка тут — у бік СУВОРІШОГО (зайва скарга, яку видно), а не
//     пропущеного дефекту, і на цьому дереві таких збігів немає
//     (заміряно: прохід зелений на main+#242+#243). Випадок унизу її
//     закріплює, щоб зміна поведінки не пройшла мовчки;
//   · `countries['length']` у дужках, число прописом, лічильник, зібраний
//     циклом (`for (… ) n++`);
//   · `src/data/**` — редакційні набори, див. `EXCLUDED`.

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const SRC = path.join(ROOT, 'apps', 'web', 'src');

/**
 * Теки, які сторож не читає, і причина поруч.
 *
 * Усе інше під `src/` читається ЗА ЗАМОВЧУВАННЯМ — нова тека потрапляє
 * під сторожа сама, а не лишається поза ним, поки хтось не згадає її
 * дописати.
 */
export const EXCLUDED = Object.freeze({
  data: 'редакційні набори: курований список країн маршруту — не відповідь /spots/countries',
});

/**
 * Функції, відповідь яких несе коди, а не держави.
 *
 * `getPlaces` тут, бо він побудований на `getCountries` (api.ts:653) і
 * успадковує той самий `ax`.
 */
const SOURCE_CALLS = new Set(['getCountries', 'getPlaces']);

/**
 * Назви в типі, які кажуть «це відповідь /spots/countries».
 *
 * 🔴 ТИП — ЦЕ ТЕЖ ПОХОДЖЕННЯ, і без нього лишалась би діра на видноті:
 * `app/page.tsx:80` і `:199` оголошують проп
 * `countries: Awaited<ReturnType<typeof getCountries>>`, і всередині того
 * компонента виклику `getCountries()` вже немає. Надрукувати там
 * `countries.length` — той самий дефект, лише на крок далі від джерела.
 */
const SOURCE_TYPES = /\b(?:getCountries|getPlaces|CountrySummary)\b/;

/** Методи, що віддають той самий список, лише інакше розкладений. */
const ARRAY_PRESERVING = new Set([
  'map', 'filter', 'slice', 'sort', 'toSorted', 'reverse', 'toReversed',
  'concat', 'flat', 'flatMap', 'splice',
]);

const unwrap = (node) => {
  let n = node;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
    else if (ts.isAsExpression?.(n)) n = n.expression;
    else return n;
  }
};

/** Виклик, що приносить коди: `getCountries()`, `api.getCountries()`. */
export function isSourceCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return SOURCE_CALLS.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) return SOURCE_CALLS.has(callee.name.text);
  return false;
}

/**
 * Чи це вираз, який тримає список кодів країн.
 *
 * Чиста функція від вузла й набору вже відомих імен: нічого не знає про
 * файли, тож її можна проганяти по одному рядку коду.
 */
export function isTainted(node, names) {
  if (!node) return false;
  const n = unwrap(node);

  if (ts.isIdentifier(n)) return names.has(n.text);
  if (isSourceCall(n)) return true;

  if (ts.isCallExpression(n)) {
    const callee = n.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      // `countries.map(…)` — той самий список.
      if (ARRAY_PRESERVING.has(callee.name.text)) return isTainted(callee.expression, names);
      // `Array.from(countries)` / `Object.keys(…)` не беремо: перше
      // покриває спред нижче, друге міняє предмет рахунку.
      if (callee.name.text === 'from' && ts.isIdentifier(callee.expression) && callee.expression.text === 'Array') {
        return (n.arguments ?? []).some((a) => isTainted(a, names));
      }
    }
    return false;
  }

  // 🔴 `new Set(countries.map(c => c.country)).size` — дедуплікація кодів
  // НЕ робить із них держав: `ax` і `fi` різні коди й лишаються двома.
  // Це той самий дефект у нарядній обгортці, і саме ним перевіряється
  // «свіжовигаданий пʼятий випадок».
  if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Set') {
    return (n.arguments ?? []).some((a) => isTainted(a, names));
  }

  if (ts.isArrayLiteralExpression(n)) {
    return n.elements.some((e) => ts.isSpreadElement(e) && isTainted(e.expression, names));
  }

  return false;
}

/**
 * Вирази, які роздає присвоєння у квадратних дужках.
 *
 * `const [onTheMap, countries] = await Promise.all([…, getCountries()])`
 * — форма, якою написані /map і /search. Без неї сторож бачив би
 * `countries` як невідоме імʼя й мовчав на двох місцях із чотирьох.
 */
export function destructuredFrom(init) {
  const n = unwrap(init);
  if (ts.isArrayLiteralExpression(n)) return n.elements;
  if (ts.isCallExpression(n)) {
    const callee = n.expression;
    const isPromiseAll =
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'Promise' &&
      callee.name.text === 'all';
    if (isPromiseAll) {
      const arg = n.arguments?.[0] && unwrap(n.arguments[0]);
      if (arg && ts.isArrayLiteralExpression(arg)) return arg.elements;
    }
  }
  return [];
}

/**
 * Імена у ФАЙЛІ, що тримають список кодів країн.
 *
 * Нерухома точка, а не один прохід: оголошення не зобовʼязані стояти в
 * порядку використання, і `const a = await getCountries(); const b = a;`
 * мусить дати обидва імені незалежно від того, кого обхід побачив
 * першим.
 */
export function taintedNames(sf) {
  const names = new Set();
  const add = (nameNode) => {
    if (nameNode && ts.isIdentifier(nameNode) && !names.has(nameNode.text)) {
      names.add(nameNode.text);
      return true;
    }
    return false;
  };

  for (let round = 0; round < 8; round++) {
    let changed = false;
    const visit = (node) => {
      if (ts.isVariableDeclaration(node)) {
        if (node.type && SOURCE_TYPES.test(node.type.getText(sf))) changed = add(node.name) || changed;
        if (node.initializer) {
          if (ts.isArrayBindingPattern(node.name)) {
            const parts = destructuredFrom(node.initializer);
            node.name.elements.forEach((el, i) => {
              if (ts.isOmittedExpression(el)) return;
              if (parts[i] && isTainted(parts[i], names)) changed = add(el.name) || changed;
            });
          } else if (isTainted(node.initializer, names)) {
            changed = add(node.name) || changed;
          }
        }
      }
      // Проп або аргумент, оголошений типом відповіді.
      if ((ts.isParameter(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && node.type) {
        if (SOURCE_TYPES.test(node.type.getText(sf))) changed = add(node.name) || changed;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (!changed) break;
  }
  return names;
}

/**
 * Чи це питання «список порожній?», а не «скільки їх?».
 *
 * 🔴 ЛИШЕ НУЛЬ. Порівняння з будь-яким іншим числом — уже твердження про
 * кількість: `countries.length === 1 ? 'country' : 'countries'` обирає
 * однину за кодами й стоїть у самому дефекті (llms.txt:52).
 */
export function isEmptinessTest(node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) return true;
    const COMPARE = [
      ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken,
    ];
    if (!COMPARE.includes(op)) return false;
    const other = p.left === node ? p.right : p.left;
    return ts.isNumericLiteral(other) && other.text === '0';
  }
  if (ts.isIfStatement(p) && p.expression === node) return true;
  if (ts.isConditionalExpression(p) && p.condition === node) return true;
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return true;
  return false;
}

/** Чи вузол лежить в аргументах `console.*` — журнал збірки, не читач. */
export function insideConsoleCall(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (
      ts.isCallExpression(p) &&
      ts.isPropertyAccessExpression(p.expression) &&
      ts.isIdentifier(p.expression.expression) &&
      p.expression.expression.text === 'console'
    ) {
      return true;
    }
  }
  return false;
}

/** Кожне місце в одному файлі, де кількість країн узята з довжини кодів. */
export function findings(source, fileName = 'x.tsx') {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const names = taintedNames(sf);
  const out = [];

  const visit = (node) => {
    const isCount =
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === 'length' || node.name.text === 'size') &&
      isTainted(node.expression, names);
    if (isCount && !isEmptinessTest(node) && !insideConsoleCall(node)) {
      out.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        expr: node.getText(sf).replace(/\s+/g, ' ').slice(0, 60),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Чим є файл під `src/`. «Невідоме» — це помилка, а не порожнеча. */
export function classify(rel) {
  const top = rel.split('/')[0];
  if (Object.hasOwn(EXCLUDED, top) && rel.includes('/')) return 'excluded';
  if (/\.tsx?$/.test(rel)) return 'code';
  // 🔴 CAMP-365: розмітка CMS — СВІДОМИЙ `skip`, і це не те саме
  // рішення, що в сусіднього сторожа.
  //
  // `check-hardcoded-counts.mjs` читає `.md`, бо його предмет — число,
  // НАДРУКОВАНЕ в тексті, який бачить читач. Предмет цього сторожа
  // інший: вираз `щось.length`, узятий за кількість країн. У прозі
  // виразів немає, тож читати її тут нічого — а «не розібрано» було б
  // неправдою про те, що ми не знаємо типу.
  if (/\.md$/.test(rel)) return 'skip';
  if (/\.(?:json|css|ico|svg|txt|webmanifest)$/.test(rel)) return 'skip';
  return 'unknown';
}

/**
 * Прохід по дереву. Читач і обхід інʼєктовані, щоб самоперевірка
 * проганяла ВЕСЬ шлях — від імені файлу до скарги, — а не лише чисті
 * функції, на які він спирається.
 */
export function scan(srcDir, read = (f) => readFileSync(f, 'utf8'), walk = readdirSync) {
  const result = { found: [], problems: [], scanned: 0, pages: 0, sourced: 0, excluded: 0 };
  const visit = (abs, rel) => {
    for (const e of walk(abs, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
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
      if (SOURCE_TYPES.test(text)) result.sourced += 1;
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
 * 🔴 ДРУГИЙ РЯДОК ТУТ ВАЖЛИВІШИЙ ЗА ПЕРШИЙ. Перейменують `getCountries`
 * — і сторож зеленітиме вічно, бо шукатиме імені, якого в дереві вже
 * немає. «Жодного файлу з відповіддю /spots/countries» означає, що
 * сторож дивиться не на те, а не що все гаразд.
 */
export function structuralProblems(r) {
  const out = [];
  if (r.pages === 0) out.push({ file: '(усе дерево)', why: 'жодного page.tsx не прочитано — прохід дивився не туди' });
  if (r.sourced === 0) {
    out.push({
      file: '(усе дерево)',
      why: `жодного файлу зі згадкою ${SOURCE_TYPES.source} — джерело перейменували, і сторож шукає те, чого немає`,
    });
  }
  return out;
}

/** Скарга як текст — окремо від `run`, щоб її могла прочитати самоперевірка. */
export function report(found, problems) {
  const out = [];
  if (found.length > 0) {
    out.push(`✗ ${found.length} місц(е/я), де кількість країн узята з довжини списку кодів:\n`);
    for (const f of found) out.push(`  apps/web/src/${f.file}:${f.line}   ${f.expr}`);
    out.push(
      '\n  `/spots/countries` віддає КОДИ: 28 станом на 15.10.2026, бо `ax`\n' +
        '  (Аландські острови) має власний ISO-код, а держава-член — Фінляндія.\n' +
        '  Для числа ДЕРЖАВ візьми `memberStateCount(codes)` з\n' +
        '  apps/web/src/lib/campsite-count.ts. Якщо тут справді треба знати,\n' +
        '  чи список порожній, — порівняй із 0, і сторож промовчить.',
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
      `✓ check-country-count: ${r.scanned} файлів (з них ${r.pages} сторінок, ` +
        `${r.sourced} зі списком країн від API), жодної кількості країн із довжини кодів; ` +
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
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      rc = 1;
    }
  };
  // Вирок як рядок: «що саме знайдено», щоб випадок, який став зеленим
  // з іншої причини, не прочитався як той самий випадок.
  const hits = (src, file = 'x.tsx') => findings(src, file).map((f) => `${f.line}:${f.expr}`);
  const red = (name, src, file) => is(name, hits(src, file).length > 0, true);
  const green = (name, src, file) => is(name, hits(src, file), []);

  // ── 🔴 ЧОТИРИ ДОПРАВОЧНІ СТАНИ, кожен у своїй формі ──────────────
  //
  // Це не вигадані приклади: форми зняті з `git show` на стані перед
  // виправленням. Сторож, народжений із падіння і не прочитаний цим
  // падінням, нічого не вартий.

  red('🔴 /camping: countries.length у description',
    "const countries = await getCountries();\nexport const m = { description: `${t} campsites across ${countries.length} countries.` };");
  red('🔴 /map: countries.length із Promise.all у description',
    'const [onTheMap, countries] = await Promise.all([f(), getCountries()]);\n' +
      'export const m = { description: `${b} campsites across ${countries.length} countries, on one map.` };');
  red('🔴 /search: countries.length аргументом у хелпер, що будує речення',
    'const [summary, countries] = await Promise.all([getSummary(), getCountries()]);\n' +
      'export default () => <p>{searchLead(printable(summary.spots), countries.length)}</p>;');
  red('🔴 llms.txt: countries.length у тілі текстового маршруту',
    "const countries = await getCountries();\n" +
      "export const b = `${countries.length} ${countries.length === 1 ? 'country' : 'countries'}, `;",
    'route.ts');

  // 🔴 СВІЖОВИГАДАНИЙ ПʼЯТИЙ: дедуплікація кодів через Set. Нова форма,
  // той самий дефект — `ax` і `fi` лишаються двома різними кодами.
  red('🔴 пʼята форма: new Set(codes).size',
    'const countries = await getCountries();\n' +
      'export const m = { description: `across ${new Set(countries.map((c) => c.country)).size} countries` };');

  // ── кожне ДЖЕРЕЛО походження окремо ──────────────────────────────
  // Викинь одне з них — почервоніє рівно цей випадок, а не підсумок.
  red('джерело: getCountries()', 'const c = await getCountries();\nexport const n = c.length;');
  red('джерело: getPlaces() (побудований на getCountries)',
    'const p = await getPlaces();\nexport const n = p.length;');
  red('джерело: виклик через обʼєкт, api.getCountries()',
    'const c = await api.getCountries();\nexport const n = c.length;');
  red('🔴 джерело: тип пропа, виклику в файлі вже немає',
    'function L({ countries }: { countries: Awaited<ReturnType<typeof getCountries>> }) { return <p>{countries.length} countries</p>; }');
  red('джерело: тип CountrySummary[]',
    'const c: CountrySummary[] = props.list;\nexport const n = c.length;');
  green('не джерело: getGuides() — форма /guides, і вона правильна',
    "const guides = await getGuides();\nconst countries = byCountry(guides);\nexport default () => <p>{countries.length} countries.</p>;");
  green('не джерело: FUEL_COUNTRIES — рівно ЄС-27, форма llms.txt:204',
    'export const b = `covering ${FUEL_COUNTRIES.length} member states. `;', 'route.ts');
  green('не джерело: курований список країн маршруту',
    'export function shape(route) { const countries = route.countries.length; return `${countries} countries`; }');

  // ── кожна ЛАНКА переносу окремо ──────────────────────────────────
  red('перенос: пряме присвоєння', 'const a = await getCountries();\nconst b = a;\nexport const n = b.length;');
  red('перенос: .map()', 'const c = await getCountries();\nexport const n = c.map((x) => x.country).length;');
  red('перенос: .filter()', 'const c = await getCountries();\nexport const n = c.filter(Boolean).length;');
  red('перенос: .sort()', 'const c = await getCountries();\nexport const n = c.sort().length;');
  red('перенос: спред у новий масив', 'const c = await getCountries();\nexport const n = [...c].length;');
  red('перенос: Array.from()', 'const c = await getCountries();\nexport const n = Array.from(c).length;');
  red('перенос: деструктуризація з Promise.all, друга позиція',
    'const [a, c] = await Promise.all([other(), getCountries()]);\nexport const n = c.length;');
  red('перенос: оголошення нижче за використання (нерухома точка)',
    'export const n = () => b.length;\nconst b = a;\nconst a = await getCountries();');
  green('🔴 сусідня позиція в Promise.all не заражена',
    'const [other, c] = await Promise.all([getSummary(), getCountries()]);\nexport const n = other.length;');
  green('🔴 пропущена позиція рахується правильно',
    'const [, other] = await Promise.all([getCountries(), getSummary()]);\nexport const n = other.length;');
  green('метод, що міняє предмет рахунку, не переносить',
    'const c = await getCountries();\nexport const n = c[0].regions.length;');

  // ── виняток на порожнечу: обидві сторони ─────────────────────────
  green('порожнеча: === 0', 'const c = await getCountries();\nexport const e = c.length === 0;');
  green('порожнеча: > 0', 'const c = await getCountries();\nexport const e = c.length > 0;');
  green('порожнеча: if без порівняння', 'const c = await getCountries();\nif (c.length) { f(); }');
  green('порожнеча: заперечення', 'const c = await getCountries();\nexport const e = !c.length;');
  green('порожнеча: у логічному І', 'const c = await getCountries();\nexport const e = c.length && f();');
  green('порожнеча: умова тернарного', 'const c = await getCountries();\nexport const e = c.length ? a : b;');
  red('🔴 порівняння з 1 — це вже твердження про кількість',
    "const c = await getCountries();\nexport const w = c.length === 1 ? 'country' : 'countries';");
  red('порівняння з 27 — теж', 'const c = await getCountries();\nexport const w = c.length === 27;');

  // ── виняток на console.*: обидві сторони ─────────────────────────
  green('console.log не читач — форма places.json/route.ts:43',
    'const p = await getPlaces();\nconsole.log(`places: ${p.length} countries`);', 'route.ts');
  red('🔴 той самий рядок поза console — дефект',
    'const p = await getPlaces();\nexport const b = `places: ${p.length} countries`;', 'route.ts');

  // ── 🔴 СТОРОЖ ЧИТАЄ КОД, А НЕ КОМЕНТАР ───────────────────────────
  // Саме цим сторож, що матчив текст, зупинив колись чужий PR.
  green('🔴 «countries.length» у рядковому коментарі',
    'const c = await getCountries();\n// не бери countries.length — див. CAMP-240\nexport const n = memberStateCount(c.map((x) => x.country));');
  green('🔴 «countries.length» у блоковому коментарі',
    'const c = await getCountries();\n/* countries.length бреше: 28 кодів */\nexport const a = 1;');
  green('🔴 «countries.length» у JSX-коментарі',
    'const c = await getCountries();\nexport default () => <main>{/* countries.length тут був би дефектом */}<p>x</p></main>;');
  green('🔴 «countries.length» усередині рядка з прозою',
    "const c = await getCountries();\nexport const help = 'ніколи не друкуй countries.length як число країн';");
  green('🔴 правильний виклик — memberStateCount — лишається зеленим',
    'const c = await getCountries();\nexport const m = { description: `across ${memberStateCount(c.map((x) => x.country))} countries` };');

  // 🔴 ВІДОМА НАДМІРНА СУВОРІСТЬ, закріплена випадком, а не обіцянкою.
  // Походження тримається за іменем, не за областю видимості: однойменний
  // параметр в іншій функції теж буде помічений. Помилка в бік зайвої
  // скарги, яку видно, а не пропущеного дефекту. Якщо колись це стане
  // справжньою завадою — ось випадок, який почервоніє й нагадає.
  red('🔴 відома межа: однойменна змінна в іншій області теж помічена',
    'const countries = await getCountries();\n' +
      'export const ok = memberStateCount(countries.map((c) => c.country));\n' +
      'function unrelated(countries: string[]) { return countries.length; }',
    'x.ts');

  // ── чисті функції окремо, щоб мутація в них не ховалась ──────────
  is('isSourceCall бачить виклик', isSourceCall(
    ts.createSourceFile('x.ts', 'getCountries()', ts.ScriptTarget.Latest, true).statements[0].expression), true);
  is('isSourceCall не бачить чужого виклику', isSourceCall(
    ts.createSourceFile('x.ts', 'getGuides()', ts.ScriptTarget.Latest, true).statements[0].expression), false);

  // ── область ──────────────────────────────────────────────────────
  is('src/data/ поза оглядом', classify('data/routes/x.ts'), 'excluded');
  is('файл із імʼям «data» — не тека', classify('data.ts'), 'code');
  is('сторінка — код', classify('app/camping/page.tsx'), 'code');
  is('json — не код', classify('generated/gone.json'), 'skip');
  is('🔴 невідомий тип — не мовчання', classify('content/guide.mdx'), 'unknown');
  // CAMP-365: розмітка пропускається СВІДОМО — у прозі немає виразів.
  is('розмітка — свідомий пропуск', classify('content/legal/markup/terms.md'), 'skip');
  is(
    '🔴 .mdx усе ще невідомий — пропускаємо саме .md',
    classify('content/x.mdx'),
    'unknown',
  );

  // ── 🔴 ВЕСЬ ШЛЯХ: від імені файлу до скарги ──────────────────────
  // Випадки вище кличуть `findings` напряму, і мутація «не розбирати
  // файл» їх не торкається.
  {
    const tree = {
      '/s': [['app', 'd'], ['data', 'd']],
      '/s/app': [['a', 'd'], ['b', 'd'], ['c', 'd'], ['x.json', 'f']],
      '/s/app/a': [['page.tsx', 'f']],
      '/s/app/b': [['page.tsx', 'f']],
      '/s/app/c': [['page.tsx', 'f']],
      '/s/data': [['routes.ts', 'f']],
    };
    const files = {
      '/s/app/a/page.tsx': 'const c = await getCountries();\nexport const m = `${c.length} countries`;',
      '/s/app/b/page.tsx': 'const c = await getCountries();\nexport const e = c.length === 0;',
      '/s/data/routes.ts': 'const c = await getCountries();\nexport const m = `${c.length} countries`;',
    };
    const walk = (dir) => (tree[dir] ?? []).map(([name, t]) => ({ name, isDirectory: () => t === 'd' }));
    const read = (f) => {
      if (f === '/s/app/c/page.tsx') throw new Error('EACCES');
      return files[f];
    };
    const r = scan('/s', read, walk);

    is('🔴 через читання файлу: дефект знайдено, порожнеча й data/ — ні',
      r.found.map((f) => `${f.file}:${f.line}`), ['app/a/page.tsx:2']);
    is('🔴 один нечитаний файл — одна проблема, решта прочитана',
      [r.problems.map((p) => p.file), r.scanned], [['app/c/page.tsx'], 2]);
    is('виключене пораховане, а не загублене', r.excluded, 1);
    is('файли з відповіддю API пораховані', r.sourced, 2);
    is('повний прохід структурних проблем не має', structuralProblems(r), []);
  }
  {
    const walk = () => [{ name: 'guide.mdx', isDirectory: () => false }];
    const r = scan('/s', () => '', walk);
    is('🔴 невідомий тип у проході — проблема з іменем файлу', r.problems.map((p) => p.file), ['guide.mdx']);
  }
  is('🔴 порожній прохід — не «чисто»', structuralProblems({ pages: 0, sourced: 0 }).length, 2);
  is('🔴 джерело зникло з дерева — сторож шукає те, чого немає',
    structuralProblems({ pages: 40, sourced: 0 }).length, 1);
  is('сторінки є, джерело є — зауважень немає', structuralProblems({ pages: 40, sourced: 3 }), []);

  // Скарга мусить мати адресу: «є таке» без неї змушує грепати.
  {
    const r = scan(
      '/s',
      () => 'const c = await getCountries();\nexport const m = `${c.length} countries`;',
      (dir) =>
        dir === '/s'
          ? [{ name: 'app', isDirectory: () => true }]
          : dir === '/s/app'
            ? [{ name: 'page.tsx', isDirectory: () => false }]
            : [],
    );
    const said = report(r.found, r.problems).join('\n');
    is('🔴 скарга називає шлях від кореня репозиторію й рядок',
      said.includes('apps/web/src/app/page.tsx:2'), true);
    is('скарга каже, чим це лікувати', said.includes('memberStateCount'), true);
    is('скарга пояснює, чому 28 ≠ 27', said.includes('ax'), true);
    is('нічого не знайдено — нічого й не друкується', report([], []), []);
  }

  const EXPECTED_CASES = 62;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-country-count self-test: ${cases.length} випадків`);
  return rc;
}

// 🔴 Домашня форма. `realpathSync` з боку argv, бо Node лишає argv[1] як
// написано; усередині IIFE з try/catch, бо виклик realpathSync просто в
// `if` виконувався б на кожному імпорті; і `import.meta.url` стоїть у
// порівнянні, бо check-script-entrypoints.mjs читає його саме там.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-country-count.mjs');
  process.exit(action.has('--self-test') ? selfTest() : run());
}
