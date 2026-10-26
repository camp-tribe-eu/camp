#!/usr/bin/env node
// CAMP-363: обробник Next не сміє лежати за адресою, яку Caddy віддає НЕ в Next.
//
//   node scripts/ci/check-next-routes-reachable.mjs
//   node scripts/ci/check-next-routes-reachable.mjs --root <тека>   # інший корінь
//   node scripts/ci/check-next-routes-reachable.mjs --self-test
//
// 🔴 ЗВІДКИ ЦЕ ВЗЯЛОСЬ. Хук скидання кешу лежав у
// `apps/web/src/app/api/revalidate/route.ts`, тобто за адресою
// `/api/revalidate`. У Caddy (`infra/caddy/camptribe.eu.caddyfile`)
// `handle_path /api/* { reverse_proxy 127.0.0.1:3001 }` віддає ВЕСЬ префікс
// `/api` у Nest. Запит від Directus до Next не доходив, Nest відповідав 404,
// і скидання кешу мовчки не відбувалось. Помилки не було ніде: Next про
// запит не чув, Nest чесно сказав «нема такого». Тест маршруту ходив у Next
// напряму й був зелений — він перевіряє код, а не дорогу до нього.
//
// 🔴 ЩО ПЕРЕВІРЯЄТЬСЯ. Із Caddyfile береться сайт `WEB_HOST`, у ньому —
// наскрізний `handle` (без матчера) → це порт Next, і кожен інший
// `reverse_proxy` цього сайту → «чужий префікс». Далі кожен `route.*` під
// `apps/web/src/app` перекладається в URL (групи `(…)` викидаються,
// `[p]` → `:p`) і червоніє, якщо URL потрапляє під чужий префікс.
//
// 🔴 ПОРТ NEXT НЕ ЗАШИТО ЧИСЛОМ. Він береться з наскрізного `handle` того
// самого Caddyfile. Не вдалося визначити (немає такого `handle`, їх два,
// upstream не число) — це провал сторожа, а не «припустимо 3000». Сторож,
// що вгадує порт, зеленів би рівно тоді, коли порт змінили.
//
// 🔴 ПОРОЖНІЙ ПЕРЕЛІК ЧУЖИХ ПРЕФІКСІВ — ТЕЖ ПРОВАЛ. На справжньому файлі
// він непорожній (`/api/*`). Нуль означає, що розбір зламався (описка в
// `handle_path`, не та дужка), а не що все чисто: зламаний розбір і чисте
// дерево дають однаковий вивід — нічого — і тільки перше з них небезпечне.
// Те саме з нулем обробників Next. Якщо API справді пішов з цього хоста,
// сторожу нема що берегти, і його треба прибрати навмисно.
//
// 🔴 ЧОГО СТОРОЖ НЕ БАЧИТЬ (межі названо, бо мовчання на межі — не факт):
//   · `import` не читається: `gate.conf` живе на машині. Проксі всередині
//     імпортованого файлу невидимий — прогін друкує, що саме не прочитано.
//   · Читаються лише `handle`, `handle_path`, `route` і `reverse_proxy`.
//     `respond`/`redir`/`rewrite` на префіксі Next-маршруту — поза ним.
//   · Виняток у Caddy (`handle /api/revalidate` → Next перед `/api/*`)
//     сторож НЕ розуміє і лишається червоним: це в бік помилкової тривоги,
//     а не мовчання. Правильна відповідь — перенести маршрут, а не вчити
//     сторожа прощати.
//   · Динамічний сегмент не розгортається: `app/[x]/route.ts` відповідає й
//     іншим значенням, тож він не «невидимий» і червоним не стає.
//   · Лише обробники (`route.ts|tsx|js|jsx`) і лише App Router; сторінки
//     (`page.tsx`) під чужим префіксом сторож не читає.
//   · Що Next справді слухає цей порт, знає `camptribe-web.service`, а не
//     сторож. Якщо наскрізний `handle` переведуть не в Next, ляже весь сайт,
//     і це ловить будь-яка сторінка, а не цей файл.
//
// 🔴 `/api/*` ВВАЖАЄТЬСЯ ТАКИМ, ЩО БЕРЕ Й САМ `/api`. Чи бере його Caddy,
// тут не заміряно (caddy на цій машині немає), і сторож не ставить на
// припущення: межа трактується в бік червоного.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction, flagValue } from '../lib/entrypoint.mjs';

const WHO = 'check-next-routes-reachable';
const CADDYFILE = 'infra/caddy/camptribe.eu.caddyfile';
const APP_DIR = 'apps/web/src/app';

// 🔴 ЄДИНЕ НАЗВАНЕ МІСЦЕ, звідки сторож знає, який сайт у Caddyfile — це
// веб. У файлі їх два: цей і `cms.camptribe.eu` із наскрізним проксі в
// Directus. Якби сторож брав усі сайти, наскрізний `reverse_proxy :8055`
// цього CMS-блоку «віддав би» чужому порту кожен обробник Next — і сторож
// був би червоним завжди. Площа ураження сторожа не перевищує площі дефекту.
const WEB_HOST = 'camptribe.eu';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(here, '..', '..');

// ── розбір Caddyfile ──────────────────────────────────────────────────

/**
 * Токени одного рядка. `#` на початку токена — коментар до кінця рядка;
 * лапки `"` і зворотні лише відкривають токен.
 *
 * 🔴 КОМЕНТАР ВІДРІЗАЄТЬСЯ ДО ТОГО, ЯК РАХУЮТЬСЯ ДУЖКИ. Справжній файл
 * цитує в коментарях і `handle_path`, і `{ … }`; без цього рядок
 * `# handle_path /api/* {` відкрив би блок, якого немає.
 */
export function tokenize(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '#') break;
    if (c === '"' || c === '`') {
      let j = i + 1;
      let buf = '';
      while (j < line.length && line[j] !== c) {
        if (c === '"' && line[j] === '\\' && j + 1 < line.length) { buf += line[j + 1]; j += 2; continue; }
        buf += line[j];
        j += 1;
      }
      if (j >= line.length) return { tokens, error: 'незакрита лапка' };
      tokens.push(buf);
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < line.length && !/\s/.test(line[j])) j += 1;
    tokens.push(line.slice(i, j));
    i = j;
  }
  return { tokens, error: null };
}

/** Порт з upstream-а `reverse_proxy`; `null`, якщо його не видно. */
export function upstreamPort(token) {
  const m = /:(\d{1,5})$/.exec(token);
  return m ? Number(m[1]) : null;
}

/** Матчер шляху: `*`/нічого → усе; `/…` → шлях; `@ім'я` → оголошений раніше. */
function resolveMatcher(token, named) {
  if (token === undefined || token === '*') return { kind: 'all', text: '*' };
  if (token.startsWith('/')) return { kind: 'paths', paths: [token], text: token };
  if (token.startsWith('@')) {
    return named[token] ?? { kind: 'unreadable', text: token, why: 'іменований матчер не оголошено в цьому сайті' };
  }
  return { kind: 'unreadable', text: token, why: 'це не шлях, не `*` і не @ім\'я' };
}

/** Однорядкове `@ім'я path /a/* /b/*`; усе інше сторож не читає. */
function readNamedMatcher(name, rest, node) {
  if (node.children === null && rest[0] === 'path' && rest.length >= 2) {
    return { kind: 'paths', paths: rest.slice(1), text: `${name} (${rest.slice(1).join(' ')})` };
  }
  return {
    kind: 'unreadable',
    text: name,
    why: 'читається лише однорядкова форма `@ім\'я path /a/* /b/*`',
  };
}

const ROUTING = new Set(['handle', 'handle_path', 'route']);

/** Чи є всередині вузла `reverse_proxy` (на будь-якій глибині). */
function holdsProxy(node) {
  return (node.children ?? []).some((c) => c.head[0] === 'reverse_proxy' || holdsProxy(c));
}

/**
 * `anchor` — рядок голови зовнішнього `handle`/`handle_path`/`route`, у
 * якому стоїть проксі: саме його людина шукає в Caddyfile й цитує (`:45`),
 * а не рядок `reverse_proxy` усередині.
 */
function collect(nodes, matchers, site, named, anchor = null) {
  for (const node of nodes) {
    const [name, ...rest] = node.head;
    if (name === undefined) continue;
    if (name.startsWith('@')) { named[name] = readNamedMatcher(name, rest, node); continue; }
    if (name === 'import') { site.imports.push({ target: rest.join(' '), line: node.line }); continue; }
    if (ROUTING.has(name)) {
      if (node.children === null) continue;
      const own = rest.length > 1
        ? { kind: 'unreadable', text: rest.join(' '), why: 'матчер із кількох токенів' }
        : resolveMatcher(rest[0], named);
      collect(node.children, [...matchers, own], site, named, anchor ?? node.line);
      continue;
    }
    if (name === 'reverse_proxy') {
      const inline = rest[0] !== undefined && /^(\/|\*$|@)/.test(rest[0]);
      const own = inline ? resolveMatcher(rest[0], named) : null;
      const upstreams = inline ? rest.slice(1) : rest;
      site.proxies.push({
        matchers: own ? [...matchers, own] : matchers,
        ports: upstreams.length === 0 ? [null] : upstreams.map(upstreamPort),
        upstreams,
        line: anchor ?? node.line,
      });
      continue;
    }
    // 🔴 Блок із шляховим матчером, назви якого сторож не знає, — це не
    // «ще одна директива», а місце, де міг ховатися чужий префікс. Описка
    // `handl_path /api/* { reverse_proxy … }` виглядає саме так. Блоки без
    // шляху (`log`, `header`, `encode`) проксі не несуть і не чіпаються.
    if (node.children !== null && /^(\/|@)/.test(rest[0] ?? '') && holdsProxy(node)) {
      site.blind.push({ directive: name, matcher: rest[0], line: node.line });
    }
  }
}

/**
 * Розбір Caddyfile в сайти. Чиста функція.
 *
 * `problems` — лише синтаксис (дужки, лапки, продовження рядка): він
 * ламає весь файл, а не один сайт. Що саме читається всередині сайту,
 * лежить у `sites[].proxies`, `.blind` і `.imports`.
 */
export function parseCaddyfile(text) {
  const problems = [];
  const root = { head: [], line: 0, children: [] };
  const stack = [root];
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n += 1) {
    const { tokens, error } = tokenize(lines[n]);
    if (error) problems.push(`${CADDYFILE}:${n + 1}: ${error}`);
    if (tokens.length === 0) continue;
    if (tokens[tokens.length - 1].endsWith('\\')) {
      problems.push(`${CADDYFILE}:${n + 1}: продовження рядка \`\\\` сторож не читає — безпечніше відмовитись, ніж прочитати половину`);
    }
    if (tokens.length === 1 && tokens[0] === '}') {
      if (stack.length === 1) problems.push(`${CADDYFILE}:${n + 1}: зайва \`}\` — жоден блок не відкрито`);
      else stack.pop();
      continue;
    }
    const opens = tokens[tokens.length - 1] === '{';
    const node = { head: opens ? tokens.slice(0, -1) : tokens, line: n + 1, children: opens ? [] : null };
    stack[stack.length - 1].children.push(node);
    if (opens) stack.push(node);
  }
  if (stack.length > 1) {
    problems.push(`${CADDYFILE}:${stack[stack.length - 1].line}: блок не закрито — бракує \`}\``);
  }

  const sites = [];
  for (const node of root.children) {
    if (node.children === null || node.head.length === 0) continue; // глобальні опції
    if (node.head[0].startsWith('(')) continue; // сніпет, не сайт
    const site = {
      addresses: node.head.map((a) => a.replace(/,$/, '')).filter(Boolean),
      line: node.line,
      proxies: [],
      blind: [],
      imports: [],
    };
    collect(node.children, [], site, {});
    sites.push(site);
  }
  return { sites, problems };
}

// ── обробники Next → URL ──────────────────────────────────────────────

/**
 * Шлях файлу → URL, яким Next віддає цей обробник; `null`, якщо файл не
 * обробник або Next його не маршрутизує.
 *
 * Групи `(…)` і слоти `@…` у URL не потрапляють, `[p]` → `:p`,
 * `[...p]` і `[[...p]]` → `:p*`. Тека з `_` на початку приватна — Next її
 * не маршрутизує, тож і недосяжності там нема що шукати.
 */
export function routeUrl(file, appDir = APP_DIR) {
  const prefix = `${appDir}/`;
  if (!file.startsWith(prefix)) return null;
  const m = /^(?:(.*)\/)?route\.(?:ts|tsx|js|jsx)$/.exec(file.slice(prefix.length));
  if (!m) return null;
  const segments = [];
  for (const dir of (m[1] ?? '').split('/').filter(Boolean)) {
    if (/^\([^()]*\)$/.test(dir)) continue;
    if (dir.startsWith('@')) continue;
    if (dir.startsWith('_')) return null;
    let p;
    if ((p = /^\[\[\.\.\.(.+)\]\]$/.exec(dir))) segments.push(`:${p[1]}*`);
    else if ((p = /^\[\.\.\.(.+)\]$/.exec(dir))) segments.push(`:${p[1]}*`);
    else if ((p = /^\[(.+)\]$/.exec(dir))) segments.push(`:${p[1]}`);
    else segments.push(dir);
  }
  return `/${segments.join('/')}`;
}

/**
 * Чи бере цей Caddy-шаблон цей URL. `*` — будь-яка послідовність
 * символів. `/api/*` бере і `/api` (межу трактуємо в бік червоного).
 * Шаблон без `*` — точний збіг.
 */
export function covers(pattern, url) {
  const body = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  if (new RegExp(`^${body}$`).test(url)) return true;
  return pattern.length > 2 && pattern.endsWith('/*') && url === pattern.slice(0, -2);
}

const proxyCovers = (proxy, url) =>
  proxy.matchers.every((m) => m.kind === 'all' || m.paths.some((p) => covers(p, url)));

// ── вирок ─────────────────────────────────────────────────────────────

/**
 * Чисте ядро: текст Caddyfile + перелік файлів → вирок. Без І/О; саме
 * його ганяє самотест — на фікстурах, не на справжньому дереві.
 *
 * @returns {{problems: string[], nextPort: number|null, nextLine: number|null,
 *   foreign: {patterns: string[], ports: number[], line: number}[],
 *   routes: number, imports: {target: string, line: number}[]}}
 */
export function audit(caddyText, routeFiles, webHost = WEB_HOST) {
  const result = { problems: [], nextPort: null, nextLine: null, foreign: [], routes: 0, imports: [] };
  const fail = (msg) => { result.problems.push(msg); return result; };

  const parsed = parseCaddyfile(caddyText);
  if (parsed.problems.length > 0) {
    // 🔴 Зламаний синтаксис — єдиний вирок. Далі читати нічого: дужка не на
    // місці зсуває блоки, і наступні «факти» були б вигадані.
    result.problems.push(...parsed.problems.map((p) => `зламаний розбір Caddyfile — ${p}`));
    return result;
  }

  const sites = parsed.sites.filter((s) => s.addresses.includes(webHost));
  if (sites.length !== 1) {
    return fail(
      `${CADDYFILE}: сайтів із адресою ${webHost} — ${sites.length}, а потрібен рівно один ` +
        `(усього сайтів у файлі: ${parsed.sites.map((s) => s.addresses.join(',')).join(' | ') || 'жодного'}). ` +
        'Без нього невідомо, куди йде веб-трафік, і порт Next не визначити',
    );
  }
  const [site] = sites;
  result.imports = site.imports;

  // 🔴 Порт Next — з наскрізного handle, а не з константи.
  const catchAll = site.proxies.filter((p) => p.matchers.every((m) => m.kind === 'all'));
  if (catchAll.length !== 1) {
    return fail(
      `не вдалося визначити порт Next: у сайті ${webHost} наскрізних \`handle\`/\`reverse_proxy\` без матчера — ` +
        `${catchAll.length}, а потрібен рівно один (рядки: ${catchAll.map((p) => p.line).join(', ') || '—'}). ` +
        'Сторож не вгадує порт: без нього він не відрізнить Next від API',
    );
  }
  const ports = [...new Set(catchAll[0].ports)];
  if (ports.length !== 1 || ports[0] === null) {
    return fail(
      `не вдалося визначити порт Next: наскрізний проксі (${CADDYFILE}:${catchAll[0].line}) має upstream ` +
        `\`${catchAll[0].upstreams.join(' ') || '(у блоці)'}\`, із якого сторож не бачить єдиного числового порту`,
    );
  }
  const nextPort = ports[0];
  result.nextPort = nextPort;
  result.nextLine = catchAll[0].line;

  for (const b of site.blind) {
    result.problems.push(
      `${CADDYFILE}:${b.line}: блок \`${b.directive} ${b.matcher}\` містить reverse_proxy, але сторож не знає такої ` +
        'директиви — чужий префікс міг сховатись саме тут. Описка в назві? Якщо директива справжня — навчи сторожа її читати',
    );
  }

  const foreign = site.proxies.filter((p) => p.ports.some((port) => port !== nextPort));
  for (const p of foreign) {
    const bad = p.matchers.find((m) => m.kind === 'unreadable');
    if (bad) {
      result.problems.push(
        `${CADDYFILE}:${p.line}: проксі в порт ${p.ports.join('/')}, не Next (${nextPort}), має матчер \`${bad.text}\`, ` +
          `якого сторож не вміє читати (${bad.why}) — він сліпий до цього префікса`,
      );
      continue;
    }
    result.foreign.push({
      patterns: p.matchers.filter((m) => m.kind === 'paths').flatMap((m) => m.paths),
      ports: p.ports,
      line: p.line,
    });
  }
  if (foreign.length === 0) {
    result.problems.push(
      `порожній перелік чужих префіксів у ${CADDYFILE} (сайт ${webHost}): або розбір зламався, або API пішов з цього хоста. ` +
        'Нуль префіксів не означає «чисто» — це означає, що сторожу нема чого перевіряти',
    );
  }

  const urls = routeFiles.map((file) => ({ file, url: routeUrl(file) })).filter((r) => r.url !== null);
  result.routes = urls.length;
  if (urls.length === 0) {
    result.problems.push(
      `жодного обробника Next під ${APP_DIR}: перелік зламався або теку переміщено. ` +
        'Нуль обробників не означає «чисто» — прогін нічого не довів',
    );
  }

  for (const r of urls) {
    for (const p of foreign) {
      if (p.matchers.some((m) => m.kind === 'unreadable') || !proxyCovers(p, r.url)) continue;
      const shown = p.matchers.filter((m) => m.kind === 'paths').flatMap((m) => m.paths).join(' ');
      result.problems.push(
        `${r.file} (URL ${r.url}) лежить під Caddy-префіксом ${shown}, який іде в порт ${p.ports.join('/')}, ` +
          `а не в Next (${nextPort}) — ${CADDYFILE}:${p.line}. Запит до цього URL до Next не дійде`,
      );
    }
  }
  return result;
}

// ── І/О ───────────────────────────────────────────────────────────────

/** Усі обробники під APP_DIR, відносні до кореня, з `/` скрізь. */
export function listRouteFiles(root) {
  const dir = path.join(root, APP_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((f) => String(f).split(path.sep).join('/'))
    .filter((f) => /(^|\/)route\.(ts|tsx|js|jsx)$/.test(f))
    .map((f) => `${APP_DIR}/${f}`)
    .sort();
}

function main(root) {
  const caddyPath = path.join(root, CADDYFILE);
  if (!existsSync(caddyPath)) {
    console.error(`✗ ${WHO}: ${CADDYFILE} не знайдено (корінь ${root}) — прогін нічого не довів`);
    return 1;
  }
  const r = audit(readFileSync(caddyPath, 'utf8'), listRouteFiles(root));
  if (r.problems.length > 0) {
    console.error(`✗ ${WHO}: Next і Caddy розійшлися (${r.problems.length}):\n`);
    for (const p of r.problems) console.error(`  🔴 ${p}`);
    console.error(
      '\n  Обробник Next за адресою, яку Caddy віддає в інший порт, НЕ ІСНУЄ ззовні: запит іде туди,\n' +
        '  де його не чекають, і жодна помилка не виникає (так мовчав хук скидання кешу, CAMP-363).\n' +
        '  Перенеси обробник за адресу, що не під чужим префіксом — наприклад `/internal/…`.',
    );
    return 1;
  }
  const foreign = r.foreign.map((f) => `${f.patterns.join(' ')} → ${f.ports.join('/')} (рядок ${f.line})`).join('; ');
  const blind = r.imports.length > 0
    ? `; import не читаються: ${r.imports.map((i) => `${i.target} (рядок ${i.line})`).join(', ')}`
    : '';
  console.log(
    `✓ ${WHO}: ${r.routes} обробників Next, жоден не під чужим префіксом; Next = порт ${r.nextPort} ` +
      `(наскрізний handle, ${CADDYFILE}:${r.nextLine}); чужих префіксів ${r.foreign.length}: ${foreign}${blind}`,
  );
  return 0;
}

// ── самотест ──────────────────────────────────────────────────────────

/** Caddyfile за зразком справжнього; зміни — через параметри. */
function caddy({ apiPattern = '/api/*', apiPort = 3001, nextPort = 3000, api = true, cms = true, extra = '' } = {}) {
  return [
    '# коментар із { дужкою не відкриває блок',
    'camptribe.eu, www.camptribe.eu {',
    '\timport /etc/caddy/gate.conf',
    '\theader {',
    '\t\t-Server',
    '\t}',
    '\t# handle_path /api/* { reverse_proxy 127.0.0.1:9999 }',
    api ? `\thandle_path ${apiPattern} {\n\t\treverse_proxy 127.0.0.1:${apiPort}\n\t}` : '',
    extra,
    `\thandle {\n\t\treverse_proxy 127.0.0.1:${nextPort}\n\t}`,
    '\tencode zstd gzip',
    '\tlog {',
    '\t\toutput file /var/log/caddy/access.log {',
    '\t\t\troll_disabled',
    '\t\t}',
    '\t}',
    '}',
    cms ? '\ncms.camptribe.eu {\n\timport /etc/caddy/cms-gate.conf\n\treverse_proxy 127.0.0.1:8055\n}' : '',
  ].join('\n');
}

const A = `${APP_DIR}/`;
const OK_FILES = [`${A}internal/revalidate/route.ts`, `${A}data/places.json/route.ts`, `${A}.well-known/security.txt/route.ts`];

/** Тека з Caddyfile і порожніми обробниками — щоб прогнати СПРАВЖНІЙ CLI. */
function fixtureRoot(caddyText, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'camp363-'));
  mkdirSync(path.join(root, path.dirname(CADDYFILE)), { recursive: true });
  writeFileSync(path.join(root, CADDYFILE), caddyText);
  for (const f of files) {
    mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
    writeFileSync(path.join(root, f), 'export {};\n');
  }
  return root;
}

/** Код виходу справжнього процесу — свідок проти «завжди 0». */
function runCli(args) {
  try {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/**
 * Зіпсувати текст І ДОВЕСТИ, що зіпсовано.
 *
 * 🔴 Перша редакція самотесту писала `caddy().replace('handle_path /api/* {', …)`,
 * а перше входження цього рядка стоїть у КОМЕНТАРІ фікстури, не в
 * директиві. Мутація нічого не змінила, Caddyfile лишився цілим, сторож
 * чесно сказав «чисто» — і три випадки червоніли б не через сторожа, а
 * через тест, що нічого не ламав. Тепер мутація, яка нічого не змінила,
 * валить самотест виняткою.
 */
function mutate(text, from, to) {
  const out = text.replace(from, () => to);
  if (out === text) throw new Error(`мутація нічого не змінила: ${String(from)}`);
  return out;
}

const problemsOf = (caddyText, files = OK_FILES) => audit(caddyText, files).problems;
const mentions = (list, ...needles) => list.some((p) => needles.every((n) => p.includes(n)));

/**
 * Лише ВЛУЧАННЯ обробника в чужий префікс, а не будь-які скарги.
 *
 * 🔴 Перша редакція рахувала `problemsOf(…).length === 1`. Мутація
 * «inline-матчер не читається» ламала світ ІНАКШЕ — «порт Next не
 * визначити» — і давала рівно одну скаргу, тож тест «ловиться» зеленів на
 * зламаному коді, бо одиниця була не тією одиницею. Тепер рахується те, що
 * тест має на увазі.
 */
const isHit = (p) => p.includes('лежить під Caddy-префіксом');
const hits = (caddyText, files = OK_FILES) => problemsOf(caddyText, files).filter(isHit);

// 🔴 Кількість зафіксовано: випадок, до якого самотест перестав доходити,
// виглядає точно як випадок, що пройшов.
const EXPECTED_CASES = 70;

function selfTest() {
  const cases = [];
  const is = (name, got, want) => cases.push([name, JSON.stringify(got) === JSON.stringify(want), got, want]);
  const ok = (name, cond) => is(name, Boolean(cond), true);

  // ── чистий світ ──
  const clean = audit(caddy(), OK_FILES);
  is('чистий світ не червоніє', clean.problems, []);
  is('порт Next — із наскрізного handle', clean.nextPort, 3000);
  is('чужий префікс один: /api/* → 3001', clean.foreign.map((f) => [f.patterns, f.ports]), [[['/api/*'], [3001]]]);
  is('обробників пораховано', clean.routes, 3);
  is('import названо серед непрочитаного', clean.imports.map((i) => i.target), ['/etc/caddy/gate.conf']);
  ok('🔴 CMS-блок із наскрізним :8055 не «краде» обробники Next (охоплення — один сайт)',
    audit(caddy({ cms: true }), OK_FILES).problems.length === 0);

  // ── сам дефект ──
  const defectAll = problemsOf(caddy(), [...OK_FILES, `${A}api/revalidate/route.ts`]);
  const defect = defectAll.filter(isHit);
  is('🔴 дефект CAMP-363: route.ts під /api/ ловиться — одна скарга, і саме влучання', [defectAll.length, defect.length], [1, 1]);
  ok('…і назвав ФАЙЛ', mentions(defect, `${A}api/revalidate/route.ts`));
  ok('…і ПРЕФІКС', mentions(defect, '/api/*'));
  ok('…і порт, куди піде запит насправді (3001)', mentions(defect, 'порт 3001'));
  ok('…і порт Next (3000)', mentions(defect, 'Next (3000)'));
  const lineOf = (head) => caddy().split('\n').findIndex((l) => l.startsWith(head)) + 1;
  ok('…і рядок ГОЛОВИ блоку handle_path (не reverse_proxy всередині)', mentions(defect, `${CADDYFILE}:${lineOf('\thandle_path')}.`));
  is('…і nextLine — рядок голови наскрізного handle', clean.nextLine, lineOf('\thandle {'));
  is('глибоко під префіксом теж ловиться', hits(caddy(), [`${A}api/a/b/c/route.ts`, ...OK_FILES]).length, 1);
  is('🔴 динамічний сегмент під префіксом ловиться', hits(caddy(), [`${A}api/[id]/route.ts`, ...OK_FILES]).length, 1);
  is('🔴 група (…) викидається: (site)/api/x — це /api/x',
    hits(caddy(), [`${A}(site)/api/x/route.ts`, ...OK_FILES]).length, 1);
  is('🔴 `/api` без слеша теж червоніє (межа в бік червоного)', hits(caddy(), [`${A}api/route.ts`, ...OK_FILES]).length, 1);
  is('два зіпсовані обробники — дві скарги, не одна і не всі',
    hits(caddy(), [`${A}api/a/route.ts`, `${A}api/b/route.ts`, ...OK_FILES]).length, 2);

  // ── що НЕ червоніє ──
  is('🔴 схожий префікс /apiary не під /api/*', problemsOf(caddy(), [`${A}apiary/x/route.ts`, ...OK_FILES]), []);
  is('api посередині шляху — не під префіксом', problemsOf(caddy(), [`${A}data/api/x/route.ts`, ...OK_FILES]), []);
  is('виріз у Next-порт не є чужим префіксом',
    problemsOf(caddy({ extra: '\thandle /extra/* {\n\t\treverse_proxy 127.0.0.1:3000\n\t}' }), [`${A}extra/x/route.ts`, ...OK_FILES]), []);
  is('приватна тека _x під /api не маршрутизується — нема чого шукати',
    problemsOf(caddy(), [`${A}api/_private/route.ts`, ...OK_FILES]), []);

  // ── порт Next не зашито ──
  const moved = audit(caddy({ nextPort: 4100 }), [...OK_FILES, `${A}api/x/route.ts`]);
  is('🔴 порт Next 4100 береться з файлу, не з константи', moved.nextPort, 4100);
  ok('…і в скарзі саме він', mentions(moved.problems, 'Next (4100)'));
  is('🔴 префікс у порт 3000, коли Next = 4100, — ЧУЖИЙ (3000 не «свій за замовчуванням»)',
    hits(caddy({ nextPort: 4100, apiPort: 3000 }), [`${A}api/x/route.ts`, ...OK_FILES]).length, 1);
  ok('🔴 немає наскрізного handle → провал, а не «припустимо 3000»',
    mentions(problemsOf(mutate(caddy(), /\thandle \{[^}]*\}\n/, '')), 'не вдалося визначити порт Next'));
  ok('🔴 два наскрізні handle → провал',
    mentions(problemsOf(caddy({ extra: '\thandle {\n\t\treverse_proxy 127.0.0.1:3009\n\t}' })), 'не вдалося визначити порт Next'));
  ok('🔴 upstream не число (змінна середовища) → провал',
    mentions(problemsOf(mutate(caddy(), '127.0.0.1:3000', '{$WEB_UPSTREAM}')), 'не вдалося визначити порт Next'));
  ok('upstream без порту → провал', mentions(problemsOf(mutate(caddy(), '127.0.0.1:3000', 'localhost')), 'не вдалося визначити порт Next'));

  // ── порожнє — це провал, а не чисто ──
  ok('🔴 жодного чужого префікса → провал із поясненням', mentions(problemsOf(caddy({ api: false })), 'порожній перелік чужих префіксів'));
  is('🔴 жодного обробника Next → провал', problemsOf(caddy(), []).length, 1);
  ok('…і він називає нуль обробників', mentions(problemsOf(caddy(), []), 'жодного обробника Next'));
  ok('🔴 не-обробники (page.tsx) не рахуються за обробники', mentions(problemsOf(caddy(), [`${A}page.tsx`, `${A}api/page.tsx`]), 'жодного обробника Next'));

  // ── зламаний розбір ──
  const noBrace = mutate(caddy(), '\thandle_path /api/* {', '\thandle_path /api/*');
  ok('🔴 бракує `{` → зламаний розбір, а не зелений', mentions(problemsOf(noBrace), 'зламаний розбір'));
  ok('🔴 бракує `}` → зламаний розбір', mentions(problemsOf(mutate(caddy(), /\n\}\n\ncms/, '\n\ncms')), 'зламаний розбір'));
  ok('🔴 описка в handle_path → проксі всередині невідомої директиви',
    mentions(problemsOf(mutate(caddy(), '\thandle_path', '\thandl_path')), 'handl_path', 'сторож не знає'));
  ok('🔴 зламаний синтаксис дає ЛИШЕ скарги на синтаксис — жодних вигаданих «фактів» зі зсунутих блоків',
    problemsOf(noBrace).length > 0 && problemsOf(noBrace).every((p) => p.startsWith('зламаний розбір')));
  ok('…і порожній перелік теж спрацьовує', mentions(problemsOf(mutate(caddy(), '\thandle_path', '\thandl_path')), 'порожній перелік'));
  const twoWithTypo = caddy({ extra: '\thandl_path /v2/* {\n\t\treverse_proxy 127.0.0.1:3002\n\t}' });
  ok('🔴 описка в ДРУГОМУ префіксі ловиться, хоч перший читається й перелік непорожній',
    mentions(problemsOf(twoWithTypo), 'handl_path /v2/*') && audit(twoWithTypo, OK_FILES).foreign.length === 1);
  ok('🔴 два сайти з адресою webHost → провал: який з них веб, невідомо',
    mentions(problemsOf(caddy() + '\n' + caddy({ cms: false })), 'потрібен рівно один'));
  ok('немає сайту webHost → провал', mentions(audit(caddy(), OK_FILES, 'no-such.example').problems, 'потрібен рівно один'));
  ok('🔴 закоментований проксі не читається (єдиний /api/* у коментарі → порожній перелік)',
    mentions(problemsOf(caddy({ api: false, extra: '\t# handle_path /api/* {\n\t#\treverse_proxy 127.0.0.1:3001\n\t# }' })), 'порожній перелік'));
  ok('незакрита лапка → зламаний розбір', mentions(problemsOf(caddy({ extra: '\trespond "abc' })), 'зламаний розбір'));

  // ── форми матчера ──
  const named = caddy({ api: false, extra: '\t@legacy path /api/* /v1/*\n\thandle @legacy {\n\t\treverse_proxy 127.0.0.1:3001\n\t}' });
  is('🔴 іменований матчер: обидва шляхи ловляться', hits(named, [`${A}api/a/route.ts`, `${A}v1/b/route.ts`, ...OK_FILES]).length, 2);
  const mixed = caddy({ extra: '\treverse_proxy /mix/* 127.0.0.1:3000 127.0.0.1:3001' });
  is('🔴 upstream-и вперемішку (Next і чужий): частина трафіку йде мимо Next — ловиться',
    hits(mixed, [`${A}mix/a/route.ts`, ...OK_FILES]).length, 1);
  const nested = caddy({ api: false, extra: '\thandle /api/* {\n\t\thandle {\n\t\t\treverse_proxy 127.0.0.1:3001\n\t\t}\n\t}' });
  is('🔴 вкладений handle без матчера всередині префікса читається', hits(nested, [`${A}api/a/route.ts`, ...OK_FILES]).length, 1);
  const both = caddy({ api: false, extra: '\thandle /api/* {\n\t\thandle /api/v2/* {\n\t\t\treverse_proxy 127.0.0.1:3001\n\t\t}\n\t}' });
  is('🔴 вкладені матчери діють РАЗОМ: /api/a лише під зовнішнім — не під обома, /api/v2/a — під обома',
    [hits(both, [`${A}api/a/route.ts`, ...OK_FILES]).length, hits(both, [`${A}api/v2/a/route.ts`, ...OK_FILES]).length], [0, 1]);
  const viaRoute = caddy({ api: false, extra: '\troute /api/* {\n\t\treverse_proxy 127.0.0.1:3001\n\t}' });
  is('🔴 директива `route` читається так само, як handle', hits(viaRoute, [`${A}api/a/route.ts`, ...OK_FILES]).length, 1);
  ok('🔴 продовження рядка `\\` відхилено, а не прочитано наполовину',
    mentions(problemsOf(caddy({ extra: '\trespond /x \\\n\t\t"y"' })), 'продовження рядка'));
  const inline = caddy({ api: false, extra: '\treverse_proxy /api/* 127.0.0.1:3001' });
  is('🔴 `reverse_proxy /api/* :3001` на рівні сайту читається', hits(inline, [`${A}api/a/route.ts`, ...OK_FILES]).length, 1);
  const rx = caddy({ api: false, extra: '\t@r path_regexp ^/api\n\thandle @r {\n\t\treverse_proxy 127.0.0.1:3001\n\t}' });
  ok('🔴 матчер, якого не вміє читати, у ЧУЖИЙ порт → провал (сліпота названа)', mentions(problemsOf(rx), 'не вміє читати'));
  is('…а такий самий, але в порт Next, мовчить: він нічого не відбирає у Next',
    problemsOf(caddy({ extra: '\t@r path_regexp ^/x\n\thandle @r {\n\t\treverse_proxy 127.0.0.1:3000\n\t}' })), []);
  is('точний матчер /health бере лише /health',
    [covers('/health', '/health'), covers('/health', '/health/x'), covers('/health', '/healthz')], [true, false, false]);
  is('`/x*` бере й /xy, `/x/*` — ні', [covers('/x*', '/xy'), covers('/x/*', '/xy')], [true, false]);
  is('`*` посередині: /a/*/b', [covers('/a/*/b', '/a/q/b'), covers('/a/*/b', '/a/q/c')], [true, false]);
  is('http://127.0.0.1:3001, localhost:3001, [::1]:3001 → 3001',
    ['http://127.0.0.1:3001', 'localhost:3001', '[::1]:3001'].map(upstreamPort), [3001, 3001, 3001]);

  // ── відображення шляху файлу → URL ──
  const url = (f) => routeUrl(`${A}${f}`);
  is('🔴 [param] → :param', url('data/spots/[country]/[chunk]/route.ts'), '/data/spots/:country/:chunk');
  is('крапка в назві теки зберігається', url('.well-known/security.txt/route.ts'), '/.well-known/security.txt');
  is('корінь → /', url('route.ts'), '/');
  is('[...slug] і [[...slug]] → :slug*', [url('f/[...slug]/route.ts'), url('f/[[...slug]]/route.ts')], ['/f/:slug*', '/f/:slug*']);
  is('слот @x не в URL, приватна _x не маршрутизується', [url('@modal/a/route.ts'), url('_p/route.ts')], ['/a', null]);
  is('route.tsx і route.js — теж обробники; page.tsx — ні', [url('a/route.tsx'), url('a/route.js'), url('a/page.tsx')], ['/a', '/a', null]);

  // ── справжній CLI на фікстурі ──
  const good = fixtureRoot(caddy(), OK_FILES);
  const bad = fixtureRoot(caddy(), [...OK_FILES, `${A}api/revalidate/route.ts`, `${A}api/deep/er/route.tsx`]);
  const broken = fixtureRoot(mutate(caddy(), '\thandle_path /api/* {', '\thandle_path /api/*'), OK_FILES);
  try {
    const g = runCli(['--root', good]);
    is('🔴 CLI: чистий корінь → код 0', g.code, 0);
    ok('…і друкує порт Next та кількість обробників', g.out.includes('Next = порт 3000') && g.out.includes('3 обробників'));
    const b = runCli(['--root', bad]);
    is('🔴 CLI: дефект → код 1', b.code, 1);
    ok('…і в stderr названо файл і префікс', b.out.includes(`${A}api/revalidate/route.ts`) && b.out.includes('/api/*'));
    ok('🔴 …і CLI знаходить вкладений route.tsx, не лише route.ts (перелік файлів — справжній, з диска)', b.out.includes(`${A}api/deep/er/route.tsx`));
    is('🔴 CLI: зламаний Caddyfile → код 1, не 0', runCli(['--root', broken]).code, 1);
    const none = runCli(['--root', path.join(good, 'nope')]);
    ok('🔴 CLI: --root в теку без Caddyfile → код 1 і ЗВ\'ЯЗНЕ повідомлення, а не стек ENOENT',
      none.code === 1 && none.out.includes('не знайдено') && !none.out.includes('ENOENT'));
    const typo = runCli(['--selftest']);
    ok('🔴 CLI: `--selftest` (одна літера) відхилено з назвою прапора, не мовчки', typo.code !== 0 && typo.out.includes('--selftest'));
  } finally {
    for (const d of [good, bad, broken]) rmSync(d, { recursive: true, force: true });
  }

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
