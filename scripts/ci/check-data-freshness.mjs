#!/usr/bin/env node
// Дані, які протухають мовчки, — це сайт, що бреше читачеві.
//
//   node scripts/ci/check-data-freshness.mjs                    # файли, що їдуть до читача (CI, data-refresh)
//   node scripts/ci/check-data-freshness.mjs --db               # + таблиці в БД; потрібен DATABASE_URL
//   node scripts/ci/check-data-freshness.mjs --db --stale-only  # таймер на машині: порожня таблиця не дзвонить
//   node scripts/ci/check-data-freshness.mjs --self-test        # без бази
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ, І ЧОМУ САМЕ ТАК. Заміряно 25.10.2026: пожежі були
// старші за свій бюджет на 27 днів, ціни пального на 34, посуха на 44.
// Розкладу для них не існувало ВЗАГАЛІ — файли згенерували один раз
// 05.10 і відтоді не чіпали. Сайт при цьому чесно писав читачеві «No
// fresh wildfire data» і «These prices are out of date» — тобто код
// відпрацював правильно, а не помітив ніхто.
//
// 🔴 CAMP-399: ЯК ЦЕЙ СТОРОЖ ОСЛІП УДРУГЕ, І ЧИМ ЦЕ ЗАКРИТО.
//
// Версія #222 (CAMP-170) читала шість таблиць у БД і знала `--stale-only`.
// Версія #340 (25.10.2026) переписала файл під два JSON і забула й
// таблиці, й прапорець — а `camptribe-freshness.service` далі передавав
// `--stale-only`, який скрипт мовчки ковтав. Таймер щодня рапортував
// успіх, бачачи два файли з одинадцяти джерел.
//
//   • Невідомий аргумент — ЗБІЙ: код 2 і перелік відомих, спільним
//     `chooseAction` (CAMP-285). Саме це спіймало б дефект у день його
//     появи: перший прогін таймера після деплою #340 упав би.
//   • Таблиці повернуто за ЯВНИМ `--db`. Якби вони читались «коли є
//     DATABASE_URL», втрата змінної в .env знову осліпила б сторожа
//     мовчки — а тепер без змінної він падає з реченням.
//   • `--stale-only` має зміст: порожня таблиця («імпортер не
//     запускався жодного разу») у звіті Є, але тривоги не піднімає.
//     Заміряно 27.10.2026 на локальній camptribe_dev: 5 із 9 таблиць
//     порожні, 3 за бюджетом, 1 у межах. Падіння таймера з CAMP-394 —
//     це лист власнику; пʼять листів щодня про те, чого ніколи не було,
//     перестали б читатись за тиждень. Прод не міряно: картка забороняє
//     чіпати машину.
//
// 🔴 БЮДЖЕТИ НЕ ВИГАДАНІ ТУТ. Де є код, що споживає число, воно
// береться звідти — друга копія розійшлася б із першою мовчки:
//   wildfires      FRESH_FOR_HOURS       = 72   (lib/wildfires.ts)
//   fuel           STALE_AFTER_DAYS      = 21   (lib/fuel.ts)
//   bathing        ANNUAL_HEALTHY_DAYS   = 365  (lib/sources.ts)
//   air quality    AIR_FRESH_FOR_HOURS   = 4    (lib/air-quality.ts)
// Для решти таблиць споживача з числом немає, і бюджет — частота з
// картки CAMP-170 плюс один пропущений прогін (щотижневий екстракт
// osm-weekly.yml → 10 діб; ціни станцій щодня → 2 доби). Див. DB_SOURCES.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

export const KNOWN_FLAGS = Object.freeze(['--self-test', '--db', '--stale-only']);

/** Помилка ВЖИВАННЯ — код 2 без стеку. Справжнє падіння мусить кричати стеком. */
export class UsageError extends Error {}

// Доба з десятою, щоб «10.9 діб при бюджеті 10» не читалось як межа.
const age = (hours) => {
  if (hours < 48) return `${Math.floor(hours)} год`;
  const d = hours / 24;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} діб`;
};

/**
 * Чисте ядро: приймає світ, віддає перелік скарг `{ name, kind, text }`.
 * `kind` потрібен таймеру, щоб відрізнити «не запускався» від решти.
 */
export function audit(sources, now) {
  const problems = [];
  const say = (s, kind, text) => problems.push({ name: s.name, kind, text: `${s.name}: ${text}` });
  for (const s of sources) {
    // 🔴 ПРИЙНЯТТЯ ЗІ СТРОКОМ, а не виняток назавжди. Та сама форма, що
    // в `known-advisories.json`: протухлість лишається ВИДИМОЮ, має
    // причину-замір і дату, після якої перевірка червоніє знову.
    // Виняток без дати — це спосіб забути назавжди.
    if (s.acceptedUntil) {
      if (now < Date.parse(s.acceptedUntil)) continue;
      say(s, 'accepted-expired',
        `прийняття протухлості скінчилось ${s.acceptedUntil} — причина мусить бути переглянута`);
      continue;
    }
    // 🔴 «НІКОЛИ» І «ДАВНО» — РІЗНІ ВІДПОВІДІ, і плутати їх не можна.
    // Порожня таблиця — імпортера не налаштували; стара — він зупинився.
    // Перше лагодить людина один раз, друге — повторний запуск.
    if (s.rows === 0) {
      say(s, 'never', 'таблиця порожня — імпортер не запускався жодного разу');
      continue;
    }
    if (s.stamp === null || s.stamp === undefined) {
      say(s, 'no-stamp', 'мітки часу немає — вік невідомий, отже недоведений');
      continue;
    }
    const t = Date.parse(s.stamp);
    if (Number.isNaN(t)) {
      say(s, 'unreadable', `мітка «${s.stamp}» не читається як дата`);
      continue;
    }
    const hours = (now - t) / 36e5;
    if (hours < 0) {
      say(s, 'future', `мітка в майбутньому (${s.stamp}) — годинник або збирач бреше`);
      continue;
    }
    if (hours > s.budgetHours) {
      say(s, 'stale', `${age(hours)} від ${s.stamp}, бюджет ${age(s.budgetHours)}`);
    }
  }
  return problems;
}

/**
 * 🔴 ВИРОК І КОД ВИХОДУ — РІЗНІ РЕЧІ, і розійшлись вони навмисно.
 *
 *   'any'   — звіт на вимогу й CI: будь-яка біда це біда.
 *   'stale' — таймер: порожня таблиця лишається у звіті та в journal,
 *             але тривоги (а з CAMP-394 — листа власнику) не піднімає.
 */
export const ALARM_MODES = Object.freeze(['any', 'stale']);

export function ringing(problems, alarmOn) {
  if (!ALARM_MODES.includes(alarmOn)) throw new Error(`невідомий режим тривоги: ${alarmOn}`);
  return alarmOn === 'stale' ? problems.filter((p) => p.kind !== 'never') : problems;
}

export function budgetFromSource(rel, name) {
  const src = readFileSync(path.join(ROOT, rel), 'utf8');
  const m = src.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`не знайшов ${name} у ${rel} — бюджет мусить жити там, де його читає код`);
  return Number(m[1]);
}

const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

/** Файли, що КОМІТЯТЬСЯ й їдуть до читача. Їх бачить і CI, і data-refresh. */
export function fileSources() {
  return [
    { name: 'wildfires.json',
      stamp: readJson('apps/web/src/data/wildfires.json')?.meta?.fetchedAt ?? null,
      budgetHours: budgetFromSource('apps/web/src/lib/wildfires.ts', 'FRESH_FOR_HOURS') },
    { name: 'fuel-prices.json',
      stamp: readJson('apps/web/src/data/fuel-prices.json')?.fetchedAt ?? null,
      budgetHours: budgetFromSource('apps/web/src/lib/fuel.ts', 'STALE_AFTER_DAYS') * 24,
      // 🔴 ПРИЙНЯТТЯ ПРИБРАНО 26.10.2026 — причину знято, а не перечекано.
      // Збирач відмовлявся через розбіжність дати в імені файла й у самій
      // таблиці. Виявилось: Комісія заморожує параметр `filename=` на
      // момент створення документа й оновлює лише вміст. Доказ на тій
      // самій сторінці — посилання з іменем 2024-02-19 на сторінці
      // ЩОТИЖНЕВОГО бюлетеня. Тобто імʼя датою не є.
      // Тепер публікується дата з таблиці, а перевірка лишилась, але
      // проти СПРАВЖНЬОЇ загрози: вміст СТАРШИЙ за імʼя (кеш підсунув
      // торішні числа). Деталі — `bulletinDateFrom`. Картка: CAMP-392.
    },
  ];
}

/**
 * Таблиці, що мають дату імпорту. Перелік — замір по
 * `apps/api/src/migrations` 27.10.2026, а не памʼять.
 *
 * 🔴 ЖОДЕН ІЗ ДЕВʼЯТИ ІМПОРТЕРІВ НЕ МАЄ РОЗКЛАДУ В РЕПОЗИТОРІЇ: їх
 * запускає людина (`osm-weekly.yml` лише публікує екстракт і ДРУКУЄ
 * команду імпорту; `air/import.ts` каже прямо «the refresh is not
 * scheduled»). Тому «застарів» тут означає «людина не запустила», а не
 * «cron упав», і адресат тривоги — людина.
 *
 * 🔴 БЕЗ ДАТИ, отже тут їх НЕМАЄ: `ne_admin`, `osm_ctx_poi`,
 * `osm_ctx_water`, `osm_ctx_place`, `osm_country_area`,
 * `osm_country_lines` — їх створює `scripts/osm-pipeline` без жодної
 * колонки часу. Вік недоведений і не вигадується (знахідка CAMP-399).
 *
 * `budgetHours` — число або функція, що читає його з коду-споживача.
 */
export const DB_SOURCES = Object.freeze([
  { name: 'camping_spots (OSM кемпінги)', card: 'CAMP-28',
    table: 'camping_spots', column: 'last_seen_at', budgetHours: 10 * 24 },
  { name: 'osm_route_poi (POI маршрутів)', card: 'CAMP-113',
    table: 'osm_route_poi', column: 'last_seen_at', budgetHours: 10 * 24 },
  { name: 'fuel_station_prices (ціни станцій ES/FR/IT)', card: 'CAMP-154',
    table: 'fuel_station_prices', column: 'fetched_at', budgetHours: 2 * 24 },
  { name: 'spot_tariffs (тарифи DATAtourisme)', card: 'CAMP-147',
    table: 'spot_tariffs', column: 'created_at', budgetHours: 10 * 24 },
  { name: 'spot_links (звʼязки OSM↔DATAtourisme)', card: 'CAMP-144',
    table: 'spot_links', column: 'created_at', budgetHours: 10 * 24 },
  { name: 'webcams (камери Windy)', card: 'CAMP-190',
    table: 'webcams', column: 'fetched_at', budgetHours: 10 * 24 },
  { name: 'bathing_waters (купання EEA)', card: 'CAMP-168',
    table: 'bathing_waters', column: 'created_at',
    budgetHours: () => budgetFromSource('apps/web/src/lib/sources.ts', 'ANNUAL_HEALTHY_DAYS') * 24 },
  { name: 'air_quality_stations (повітря EEA, станції)', card: 'CAMP-164',
    table: 'air_quality_stations', column: 'read_at',
    budgetHours: () => budgetFromSource('apps/web/src/lib/air-quality.ts', 'AIR_FRESH_FOR_HOURS') },
  { name: 'air_quality_modelled (повітря EEA, модель)', card: 'CAMP-164',
    table: 'air_quality_modelled', column: 'read_at',
    budgetHours: () => budgetFromSource('apps/web/src/lib/air-quality.ts', 'AIR_FRESH_FOR_HOURS') },
]);

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/** Один запит на таблицю: скільки рядків і найновіша мітка, у UTC ISO. */
export const probeSql = (s) =>
  `SELECT count(*), to_char(max(${s.column}) AT TIME ZONE 'UTC', ${ISO}) FROM ${s.table}`;

/** Живе читання через psql — він є на машині (Postgres локальний). */
export function readDbLive(dbUrl) {
  return (s) => {
    let out;
    try {
      out = execFileSync('psql', [dbUrl, '-tAX', '-v', 'ON_ERROR_STOP=1', '-F', '|', '-c', probeSql(s)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) {
      // 🔴 Не UsageError: база недоступна чи таблиці немає — це аварія,
      // і вона мусить вийти зі стеком, а не перетворитись на тихий код.
      throw new Error(`${s.table}: psql не відповів — ${(e.stderr ?? e.message ?? '').toString().trim()}`);
    }
    const [n, t] = out.split('|');
    return { rows: Number(n), stamp: t === undefined || t === '' ? null : t };
  };
}

const hours = (b) => (typeof b === 'function' ? b() : b);

export function dbSources(readDb) {
  return DB_SOURCES.map((s) => ({ ...s, budgetHours: hours(s.budgetHours), ...readDb(s) }));
}

/**
 * 🔴 ЄДИНИЙ ШЛЯХ ВІД ПРАПОРЦІВ ДО КОДУ ВИХОДУ. Самоперевірка викликає
 * його цілком, бо рецензія #222 показала: чисті функції поруч були
 * зелені, а зʼєднання argv → вирок не перевіряло ніщо.
 */
export function runWith(flags, {
  now = Date.now(),
  log = console,
  files = fileSources(),
  readDb = undefined,
  dbUrl = process.env.DATABASE_URL,
} = {}) {
  const alarmOn = flags.has('--stale-only') ? 'stale' : 'any';
  const sources = [...files];
  let tables = 0;
  if (flags.has('--db')) {
    if (!dbUrl) {
      throw new UsageError(
        '--db потребує DATABASE_URL, а її немає. Юніт бере її з apps/api/.env через ' +
          'EnvironmentFile; без неї таблиці не читаються — і це збій, а не «пропустити».',
      );
    }
    const fromDb = dbSources(readDb ?? readDbLive(dbUrl));
    tables = fromDb.length;
    sources.push(...fromDb);
  }

  const problems = audit(sources, now);
  for (const s of sources) {
    const p = problems.find((x) => x.name === s.name);
    const mark = !p ? '✓' : p.kind === 'never' ? '○' : '✗';
    let detail;
    if (p) detail = p.text.slice(s.name.length + 2);
    else if (s.acceptedUntil) detail = `прийнято до ${s.acceptedUntil}`;
    else detail = `${age((now - Date.parse(s.stamp)) / 36e5)} від ${s.stamp}, бюджет ${age(s.budgetHours)}`;
    const rows = s.rows === undefined ? '' : `${String(s.rows).padStart(9)} рядків  `;
    log.log(`  ${mark} ${s.name.padEnd(46)} ${rows}${detail}`);
  }

  const ring = ringing(problems, alarmOn);
  const quiet = problems.filter((p) => !ring.includes(p));
  if (quiet.length > 0) {
    log.error(
      `\n  ○ ${quiet.length} не запускались жодного разу — у звіті є, тривоги не піднімають (--stale-only): ` +
        quiet.map((p) => p.name).join(', '),
    );
  }
  if (ring.length > 0) {
    log.error('\n✗ Дані протухли:\n');
    for (const p of ring) log.error(`  🔴 ${p.text}`);
    log.error('\n  Сайт покаже читачеві «дані застаріли». Це не косметика:');
    log.error('  мапа з протухлими пожежами гірша за мапу без шару пожеж.');
    log.error('  Запусти збирач або перевір, чому розклад не спрацював.');
    return 1;
  }
  log.log(`\n✓ дані свіжі: ${sources.length} джерел (${files.length} файлів, ${tables} таблиць)`);
  return 0;
}

function selfTest() {
  const NOW = Date.parse('2026-10-25T00:00:00Z');
  const ok = (h) => new Date(NOW - h * 36e5).toISOString();
  let p = 0, f = 0;
  const t = (what, got, want) => {
    if (got === want) { p += 1; console.log(`  ✓ ${what}`); }
    else { f += 1; console.error(`  ✗ ${what}: ${JSON.stringify(got)}, мало бути ${JSON.stringify(want)}`); }
  };
  const one = (src) => audit([src], NOW);
  const kind = (src) => one(src).map((x) => x.kind).join(',');

  // ── ядро ──────────────────────────────────────────────────────────
  t('свіжий файл не скаржиться', one({ name: 'a', stamp: ok(10), budgetHours: 72 }).length, 0);
  t('протухлий ловиться', kind({ name: 'a', stamp: ok(100), budgetHours: 72 }), 'stale');
  t('рівно на межі ще проходить', one({ name: 'a', stamp: ok(72), budgetHours: 72 }).length, 0);
  t('відсутня мітка ловиться', kind({ name: 'a', stamp: null, budgetHours: 72 }), 'no-stamp');
  t('нечитана мітка ловиться', kind({ name: 'a', stamp: 'позавчора', budgetHours: 72 }), 'unreadable');
  t('🔴 мітка в МАЙБУТНЬОМУ ловиться', kind({ name: 'a', stamp: ok(-50), budgetHours: 72 }), 'future');
  t('прийняте зі строком у майбутньому не скаржиться',
    one({ name: 'a', stamp: ok(1000), budgetHours: 72, acceptedUntil: '2026-12-31' }).length, 0);
  t('🔴 прийняття, строк якого МИНУВ, ловиться',
    kind({ name: 'a', stamp: ok(1000), budgetHours: 72, acceptedUntil: '2026-10-01' }), 'accepted-expired');
  t('дві поломки дають дві скарги',
    audit([{ name: 'a', stamp: ok(100), budgetHours: 72 }, { name: 'b', stamp: null, budgetHours: 24 }], NOW).length, 2);
  t('🔴 порожня таблиця — «не запускався», а не «немає мітки»',
    kind({ name: 'a', rows: 0, stamp: null, budgetHours: 240 }), 'never');
  t('🔴 рядки є, а мітки немає — це поломка імпортера, не «ніколи»',
    kind({ name: 'a', rows: 5, stamp: null, budgetHours: 240 }), 'no-stamp');
  t('бюджет у годинах застосовується до годин (повітря: 5 год при 4)',
    kind({ name: 'a', rows: 5, stamp: ok(5), budgetHours: 4 }), 'stale');

  // ── режими тривоги ────────────────────────────────────────────────
  const never = { name: 'n', kind: 'never', text: 'n' };
  const stale = { name: 's', kind: 'stale', text: 's' };
  t('🔴 таймер: «не запускався» НЕ дзвонить', ringing([never], 'stale').length, 0);
  t('🔴 таймер: те, що працювало й зупинилось, дзвонить', ringing([stale], 'stale').length, 1);
  t('звіт на вимогу: «не запускався» — це провал', ringing([never], 'any').length, 1);

  // ── argv ──────────────────────────────────────────────────────────
  let msg = '';
  try { chooseAction(['--nonexistent-flag'], KNOWN_FLAGS, 'x'); } catch (e) { msg = e.message; }
  t('🔴 невідомий прапорець відкидається, і повідомлення називає його та відомі',
    msg.includes('--nonexistent-flag') && msg.includes('--stale-only') && msg.includes('--db'), true);
  const both = chooseAction(['--db', '--stale-only'], KNOWN_FLAGS, 'x');
  t('--db і --stale-only читаються', both.has('--db') && both.has('--stale-only'), true);

  // ── зʼєднання argv → код виходу ───────────────────────────────────
  const silent = { log: () => {}, error: () => {} };
  const files = [{ name: 'f.json', stamp: ok(1), budgetHours: 72 }];
  const fake = (states) => {
    const calls = [];
    const read = (s) => {
      calls.push(s.table);
      const st = states[s.table] ?? 'ok';
      if (st === 'never') return { rows: 0, stamp: null };
      if (st === 'stale') return { rows: 5, stamp: ok(24 * 60) };
      return { rows: 5, stamp: ok(1) };
    };
    return { read, calls };
  };
  const base = (readDb) => ({ now: NOW, log: silent, files, readDb, dbUrl: 'postgres://x' });

  t('🔴 --db --stale-only: порожня таблиця НЕ дзвонить',
    runWith(new Set(['--db', '--stale-only']), base(fake({ webcams: 'never' }).read)), 0);
  t('🔴 --db без --stale-only: та сама порожня таблиця дзвонить — режим справді передається',
    runWith(new Set(['--db']), base(fake({ webcams: 'never' }).read)), 1);
  t('🔴 --db --stale-only: таблиця, що зупинилась, дзвонить',
    runWith(new Set(['--db', '--stale-only']), base(fake({ spot_links: 'stale' }).read)), 1);
  t('--db і все свіже → 0',
    runWith(new Set(['--db']), base(fake({}).read)), 0);
  let usage = false;
  try { runWith(new Set(['--db']), { ...base(fake({}).read), dbUrl: undefined }); }
  catch (e) { usage = e instanceof UsageError; }
  t('🔴 --db без DATABASE_URL — помилка вживання, а не «пропустити»', usage, true);
  const noDb = fake({ webcams: 'never' });
  t('🔴 без --db таблиці не читаються взагалі (і порожня не дзвонить)',
    runWith(new Set(), base(noDb.read)) === 0 && noDb.calls.length === 0, true);
  const withDb = fake({});
  runWith(new Set(['--db']), base(withDb.read));
  t('з --db прочитано КОЖНУ таблицю з переліку', withDb.calls.length, DB_SOURCES.length);

  // ── перелік ───────────────────────────────────────────────────────
  t('девʼять таблиць із датою імпорту (замір по міграціях 27.10.2026)', DB_SOURCES.length, 9);
  t('у кожної є таблиця, колонка, картка й бюджет > 0',
    DB_SOURCES.every((s) => s.table && s.column && s.card && hours(s.budgetHours) > 0), true);
  t('запит називає саме цю колонку й таблицю',
    probeSql({ table: 'tt', column: 'cc' }).includes('max(cc)') && probeSql({ table: 'tt', column: 'cc' }).endsWith('FROM tt'), true);
  t('бюджети файлів читаються з коду-споживача',
    fileSources().every((s) => s.budgetHours > 0), true);
  // 🔴 ЮНІТ І СКРИПТ ЗВʼЯЗАНІ ТУТ, У CI, а не лише на машині. Саме цей
  // розрив прожив три тижні (CAMP-399): юніт передавав `--stale-only`,
  // скрипт його не знав. Тепер такий PR червоний до деплою.
  const unit = readFileSync(path.join(ROOT, 'infra/systemd/camptribe-freshness.service'), 'utf8');
  const exec = unit.match(/^ExecStart=.*check-data-freshness\.mjs(.*)$/m);
  const passed = exec ? exec[1].trim().split(/\s+/).filter(Boolean) : null;
  t('🔴 юніт systemd передає лише ті прапорці, які скрипт знає',
    passed !== null && passed.length > 0 && passed.every((a) => KNOWN_FLAGS.includes(a)), true);

  // 🔴 Лічильник стверджується, бо випадок, до якого не дійшло,
  // виглядає точно як випадок, що пройшов.
  t('🔴 лічильник: усі випадки дійшли до кінця', p + f, 29);
  console.log(`check-data-freshness self-test: ran ${p + f}, passed ${p}, failed ${f}`);
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
    flags = chooseAction(process.argv.slice(2), KNOWN_FLAGS, 'check-data-freshness.mjs');
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
  if (flags.has('--self-test')) process.exit(selfTest());
  try {
    process.exit(runWith(flags));
  } catch (e) {
    // 🔴 Лише помилка ВЖИВАННЯ глушиться в речення. База недоступна,
    // psql немає — мусить вийти зі стеком, інакше таймер перетворить
    // аварію на тихе число.
    if (!(e instanceof UsageError)) throw e;
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
}
