#!/usr/bin/env node
// Журнал Caddy не сміє нести наші секретні заголовки відкритим текстом.
//
//   node scripts/ci/check-caddy-log-redaction.mjs
//   node scripts/ci/check-caddy-log-redaction.mjs --self-test
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ ІСНУЄ. Заміряно на проді 13.11.2026: 618 рядків
// журналу доступу за 14 діб несли `X-Revalidate-Secret` цілим (48 знаків
// із 48), і ще двічі він ліг у journald через журнал ПОМИЛОК Caddy.
// Caddy сам редагує лише Cookie, Set-Cookie, Authorization і
// Proxy-Authorization; заголовок, який ми вигадали самі, секретом для
// нього не є. Секрет довелось ротувати.
//
// 🔴 ЩО ПЕРЕВІРЯЄТЬСЯ.
//   1. Імена секретних заголовків беруться З КОДУ, а не з переліку в
//      цьому файлі: кожен рядковий літерал `x-…secret|token|key` у
//      `apps/*/src` (без тестів). Новий такий заголовок у коді без рядка
//      в Caddyfile — провал.
//   2. У Caddyfile мусить бути `log default` у глобальних опціях: туди
//      Caddy пише помилки запитів (`http.log.error.*`) з тими самими
//      заголовками. Фільтр лише в сайтах цей стік лишає відкритим.
//   3. КОЖЕН блок `log` (глобальний і в кожному сайті) мусить мати
//      `format filter` із рядком `request>headers>Імʼя replace …` або
//      `delete` на кожне імʼя — у канонічному регістрі Go
//      (`X-Revalidate-Secret`): поле шукається точним збігом, і нижній
//      регістр конфіг прийме мовчки, не зредагувавши нічого.
//   4. Параметри рядка запиту з `QUERY_PARAMS` — у `request>uri query`.
//
// 🔴 ЧОГО ЦЕЙ СТОРОЖ НЕ БАЧИТЬ, і це названо:
//   • чи розкладено цей файл на машину — це `camptribe-infra-drift`;
//   • чи Caddy справді редагує: статичний розбір не запускає Caddy
//     (його немає ні в CI, ні на ноутбуці). Поведінку заміряно на проді
//     13.11.2026 окремим екземпляром на петлі, в обох стоках;
//   • секретний заголовок, чиє імʼя не закінчується на
//     secret/token/key, і заголовок, зібраний у коді не літералом;
//   • `import` усередині `log` сторож не розгортає — і тому відмовляє.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction, flagValue } from '../lib/entrypoint.mjs';
import { tokenize } from './check-next-routes-reachable.mjs';

const WHO = 'check-caddy-log-redaction';
const DEFAULT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CADDYFILE = 'infra/caddy/camptribe.eu.caddyfile';
const SOURCE_DIRS = ['apps/api/src', 'apps/web/src'];

/** Directus приймає токен і в рядку запиту; це не наш код, тож не з грепа. */
export const QUERY_PARAMS = Object.freeze(['access_token']);

const HEADER_LITERAL = /(['"`])(x-[a-z0-9-]*(?:secret|token|key))\1/gi;
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs)$/;
const TEST_FILE = /(?:\.(?:spec|test)\.[a-z]+$|(?:^|\/)(?:tests?|__tests__)\/)/;
/** Дії фільтра, після яких значення в журналі немає. `hash` лишає відбиток. */
const HIDES = new Set(['replace', 'delete']);

/** `x-revalidate-secret` → `X-Revalidate-Secret`, як це робить Go. */
export function canonical(name) {
  return name.toLowerCase().split('-').map((p) => (p === '' ? p : p[0].toUpperCase() + p.slice(1))).join('-');
}

/** Імена секретних заголовків у текстах коду. Чиста функція. */
export function secretHeaders(files) {
  const found = new Set();
  for (const { file, text } of files) {
    if (!SOURCE_FILE.test(file) || TEST_FILE.test(file)) continue;
    for (const m of text.matchAll(HEADER_LITERAL)) found.add(m[2].toLowerCase());
  }
  return [...found].sort();
}

/** Дерево блоків Caddyfile: { head, line, children|null }. */
function tree(text) {
  const problems = [];
  const root = { head: [], line: 0, children: [] };
  const stack = [root];
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n += 1) {
    const { tokens, error } = tokenize(lines[n]);
    if (error) problems.push(`${CADDYFILE}:${n + 1}: ${error}`);
    if (tokens.length === 0) continue;
    if (tokens.length === 1 && tokens[0] === '}') {
      if (stack.length === 1) problems.push(`${CADDYFILE}:${n + 1}: зайва \`}\``);
      else stack.pop();
      continue;
    }
    const opens = tokens[tokens.length - 1] === '{';
    const node = { head: opens ? tokens.slice(0, -1) : tokens, line: n + 1, children: opens ? [] : null };
    stack[stack.length - 1].children.push(node);
    if (opens) stack.push(node);
  }
  if (stack.length > 1) problems.push(`${CADDYFILE}:${stack[stack.length - 1].line}: блок не закрито`);
  return { root, problems };
}

function holdsImport(node) {
  return (node.children ?? []).some((c) => c.head[0] === 'import' || holdsImport(c));
}

/** Що ховає один блок `log`: поля заголовків і параметри запиту. */
function readLog(node, where) {
  const log = { where, line: node.line, fields: new Map(), query: new Set(), filter: false, unreadable: holdsImport(node) };
  for (const format of (node.children ?? []).filter((c) => c.head[0] === 'format')) {
    if (format.head[1] !== 'filter' || format.children === null) continue;
    log.filter = true;
    const rows = [];
    for (const c of format.children) {
      // `fields { … }` — та сама річ, записана вкладеним блоком.
      if (c.head[0] === 'fields' && c.children !== null) rows.push(...c.children);
      else rows.push(c);
    }
    for (const row of rows) {
      const [field, action, ...rest] = row.head;
      if (field === 'request>uri' && action === 'query' && row.children !== null) {
        for (const q of row.children) {
          if (HIDES.has(q.head[0]) && q.head[1] !== undefined && (q.head[0] === 'delete' || q.head[2])) log.query.add(q.head[1]);
        }
        continue;
      }
      const m = /^request>headers>(.+)$/.exec(field ?? '');
      if (!m) continue;
      const hides = action === 'delete' || (action === 'replace' && rest.length > 0 && rest[0] !== '');
      log.fields.set(m[1], { hides, action, line: row.line });
    }
  }
  return log;
}

/**
 * Чисте ядро: текст Caddyfile + імена заголовків → вирок. Без І/О.
 */
export function audit(caddyText, headers, queryParams = QUERY_PARAMS) {
  const problems = [];
  const { root, problems: syntax } = tree(caddyText);
  problems.push(...syntax.map((p) => `зламаний розбір Caddyfile — ${p}`));

  if (headers.length === 0) {
    problems.push('у коді не знайдено ЖОДНОГО секретного заголовка — або розбір зламався, або теки не ті; прогін нічого не довів');
  }

  const logs = [];
  let hasDefault = false;
  for (const top of root.children) {
    if (top.children === null) continue;
    if (top.head.length > 0 && top.head[0].startsWith('(')) {
      if (top.children.some((c) => c.head[0] === 'log' || c.head[0] === 'format')) {
        problems.push(`${CADDYFILE}:${top.line}: журнал у сніпеті ${top.head[0]} сторож не читає — напиши блок \`log\` у сайті явно`);
      }
      continue;
    }
    const global = top.head.length === 0;
    const where = global ? 'глобальні опції' : `сайт ${top.head.join(' ')}`;
    for (const node of top.children) {
      if (node.head[0] !== 'log') continue;
      const name = global ? (node.head[1] ?? 'default') : null;
      if (name === 'default') hasDefault = true;
      logs.push(readLog(node, global ? `${where}, log ${name}` : where));
    }
  }

  if (!hasDefault) {
    problems.push(
      `${CADDYFILE}: у глобальних опціях немає \`log default\` — помилки запитів (http.log.error.*) Caddy пише в типовий ` +
        'журнал (journald) з усіма заголовками, і фільтр у сайтах його не стосується',
    );
  }

  for (const log of logs) {
    const at = `${CADDYFILE}:${log.line} (${log.where})`;
    if (log.unreadable) { problems.push(`${at}: у блоці \`log\` є \`import\`, якого сторож не розгортає — що там редагується, невідомо`); continue; }
    if (!log.filter) { problems.push(`${at}: журнал без \`format filter\` — секретні заголовки лягають відкритим текстом`); continue; }
    for (const h of headers) {
      const want = canonical(h);
      const got = log.fields.get(want);
      if (got?.hides) continue;
      if (got) { problems.push(`${at}: \`request>headers>${want}\` має дію \`${got.action ?? ''}\`, а значення ховають лише \`replace <текст>\` і \`delete\` (рядок ${got.line})`); continue; }
      const other = [...log.fields.keys()].find((k) => k.toLowerCase() === want.toLowerCase());
      problems.push(
        other
          ? `${at}: заголовок записано як \`${other}\`, а Caddy шукає поле точним збігом — треба \`${want}\`; так він не редагує нічого`
          : `${at}: заголовок \`${want}\` (у коді: ${h}) не редагується`,
      );
    }
    for (const q of queryParams) {
      if (!log.query.has(q)) problems.push(`${at}: параметр запиту \`${q}\` не редагується (\`request>uri query { replace ${q} REDACTED }\`)`);
    }
  }
  return { problems, logs: logs.length, headers };
}

function listSources(root) {
  const out = [];
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs, { recursive: true })) {
      const rel = `${dir}/${String(f).split(path.sep).join('/')}`;
      if (!SOURCE_FILE.test(rel) || TEST_FILE.test(rel) || rel.includes('/node_modules/')) continue;
      out.push({ file: rel, text: readFileSync(path.join(root, rel), 'utf8') });
    }
  }
  return out;
}

function main(root) {
  const caddyPath = path.join(root, CADDYFILE);
  if (!existsSync(caddyPath)) {
    console.error(`✗ ${WHO}: ${CADDYFILE} не знайдено (корінь ${root}) — прогін нічого не довів`);
    return 1;
  }
  const sources = listSources(root);
  const r = audit(readFileSync(caddyPath, 'utf8'), secretHeaders(sources));
  if (r.problems.length > 0) {
    console.error(`✗ ${WHO}: журнал Caddy не ховає секретів (${r.problems.length}):\n`);
    for (const p of r.problems) console.error(`  🔴 ${p}`);
    console.error(
      '\n  Кожен блок `log` у Caddyfile (і `log default` у глобальних опціях) мусить мати\n' +
        '  `format filter` із `request>headers>Імʼя replace REDACTED` на кожен секретний заголовок.',
    );
    return 1;
  }
  console.log(
    `✓ ${WHO}: ${r.headers.length} секретних заголовків із ${sources.length} файлів коду ` +
      `(${r.headers.map(canonical).join(', ')}) і ${QUERY_PARAMS.length} параметр запиту редагуються в кожному з ${r.logs} журналів`,
  );
  return 0;
}

// ── самотест ──────────────────────────────────────────────────────────

const EXPECTED_CASES = 17;

/** Caddyfile за зразком справжнього; рядки фільтра — параметром. */
function caddy({ g, site, cms, globalBlock = true, extra = '' } = {}) {
  const full = [
    'request>headers>X-Revalidate-Secret replace REDACTED',
    'request>headers>X-Build-Token replace REDACTED',
    'request>uri query {',
    '\treplace access_token REDACTED',
    '}',
  ];
  const filter = (rows) => (rows === null ? [] : ['format filter {', '\twrap json', ...rows.map((r) => `\t${r}`), '}']);
  const log = (rows, pad) => ['log {', '\toutput file /var/log/caddy/access.log {', '\t\troll_disabled', '\t}', ...filter(rows).map((l) => `\t${l}`), '}'].map((l) => pad + l);
  return [
    '# 🔴 коментар із дужкою { і словом log',
    ...(globalBlock ? ['{', '\tlog default {', ...filter(g === undefined ? full : g).map((l) => `\t\t${l}`), '\t}', '}'] : []),
    'camptribe.eu, www.camptribe.eu {',
    '\timport /etc/caddy/gate.conf',
    '\thandle {', '\t\treverse_proxy 127.0.0.1:3000', '\t}',
    ...log(site === undefined ? full : site, '\t'),
    '}',
    'cms.camptribe.eu {',
    '\treverse_proxy 127.0.0.1:8055',
    ...log(cms === undefined ? full : cms, '\t'),
    '}',
    extra,
  ].join('\n');
}

function selfTest() {
  const H = ['x-build-token', 'x-revalidate-secret'];
  const without = (drop) => [
    'request>headers>X-Revalidate-Secret replace REDACTED',
    'request>headers>X-Build-Token replace REDACTED',
    'request>uri query {', '\treplace access_token REDACTED', '}',
  ].filter((l) => !l.includes(drop));
  const swap = (from, to) => without('\0').map((l) => l.replace(from, to));
  const n = (text, headers = H) => audit(text, headers).problems;
  const says = (problems, word) => problems.length > 0 && problems.every((p) => p.includes(word));

  const cases = [];
  const add = (name, got, want) => cases.push([name, JSON.stringify(got) === JSON.stringify(want), got, want]);

  add('справний файл — нуль скарг', n(caddy()).length, 0);
  add('справний файл — журналів три', audit(caddy(), H).logs, 3);
  add('🔴 заголовка немає в журналі сайту', [n(caddy({ site: without('X-Revalidate-Secret') })).length, says(n(caddy({ site: without('X-Revalidate-Secret') })), 'X-Revalidate-Secret')], [1, true]);
  add('🔴 заголовка немає лише в CMS', [n(caddy({ cms: without('X-Build-Token') })).length, says(n(caddy({ cms: without('X-Build-Token') })), 'сайт cms.camptribe.eu')], [1, true]);
  add('🔴 заголовка немає в log default', says(n(caddy({ g: without('X-Revalidate-Secret') })), 'глобальні опції'), true);
  add('🔴 глобального блоку немає взагалі', says(n(caddy({ globalBlock: false })), 'log default'), true);
  add('🔴 нижній регістр імені', says(n(caddy({ site: swap('X-Revalidate-Secret', 'x-revalidate-secret') })), 'точним збігом'), true);
  add('🔴 журнал без format filter', says(n(caddy({ site: null })), 'без `format filter`'), true);
  add('🔴 рядок фільтра закоментовано', n(caddy({ site: swap('request>headers>X-Build-Token', '# request>headers>X-Build-Token') })).length, 1);
  add('🔴 дія hash лишає відбиток', says(n(caddy({ site: swap('X-Build-Token replace REDACTED', 'X-Build-Token hash') })), 'має дію `hash`'), true);
  add('🔴 replace без тексту', n(caddy({ site: swap('X-Build-Token replace REDACTED', 'X-Build-Token replace') })).length, 1);
  add('delete теж ховає', n(caddy({ site: swap('X-Build-Token replace REDACTED', 'X-Build-Token delete') })).length, 0);
  add('🔴 параметр запиту не редагується', says(n(caddy({ cms: without('access_token') })), 'access_token'), true);
  add('🔴 новий заголовок у коді, якого немає в конфігу — по скарзі на журнал', n(caddy(), [...H, 'x-new-token']).length, 3);
  add('🔴 порожній перелік із коду — провал, а не зелене', says(n(caddy(), []), 'нічого не довів'), true);
  add('🔴 import усередині log', says(n(caddy({ site: [...without('\0'), 'import redact'] })), 'import'), true);
  add(
    'імена з коду: літерали беруться, тести й не-секрети — ні',
    secretHeaders([
      { file: 'apps/web/src/lib/a.ts', text: 'h.get("x-revalidate-secret"); h.get(\'x-forwarded-host\'); const k = `X-Windy-Api-Key`;' },
      { file: 'apps/api/src/t.guard.spec.ts', text: '"x-fake-token"' },
      { file: 'apps/api/src/readme.md', text: '"x-doc-token"' },
    ]),
    ['x-revalidate-secret', 'x-windy-api-key'],
  );

  let failed = 0;
  for (const [name, passed, got, want] of cases) {
    if (passed) console.log(`  ✓ ${name}`);
    else { failed += 1; console.error(`  ✗ ${name}: було ${JSON.stringify(got)}, мало бути ${JSON.stringify(want)}`); }
  }
  if (cases.length !== EXPECTED_CASES) {
    failed += 1;
    console.error(`  ✗ випадків ${cases.length}, очікувалось ${EXPECTED_CASES}`);
  }
  console.log(`${WHO} self-test: ran ${cases.length}, passed ${cases.length - failed}, failed ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

// 🔴 Форма дому: `realpathSync` з обох боків, у IIFE з try/catch, і
// `import.meta.url` у порівнянні буквально — check-script-entrypoints
// впізнає захист саме за цим.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flags = chooseAction(args, ['--self-test', '--root'], `${WHO}.mjs`, { takesValue: ['--root'] });
  if (flags.has('--self-test')) selfTest();
  else process.exitCode = main(flagValue(args, '--root') ?? DEFAULT_ROOT);
}
