#!/usr/bin/env node
// Автозлиття PR від `data-refresh` — і межа, за яку воно не виходить.
//
//   node scripts/ci/data-pr-guard.mjs --pr <номер> --sha <head-sha>            # перевірити й злити
//   node scripts/ci/data-pr-guard.mjs --pr <номер> --sha <head-sha> --dry-run  # перевірити, не зливати
//   node scripts/ci/data-pr-guard.mjs --self-test
//
// 🔴 ЧОМУ ЦЕЙ ФАЙЛ, А НЕ ОДИН РЯДОК `gh pr merge` У ВОРКФЛОУ.
//
// Заміряно 30.10.2026: `data-refresh` ГОТУЄ PR щодня, а зливав його
// людина. #368 злито руками 28.10, #371 провисів два дні, і через це
// `wildfires.json` протух на 4,3 доби при бюджеті 3. Розрив не в
// коді збирача — у тому, що наступним кроком була людина.
//
// Прибрати людину означає дати воркфлоу право вливати в `main`. Саме по
// собі право це зливати ЩО ЗАВГОДНО, тож воно мусить мати межу, яку
// можна перевірити, а не «воркфлоу ж наш». Межа тут — чотири питання, і
// відповідь на кожне береться з API, а не з того, що воркфлоу про себе
// розповів:
//
//   1. ХТО: автор — `github-actions[bot]`, гілка — `data/refresh`, база —
//      `main`, гілка в ЦЬОМУ репозиторії (не форк).
//   2. ЩО: КОЖЕН файл у diff — один із трьох, які збирачі справді пишуть
//      (`ALLOWED_PATHS`), без перейменувань, без видалень. Один чужий
//      шлях — не зливаємо НІЧОГО, а не «зливаємо решту».
//   3. ЯКИЙ САМЕ КОМІТ: `--sha` — те, що створення PR віддало як голову.
//      Перевірений і злитий коміт — один і той самий: `--match-head-commit`
//      відмовить, якщо хтось встиг запушити в гілку між перевіркою і
//      зливанням.
//   4. ЧИ ЗЛИЛОСЬ: після `gh pr merge` PR читається ще раз. «Команда
//      повернула нуль» і «PR злито» — різні твердження.
//
// 🔴 ЧОМУ ТРИ ФАЙЛИ, А НЕ `apps/web/src/data/*.json`. У тій самій теці
// лежать ще чотири файли, які пише ЛЮДИНА (`guide-slugs.json`,
// `satellite-sources.json`, `basemap-colours.json`, `drought-domain.json`).
// Другий з них збирач посухи справді пише — але лише з `--rebuild-mask`,
// якого воркфлоу не передає. Глоб пустив би його мовчки; список з трьох
// імен — ні. Ціна названа: з'явиться четвертий збирач — цей сторож
// ЧЕРВОНІЄ (а PR лишається відкритим), і тоді ім'я додають свідомо.
// Самотест звіряє список зі збирачами, тож розбіжність видно в CI, а не
// о четвертій ранку.
//
// 🔴 ЧОГО ЦЕ НЕ РОБИТЬ, І ЦЕ НЕ ПРИХОВАНО.
//   • PR, створений через GITHUB_TOKEN, НЕ запускає `ci.yml` (так працює
//     GitHub: події від цього токена не будять інших воркфлоу). Заміряно:
//     у #371 `statusCheckRollup` порожній. Тому «після зелених перевірок»
//     тут означає перевірки САМОГО data-refresh: збирачі відпрацювали й
//     `check-data-freshness` зелений ДО створення PR. Це слабше за повний
//     CI, і запустити CI без PAT/ключа не можна, а ключів у воркфлоу не
//     буде.
//   • Злиття від GITHUB_TOKEN теж не будить `push`-прогін CI на main.
//   • Зміст JSON тут не перевіряється — це зробив збирач і сторож
//     свіжості до PR. Тут лише: ЧИЇ це PR і ЯКІ ШЛЯХИ.
//
// 🔴 `--auto` НЕ ВИКОРИСТАНО НАВМИСНО: заміряно, `allow_auto_merge=false`
// на репозиторії, і `--auto` відмовив би. Та й чекати нема чого: правило
// гілки `main` вимагає PR з нулем схвалень і не вимагає жодної перевірки
// (`gh api repos/camp-tribe-eu/camp/rules/branches/main`). Пряме злиття
// після перевірок цього файлу — той самий результат без галочки в
// налаштуваннях власника.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chooseAction, flagValue } from '../lib/entrypoint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');

export const ALLOWED_PATHS = Object.freeze([
  'apps/web/src/data/wildfires.json',
  'apps/web/src/data/fuel-prices.json',
  'apps/web/src/data/drought.json',
]);
export const BOT = 'github-actions[bot]';
export const HEAD_BRANCH = 'data/refresh';
export const BASE_BRANCH = 'main';
const MAX_PAGES = 30; // GitHub віддає не більше 3000 файлів у PR

/**
 * Що не так із цим PR. Порожній масив — усе гаразд.
 *
 * Чиста функція: нічого не читає й не пише, тож самотест грає нею будь-які
 * PR, не торкаючись GitHub.
 *
 * @param {{pr: object, files: object[], repo: string, expectSha: string}} input
 * @returns {string[]}
 */
export function problems({ pr, files, repo, expectSha }) {
  const out = [];
  if (!pr || typeof pr !== 'object') return ['PR не прочитано — відповіді немає'];

  if (pr.state !== 'open') out.push(`PR не відкритий (state=${pr.state})`);
  if (pr.merged === true) out.push('PR уже злито');
  if (pr.draft === true) out.push('PR позначений чернеткою');
  if (pr.base?.ref !== BASE_BRANCH) out.push(`база ${pr.base?.ref ?? '?'}, а не ${BASE_BRANCH}`);
  if (pr.head?.ref !== HEAD_BRANCH) out.push(`гілка ${pr.head?.ref ?? '?'}, а не ${HEAD_BRANCH}`);
  if (pr.head?.repo?.full_name !== repo) {
    out.push(`гілка з репозиторію ${pr.head?.repo?.full_name ?? '(видалений)'}, а не з ${repo}`);
  }
  if (pr.user?.login !== BOT) out.push(`автор ${pr.user?.login ?? '?'}, а не ${BOT}`);
  if (!/^[0-9a-f]{40}$/.test(String(expectSha ?? ''))) {
    out.push(`--sha не схожий на повний SHA: ${JSON.stringify(expectSha ?? null)}`);
  } else if (pr.head?.sha !== expectSha) {
    out.push(`голова PR ${pr.head?.sha ?? '?'} не збігається з тим, що віддало створення (${expectSha})`);
  }

  // 🔴 Порожній список — це відмова, а не «нема чого заперечити».
  if (!Array.isArray(files) || files.length === 0) {
    out.push('у PR немає жодного файлу в diff — нічого перевіряти, нічого зливати');
    return out;
  }
  // 🔴 Сторінкування могло обірвати список: тоді «усе в межах» казало б
  // про те, чого ми не бачили. Звіряємо з лічильником самого PR.
  if (typeof pr.changed_files === 'number' && pr.changed_files !== files.length) {
    out.push(`PR заявляє ${pr.changed_files} файлів, а прочитано ${files.length} — список неповний`);
  }
  for (const f of files) {
    const name = f?.filename;
    if (!ALLOWED_PATHS.includes(name)) {
      out.push(`чужий шлях у diff: ${name}`);
      continue;
    }
    // Перейменування в дозволене ім'я з чужого шляху лишає в `previous_filename`
    // слід того, що зникло ПОЗА data/ — і саме його ми й шукаємо.
    if (f.previous_filename !== undefined && f.previous_filename !== name) {
      out.push(`${name} прийшов перейменуванням з ${f.previous_filename}`);
    }
    if (f.status !== 'modified' && f.status !== 'added') {
      out.push(`${name}: статус ${f.status}, дозволено лише modified/added`);
    }
  }
  return out;
}

/** Усі файли PR, сторінка за сторінкою. */
export function listFiles(gh, repo, number) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const chunk = JSON.parse(gh(['api', `repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`]));
    if (!Array.isArray(chunk)) throw new Error(`сторінка ${page} файлів PR — не масив`);
    all.push(...chunk);
    if (chunk.length < 100) return all;
  }
  return all;
}

/**
 * Перевірити й (якщо не --dry-run) злити.
 *
 * @param {{gh: (args: string[]) => string, repo: string, number: number|string,
 *          sha: string, dryRun?: boolean, log?: (s: string) => void}} o
 * @returns {number} код виходу: 0 лише коли PR перевірено і (злито | dry-run)
 */
export function run({ gh, repo, number, sha, dryRun = false, log = (s) => console.log(s) }) {
  let pr;
  let files;
  try {
    pr = JSON.parse(gh(['api', `repos/${repo}/pulls/${number}`]));
    files = listFiles(gh, repo, number);
  } catch (err) {
    log(`::error::data-pr-guard: не вдалось прочитати PR #${number}: ${err.message}`);
    return 1;
  }
  const bad = problems({ pr, files, repo, expectSha: sha });
  if (bad.length > 0) {
    log(`::error::PR #${number} НЕ злито автоматично — ${bad.length} зауваж.:`);
    for (const b of bad) log(`::error::  - ${b}`);
    log('PR лишився відкритим: його перегляне людина.');
    return 1;
  }
  log(`PR #${number}: автор ${BOT}, гілка ${HEAD_BRANCH}, ${files.length} файл(и) — усі з дозволеного списку:`);
  for (const f of files) log(`  ${f.status} ${f.filename}`);
  if (dryRun) {
    log('--dry-run: перевірку пройдено, зливання пропущено.');
    return 0;
  }
  try {
    gh(['pr', 'merge', String(number), '--squash', '--match-head-commit', sha, '--repo', repo]);
  } catch (err) {
    log(`::error::gh pr merge впав: ${err.message}`);
    return 1;
  }
  // 🔴 Нуль від `gh` — не доказ. Читаємо PR ще раз.
  let after;
  try {
    after = JSON.parse(gh(['api', `repos/${repo}/pulls/${number}`]));
  } catch (err) {
    log(`::error::після зливання не вдалось прочитати PR #${number}: ${err.message}`);
    return 1;
  }
  if (after.merged !== true) {
    log(`::error::gh pr merge не зізнався у помилці, але PR #${number} НЕ злито (merged=${after.merged}).`);
    return 1;
  }
  log(`✓ PR #${number} злито: ${after.merge_commit_sha}`);
  return 0;
}

function ghReal(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// ── самотест ────────────────────────────────────────────────────────────

const REPO = 'camp-tribe-eu/camp';
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

const goodPr = (over = {}) => ({
  state: 'open', merged: false, draft: false,
  base: { ref: 'main' },
  head: { ref: 'data/refresh', sha: SHA, repo: { full_name: REPO } },
  user: { login: BOT },
  changed_files: 3,
  ...over,
});
const goodFiles = () => ALLOWED_PATHS.map((filename) => ({ filename, status: 'modified' }));

/** gh-підмінник: відповідає з таблиці, пам'ятає кожен виклик. */
function fakeGh({ pr = goodPr(), files = goodFiles(), mergeFails = false, mergedAfter = true, prReadFails = false } = {}) {
  const calls = [];
  let merged = false;
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'merge') {
      if (mergeFails) throw new Error('GraphQL: Pull request is not mergeable');
      merged = mergedAfter;
      return '';
    }
    const url = args[1] ?? '';
    const m = /\/files\?per_page=100&page=(\d+)$/.exec(url);
    if (m) {
      const page = Number(m[1]);
      return JSON.stringify(files.slice((page - 1) * 100, page * 100));
    }
    if (/\/pulls\/\d+$/.test(url)) {
      if (prReadFails) throw new Error('HTTP 502');
      return JSON.stringify({ ...pr, merged: pr.merged || merged, merge_commit_sha: 'c'.repeat(40) });
    }
    throw new Error(`fakeGh: невідомий виклик ${args.join(' ')}`);
  };
  gh.calls = calls;
  gh.merges = () => calls.filter((c) => c[0] === 'pr' && c[1] === 'merge');
  return gh;
}

async function selfTest() {
  const cases = [];
  let rc = 0;
  const is = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    cases.push(name);
    if (!ok) {
      console.error(`✗ ${name}\n    отримано: ${JSON.stringify(got)}\n    очікувалось: ${JSON.stringify(want)}`);
      rc = 1;
    }
  };
  const quiet = [];
  const log = (s) => quiet.push(s);
  const attempt = (opts, extra = {}) => {
    const gh = fakeGh(opts);
    quiet.length = 0;
    const code = run({ gh, repo: REPO, number: 372, sha: SHA, log, ...extra });
    return { code, merges: gh.merges().length, gh, log: quiet.join('\n') };
  };

  // Щасливий шлях: без нього всі «не злито» нижче нічого не доводять.
  const ok = attempt({});
  is('чистий PR: код 0', ok.code, 0);
  is('чистий PR: зливання викликано рівно раз', ok.merges, 1);
  is('чистий PR: зливання — squash із прив\'язкою до перевіреного коміту',
    ok.gh.merges()[0], ['pr', 'merge', '372', '--squash', '--match-head-commit', SHA, '--repo', REPO]);
  is('чистий PR: у виводі злитий коміт', ok.log.includes(`злито: ${'c'.repeat(40)}`), true);
  is('чистий PR: один файл із трьох теж проходить',
    attempt({ files: goodFiles().slice(0, 1), pr: goodPr({ changed_files: 1 }) }).merges, 1);

  // 🔴 МУТАЦІЯ З КАРТКИ: у diff додано файл поза data/.
  const stray = (filename, extra = {}) => attempt({
    files: [...goodFiles(), { filename, status: 'modified', ...extra }],
    pr: goodPr({ changed_files: 4 }),
  });
  const outside = stray('apps/web/src/app/page.tsx');
  is('🔴 файл поза data/: код 1', outside.code, 1);
  is('🔴 файл поза data/: зливання НЕ викликано', outside.merges, 0);
  is('🔴 файл поза data/: у виводі назване шлях', outside.log.includes('чужий шлях у diff: apps/web/src/app/page.tsx'), true);
  is('🔴 файл поза data/: три дозволені самі по собі не злито',
    stray('apps/web/src/app/page.tsx').merges, 0);

  for (const [what, filename] of [
    ['воркфлоу', '.github/workflows/ci.yml'],
    ['сам сторож', 'scripts/ci/data-pr-guard.mjs'],
    ['файл у data/, що його пише людина', 'apps/web/src/data/guide-slugs.json'],
    ['drought-domain.json (збирач пише лише з --rebuild-mask)', 'apps/web/src/data/drought-domain.json'],
    ['вкладена тека в data/', 'apps/web/src/data/sub/wildfires.json'],
    ['обхід шляху через ..', 'apps/web/src/data/../app/page.tsx'],
    ['суфікс після дозволеного імені', 'apps/web/src/data/wildfires.json.bak'],
    ['регістр', 'apps/web/src/data/Wildfires.json'],
    ['кореневий файл', 'package.json'],
  ]) {
    const r = stray(filename);
    is(`чужий шлях: ${what} — не злито`, [r.code, r.merges], [1, 0]);
  }

  is('чужий файл САМ — не злито', attempt({ files: [{ filename: 'package.json', status: 'modified' }], pr: goodPr({ changed_files: 1 }) }).merges, 0);
  is('перейменування з чужого шляху — не злито',
    attempt({ files: [{ filename: ALLOWED_PATHS[0], status: 'renamed', previous_filename: 'scripts/x.mjs' }, ...goodFiles().slice(1)] }).merges, 0);
  is('🔴 previous_filename чужий, навіть коли status каже modified — не злито',
    attempt({ files: [{ filename: ALLOWED_PATHS[0], status: 'modified', previous_filename: 'scripts/x.mjs' }, ...goodFiles().slice(1)] }).merges, 0);
  is('видалення дозволеного файлу — не злито',
    attempt({ files: [{ filename: ALLOWED_PATHS[0], status: 'removed' }, ...goodFiles().slice(1)] }).merges, 0);
  is('порожній diff — не злито', attempt({ files: [], pr: goodPr({ changed_files: 0 }) }).merges, 0);
  is('обірваний список (PR каже 4, прочитано 3) — не злито', attempt({ pr: goodPr({ changed_files: 4 }) }).merges, 0);

  // Сторінкування: чужий файл на ДРУГІЙ сторінці не має пройти непоміченим.
  const pad = Array.from({ length: 100 }, (_, i) => ({ filename: `apps/web/src/data/x${i}.json`, status: 'modified' }));
  const paged = attempt({ files: [...pad, { filename: 'package.json', status: 'modified' }], pr: goodPr({ changed_files: 101 }) });
  is('сторінкування: друга сторінка прочитана', paged.gh.calls.filter((c) => c[1].includes('/files?')).length, 2);
  is('сторінкування: чужий шлях на другій сторінці — не злито', [paged.code, paged.merges], [1, 0]);

  // Хто.
  const who = (over) => attempt({ pr: goodPr(over) });
  is('автор людина — не злито', who({ user: { login: 'camp-tribe-eu' } }).merges, 0);
  is('автор — інший бот — не злито', who({ user: { login: 'dependabot[bot]' } }).merges, 0);
  is('інша гілка — не злито', who({ head: { ref: 'feature/x', sha: SHA, repo: { full_name: REPO } } }).merges, 0);
  is('гілка з форка — не злито', who({ head: { ref: 'data/refresh', sha: SHA, repo: { full_name: 'evil/camp' } } }).merges, 0);
  is('форк, що видалено (repo=null) — не злито', who({ head: { ref: 'data/refresh', sha: SHA, repo: null } }).merges, 0);
  is('база не main — не злито', who({ base: { ref: 'release' } }).merges, 0);
  is('PR закритий — не злито', who({ state: 'closed' }).merges, 0);
  is('PR уже злитий — не злито', who({ merged: true }).merges, 0);
  is('чернетка — не злито', who({ draft: true }).merges, 0);
  is('голова PR не та, що віддало створення — не злито',
    who({ head: { ref: 'data/refresh', sha: OTHER_SHA, repo: { full_name: REPO } } }).merges, 0);
  is('--sha короткий — не злито', attempt({}, { sha: 'abc1234' }).merges, 0);
  is('--sha порожній — не злито', attempt({}, { sha: '' }).merges, 0);

  // Збої довкола.
  is('PR не читається — код 1, не злито', ((r) => [r.code, r.merges])(attempt({ prReadFails: true })), [1, 0]);
  is('gh pr merge упав — код 1', attempt({ mergeFails: true }).code, 1);
  const lying = attempt({ mergedAfter: false });
  is('🔴 gh сказав «ок», а PR не злито — код 1', lying.code, 1);
  is('🔴 …і це сказано словами', lying.log.includes('НЕ злито'), true);
  const dry = attempt({}, { dryRun: true });
  is('--dry-run: код 0 і зливання НЕ викликано', [dry.code, dry.merges], [0, 0]);
  const dryBad = attempt({ files: [...goodFiles(), { filename: 'package.json', status: 'modified' }], pr: goodPr({ changed_files: 4 }) }, { dryRun: true });
  is('--dry-run з чужим файлом — усе одно код 1', dryBad.code, 1);

  // 🔴 Список звірено зі збирачами: розбіжність видно тут, а не вночі.
  const collectors = {
    'wildfires.json': 'scripts/effis/fetch-wildfires.mjs',
    'fuel-prices.json': 'scripts/fuel/fetch-fuel-prices.mjs',
    'drought.json': 'scripts/edo/fetch-drought.mjs',
  };
  is('збирачі: у списку рівно ті файли, що ми знаємо', ALLOWED_PATHS.map((p) => path.basename(p)).sort(), Object.keys(collectors).sort());
  for (const [file, script] of Object.entries(collectors)) {
    const src = readFileSync(path.join(ROOT, script), 'utf8');
    is(`збирач ${script} справді пише ${file}`, src.includes(`'data', '${file}'`), true);
  }

  // 🔴 Воркфлоу справді викликає цей файл, з тим, що треба, і ПІСЛЯ PR.
  // Читається ТЕКСТОМ, а не YAML-парсером: самотест біжить і всередині
  // `data-refresh`, де `npm ci` не робиться, тож залежностей там немає.
  const wfText = readFileSync(path.join(ROOT, '.github', 'workflows', 'data-refresh.yml'), 'utf8');
  const code = wfText.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const iCreate = code.indexOf('uses: peter-evans/create-pull-request@');
  const iMerge = code.indexOf('node scripts/ci/data-pr-guard.mjs --pr');
  is('воркфлоу: крок створення PR є', iCreate >= 0, true);
  is('воркфлоу: крок зливання є', iMerge >= 0, true);
  is('воркфлоу: зливання ПІСЛЯ створення', iMerge > iCreate, true);
  is('воркфлоу: створення PR має id cpr', /id: cpr\n\s+uses: peter-evans\/create-pull-request@/.test(code), true);
  is('воркфлоу: зливання бере номер із виходу кроку створення',
    code.includes('PR_NUMBER: ${{ steps.cpr.outputs.pull-request-number }}'), true);
  is('воркфлоу: зливання бере SHA із виходу кроку створення',
    code.includes('PR_SHA: ${{ steps.cpr.outputs.pull-request-head-sha }}'), true);
  is('воркфлоу: зливання мовчить, коли PR не створено',
    /if: steps\.cpr\.outputs\.pull-request-number != ''/.test(code), true);
  is('воркфлоу: сторож спершу доводить, що кусає',
    code.indexOf('data-pr-guard.mjs --self-test') > iCreate && code.indexOf('data-pr-guard.mjs --self-test') < iMerge, true);
  is('воркфлоу: жодного `--admin` (обхід правил гілки)', /--admin/.test(code), false);
  is('воркфлоу: жодного `--auto` (на репозиторії вимкнено, відмовив би)', /gh pr merge[^\n]*--auto/.test(code), false);
  const perms = /^permissions:\n((?:[ ]{2}\S.*\n)+)/m.exec(wfText);
  is('воркфлоу: права токена — лише contents і pull-requests',
    perms ? perms[1].split('\n').filter(Boolean).map((l) => l.trim().split(':')[0]).sort() : null,
    ['contents', 'pull-requests']);

  const EXPECTED_CASES = 59;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ data-pr-guard self-test: ${cases.length} випадків`);
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

// 🔴 `chooseAction`, а не `argv.includes`: `--selftest` провалився б у
// бойову гілку (CAMP-285). Порівняння дослівне — його читає
// check-script-entrypoints.mjs.
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  let action;
  try {
    action = chooseAction(argv, ['--self-test', '--pr', '--sha', '--repo', '--dry-run'], 'data-pr-guard.mjs', {
      takesValue: ['--pr', '--sha', '--repo'],
    });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (action.has('--self-test')) {
    process.exit(await selfTest());
  }
  const number = flagValue(argv, '--pr');
  const sha = flagValue(argv, '--sha');
  const repo = flagValue(argv, '--repo') ?? process.env.GITHUB_REPOSITORY;
  if (!/^\d+$/.test(number ?? '') || !repo) {
    console.error('data-pr-guard.mjs: потрібні --pr <число> і --sha <40 hex> (і GITHUB_REPOSITORY або --repo)');
    process.exit(2);
  }
  process.exit(run({ gh: ghReal, repo, number, sha: sha ?? '', dryRun: action.has('--dry-run') }));
}
