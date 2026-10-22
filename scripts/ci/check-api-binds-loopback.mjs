#!/usr/bin/env node
// CAMP-385: API не сміє викликати `listen` без адреси.
//
//   node scripts/ci/check-api-binds-loopback.mjs
//   node scripts/ci/check-api-binds-loopback.mjs --root <тека>   # інший корінь
//   node scripts/ci/check-api-binds-loopback.mjs --self-test
//
// 🔴 ЗВІДКИ ЦЕ ВЗЯЛОСЬ. 22.10.2026 на машині `ss -ltn` показав `*:3001` —
// API слухало всі інтерфейси, бо apps/api/src/main.ts викликав
// `app.listen(process.env.PORT ?? 3000)` без другого аргументу, а Nest без
// нього біндить 0.0.0.0. Юніт systemd поруч стверджував «слухає лише
// локально — назовні його пускає Caddy, не ufw». Неправда в обидва боки:
// слухало не локально, і тримав його саме ufw — у ньому не було дозволу на
// 3001, тож спрацьовувала заборона за замовчуванням. Між /auth/signup
// (шле справжню пошту на будь-яку адресу) і світом стояло одне правило
// фаєрвола, яке хтось додасть «для налагодження».
//
// 🔴 ЩО ПЕРЕВІРЯЄТЬСЯ, І ЩО НІ.
//
// Кожен виклик `.listen(…)` у джерелах API (`apps/api/src`, без `*.spec.ts`
// і `*.d.ts`) мусить мати адресу: другий аргумент, який не є колбеком, не є
// числом (backlog), не є wildcard-рядком і не є `undefined`. Специ поза
// сторожем навмисно: вони слухають порт 0 на час тесту, і площа ураження
// сторожа не має перевищувати площу дефекту — дефект був у процесі, що
// живе на машині з маршрутами пошти.
//
// 🔴 ЧОМУ ЧЕРЕЗ AST, А НЕ РЕГУЛЯРКОЮ. `.listen(` у коментарі, у рядку, у
// шаблоні — це не виклик, і регулярка цього не знає. check-script-
// entrypoints.mjs уже читає репозиторій компілятором TypeScript; тут та
// сама залежність, і коштує вона рівно нуль.
//
// 🔴 `??` ВІДМОВЛЯЄТЬСЯ, І ЦЕ ЗАМІРЯНО, А НЕ СМАК. `listen(port, '')` на
// Node 22.23.2 і 24.18.0 біндить `:::` — усі інтерфейси. `HOST=` порожнім
// рядком у `.env` (саме так його читають і EnvironmentFile, і ConfigModule)
// при `process.env.HOST ?? '127.0.0.1'` пройшов би як адреса. Тому запасне
// значення мусить стояти за `||`, і запасне значення мусить бути петлею.
//
// 🔴 АДРЕСУ ТРЕБА ДОВЕСТИ, А НЕ ЛИШЕ ПЕРЕДАТИ. Рецензія PR #319
// (22.10.2026) показала точну форму, якою дефект повернеться: хтось
// прибере «зайвий» `|| '127.0.0.1'` і лишить `app.listen(port,
// process.env.HOST)` — а `listen(port, undefined)` біндить `::` (заміряно
// на Node 22.23.2 і 24.18.0), тобто знову `*:3001`. Перша редакція цього
// файлу пропускала це як «ідентифікатор, який не розвʼязується», і то була
// не межа, а дірка рівно по формі дефекту. Тому вираз без літерала
// вважається НЕДОВЕДЕНИМ і червоніє: адресою є лише `'127.0.0.1'`, або
// `<будь-що> || '127.0.0.1'`, або тернарник чи `host:` в опціях, де кожна
// гілка доведена так само.
//
// 🔴 РІВНО `'127.0.0.1'`, НЕ `'localhost'` І НЕ `'::1'` — ЗАМІРЯНО:
// `listen(0, 'localhost')` на Node 22.23.2 і 24.18.0 біндить ЛИШЕ `::1`, а
// Caddy ходить на `127.0.0.1:3001` (infra/caddy/camptribe.eu.caddyfile).
// `|| 'localhost'` був би зелений у CI і дав би 502 на всьому /api/* у
// проді.
//
// 🔴 ПРОГІН, ЩО НЕ ЗНАЙШОВ ЖОДНОГО `listen`, — ПРОВАЛ, А НЕ ✓. Сторож існує
// заради одного виклику в main.ts; якщо він його не прочитав, він читав не
// те. Підлога самоскасовна: вона не залежить від лічильника файлів, який
// хтось колись забуде підняти.

import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction, flagValue } from '../lib/entrypoint.mjs';

const WHO = 'check-api-binds-loopback';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..');

/** Де живе процес, що був на `*:3001`. Відносно кореня, щоб `--root` міняв лише корінь. */
export const SCOPE = 'apps/api/src';

/** Файл, через який усе почалось. Прогін, що його не бачив, не рахується. */
export const THE_FILE = 'apps/api/src/main.ts';

/**
 * Рядки, які означають «усі інтерфейси», а не адресу.
 *
 * 🔴 ПОРОЖНІЙ РЯДОК ТУТ ЗА ЗАМІРОМ: `listen(0, '')` → `:::63466` на Node 22
 * і 24 (22.10.2026). Він і є дорогою, якою `HOST=` у `.env` робить API
 * публічним крізь `??`.
 */
export const WILDCARDS = new Set(['', '0.0.0.0', '::', '::0', '0:0:0:0:0:0:0:0']);

/** Єдина адреса, яку сторож приймає: та, на яку ходить Caddy. */
export const LOOPBACK = '127.0.0.1';

/** Чи належить файл до того, що сторож читає. */
export function inScope(rel) {
  if (!rel.startsWith(`${SCOPE}/`)) return false;
  if (!rel.endsWith('.ts')) return false;
  if (rel.endsWith('.d.ts')) return false;
  return !/\.(spec|test)\.ts$/.test(rel);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Файли під коренем, які сторож читає, відносними шляхами. */
export function scopedFiles(root) {
  const dir = path.join(root, SCOPE);
  let found;
  try {
    found = walk(dir);
  } catch {
    return [];
  }
  return found
    .map((p) => path.relative(root, p))
    .filter(inScope)
    .sort();
}

/** Чи це виклик `.listen(` — через крапку або `['listen']`. */
function isListenCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'listen';
  if (ts.isElementAccessExpression(callee)) {
    const a = callee.argumentExpression;
    return ts.isStringLiteralLike(a) && a.text === 'listen';
  }
  return false;
}

// 🔴 `satisfies` і `!` — з рецензії PR #319: `'0.0.0.0' satisfies string`
// і `(HOST ?? '127.0.0.1')!` проходили повз першу редакцію як «не літерал».
function unwrap(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

/**
 * Чому цей вираз НЕ є доведеною адресою — або `null`, якщо доведена.
 *
 * Доведена адреса — це літерал `'127.0.0.1'`, або `<будь-що> || <доведена>`,
 * або тернарник, де доведені обидві гілки. Усе інше — не «невідомо», а
 * провал: `listen(port, undefined)` біндить `::`, і голий `process.env.HOST`
 * — найімовірніша форма повернення дефекту (рецензія PR #319).
 *
 * 🔴 Запасне значення за `||` перевіряється ТИМ САМИМ правилом: саме воно
 * і біжить на машині, де змінну ніхто не задав. А непорожній рядковий
 * літерал ЛІВОРУЧ від `||` завжди істинний, тож тоді біжить він, а не
 * запасне: `'0.0.0.0' || '127.0.0.1'` є `'0.0.0.0'`.
 */
export function whyNotAddress(expr, sf) {
  const e = unwrap(expr);
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
    return 'другий аргумент — колбек, адреси немає';
  }
  if (ts.isNumericLiteral(e)) {
    return 'другий аргумент — число (backlog), адреси немає';
  }
  if (ts.isStringLiteralLike(e)) {
    if (WILDCARDS.has(e.text)) return `адреса ${JSON.stringify(e.text)} означає всі інтерфейси`;
    if (e.text !== LOOPBACK) {
      return `адреса ${JSON.stringify(e.text)} — не ${LOOPBACK}, куди ходить Caddy: 'localhost' біндить лише ::1 (заміряно 22.10.2026), і це 502 на всьому /api/*`;
    }
    return null;
  }
  if (e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) {
    return 'адреса undefined/null — Node візьме всі інтерфейси';
  }
  if (ts.isSpreadElement(e)) {
    return 'аргументи розгорнуто (...), адреси не видно';
  }
  if (ts.isBinaryExpression(e)) {
    if (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return "запасне значення за `??`: `HOST=` порожнім рядком у .env проходить як адреса, а listen(port, '') слухає все (заміряно 22.10.2026) — пиши `||`";
    }
    if (e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const left = unwrap(e.left);
      if (ts.isStringLiteralLike(left) && left.text !== '') {
        const why = whyNotAddress(left, sf);
        return why === null ? null : `ліворуч від || завжди істинний рядок, запасне не біжить: ${why}`;
      }
      const why = whyNotAddress(e.right, sf);
      return why === null ? null : `запасне значення: ${why}`;
    }
  }
  if (ts.isConditionalExpression(e)) {
    return whyNotAddress(e.whenTrue, sf) ?? whyNotAddress(e.whenFalse, sf);
  }
  return (
    `адресу не доведено: ${e.getText(sf)} без \`|| '${LOOPBACK}'\` — ` +
    'listen(port, undefined) біндить :: (заміряно 22.10.2026), і саме так дефект ' +
    'повернеться, коли хтось прибере «зайвий» запасний літерал'
  );
}

/**
 * Вирок одному виклику `.listen(…)`: `null` або причина.
 *
 * Форма з одним обʼєктом (`server.listen({ port, host })`) читається теж:
 * інакше це був би обхід рівно в один рядок.
 */
export function whyBare(call, sf) {
  const args = call.arguments;
  if (args.length === 0) return 'жодного аргументу: Node слухає всі інтерфейси';
  const first = unwrap(args[0]);
  if (args.length === 1 && ts.isObjectLiteralExpression(first)) {
    const host = first.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'host',
    );
    if (host === undefined) return 'в опціях немає `host`: Node слухає всі інтерфейси';
    return whyNotAddress(host.initializer, sf);
  }
  if (args.length < 2) return 'другого аргументу немає — це і був `*:3001` на проді';
  return whyNotAddress(args[1], sf);
}

/** Усі виклики `.listen(` у тексті, кожен зі своїм вироком. */
export function listenCalls(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (isListenCall(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push({ line: line + 1, text: node.getText(sf), why: whyBare(node, sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Вирок дереву під `root`. Чиста функція: `main()` її лише друкує, а
 * самотест — питає, і обидва читають одне й те саме.
 */
export function verdict(root, read = (p) => readFileSync(p, 'utf8')) {
  const files = scopedFiles(root);
  const calls = [];
  const offences = [];
  for (const rel of files) {
    for (const c of listenCalls(read(path.join(root, rel)), rel)) {
      calls.push({ file: rel, ...c });
      if (c.why !== null) offences.push({ file: rel, line: c.line, why: c.why, text: c.text });
    }
  }
  return { files, calls, offences };
}

/**
 * Чи прогін щось довів. Нуль викликів — це не «чисто», це «не читав».
 *
 * 🔴 Чиста і окрема, бо інакше підлогу не дістати із самотесту: у
 * check-pipe-to-grep-q.mjs рецензія знайшла її всередині `main()`, де
 * жодна мутація її не валила.
 */
export function verdictOk(v) {
  return v.offences.length === 0 && v.calls.length >= 1 && v.files.includes(THE_FILE);
}

function main(root) {
  const v = verdict(root);
  if (v.offences.length > 0) {
    console.error(`✗ ${WHO}: listen без адреси (${v.offences.length}):\n`);
    for (const o of v.offences) {
      console.error(`  ${o.file}:${o.line}  ${o.text}`);
      console.error(`      ${o.why}`);
    }
    console.error(
      '\n  Nest без адреси слухає 0.0.0.0 — так API було на *:3001 22.10.2026,\n' +
        '  і від інтернету його тримало одне правило ufw. Пиши\n' +
        "  app.listen(port, process.env.HOST || '127.0.0.1').",
    );
    return 1;
  }
  if (!v.files.includes(THE_FILE)) {
    console.error(`✗ ${WHO}: ${THE_FILE} не прочитано (корінь ${root}) — прогін нічого не довів`);
    return 1;
  }
  if (v.calls.length === 0) {
    console.error(`✗ ${WHO}: у ${v.files.length} файлах під ${SCOPE} жодного .listen( — прогін нічого не довів`);
    return 1;
  }
  console.log(`✓ ${WHO}: ${v.files.length} файлів, ${v.calls.length} listen, кожен з адресою`);
  return 0;
}

// ── самотест ──────────────────────────────────────────────────────────

/** Тека з одним main.ts під SCOPE, щоб прогнати СПРАВЖНІЙ CLI на фікстурі. */
function fixtureRoot(mainText) {
  const root = mkdtempSync(path.join(tmpdir(), 'camp385-'));
  mkdirSync(path.join(root, SCOPE), { recursive: true });
  writeFileSync(path.join(root, THE_FILE), mainText);
  return root;
}

/** Код виходу справжнього процесу на фікстурі — свідок проти «завжди 0». */
function runCli(root) {
  try {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const why = (src) => listenCalls(src, 'x.ts').map((c) => c.why);

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

  // ── форма дефекту, і форма виправлення ──
  is('🔴 рядок, що був на проді: listen(port) без адреси',
    why(`await app.listen(process.env.PORT ?? 3000);`),
    ['другого аргументу немає — це і був `*:3001` на проді']);
  is('виправлена форма проходить',
    why(`await app.listen(process.env.PORT ?? 3000, process.env.HOST || '127.0.0.1');`),
    [null]);
  is('listen() без аргументів', why(`app.listen();`).length, 1);
  is('🔴 колбек на місці адреси — не адреса', why(`app.listen(3000, () => ready());`),
    ['другий аргумент — колбек, адреси немає']);
  is('🔴 function-вираз теж колбек', why(`app.listen(3000, function () {});`),
    ['другий аргумент — колбек, адреси немає']);
  is('🔴 число на місці адреси — це backlog', why(`app.listen(3000, 511);`),
    ['другий аргумент — число (backlog), адреси немає']);
  is("🔴 '0.0.0.0' літералом — рівно дефект, написаний руками",
    why(`app.listen(3000, '0.0.0.0');`), ['адреса "0.0.0.0" означає всі інтерфейси']);
  is("🔴 '::' так само", why(`app.listen(3000, '::');`), ['адреса "::" означає всі інтерфейси']);
  is("🔴 порожній рядок — заміряно: listen(port, '') слухає :::",
    why(`app.listen(3000, '');`), ['адреса "" означає всі інтерфейси']);
  is('🔴 undefined на місці адреси', why(`app.listen(3000, undefined);`).length, 1);
  is('🔴 null на місці адреси', why(`app.listen(3000, null);`).length, 1);
  is("рівно '127.0.0.1' — адреса", why(`a.listen(1, '127.0.0.1');`), [null]);
  // 🔴 Рецензія PR #319: `listen(0, 'localhost')` біндить ЛИШЕ ::1, а Caddy
  // ходить на 127.0.0.1 — зелений CI і 502 на /api/* у проді.
  is("🔴 'localhost' — не адреса: біндить лише ::1 (заміряно)",
    why(`b.listen(2, 'localhost');`).map((w) => w !== null && w.includes('localhost')), [true]);
  is("🔴 '::1' — ні, з тієї ж причини", why(`c.listen(3, '::1');`).length, 1);
  is("🔴 `|| 'localhost'` червоніє", why(`app.listen(p, process.env.HOST || 'localhost');`).length, 1);
  is('три аргументи: адреса і колбек', why(`app.listen(3000, '127.0.0.1', () => {});`), [null]);

  // ── запасні значення ──
  is('🔴 `??` відмовляється: порожній HOST= проходить як адреса',
    why(`app.listen(p, process.env.HOST ?? '127.0.0.1');`).map((w) => w !== null && w.includes('`??`')),
    [true]);
  is('🔴 …і в дужках теж', why(`app.listen(p, (process.env.HOST ?? '127.0.0.1'));`).length, 1);
  is("🔴 `||` з wildcard-запасним — запасне і біжить на машині",
    why(`app.listen(p, process.env.HOST || '0.0.0.0');`),
    ['запасне значення: адреса "0.0.0.0" означає всі інтерфейси']);
  is('🔴 тернарник з однією wildcard-гілкою',
    why(`app.listen(p, dev ? '0.0.0.0' : '127.0.0.1');`).length, 1);
  is('тернарник з двома доведеними гілками проходить',
    why(`app.listen(p, dev ? '127.0.0.1' : '127.0.0.1');`), [null]);
  is('🔴 spread: адреси не видно', why(`app.listen(...args);`).length, 1);

  // ── форма з опціями ──
  is('🔴 options без host', why(`server.listen({ port: 3000 });`),
    ['в опціях немає `host`: Node слухає всі інтерфейси']);
  is('options із host-петлею проходить', why(`server.listen({ port: 3000, host: '127.0.0.1' });`), [null]);
  is('🔴 options із host-wildcard', why(`server.listen({ port: 3000, host: '0.0.0.0' });`).length, 1);

  // ── як шукається сам виклик ──
  is("🔴 app['listen'](port) — той самий виклик", why(`app['listen'](3000);`).length, 1);
  is('🔴 (app as any).listen(port) знайдено', why(`(app as any).listen(3000);`).length, 1);
  is('🔴 у коментарі й у рядку — не виклик',
    why(`// app.listen(3000)\nconst s = 'app.listen(3000)';\nconst t = \`app.listen(\${p})\`;`),
    []);
  is('два виклики — два вироки', why(`a.listen(1);\nb.listen(2);`).length, 2);
  is('номер рядка — рядок виклику',
    listenCalls(`const a = 1;\n\nawait app.listen(3000);`, 'x.ts').map((c) => c.line), [3]);
  is('listen без крапки — не метод, не наш', why(`listen(3000);`), []);

  // ── 🔴 адресу треба довести (рецензія PR #319) ──
  //
  // Перша редакція приймала `app.listen(p, host)` як «межу». Рецензія
  // показала, що це дірка рівно по формі дефекту: прибрати `|| '127.0.0.1'`
  // — і сторож зелений, а рантайм на `::`.
  is('🔴 голий process.env.HOST — точна форма повернення дефекту — червоніє',
    why(`await app.listen(process.env.PORT ?? 3000, process.env.HOST);`)
      .map((w) => w !== null && w.includes('не доведено')), [true]);
  is('🔴 ідентифікатор без запасного — не доведено', why(`app.listen(p, host);`).length, 1);
  is('🔴 `HOST || process.env.API_HOST` — запасне теж не доведено',
    why(`app.listen(p, process.env.HOST || process.env.API_HOST);`).length, 1);
  is("🔴 ConfigService.get('HOST') — не доведено",
    why(`app.listen(p, app.get(ConfigService).get('HOST'));`).length, 1);
  is("…а те саме з `|| '127.0.0.1'` — доведено",
    why(`app.listen(p, app.get(ConfigService).get('HOST') || '127.0.0.1');`), [null]);
  is('ланцюжок || із літералом наприкінці — доведено',
    why(`app.listen(p, process.env.HOST || process.env.API_HOST || '127.0.0.1');`), [null]);
  is("🔴 '0.0.0.0' || '127.0.0.1' — ліворуч істинний рядок, запасне не біжить",
    why(`app.listen(p, '0.0.0.0' || '127.0.0.1');`).length, 1);
  is("'' || '127.0.0.1' — порожній ліворуч, біжить запасне",
    why(`app.listen(p, '' || '127.0.0.1');`), [null]);
  is('🔴 тернарник із недоведеною гілкою',
    why(`app.listen(p, dev ? process.env.HOST : '127.0.0.1');`).length, 1);
  is('🔴 options із host: process.env.HOST — не доведено',
    why(`server.listen({ port: 3000, host: process.env.HOST });`).length, 1);

  // ── unwrap: satisfies і ! (рецензія PR #319) ──
  is("🔴 '0.0.0.0' satisfies string — знайдено крізь satisfies",
    why(`app.listen(p, '0.0.0.0' satisfies string);`).length, 1);
  is("🔴 (HOST ?? '127.0.0.1')! — знайдено крізь !",
    why(`app.listen(p, (process.env.HOST ?? '127.0.0.1')!);`).length, 1);
  is("'127.0.0.1' satisfies string — доведено",
    why(`app.listen(p, '127.0.0.1' satisfies string);`), [null]);

  // ── область ──
  is('main.ts у області', inScope('apps/api/src/main.ts'), true);
  is('глибший файл у області', inScope('apps/api/src/osm/import-main.ts'), true);
  is('🔴 спец поза областю навмисно', inScope('apps/api/src/cors.spec.ts'), false);
  is('.test.ts так само', inScope('apps/api/src/x.test.ts'), false);
  is('.d.ts поза областю', inScope('apps/api/src/types.d.ts'), false);
  is('веб поза областю', inScope('apps/web/src/lib/api.ts'), false);
  is('.mjs поза областю', inScope('apps/api/src/x.mjs'), false);

  // ── підлога: нуль викликів — провал ──
  const ok = { files: [THE_FILE], calls: [{}], offences: [] };
  is('чисто і прочитано — ✓', verdictOk(ok), true);
  is('🔴 нуль викликів — провал, не ✓', verdictOk({ ...ok, calls: [] }), false);
  is('🔴 main.ts не прочитано — провал', verdictOk({ ...ok, files: ['apps/api/src/other.ts'] }), false);
  is('🔴 одне порушення — провал', verdictOk({ ...ok, offences: [{}] }), false);

  // ── справжнє дерево, без підмінників ──
  {
    const v = verdict(REPO_ROOT);
    is('справжній main.ts прочитано', v.files.includes(THE_FILE), true);
    is('у справжньому дереві ≥ 1 listen', v.calls.length >= 1, true);
    is('🔴 справжнє дерево чисте', v.offences, []);
    is('усі прочитані файли — з області', v.files.every(inScope), true);
    is('спеців серед прочитаних немає', v.files.filter((f) => f.includes('.spec.')), []);
  }

  // ── 🔴 СПРАВЖНІЙ ПРОЦЕС НА ФІКСТУРІ — свідок проти «завжди 0» ──
  //
  // Усе вище питає функції. Сторож, у якого `main()` повертає 0 незалежно
  // від вироку, пройшов би кожен випадок вище зеленим. Тому тут
  // запускається цей самий файл як окремий процес на теці з дефектом і
  // на теці з виправленням, і читаються коди виходу.
  const bad = fixtureRoot(`async function b() {\n  await app.listen(process.env.PORT ?? 3000);\n}\n`);
  const good = fixtureRoot(`async function b() {\n  await app.listen(process.env.PORT ?? 3000, process.env.HOST || '127.0.0.1');\n}\n`);
  const none = fixtureRoot(`export const x = 1;\n`);
  try {
    const r1 = runCli(bad);
    is('🔴 процес на дефекті виходить з 1', r1.code, 1);
    is('…і називає файл та рядок', r1.out.includes(`${THE_FILE}:2`), true);
    is('…і каже, що саме не так', r1.out.includes('другого аргументу немає'), true);
    const r2 = runCli(good);
    is('процес на виправленні виходить з 0', r2.code, 0);
    is('…і друкує ✓ зі своїм іменем', r2.out.includes(`✓ ${WHO}:`), true);
    const r3 = runCli(none);
    is('🔴 процес без жодного listen виходить з 1 — підлога', r3.code, 1);
    const r4 = runCli(path.join(none, 'nope'));
    is('🔴 корінь без apps/api/src — теж 1', r4.code, 1);
  } finally {
    for (const d of [bad, good, none]) rmSync(d, { recursive: true, force: true });
  }

  // Рецензія PR #319: 52 − 2 (localhost/::1 як адреси; «межа» ідентифікатора)
  // + 4 (рівно 127.0.0.1) + 10 (адресу треба довести) + 3 (satisfies, !).
  const EXPECTED_CASES = 67;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ ${WHO} self-test: ${cases.length} випадків, listen без адреси червоніє`);
  else console.error(`::error::${WHO} self-test провалено`);
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
  const argv = process.argv.slice(2);
  const action = chooseAction(argv, ['--self-test', '--root'], `${WHO}.mjs`, { takesValue: ['--root'] });
  if (action.has('--self-test')) process.exit(selfTest());
  const root = flagValue(argv, '--root');
  process.exit(main(root === undefined ? REPO_ROOT : path.resolve(root)));
}
