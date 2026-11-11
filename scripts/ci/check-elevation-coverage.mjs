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
// `"137"` теж без висоти: читач не побачить ні того, ні іншого. Три умови
// (`LIVE_SQL`, `MISSING_SQL`, `PARKED_SQL`) — слово в слово ті, що
// вибирають заповнювач (`scripts/elevation/refill.py`); це доводить тест
// заповнювача, який бере їх звідси.
//
// 🔴 КАРАНТИН (рецензія #544). Рядок, що не порахується ніколи (NaN, смуги
// немає у відрі), при нормі «рівно 0» давав би дві тривоги щоночі навіки.
// Заповнювач кладе його в таблицю `spot_elevation_skips` (НЕ в `context`:
// мітка там робила порожню сторінку індексованою) на 30 діб: він
// не рахується в червоне число, але ЗАВЖДИ друкується поруч, і сторож
// червоніє, коли їх більше за `PARKED_BUDGET`. Карантин не вимикає сторожа:
// він переносить рядок з однієї цифри в іншу, яку теж видно.
//
// 🔴 САМОТЕСТ ПІДНІМАЄ СПРАВЖНЮ БАЗУ. Попередня версія перевіряла лише
// `verdict()` на підставних числах, а SQL звіряла `includes` із власною
// константою — тобто перевіряла копію саму себе. Шість мутацій (порожній
// `FILTER`, `[live, missing]` місцями, `AND false` у знаменнику, `process.exit(0)`
// у вході…) переживали її всі. Тепер тимчасова база з рядками всіх сортів,
// `readDb` на ній і справжній запуск `--db` підпроцесом.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

export const KNOWN_FLAGS = Object.freeze(['--self-test', '--db']);

export const LIVE_SQL = 'missing_since IS NULL';
export const MISSING_SQL = "jsonb_typeof(context->'elevation') IS DISTINCT FROM 'number'";
// 🔴 «У карантині» = рядок у `spot_elevation_skips` ІСНУЄ, і більше нічого.
// Жодного порівняння `until` із годинником: строк, що спливає між
// заповнювачем (05:15) і сторожем (06:15), давав би хибне червоне раз на 30
// діб — «заповнювач не добирає», хоча він бачив рядок ще в карантині й нічого
// не пропустив. Пробує рядок знову лише заповнювач, і вирок про нього
// виносить він: заповнить або подовжить.
export const PARKED_SQL =
  'EXISTS (SELECT 1 FROM spot_elevation_skips k WHERE k.camping_spot_id = camping_spots.id)';

/** Скільки рядків може сидіти в карантині, не червонячи сторожа (≈ 0,035% від 57 135). */
export const PARKED_BUDGET = 20;

/**
 * Три числа: ще не добрано, у карантині, усього ЖИВИХ (знаменник, як на сайті).
 * Мертві (`missing_since`) не рахуються ніде: читач їх не бачить.
 */
export const COUNT_SQL =
  `SELECT count(*) FILTER (WHERE ${MISSING_SQL} AND NOT ${PARKED_SQL}), ` +
  `count(*) FILTER (WHERE ${MISSING_SQL} AND ${PARKED_SQL}), ` +
  `count(*) FROM camping_spots WHERE ${LIVE_SQL}`;

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
  const [missing, parked, live] = out.trim().split('|').map(Number);
  if (![missing, parked, live].every(Number.isInteger)) {
    throw new Error(`psql відповів не числами: ${JSON.stringify(out)}`);
  }
  return { missing, parked, live };
}

/** Вирок за трьома числами. Повертає { ok, line }. Знаменник і карантин друкуються завжди. */
export function verdict({ missing, parked, live }) {
  const fmt = (n) => n.toLocaleString('uk-UA').replace(/\u00a0/g, ' ');
  const tail = `у карантині: ${fmt(parked)} (бюджет ${PARKED_BUDGET})`;
  if (live === 0) {
    return { ok: false, line: `✗ 0 живих кемпінгів у таблиці — сторожу нічого міряти (${fmt(missing)} без висоти із 0; ${tail})` };
  }
  if (missing > 0) {
    return {
      ok: false,
      line: `✗ без висоти: ${fmt(missing)} із ${fmt(live)} живих кемпінгів — норма 0; ${tail}; ` +
        'заповнювач `camptribe-elevation.service` не добирає (journalctl -u camptribe-elevation)',
    };
  }
  if (parked > PARKED_BUDGET) {
    return {
      ok: false,
      line: `✗ без висоти: 0 із ${fmt(live)} живих кемпінгів, АЛЕ ${tail}: ` +
        'рядків, які не порахувались, більше за бюджет — дивись `spot_elevation_skips.why`',
    };
  }
  return { ok: true, line: `✓ без висоти: 0 із ${fmt(live)} живих кемпінгів; ${tail}` };
}

export function runWith(flags, { env = process.env, log = console, read = readDb } = {}) {
  if (!flags.has('--db')) throw new UsageError('без --db сторожу нічого міряти: додай --db');
  if (!env.DATABASE_URL) throw new UsageError('--db без DATABASE_URL: сторож осліп би мовчки');
  const v = verdict(read(env.DATABASE_URL));
  (v.ok ? log.log : log.error)(v.line);
  return v.ok ? 0 : 1;
}

/** Адмін-підключення до сервера Postgres із оточення (PGHOST/PGUSER/PGPASSWORD). */
function admin(sql) {
  return execFileSync('psql', ['-d', 'postgres', '-tAX', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function selfTest() {
  let p = 0, f = 0;
  const t = (what, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) { p += 1; console.log(`  ✓ ${what}`); }
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
  const row = (missing, live, parked = 0) => ({ missing, parked, live });

  // ── вирок на підставних числах ───────────────────────────────────
  t('0 із 57 135 — зелене', run(['--db'], DB, row(0, 57135)).rc, 0);
  t('🔴 зелене друкує знаменник і карантин',
    [run(['--db'], DB, row(0, 57135)).text.includes('0 із 57 135'),
      run(['--db'], DB, row(0, 57135)).text.includes('у карантині: 0')], [true, true]);
  t('🔴 1 без висоти — червоне', run(['--db'], DB, row(1, 57135)).rc, 1);
  t('🔴 червоне називає число й знаменник',
    run(['--db'], DB, row(3, 57135)).text.includes('3 із 57 135'), true);
  t('🔴 0 живих — червоне, а не «0 із 0 зелено»', run(['--db'], DB, row(0, 0)).rc, 1);
  t('карантин у межах бюджету не червонить', run(['--db'], DB, row(0, 57135, PARKED_BUDGET)).rc, 0);
  t('🔴 карантин понад бюджет червонить, і число видно',
    [run(['--db'], DB, row(0, 57135, PARKED_BUDGET + 1)).rc,
      run(['--db'], DB, row(0, 57135, PARKED_BUDGET + 1)).text.includes(`${PARKED_BUDGET + 1}`)], [1, true]);
  t('без --db — відмова вживання', run([], DB, row(0, 5)).rc, 'usage');
  t('🔴 --db без DATABASE_URL — відмова, не зелене', run(['--db'], {}, row(0, 5)).rc, 'usage');

  // ── порядок юнітів: сторож ПІСЛЯ заповнювача ──────────────────────
  const unit = (n) => readFileSync(path.join(ROOT, 'infra/systemd', n), 'utf8');
  const afterOf = (txt) => (txt.match(/^After=(.*)$/gm) ?? []).join(' ');
  t('🔴 сторож стартує ПІСЛЯ заповнювача (After=)',
    afterOf(unit('camptribe-elevation-check.service')).includes('camptribe-elevation.service'), true);
  const at = (n) => unit(n).match(/^OnCalendar=\*-\*-\* (\d\d:\d\d)/m)?.[1] ?? '';
  t('таймер сторожа пізніший за таймер заповнювача',
    at('camptribe-elevation-check.timer') > at('camptribe-elevation.timer') && at('camptribe-elevation.timer') !== '', true);

  // ── справжня база ────────────────────────────────────────────────
  const name = `camp493_guard_${process.pid}`;
  let created = false;
  try {
    admin(`CREATE DATABASE ${name}`);
    created = true;
  } catch (e) {
    f += 1;
    console.error('  ✗ самотест потребує справжнього Postgres (PGHOST/PGUSER/PGPASSWORD або локальний сокет); ' +
      `не підключився: ${(e.stderr ?? e.message).toString().trim()}`);
  }
  if (created) {
    const url = `postgres:///${name}`;
    const sql = (q) => execFileSync('psql', [url, '-tAX', '-v', 'ON_ERROR_STOP=1', '-c', q],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const cli = () => {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--db'],
        { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } });
      return { rc: r.status, text: `${r.stdout}${r.stderr}` };
    };
    try {
      sql('CREATE TABLE camping_spots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ' +
          "context jsonb NOT NULL DEFAULT '{}', missing_since timestamptz)");
      // Справжній DDL міграції, а не його копія в тесті.
      sql(readFileSync(path.join(ROOT, 'apps/api/src/migrations/1796100000000-SpotElevationSkips.ts'), 'utf8')
        .match(/query\(`\s*(CREATE TABLE "spot_elevation_skips"[\s\S]*?)`\)/)[1]);
      const ins = (n, ctx, { dead = false, parkedFor = null } = {}) => {
        sql(`INSERT INTO camping_spots (context, missing_since) SELECT '${ctx}'::jsonb, ` +
            `${dead ? 'now()' : 'NULL'} FROM generate_series(1, ${n})`);
        if (parkedFor !== null) {
          sql(`INSERT INTO spot_elevation_skips (camping_spot_id, until, why) SELECT id, ` +
              `now() + interval '${parkedFor}', 'тест' FROM camping_spots WHERE context = '${ctx}'::jsonb`);
        }
      };
      ins(3, '{"elevation": 137}');                                   // є висота
      ins(1, '{}');                                                   // ключа немає
      ins(1, '{"elevation": null}');                                  // null
      ins(1, '{"elevation": "137"}');                                 // рядок, не число
      ins(1, '{"tag": "future"}', { parkedFor: '1 day' });            // карантин триває
      ins(1, '{"tag": "past"}', { parkedFor: '-1 day' });             // строк МИНУВ — усе одно «в карантині» для сторожа
      ins(4, '{}', { dead: true });                                   // МЕРТВІ без висоти — не рахуються ніде
      // живих 3+1+1+1+1+1 = 8; не добрано: {}, null, "137" = 3; у карантині 2 (в тому числі зі строком, що минув).
      t('🔴 readDb на справжній базі: ще не добрано / карантин / живих',
        readDb(url), { missing: 3, parked: 2, live: 8 });
      t('🔴 карантин зі строком, що МИНУВ, не червоніє: сторож не порівнює `until` із годинником',
        readDb(url).missing, 3);
      const red = cli();
      t('🔴 `--db` підпроцесом на цій базі — червоне', red.rc, 1);
      t('🔴 і називає число та знаменник', red.text.includes('3 із 8'), true);

      sql(`UPDATE camping_spots SET context = '{"elevation": 1}' WHERE missing_since IS NULL AND ` +
          `${MISSING_SQL} AND NOT ${PARKED_SQL}`);
      t('після добору readDb: 0 ще не добрано, карантин лишився', readDb(url), { missing: 0, parked: 2, live: 8 });
      const green = cli();
      t('🔴 `--db` підпроцесом після добору — зелене', green.rc, 0);
      t('🔴 зелене друкує знаменник живих (мертві не в ньому)', green.text.includes('0 із 8'), true);

      ins(PARKED_BUDGET, '{"tag": "bulk"}', { parkedFor: '1 day' });
      t('🔴 карантин понад бюджет: `--db` підпроцесом червоне', cli().rc, 1);
    } catch (e) {
      f += 1;
      console.error(`  ✗ тест на базі впав: ${(e.stderr ?? e.message).toString().trim()}`);
    } finally {
      try { admin(`DROP DATABASE IF EXISTS ${name}`); } catch { /* база тимчасова, її видалення не обовʼязкове */ }
    }
  }

  t('🔴 лічильник: усі випадки дійшли до кінця', p + f, 19);
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
