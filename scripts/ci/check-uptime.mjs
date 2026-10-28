#!/usr/bin/env node
// Чи відповідає сайт. Раніше цього не перевіряв ніхто.
//
//   node scripts/ci/check-uptime.mjs             # обидві адреси, як у проді
//   node scripts/ci/check-uptime.mjs --self-test # локальний сервер + завідомо биті адреси
//
// 🔴 ПОЛІЧЕНО 28.10.2026: `grep -rlE "curl.*camptribe\.eu|http_code"` по
// `.github/workflows/` і по юнітах на проді не дає нічого. Якби сайт
// ліг, дізнався б той, хто випадково відкрив адресу.
//
// 🔴 ЩО ВВАЖАЄТЬСЯ ПАДІННЯМ — І ЦЕ НЕ «НЕ 200».
//
// Сайт зараз закритий Basic Auth і віддає 401: заміряно 28.10.2026,
// `curl -s -o /dev/null -w %{http_code}` на обох адресах → 401, сервер
// `cloudflare`, `www-authenticate: Basic realm="restricted"`. Це норма.
// Після зняття пароля нормою стане 200. Перевірка «чекаю 200» кричала б
// щодня, а що кричить щодня — вимикають, і тоді вона мовчить, коли треба.
//
//   живий     200 і 401
//   аварія    5xx (це й 520–530 Cloudflare), 404, помилка DNS, відмова
//             зʼєднання, прострочений сертифікат, таймаут,
//             та сторінка Cloudflare «error code: 1016» під будь-яким
//             кодом
//   дивне     усе інше (403, 429 …): у журнал і в анотацію, але БЕЗ
//             issue. 403 від Cloudflare з IP дата-центру GitHub буває
//             «челенджем», а не поломкою, і одна така відповідь вчила б
//             ігнорувати наступну. Це свідомий вибір, а не недогляд.
//
// 🔴 404 — АВАРІЯ (рішення власника 28.10.2026). Ми питаємо лише КОРЕНЕВІ
// адреси; «нема такої сторінки» на власну головну означає зламану
// маршрутизацію: сайт відповідає, а віддавати нічого. Не «дивне».
//
// 🔴 ЧОГО ЦЕ НЕ ДОВОДИТЬ, ПОКИ СТОЇТЬ ПАРОЛЬ. 401 віддає той, хто стоїть
// ПЕРЕД застосунком (проксі з Basic Auth). Якщо впаде Next, а проксі
// житиме, ми й далі побачимо 401 — «живий». Перевірка бачить, що
// відповідає ВХІД, а не що працює сайт. Після зняття пароля 200 уже
// походить від застосунку, і прогалина зникне.
//
// 🔴🔴 ПЕРЕД ЗНЯТТЯМ ПАРОЛЯ перевірити, що 200 приходить від Next, а не
// від проксі: це знімає прогалину лише тоді, коли відповідь справді
// походить із застосунку. Якщо проксі сам віддає 200 (заглушка, кеш,
// статична сторінка), сторож лишиться сліпим до падіння Next, тільки
// мовчатиме вже зі «200». Той, хто знімає пароль, — це ваш рядок.
//
// 🔴 ДВІ СПРОБИ ПЕРЕД ВИРОКОМ, а не одна: один таймаут на раннері GitHub
// не аварія сайту, і issue, відкрите через нього й закрите наступним
// прогоном, вчить так само, як щоденний крик. Вирок «аварія» — коли всі
// спроби поспіль провалились.

import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

export const TARGETS = ['https://camptribe.eu', 'https://www.camptribe.eu'];
export const ATTEMPTS = 3;
export const PAUSE_MS = 10_000;
export const TIMEOUT_MS = 15_000;

/** Сторінка помилки Cloudflare кодує причину в тексті, а код буває будь-який. */
const CF_1016 = /error code:?\s*1016|error 1016/i;

/**
 * Вирок по ОДНІЙ відповіді.
 *
 * @param {{status?: number, error?: string, snippet?: string}} r
 * @returns {{state: 'up'|'down'|'odd', got: string}}
 */
export function classify(r) {
  if (r.error !== undefined) return { state: 'down', got: r.error };
  const status = r.status;
  if (!Number.isInteger(status)) return { state: 'down', got: 'відповідь без коду' };
  if (CF_1016.test(r.snippet ?? '')) {
    return { state: 'down', got: `HTTP ${status}, Cloudflare error 1016 (DNS походження)` };
  }
  if (status >= 500) return { state: 'down', got: `HTTP ${status}` };
  if (status === 404) return { state: 'down', got: 'HTTP 404 на кореневій адресі (маршрутизація зламана)' };
  if (status === 200 || status === 401) return { state: 'up', got: `HTTP ${status}` };
  return { state: 'odd', got: `HTTP ${status}` };
}

/** Що сталося з запитом, словами, без переводів рядка (потрапляє в issue). */
function describeError(e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'таймаут';
  const code = e?.cause?.code ?? e?.code;
  const text = code ?? e?.cause?.message ?? e?.message ?? String(e);
  return `помилка зʼєднання: ${String(text).replace(/\s+/g, ' ').slice(0, 200)}`;
}

/** Один запит. Без облікових даних: перевіряємо те, що бачить кожен. */
export async function probeOnce(url, { timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'camptribe-uptime-watch (GitHub Actions)' },
    });
    const ok = res.status === 200 || res.status === 401;
    let snippet = '';
    if (!ok) {
      // Тіло читаємо лише там, де воно щось вирішує, і не більше 4 КБ.
      snippet = (await res.text().catch(() => '')).slice(0, 4096);
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return { status: res.status, snippet };
  } catch (e) {
    return { error: describeError(e) };
  }
}

/** Кілька спроб; зупиняємось на першій не-аварії. */
export async function probe(url, { attempts = ATTEMPTS, pauseMs = PAUSE_MS, timeoutMs = TIMEOUT_MS } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    last = { url, attempt: i, at: new Date().toISOString(), ...classify(await probeOnce(url, { timeoutMs })) };
    if (last.state !== 'down') return last;
    if (i < attempts) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return last;
}

/** Текст для issue: адреса, що отримали, коли. Без цього issue — просто крик. */
export function issueBody(results, attempts = ATTEMPTS) {
  const down = results.filter((r) => r.state === 'down');
  const lines = down.map(
    (r) => `* **${r.url}** — ${r.got} (${attempts} спроби поспіль, остання ${r.at})`,
  );
  const fine = results
    .filter((r) => r.state !== 'down')
    .map((r) => `* ${r.url} — ${r.got}${r.state === 'odd' ? ' (незвична відповідь)' : ''}`);
  return (
    `Сайт не відповідає нормально. Перевірено ${results[0].at.slice(0, 19)}Z.\n\n` +
    `${lines.join('\n')}\n` +
    (fine.length ? `\nЦі адреси при цьому відповіли:\n${fine.join('\n')}\n` : '') +
    `\nАварія — це 5xx (зокрема 520–530 Cloudflare), 404 на кореневій адресі, ` +
    `помилка DNS, відмова зʼєднання, недійсний сертифікат або таймаут. 200 і 401 вважаються живим: ` +
    `поки стоїть Basic Auth, норма — 401.`
  );
}

/**
 * Що воркфлоу читає з кроку.
 *
 * 🔴 `state` пишемо в ОБИДВА боки (`up` і `down`). Воркфлоу закриває issue
 * лише за явним `up`: якщо скрипт упав і нічого не записав, issue не
 * закривається, а останній крок червонить прогін. «Не down» і «up» —
 * не одне й те саме.
 */
export function outputFor(results) {
  return results.some((r) => r.state === 'down')
    ? `state=down\nbody<<CAMPEOF\n${issueBody(results)}\nCAMPEOF\n`
    : 'state=up\n';
}

async function run() {
  const results = [];
  for (const url of TARGETS) {
    const r = await probe(url);
    results.push(r);
    console.log(`${r.state.padEnd(5)} ${r.url.padEnd(28)} ${r.got}  [${r.at}, спроба ${r.attempt}/${ATTEMPTS}]`);
    if (r.state === 'odd') console.log(`::warning::${r.url} відповів незвично: ${r.got}`);
  }

  const down = results.filter((r) => r.state === 'down');
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, outputFor(results));
  }
  if (down.length === 0) {
    console.log(`\n✓ ${results.length} з ${results.length} адрес відповідають (200 або 401)`);
    return 0;
  }
  console.error(`\n✗ АВАРІЯ: ${down.length} з ${results.length} адрес не відповідають`);
  for (const r of down) console.error(`  ${r.url}: ${r.got}`);
  return 1;
}

/** Локальний сервер з відомими відповідями — щоб кусати справжній `probe`, а не таблицю. */
function listen() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = req.url;
      if (path === '/200') return void res.writeHead(200).end('ok');
      if (path === '/401') {
        return void res.writeHead(401, { 'www-authenticate': 'Basic realm="x"' }).end('no');
      }
      if (path === '/503') return void res.writeHead(503).end('down');
      if (path === '/502') return void res.writeHead(502).end('bad gateway');
      if (path === '/521') return void res.writeHead(521).end('origin down');
      if (path === '/403') return void res.writeHead(403).end('challenge');
      if (path === '/404') return void res.writeHead(404).end('nope');
      // Cloudflare кладе 1016 під 530, але текст читаємо під будь-яким кодом.
      if (path === '/cf1016') return void res.writeHead(403).end('<h1>Error 1016</h1> Origin DNS error');
      if (path === '/redirect-to-503') return void res.writeHead(302, { location: '/503' }).end();
      if (path === '/redirect-to-401') return void res.writeHead(302, { location: '/401' }).end();
      if (path === '/hang') return; // ніколи не відповідає
      res.writeHead(418).end();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function selfTest() {
  // 🔴 Самотест, що завис, — не червоний, а мовчазний: без запобіжника
  // мутація «запит без таймауту» вішає його до `timeout-minutes` і виглядає
  // як повільний CI. Тут це одразу видимий збій.
  const hung = setTimeout(() => {
    console.error('✗ самотест не вклався у 30 с — запит без таймауту?');
    process.exit(1);
  }, 30_000);
  hung.unref();
  const server = await listen();
  const base = `http://127.0.0.1:${server.address().port}`;
  const cases = [];
  let rc = 0;
  const is = (name, got, want) => {
    cases.push(name);
    if (got !== want) {
      console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      rc = 1;
    }
  };
  const fast = { attempts: 1, pauseMs: 0, timeoutMs: 400 };
  const stateAt = async (path, opts = fast) => (await probe(`${base}${path}`, opts)).state;

  try {
    // Чиста таблиця: код → вирок.
    for (const [status, want] of [
      [200, 'up'], [401, 'up'],
      [500, 'down'], [502, 'down'], [503, 'down'], [504, 'down'],
      [520, 'down'], [521, 'down'], [522, 'down'], [523, 'down'], [524, 'down'],
      [525, 'down'], [526, 'down'], [530, 'down'],
      [404, 'down'], [403, 'odd'], [429, 'odd'],
    ]) {
      is(`таблиця: ${status} → ${want}`, classify({ status }).state, want);
    }
    is('таблиця: 1016 у тілі під 403 — аварія', classify({ status: 403, snippet: 'Error 1016 Origin DNS error' }).state, 'down');
    is('таблиця: помилка запиту — аварія', classify({ error: 'таймаут' }).state, 'down');
    is('таблиця: відповідь без коду — аварія', classify({}).state, 'down');

    // Справжній `probe` по справжньому HTTP.
    is('сервер: 200 живий', await stateAt('/200'), 'up');
    is('сервер: 401 живий (Basic Auth — норма)', await stateAt('/401'), 'up');
    is('сервер: 503 — аварія', await stateAt('/503'), 'down');
    is('сервер: 502 — аварія', await stateAt('/502'), 'down');
    is('сервер: 521 — аварія', await stateAt('/521'), 'down');
    is('сервер: 403 — дивне, не аварія', await stateAt('/403'), 'odd');
    is('сервер: 404 на корені — аварія', await stateAt('/404'), 'down');
    is('сервер: 1016 під 403 — аварія', await stateAt('/cf1016'), 'down');
    is('сервер: редирект на 503 — аварія', await stateAt('/redirect-to-503'), 'down');
    is('сервер: редирект на 401 — живий', await stateAt('/redirect-to-401'), 'up');
    is('сервер: мовчить довше за таймаут — аварія', await stateAt('/hang'), 'down');

    // Завідомо биті адреси: тут кусає саме мережа, а не наш сервер.
    const closed = await listen();
    const deadPort = closed.address().port;
    await new Promise((r) => closed.close(r));
    is('мертвий порт — аварія', (await probe(`http://127.0.0.1:${deadPort}/`, fast)).state, 'down');
    // `.invalid` зарезервовано RFC 2606: не резолвиться ніколи.
    const dns = await probe('https://camptribe-uptime-selftest.invalid/', { ...fast, timeoutMs: 5000 });
    is('DNS не знаходить імені — аварія', dns.state, 'down');
    is('DNS: у тексті є причина, а не порожнеча', /ENOTFOUND|EAI_AGAIN|зʼєднання|таймаут/.test(dns.got), true);

    // Кілька спроб: перша падає, друга ні — це не аварія; усі падають — аварія.
    let hits = 0;
    const flaky = createServer((req, res) => res.writeHead(++hits === 1 ? 503 : 200).end('x'));
    await new Promise((r) => flaky.listen(0, '127.0.0.1', r));
    const flakyUrl = `http://127.0.0.1:${flaky.address().port}/`;
    const second = await probe(flakyUrl, { attempts: 3, pauseMs: 0, timeoutMs: 400 });
    is('одна невдача з трьох — не аварія', second.state, 'up');
    is('…і зупинились на другій спробі', second.attempt, 2);
    await new Promise((r) => flaky.close(r));
    const always = await probe(`${base}/503`, { attempts: 3, pauseMs: 0, timeoutMs: 400 });
    is('три невдачі з трьох — аварія', always.state, 'down');
    is('…і спроб було три', always.attempt, 3);

    // Issue мусить називати адресу, що отримали й коли.
    const body = issueBody([
      { url: 'https://camptribe.eu', state: 'down', got: 'HTTP 503', at: '2026-10-28T08:00:00.000Z' },
      { url: 'https://www.camptribe.eu', state: 'up', got: 'HTTP 401', at: '2026-10-28T08:00:20.000Z' },
    ]);
    is('issue: адреса', body.includes('https://camptribe.eu**'), true);
    is('issue: що отримали', body.includes('HTTP 503'), true);
    is('issue: час', body.includes('2026-10-28T08:00:00'), true);
    is('issue: живу адресу не звинувачує', body.includes('* **https://www.camptribe.eu**'), false);

    // Що бачить воркфлоу: явне `up` і явне `down`, ніколи порожнеча.
    const upR = { url: 'u', state: 'up', got: 'HTTP 401', at: '2026-10-28T08:00:00.000Z' };
    const oddR = { ...upR, state: 'odd', got: 'HTTP 403' };
    const downR = { ...upR, state: 'down', got: 'HTTP 503' };
    is('вихід: усе живе → state=up', outputFor([upR, upR]), 'state=up\n');
    is('вихід: дивне — не аварія → state=up', outputFor([upR, oddR]), 'state=up\n');
    is('вихід: одна адреса лягла → state=down', outputFor([upR, downR]).startsWith('state=down\nbody<<CAMPEOF\n'), true);
    is('вихід: тіло закрите роздільником', outputFor([downR]).endsWith('\nCAMPEOF\n'), true);

    // Бойові адреси на місці: обидві, без зайвих.
    is('цілі: рівно дві', TARGETS.length, 2);
    is('цілі: apex і www', TARGETS.join(','), 'https://camptribe.eu,https://www.camptribe.eu');
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }

  clearTimeout(hung);
  const EXPECTED_CASES = 48;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-uptime self-test: ${cases.length} випадків`);
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
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-uptime.mjs');
  process.exit(action.has('--self-test') ? await selfTest() : await run());
}
