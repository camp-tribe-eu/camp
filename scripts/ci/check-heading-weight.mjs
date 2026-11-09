#!/usr/bin/env node
/**
 * ВАГУ ЗАГОЛОВКА ВИРІШУЄ ПРАВИЛО, А НЕ КЛАС НА КОЖНОМУ ЗАГОЛОВКУ.
 *
 * 🔴 Замір 09.11.2026, `apps/web/src`: вага стояла класом Tailwind на
 * 151 заголовку в 67 файлах — 80 разів `font-bold` (700) і 71 раз
 * `font-semibold` (600). Тобто заголовок того самого рівня в різних
 * файлах важив по-різному, і рішення ухвалювалось 151 раз окремо.
 *
 * Тема ухвалює його один раз (`fuse 1.0.1.zip`, `assets/main.build.css`):
 *
 *   h1,.h1,…,h6,.h6{font-weight: var(--heading-font-weight)}
 *
 * а число бере з пресету: `"heading_font": "archivo_n7"` → Archivo 700.
 * У нас те саме правило лежить у `globals.css`.
 *
 * ЦІНА ХИБНОГО СПРАЦЮВАННЯ: збірка червоніє на PR, який поставив вагу
 * класом на `<hN>`. Виправлення — прибрати клас; правило вже є.
 * Площа ураження дорівнює площі дефекту: рівно ті теги, що його творять.
 *
 * 🔴 МЕЖА, ЯКУ ТРЕБА ЗНАТИ. Сторож бачить лише класи Tailwind у відкривній
 * частині тега `h1`…`h6`. Вага, задана інлайновим стилем, чужим класом або
 * на `div`, що ВИГЛЯДАЄ заголовком, йому невидима. Нуль тут не доводить,
 * що ваги узгоджені всюди — він доводить лише, що цей шлях закрито.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Класи ваги Tailwind. Перелік повний, а не «ті, що трапились». */
export const WEIGHT_CLASS =
  /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g;

const EXT = /\.(tsx|jsx)$/;

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

/**
 * Межі відкривної частини кожного `<hN …>`.
 *
 * 🔴 Шукається не регуляркою «до першого `>`»: у JSX усередині тега живуть
 * вирази з `>` (`{n > 0 ? …}`) і рядки з `>`. Тому йдемо посимвольно,
 * рахуючи фігурні дужки й пропускаючи вміст лапок.
 */
export function headingTagSpans(src) {
  const spans = [];
  const re = /<h[1-6](?=[\s/>])/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index;
    let depth = 0;
    let quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const end = Math.min(i + 1, src.length);
    spans.push([m.index, end]);
    re.lastIndex = end;
  }
  return spans;
}

/** Рядок (1-based) і знайдений клас для кожного порушення у файлі. */
export function violationsIn(src) {
  const out = [];
  for (const [a, b] of headingTagSpans(src)) {
    const tag = src.slice(a, b);
    WEIGHT_CLASS.lastIndex = 0;
    let hit;
    while ((hit = WEIGHT_CLASS.exec(tag)) !== null) {
      const line = src.slice(0, a + hit.index).split('\n').length;
      out.push({ line, cls: hit[0], tag: tag.slice(0, 12) });
    }
  }
  return out;
}

/**
 * 🔴 Набір доводить, що сторож ЧЕРВОНІЄ, а не просто існує. Рядок із
 * власною назвою друкується лише тоді, коли виконано рівно EXPECTED
 * випадків і жоден не впав.
 */
function selfTest() {
  const EXPECTED = 7;
  let done = 0;
  const ok = (name, cond) => {
    if (!cond) {
      console.error(`  ✗ ${name}`);
      process.exit(1);
    }
    console.log(`  ✓ ${name}`);
    done += 1;
  };

  ok(
    'однорядковий заголовок із вагою — порушення',
    violationsIn('<h2 className="text-xl font-bold">x</h2>').length === 1,
  );
  ok(
    'багаторядковий заголовок із вагою — теж порушення',
    violationsIn('<h2\n  id="a"\n  className="text-xl font-semibold"\n>\nx</h2>')
      .length === 1,
  );
  ok(
    'заголовок без ваги — чисто',
    violationsIn('<h1 className="text-3xl">x</h1>').length === 0,
  );
  // 🔴 Вага поза заголовком — не наша справа: кнопка й підпис мають право.
  ok(
    'font-semibold на кнопці не зараховується',
    violationsIn('<button className="font-semibold">x</button>').length === 0,
  );
  // 🔴 Через це наївне «до першого >» давало хибні межі.
  ok(
    'вираз із > усередині тега не обриває розбір',
    violationsIn('<h3 className={n > 0 ? "font-bold" : "x"}>y</h3>').length === 1,
  );
  ok(
    'текст ПІСЛЯ заголовка не зараховується',
    violationsIn('<h2 className="text-xl">x</h2>\n<p className="font-bold">y</p>')
      .length === 0,
  );
  ok(
    'рядок називається правильно',
    violationsIn('\n\n<h2 className="font-bold">x</h2>')[0].line === 3,
  );

  if (done !== EXPECTED) {
    console.error(`::error::виконано ${done} випадків із ${EXPECTED}`);
    process.exit(1);
  }
  console.log(`check-heading-weight self-test: усе гаразд (${done} випадків)`);
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const root = process.argv[2] ?? 'apps/web/src';
  const files = walk(root);
  const bad = [];
  for (const f of files) {
    for (const v of violationsIn(readFileSync(f, 'utf8'))) {
      bad.push(`${relative(process.cwd(), f)}:${v.line}  ${v.cls}`);
    }
  }
  if (bad.length) {
    console.error(
      `::error::вага заголовка задана класом у ${bad.length} місці(ях). ` +
        'Вагу всіх h1…h6 задає одне правило в globals.css (700, як у темі) — ' +
        'приберіть клас. Якщо цьому заголовку справді потрібна інша вага, ' +
        'вона описується НАЗВАНИМ класом у globals.css із причиною, а не ' +
        'утилітою на місці: інакше наступний такий заголовок вирішить сам.',
    );
    for (const b of bad.slice(0, 20)) console.error(`  ${b}`);
    process.exit(1);
  }
  console.log(
    `✓ вага заголовка: жодного класу ваги на h1…h6 (${files.length} файлів)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
