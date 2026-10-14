#!/usr/bin/env node
// CAMP-273: сторож відкритих PR від dependabot — кричить так, щоб після
// нього було зрозуміло, що робити, а не просто «червоно».
//
//   node scripts/ci/check-dependabot-prs.mjs                 # сухий прогін: нічого не пише
//   node scripts/ci/check-dependabot-prs.mjs --comment       # лише в Actions: пише коментарі в PR
//   node scripts/ci/check-dependabot-prs.mjs --pr 156        # один PR, будь-якого стану (для заміру)
//   node scripts/ci/check-dependabot-prs.mjs --pr 29 --as-of 2026-09-28T00:00:00Z
//   node scripts/ci/check-dependabot-prs.mjs --self-test     # без мережі
//
// ЗВІДКИ. PR #29 (`@nestjs/core` 10 → 12) простояв пʼять днів. Щодня
// було видно «червоний», і жодного разу ніхто не відкрив маніфест — а
// ламався він в одному рядку `apps/api/package.json`: решта пакетів Nest
// лишились на мажорі 10. 14.10.2026 те саме повторилось із #156/#158
// (react 18 → 19 в одному PR, react-dom лишився на 18 в іншому).
//
// ЩО РОБИТЬ. Для кожного відкритого PR від `app/dependabot`:
//
//   1. бере прогони за SHA голови, лишає `event == pull_request`,
//      викидає `cancelled` (дублі від `concurrency`) і рахує джоби;
//   2. читає діф маніфестів (база проти голови) і збирає, які пакети
//      підняті й до якого мажору;
//   3. шукає СУСІДІВ піднятих, що лишились на старішому мажорі, у ВСІХ
//      маніфестах монорепо, і називає їх поіменно, з версіями;
//   4. пише ОДИН коментар у PR і далі лише правитиме його.
//
// СУСІД — ЦЕ ВЛАСТИВІСТЬ, А НЕ СПИСОК СЛІВ. Пакет N є сусідом піднятого
// P, якщо виконується хоч одне з трьох:
//
//   scope    — спільний npm-скоуп (`@nestjs/core` ↔ `@nestjs/common`);
//   types    — N є `@types/P` або P є `@types/N`;
//   peer     — N оголошує peerDependencies на P (react-dom ↔ react), або P
//              оголошує їх на N.
//
// Зашитого списку `@nestjs/*`, `react*` тут немає: наступний випадок буде
// з пакетом поза списком, саме так ця картка й зʼявилась.
//
// «ЛИШИВСЯ НА СТАРІШОМУ МАЖОРІ» ТЕЖ НЕ «МЕНШЕ НІЖ У P». У живому
// `apps/api/package.json` лежить `@nestjs/throttler ^6` поруч із
// `@nestjs/*` ^12: той самий скоуп, мажор менший, і він НЕ відстає — в
// нього власна нумерація. Наївне «той самий скоуп і мажор нижчий» крикало
// б на кожен бамп Nest. Тому для scope/types сусід мусив стояти на тому ж
// мажорі, що й P ДО цього PR, і лишитись нижче після нього. Для peer —
// діапазон мусив приймати стару версію P і більше не приймати нову.
//
// `@types` — НЕ СКОУП-РОДИНА. Це простір імен DefinitelyTyped, у ньому
// живуть типи до тисячі різних проєктів; `@types/react` і `@types/jest`
// не сусіди, хоч і ділять скоуп. Для них діє лише пара `@types/X` ↔ `X`.
//
// ВИМІРЯНО НА ЦЬОМУ Ж РЕПО, І ЦЕ ЗМІНИЛО РІШЕННЯ. Картка каже «червоні
// ВСІ перевірки = неповний бамп». Заміряно 14.10.2026 на справжніх
// прогонах (`gh api repos/…/actions/runs/{id}/jobs`):
//
//   #29   CI: 7 із 7 джоб червоні, CodeQL зелений
//   #156  CI: gate і api зелені, web/public-build/security/e2e/visual/
//         lighthouse червоні (6 із 8), CodeQL зелений
//   #158  те саме, 6 із 8
//   #89   CI: security зелений, ще шість червоних
//
// Строге «усі червоні» не збігається НІ З ОДНИМ із чотирьох: CodeQL не
// залежить від маніфеста й зелений завжди, `gate` нічого не будує, а `api`
// не збирає `apps/web`. Тож сторож НЕ ставить «червоне все» умовою. Умова —
// названі сусіди + хоч одна червона перевірка + вік. «Червоне все» лишилось
// у тексті як ознака (картка права: це про маніфест, а не про тести), але
// не як ворота.
//
// СКАСОВАНІ ПРОГОНИ НЕ РАХУЮТЬСЯ ВЗАГАЛІ. Це дублі від `concurrency`
// (CAMP-269): на #226 в одній видачі лежали `cancelled` push-прогін і
// `cancelled` Scale check поруч із зеленим CI. І `gh pr checks` тут не
// годиться: він перелічує НАЗВИ ДЖОБ, а не workflow.
//
// «ПЕРЕВІРОК НЕМАЄ» ≠ «НІЧОГО НЕ ВПАЛО». Заміряно 14.10.2026 на 12
// останніх dependabot-PR (не випадкова вибірка): три з них (#93, #122,
// #145) не мали жодного прогону будь-якої події й усі три мали
// `mergeStateStatus = DIRTY` — конфлікт із main. Механізм у документації
// GitHub (подія `pull_request`): «Workflows will not run on `pull_request`
// activity if the pull request has a merge conflict» (перевірено
// 14.10.2026). В інтерфейсі це виглядає нешкідливо. Це окремий стан із
// окремим текстом.
//
// ПОРОЖНІЙ РЕЗУЛЬТАТ — ПРОВАЛ, А НЕ ТИША. Список PR порожній → питаємо
// історію: якщо серед останніх 500 PR жодного від dependabot, фільтр
// осліп (або dependabot вимкнули) — це помилка, а не «усе добре». Видача
// прогонів без масиву `workflow_runs` — помилка, а не «прогонів немає».
// Завершений прогін без жодної джоби — помилка. Один PR, що не
// прочитався, коштує одного PR і червоного кроку, а не всього прогону.

import { execFile, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { chooseAction, flagValue, flagValues } from '../lib/entrypoint.mjs';

const execFileP = promisify(execFile);

// ───────────────────────────────────────────────────────────────────────
// Пороги
// ───────────────────────────────────────────────────────────────────────

/**
 * Скільки діб PR від dependabot може лежати, перш ніж це саме по собі
 * привід крикнути.
 *
 * ДВІ ДОБИ, І ВИБІРКА НАЗВАНА. Зріз усіх 37 dependabot-PR цього
 * репозиторію в будь-якому стані, 14.10.2026:
 *
 *   gh pr list --state all --limit 400 --json number,author,createdAt,
 *     mergedAt,closedAt …   (author == app/dependabot)
 *
 * Життя від створення до злиття чи закриття: 25 PR прожили до 1,79 доби,
 * 12 — від 2,67 доби (2,67 2,69 2,69 2,71 3,43 4,83 4,91 10,43 10,49 ×4).
 * Між 1,79 і 2,67 ПОРОЖНЬО, і дві доби лягають рівно в цей розрив. #29 —
 * 4,91 доби, десятиденні PR далеко вище.
 *
 * Чому не 1: добу PR ще може просто не дійти до людини (створений у
 * п'ятницю ввечері). Дві доби — це один робочий день неуваги, як і
 * підказала картка. Чому не 3: сторож заговорив би про #29 на четверту
 * добу, а не на третю.
 *
 * ЦЕ ОДИН ЗРІЗ, і чесно про його слабкість: злитих серед 37 лише шість
 * (0,01 0,07 0,13 0,89 2,67 10,43), а більшість «коротких» PR 1–19 закриті
 * за годину прибиранням під час налаштування dependabot.yml, а не
 * рецензією. Розрив реальний, але вибірка мала — перемірити через місяць.
 *
 * Строге «>»: рівно дві доби ще мовчить.
 */
export const STALE_AFTER_DAYS = 2;
const DAY_MS = 86_400_000;
export const STALE_MS = STALE_AFTER_DAYS * DAY_MS;

/**
 * Скільки хвилин голова PR може не мати жодного прогону, перш ніж це
 * вважається станом, а не гонкою.
 *
 * ЗАМІРЯНО, не вгадано: на дев'яти PR (#226 #205 #158 #157 #156 #155
 * #154 #150 #149, 14.10.2026) від коміта голови до першого
 * `pull_request`-прогону минуло від 5 до 10 секунд. Година —
 * це запас на чергу в Actions, а не очікуваний час. Рахується від КОМІТА
 * ГОЛОВИ, а не від створення PR: dependabot перебазовує стару гілку, і
 * тоді PR старий, а голова щойно зʼявилась.
 */
export const NO_CHECKS_GRACE_MINUTES = 60;
const NO_CHECKS_GRACE_MS = NO_CHECKS_GRACE_MINUTES * 60_000;

/** Лише наш коментар містить цей рядок; за ним ми його й знаходимо. */
export const MARKER = '<!-- camp-273:dependabot-watchdog -->';

/** Під цим імʼям пише `github.token`. Чужий коментар із нашим маркером не наш. */
export const COMMENT_AUTHOR = 'github-actions[bot]';

const MAX_LISTED = 8;
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

// ───────────────────────────────────────────────────────────────────────
// Semver без залежностей
//
// Цей сторож біжить у джобі без `npm ci` (як і його сусіди в
// watchdog.yml), тож `semver` з node_modules недоступний. Реалізація
// звірена з `semver@7` на усіх 90 діапазонах peerDependencies із
// package-lock.json цього репо × сітці версій — див. звіт PR.
// ───────────────────────────────────────────────────────────────────────

const PRE = '[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*';
const VERSION_RE = new RegExp(`^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:-(${PRE}))?(?:\\+${PRE})?$`);
const XR = '(x|X|\\*|\\d+)';
const TOKEN_RE = new RegExp(
  `^(\\^|~>?|>=|<=|>|<|=)?v?${XR}(?:\\.${XR})?(?:\\.${XR})?(?:-(${PRE}))?(?:\\+${PRE})?$`,
);

const V = (major, minor = 0, patch = 0, pre = []) => ({ major, minor, patch, pre });
const isX = (s) => s === undefined || s === 'x' || s === 'X' || s === '*';

/** `12.1.0` → `{major,minor,patch,pre}`; не версія → `null`. */
export function parseVersion(text) {
  const m = VERSION_RE.exec(String(text).trim());
  if (!m) return null;
  return V(Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? m[4].split('.') : []);
}

export const formatVersion = (v) =>
  `${v.major}.${v.minor}.${v.patch}${v.pre.length > 0 ? `-${v.pre.join('.')}` : ''}`;

function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  // Реліз старший за будь-який свій пререліз.
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xNum) return -1;
    else if (yNum) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a, b) {
  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  return comparePre(a.pre, b.pre);
}

/** Один токен діапазону → список простих порівнянь `[оператор, версія]`. */
function expandToken(token) {
  const m = TOKEN_RE.exec(token);
  if (!m) throw new RangeError(`unreadable range token "${token}"`);
  const op = m[1] === '~>' ? '~' : (m[1] ?? '');
  const [a, b, c] = [m[2], m[3], m[4]];
  const pre = m[5] ? m[5].split('.') : [];
  if (isX(a)) {
    // `*` приймає все; `>*` і `<*` не приймають нічого.
    return op === '>' || op === '<' ? [['<', V(0)]] : [['>=', V(0)]];
  }
  const major = Number(a);
  const hasMinor = !isX(b);
  const hasPatch = hasMinor && !isX(c);
  const minor = hasMinor ? Number(b) : 0;
  const patch = hasPatch ? Number(c) : 0;
  const lo = V(major, minor, patch, hasPatch ? pre : []);
  // Одразу за записаною точністю: `1` → 2.0.0, `1.2` → 1.3.0.
  const next = hasMinor ? V(major, minor + 1) : V(major + 1);
  switch (op) {
    case '':
    case '=':
      return hasPatch ? [['=', lo]] : [['>=', lo], ['<', next]];
    case '^': {
      if (!hasMinor || major > 0) return [['>=', lo], ['<', V(major + 1)]];
      if (!hasPatch) return [['>=', lo], ['<', V(0, minor + 1)]];
      return [['>=', lo], ['<', minor > 0 ? V(0, minor + 1) : V(0, 0, patch + 1)]];
    }
    case '~':
      return hasMinor ? [['>=', lo], ['<', V(major, minor + 1)]] : [['>=', lo], ['<', V(major + 1)]];
    case '>=':
      return [['>=', lo]];
    case '>':
      return hasPatch ? [['>', lo]] : [['>=', next]];
    case '<':
      return [['<', lo]];
    case '<=':
      return hasPatch ? [['<=', lo]] : [['<', next]];
    default:
      throw new RangeError(`unknown operator "${op}"`);
  }
}

/** Діапазон → `OR` із наборів, у кожному `AND` простих порівнянь. Кидає на сміття. */
export function parseRange(range) {
  if (typeof range !== 'string') throw new RangeError('range is not a string');
  return range.split('||').map((part) => {
    const text = part
      .trim()
      .replace(/(\S+)\s+-\s+(\S+)/, '>=$1 <=$2')
      .replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1');
    if (text === '') return [['>=', V(0)]];
    return text.split(/\s+/).flatMap(expandToken);
  });
}

function holds(v, op, w) {
  const c = compareVersions(v, w);
  switch (op) {
    case '=':
      return c === 0;
    case '>=':
      return c >= 0;
    case '>':
      return c > 0;
    case '<=':
      return c <= 0;
    default:
      return c < 0;
  }
}

function setAllows(v, set) {
  if (!set.every(([op, w]) => holds(v, op, w))) return false;
  if (v.pre.length === 0) return true;
  // Пререліз проходить лише якщо діапазон сам називає пререліз ТІЄЇ Ж трійки.
  return set.some(
    ([, w]) =>
      w.pre.length > 0 && w.major === v.major && w.minor === v.minor && w.patch === v.patch,
  );
}

/** Чи приймає діапазон версію. Кидає на нечитабельний діапазон чи версію. */
export function satisfies(version, range) {
  const v = typeof version === 'string' ? parseVersion(version) : version;
  if (!v) throw new RangeError(`unreadable version "${version}"`);
  return parseRange(range).some((set) => setAllows(v, set));
}

/** Найнижча версія, яку діапазон може означати. Запасний вихід, коли lock мовчить. */
export function minVersion(range) {
  let best = null;
  for (const set of parseRange(range)) {
    let lo = V(0);
    for (const [op, w] of set) {
      if (op === '>=' || op === '=') {
        if (compareVersions(w, lo) > 0) lo = w;
      } else if (op === '>') {
        const above = V(w.major, w.minor, w.patch + 1);
        if (compareVersions(above, lo) > 0) lo = above;
      }
    }
    if (best === null || compareVersions(lo, best) < 0) best = lo;
  }
  return best;
}

// ───────────────────────────────────────────────────────────────────────
// Маніфести, lock, підняті пакети, сусіди
// ───────────────────────────────────────────────────────────────────────

const dirOf = (manifestPath) => manifestPath.replace(/(^|\/)package\.json$/, '');

/**
 * До якої версії діапазон з маніфеста справді розвʼязався.
 *
 * lock, АЛЕ ЛИШЕ ЯКЩО ВІН ЩЕ СХОДИТЬСЯ З МАНІФЕСТОМ. На #29 dependabot
 * змінив `apps/api/package.json` і не зачепив lock: маніфест казав
 * `^12.1.0`, lock — `10.4.22`. Вірити lock означало б побачити, що
 * `@nestjs/core` не підняли. Тоді береться нижня межа діапазону.
 *
 * Спершу `<dir>/node_modules/<name>` (локальна копія воркспейсу), потім
 * кореневий `node_modules/<name>`.
 *
 * @returns {{version: string, entry: object|null} | null} `null` для
 *   діапазону, який не версія (`workspace:*`, `git+…`, `npm:x@1`).
 */
export function resolveVersion(lock, dir, name, range) {
  try {
    parseRange(range);
  } catch {
    return null;
  }
  const keys = dir ? [`${dir}/node_modules/${name}`, `node_modules/${name}`] : [`node_modules/${name}`];
  for (const key of keys) {
    const entry = lock?.packages?.[key];
    if (entry?.version && parseVersion(entry.version) && satisfies(entry.version, range)) {
      return { version: entry.version, entry };
    }
  }
  const min = minVersion(range);
  return min ? { version: formatVersion(min), entry: null } : null;
}

/** Усе, що оголошено в маніфестах, плоским списком і в стабільному порядку. */
export function declaredIn(manifests) {
  const out = [];
  for (const manifest of Object.keys(manifests).sort()) {
    for (const section of SECTIONS) {
      for (const [name, range] of Object.entries(manifests[manifest]?.[section] ?? {})) {
        out.push({ manifest, section, name, range });
      }
    }
  }
  return out;
}

/**
 * Які пакети цей PR підняв: діапазон у маніфесті змінився і версія зросла.
 *
 * @param {{manifests: object, lock: object}} base  стан на merge-base
 * @param {{manifests: object, lock: object}} head  стан на голові PR
 */
export function findBumps(base, head, notes = []) {
  const before = new Map(
    declaredIn(base.manifests).map((d) => [`${d.manifest}\0${d.name}`, d]),
  );
  const out = [];
  for (const d of declaredIn(head.manifests)) {
    const was = before.get(`${d.manifest}\0${d.name}`);
    if (!was || was.range === d.range) continue;
    const from = resolveVersion(base.lock, dirOf(d.manifest), d.name, was.range);
    const to = resolveVersion(head.lock, dirOf(d.manifest), d.name, d.range);
    if (!from || !to) {
      notes.push(`${d.manifest}: ${d.name} "${was.range}" → "${d.range}" не читається як версія, пропущено`);
      continue;
    }
    // Зниження чи та сама версія — не бамп.
    if (compareVersions(parseVersion(to.version), parseVersion(from.version)) <= 0) continue;
    out.push({
      name: d.name,
      manifest: d.manifest,
      fromRange: was.range,
      toRange: d.range,
      from: from.version,
      to: to.version,
      fromEntry: from.entry,
      toEntry: to.entry,
    });
  }
  // Стабільне сортування за імʼям: однойменні лишаються в порядку маніфестів,
  // який уже задав `declaredIn`.
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** `@nestjs/core` → `@nestjs`; без скоупа → `null`. */
export const scopeOf = (name) => (name.startsWith('@') ? name.slice(0, name.indexOf('/')) : null);

/**
 * Ім'я типів для пакета за конвенцією DefinitelyTyped:
 * `react` → `@types/react`, `@babel/core` → `@types/babel__core`.
 */
export function typesNameFor(name) {
  if (name.startsWith('@types/')) return null;
  return name.startsWith('@') ? `@types/${name.slice(1).replace('/', '__')}` : `@types/${name}`;
}

/** Чи n і p — пара «пакет і його типи» в будь-який бік. */
export const isTypesPair = (n, p) => typesNameFor(p) === n || typesNameFor(n) === p;

/**
 * Скоуп, у якому пакети ВИПУСКАЮТЬСЯ РАЗОМ. `@types` — ні: це простір імен
 * DefinitelyTyped, а не проєкт.
 */
export function sharedScope(a, b) {
  const scope = scopeOf(a);
  return scope !== null && scope !== '@types' && scope === scopeOf(b);
}

/**
 * Сусіди піднятих пакетів, що лишились позаду, — поіменно й із причиною.
 *
 * Кожне з чотирьох правил питає про СТАН ДО PR і СТАН ПІСЛЯ, а не про
 * «менше чи більше»; чому — у заголовку файла.
 *
 * Один зіпсований запис (діапазон peer, що не читається) коштує одного
 * запису: він іде в `notes`, решта перевіряється далі.
 *
 * @returns {Array<{name,manifest,range,version,reasons:Array<object>}>}
 */
export function findLaggards({ bumps, base, head, notes = [] }) {
  const baseDecl = new Map(
    declaredIn(base.manifests).map((d) => [`${d.manifest}\0${d.name}`, d]),
  );
  const found = new Map();
  // Той самий пакет піднято в двох маніфестах (typescript в api і в web) —
  // причина та сама, і двічі її читати нікому.
  const reasonKey = (r) => [r.kind, r.via, r.range ?? '', r.to, r.major ?? '', r.name ?? ''].join('|');
  const add = (n, nh, reason) => {
    const key = `${n.name}\0${n.manifest}`;
    const slot = found.get(key) ?? {
      name: n.name,
      manifest: n.manifest,
      range: n.range,
      version: nh.version,
      reasons: [],
    };
    if (!slot.reasons.some((x) => reasonKey(x) === reasonKey(reason))) slot.reasons.push(reason);
    found.set(key, slot);
  };

  for (const p of bumps) {
    const pFrom = parseVersion(p.from);
    const pTo = parseVersion(p.to);
    const majorUp = pTo.major > pFrom.major;

    for (const n of declaredIn(head.manifests)) {
      if (n.name === p.name) continue;
      const nh = resolveVersion(head.lock, dirOf(n.manifest), n.name, n.range);
      if (!nh) continue;
      const nhV = parseVersion(nh.version);
      const wasDecl = baseDecl.get(`${n.manifest}\0${n.name}`);
      const wasRes = wasDecl ? resolveVersion(base.lock, dirOf(n.manifest), n.name, wasDecl.range) : null;
      const wasV = wasRes ? parseVersion(wasRes.version) : null;

      // scope / types: ішов у ногу з P до PR і відстав після нього.
      const inStep = wasV !== null && wasV.major === pFrom.major && nhV.major < pTo.major;
      if (majorUp && inStep && sharedScope(n.name, p.name)) {
        add(n, nh, { kind: 'scope', via: p.name, scope: scopeOf(n.name), major: pFrom.major, to: pTo.major });
      }
      if (majorUp && inStep && isTypesPair(n.name, p.name)) {
        add(n, nh, {
          kind: 'types',
          via: p.name,
          typesOfVia: typesNameFor(p.name) === n.name,
          major: pFrom.major,
          to: pTo.major,
        });
      }

      // peer: N вимагає P — діапазон приймав стару версію P і не приймає нову.
      const peerOnP = nh.entry?.peerDependencies?.[p.name];
      if (peerOnP !== undefined) {
        try {
          if (satisfies(p.from, peerOnP) && !satisfies(p.to, peerOnP)) {
            add(n, nh, { kind: 'peer-on', via: p.name, range: peerOnP, from: p.from, to: p.to });
          }
        } catch {
          notes.push(`${n.name}: peer-діапазон на ${p.name} "${peerOnP}" не читається, пропущено`);
        }
      }

      // peer: P вимагає N — N був у діапазоні, а тепер ні.
      const peerOfN = p.toEntry?.peerDependencies?.[n.name];
      if (peerOfN !== undefined) {
        try {
          const oldRange = p.fromEntry?.peerDependencies?.[n.name];
          const wasFine = oldRange === undefined || wasV === null || satisfies(wasV, oldRange);
          if (wasFine && !satisfies(nh.version, peerOfN)) {
            add(n, nh, { kind: 'peer-of', via: p.name, name: n.name, range: peerOfN, to: p.to, have: nh.version });
          }
        } catch {
          notes.push(`${p.name}: peer-діапазон на ${n.name} не читається, пропущено`);
        }
      }
    }
  }

  const kindOrder = ['scope', 'types', 'peer-on', 'peer-of'];
  return [...found.values()]
    .map((l) => ({
      ...l,
      reasons: l.reasons.sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ───────────────────────────────────────────────────────────────────────
// Прогони за SHA
// ───────────────────────────────────────────────────────────────────────

const RED = new Set(['failure', 'timed_out', 'startup_failure']);

/**
 * Які прогони взагалі мають право на слово.
 *
 * ТРИ ФІЛЬТРИ, КОЖЕН ЗІ СВОЄЇ ПРИЧИНИ:
 *   · `event == pull_request` — за SHA голови лежать і `push`-прогони тієї
 *     ж гілки (дублі, див. CAMP-269);
 *   · `cancelled` не рахується взагалі — це дублі від `concurrency`;
 *   · кілька живих прогонів одного workflow на одному SHA (закрили й
 *     відкрили PR) — береться найновіший, інакше джоби рахуються двічі.
 */
export function selectRuns(runs) {
  const asked = runs.filter((r) => r.event === 'pull_request');
  const kept = asked.filter((r) => r.conclusion !== 'cancelled');
  const newest = new Map();
  for (const r of kept) {
    const key = r.path ?? r.name;
    const seen = newest.get(key);
    if (!seen || r.run_number > seen.run_number) newest.set(key, r);
  }
  return {
    asked: asked.length,
    cancelled: asked.length - kept.length,
    duplicates: kept.length - newest.size,
    live: [...newest.values()].sort((a, b) => a.id - b.id),
  };
}

/**
 * Що сказали живі прогони. `jobsByRun` — `Map<runId, job[]>`.
 *
 * Зелене — `success`, червоне — `failure`/`timed_out` (і `startup_failure`
 * прогону: workflow не стартував, і це теж червоне). Усе інше
 * (`skipped`, `cancelled`, `neutral`, `action_required`) вердикту не дає.
 */
export function tally(live, jobsByRun) {
  const red = [];
  const green = [];
  let pending = 0;
  let ignored = 0;
  for (const run of live) {
    if (run.status !== 'completed') {
      pending += 1;
      continue;
    }
    if (run.conclusion === 'startup_failure') {
      red.push(`${run.name}: не стартував`);
      continue;
    }
    const jobs = jobsByRun.get(run.id);
    // Завершений прогін без жодної джоби — це зламаний запит, а не
    // «нічого червоного».
    if (!jobs || jobs.length === 0) {
      throw new Error(`run ${run.id} (${run.name}) завершився, але не віддав жодної джоби`);
    }
    for (const job of jobs) {
      const label = `${run.name}: ${job.name}`;
      if (job.status !== 'completed') pending += 1;
      else if (job.conclusion === 'success') green.push(label);
      else if (RED.has(job.conclusion)) red.push(label);
      else ignored += 1;
    }
  }
  return { red: red.sort(), green: green.sort(), pending, ignored };
}

/**
 * Форма картини. `no-checks` — вердикту немає зовсім; `all-red` — червоне
 * ВСЕ, що має вердикт (ознака з картки, не ворота: див. заголовок).
 */
export function shapeOf(t, liveRuns) {
  if (liveRuns === 0 || t.red.length + t.green.length + t.pending === 0) return 'no-checks';
  if (t.red.length > 0) return t.green.length === 0 ? 'all-red' : 'mixed-red';
  if (t.green.length > 0) return 'green';
  return 'pending';
}

/** Чому вердикту немає: зовсім нічого / лишились тільки скасовані / усе пропущено. */
export function noChecksDetail(sel) {
  if (sel.asked === 0) return 'none';
  if (sel.live.length === 0) return 'only-cancelled';
  return 'no-verdict';
}

// ───────────────────────────────────────────────────────────────────────
// Вирок
// ───────────────────────────────────────────────────────────────────────

/**
 * Мовчати чи кричати, і про що.
 *
 * ПОРЯДОК ВАЖЛИВИЙ:
 *   1. `no-checks` — окремий стан, і він не залежить від віку PR; лише від
 *      віку ГОЛОВИ (гонка з Actions);
 *   2. PR не старший за поріг мовчить, хоч би що було червоне: свіжий PR
 *      із червоним усім — звичайний перший день;
 *   3. названі сусіди + хоч одна червона → `incomplete-bump`;
 *   4. усе інше після порогу → `stale`.
 *
 * Названі сусіди без жодної червоної (усе зелене чи ще йде) у вирок
 * `incomplete-bump` не потрапляють: нема що пояснювати. Вони лишаються
 * приміткою в `stale`.
 */
export function judge(f, limits = { staleMs: STALE_MS, graceMs: NO_CHECKS_GRACE_MS }) {
  const stale = f.ageMs > limits.staleMs;
  if (f.shape === 'no-checks') {
    if (typeof f.headAgeMs !== 'number' || Number.isNaN(f.headAgeMs)) {
      throw new Error('вік коміта голови невідомий, а без нього «немає прогонів» не відрізнити від гонки');
    }
    return f.headAgeMs > limits.graceMs
      ? { ...f, kind: 'no-checks' }
      : { ...f, kind: 'silent', reason: 'прогонів ще немає, але коміт голови свіжий' };
  }
  if (!stale) return { ...f, kind: 'silent', reason: 'молодший за поріг' };
  if (f.laggards.length > 0 && f.tally.red.length > 0) return { ...f, kind: 'incomplete-bump' };
  return { ...f, kind: 'stale' };
}

// ───────────────────────────────────────────────────────────────────────
// Текст коментаря
//
// БЕЗ ЧИСЕЛ, ЩО РУХАЮТЬСЯ ЩОДНЯ. Коментар не повторюється, коли картина
// та сама, і порівнюється ДОСЛІВНО: «PR відкритий 5 діб» змінювалось би
// щодня й давало б щоденну правку. Тому тут дата створення, а не вік.
// ───────────────────────────────────────────────────────────────────────

const code = (s) => `\`${String(s).replace(/[`\r\n]/g, "'")}\``;
const oneLine = (s, max = 200) => String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max);

/** 1 доба, 2 доби, 5 діб. */
export function doby(n) {
  const last = n % 10;
  const tail = n % 100;
  if (last === 1 && tail !== 11) return 'доба';
  if (last >= 2 && last <= 4 && (tail < 12 || tail > 14)) return 'доби';
  return 'діб';
}

function bullets(items, max = MAX_LISTED) {
  const shown = items.slice(0, max).map((x) => `- ${x}`);
  if (items.length > max) shown.push(`- … і ще ${items.length - max}`);
  return shown;
}

const describeBump = (b) => `${code(b.name)} ${b.from} → ${b.to} (${code(b.manifest)})`;

function describeReason(r) {
  switch (r.kind) {
    case 'scope':
      return `скоуп ${code(r.scope)}, як і в ${code(r.via)}: до PR обидва на мажорі ${r.major}, ${code(r.via)} тепер ${r.to}`;
    case 'types':
      return r.typesOfVia
        ? `типи для ${code(r.via)}: до PR обидва на мажорі ${r.major}, ${code(r.via)} тепер ${r.to}`
        : `${code(r.via)} — типи для нього: до PR обидва на мажорі ${r.major}, ${code(r.via)} тепер ${r.to}`;
    case 'peer-on':
      return `peer ${code(`${r.via} ${r.range}`)}: ${r.from} приймав, піднятий ${r.to} не приймає`;
    case 'peer-of':
      return `піднятий ${code(r.via)} ${r.to} вимагає peer ${code(`${r.name} ${r.range}`)}, а тут ${r.have}`;
    default:
      return r.kind;
  }
}

const describeLaggard = (l) =>
  `${code(l.name)} ${code(l.range)}, стоїть ${l.version} (${code(l.manifest)}) — ${l.reasons.map(describeReason).join('; ')}`;

function listJobs(names) {
  const shown = names.slice(0, MAX_LISTED).join(', ');
  return names.length > MAX_LISTED ? `${shown} … і ще ${names.length - MAX_LISTED}` : shown;
}

function describeChecks(t, shape) {
  const total = t.red.length + t.green.length;
  const tail = t.pending > 0 ? ` Ще йде: ${t.pending}.` : '';
  switch (shape) {
    case 'all-red':
      return `Червоні ВСІ перевірки, що мають вердикт (${t.red.length}): ${listJobs(t.red)}.${tail}`;
    case 'mixed-red':
      return `Червоних ${t.red.length} із ${total}: ${listJobs(t.red)}. Зелені: ${listJobs(t.green)}.${tail}`;
    case 'green':
      return `Усі перевірки з вердиктом зелені (${t.green.length}).${tail}`;
    default:
      return `Вердикту ще немає: перевірки не завершились (${t.pending}).`;
  }
}

const FOOTER = [
  '---',
  `Сторож \`scripts/ci/check-dependabot-prs.mjs\` (CAMP-273), щодня о 08:00 UTC. ` +
    `Поріг — ${STALE_AFTER_DAYS} ${doby(STALE_AFTER_DAYS)}: це один робочий день неуваги, а в цьому репозиторії ` +
    `PR від dependabot або зливаються й закриваються швидше за 1,8 доби, або стоять понад 2,6 ` +
    `(зріз 37 PR, 14.10.2026). ` +
    `Той самий коментар сторож не повторює: картина та сама — мовчить, змінилась — правитиме цей коментар.`,
];

const MERGE_STATE_HINT = {
  DIRTY:
    'GitHub показує `DIRTY` — у PR конфлікт із main, а за документацією GitHub `pull_request`-воркфлоу ' +
    'не запускається, поки конфлікт є. Заміряно тут 14.10.2026: усі три PR без жодного прогону ' +
    '(#93, #122, #145) були саме `DIRTY`. Напиши `@dependabot rebase` у коментарі — після перебази прогін зʼявиться сам.',
  UNKNOWN: 'GitHub ще не порахував стан злиття (`UNKNOWN`), тож чи є конфлікт, сторож не бачить.',
};

function noChecksText(j) {
  const why = {
    none: 'Для коміта голови немає жодного прогону `pull_request`.',
    'only-cancelled': `Для коміта голови лишились тільки скасовані прогони (${j.cancelled}), а вони не рахуються: це дублі від concurrency і вердикту не дають.`,
    'no-verdict': 'Прогони є, але жоден не дав вердикту: усе пропущене чи чекає на дозвіл.',
  }[j.detail];
  const hint =
    MERGE_STATE_HINT[j.mergeState] ??
    `GitHub показує \`${oneLine(j.mergeState ?? 'невідомо', 40)}\`: конфлікту він не бачить, тож причини сторож не знає. Подивись вкладку Actions для цієї гілки.`;
  return [
    MARKER,
    '**Для цього PR немає жодної перевірки.**',
    '',
    why,
    '«Перевірок немає» в інтерфейсі виглядає нешкідливо, але це не «нічого не впало», а «ніхто нічого не перевірив»: ' +
      'PR може бути зламаний, і цього ніхто не побачить.',
    '',
    hint,
    '',
    `PR відкритий з ${j.createdOn}.`,
    '',
    ...FOOTER,
  ];
}

function incompleteText(j) {
  const manifests = [...new Set(j.laggards.map((l) => l.manifest))].sort();
  return [
    MARKER,
    '**Неповний бамп: PR підняв пакети, а їхніх сусідів лишив на старому мажорі.**',
    '',
    'Піднято в цьому PR:',
    ...bullets(j.bumps.map(describeBump)),
    '',
    'Лишились позаду (поіменно, з версіями):',
    ...bullets(j.laggards.map(describeLaggard)),
    '',
    describeChecks(j.tally, j.shape),
    'Поки сусіди не підняті разом із піднятим, будь-яка червона перевірка може бути наслідком цього, а не зламаної ' +
      'поведінки: спершу маніфест, потім тести.',
    '',
    'Що робити:',
    `1. Підніми перелічених пакетів до того ж мажору одним комітом у цю гілку (${manifests.map(code).join(', ')}, потім \`npm install\`).`,
    '2. Або закрий PR і занеси цей мажор у `ignore` у `.github/dependabot.yml` — так зроблено для react (CAMP-266).',
    '',
    `PR відкритий з ${j.createdOn}.`,
    '',
    ...FOOTER,
  ];
}

const STALE_HINT = {
  green:
    'Сам PR не зіллється, а чим довше він лежить, тим дорожче його зливати (main йде вперед). Злий або закрий.',
  'all-red':
    'Коли червоне все, зокрема те, що не залежить від коду, це майже завжди маніфест чи середовище, а не тести: ' +
    'відкрий маніфест і перший червоний крок, а не читай тести.',
  'mixed-red': 'Червоні окремі перевірки — це зазвичай справді зламана поведінка: читай саме ці тести.',
  pending: 'Перевірки ще не завершились; якщо вони висять довго, це теж привід зазирнути у вкладку Actions.',
};

const GREEN_BUT_INCOMPLETE =
  'Перевірки зелені, але маніфест неповний (нижче): зелене тут не означає «можна зливати». ' +
  'Підніми перелічених пакетів разом із піднятими або закрий PR.';

function staleText(j) {
  const incomplete = j.laggards.length > 0;
  const hint = incomplete && j.shape === 'green' ? GREEN_BUT_INCOMPLETE : STALE_HINT[j.shape];
  const lines = [
    MARKER,
    `**Dependabot-PR відкритий довше за поріг сторожа (${STALE_AFTER_DAYS} ${doby(STALE_AFTER_DAYS)}).**`,
    '',
    describeChecks(j.tally, j.shape),
    hint,
  ];
  if (incomplete) {
    lines.push(
      '',
      'Окрім того, маніфест неповний — сусіди піднятих пакетів лишились позаду (поіменно, з версіями):',
      ...bullets(j.laggards.map(describeLaggard)),
    );
  }
  lines.push('', `PR відкритий з ${j.createdOn}.`, '', ...FOOTER);
  return lines;
}

/** Тіло коментаря для вироку; `null`, коли сторожу нема що сказати. */
export function render(j) {
  switch (j.kind) {
    case 'no-checks':
      return noChecksText(j).join('\n');
    case 'incomplete-bump':
      return incompleteText(j).join('\n');
    case 'stale':
      return staleText(j).join('\n');
    default:
      return null;
  }
}

/** Коли причина зникла, наш старий коментар не лишається брехати. */
export const RESOLVED_BODY = [
  MARKER,
  'Сторож більше не бачить причини писати тут: PR або молодший за поріг, або перевірки знову мають вердикт. ' +
    'Текст вище застарів; нового сторож не додасть, поки картина не зміниться.',
].join('\n');

const normalise = (s) => String(s ?? '').replace(/\r\n/g, '\n').trimEnd();

/**
 * Що зробити з коментарем: нічого, створити чи виправити існуючий.
 *
 * ОДИН КОМЕНТАР НА PR. Наш — той, що має маркер І належить
 * `github-actions[bot]`; чужий коментар із нашим маркером не наш (його ми
 * не вправі правити, а підробкою не прикриєшся). Збігається дослівно
 * (з точністю до CRLF) — мовчимо: «сторож, який щодня пише те саме,
 * перестає читатись за тиждень».
 *
 * @param {Array<{id:number, body:string, user?:{login:string}}>} comments усі коментарі PR
 * @param {string|null} body  потрібний текст або `null`, коли причини немає
 */
export function planComment(comments, body) {
  const ours = comments
    .filter((c) => c.user?.login === COMMENT_AUTHOR && String(c.body ?? '').includes(MARKER))
    .sort((a, b) => a.id - b.id);
  const mine = ours[0];
  const wanted = body ?? (mine ? RESOLVED_BODY : null);
  if (wanted === null) return { action: 'none', why: 'нема що казати й нема що виправляти' };
  if (!mine) return { action: 'create', body: wanted };
  if (normalise(mine.body) === normalise(wanted)) return { action: 'none', why: 'коментар уже каже те саме', id: mine.id };
  return { action: 'update', id: mine.id, body: wanted };
}

// ───────────────────────────────────────────────────────────────────────
// gh
// ───────────────────────────────────────────────────────────────────────

/** Справжній `gh`; тести підсовують свій. Токен береться з середовища, у лог не йде. */
export function makeGh() {
  return async (args) => {
    const { stdout } = await execFileP('gh', args, { maxBuffer: 256 * 1024 * 1024, env: process.env });
    return stdout;
  };
}

async function ghJson(gh, args) {
  const text = await gh(args);
  if (text.trim() === '') throw new Error(`gh ${args.slice(0, 2).join(' ')} повернув порожню відповідь`);
  return JSON.parse(text);
}

/** Сторінки масиву: `?per_page=100&page=N`, доки сторінка не неповна. */
async function pagesOf(gh, endpoint, pick = (x) => x) {
  const out = [];
  for (let page = 1; page <= 50; page += 1) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const body = await ghJson(gh, ['api', `${endpoint}${sep}per_page=100&page=${page}`]);
    const items = pick(body);
    if (!Array.isArray(items)) throw new Error(`${endpoint}: у відповіді немає очікуваного масиву`);
    out.push(...items);
    if (items.length < 100) return out;
  }
  throw new Error(`${endpoint}: понад 50 сторінок, це не схоже на правду`);
}

export const createArgs = (repo, number, body) => [
  'api', '-X', 'POST', `repos/${repo}/issues/${number}/comments`, '-f', `body=${body}`,
];
export const updateArgs = (repo, id, body) => [
  'api', '-X', 'PATCH', `repos/${repo}/issues/comments/${id}`, '-f', `body=${body}`,
];

const PR_FIELDS = 'number,title,createdAt,headRefOid,baseRefName,author,mergeStateStatus,url';
export const isDependabot = (pr) => pr?.author?.login === 'app/dependabot';

async function listOpenDependabot(gh, repo) {
  const limit = 200;
  const all = await ghJson(gh, ['pr', 'list', '-R', repo, '--state', 'open', '--limit', String(limit), '--json', PR_FIELDS]);
  if (!Array.isArray(all)) throw new Error('gh pr list не повернув масив');
  if (all.length >= limit) throw new Error(`відкритих PR щонайменше ${limit}: список обрізано`);
  return all.filter(isDependabot);
}

/** Порожній список — це відповідь чи осліплий фільтр? Питаємо історію. */
async function dependabotInHistory(gh, repo) {
  const limit = 500;
  const all = await ghJson(gh, ['pr', 'list', '-R', repo, '--state', 'all', '--limit', String(limit), '--json', 'number,author']);
  return { total: all.length, dependabot: all.filter(isDependabot).length };
}

async function viewPr(gh, repo, number) {
  const pr = await ghJson(gh, ['pr', 'view', String(number), '-R', repo, '--json', PR_FIELDS]);
  if (!isDependabot(pr)) throw new Error(`#${number} — не PR від app/dependabot`);
  return pr;
}

async function fileAt(gh, repo, path, ref) {
  return gh(['api', `repos/${repo}/contents/${encodeURI(path)}?ref=${ref}`, '-H', 'Accept: application/vnd.github.raw+json']);
}

/** Діф маніфестів → підняті пакети й сусіди, що відстали. */
async function readNeighbours({ gh, repo, pr, notes }) {
  const files = await pagesOf(gh, `repos/${repo}/pulls/${pr.number}/files`);
  // PR без жодного файла — зламаний запит, а не «нічого не змінено».
  if (files.length === 0) throw new Error('PR не віддав жодного зміненого файла');
  if (!files.some((f) => /(^|\/)package(-lock)?\.json$/.test(f.filename))) {
    return { bumps: [], laggards: [] };
  }
  const changed = new Map(files.map((f) => [f.filename, f]));
  const mergeBase = (
    await ghJson(gh, ['api', `repos/${repo}/compare/${pr.baseRefName}...${pr.headRefOid}?per_page=1`])
  ).merge_base_commit?.sha;
  if (!mergeBase) throw new Error('compare не назвав merge-base');

  const tree = await ghJson(gh, ['api', `repos/${repo}/git/trees/${pr.headRefOid}?recursive=1`]);
  if (tree.truncated) throw new Error('дерево репозиторію обрізане, маніфести можуть бути не всі');
  const entries = tree.tree ?? [];
  const manifestPaths = entries
    .filter((e) => e.type === 'blob' && /(^|\/)package\.json$/.test(e.path) && !/(^|\/)node_modules\//.test(e.path))
    .map((e) => e.path)
    .sort();
  if (manifestPaths.length === 0) throw new Error('у дереві голови немає жодного package.json');
  if (!entries.some((e) => e.path === 'package-lock.json')) throw new Error('у дереві голови немає package-lock.json');

  const head = { manifests: {}, lock: null };
  const base = { manifests: {}, lock: null };
  for (const path of manifestPaths) {
    try {
      head.manifests[path] = JSON.parse(await fileAt(gh, repo, path, pr.headRefOid));
      const c = changed.get(path);
      if (!c) base.manifests[path] = head.manifests[path];
      else if (c.status !== 'added') {
        base.manifests[path] = JSON.parse(await fileAt(gh, repo, c.previous_filename ?? path, mergeBase));
      }
    } catch (e) {
      // Один маніфест, що не прочитався, коштує одного маніфеста.
      delete head.manifests[path];
      notes.push(`${path}: не прочитано (${oneLine(e.message, 120)})`);
    }
  }
  head.lock = JSON.parse(await fileAt(gh, repo, 'package-lock.json', pr.headRefOid));
  base.lock = changed.has('package-lock.json')
    ? JSON.parse(await fileAt(gh, repo, 'package-lock.json', mergeBase))
    : head.lock;

  const bumps = findBumps(base, head, notes);
  return { bumps, laggards: findLaggards({ bumps, base, head, notes }) };
}

/** Один PR → вирок. Кидає, якщо чогось не вдалось прочитати, і не мовчить. */
export async function analyzePr({ gh, repo, pr, now, notes = [] }) {
  const createdAt = Date.parse(pr.createdAt);
  if (Number.isNaN(createdAt)) throw new Error(`createdAt "${pr.createdAt}" не читається`);

  const runList = await pagesOf(gh, `repos/${repo}/actions/runs?head_sha=${pr.headRefOid}`, (b) => b?.workflow_runs);
  const sel = selectRuns(runList);
  const jobsByRun = new Map();
  for (const r of sel.live) {
    jobsByRun.set(r.id, await pagesOf(gh, `repos/${repo}/actions/runs/${r.id}/jobs`, (b) => b?.jobs));
  }
  const t = tally(sel.live, jobsByRun);
  const shape = shapeOf(t, sel.live.length);

  const facts = {
    number: pr.number,
    createdOn: String(pr.createdAt).slice(0, 10),
    ageMs: now - createdAt,
    mergeState: pr.mergeStateStatus,
    shape,
    tally: t,
    cancelled: sel.cancelled,
    detail: shape === 'no-checks' ? noChecksDetail(sel) : null,
    headAgeMs: null,
    bumps: [],
    laggards: [],
  };

  if (shape === 'no-checks') {
    const commit = await ghJson(gh, ['api', `repos/${repo}/commits/${pr.headRefOid}`]);
    facts.headAgeMs = now - Date.parse(commit?.commit?.committer?.date);
  } else if (facts.ageMs > STALE_MS) {
    // Діф читаємо лише тоді, коли сторож усе одно заговорить: для
    // свіжого PR це зайві дев'ять запитів і дев'ять місць, де можна впасти.
    Object.assign(facts, await readNeighbours({ gh, repo, pr, notes }));
  }
  return judge(facts);
}

/** Прочитати коментарі PR, вирішити, що робити, і (якщо `write`) зробити. */
export async function publish({ gh, repo, number, body, write }) {
  const comments = await pagesOf(gh, `repos/${repo}/issues/${number}/comments`);
  const plan = planComment(comments, body);
  if (write && plan.action === 'create') await gh(createArgs(repo, number, plan.body));
  if (write && plan.action === 'update') await gh(updateArgs(repo, plan.id, plan.body));
  return plan;
}

/**
 * Один прохід по всіх відкритих PR від dependabot.
 *
 * @returns {Promise<{code: 0|1, results: object[]}>} `1`, якщо зламався
 *   сам сторож (а не якщо він кричав): його червоний крок і є сигнал.
 */
export async function run({ gh, repo, now = Date.now(), write = false, only = [], log = console }) {
  const results = [];
  let prs;
  try {
    if (only.length > 0) {
      prs = [];
      for (const n of only) prs.push(await viewPr(gh, repo, n));
    } else {
      prs = await listOpenDependabot(gh, repo);
      if (prs.length === 0) {
        const history = await dependabotInHistory(gh, repo);
        // Порожньо й в історії — це або вимкнений dependabot, або
        // фільтр, що осліп. Обоє заслуговують червоного кроку, а не тиші.
        if (history.dependabot === 0) {
          log.error(
            `::error::Серед останніх ${history.total} PR жодного від app/dependabot: фільтр осліп ` +
              'або dependabot вимкнений. Порожній результат тут — провал, а не «усе добре».',
          );
          return { code: 1, results };
        }
        log.log(`Відкритих PR від dependabot немає (в історії їх ${history.dependabot} з ${history.total}).`);
        return { code: 0, results };
      }
    }
  } catch (e) {
    log.error(`::error::не вдалось отримати список PR: ${oneLine(e.message)}`);
    return { code: 1, results };
  }

  let failed = 0;
  for (const pr of prs) {
    const notes = [];
    try {
      const verdict = await analyzePr({ gh, repo, pr, now, notes });
      const plan = await publish({ gh, repo, number: pr.number, body: render(verdict), write });
      results.push({ number: pr.number, kind: verdict.kind, action: plan.action, verdict });
      log.log(
        `#${pr.number} ${verdict.kind}${verdict.reason ? ` (${verdict.reason})` : ''} → ${plan.action}${write ? '' : ' [сухий прогін]'}`,
      );
      // Сухий прогін показує дослівно те, що було б написано: людина має
      // побачити текст до того, як його побачить PR.
      if (!write && plan.body) for (const line of plan.body.split('\n')) log.log(`    | ${line}`);
    } catch (e) {
      // Один PR, що не прочитався, коштує одного PR.
      failed += 1;
      results.push({ number: pr.number, kind: 'error', error: e.message });
      log.error(`::error::#${pr.number} не перевірено: ${oneLine(e.message)}`);
    }
    for (const n of notes) log.log(`  примітка #${pr.number}: ${oneLine(n)}`);
  }
  const shouted = results.filter((r) => r.kind !== 'silent' && r.kind !== 'error').length;
  log.log(`Перевірено PR: ${prs.length}; сторож має що сказати про ${shouted}; не вдалось перевірити ${failed}.`);
  return { code: failed > 0 ? 1 : 0, results };
}

/** Що попросили з командного рядка, і що в такому разі заборонено. */
export function planInvocation(argv, env) {
  const only = flagValues(argv, '--pr').map((v) => {
    if (!/^\d+$/.test(v)) throw new Error(`--pr очікує номер PR, а не "${v}"`);
    return Number(v);
  });
  const asOf = flagValue(argv, '--as-of');
  if (asOf !== undefined && Number.isNaN(Date.parse(asOf))) {
    throw new Error(`--as-of очікує дату ISO, а не "${asOf}"`);
  }
  const write = argv.includes('--comment');
  if (write && env.GITHUB_ACTIONS !== 'true') {
    // Автор коментаря — `github-actions[bot]`. З чужого токена коментар
    // мав би іншого автора, сторож його не впізнав би й писав би новий щодня.
    throw new Error('--comment дозволено лише в GitHub Actions: тільки там автор коментаря відомий');
  }
  if (write && (only.length > 0 || asOf !== undefined)) {
    throw new Error('--comment не сполучається з --pr і --as-of: історичний замір не має писати в живі PR');
  }
  return { write, only, now: asOf === undefined ? Date.now() : Date.parse(asOf) };
}

async function main(argv) {
  const { write, only, now } = planInvocation(argv, process.env);
  const gh = makeGh();
  const repo =
    process.env.GITHUB_REPOSITORY ||
    (await gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])).trim();
  const { code: rc } = await run({ gh, repo, now, write, only });
  return rc;
}

// ───────────────────────────────────────────────────────────────────────
// Самотест
//
// ФІКСТУРИ НЕ ДІЛЯТЬ ПОЛЕ З ТИМ, ЩО МІРЯЮТЬ. Маніфести, lock і прогони
// нижче написані руками за формою справжніх (apps/api/package.json цього
// репо, пʼять чужих PR із історії), а не зібрані тими функціями, які
// перевіряються. Справжні #29, #156, #158, #89 і #226 прогнані окремо — у
// звіті PR.
//
// ТЕСТ ЧИТАЄ ТЕ, ЩО БУЛО ВІДДАНО. Наскрізні випадки ганяють `run()` проти
// підробленого `gh`, що пише кожне звернення; твердження йдуть про ТІЛО, яке
// сторож справді спробував надіслати, а не про константу чи клас.
// ───────────────────────────────────────────────────────────────────────

async function selfTest() {
  const CASES = [];
  const test = (name, fn) => CASES.push([name, fn]);
  const fail = (msg) => {
    throw new Error(msg);
  };
  const eq = (got, want, what = 'значення') => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`${what}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    }
  };
  const ok = (cond, what) => {
    if (!cond) fail(what);
  };
  const has = (text, sub, what = 'текст') => ok(String(text).includes(sub), `${what} не містить ${JSON.stringify(sub)}`);
  const lacks = (text, sub, what = 'текст') =>
    ok(!String(text).includes(sub), `${what} містить ${JSON.stringify(sub)}, а не мусить`);
  const throwsLike = (fn, re, what) => {
    try {
      fn();
    } catch (e) {
      ok(re.test(e.message), `${what}: інше повідомлення — ${e.message}`);
      return;
    }
    fail(`${what}: не кинуло`);
  };
  const v = parseVersion;
  const sat = (version, range) => satisfies(version, range);

  // ── semver ──────────────────────────────────────────────────────────

  test('semver: 12.1.0 читається, а ^1.2.3 і 1.2 — ні', () => {
    eq(parseVersion('12.1.0'), V(12, 1, 0), '12.1.0');
    eq(parseVersion('1.2.3-rc.1').pre, ['rc', '1'], 'пререліз');
    eq(parseVersion('^1.2.3'), null, '^1.2.3');
    eq(parseVersion('1.2'), null, '1.2');
  });

  test('semver: версії порівнюються числом, не рядком', () => {
    ok(compareVersions(v('1.10.0'), v('1.9.0')) > 0, '1.10.0 мусить бути старшою за 1.9.0');
    ok(compareVersions(v('2.0.0'), v('1.99.99')) > 0, 'мажор старший за мінор');
    ok(compareVersions(v('1.2.10'), v('1.2.9')) > 0, 'патч числом');
    eq(compareVersions(v('1.2.3'), v('1.2.3')), 0, 'рівні версії');
  });

  test('semver: пререліз молодший за реліз, а його ідентифікатори — числом', () => {
    ok(compareVersions(v('1.0.0-rc.1'), v('1.0.0')) < 0, 'rc.1 < реліз');
    ok(compareVersions(v('1.0.0-rc.2'), v('1.0.0-rc.10')) < 0, 'rc.2 < rc.10');
    ok(compareVersions(v('1.0.0-alpha'), v('1.0.0-beta')) < 0, 'alpha < beta');
    ok(compareVersions(v('1.0.0-1'), v('1.0.0-alpha')) < 0, 'числовий ідентифікатор < буквений');
    ok(compareVersions(v('1.0.0-alpha'), v('1.0.0-1')) > 0, 'буквений > числовий');
    ok(compareVersions(v('1.0.0-rc'), v('1.0.0-rc.1')) < 0, 'коротший набір ідентифікаторів молодший');
    ok(compareVersions(v('1.0.0-rc.1'), v('1.0.0-rc')) > 0, 'довший набір старший');
    ok(compareVersions(v('1.0.0'), v('1.0.0-rc.1')) > 0, 'реліз старший за свій пререліз');
  });

  test('semver: каретка — межа за першою ненульовою цифрою', () => {
    ok(sat('18.3.1', '^18.3.1') && sat('18.9.0', '^18.3.1'), '^18.3.1 приймає 18.3.1 і 18.9.0');
    ok(!sat('18.3.0', '^18.3.1'), '^18.3.1 не приймає 18.3.0');
    ok(!sat('19.0.0', '^18.3.1'), '^18.3.1 не приймає 19.0.0');
    ok(sat('0.5.9', '^0.5.0') && !sat('0.6.0', '^0.5.0'), '^0.5.0 тримає мінор');
    ok(sat('0.0.3', '^0.0.3') && !sat('0.0.4', '^0.0.3'), '^0.0.3 тримає патч');
    ok(sat('1.9.0', '^1') && !sat('2.0.0', '^1'), '^1');
  });

  test('semver: тильда, x-діапазони, зірка, дефіс', () => {
    ok(sat('1.2.9', '~1.2.3') && !sat('1.3.0', '~1.2.3'), '~1.2.3');
    ok(sat('1.9.0', '~1') && !sat('2.0.0', '~1'), '~1');
    ok(sat('18.2.0', '18.x') && !sat('19.0.0', '18.x'), '18.x');
    ok(sat('1.2.9', '1.2.x') && !sat('1.3.0', '1.2.x'), '1.2.x');
    ok(sat('99.0.0', '*') && sat('0.0.1', 'x'), '* і x приймають усе');
    ok(!sat('1.0.0', '>*') && !sat('1.0.0', '<*') && sat('1.0.0', '>=*') && sat('1.0.0', '<=*'), '>* і <* не приймають нічого, >=* і <=* — усе');
    ok(sat('2.0.0', '1.2.3 - 2.3.4') && !sat('2.3.5', '1.2.3 - 2.3.4'), 'дефіс');
    ok(sat('2.9.0', '1.2 - 2') && !sat('3.0.0', '1.2 - 2'), 'дефіс із неповним краєм');
  });

  test('semver: порівняння, межі й АБО', () => {
    ok(sat('4.8.4', '>=4.8.4 <5.9.0') && sat('5.8.9', '>=4.8.4 <5.9.0'), 'межі приймаються');
    ok(!sat('5.9.0', '>=4.8.4 <5.9.0') && !sat('4.8.3', '>=4.8.4 <5.9.0'), 'межі не приймаються');
    ok(sat('18.0.0', '>= 16.8.0'), 'пробіл після оператора');
    ok(sat('19.0.0', '^16 || ^17 || ^18 || ^19') && !sat('20.0.0', '^16 || ^17 || ^18 || ^19'), 'АБО');
    ok(sat('1.5.0', '>1.2') && !sat('1.2.9', '>1.2'), '>1.2 починається з 1.3.0');
    ok(sat('1.2.9', '<=1.2') && !sat('1.3.0', '<=1.2'), '<=1.2 закінчується на 1.2.x');
    ok(sat('1.0.0', '=1.0.0') && !sat('1.0.1', '1.0.0'), 'точна версія');
  });

  test('semver: пререліз проходить лише в діапазон, що сам його називає', () => {
    ok(!sat('19.0.0-rc.1', '^19.0.0'), '^19.0.0 не приймає 19.0.0-rc.1');
    ok(sat('19.0.0-rc.1', '^19.0.0-rc.0'), '^19.0.0-rc.0 приймає 19.0.0-rc.1');
    ok(!sat('19.1.0-rc.1', '^19.0.0-rc.0'), 'пререліз іншого мінору не проходить');
    ok(!sat('19.0.1-rc.1', '^19.0.0-rc.0'), 'пререліз іншого патчу не проходить');
    ok(!sat('2.0.0-beta', '^1.2.3'), 'пререліз наступного мажору не лізе в каретку');
    ok(!sat('1.0.0-rc.1', '*'), '* не приймає пререліз');
  });

  test('semver: сміття у діапазоні кидає, а не відповідає «ні»', () => {
    for (const bad of ['workspace:*', 'npm:other@^1.0.0', 'git+https://x/y.git', 'latest', 'file:../x']) {
      throwsLike(() => sat('1.0.0', bad), /unreadable/, bad);
    }
    throwsLike(() => sat('not-a-version', '^1'), /unreadable version/, 'версія-сміття');
  });

  test('semver: minVersion — нижня межа діапазону', () => {
    eq(formatVersion(minVersion('^12.1.2')), '12.1.2', '^12.1.2');
    eq(formatVersion(minVersion('>=4.8.4 <5.9.0')), '4.8.4', 'межі');
    eq(formatVersion(minVersion('^16 || ^14')), '14.0.0', 'АБО бере найменше');
    eq(formatVersion(minVersion('*')), '0.0.0', '*');
    eq(formatVersion(minVersion('>1.2.3')), '1.2.4', '> бере наступний патч');
  });

  // ── lock і розвʼязання версій ───────────────────────────────────────

  const ent = (version, peers) => ({ version, ...(peers ? { peerDependencies: peers } : {}) });
  const lockOf = (entries) => ({ lockfileVersion: 3, packages: { '': {}, ...entries } });
  const pkg = (deps = {}, dev = {}) => JSON.stringify({ name: 'w', dependencies: deps, devDependencies: dev });

  test('версія береться з lock, коли lock сходиться з діапазоном', () => {
    const lock = lockOf({ 'node_modules/react': ent('18.3.1') });
    eq(resolveVersion(lock, '', 'react', '^18').version, '18.3.1', 'з lock, а не нижня межа 18.0.0');
  });

  test('lock, що не сходиться з маніфестом (як на #29), не береться на віру', () => {
    const lock = lockOf({ 'node_modules/@nestjs/core': ent('10.4.22') });
    eq(resolveVersion(lock, 'apps/api', '@nestjs/core', '^12.1.0').version, '12.1.0', 'нижня межа діапазону');
    eq(resolveVersion(lock, 'apps/api', '@nestjs/core', '^12.1.0').entry, null, 'запис lock не належить цій версії');
  });

  test('копія воркспейсу в apps/x/node_modules старша за кореневу', () => {
    const lock = lockOf({
      'node_modules/react': ent('18.2.0'),
      'apps/web/node_modules/react': ent('18.3.1'),
    });
    eq(resolveVersion(lock, 'apps/web', 'react', '^18').version, '18.3.1', 'локальна копія, хоч коренева теж підходить');
    eq(resolveVersion(lock, 'apps/api', 'react', '^18').version, '18.2.0', 'кореневу бачить інший воркспейс');
  });

  test('діапазон, що не є версією (workspace:*, npm:), не розвʼязується', () => {
    eq(resolveVersion(lockOf({}), '', 'x', 'workspace:*'), null, 'workspace:*');
    eq(resolveVersion(lockOf({}), '', 'x', 'npm:y@^1'), null, 'npm:');
  });

  test('маніфести: dependencies, devDependencies і optionalDependencies читаються, peerDependencies воркспейсу — ні', () => {
    const got = declaredIn({ 'package.json': { dependencies: { a: '^1' }, devDependencies: { b: '^1' }, optionalDependencies: { c: '^1' }, peerDependencies: { d: '^1' } } });
    eq(got.map((d) => `${d.section}:${d.name}`), ['dependencies:a', 'devDependencies:b', 'optionalDependencies:c'], 'три секції');
  });

  // ── підняті пакети ──────────────────────────────────────────────────

  const state = (manifests, lock) => ({ manifests, lock });
  const M = (obj) => JSON.parse(obj);

  test('бамп: змінений діапазон із версією, що зросла, — і з якої на яку', () => {
    const base = state({ 'apps/api/package.json': M(pkg({ '@nestjs/core': '^10.4.22' })) }, lockOf({ 'node_modules/@nestjs/core': ent('10.4.30') }));
    const head = state({ 'apps/api/package.json': M(pkg({ '@nestjs/core': '^12.1.0' })) }, lockOf({ 'node_modules/@nestjs/core': ent('12.1.7') }));
    const bumps = findBumps(base, head);
    eq(bumps.length, 1, 'один бамп');
    eq([bumps[0].name, bumps[0].manifest, bumps[0].from, bumps[0].to], ['@nestjs/core', 'apps/api/package.json', '10.4.30', '12.1.7'], 'що й куди: версії з lock бази й lock голови, не нижні межі діапазонів');
    eq([bumps[0].fromRange, bumps[0].toRange], ['^10.4.22', '^12.1.0'], 'діапазони');
  });

  test('бамп із несинхронним lock (як на #29) бачить нову версію з маніфеста', () => {
    const lock = lockOf({ 'node_modules/@nestjs/core': ent('10.4.22') });
    const base = state({ 'apps/api/package.json': M(pkg({ '@nestjs/core': '^10.4.22' })) }, lock);
    const head = state({ 'apps/api/package.json': M(pkg({ '@nestjs/core': '^12.1.0' })) }, lock);
    eq(findBumps(base, head)[0].to, '12.1.0', 'нижня межа ^12.1.0');
  });

  test('не бамп: діапазон той самий, нова залежність, зниження, та сама версія', () => {
    // a: діапазон той самий, а lock зрушив 1.5.0 → 1.6.0 (оновлення в межах діапазону).
    const lock = lockOf({ 'node_modules/a': ent('1.6.0'), 'node_modules/b': ent('2.0.0'), 'node_modules/c': ent('3.0.0') });
    const base = state({ 'package.json': M(pkg({ a: '^1.0.0', b: '^3.0.0', c: '^3.0.0' })) }, lockOf({ 'node_modules/a': ent('1.5.0'), 'node_modules/b': ent('3.0.0'), 'node_modules/c': ent('3.0.0') }));
    const head = state({ 'package.json': M(pkg({ a: '^1.0.0', b: '^2.0.0', c: '~3.0.0', fresh: '^1.0.0' })) }, lock);
    eq(findBumps(base, head), [], 'жодного бампа: a — лише lock, b знижений, c тієї ж версії, fresh новий');
  });

  test('бамп: діапазон, що не читається, коштує одного запису, а не всіх', () => {
    const lock = lockOf({ 'node_modules/good': ent('2.0.0'), 'node_modules/odd': ent('1.0.0') });
    const base = state({ 'package.json': M(pkg({ good: '^1.0.0', odd: 'npm:x@^1' })) }, lock);
    const head = state({ 'package.json': M(pkg({ good: '^2.0.0', odd: 'npm:x@^2' })) }, lock);
    const notes = [];
    const bumps = findBumps(base, head, notes);
    eq(bumps.map((b) => b.name), ['good'], 'good знайдено');
    eq(notes.length, 1, 'odd записано в примітки');
    has(notes[0], 'odd', 'примітка');
  });

  test('бамп: порядок не залежить від порядку маніфестів і ключів', () => {
    const lock = lockOf({});
    const mk = (order) => {
      const o = {};
      for (const k of order) o[k] = M(pkg({ z: '^2.0.0', a: '^2.0.0' }));
      return o;
    };
    const base = (order) => { const o = {}; for (const k of order) o[k] = M(pkg({ z: '^1.0.0', a: '^1.0.0' })); return o; };
    const one = findBumps(state(base(['b/package.json', 'a/package.json']), lock), state(mk(['b/package.json', 'a/package.json']), lock));
    const two = findBumps(state(base(['a/package.json', 'b/package.json']), lock), state(mk(['a/package.json', 'b/package.json']), lock));
    eq(one.map((b) => `${b.manifest}:${b.name}`), two.map((b) => `${b.manifest}:${b.name}`), 'однаковий порядок');
    eq(one.map((b) => `${b.manifest}:${b.name}`), ['a/package.json:a', 'b/package.json:a', 'a/package.json:z', 'b/package.json:z'], 'за імʼям, потім за маніфестом');
  });

  // ── сусіди, що лишились позаду ──────────────────────────────────────

  const API = 'apps/api/package.json';
  const WEB = 'apps/web/package.json';
  const laggardsOf = (base, head, notes = []) => {
    const bumps = findBumps(base, head, notes);
    return findLaggards({ bumps, base, head, notes });
  };
  const namesOf = (laggards) => laggards.map((l) => l.name);

  // Nest, за формою живого apps/api/package.json. Throttler має власну
  // нумерацію (^6 поруч із ^12) і БЕЗ peer-ів: так його не врятує peer-правило, і
  // перевіряється саме правило скоупа.
  const nestApi = (over = {}) =>
    M(pkg({ '@nestjs/core': '^10.4.22', '@nestjs/common': '^10.4.22', '@nestjs/platform-express': '^10.4.22', '@nestjs/throttler': '^6.7.1', rxjs: '^7.8.1', ...over }));
  const nestLock10 = () =>
    lockOf({
      'node_modules/@nestjs/core': ent('10.4.22', { '@nestjs/common': '^10.0.0', '@nestjs/platform-express': '^10.0.0' }),
      'node_modules/@nestjs/common': ent('10.4.22'),
      'node_modules/@nestjs/platform-express': ent('10.4.22', { '@nestjs/common': '^10.0.0', '@nestjs/core': '^10.0.0' }),
      'node_modules/@nestjs/throttler': ent('6.7.1'),
      'node_modules/rxjs': ent('7.8.1'),
    });
  const nestLock12 = (commonVersion = '12.1.0') =>
    lockOf({
      'node_modules/@nestjs/core': ent('12.1.0', { '@nestjs/common': '^12.0.0', '@nestjs/platform-express': '^12.0.0' }),
      'node_modules/@nestjs/common': ent(commonVersion),
      'node_modules/@nestjs/platform-express': ent('12.1.0', { '@nestjs/common': '^12.0.0', '@nestjs/core': '^12.0.0' }),
      'node_modules/@nestjs/throttler': ent('6.7.1'),
      'node_modules/rxjs': ent('7.8.1'),
    });
  const nestBase = () => state({ [API]: nestApi() }, nestLock10());
  // #29: маніфест піднято, lock не зачеплено.
  const nestHeadIncomplete = () => state({ [API]: nestApi({ '@nestjs/core': '^12.1.0' }) }, nestLock10());

  test('сусід: core піднято, common лишився — назвало @nestjs/common із версіями', () => {
    const got = laggardsOf(nestBase(), nestHeadIncomplete());
    const common = got.find((l) => l.name === '@nestjs/common');
    ok(common, '@nestjs/common мусить бути названий');
    eq([common.manifest, common.range, common.version], [API, '^10.4.22', '10.4.22'], 'де, який діапазон, що стоїть');
    eq(common.reasons, [{ kind: 'scope', via: '@nestjs/core', scope: '@nestjs', major: 10, to: 12 }], 'чому');
  });

  test('сусід: platform-express названо за двома причинами — скоуп і peer на core', () => {
    const got = laggardsOf(nestBase(), nestHeadIncomplete());
    const pe = got.find((l) => l.name === '@nestjs/platform-express');
    eq(pe.reasons.map((r) => r.kind), ['scope', 'peer-on'], 'обидві причини, у стабільному порядку');
    eq(pe.reasons[1].range, '^10.0.0', 'діапазон peer');
  });

  test('сусід: @nestjs/throttler (власна нумерація ^6) НЕ названий — це жива помилка, якої не було б зі «скоуп і менший мажор»', () => {
    const got = laggardsOf(nestBase(), nestHeadIncomplete());
    ok(!namesOf(got).includes('@nestjs/throttler'), 'throttler не відстав: він ніколи не йшов у ногу з core');
    ok(!namesOf(got).includes('rxjs'), 'rxjs без скоупа не сусід');
    eq(namesOf(got), ['@nestjs/common', '@nestjs/platform-express'], 'рівно двоє');
  });

  test('сусід: усі піднято разом — порожньо (картка: «сусіди підняті — сторож мовчить»)', () => {
    const head = state({ [API]: nestApi({ '@nestjs/core': '^12.1.0', '@nestjs/common': '^12.1.0', '@nestjs/platform-express': '^12.1.0' }) }, nestLock12());
    const bumps = findBumps(nestBase(), head);
    eq(bumps.map((b) => b.name), ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express'], 'піднято трьох');
    eq(findLaggards({ bumps, base: nestBase(), head }), [], 'відстаючих немає');
  });

  test('сусід: піднятий до ІНШОГО, нижчого мажору — все ще відстає', () => {
    const head = state({ [API]: nestApi({ '@nestjs/core': '^12.1.0', '@nestjs/common': '^11.0.0', '@nestjs/platform-express': '^12.1.0' }) }, nestLock12('11.1.0'));
    const got = laggardsOf(nestBase(), head);
    eq(namesOf(got), ['@nestjs/common'], 'common піднято до 11, core — до 12');
    eq(got[0].version, '11.1.0', 'версія голови, а не бази');
  });

  test('сусід: мінор чи патч скоуп не чіпає (правило скоупа питає про мажор)', () => {
    const base = nestBase();
    const head = state({ [API]: nestApi({ '@nestjs/core': '^10.4.23' }) }, nestLock10());
    head.lock.packages['node_modules/@nestjs/core'] = ent('10.4.23', { '@nestjs/common': '^10.0.0', '@nestjs/platform-express': '^10.0.0' });
    eq(laggardsOf(base, head), [], 'патч-бамп core не робить common відстаючим');
  });

  test('сусід: простір імен @types — не родина, лише пара @types/X ↔ X', () => {
    const base = state({ [WEB]: M(pkg({ react: '^18.3.1' }, { '@types/react': '^18.3.12', '@types/other-lib': '^18.0.1' })) },
      lockOf({ 'node_modules/react': ent('18.3.1'), 'node_modules/@types/react': ent('18.3.12'), 'node_modules/@types/other-lib': ent('18.0.1') }));
    const head = state({ [WEB]: M(pkg({ react: '^18.3.1' }, { '@types/react': '^19.0.0', '@types/other-lib': '^18.0.1' })) },
      lockOf({ 'node_modules/react': ent('18.3.1'), 'node_modules/@types/react': ent('19.0.0'), 'node_modules/@types/other-lib': ent('18.0.1') }));
    eq(namesOf(laggardsOf(base, head)), ['react'], 'react — пара до @types/react; @types/other-lib на тому ж мажорі 18, але не сусід');
  });

  // react 18 → 19 половиною (як #156), з пакетом без скоупа на тому ж мажорі.
  const webBase = () =>
    state({ [WEB]: M(pkg({ react: '^18', 'react-dom': '^18', 'unrelated-lib': '^18.2.0' }, { '@types/react': '^18', '@types/react-dom': '^18' })) },
      lockOf({
        'node_modules/react': ent('18.3.1'),
        'node_modules/react-dom': ent('18.3.1', { react: '^18.3.1' }),
        'node_modules/unrelated-lib': ent('18.2.0'),
        'node_modules/@types/react': ent('18.3.12'),
        'node_modules/@types/react-dom': ent('18.3.1', { '@types/react': '^18.0.0' }),
      }));
  const webHeadReactHalf = () =>
    state({ [WEB]: M(pkg({ react: '^19.0.0', 'react-dom': '^18', 'unrelated-lib': '^18.2.0' }, { '@types/react': '^19.0.0', '@types/react-dom': '^18' })) },
      lockOf({
        'node_modules/react': ent('19.0.1'),
        'node_modules/react-dom': ent('18.3.1', { react: '^18.3.1' }),
        'node_modules/unrelated-lib': ent('18.2.0'),
        'node_modules/@types/react': ent('19.0.2'),
        'node_modules/@types/react-dom': ent('18.3.1', { '@types/react': '^18.0.0' }),
      }));

  test('сусід: react піднято, react-dom лишився — назвало react-dom і @types/react-dom за peer-ами', () => {
    const got = laggardsOf(webBase(), webHeadReactHalf());
    eq(namesOf(got), ['@types/react-dom', 'react-dom'], 'обидва поіменно');
    const dom = got.find((l) => l.name === 'react-dom');
    eq(dom.reasons, [{ kind: 'peer-on', via: 'react', range: '^18.3.1', from: '18.3.1', to: '19.0.1' }], 'react-dom: peer ^18.3.1 приймав 18.3.1, а 19.0.1 не приймає');
    eq(got.find((l) => l.name === '@types/react-dom').reasons[0].via, '@types/react', '@types/react-dom: peer на @types/react');
  });

  test('сусід: пакет без скоупа з тим самим мажором не сусід (null === null не родина)', () => {
    ok(!namesOf(laggardsOf(webBase(), webHeadReactHalf())).includes('unrelated-lib'), 'unrelated-lib стоїть на 18, як і react, але нічим із ним не повʼязаний');
  });

  test('сусід: типи в обидва боки — @types/react для react і react для @types/react', () => {
    const base = webBase();
    const typesOnly = state({ [WEB]: M(pkg({ react: '^19.0.0', 'react-dom': '^19.0.0' }, { '@types/react': '^18.3.12', '@types/react-dom': '^19.0.0' })) },
      lockOf({ 'node_modules/react': ent('19.0.0'), 'node_modules/react-dom': ent('19.0.0', { react: '^19.0.0' }), 'node_modules/@types/react': ent('18.3.12'), 'node_modules/@types/react-dom': ent('19.0.0', { '@types/react': '^19.0.0' }) }));
    // react і react-dom — 19, @types/react лишився: типи для react відстали.
    const got = laggardsOf(base, typesOnly);
    const types = got.find((l) => l.name === '@types/react');
    ok(types, '@types/react названо');
    ok(types.reasons.some((r) => r.kind === 'types' && r.via === 'react' && r.typesOfVia === true), 'причина: типи для react');
    // Навпаки: піднято лише @types/react, react лишився.
    const reverse = state({ [WEB]: M(pkg({ react: '^18.3.1' }, { '@types/react': '^19.0.0' })) },
      lockOf({ 'node_modules/react': ent('18.3.1'), 'node_modules/@types/react': ent('19.0.0') }));
    const rbase = state({ [WEB]: M(pkg({ react: '^18.3.1' }, { '@types/react': '^18.3.12' })) },
      lockOf({ 'node_modules/react': ent('18.3.1'), 'node_modules/@types/react': ent('18.3.12') }));
    const back = laggardsOf(rbase, reverse);
    eq(namesOf(back), ['react'], 'react відстав від своїх типів');
    ok(back[0].reasons.some((r) => r.kind === 'types' && r.via === '@types/react' && r.typesOfVia === false), 'причина: це пакет, для якого @types/react — типи');
  });

  test('сусід: імʼя типів для пакета зі скоупом — @babel/core ↔ @types/babel__core', () => {
    eq(typesNameFor('@babel/core'), '@types/babel__core', 'скоуп у типах — подвійне підкреслення');
    eq(typesNameFor('react'), '@types/react', 'без скоупа');
    eq(typesNameFor('@types/react'), null, 'у типів типів немає');
    ok(isTypesPair('@types/babel__core', '@babel/core') && isTypesPair('@babel/core', '@types/babel__core'), 'пара в обидва боки');
    const base = state({ 'package.json': M(pkg({ '@babel/core': '^7.0.0' }, { '@types/babel__core': '^7.0.0' })) }, lockOf({ 'node_modules/@babel/core': ent('7.0.0'), 'node_modules/@types/babel__core': ent('7.0.0') }));
    const head = state({ 'package.json': M(pkg({ '@babel/core': '^8.0.0' }, { '@types/babel__core': '^7.0.0' })) }, lockOf({ 'node_modules/@babel/core': ent('8.0.0'), 'node_modules/@types/babel__core': ent('7.0.0') }));
    const got = laggardsOf(base, head);
    eq(namesOf(got), ['@types/babel__core'], 'типи до @babel/core лишились на 7');
    eq(got[0].reasons.map((r) => r.kind), ['types'], 'лише типи: скоуп @types не родина, @babel/core ≠ @types');
  });

  // #158: піднято react-dom разом з типами, react лишився. Peer — з боку піднятого.
  const domBase = (peers) =>
    state({ [WEB]: M(pkg({ react: '^18.3.1', 'react-dom': '^18.3.1' })) },
      lockOf({ 'node_modules/react': ent('18.3.1'), 'node_modules/react-dom': ent('18.3.1', peers) }));
  const domHead = (peers) =>
    state({ [WEB]: M(pkg({ react: '^18.3.1', 'react-dom': '^19.0.0' })) },
      lockOf({ 'node_modules/react': ent('18.3.1'), 'node_modules/react-dom': ent('19.0.0', peers) }));

  test('сусід: піднятий react-dom вимагає peer react ^19, а react лишився на 18 — названо react', () => {
    const got = laggardsOf(domBase({ react: '^18.3.1' }), domHead({ react: '^19.0.0' }));
    eq(namesOf(got), ['react'], 'react');
    eq(got[0].reasons, [{ kind: 'peer-of', via: 'react-dom', name: 'react', range: '^19.0.0', to: '19.0.0', have: '18.3.1' }], 'причина');
  });

  test('сусід: піднятий пакет приймає і стару, і нову версію сусіда — не відстає', () => {
    eq(laggardsOf(domBase({ react: '^18.3.1' }), domHead({ react: '^18.3.1 || ^19.0.0' })), [], 'peer ^18 || ^19 приймає react 18.3.1');
  });

  test('сусід: peer, що не виконувався ще ДО PR, — не провина цього PR', () => {
    eq(laggardsOf(domBase({ react: '^17.0.0' }), domHead({ react: '^19.0.0' })), [], 'react 18.3.1 не підходив ^17 і до PR');
  });

  test('сусід: peer, якого до PR не було, але тепер він не виконується — відстає', () => {
    eq(namesOf(laggardsOf(domBase(undefined), domHead({ react: '^19.0.0' }))), ['react'], 'нова вимога піднятого пакета');
  });

  test('сусід: залежність, якої не було в базі, але вона не підходить піднятому, — відстає', () => {
    const base = state({ [WEB]: M(pkg({ 'react-dom': '^18.3.1' })) }, lockOf({ 'node_modules/react-dom': ent('18.3.1', { react: '^18.3.1' }) }));
    const head = state({ [WEB]: M(pkg({ react: '^18.3.1', 'react-dom': '^19.0.0' })) }, lockOf({ 'node_modules/react': ent('18.3.1'), 'node_modules/react-dom': ent('19.0.0', { react: '^19.0.0' }) }));
    eq(namesOf(laggardsOf(base, head)), ['react'], 'react не було в базі, але він не підходить піднятому react-dom');
  });

  test('сусід: peer на піднятий, що приймає нову версію, — не відстає', () => {
    const head = webHeadReactHalf();
    head.lock.packages['node_modules/react-dom'] = ent('18.3.1', { react: '^18.3.1 || ^19.0.0' });
    ok(!namesOf(laggardsOf(webBase(), head)).includes('react-dom'), 'react-dom приймає react 19');
  });

  test('сусід: peer, що не приймав стару версію й до PR, — не провина PR', () => {
    const base = webBase();
    base.lock.packages['node_modules/react-dom'] = ent('18.3.1', { react: '^17.0.0' });
    const head = webHeadReactHalf();
    head.lock.packages['node_modules/react-dom'] = ent('18.3.1', { react: '^17.0.0' });
    ok(!namesOf(laggardsOf(base, head)).includes('react-dom'), 'react-dom вимагав ^17 і при react 18.3.1');
  });

  test('сусід: мінорний бамп теж ловить peer-межу (typescript 5.8 → 5.9 і typescript-eslint <5.9)', () => {
    const base = state({ [API]: M(pkg({ typescript: '^5.8.3' }, { '@typescript-eslint/parser': '^8.71.0' })) },
      lockOf({ 'node_modules/typescript': ent('5.8.3'), 'node_modules/@typescript-eslint/parser': ent('8.71.0', { typescript: '>=4.8.4 <5.9.0' }) }));
    const head = state({ [API]: M(pkg({ typescript: '^5.9.2' }, { '@typescript-eslint/parser': '^8.71.0' })) },
      lockOf({ 'node_modules/typescript': ent('5.9.2'), 'node_modules/@typescript-eslint/parser': ent('8.71.0', { typescript: '>=4.8.4 <5.9.0' }) }));
    const got = laggardsOf(base, head);
    eq(namesOf(got), ['@typescript-eslint/parser'], 'parser не приймає 5.9');
    eq(got[0].reasons[0].range, '>=4.8.4 <5.9.0', 'діапазон названо');
  });

  test('сусід: peer-діапазон, що не читається, коштує одного запису — решта знайдена', () => {
    const head = webHeadReactHalf();
    head.lock.packages['node_modules/@types/react-dom'] = ent('18.3.1', { '@types/react': 'workspace:*' });
    const notes = [];
    const got = laggardsOf(webBase(), head, notes);
    eq(namesOf(got), ['react-dom'], 'react-dom знайдено попри сміття в сусіда');
    eq(notes.length, 1, 'одна примітка');
    has(notes[0], '@types/react-dom', 'примітка називає зіпсований запис');
  });

  test('сусід: шукає в УСІХ маніфестах — common у кореневому package.json, core в apps/api', () => {
    const base = state({ [API]: M(pkg({ '@nestjs/core': '^10.4.22' })), 'package.json': M(pkg({ '@nestjs/common': '^10.4.22' })) },
      lockOf({ 'node_modules/@nestjs/core': ent('10.4.22'), 'node_modules/@nestjs/common': ent('10.4.22') }));
    const head = state({ [API]: M(pkg({ '@nestjs/core': '^12.1.0' })), 'package.json': M(pkg({ '@nestjs/common': '^10.4.22' })) },
      lockOf({ 'node_modules/@nestjs/core': ent('12.1.0'), 'node_modules/@nestjs/common': ent('10.4.22') }));
    const got = laggardsOf(base, head);
    eq(got.map((l) => `${l.manifest}:${l.name}`), ['package.json:@nestjs/common'], 'знайдено в іншому маніфесті');
  });

  test('сусід: та сама назва в іншому маніфесті — поза межами картки і не названа', () => {
    const base = state({ [API]: M(pkg({ '@nestjs/core': '^10.4.22' })), 'apps/cms/package.json': M(pkg({ '@nestjs/core': '^10.4.22' })) },
      lockOf({ 'node_modules/@nestjs/core': ent('10.4.22') }));
    const head = state({ [API]: M(pkg({ '@nestjs/core': '^12.1.0' })), 'apps/cms/package.json': M(pkg({ '@nestjs/core': '^10.4.22' })) },
      lockOf({ 'node_modules/@nestjs/core': ent('12.1.0') }));
    eq(laggardsOf(base, head), [], 'це четверта родина, якої картка не просила; лишилось у звіті');
  });

  test('сусід: один пакет піднято у двох маніфестах — причина одна, а не двічі', () => {
    const lockA = (ts) => lockOf({ 'node_modules/typescript': ent(ts), 'node_modules/ts-jest': ent('29.4.14', { typescript: '>=4.3 <7' }) });
    const base = state({ [API]: M(pkg({ typescript: '^6.0.3', 'ts-jest': '^29.4.14' })), [WEB]: M(pkg({ typescript: '^5.9.3' })) }, lockA('6.0.3'));
    const head = state({ [API]: M(pkg({ typescript: '^7.0.2', 'ts-jest': '^29.4.14' })), [WEB]: M(pkg({ typescript: '^7.0.2' })) }, lockA('7.0.2'));
    const got = laggardsOf(base, head);
    eq(namesOf(got), ['ts-jest'], 'ts-jest');
    eq(got[0].reasons.length, 1, 'ту саму причину двічі не читаємо');
  });

  test('сусід: два піднятих у одному скоупі — відсталий називає обох, а не зливає в одну причину', () => {
    const head = state({ [API]: nestApi({ '@nestjs/core': '^12.1.0', '@nestjs/common': '^12.1.0' }) }, nestLock12());
    head.lock.packages['node_modules/@nestjs/platform-express'] = ent('10.4.22', { '@nestjs/common': '^10.0.0', '@nestjs/core': '^10.0.0' });
    const got = laggardsOf(nestBase(), head);
    eq(namesOf(got), ['@nestjs/platform-express'], 'platform-express');
    const scope = got[0].reasons.filter((r) => r.kind === 'scope').map((r) => r.via);
    eq(scope, ['@nestjs/common', '@nestjs/core'], 'скоуп через обох піднятих');
  });

  test('сусід: peer-діапазон САМОГО піднятого пакета, що не читається, коштує одного запису', () => {
    const head = domHead({ react: 'workspace:*' });
    const notes = [];
    eq(laggardsOf(domBase({ react: '^18.3.1' }), head, notes), [], 'нічого не названо');
    eq(notes.length, 1, 'одна примітка');
    has(notes[0], 'react-dom', 'названо піднятий пакет');
  });

  test('сусід: залежність `workspace:*` у маніфесті не валить сторожа й не ховає решту', () => {
    const base = nestBase();
    const head = nestHeadIncomplete();
    head.manifests[API] = nestApi({ '@nestjs/core': '^12.1.0', '@nestjs/shared': 'workspace:*' });
    ok(namesOf(laggardsOf(base, head)).includes('@nestjs/common'), 'common названо попри workspace:*');
    ok(!namesOf(laggardsOf(base, head)).includes('@nestjs/shared'), 'workspace-пакет не сусід');
  });

  test('сусід: пониження іншого пакета при патч-бампі P — не «відстав» (правило скоупа питає про мажорний бамп P)', () => {
    const base = state({ [API]: M(pkg({ '@nestjs/core': '^10.4.22', '@nestjs/common': '^10.4.22' })) }, lockOf({ 'node_modules/@nestjs/core': ent('10.4.22'), 'node_modules/@nestjs/common': ent('10.4.22') }));
    const head = state({ [API]: M(pkg({ '@nestjs/core': '^10.4.23', '@nestjs/common': '^9.4.0' })) }, lockOf({ 'node_modules/@nestjs/core': ent('10.4.23'), 'node_modules/@nestjs/common': ent('9.4.0') }));
    eq(namesOf(laggardsOf(base, head)), [], 'common пониженo, але це не відставання за мажорним бампом');
    // Те саме для пари типів: react патч-бамп, @types/react пониженo.
    const tb = state({ [WEB]: M(pkg({ react: '^18.3.1' }, { '@types/react': '^18.3.12' })) }, lockOf({ 'node_modules/react': ent('18.3.1'), 'node_modules/@types/react': ent('18.3.12') }));
    const th = state({ [WEB]: M(pkg({ react: '^18.3.2' }, { '@types/react': '^17.0.0' })) }, lockOf({ 'node_modules/react': ent('18.3.2'), 'node_modules/@types/react': ent('17.0.80') }));
    eq(namesOf(laggardsOf(tb, th)), [], 'і типи');
  });

  test('сусід: причини йдуть у порядку скоуп → types → peer, а не в порядку, в якому їх знайшли', () => {
    // N = @x/n: peer на @a/lib (піднято першим за алфавітом) і скоуп із @x/core.
    const base = state({ [API]: M(pkg({ '@a/lib': '^1.0.0', '@x/core': '^1.0.0', '@x/n': '^1.0.0' })) },
      lockOf({ 'node_modules/@a/lib': ent('1.0.0'), 'node_modules/@x/core': ent('1.0.0'), 'node_modules/@x/n': ent('1.0.0', { '@a/lib': '^1.0.0' }) }));
    const head = state({ [API]: M(pkg({ '@a/lib': '^2.0.0', '@x/core': '^2.0.0', '@x/n': '^1.0.0' })) },
      lockOf({ 'node_modules/@a/lib': ent('2.0.0'), 'node_modules/@x/core': ent('2.0.0'), 'node_modules/@x/n': ent('1.0.0', { '@a/lib': '^1.0.0' }) }));
    const got = laggardsOf(base, head);
    eq(namesOf(got), ['@x/n'], 'один сусід');
    eq(got[0].reasons.map((r) => r.kind), ['scope', 'peer-on'], 'скоуп перед peer, хоч peer знайдено першим');
  });

  test('сусід: результат не залежить від порядку ключів у маніфесті', () => {
    const a = laggardsOf(nestBase(), nestHeadIncomplete());
    const reversed = (core) =>
      state({ [API]: M(pkg({ '@nestjs/platform-express': '^10.4.22', '@nestjs/common': '^10.4.22', '@nestjs/core': core })) }, nestLock10());
    const b = laggardsOf(reversed('^10.4.22'), reversed('^12.1.0'));
    eq(namesOf(b), ['@nestjs/common', '@nestjs/platform-express'], 'за алфавітом, а не за порядком у файлі');
    eq(JSON.stringify(a), JSON.stringify(b), 'ті самі відстаючі, ті самі причини, той самий порядок');
  });

  test('сусід: скоуп без lock-запису сусіда береться за діапазоном, але не крашить', () => {
    const base = state({ [API]: M(pkg({ '@nestjs/core': '^10.4.22', '@nestjs/common': '^10.4.22' })) }, lockOf({}));
    const head = state({ [API]: M(pkg({ '@nestjs/core': '^12.1.0', '@nestjs/common': '^10.4.22' })) }, lockOf({}));
    const got = laggardsOf(base, head);
    eq(namesOf(got), ['@nestjs/common'], 'без lock: нижня межа діапазону');
    eq(got[0].version, '10.4.22', 'нижня межа ^10.4.22');
  });

  // ── прогони за SHA ──────────────────────────────────────────────────

  let nextId = 5000;
  const mkRun = (over = {}) => ({
    id: ++nextId,
    event: 'pull_request',
    name: 'CI',
    path: '.github/workflows/ci.yml',
    status: 'completed',
    conclusion: 'success',
    run_number: 10,
    ...over,
  });
  const jobsOf = (spec) =>
    Object.entries(spec).map(([name, conclusion]) => ({
      name,
      status: conclusion === null ? 'in_progress' : 'completed',
      conclusion,
    }));
  const mapOf = (pairs) => new Map(pairs);

  test('прогони: push-прогони тієї ж гілки не рахуються (event == pull_request)', () => {
    const push = mkRun({ event: 'push', conclusion: 'failure' });
    const pr = mkRun({});
    const sel = selectRuns([push, pr]);
    eq(sel.live.map((r) => r.id), [pr.id], 'лишився лише pull_request');
    eq(sel.asked, 1, 'push не потрапив навіть у «запитані»');
  });

  test('прогони: скасовані не рахуються взагалі і лічаться окремо', () => {
    const a = mkRun({ conclusion: 'cancelled', run_number: 1 });
    const b = mkRun({ conclusion: 'cancelled', run_number: 2, name: 'Scale check', path: '.github/workflows/scale-check.yml' });
    const c = mkRun({ run_number: 3 });
    const sel = selectRuns([a, b, c]);
    eq(sel.live.map((r) => r.id), [c.id], 'живий лише один');
    eq(sel.cancelled, 2, 'двоє скасованих названо');
    eq(sel.asked, 3, 'усі три були pull_request');
  });

  test('прогони: два живі прогони одного workflow — береться найновіший, а не обидва', () => {
    const old = mkRun({ run_number: 5, conclusion: 'failure' });
    const fresh = mkRun({ run_number: 7, conclusion: 'success' });
    const other = mkRun({ run_number: 1, name: 'CodeQL', path: '.github/workflows/codeql.yml' });
    const sel = selectRuns([fresh, old, other]);
    eq(sel.live.map((r) => r.run_number).sort(), [1, 7], 'CI лише №7, CodeQL окремо');
    eq(sel.duplicates, 1, 'один дубль відкинуто');
  });

  test('прогони: джоби — success зелене, failure і timed_out червоне, решта вердикту не дає', () => {
    const run = mkRun({});
    const t = tally(
      [run],
      mapOf([[run.id, jobsOf({ a: 'success', b: 'failure', c: 'timed_out', d: 'skipped', e: 'cancelled', f: 'neutral', g: 'action_required' })]]),
    );
    eq(t.green, ['CI: a'], 'зелена одна');
    eq(t.red, ['CI: b', 'CI: c'], 'червоні failure і timed_out');
    eq(t.ignored, 4, 'skipped, cancelled, neutral, action_required не дають вердикту');
    eq(t.pending, 0, 'нічого не чекає');
  });

  test('прогони: перелік джоб відсортований, хоч би в якому порядку їх віддали', () => {
    const a = mkRun({ name: 'Z', path: 'z.yml' });
    const b = mkRun({ name: 'A', path: 'a.yml' });
    const t = tally([a, b], mapOf([[a.id, jobsOf({ web: 'failure', api: 'failure' })], [b.id, jobsOf({ web: 'success', api: 'success' })]]));
    eq(t.red, ['Z: api', 'Z: web'], 'червоні за алфавітом');
    eq(t.green, ['A: api', 'A: web'], 'зелені за алфавітом');
  });

  test('прогони: незавершений прогін і незавершена джоба — «ще йде», а не червоне чи зелене', () => {
    const running = mkRun({ status: 'in_progress', conclusion: null });
    const done = mkRun({ name: 'Other', path: 'o.yml' });
    const t = tally([running, done], mapOf([[done.id, jobsOf({ x: 'success', y: null })]]));
    eq(t.pending, 2, 'незавершений прогін + незавершена джоба');
    eq(t.green, ['Other: x'], 'x зелена');
    eq(t.red, [], 'червоного немає');
  });

  test('прогони: workflow, що не стартував (startup_failure), — червоне, без джоб', () => {
    const run = mkRun({ conclusion: 'startup_failure' });
    eq(tally([run], new Map()).red, ['CI: не стартував'], 'червоне без запиту джоб');
  });

  test('прогони: завершений прогін без жодної джоби — помилка сторожа, а не тиша', () => {
    const run = mkRun({});
    throwsLike(() => tally([run], mapOf([[run.id, []]])), /жодної джоби/, 'порожні джоби');
    throwsLike(() => tally([run], new Map()), /жодної джоби/, 'джоб не питали');
  });

  test('прогони: форма — все червоне, червоне й зелене, зелене, ще йде, вердикту немає', () => {
    const t = (red, green, pending) => ({ red: Array(red).fill('r'), green: Array(green).fill('g'), pending, ignored: 0 });
    eq(shapeOf(t(3, 0, 0), 1), 'all-red', 'усе червоне');
    eq(shapeOf(t(1, 2, 0), 1), 'mixed-red', 'червоне й зелене');
    eq(shapeOf(t(0, 3, 0), 1), 'green', 'зелене');
    eq(shapeOf(t(0, 3, 2), 1), 'green', 'зелене, ще йде частина');
    eq(shapeOf(t(0, 0, 2), 1), 'pending', 'лише чекає');
    eq(shapeOf(t(0, 0, 0), 1), 'no-checks', 'живі прогони є, вердикту жодного');
    eq(shapeOf(t(5, 5, 5), 0), 'no-checks', 'живих прогонів нуль — решта не має значення');
  });

  test('прогони: чому вердикту немає — нічого / лишились скасовані / усе пропущене', () => {
    eq(noChecksDetail({ asked: 0, live: [] }), 'none', 'нічого');
    eq(noChecksDetail({ asked: 2, live: [] }), 'only-cancelled', 'лише скасовані');
    eq(noChecksDetail({ asked: 1, live: [{}] }), 'no-verdict', 'прогін є, вердикту нема');
  });

  test('прогони (картка): єдиний не-скасований зелений, поруч два cancelled з червоними джобами — вердикт зелений', () => {
    const c1 = mkRun({ conclusion: 'cancelled', run_number: 1 });
    const c2 = mkRun({ conclusion: 'cancelled', run_number: 2, name: 'Scale check', path: 's.yml' });
    const g = mkRun({ run_number: 3 });
    const sel = selectRuns([c1, c2, g]);
    // Джоби скасованих лежать червоні: якби вони рахувались, вердикт змінився б.
    const jobs = mapOf([[c1.id, jobsOf({ web: 'failure' })], [c2.id, jobsOf({ api: 'failure' })], [g.id, jobsOf({ web: 'success', api: 'success' })]]);
    const t = tally(sel.live, jobs);
    eq(t.red, [], 'жодного червоного');
    eq(shapeOf(t, sel.live.length), 'green', 'зелене');
  });

  // ── вирок ───────────────────────────────────────────────────────────

  const facts = (over = {}) => ({
    number: 7,
    createdOn: '2026-10-11',
    ageMs: 3 * DAY_MS,
    mergeState: 'CLEAN',
    shape: 'all-red',
    tally: { red: ['CI: api', 'CI: web'], green: [], pending: 0, ignored: 0 },
    cancelled: 0,
    detail: null,
    headAgeMs: null,
    bumps: [{ name: '@nestjs/core', manifest: API, fromRange: '^10.4.22', toRange: '^12.1.0', from: '10.4.22', to: '12.1.0' }],
    laggards: [{ name: '@nestjs/common', manifest: API, range: '^10.4.22', version: '10.4.22', reasons: [{ kind: 'scope', via: '@nestjs/core', scope: '@nestjs', major: 10, to: 12 }] }],
    ...over,
  });

  test('вирок: PR віком 1 доба із червоним усім мовчить (картка)', () => {
    const j = judge(facts({ ageMs: DAY_MS }));
    eq(j.kind, 'silent', 'мовчить');
    ok(j.reason.length > 0, 'і каже чому');
  });

  test('вирок: той самий PR віком N+1 доба кричить, і про неповний бамп (картка)', () => {
    eq(judge(facts({ ageMs: (STALE_AFTER_DAYS + 1) * DAY_MS })).kind, 'incomplete-bump', 'кричить');
  });

  test('вирок: межа — рівно N діб ще мовчить, на секунду старший вже кричить', () => {
    eq(judge(facts({ ageMs: STALE_MS })).kind, 'silent', 'рівно N діб');
    eq(judge(facts({ ageMs: STALE_MS + 1000 })).kind, 'incomplete-bump', 'N діб і секунда');
  });

  test('вирок: червоні окремі й сусіди підняті — свіжий мовчить, старий лише «стояв», без слова про неповний бамп', () => {
    const part = { shape: 'mixed-red', tally: { red: ['CI: e2e'], green: ['CI: web', 'CI: api'], pending: 0, ignored: 0 }, laggards: [] };
    eq(judge(facts({ ...part, ageMs: DAY_MS })).kind, 'silent', 'свіжий');
    eq(judge(facts({ ...part, ageMs: 3 * DAY_MS })).kind, 'stale', 'старий — лише поріг віку');
  });

  test('вирок: усе червоне без названих сусідів — stale, а не «неповний бамп» без переліку', () => {
    eq(judge(facts({ laggards: [] })).kind, 'stale', 'без переліку не можна називати це неповним бампом');
  });

  test('вирок: названі сусіди, але червоного немає (зелене чи ще йде) — stale', () => {
    eq(judge(facts({ shape: 'green', tally: { red: [], green: ['CI: web'], pending: 0, ignored: 0 } })).kind, 'stale', 'зелене');
    eq(judge(facts({ shape: 'pending', tally: { red: [], green: [], pending: 2, ignored: 0 } })).kind, 'stale', 'ще йде');
  });

  test('вирок: без жодного прогону й давня голова — окремий стан, і він не залежить від віку PR', () => {
    const base = { shape: 'no-checks', detail: 'none', tally: { red: [], green: [], pending: 0, ignored: 0 }, bumps: [], laggards: [] };
    eq(judge(facts({ ...base, ageMs: DAY_MS, headAgeMs: 2 * 3_600_000 })).kind, 'no-checks', 'PR віком 1 доба, голова 2 години');
  });

  test('вирок: без прогонів, але голова щойно зʼявилась — гонка з Actions, мовчить', () => {
    const base = { shape: 'no-checks', detail: 'none', tally: { red: [], green: [], pending: 0, ignored: 0 }, bumps: [], laggards: [], ageMs: 9 * DAY_MS };
    eq(judge(facts({ ...base, headAgeMs: 30 * 60_000 })).kind, 'silent', '30 хвилин, хоч PR і старий');
    eq(judge(facts({ ...base, headAgeMs: NO_CHECKS_GRACE_MINUTES * 60_000 })).kind, 'silent', 'рівно межа');
    eq(judge(facts({ ...base, headAgeMs: NO_CHECKS_GRACE_MINUTES * 60_000 + 1000 })).kind, 'no-checks', 'межа і секунда');
  });

  test('вирок: вік коміта голови невідомий — помилка, а не тиша', () => {
    const base = { shape: 'no-checks', detail: 'none', tally: { red: [], green: [], pending: 0, ignored: 0 }, bumps: [], laggards: [] };
    throwsLike(() => judge(facts({ ...base, headAgeMs: null })), /вік коміта/, 'null');
    throwsLike(() => judge(facts({ ...base, headAgeMs: Number.NaN })), /вік коміта/, 'NaN');
  });

  // ── текст ───────────────────────────────────────────────────────────

  const incomplete = (over = {}) => judge(facts(over));

  test('текст: неповний бамп називає піднятий пакет, сусіда з версіями й причину', () => {
    const body = render(incomplete());
    ok(body.startsWith(MARKER), 'маркер першим рядком');
    has(body, '`@nestjs/core` 10.4.22 → 12.1.0', 'що піднято і до якої версії');
    has(body, '`@nestjs/common` `^10.4.22`, стоїть 10.4.22', 'сусід поіменно, діапазон і версія');
    has(body, 'скоуп `@nestjs`', 'причина');
    has(body, '`apps/api/package.json`', 'де');
    has(body, 'Що робити', 'що робити');
    has(body, '(`apps/api/package.json`, потім `npm install`)', 'який маніфест відкрити');
    has(body, 'PR відкритий з 2026-10-11', 'дата створення');
  });

  test('текст: називає поріг і ЧОМУ саме він, із числами заміру', () => {
    const body = render(incomplete());
    has(body, `Поріг — ${STALE_AFTER_DAYS} доби`, 'поріг');
    has(body, 'один робочий день неуваги', 'сенс');
    has(body, '1,8 доби', 'нижня межа розриву');
    has(body, '2,6', 'верхня межа розриву');
    has(body, '37 PR', 'розмір вибірки');
  });

  test('текст: червоне ВСЕ й червоне окремі формулюються по-різному, з переліком джоб', () => {
    has(render(incomplete()), 'Червоні ВСІ перевірки', 'усе');
    has(render(incomplete()), 'CI: api, CI: web', 'перелік джоб через кому');
    const mixed = render(incomplete({ shape: 'mixed-red', tally: { red: ['CI: web'], green: ['CI: api', 'CodeQL: Analyze'], pending: 1, ignored: 0 } }));
    has(mixed, 'Червоних 1 із 3', 'частка');
    has(mixed, 'Зелені: CI: api, CodeQL: Analyze', 'зелені названо');
    has(mixed, 'Ще йде: 1', 'що ще йде');
    lacks(mixed, 'Червоні ВСІ', 'не «все»');
  });

  test('текст: stale — для зеленого «злий або закрий», для червоного — куди дивитись', () => {
    const green = render(judge(facts({ laggards: [], bumps: [], shape: 'green', tally: { red: [], green: ['CI: web'], pending: 0, ignored: 0 } })));
    has(green, 'Злий або закрий', 'зелений');
    lacks(green, '@nestjs', 'без відстаючих нічого не називає');
    const allRed = render(judge(facts({ laggards: [] })));
    has(allRed, 'майже завжди маніфест', 'усе червоне → маніфест');
    const mixed = render(judge(facts({ laggards: [], shape: 'mixed-red', tally: { red: ['CI: e2e'], green: ['CI: web'], pending: 0, ignored: 0 } })));
    has(mixed, 'читай саме ці тести', 'окремі червоні → тести');
    lacks(mixed, 'Неповний бамп', 'про неповний бамп ні слова');
    const pending = render(judge(facts({ laggards: [], shape: 'pending', tally: { red: [], green: [], pending: 2, ignored: 0 } })));
    has(pending, 'Вердикту ще немає', 'ще йде');
  });

  test('текст: зелений, але неповний — НЕ радить зливати', () => {
    const body = render(judge(facts({ shape: 'green', tally: { red: [], green: ['CI: web'], pending: 0, ignored: 0 } })));
    has(body, 'зелене тут не означає', 'попередження');
    has(body, '`@nestjs/common`', 'і сусід названий');
    lacks(body, 'Злий або закрий', 'порада зливати була б шкідлива');
  });

  test('текст: «немає прогонів» — окремий текст, не змішаний з «червоне все»', () => {
    const nc = (over = {}) => render(judge(facts({ shape: 'no-checks', detail: 'none', tally: { red: [], green: [], pending: 0, ignored: 0 }, bumps: [], laggards: [], headAgeMs: 5 * 3_600_000, ...over })));
    const body = nc({ mergeState: 'DIRTY' });
    has(body, 'Для цього PR немає жодної перевірки', 'заголовок');
    has(body, 'не «нічого не впало»', 'чому це не нешкідливо');
    has(body, '`DIRTY`', 'стан злиття, який бачить GitHub');
    has(body, '@dependabot rebase', 'що робити');
    has(body, '#93, #122, #145', 'заміряні випадки');
    lacks(body, 'Червон', 'про червоне ні слова');
    lacks(body, 'Неповний бамп', 'і про неповний бамп');
    has(nc({ mergeState: 'UNKNOWN' }), 'не порахував', 'UNKNOWN');
    const other = nc({ mergeState: 'CLEAN' });
    has(other, '`CLEAN`', 'інший стан названо');
    lacks(other, '@dependabot rebase', 'конфлікту нема — перебазувати не радимо');
    has(nc({ detail: 'only-cancelled', cancelled: 2 }), 'лишились тільки скасовані прогони (2)', 'лише скасовані');
    has(nc({ detail: 'no-verdict' }), 'жоден не дав вердикту', 'прогони без вердикту');
  });

  test('текст: тіло не міняється від того, що змінюється щодня (вік, лічильники часу)', () => {
    const a = render(incomplete({ ageMs: 3 * DAY_MS }));
    const b = render(incomplete({ ageMs: 9 * DAY_MS }));
    eq(a, b, 'тіло в день 3 і в день 9 те саме, інакше коментар правився б щодня');
  });

  test('текст: тихий вирок не має тіла', () => {
    eq(render(judge(facts({ ageMs: DAY_MS }))), null, 'нема що казати — нема тіла');
  });

  test('текст: «доба/доби/діб» відмінюється', () => {
    eq([1, 2, 4, 5, 11, 12, 14, 21, 22, 25].map(doby), ['доба', 'доби', 'доби', 'діб', 'діб', 'діб', 'діб', 'доба', 'доби', 'діб'], 'відмінки');
  });

  test('текст: імʼя пакета не вирветься з код-блоку й не додасть рядків', () => {
    const body = render(incomplete({ laggards: [{ name: 'x`\n# hacked', manifest: API, range: '^1', version: '1.0.0', reasons: [{ kind: 'scope', via: 'y', scope: '@x', major: 1, to: 2 }] }] }));
    lacks(body, '\n# hacked', 'не новий рядок-заголовок');
    has(body, "`x''# hacked`", 'зворотна лапка й перенос рядка замінені');
  });

  test('текст: понад вісім сусідів — вісім і «і ще N», а не стіна', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `@nestjs/p${i}`, manifest: API, range: '^10', version: '10.0.0', reasons: [{ kind: 'scope', via: '@nestjs/core', scope: '@nestjs', major: 10, to: 12 }] }));
    const body = render(incomplete({ laggards: many }));
    has(body, '`@nestjs/p7`', 'восьмий видно');
    lacks(body, '`@nestjs/p8`', 'дев’ятого вже ні');
    has(body, '… і ще 2', 'лічильник решти');
  });

  test('текст: рівно вісім сусідів — усі видно, без «і ще 0»', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ name: `@nestjs/p${i}`, manifest: API, range: '^10', version: '10.0.0', reasons: [{ kind: 'scope', via: '@nestjs/core', scope: '@nestjs', major: 10, to: 12 }] }));
    const body = render(incomplete({ laggards: eight }));
    has(body, '`@nestjs/p7`', 'восьмий видно');
    lacks(body, '… і ще', 'решти немає');
  });

  test('текст: перелік червоних джоб обрізається на восьми з «і ще N»', () => {
    const red = Array.from({ length: 10 }, (_, i) => `CI: j${i}`);
    const body = render(incomplete({ tally: { red, green: [], pending: 0, ignored: 0 } }));
    has(body, 'CI: j7', 'восьму видно');
    lacks(body, 'CI: j8', 'дев’ятої вже ні');
    has(body, '… і ще 2', 'лічильник');
    const eight = render(incomplete({ tally: { red: red.slice(0, 8), green: [], pending: 0, ignored: 0 } }));
    lacks(eight, '… і ще', 'рівно вісім — без хвоста');
  });

  test('текст: усі чотири причини читаються по-людськи', () => {
    const body = render(incomplete({ laggards: [
      { name: 'a', manifest: API, range: '^1', version: '1.0.0', reasons: [{ kind: 'types', via: 'react', typesOfVia: true, major: 18, to: 19 }] },
      { name: 'b', manifest: API, range: '^1', version: '1.0.0', reasons: [{ kind: 'types', via: '@types/react', typesOfVia: false, major: 18, to: 19 }] },
      { name: 'c', manifest: API, range: '^1', version: '1.0.0', reasons: [{ kind: 'peer-on', via: 'react', range: '^18', from: '18.3.1', to: '19.0.0' }] },
      { name: 'd', manifest: API, range: '^1', version: '1.0.0', reasons: [{ kind: 'peer-of', via: 'react-dom', name: 'react', range: '^19', to: '19.0.0', have: '18.3.1' }] },
    ] }));
    has(body, 'типи для `react`', 'types: типи для піднятого');
    has(body, '`@types/react` — типи для нього', 'types: піднятий — типи для сусіда');
    has(body, 'peer `react ^18`: 18.3.1 приймав, піднятий 19.0.0 не приймає', 'peer-on');
    has(body, 'вимагає peer `react ^19`, а тут 18.3.1', 'peer-of');
  });

  // ── коментар у PR ───────────────────────────────────────────────────

  const bot = (id, body) => ({ id, body, user: { login: COMMENT_AUTHOR } });

  test('коментар: немає нашого й нема що казати — нічого', () => {
    eq(planComment([], null).action, 'none', 'порожньо');
    eq(planComment([{ id: 1, body: 'привіт', user: { login: 'human' } }], null).action, 'none', 'чужий коментар не чіпаємо');
  });

  test('коментар: нашого немає, а сказати є що — створити', () => {
    const plan = planComment([{ id: 1, body: 'привіт', user: { login: 'human' } }], `${MARKER}\nтекст`);
    eq([plan.action, plan.body], ['create', `${MARKER}\nтекст`], 'створити з тілом');
  });

  test('коментар: той самий текст — мовчить (не спамить щодня)', () => {
    const plan = planComment([bot(5, `${MARKER}\nтекст`)], `${MARKER}\nтекст`);
    eq(plan.action, 'none', 'нічого не пишемо');
    eq(plan.id, 5, 'і знає, який коментар уже каже це');
  });

  test('коментар: той самий текст, але GitHub повернув CRLF і хвіст — теж мовчить', () => {
    eq(planComment([bot(5, `${MARKER}\r\nтекст\r\n`)], `${MARKER}\nтекст`).action, 'none', 'CRLF і пробіли в кінці не різниця');
  });

  test('коментар: текст змінився — правимо ІСНУЮЧИЙ, а не пишемо новий', () => {
    const plan = planComment([bot(5, `${MARKER}\nстарий`)], `${MARKER}\nновий`);
    eq([plan.action, plan.id, plan.body], ['update', 5, `${MARKER}\nновий`], 'update того ж id');
  });

  test('коментар: чужий коментар із нашим маркером — не наш, пишемо свій', () => {
    const plan = planComment([{ id: 3, body: `${MARKER}\nпідробка`, user: { login: 'someone-else' } }], `${MARKER}\nтекст`);
    eq(plan.action, 'create', 'не правимо чужого');
  });

  test('коментар: інший коментар бота без нашого маркера — не наш, його не чіпаємо', () => {
    const plan = planComment([bot(2, 'deploy ok')], `${MARKER}\nтекст`);
    eq(plan.action, 'create', 'пишемо свій, чужий не правимо');
  });

  test('коментар: наших кілька (гонка двох прогонів) — правимо найстарший, нових не додаємо', () => {
    const plan = planComment([bot(9, `${MARKER}\nb`), bot(4, `${MARKER}\na`)], `${MARKER}\nc`);
    eq([plan.action, plan.id], ['update', 4], 'найстарший');
  });

  test('коментар: причина зникла — наш старий коментар переписується на «більше не бачу», один раз', () => {
    const plan = planComment([bot(5, `${MARKER}\nНеповний бамп…`)], null);
    eq([plan.action, plan.id, plan.body], ['update', 5, RESOLVED_BODY], 'переписано');
    eq(planComment([bot(5, RESOLVED_BODY)], null).action, 'none', 'удруге мовчить');
    ok(RESOLVED_BODY.startsWith(MARKER), 'а маркер лишається, щоб його знайти');
  });

  // ── наскрізно: run() проти підробленого gh ──────────────────────────
  //
  // Підроблений `gh` пише кожне звернення. Усе, що перевіряють ці
  // випадки, — це що сторож справді ВІДДАВ у запис і чого НЕ торкався.

  const REPO = 'o/r';
  const NOW = Date.parse('2026-10-14T08:00:00Z');
  const ROOT = 'package.json';

  function newWorld() {
    return {
      open: [],
      history: [],
      files: {},
      mbBySha: {},
      contents: {},
      runsBySha: {},
      jobsByRun: {},
      comments: {},
      commitAgeMin: {},
      tree: {
        truncated: false,
        tree: [
          { path: 'package.json', type: 'blob' },
          { path: 'package-lock.json', type: 'blob' },
          { path: API, type: 'blob' },
          { path: WEB, type: 'blob' },
          { path: 'node_modules/leftpad/package.json', type: 'blob' },
          { path: 'apps', type: 'tree' },
        ],
      },
      writes: [],
      calls: [],
      failOn: null,
      nextCommentId: 100,
    };
  }

  /** Заводить у світ один PR зі своїми прогонами, діфом і станом коментарів. */
  function addPr(w, o) {
    const number = o.number ?? 7;
    const sha = String(number).padStart(40, 'c');
    const mb = String(number).padStart(40, 'd');
    const empty = M(pkg({}));
    const fill = (st) => ({ [ROOT]: empty, [API]: empty, [WEB]: empty, ...(st?.manifests ?? {}) });
    const baseManifests = fill(o.base);
    const headManifests = fill(o.head);
    for (const path of [ROOT, API, WEB]) {
      w.contents[`${path}@${sha}`] = JSON.stringify(headManifests[path]);
      w.contents[`${path}@${mb}`] = JSON.stringify(baseManifests[path]);
    }
    const baseLock = o.base?.lock ?? lockOf({});
    const headLock = o.head?.lock ?? lockOf({});
    w.contents[`package-lock.json@${sha}`] = JSON.stringify(headLock);
    w.contents[`package-lock.json@${mb}`] = JSON.stringify(baseLock);
    w.mbBySha[sha] = mb;
    w.files[number] =
      o.files ??
      [
        ...[ROOT, API, WEB]
          .filter((path) => JSON.stringify(baseManifests[path]) !== JSON.stringify(headManifests[path]))
          .map((filename) => ({ filename, status: 'modified' })),
        ...(JSON.stringify(baseLock) !== JSON.stringify(headLock) ? [{ filename: 'package-lock.json', status: 'modified' }] : []),
      ];
    const runs = o.runs ?? [];
    w.runsBySha[sha] = runs;
    for (const [runId, jobs] of Object.entries(o.jobs ?? {})) w.jobsByRun[runId] = jobs;
    w.comments[number] = o.comments ?? [];
    w.commitAgeMin[sha] = o.commitAgeMin ?? 5000;
    w.open.push({
      number,
      title: o.title ?? 'Bump something',
      createdAt: new Date(NOW - (o.ageDays ?? 3) * DAY_MS).toISOString(),
      headRefOid: sha,
      baseRefName: 'main',
      author: { login: o.author ?? 'app/dependabot', is_bot: true },
      mergeStateStatus: o.mergeState ?? 'CLEAN',
      url: `https://github.com/${REPO}/pull/${number}`,
    });
    return { number, sha, mb };
  }

  function fakeGh(w) {
    return async (args) => {
      w.calls.push(args.join(' '));
      if (w.failOn?.(args)) throw new Error(w.failMessage ?? 'HTTP 502 (підроблений)');
      if (w.emptyOn?.(args)) return '';
      if (args[0] === 'pr' && args[1] === 'list') {
        const state = args[args.indexOf('--state') + 1];
        return JSON.stringify(state === 'open' ? w.open : w.history);
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        const found = [...w.open, ...w.history].find((p) => p.number === Number(args[2]));
        if (!found) throw new Error('немає такого PR');
        return JSON.stringify(found);
      }
      if (args[0] !== 'api') throw new Error(`підроблений gh: незнана команда ${args.join(' ')}`);
      const writing = args[1] === '-X';
      const method = writing ? args[2] : 'GET';
      const endpoint = writing ? args[3] : args[1];
      // Справжній GitHub не прощає двох `?` в одному URL, і підроблений теж.
      if (endpoint.split('?').length > 2) throw new Error(`HTTP 404: кривий URL ${endpoint}`);
      const [path, query = ''] = endpoint.split('?');
      const q = new URLSearchParams(query);
      const page = Number(q.get('page') ?? 1);
      const slice = (arr) => arr.slice((page - 1) * 100, page * 100);
      const body = writing ? args[args.indexOf('-f') + 1].replace(/^body=/, '') : null;
      let m;
      if ((m = /^repos\/o\/r\/pulls\/(\d+)\/files$/.exec(path))) return JSON.stringify(slice(w.files[m[1]]));
      if ((m = /^repos\/o\/r\/compare\/main\.\.\.([0-9a-f]+)$/.exec(path))) {
        return JSON.stringify({ merge_base_commit: { sha: w.mbBySha[m[1]] } });
      }
      if (/^repos\/o\/r\/git\/trees\/[0-9a-f]+$/.test(path)) return JSON.stringify(w.tree);
      if ((m = /^repos\/o\/r\/contents\/(.+)$/.exec(path))) {
        const key = `${decodeURI(m[1])}@${q.get('ref')}`;
        if (!(key in w.contents)) throw new Error(`HTTP 404: ${key}`);
        return w.contents[key];
      }
      if (path === 'repos/o/r/actions/runs') {
        if (w.runsPayload) return JSON.stringify(w.runsPayload);
        const runs = w.runsBySha[q.get('head_sha')] ?? [];
        return JSON.stringify({ total_count: runs.length, workflow_runs: slice(runs) });
      }
      if ((m = /^repos\/o\/r\/actions\/runs\/(\d+)\/jobs$/.exec(path))) {
        const jobs = w.jobsByRun[m[1]] ?? [];
        return JSON.stringify({ total_count: jobs.length, jobs: slice(jobs) });
      }
      if ((m = /^repos\/o\/r\/commits\/([0-9a-f]+)$/.exec(path))) {
        return JSON.stringify({ commit: { committer: { date: new Date(NOW - w.commitAgeMin[m[1]] * 60_000).toISOString() } } });
      }
      if ((m = /^repos\/o\/r\/issues\/(\d+)\/comments$/.exec(path))) {
        if (method === 'POST') {
          const comment = { id: w.nextCommentId++, body, user: { login: COMMENT_AUTHOR } };
          w.comments[m[1]].push(comment);
          w.writes.push({ method, number: Number(m[1]), id: comment.id, body });
          return JSON.stringify(comment);
        }
        return JSON.stringify(slice(w.comments[m[1]]));
      }
      if ((m = /^repos\/o\/r\/issues\/comments\/(\d+)$/.exec(path)) && method === 'PATCH') {
        const all = Object.values(w.comments).flat();
        const target = all.find((c) => c.id === Number(m[1]));
        if (!target) throw new Error('HTTP 404: коментаря немає');
        target.body = body;
        w.writes.push({ method, id: target.id, body });
        return JSON.stringify(target);
      }
      throw new Error(`підроблений gh: несподіване звернення ${method} ${endpoint}`);
    };
  }

  const quiet = () => {
    const lines = [];
    return { lines, log: { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) } };
  };
  const go = async (w, { write = true, only = [] } = {}) => {
    const { lines, log } = quiet();
    const res = await run({ gh: fakeGh(w), repo: REPO, now: NOW, write, only, log });
    return { ...res, lines, text: lines.join('\n') };
  };

  // Прогони: CI з джобами (як у справжньому ci.yml), CodeQL окремо.
  const CI_JOBS = ['gate', 'security', 'web', 'public-build', 'api', 'e2e', 'visual', 'lighthouse'];
  const ciRun = (conclusion, spec, extra = {}) => {
    const run = mkRun({ conclusion, ...extra });
    const jobs = jobsOf(Object.fromEntries(CI_JOBS.map((n) => [n, typeof spec === 'string' ? spec : (spec[n] ?? 'success')])));
    return { run, jobs: { [run.id]: jobs } };
  };
  const withRuns = (...parts) => ({ runs: parts.map((p) => p.run), jobs: Object.assign({}, ...parts.map((p) => p.jobs)) });

  const nestComplete = () =>
    state({ [API]: nestApi({ '@nestjs/core': '^12.1.0', '@nestjs/common': '^12.1.0', '@nestjs/platform-express': '^12.1.0' }) }, nestLock12());

  test('наскрізно (картка): core піднято, common лишився → коментар НАЗИВАЄ @nestjs/common з версіями', async () => {
    const w = newWorld();
    addPr(w, { number: 29, ageDays: 5, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    const r = await go(w);
    eq(r.code, 0, 'код виходу');
    eq(w.writes.length, 1, 'рівно один запис');
    eq([w.writes[0].method, w.writes[0].number], ['POST', 29], 'новий коментар у #29');
    const body = w.writes[0].body;
    has(body, '`@nestjs/common` `^10.4.22`, стоїть 10.4.22', 'сусід поіменно, з версіями');
    has(body, '`@nestjs/core` 10.4.22 → 12.1.0', 'що піднято');
    has(body, '`@nestjs/platform-express`', 'і другий сусід');
    lacks(body, '@nestjs/throttler', 'throttler не названий');
    has(body, 'Червоні ВСІ перевірки', 'шкала червоного');
    eq(r.results[0].kind, 'incomplete-bump', 'вирок');
  });

  test('наскрізно (картка): сусіди підняті, впав один тест — свіжий PR мовчить, нуль записів', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 1, base: nestBase(), head: nestComplete(), ...withRuns(ciRun('failure', { e2e: 'failure' })) });
    const r = await go(w);
    eq(w.writes, [], 'жодного запису');
    eq(r.results[0].kind, 'silent', 'мовчить');
    eq(r.code, 0, 'код виходу');
  });

  test('наскрізно (картка): той самий PR старший за N — лише «стоїть», без слова про неповний бамп', async () => {
    const w = newWorld();
    addPr(w, { ageDays: STALE_AFTER_DAYS + 1, base: nestBase(), head: nestComplete(), ...withRuns(ciRun('failure', { e2e: 'failure' })) });
    await go(w);
    eq(w.writes.length, 1, 'один запис: PR старий');
    const body = w.writes[0].body;
    lacks(body, 'Неповний бамп', 'неповного бампу нема');
    lacks(body, '@nestjs', 'нікого не названо');
    has(body, 'Червоних 1 із 8', 'червоне окреме');
    has(body, 'читай саме ці тести', 'тести');
  });

  test('наскрізно (картка): віком 1 доба із червоним усім — мовчить; віком N+1 — кричить', async () => {
    const young = newWorld();
    addPr(young, { ageDays: 1, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    await go(young);
    eq(young.writes, [], 'свіжий мовчить, хоч сусід названий би');
    const old = newWorld();
    addPr(old, { ageDays: STALE_AFTER_DAYS + 1, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    await go(old);
    eq(old.writes.length, 1, 'старий кричить');
    has(old.writes[0].body, 'Неповний бамп', 'про неповний бамп');
  });

  test('наскрізно (картка): PR без жодного прогону — окреме повідомлення, не «червоне все»', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, mergeState: 'DIRTY', base: nestBase(), head: nestHeadIncomplete(), runs: [] });
    const r = await go(w);
    eq(r.results[0].kind, 'no-checks', 'вирок');
    const body = w.writes[0].body;
    has(body, 'Для цього PR немає жодної перевірки', 'окремий заголовок');
    has(body, '@dependabot rebase', 'що робити з конфліктом');
    lacks(body, 'Червон', 'не змішане з червоним');
    lacks(body, '@nestjs/common', 'діф для цього стану не читається');
    ok(!w.calls.some((c) => /\/contents\//.test(c)), 'маніфестів не читали');
  });

  test('наскрізно: PR без прогонів, але коміт голови 20 хвилин тому — гонка, мовчить', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 9, commitAgeMin: 20, runs: [] });
    await go(w);
    eq(w.writes, [], 'жодного запису');
  });

  test('наскрізно: PR, де лишились тільки скасовані прогони, — теж «немає перевірок», з числом скасованих', async () => {
    const w = newWorld();
    const c1 = mkRun({ conclusion: 'cancelled' });
    const c2 = mkRun({ conclusion: 'cancelled', name: 'Scale check', path: 's.yml' });
    addPr(w, { ageDays: 1, runs: [c1, c2], jobs: { [c1.id]: jobsOf({ web: 'failure' }) } });
    const r = await go(w);
    eq(r.results[0].kind, 'no-checks', 'вердикту нема');
    has(w.writes[0].body, 'лишились тільки скасовані прогони (2)', 'чому');
  });

  test('наскрізно (картка): єдиний не-скасований зелений, поруч два cancelled з червоними джобами — вердикт зелений', async () => {
    const w = newWorld();
    const c1 = ciRun('cancelled', 'failure', { run_number: 1 });
    const c2 = ciRun('cancelled', 'failure', { run_number: 2, name: 'Scale check', path: 's.yml' });
    const push = ciRun('failure', 'failure', { event: 'push', run_number: 3 });
    const green = ciRun('success', 'success', { run_number: 4 });
    // Тут PR неповний: якби скасовані чи push-прогін рахувались червоними, вирок став би incomplete-bump.
    addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(c1, c2, push, green) });
    const r = await go(w);
    eq(r.results[0].kind, 'stale', 'не incomplete-bump: червоного немає');
    const body = w.writes[0].body;
    has(body, 'Усі перевірки з вердиктом зелені (8)', 'рахунок лише живого прогону');
    has(body, 'зелене тут не означає', 'зелений, але неповний');
    lacks(body, 'Червон', 'жодного червоного');
  });

  test('наскрізно (#156): react піднято, react-dom лишився — з реальної форми PR названо react-dom і @types/react-dom', async () => {
    const w = newWorld();
    addPr(w, { number: 156, ageDays: 3, base: webBase(), head: webHeadReactHalf(), ...withRuns(ciRun('failure', { gate: 'success', api: 'success', web: 'failure', e2e: 'failure', security: 'failure', 'public-build': 'failure', visual: 'failure', lighthouse: 'failure' })) });
    const r = await go(w);
    eq(r.results[0].kind, 'incomplete-bump', 'вирок');
    const body = w.writes[0].body;
    has(body, '`react` 18.3.1 → 19.0.1', 'що піднято: з lock бази на lock голови, не нижні межі діапазонів');
    has(body, '`react-dom` `^18`, стоїть 18.3.1', 'react-dom поіменно');
    has(body, '`@types/react-dom` `^18`, стоїть 18.3.1', '@types/react-dom поіменно');
    has(body, 'Червоних 6 із 8', 'формулювання з реальної картини: gate і api зелені, тож «усе червоне» тут НЕ спрацювало б');
    lacks(body, 'Червоні ВСІ', 'і не прикидається, що все');
  });

  test('наскрізно: compare не назвав merge-base — помилка, а не читання бази навмання', async () => {
    const w = newWorld();
    const { sha } = addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    w.mbBySha[sha] = undefined;
    const r = await go(w);
    eq(r.results[0].kind, 'error', 'помилка');
    has(r.text, 'не назвав merge-base', 'причина');
  });

  test('наскрізно: createdAt, що не читається, — помилка, а не «вік NaN»', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, ...withRuns(ciRun('success', 'success')) });
    w.open[0].createdAt = 'вчора';
    const r = await go(w);
    eq(r.results[0].kind, 'error', 'помилка');
    has(r.text, 'createdAt', 'причина');
  });

  test('наскрізно: один і той самий PR щодня — коментар НЕ повторюється', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    await go(w);
    await go(w);
    await go(w);
    eq(w.writes.length, 1, 'три прогони, один запис');
    eq(w.comments[7].length, 1, 'у PR один коментар');
  });

  test('наскрізно: картина змінилась — правиться той самий коментар, а не пишеться другий', async () => {
    const w = newWorld();
    const { sha } = addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    await go(w);
    const green = ciRun('success', 'success', { run_number: 20 });
    w.runsBySha[sha] = [green.run];
    Object.assign(w.jobsByRun, green.jobs);
    await go(w);
    eq(w.writes.map((x) => x.method), ['POST', 'PATCH'], 'створив і виправив');
    eq(w.comments[7].length, 1, 'коментар один');
    has(w.comments[7][0].body, 'зелене тут не означає', 'новий зміст у тому самому коментарі');
    lacks(w.comments[7][0].body, 'Червоні ВСІ', 'старого більше нема');
  });

  test('наскрізно: причина зникла — старий коментар переписано на «більше не бачу», один раз', async () => {
    const w = newWorld();
    const { sha } = addPr(w, { ageDays: 1, mergeState: 'DIRTY', runs: [] });
    await go(w);
    eq(w.writes.length, 1, 'спершу «немає перевірок»');
    const ok1 = ciRun('success', 'success', { run_number: 30 });
    w.runsBySha[sha] = [ok1.run];
    Object.assign(w.jobsByRun, ok1.jobs);
    await go(w);
    await go(w);
    eq(w.writes.map((x) => x.method), ['POST', 'PATCH'], 'виправлено один раз, удруге мовчить');
    eq(w.comments[7][0].body, RESOLVED_BODY, 'текст «більше не бачу»');
  });

  test('наскрізно: сторож не торкається чужих PR — лише app/dependabot', async () => {
    const w = newWorld();
    addPr(w, { number: 8, ageDays: 9, author: 'a-human', runs: [] });
    addPr(w, { number: 9, ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    await go(w);
    eq(w.writes.map((x) => x.number), [9], 'лише dependabot-PR');
    ok(!w.calls.some((c) => /issues\/8\//.test(c)), 'навіть коментарі людського PR не читались');
  });

  test('наскрізно: свіжий PR не читає діф — дев’ять зайвих місць, де можна впасти', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 1, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    await go(w);
    ok(!w.calls.some((c) => /\/pulls\/|\/contents\/|\/git\/trees\//.test(c)), 'діфа не читали');
  });

  test('наскрізно: PR без змін у package*.json (github-actions) — діф не читається далі, сторож не падає', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, files: [{ filename: '.github/workflows/ci.yml', status: 'modified' }], ...withRuns(ciRun('success', 'success')) });
    const r = await go(w);
    eq(r.code, 0, 'без помилки');
    eq(r.results[0].kind, 'stale', 'лише поріг віку');
    ok(!w.calls.some((c) => /\/contents\//.test(c)), 'маніфестів не читали');
  });

  test('наскрізно: сухий прогін нічого не пише, але показує текст дослівно', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    const r = await go(w, { write: false });
    eq(w.writes, [], 'жодного запису');
    has(r.text, '| - `@nestjs/common` `^10.4.22`', 'тіло видно в журналі');
    has(r.text, '[сухий прогін]', 'позначено сухим');
  });

  test('наскрізно: один зіпсований PR коштує одного PR — другий отримує коментар, код виходу 1', async () => {
    const w = newWorld();
    const bad = addPr(w, { number: 11, ageDays: 4, runs: [] });
    addPr(w, { number: 12, ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    w.failOn = (args) => args[0] === 'api' && String(args[1]).includes(`head_sha=${bad.sha}`);
    const r = await go(w);
    eq(r.code, 1, 'сторож червоніє');
    eq(r.results.map((x) => x.kind), ['error', 'incomplete-bump'], 'перший помилка, другий опрацьований');
    eq(w.writes.map((x) => x.number), [12], 'коментар у другий дійшов');
    has(r.text, '::error::#11 не перевірено', 'помилка названа');
  });

  test('наскрізно: помилка з переносом рядка не вставляє в журнал команду Actions', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, runs: [] });
    w.failOn = (args) => args[0] === 'api' && String(args[1]).includes('actions/runs');
    w.failMessage = 'boom\n::set-output name=x::pwned';
    const r = await go(w);
    ok(!r.lines.some((l) => l.startsWith('::set-output')), 'жоден рядок не починається з чужої команди');
    ok(r.lines.every((l) => !l.includes('\n')), 'один запис журналу — один рядок');
  });

  test('наскрізно: відповідь про прогони без масиву workflow_runs — помилка, а не «прогонів немає»', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, runs: [] });
    w.runsPayload = { message: 'Server Error' };
    const r = await go(w);
    eq(r.results[0].kind, 'error', 'помилка');
    eq(r.code, 1, 'червоний крок');
    has(r.text, 'немає очікуваного масиву', 'причина названа');
    eq(w.writes, [], 'і жодного коментаря «немає перевірок» із зіпсованої відповіді');
  });

  test('наскрізно: завершений прогін без джоб — помилка, а не «усе зелене»', async () => {
    const w = newWorld();
    const run = mkRun({});
    addPr(w, { ageDays: 4, runs: [run], jobs: { [run.id]: [] } });
    const r = await go(w);
    eq(r.results[0].kind, 'error', 'помилка');
    has(r.text, 'жодної джоби', 'причина названа');
  });

  test('наскрізно: порожній діф PR — помилка', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, files: [], ...withRuns(ciRun('failure', 'failure')) });
    const r = await go(w);
    eq(r.results[0].kind, 'error', 'помилка');
    has(r.text, 'жодного зміненого файла', 'причина');
  });

  test('наскрізно: обрізане дерево, немає маніфестів, немає lock — кожне окремо помилка', async () => {
    const mk = () => {
      const w = newWorld();
      addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
      return w;
    };
    const a = mk();
    a.tree.truncated = true;
    has((await go(a)).text, 'обрізане', 'truncated');
    const b = mk();
    b.tree.tree = b.tree.tree.filter((e) => !e.path.endsWith('package.json') || e.path === 'package-lock.json');
    has((await go(b)).text, 'немає жодного package.json', 'без маніфестів');
    const c = mk();
    c.tree.tree = c.tree.tree.filter((e) => e.path !== 'package-lock.json');
    has((await go(c)).text, 'немає package-lock.json', 'без lock');
  });

  test('наскрізно: node_modules/**/package.json не вважається маніфестом (його ніхто не читає)', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    const r = await go(w);
    ok(!w.calls.some((c) => c.includes('node_modules/leftpad')), 'не читали');
    ok(!r.text.includes('не прочитано'), 'і не скаржились, що не вдалось');
  });

  test('наскрізно: один маніфест із битим JSON коштує одного маніфеста — решту сторож читає', async () => {
    const w = newWorld();
    const { sha } = addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    w.contents[`${WEB}@${sha}`] = '{ не json';
    const r = await go(w);
    eq(r.code, 0, 'не помилка');
    has(w.writes[0].body, '`@nestjs/common`', 'сусіда з apps/api усе одно названо');
    has(r.text, `${WEB}: не прочитано`, 'а що не прочиталось — у журналі');
  });

  test('наскрізно: сусід в іншому, НЕЗМІНЕНОМУ маніфесті (кореневий package.json) теж названий', async () => {
    const w = newWorld();
    const rootManifest = M(pkg({ '@nestjs/testing': '^10.4.22' }));
    const base = nestBase();
    const head = nestHeadIncomplete();
    base.manifests[ROOT] = rootManifest;
    head.manifests[ROOT] = rootManifest;
    addPr(w, { ageDays: 4, base, head, ...withRuns(ciRun('failure', 'failure')) });
    await go(w);
    has(w.writes[0].body, '`@nestjs/testing` `^10.4.22`, стоїть 10.4.22 (`package.json`)', 'названо з маніфеста, якого PR не чіпав');
  });

  test('наскрізно: сухий прогін не править існуючий коментар теж', async () => {
    const w = newWorld();
    const { sha } = addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    await go(w);
    const green = ciRun('success', 'success', { run_number: 40 });
    w.runsBySha[sha] = [green.run];
    Object.assign(w.jobsByRun, green.jobs);
    const before = w.comments[7][0].body;
    await go(w, { write: false });
    eq(w.writes.length, 1, 'нових записів немає');
    eq(w.comments[7][0].body, before, 'коментар не змінився');
  });

  test('наскрізно: порожня відповідь gh (200 без тіла) — помилка, а не «нічого немає»', async () => {
    const w = newWorld();
    addPr(w, { ageDays: 4, ...withRuns(ciRun('failure', 'failure')) });
    w.emptyOn = (args) => args[0] === 'api' && String(args[1]).includes('actions/runs?');
    const r = await go(w);
    eq(r.results[0].kind, 'error', 'помилка');
    has(r.text, 'повернув порожню відповідь', 'причина');
  });

  test('наскрізно: діф на кількох сторінках — маніфест на другій сторінці теж читається', async () => {
    const w = newWorld();
    const filler = Array.from({ length: 110 }, (_, i) => ({ filename: `docs/f${i}.md`, status: 'modified' }));
    addPr(w, { ageDays: 4, base: nestBase(), head: nestHeadIncomplete(), files: [...filler, { filename: API, status: 'modified' }], ...withRuns(ciRun('failure', 'failure')) });
    const r = await go(w);
    eq(r.results[0].kind, 'incomplete-bump', 'маніфест на 111-му місці знайдено');
  });

  test('наскрізно: маніфест, чию БАЗУ не вдалось прочитати, відкидається цілком — не аналізується навпіл', async () => {
    const w = newWorld();
    const base = state({ [API]: M(pkg({ '@nestjs/core': '^10.4.22', '@nestjs/common': '^10.4.22' })) }, nestLock10());
    const head = state({ [API]: M(pkg({ '@nestjs/core': '^12.1.0', '@nestjs/common': '^10.4.22' })), [WEB]: M(pkg({ '@nestjs/platform-express': '^10.4.22' })) }, nestLock10());
    const { mb } = addPr(w, { ageDays: 4, base, head, ...withRuns(ciRun('failure', 'failure')) });
    delete w.contents[`${WEB}@${mb}`];
    const r = await go(w);
    has(w.writes[0].body, '`@nestjs/common`', 'сусіда з читабельного маніфеста названо');
    lacks(w.writes[0].body, 'platform-express', 'а з нечитабельного — ні, навіть за peer');
    has(r.text, `${WEB}: не прочитано`, 'і це сказано в журналі');
  });

  test('наскрізно: порожній список відкритих PR + в історії dependabot є — тиша й код 0', async () => {
    const w = newWorld();
    w.history = [{ number: 1, author: { login: 'app/dependabot' } }, { number: 2, author: { login: 'human' } }];
    const r = await go(w);
    eq(r.code, 0, 'код');
    has(r.text, 'Відкритих PR від dependabot немає (в історії їх 1 з 2)', 'і каже, що перевірила');
    // Вікно історії мусить охоплювати всю історію репо (228 PR на 14.10.2026), інакше
    // тихий місяць без dependabot-PR дав би хибну тривогу «фільтр осліп».
    const asked = w.calls.find((c) => c.startsWith('pr list') && c.includes('--state all'));
    ok(asked && Number(/--limit (\d+)/.exec(asked)[1]) >= 300, 'канарка питає надто вузьке вікно історії');
  });

  test('наскрізно: порожній список і в історії жодного dependabot — ПРОВАЛ, а не тиша', async () => {
    const w = newWorld();
    w.history = [{ number: 1, author: { login: 'human' } }];
    const r = await go(w);
    eq(r.code, 1, 'код 1');
    has(r.text, 'фільтр осліп', 'причина названа');
  });

  test('наскрізно: список PR не отримано — код 1, а не «усе добре»', async () => {
    const w = newWorld();
    w.failOn = (args) => args[0] === 'pr' && args[1] === 'list';
    const r = await go(w);
    eq(r.code, 1, 'код');
    has(r.text, 'не вдалось отримати список PR', 'причина');
  });

  test('наскрізно: рівно 200 відкритих PR — список обрізано, це помилка', async () => {
    const w = newWorld();
    w.open = Array.from({ length: 200 }, (_, i) => ({ number: i + 1, author: { login: 'human' } }));
    const r = await go(w);
    eq(r.code, 1, 'код');
    has(r.text, 'список обрізано', 'причина');
  });

  test('наскрізно: --pr на PR не від dependabot — помилка', async () => {
    const w = newWorld();
    addPr(w, { number: 15, author: 'a-human', runs: [] });
    const r = await go(w, { only: [15], write: false });
    eq(r.code, 1, 'код');
    has(r.text, 'не PR від app/dependabot', 'причина');
  });

  test('наскрізно: --pr бере PR будь-якого стану (історичний замір) і нічого не пише', async () => {
    const w = newWorld();
    w.history = [];
    addPr(w, { number: 16, ageDays: 5, base: nestBase(), head: nestHeadIncomplete(), ...withRuns(ciRun('failure', 'failure')) });
    const r = await go(w, { only: [16], write: false });
    eq(r.results.map((x) => x.kind), ['incomplete-bump'], 'вирок');
    eq(w.writes, [], 'нічого не пише');
    ok(!w.calls.some((c) => c.includes('--state open')), 'список відкритих не питали');
  });

  // ── командний рядок і виклики gh ────────────────────────────────────

  test('виклик: --comment поза GitHub Actions заборонено (автор коментаря невідомий)', () => {
    throwsLike(() => planInvocation(['--comment'], {}), /лише в GitHub Actions/, 'без Actions');
    throwsLike(() => planInvocation(['--comment'], { GITHUB_ACTIONS: 'false' }), /лише в GitHub Actions/, 'false');
    eq(planInvocation(['--comment'], { GITHUB_ACTIONS: 'true' }).write, true, 'в Actions дозволено');
    eq(planInvocation([], {}).write, false, 'без прапора — сухий');
  });

  test('виклик: --comment не сполучається з --pr і --as-of', () => {
    throwsLike(() => planInvocation(['--comment', '--pr', '5'], { GITHUB_ACTIONS: 'true' }), /не сполучається/, '--pr');
    throwsLike(() => planInvocation(['--comment', '--as-of', '2026-09-28T00:00:00Z'], { GITHUB_ACTIONS: 'true' }), /не сполучається/, '--as-of');
  });

  test('виклик: --pr читає номери (обидва записи), --as-of — дату, сміття відкидається', () => {
    eq(planInvocation(['--pr', '12', '--pr=13'], {}).only, [12, 13], 'обидва записи');
    eq(planInvocation(['--as-of', '2026-09-28T00:00:00Z'], {}).now, Date.parse('2026-09-28T00:00:00Z'), 'дата');
    throwsLike(() => planInvocation(['--pr', 'abc'], {}), /номер PR/, 'не номер');
    throwsLike(() => planInvocation(['--as-of', 'вчора'], {}), /дату ISO/, 'не дата');
  });

  // 🔴 Справжній вхід, а не лише функції: рядок `chooseAction` внизу файла
  // нічим іншим не перевіряється. `--selftest` і `--comment` поза Actions мусять
  // ЗУПИНЯТИСЬ, а не мовчки робити типову дію.
  const SELF = fileURLToPath(import.meta.url);
  const spawnSelf = (args, env = {}) =>
    // cwd — тека tmp: якщо вхід раптом дійде до `gh`, той не лишить слідів у репозиторії.
    spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', cwd: tmpdir(), env: { PATH: process.env.PATH, ...env }, timeout: 20_000 });

  test('вхід: --selftest (одна літера) зупиняється з помилкою, а не мовчки йде бойовою гілкою', () => {
    const r = spawnSelf(['--selftest']);
    ok(r.status !== 0, `вийшов із кодом ${r.status}`);
    has(r.stderr, 'unknown flag --selftest', 'stderr');
  });

  test('вхід: --comment поза Actions зупиняється, а --pr без номера — з вимогою номера', () => {
    const a = spawnSelf(['--comment']);
    ok(a.status !== 0, '--comment без Actions мусить впасти');
    has(a.stderr, 'лише в GitHub Actions', 'stderr --comment');
    const b = spawnSelf(['--pr', 'abc']);
    ok(b.status !== 0, '--pr abc мусить впасти');
    has(b.stderr, '--pr очікує номер PR', 'stderr --pr');
  });

  test('gh: запис коментаря — тіло одним аргументом, без оболонки, правка за id коментаря', () => {
    const body = 'рядок 1\n`код` і "лапки" $(не виконується)';
    eq(createArgs('o/r', 7, body), ['api', '-X', 'POST', 'repos/o/r/issues/7/comments', '-f', `body=${body}`], 'створення');
    eq(updateArgs('o/r', 99, body), ['api', '-X', 'PATCH', 'repos/o/r/issues/comments/99', '-f', `body=${body}`], 'правка');
  });

  test('gh: dependabot — це рівно app/dependabot, як його віддає gh pr list', () => {
    ok(isDependabot({ author: { login: 'app/dependabot' } }), 'app/dependabot');
    ok(!isDependabot({ author: { login: 'dependabot[bot]' } }), 'REST-форма не наша: інший формат має осліпити канарку, а не тихо пройти');
    ok(!isDependabot({ author: { login: 'octocat' } }) && !isDependabot({}) && !isDependabot(undefined), 'решта');
  });

  // ── прогін ──────────────────────────────────────────────────────────

  // Літерал, а не `CASES.length`: випадок, що перестав досягатись, схожий
  // на випадок, що пройшов.
  const EXPECTED_CASES = 136;

  let failed = 0;
  let ran = 0;
  for (const [name, fn] of CASES) {
    ran += 1;
    try {
      await fn();
    } catch (e) {
      failed += 1;
      console.error(`✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`);
    }
  }
  if (ran !== EXPECTED_CASES) {
    console.error(`✗ виконано ${ran} випадків, очікувалось ${EXPECTED_CASES}`);
    failed += 1;
  }
  if (failed === 0) {
    console.log(`✓ check-dependabot-prs self-test: ${ran} випадків`);
    return 0;
  }
  console.error(`✗ check-dependabot-prs self-test: ${failed} не пройшло з ${ran}`);
  return 1;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

// `chooseAction`, а не `argv.includes`: `--selftest`, одна літера
// різниці, провалився б у бойову гілку й вийшов нулем, а крок із назвою
// «самотест» був би зелений (CAMP-285). Порівняння вище написане
// дослівно, бо check-script-entrypoints.mjs впізнає сторож, ЧИТАЮЧИ його.
if (invokedDirectly) {
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test', '--comment', '--pr', '--as-of'],
    'check-dependabot-prs.mjs',
    { takesValue: ['--pr', '--as-of'] },
  );
  process.exit(action.has('--self-test') ? await selfTest() : await main(process.argv.slice(2)));
}
