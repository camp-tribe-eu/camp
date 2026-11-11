#!/usr/bin/env node
// Живий кемпінг без висоти — це сторінка, що мовчить там, де дані є.
//
//   node scripts/ci/check-elevation-coverage.mjs --db          # міряє БАЗУ; потрібен DATABASE_URL
//   node scripts/ci/check-elevation-coverage.mjs --self-test   # без бази
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ (CAMP-493). PR #534 прибрав із compute-context виклик
// api.open-meteo.com, який заповнював висоту кожному НОВОМУ кемпінгу, і
// замінив його разовим заповненням. Разове спрацювало (0 без висоти із
// 57 135), але нічого не заповнювало надалі: імпорт OSM щотижня приносить
// нові кемпінги, і кожен приходив без висоти. Сторінка просто не показує
// висоту — так само, як для місця, де даних справді немає. На сторінці
// «джерело не має» і «нас ніхто не заповнив» не відрізняються, тому
// відрізнити їх може лише лічильник у базі.
//
// 🔴 СТОРОЖ МІРЯЄ БАЗУ, А НЕ КОД. Тест, що перевіряє «таймер є й скрипт
// викликається», лишається зеленим і тоді, коли заповнювач падає щоночі.
// Тут рахуються рядки: норма — РІВНО нуль, будь-яке інше число червоне.
//
// 🔴 ЗНАМЕННИК ДРУКУЄТЬСЯ ЗАВЖДИ, І В ЗЕЛЕНОМУ ТЕЖ: «0 із 57 135». «0 із 0»
// не є зеленим — це сторож, що втратив предмет (порожня таблиця, не той
// фільтр), і він червоніє окремим реченням.
//
// 🔴 «БЕЗ ВИСОТИ» — ЦЕ НЕ «НЕМАЄ КЛЮЧА». `{"elevation": null}` чи рядок
// `"137"` теж без висоти: читач не побачить ні того, ні іншого. Умова
// `MISSING_SQL` слово в слово збігається з тією, що вибирає заповнювач
// (`scripts/elevation/refill.py`); самотест порівнює обидва файли.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

export const KNOWN_FLAGS = Object.freeze(['--self-test', '--db']);

export const MISSING_SQL = "jsonb_typeof(context->'elevation') IS DISTINCT FROM 'number'";

/** Одне число й знаменник — ЖИВІ кемпінги (`missing_since IS NULL`), як на сайті. */
export const COUNT_SQL =
  `SELECT count(*) FILTER (WHERE ${MISSING_SQL}), count(*) FROM camping_spots WHERE missing_since IS NULL`;

/** Помилка ВЖИВАННЯ — код 2 без стеку. */
export class UsageError extends Error {}

export function readDb(dbUrl) {
  let out;
  try {
    out = execFileSync('psql', [dbUrl, '-tAX', '-v', 'ON_ERROR_STOP=1', '-F', '|', '-c', COUNT_SQL],
      { encoding: 'utf8' });
  } catch (e) {
    throw new Error(`psql не відповів — ${(e.stderr ?? e.message ?? '').toString().trim()}`);
  }
  const [missing, live] = out.trim().split('|').map(Number);
  if (!Number.isInteger(missing) || !Number.isInteger(live)) {
    throw new Error(`psql відповів не числами: ${JSON.stringify(out)}`);
  }
  return { missing, live };
}

/** Вирок за двома числами. Повертає { ok, line }. */
export function verdict({ missing, live }) {
  const fmt = (n) => n.toLocaleString('uk-UA').replace(/ /g, ' ');
  if (live === 0) {
    return { ok: false, line: `✗ 0 живих кемпінгів у таблиці — сторожу нічого міряти (${fmt(missing)} без висоти із 0)` };
  }
  if (missing === 0) {
    return { ok: true, line: `✓ без висоти: 0 із ${fmt(live)} живих кемпінгів` };
  }
  return {
    ok: false,
    line: `✗ без висоти: ${fmt(missing)} із ${fmt(live)} живих кемпінгів — норма 0; ` +
      'заповнювач `camptribe-elevation.service` не добирає (journalctl -u camptribe-elevation)',
  };
}

export function runWith(flags, { env = process.env, log = console, read = readDb } = {}) {
  if (!flags.has('--db')) throw new UsageError('без --db сторожу нічого міряти: додай --db');
  if (!env.DATABASE_URL) throw new UsageError('--db без DATABASE_URL: сторож осліп би мовчки');
  const v = verdict(read(env.DATABASE_URL));
  (v.ok ? log.log : log.error)(v.line);
  return v.ok ? 0 : 1;
}

function selfTest() {
  let p = 0, f = 0;
  const t = (what, got, want) => {
    if (got === want) { p += 1; console.log(`  ✓ ${what}`); }
    else { f += 1; console.error(`  ✗ ${what}: ${JSON.stringify(got)}, мало бути ${JSON.stringify(want)}`); }
  };
  const run = (flags, env, row) => {
    const lines = [];
    const spy = { log: (x) => lines.push(String(x)), error: (x) => lines.push(String(x)) };
    let rc;
    try { rc = runWith(new Set(flags), { env, log: spy, read: () => row }); }
    catch (e) { rc = e instanceof UsageError ? 'usage' : 'throw'; }
    return { rc, text: lines.join('\n') };
  };
  const DB = { DATABASE_URL: 'postgres://x' };

  t('0 із 57 135 — зелене', run(['--db'], DB, { missing: 0, live: 57135 }).rc, 0);
  t('🔴 зелене друкує знаменник', run(['--db'], DB, { missing: 0, live: 57135 }).text.includes('0 із 57 135'), true);
  t('🔴 1 без висоти — червоне', run(['--db'], DB, { missing: 1, live: 57135 }).rc, 1);
  t('🔴 червоне називає число й знаменник',
    run(['--db'], DB, { missing: 3, live: 57135 }).text.includes('3 із 57 135'), true);
  t('🔴 0 живих — червоне, а не «0 із 0 зелено»', run(['--db'], DB, { missing: 0, live: 0 }).rc, 1);
  t('без --db — відмова вживання', run([], DB, { missing: 0, live: 5 }).rc, 'usage');
  t('🔴 --db без DATABASE_URL — відмова, не зелене', run(['--db'], {}, { missing: 0, live: 5 }).rc, 'usage');

  // Умова вибірки — та сама, що в заповнювача, і ловить не лише «ключа немає».
  const py = readFileSync(path.join(ROOT, 'scripts/elevation/refill.py'), 'utf8');
  t('🔴 заповнювач вибирає тим самим предикатом, що рахує сторож',
    py.includes(`MISSING = "${MISSING_SQL}"`), true);
  t('предикат бачить null і нечислове, а не лише відсутній ключ',
    MISSING_SQL.includes("IS DISTINCT FROM 'number'"), true);
  t('знаменник — живі кемпінги', COUNT_SQL.includes('WHERE missing_since IS NULL'), true);

  t('🔴 лічильник: усі випадки дійшли до кінця', p + f, 10);
  console.log(`check-elevation-coverage self-test: ran ${p + f}, passed ${p}, failed ${f}`);
  return f === 0 ? 0 : 1;
}

// 🔴 Домашня форма сторожа входу (її читає check-script-entrypoints.mjs).
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  let flags;
  try {
    flags = chooseAction(process.argv.slice(2), KNOWN_FLAGS, 'check-elevation-coverage.mjs');
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
  if (flags.has('--self-test')) process.exit(selfTest());
  try {
    process.exit(runWith(flags));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
}
