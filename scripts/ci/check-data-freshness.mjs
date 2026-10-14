#!/usr/bin/env node
// CAMP-170: який із імпортерів мовчить — і чи він мовчить уперше.
//
//   node scripts/ci/check-data-freshness.mjs              # звіт і вирок
//   node scripts/ci/check-data-freshness.mjs --stale-only # тривога таймера
//   node scripts/ci/check-data-freshness.mjs --self-test  # без бази
//
// 🔴 ЦЕ ПРО ТЕ, ЩО ВИГЛЯДАЄ ЗДОРОВИМ. Жоден із цих імпортерів, зупинившись,
// нічого не ламає помітно: сторінка покаже ціну, кемпінг, маршрут. Просто
// числа будуть старі, і ніхто не дізнається, поки хтось не приїде на
// заправку. Заміряно 13.10.2026 на живій базі:
//
//   камери Windy          0 рядків   НЕ ЗАПУСКАВСЯ ЖОДНОГО РАЗУ
//   ціни станцій          0 рядків   НЕ ЗАПУСКАВСЯ ЖОДНОГО РАЗУ
//   тарифи DATAtourisme   12 402     15 днів
//   POI маршрутів         2 248 280  15 днів
//   OSM кемпінги          63 031     1 день
//   звʼязки OSM↔DT        4 459      1 день
//   fuel-prices.json      —          19 днів (і цей файл їде до читача)
//
// 🔴 «НІКОЛИ» І «ДАВНО» — РІЗНІ ВІДПОВІДІ, і плутати їх не можна. Порожня
// таблиця означає, що імпортера не налаштували; стара таблиця означає, що
// він зупинився. Перше лагодить людина один раз, друге — розклад.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * Шість імпортерів CAMP-170 плюс камери, і бюджет кожного — з частоти,
 * названої в картці, а не вигаданий тут.
 *
 * 🔴 Бюджет = частота + один пропущений прогін. Тижневий імпортер, що
 * мовчить 10 днів, уже пропустив один раз; це перше, що видно ззовні.
 */
export const SOURCES = Object.freeze([
  { name: 'OSM кемпінги', card: 'CAMP-28', budgetDays: 10,
    sql: 'SELECT count(*) AS n, max(last_seen_at) AS t FROM camping_spots' },
  { name: 'POI маршрутів', card: 'CAMP-113', budgetDays: 10,
    sql: 'SELECT count(*) AS n, max(last_seen_at) AS t FROM osm_route_poi' },
  { name: 'ціни станцій ES/FR/IT', card: 'CAMP-154', budgetDays: 2,
    sql: 'SELECT count(*) AS n, max(fetched_at) AS t FROM fuel_station_prices' },
  { name: 'тарифи DATAtourisme', card: 'CAMP-147', budgetDays: 10,
    sql: 'SELECT count(*) AS n, max(created_at) AS t FROM spot_tariffs' },
  { name: 'звʼязки OSM↔DATAtourisme', card: 'CAMP-144', budgetDays: 10,
    sql: 'SELECT count(*) AS n, max(created_at) AS t FROM spot_links' },
  { name: 'камери Windy', card: 'CAMP-190', budgetDays: 10,
    sql: 'SELECT count(*) AS n, max(fetched_at) AS t FROM webcams' },
  // 🔴 Цей не в базі, а у файлі, який КОМІТИТЬСЯ й їде до читача.
  { name: 'середні ціни пального', card: 'CAMP-55', budgetDays: 10,
    file: 'apps/web/src/data/fuel-prices.json', field: 'fetchedAt' },
]);

/** Скільки повних днів минуло. `null` — якщо дати немає взагалі. */
export const daysSince = (iso, now) =>
  iso === null || iso === undefined || iso === ''
    ? null
    : Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);

/**
 * Вирок по одному джерелу.
 *
 * 🔴 `never` окремо від `stale`. Нуль рядків — це не «дуже стара дата», це
 * інша хвороба: імпортера не налаштували жодного разу, і розклад тут не
 * допоможе.
 */
export function judge(source, reading, now) {
  const { rows, at } = reading;
  if (rows === 0 || at === null || at === undefined) {
    return { ...source, state: 'never', days: null, rows: rows ?? 0 };
  }
  const days = daysSince(at, now);
  return {
    ...source,
    rows,
    days,
    state: days > source.budgetDays ? 'stale' : 'ok',
  };
}

export const verdict = (judged) => ({
  never: judged.filter((j) => j.state === 'never'),
  stale: judged.filter((j) => j.state === 'stale'),
  ok: judged.filter((j) => j.state === 'ok'),
});

/**
 * 🔴 CAMP-170: ВИРОК І КОД ВИХОДУ — РІЗНІ РЕЧІ, і тут вони розійшлись
 * навмисно.
 *
 * Щоденний таймер на сервері підіймає тривогу кодом виходу. Але двоє з
 * семи джерел не запускались ЖОДНОГО РАЗУ (заміряно 13.10.2026: ціни
 * станцій і камери Windy — обидва 0 рядків). Якби `never` дзвонив,
 * лампа горіла б червоним із першого ж дня й до того дня, коли хтось
 * проведе налаштування — тобто перестала б бути сигналом рівно тоді,
 * коли вперше знадобиться.
 *
 * Тому таймер питає вужче: **що працювало й зупинилось**. Саме це
 * розклад і лагодить. «Не запускався» лишається у звіті, в journal і у
 * своїй картці — там, де в нього є адресат.
 *
 *   'any'   — звіт на вимогу: будь-яка біда це біда.
 *   'stale' — таймер: лише зупинка.
 */
export const ALARM_MODES = Object.freeze(['any', 'stale']);

export const exitCodeFor = (v, alarmOn) => {
  const ringing = alarmOn === 'stale' ? v.stale : [...v.never, ...v.stale];
  return ringing.length > 0 ? 1 : 0;
};

const psql = (sql) =>
  execFileSync('psql', [DB, '-tAX', '-F', '|', '-c', sql], { encoding: 'utf8' }).trim();

/** Одне вимірювання, живе. */
function read(source) {
  if (source.file) {
    const full = path.join(ROOT, source.file);
    if (!existsSync(full)) return { rows: 0, at: null };
    try {
      const data = JSON.parse(readFileSync(full, 'utf8'));
      return { rows: 1, at: data?.[source.field] ?? null };
    } catch {
      return { rows: 0, at: null };
    }
  }
  const [n, t] = psql(source.sql).split('|');
  return { rows: Number(n), at: t === '' ? null : t };
}

function run(now = new Date(), log = console, alarmOn = 'any') {
  const judged = SOURCES.map((s) => judge(s, read(s), now));
  const v = verdict(judged);

  for (const j of judged) {
    const mark = j.state === 'ok' ? '✓' : j.state === 'stale' ? '⚠' : '✗';
    const age = j.state === 'never' ? 'НЕ ЗАПУСКАВСЯ ЖОДНОГО РАЗУ' : `${j.days} дн. (бюджет ${j.budgetDays})`;
    log.log(`  ${mark} ${j.name.padEnd(26)} ${String(j.rows).padStart(9)} рядків  ${age}`);
  }

  if (v.never.length === 0 && v.stale.length === 0) {
    log.log(`\n✓ усі ${judged.length} джерела в межах свого бюджету`);
    return 0;
  }
  if (v.never.length > 0) {
    log.error(
      `\n✗ ${v.never.length} імпортер(ів) не запускались ЖОДНОГО РАЗУ: ` +
        `${v.never.map((j) => `${j.name} (${j.card})`).join(', ')}. ` +
        'Це не застарілість — це відсутній крок налаштування, і розклад його не полагодить.',
    );
  }
  if (v.stale.length > 0) {
    log.error(
      `\n✗ ${v.stale.length} застаріли: ` +
        `${v.stale.map((j) => `${j.name} ${j.days} дн. > ${j.budgetDays}`).join('; ')}. ` +
        'Дані показуються читачеві як поточні.',
    );
  }
  return exitCodeFor(v, alarmOn);
}

function selfTest() {
  let rc = 0;
  const cases = [];
  const check = (cond, m) => {
    cases.push(m);
    if (!cond) { console.error(`✗ REHEARSAL FAILED: ${m}`); rc = 1; }
  };
  const NOW = new Date('2026-10-13T12:00:00Z');
  const src = { name: 'x', card: 'C-1', budgetDays: 10 };

  check(judge(src, { rows: 0, at: null }, NOW).state === 'never', 'нуль рядків — «не запускався»');
  check(judge(src, { rows: 5, at: null }, NOW).state === 'never',
    '🔴 рядки є, але дати немає — теж «не запускався», бо сказати нічого');
  check(judge(src, { rows: 5, at: '2026-10-12T00:00:00Z' }, NOW).state === 'ok', 'учорашнє — в межах');
  check(judge(src, { rows: 5, at: '2026-10-03T00:00:00Z' }, NOW).state === 'ok',
    'рівно на межі бюджету — ще не застаріле');
  check(judge(src, { rows: 5, at: '2026-10-02T00:00:00Z' }, NOW).state === 'stale',
    '🔴 на день за межею — застаріле');
  check(judge(src, { rows: 5, at: '2026-10-02T00:00:00Z' }, NOW).days === 11, 'вік рахується в повних днях');
  // 🔴 Бюджет береться З ДЖЕРЕЛА, а не з константи в коді: інакше рядок
  // про 2 дні для цін станцій нічого не вартий.
  check(judge({ ...src, budgetDays: 2 }, { rows: 5, at: '2026-10-10T00:00:00Z' }, NOW).state === 'stale',
    '🔴 вузький бюджет застосовується саме до свого джерела');
  check(daysSince(null, NOW) === null, 'без дати вік не вигадується');

  const v = verdict([
    judge(src, { rows: 0, at: null }, NOW),
    judge(src, { rows: 5, at: '2026-10-02T00:00:00Z' }, NOW),
    judge(src, { rows: 5, at: '2026-10-12T00:00:00Z' }, NOW),
  ]);
  check(v.never.length === 1 && v.stale.length === 1 && v.ok.length === 1,
    'три стани розкладаються по трьох кошиках');

  check(SOURCES.length === 7, 'сім джерел у переліку');
  check(SOURCES.every((s) => s.sql || s.file), 'кожне джерело вміє сказати, звідки його читати');
  check(SOURCES.every((s) => s.budgetDays > 0 && s.card), 'у кожного є бюджет і картка, з якої він узятий');
  // 🔴 Тут стояв ще один випадок — `typeof run === 'function'`. Він
  // зелений ЗА ПОБУДОВОЮ: функція оголошена вище, отже не може не бути
  // функцією. Прибрано, а не доналаштовано.

  // 🔴 CAMP-170: сім випадків на те, ЩО САМЕ дзвонить і яку форму
  // прапорця розбірник справді читає.
  //
  // Перші чотири ізолюють по одній гілці `exitCodeFor`: якби вона
  // завжди дивилась лише на `stale`, упав би перший; якби завжди на
  // обидва кошики — другий. Жоден із них не зелений за побудовою.
  const bag = (never, stale, ok) => ({ never, stale, ok });
  check(exitCodeFor(bag([1], [], []), 'any') === 1,
    'звіт на вимогу: «не запускався» — це провал');
  check(exitCodeFor(bag([1], [], []), 'stale') === 0,
    '🔴 таймер: «не запускався» НЕ дзвонить — розклад цього не лагодить');
  check(exitCodeFor(bag([], [1], []), 'stale') === 1,
    '🔴 таймер: те, що працювало й зупинилось, дзвонить');
  check(exitCodeFor(bag([], [], [1]), 'stale') === 0,
    'таймер мовчить, коли все в межах бюджету');

  check(alarmModeFrom(['--stale-only']) === 'stale', 'прапорець таймера прочитано');
  check(alarmModeFrom([]) === 'any', 'без прапорця — повний звіт');
  let rejected = false;
  try {
    alarmModeFrom(['--stale']);
  } catch {
    rejected = true;
  }
  check(rejected, '🔴 помилкове написання відкидається, а не ковтається мовчки');

  const EXPECTED_CASES = 19;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ ${cases.length} cases ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-data-freshness self-test: ${cases.length} cases`);
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

/**
 * 🔴 ПРИЙНЯТА ФОРМА МУСИТЬ БУТИ ПРОЧИТАНОЮ. Розбірник, що мовчки ковтає
 * невідомий аргумент, дає галочку над роботою, якої не було: юніт
 * systemd передав би `--stale-only`, скрипт запустився б у режимі
 * 'any', і щоденна тривога дзвонила б на те, на що не мала.
 */
export const KNOWN_FLAGS = Object.freeze(['--self-test', '--stale-only']);

export function alarmModeFrom(argv) {
  const unknown = argv.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.includes(a));
  if (unknown.length > 0) {
    throw new Error(
      `невідомий аргумент: ${unknown.join(', ')}. Відомі: ${KNOWN_FLAGS.join(', ')}`,
    );
  }
  return argv.includes('--stale-only') ? 'stale' : 'any';
}

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  let mode;
  try {
    mode = alarmModeFrom(argv);
  } catch (e) {
    console.error(`\u2717 ${e.message}`);
    process.exit(2);
  }
  process.exit(run(new Date(), console, mode));
}
