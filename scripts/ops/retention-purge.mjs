#!/usr/bin/env node
// Строк зберігання, який виконує код, а не документ.
//
//   node scripts/ops/retention-purge.mjs             # порахувати й видалити прострочене; потрібен DATABASE_URL
//   node scripts/ops/retention-purge.mjs --dry-run   # лише порахувати, нічого не чіпати
//   node scripts/ops/retention-purge.mjs --self-test # без бази
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ. 30.10.2026 для заявок «Report a problem»
// (`problem_reports`) записано правову підставу — GDPR ст. 6(1)(f) — і
// строк: 12 місяців від закриття, 24 для нерозглянутих. Записано в
// документі (мозок, `Facts/pravova-pidstava-problem-reports.md`) і НЕ
// виконувалось жодним кодом. Строк, якого не виконує код, — це не
// строк: наглядовому органу він обіцяє те, чого база не робить.
//
// 🔴 ГОЛОВНА ВИМОГА: ПАДАТИ, КОЛИ НЕ ЗМІГ. Чистка, яка тихо нічого не
// видалила, гірша за її відсутність — вона дає впевненість без дії.
//   · база недоступна, таблиці немає, psql упав  → виняток зі стеком,
//     ненульовий код; `OnFailure` юніта піднімає лист (CAMP-306/394);
//   · прострочених немає                          → код 0, і в журналі
//     «перевірено N, прострочених 0», а не мовчання;
//   · запит повернув НЕ ОДИН рядок або не число   → це не «нуль», це
//     збій читання — виняток (`integer()`);
//   · порахували N, а видалили не N                → збій, код 1;
//   · є рядки, яких не покриває жодне правило      → строку для них
//     немає, тож у цій таблиці НІЧОГО не видаляється, код 1 — людина
//     додає правило. Сьогодні це неможливо (`CHECK` на `status`),
//     завтрашня міграція з новим станом зробить це видимим першого ж
//     ранку, а не тримати рядки вічно мовчки.
//
// 🔴 ПРАВИЛА — В ОДНОМУ МІСЦІ: `RULES` нижче. Звідси їх читає сторож,
// самотест, `apps/api/src/reports/retention.db.spec.ts` і
// `apps/api/src/telemetry/retention-logs.db.spec.ts` (справжній Postgres),
// а `apps/web/tests/unit/problem-reports-policy.spec.ts` звіряє з ними
// реєстр (§4, §5, §10). Другої копії «12», «24», «3» чи «1» ніде немає
// навмисно: з межею віку релізу (`--max-age-days` окремо від бюджету
// свіжості) ми вже обпеклись.
//
// 🔴 ПОРЯДОК: СПЕРШУ ПОРАХУВАТИ, ПОТІМ ВИДАЛИТИ, і обома кроками керує
// ОДИН текст умови (`ageClause`). Жодного DROP/TRUNCATE; DELETE лише за
// умовою строку, з RETURNING, щоб звірити кількість із підрахунком.
//
// `now` передається в SQL літералом (`asOf`), а не `now()`: так журнал
// каже, станом на яку мить рахувалось, а тест може підставити дату.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

export const KNOWN_FLAGS = Object.freeze(['--self-test', '--dry-run']);

/** Помилка ВЖИВАННЯ — код 2 без стеку. Справжнє падіння мусить кричати стеком. */
export class UsageError extends Error {}

/**
 * ЄДИНЕ МІСЦЕ правил строків.
 *
 * Таблиця → гілки. Кожна гілка — один стан рядка і один строк:
 *   where  — SQL-умова, яка відбирає рядки В ЦЬОМУ СТАНІ (без віку);
 *   since  — SQL-вираз дати, ВІД ЯКОЇ рахується строк;
 *   months — строк у місяцях;
 *   mark   — текст позначки в журналі для КОЖНОГО видаленого рядка, або
 *            null. Правова нотатка вимагає позначки для нерозглянутих:
 *            їх видаляють не тому, що розглянули, а тому, що ніхто не
 *            розглянув.
 *
 * Гілки однієї таблиці мають разом покривати ВСІ її рядки й не
 * перетинатись — сторож це звіряє підрахунком і падає, якщо ні.
 *
 * `COALESCE(reviewed_at, created_at)`: закрита заявка без дати закриття —
 * розбіжність даних; рахувати від `created_at` означає видалити НЕ
 * ПІЗНІШЕ, ніж від справжнього закриття — у бік людини, не від неї.
 */
export const RULES = Object.freeze([
  {
    table: 'problem_reports',
    card: 'Report a problem (PR #379)',
    legal: 'мозок: Facts/pravova-pidstava-problem-reports.md — GDPR ст. 6(1)(f), рішення 30.10.2026',
    branches: Object.freeze([
      Object.freeze({
        name: 'closed',
        label: 'закриті (resolved/dismissed)',
        months: 12,
        where: `status IN ('resolved', 'dismissed')`,
        since: 'COALESCE(reviewed_at, created_at)',
        mark: null,
      }),
      Object.freeze({
        name: 'open',
        label: 'нерозглянуті (new)',
        months: 24,
        where: `status = 'new'`,
        since: 'created_at',
        mark: 'нерозглянута заявка видалена за строком — її не розглянув ніхто',
      }),
    ]),
  },
  // 🔴 ДВА ЖУРНАЛИ БЕЗ СТАНУ: одна гілка на таблицю, `where: TRUE` — строк
  // іде від запису, бо в рядка немає «закриття». Обидві таблиці навмисно
  // без IP, сесії й акаунта (їхні entity кажуть це), але вільний текст
  // (`message`, `stack`, `referrer`) може принести чуже — тож строк
  // відповідає на питання «навіщо тримаємо», а не на «скільки не шкода».
  {
    table: 'client_errors',
    card: 'Журнал помилок браузера (CAMP-92); строк — реєстр §4',
    legal: 'docs/GDPR-REGISTER.md §4 — GDPR ст. 6(1)(f); строк обрано 01.11.2026 за метою, без юриста',
    branches: Object.freeze([
      Object.freeze({
        name: 'all',
        label: 'усі (журнал без стану)',
        // 🔴 ЧОМУ 3 МІСЯЦІ. Запис потрібен, доки помилку не полагодили,
        // і щоб після релізу сказати «не повторилась». Жива помилка пише
        // СВІЖІ рядки щодня — старі не додають нічого, чого нема у
        // свіжих. Рідкісна (один браузер, одна сторінка) може приходити
        // раз на кілька тижнів: квартал — найдовший проміжок, за який
        // «не повторилась жодного разу» означає «полагоджено», а не
        // «не дивились». Довше — лише ризик вільного тексту без користі.
        months: 3,
        where: 'TRUE',
        since: 'received_at',
        mark: null,
      }),
    ]),
  },
  // 🔴 CAMP-51. ЗАЯВКА, ЯКУ НІХТО НЕ ПІДТВЕРДИВ, — ЦЕ РЯДОК ІЗ `user_id`
  // І БІЛЬШЕ НІЧОГО КОРИСНОГО.
  //
  // Код у ній живе 24 години (`CODE_TTL_MS`), далі він не відмикає нічого.
  // Але рядок лишається й далі каже, ЯКИЙ АКАУНТ цікавився ЯКИМ кемпінгом.
  // Це і є персональні дані, яких ми більше не потребуємо.
  //
  // 🔴 ПІДТВЕРДЖЕНІ НЕ ЧІПАЄМО, І ЦЕ НЕ ВИНЯТОК ЗАРАДИ ЗРУЧНОСТІ.
  // `used_at IS NOT NULL` — це сам грант: видалити його означає мовчки
  // забрати в людини її кемпінг. Він зникає разом з акаунтом
  // (`ON DELETE CASCADE`) або коли людина від нього відмовиться.
  {
    table: 'spot_claims',
    card: 'Claim your listing (CAMP-51); строк — реєстр §11',
    legal: 'docs/GDPR-REGISTER.md §11 — GDPR ст. 6(1)(f); строк обрано 03.11.2026 за метою, без юриста',
    branches: Object.freeze([
      Object.freeze({
        name: 'unconfirmed',
        label: 'непідтверджені (код так і не ввели)',
        // 🔴 ЧОМУ 1 МІСЯЦЬ, А НЕ 24 ГОДИНИ. Код мертвий через добу, але
        // рахунок листів («не більше трьох на кемпінг за добу») читає ці
        // ж рядки, і людина, якій лист загубився, приходить не того
        // самого дня. Місяць лишає запас на «я написав вам минулого
        // тижня» і все одно коротший за будь-яку мету, яку ми можемо
        // назвати. Довше тримати нема навіщо.
        months: 1,
        where: 'used_at IS NULL',
        since: 'created_at',
        mark: null,
      }),
    ]),
  },
  {
    table: 'not_found_hits',
    card: 'Журнал ненайдених адрес (CAMP-235); строк — реєстр §5',
    legal: 'docs/GDPR-REGISTER.md §5 — GDPR ст. 6(1)(f); строк обрано 01.11.2026 за метою, без юриста',
    branches: Object.freeze([
      Object.freeze({
        name: 'all',
        label: 'усі (журнал без стану)',
        // 🔴 ЧОМУ 1 МІСЯЦЬ. Запис потрібен, доки не поставили 301. Звіт
        // читає останні 7 діб (`REPORT_DAYS` у telemetry/not-found.service.ts;
        // самотест нижче звіряє, що строк не коротший за вікно звіту), а
        // імпорт OSM, який ламає адреси, — щотижневий. Місяць — чотири
        // вікна звіту: пропущений понеділок (чи три) нічого не втрачає.
        // Адреса, яку за місяць ніхто не спитав, переадресації не
        // потребує; яку питають — має свіжі рядки.
        months: 1,
        where: 'TRUE',
        since: 'created_at',
        mark: null,
      }),
    ]),
  },
]);

// ── SQL ───────────────────────────────────────────────────────────────

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** Мить «зараз» як SQL-літерал. Лише ISO UTC — інакше це шлях для ін'єкції. */
export function asOfLiteral(asOf) {
  if (typeof asOf !== 'string' || !ISO_UTC.test(asOf)) {
    throw new Error(`asOf мусить бути ISO UTC (YYYY-MM-DDTHH:MM:SSZ), отримано ${JSON.stringify(asOf)}`);
  }
  return `'${asOf}'::timestamptz`;
}

function monthsOf(b) {
  if (!Number.isInteger(b.months) || b.months <= 0) {
    throw new Error(`гілка «${b.name}»: months мусить бути цілим > 0, отримано ${JSON.stringify(b.months)}`);
  }
  return b.months;
}

/** Умова ВІКУ — одна на підрахунок і на видалення. */
export const ageClause = (b, asOf) =>
  `(${b.since}) < ${asOfLiteral(asOf)} - interval '${monthsOf(b)} months'`;

/** Скільки рядків у таблиці взагалі — знаменник заміру. */
export const totalSql = (rule) => `SELECT count(*) FROM ${rule.table}`;

/** Для гілки: скільки рядків у її стані і скільки з них прострочених. */
// 🔴 Аліаси обов'язкові: драйвер `pg` віддає рядок об'єктом за іменами
// колонок, і два `count` без імен злились би в одне поле (заміряно в
// retention.db.spec.ts 30.10.2026: «очікував ціле число, отримав undefined»).
export const branchCountSql = (rule, b, asOf) =>
  `SELECT count(*) AS in_state, count(*) FILTER (WHERE ${ageClause(b, asOf)}) AS expired ` +
  `FROM ${rule.table} WHERE ${b.where}`;

/** Точкове видалення за тією самою умовою, з поверненням id і дати, від якої рахувався строк. */
export const deleteSql = (rule, b, asOf) =>
  `DELETE FROM ${rule.table} WHERE (${b.where}) AND ${ageClause(b, asOf)} ` +
  `RETURNING id::text AS id, to_char((${b.since}) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS since`;

// ── читання бази ──────────────────────────────────────────────────────

/**
 * Живе читання через psql — він є на машині (Postgres локальний), і
 * саме ним читає `check-data-freshness.mjs`. Повертає рядки як масиви
 * рядків; порожній вивід — порожній масив, а що з ним робити, вирішує
 * `integer()`, не цей шар.
 */
export function readDbLive(dbUrl) {
  return (sql) => {
    let out;
    try {
      // 🔴 `-q` ОБОВ'ЯЗКОВИЙ. Без нього psql друкує тег команди («DELETE 1»)
      // як ще один рядок виводу — і 30.10.2026 на скретч-базі сторож
      // прочитав «видалено 2» при одному видаленому рядку. Він упав, як і
      // мусив (порахували 1 ≠ 2), але це був би щоденний лист ні про що.
      // Спека на `pg` цього не бачить: дефект живе лише в psql-шарі.
      out = execFileSync('psql', [dbUrl, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-F', '|', '-c', sql], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      // 🔴 Не UsageError: база недоступна чи таблиці немає — це аварія,
      // і вона мусить вийти зі стеком, а не перетворитись на тихий код.
      throw new Error(`psql не відповів — ${(e.stderr ?? e.message ?? '').toString().trim()}`);
    }
    return out
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('|'));
  };
}

/**
 * Одне ціле число з відповіді — або виняток.
 *
 * 🔴 НУЛЬ РЯДКІВ ВІДПОВІДІ ≠ НУЛЬ. `count(*)` завжди повертає рівно один
 * рядок; якщо його немає або він не число — читання не відбулось, і
 * казати «прострочених 0» було б твердженням про те, чого не бачили.
 */
export function integer(rows, what, column = 0) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      `${what}: запит повернув ${Array.isArray(rows) ? rows.length : 'не масив'} рядків замість одного — читання не доведене`,
    );
  }
  const raw = rows[0]?.[column];
  const n = Number(raw);
  if (raw === undefined || raw === null || String(raw).trim() === '' || !Number.isInteger(n) || n < 0) {
    throw new Error(`${what}: очікував ціле число, отримав ${JSON.stringify(raw)}`);
  }
  return n;
}

// ── вирок ─────────────────────────────────────────────────────────────

/**
 * 🔴 ЄДИНИЙ ШЛЯХ ВІД ПРАПОРЦІВ ДО КОДУ ВИХОДУ. Самотест і db.spec
 * викликають його цілком: чисті функції поруч можуть бути зелені, а
 * з'єднання argv → SQL → вирок не перевіряє ніщо.
 *
 * Повертає 0 або 1. Кидає, коли база не відповіла чи відповідь не
 * читається — і це навмисно НЕ ловиться тут: сторож, який при помилці
 * бази повертає число, перетворює аварію на звіт.
 */
export function runWith(flags, {
  now = new Date(),
  log = console,
  db = undefined,
  dbUrl = process.env.DATABASE_URL,
  rules = RULES,
} = {}) {
  if (!dbUrl) {
    throw new UsageError(
      'потрібна DATABASE_URL, а її немає. Юніт бере її з apps/api/.env через EnvironmentFile; ' +
        'без неї таблиці не читаються — і це збій, а не «пропустити».',
    );
  }
  const dry = flags.has('--dry-run');
  const asOf = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const query = db ?? readDbLive(dbUrl);

  let checked = 0;
  let expiredTotal = 0;
  let deleted = 0;
  let marked = 0;
  const faults = [];

  for (const rule of rules) {
    const total = integer(query(totalSql(rule)), `${rule.table}: count(*)`);
    checked += total;
    log.log(`${rule.table}: перевірено ${total} рядків станом на ${asOf}${dry ? ' (сухий прогін)' : ''}`);

    // 1. Порахувати — по кожній гілці, і звірити, що гілки покривають усе.
    const plan = [];
    let covered = 0;
    for (const b of rule.branches) {
      const rows = query(branchCountSql(rule, b, asOf));
      const inState = integer(rows, `${rule.table}/${b.name}: у стані`, 0);
      const expired = integer(rows, `${rule.table}/${b.name}: прострочених`, 1);
      covered += inState;
      expiredTotal += expired;
      plan.push({ b, inState, expired });
    }
    const complete = covered === total;
    if (!complete) {
      faults.push(
        `${rule.table}: рядків ${total}, а правила покривають ${covered} — є стан без строку ` +
          '(або гілки перетинаються). У цій таблиці нічого не видалено: умова не доведена.',
      );
    }

    // 2. Видалити — лише коли все пораховано й покрито.
    for (const { b, inState, expired } of plan) {
      const line = `  ${b.label}, ${b.months} міс від ${b.since}: у стані ${inState}, прострочених ${expired}`;
      if (expired === 0 || dry || !complete) {
        log.log(line + (expired > 0 ? (dry ? ' — не видалено (--dry-run)' : ' — не видалено (правила неповні)') : ''));
        continue;
      }
      const gone = query(deleteSql(rule, b, asOf));
      if (gone.length !== expired) {
        faults.push(`${rule.table}/${b.name}: порахували ${expired}, видалили ${gone.length} — видалення не доведене`);
      }
      deleted += gone.length;
      log.log(`${line} → видалено ${gone.length}`);
      if (b.mark) {
        marked += gone.length;
        for (const [id, since] of gone) {
          log.log(`    🔴 позначка: ${id} від ${since} — ${b.mark}`);
        }
      }
    }
  }

  if (faults.length > 0) {
    log.error('\n✗ retention: строк не виконано:\n');
    for (const f of faults) log.error(`  🔴 ${f}`);
    return 1;
  }
  log.log(
    `\n✓ retention: таблиць ${rules.length}, перевірено ${checked}, прострочених ${expiredTotal}` +
      (dry ? ' — сухий прогін, не видалено нічого' : `, видалено ${deleted}, з них нерозглянутих ${marked}`),
  );
  return 0;
}

// ── самотест (без бази) ───────────────────────────────────────────────

function selfTest() {
  const NOW = new Date('2026-10-30T04:00:00Z');
  const AS_OF = '2026-10-30T04:00:00Z';
  let p = 0, f = 0;
  const t = (what, got, want) => {
    if (got === want) { p += 1; console.log(`  ✓ ${what}`); }
    else { f += 1; console.error(`  ✗ ${what}: ${JSON.stringify(got)}, мало бути ${JSON.stringify(want)}`); }
  };
  const throws = (fn, needle) => {
    try { fn(); return false; } catch (e) { return needle ? String(e.message).includes(needle) : true; }
  };
  const silent = { log: () => {}, error: () => {} };
  const pr = RULES.find((r) => r.table === 'problem_reports');
  const closed = pr.branches.find((b) => b.name === 'closed');
  const open = pr.branches.find((b) => b.name === 'open');

  // ── правила ───────────────────────────────────────────────────────
  t('problem_reports має рівно дві гілки — закриті й нерозглянуті', pr.branches.length, 2);
  t('🔴 закриті — 12 місяців (правова нотатка 30.10.2026)', closed.months, 12);
  t('🔴 нерозглянуті — 24 місяці, і це ІНША константа, не та сама', open.months, 24);
  t('закриті відбираються за кінцевим станом', closed.where.includes("'resolved'") && closed.where.includes("'dismissed'"), true);
  t('закриті рахуються від дати закриття', closed.since.includes('reviewed_at'), true);
  t('нерозглянуті рахуються від створення', open.since, 'created_at');
  t('🔴 нерозглянуті видаляються З ПОЗНАЧКОЮ, закриті — без', Boolean(open.mark) && closed.mark === null, true);
  t('у кожного правила є таблиця, картка й правова нотатка',
    RULES.every((r) => r.table && r.card && r.legal && r.branches.length > 0), true);

  // ── журнали браузера й 404 (01.11.2026) ───────────────────────────
  const ce = RULES.find((r) => r.table === 'client_errors');
  const nf = RULES.find((r) => r.table === 'not_found_hits');
  t('🔴 правил чотири: заявки, помилки браузера, ненайдені адреси, заявки на володіння',
    RULES.map((r) => r.table).sort().join(','),
    'client_errors,not_found_hits,problem_reports,spot_claims');

  // ── заявка на володіння кемпінгом (CAMP-51, 03.11.2026) ───────────
  const sc = RULES.find((r) => r.table === 'spot_claims');
  t('🔴 spot_claims — 1 місяць від created_at, і ЛИШЕ непідтверджені',
    sc.branches.length === 1 && sc.branches[0].months === 1 &&
    sc.branches[0].since === 'created_at' &&
    sc.branches[0].where === 'used_at IS NULL', true);
  // 🔴 Без цього випадку одруківка в умові (`IS NOT NULL`) видаляла б
  // САМ ГРАНТ — тобто мовчки забирала б у людини її кемпінг, і помітили б
  // це лише тоді, коли вона прийшла б питати, куди він подівся.
  t('🔴 умова НЕ зачіпає підтверджених',
    /used_at IS NULL/.test(sc.branches[0].where) &&
    !/IS NOT NULL/.test(sc.branches[0].where), true);
  t('🔴 client_errors — 3 місяці від received_at, одна гілка на всі рядки',
    ce.branches.length === 1 && ce.branches[0].months === 3 && ce.branches[0].since === 'received_at' && ce.branches[0].where === 'TRUE', true);
  t('🔴 not_found_hits — 1 місяць від created_at, одна гілка на всі рядки',
    nf.branches.length === 1 && nf.branches[0].months === 1 && nf.branches[0].since === 'created_at' && nf.branches[0].where === 'TRUE', true);
  t('🔴 строки журналів РІЗНІ — переплутати таблиці не можна непомітно',
    ce.branches[0].months !== nf.branches[0].months, true);
  // 🔴 Чистка не сміє з'їсти те, що читає звіт: вікно звіту — з коду, не з пам'яті.
  const nfSvc = readFileSync(path.join(ROOT, 'apps/api/src/telemetry/not-found.service.ts'), 'utf8');
  const reportDays = Number(/^export const REPORT_DAYS = (\d+);/m.exec(nfSvc)?.[1]);
  t('вікно звіту 404 прочитане з коду (REPORT_DAYS)', Number.isInteger(reportDays) && reportDays > 0, true);
  t('🔴 строк not_found_hits не коротший за вікно звіту (28 діб на місяць — найгірший випадок)',
    nf.branches[0].months * 28 >= reportDays, true);

  // ── SQL ───────────────────────────────────────────────────────────
  t('умова віку називає строк гілки і дату, від якої він іде',
    ageClause(open, AS_OF), `(created_at) < '2026-10-30T04:00:00Z'::timestamptz - interval '24 months'`);
  t('🔴 підрахунок і видалення стоять на ОДНІЙ умові віку',
    deleteSql(pr, closed, AS_OF).includes(ageClause(closed, AS_OF)) &&
      branchCountSql(pr, closed, AS_OF).includes(ageClause(closed, AS_OF)), true);
  t('видалення — DELETE за умовою стану Й віку, з RETURNING',
    deleteSql(pr, open, AS_OF).startsWith(`DELETE FROM problem_reports WHERE (status = 'new') AND`) &&
      deleteSql(pr, open, AS_OF).includes('RETURNING id::text'), true);
  t('🔴 жодного DROP чи TRUNCATE у жодному запиті',
    /DROP|TRUNCATE/i.test([totalSql(pr), branchCountSql(pr, open, AS_OF), deleteSql(pr, open, AS_OF)].join(' ')), false);
  t('🔴 мить «зараз» приймається лише як ISO UTC — не шлях для ін\'єкції',
    throws(() => asOfLiteral(`2026-10-30'; DROP TABLE x; --`), 'ISO UTC'), true);
  t('строк, який не є цілим > 0, відкидається',
    throws(() => ageClause({ name: 'x', since: 'created_at', months: 0 }, AS_OF), 'цілим > 0'), true);

  // ── читання відповіді ─────────────────────────────────────────────
  t('одне число читається', integer([['3']], 'x'), 3);
  t('🔴 ПОРОЖНЯ відповідь — це не нуль, це збій', throws(() => integer([], 'count'), 'читання не доведене'), true);
  t('🔴 два рядки замість одного — збій', throws(() => integer([['1'], ['2']], 'count'), 'замість одного'), true);
  t('🔴 порожній рядок замість числа — збій', throws(() => integer([['']], 'count'), 'ціле число'), true);
  t('не число — збій', throws(() => integer([['ERROR']], 'count'), 'ціле число'), true);

  // ── вирок: argv → SQL → код виходу, на підставному db ─────────────
  const fakeDb = (answers) => {
    const asked = [];
    const q = (sql) => {
      asked.push(sql);
      for (const [needle, rows] of answers) if (sql.includes(needle)) return typeof rows === 'function' ? rows() : rows;
      throw new Error(`підставна база не знає запиту: ${sql}`);
    };
    q.asked = asked;
    return q;
  };
  // Підставні бази нижче знають лише problem_reports — журнали перевіряє
  // окремий випадок далі, щоб кожна відповідь була названа, а не вгадана.
  const base = (db) => ({ now: NOW, log: silent, db, dbUrl: 'postgres://x', rules: [pr] });

  // жива таблиця, прострочених немає → 0, і видалення не питали
  const quiet = fakeDb([
    ['SELECT count(*) FROM problem_reports', [['5']]],
    ["FROM problem_reports WHERE status IN", [['3', '0']]],
    ["FROM problem_reports WHERE status = 'new'", [['2', '0']]],
  ]);
  t('прострочених немає → 0', runWith(new Set(), base(quiet)), 0);
  t('…і DELETE не надсилався', quiet.asked.some((s) => s.startsWith('DELETE')), false);
  const lines = [];
  runWith(new Set(), { ...base(quiet), log: { log: (s) => lines.push(s), error: () => {} } });
  t('🔴 журнал каже «перевірено 5», а не мовчить', lines.some((l) => l.includes('перевірено 5 рядків')), true);
  t('журнал каже «прострочених 0» явно', lines.some((l) => l.includes('прострочених 0')), true);

  // порожня, але жива таблиця — нормальний стан (сайт за паролем, заявок немає)
  const empty = fakeDb([
    ['SELECT count(*) FROM problem_reports', [['0']]],
    ['FROM problem_reports WHERE', [['0', '0']]],
  ]);
  t('порожня жива таблиця → 0 (перевірено 0, прострочених 0)', runWith(new Set(), base(empty)), 0);

  // 🔴 помилка бази → виняток, НЕ код виходу
  const broken = () => { throw new Error('connection refused'); };
  t('🔴 помилка бази — виняток, а не 0', throws(() => runWith(new Set(), base(broken)), 'connection refused'), true);
  t('🔴 порожня відповідь на count(*) — виняток, а не «прострочених 0»',
    throws(() => runWith(new Set(), base(fakeDb([['SELECT count(*)', []]]))), 'читання не доведене'), true);
  t('🔴 без DATABASE_URL — помилка вживання, а не «пропустити»',
    (() => { try { runWith(new Set(), { ...base(quiet), dbUrl: undefined }); return false; } catch (e) { return e instanceof UsageError; } })(), true);

  // прострочені є → DELETE за тією ж умовою, кількість звірена
  const counted = fakeDb([
    ['SELECT count(*) FROM problem_reports', [['3']]],
    ["FROM problem_reports WHERE status IN", [['1', '1']]],
    ["FROM problem_reports WHERE status = 'new'", [['2', '1']]],
    ["DELETE FROM problem_reports WHERE (status IN", [['a1', '2025-01-01']]],
    ["DELETE FROM problem_reports WHERE (status = 'new')", [['b2', '2024-06-01']]],
  ]);
  const out = [];
  t('прострочені видалені → 0', runWith(new Set(), { ...base(counted), log: { log: (s) => out.push(s), error: () => {} } }), 0);
  t('🔴 нерозглянута — з позначкою в журналі, з id і датою',
    out.some((l) => l.includes('позначка') && l.includes('b2') && l.includes('2024-06-01') && l.includes(open.mark)), true);
  t('закрита — без позначки', out.some((l) => l.includes('позначка') && l.includes('a1')), false);
  t('підсумок: видалено 2, з них нерозглянутих 1', out.some((l) => l.includes('видалено 2, з них нерозглянутих 1')), true);

  // 🔴 порахували 1, видалили 0 → 1
  const lied = fakeDb([
    ['SELECT count(*) FROM problem_reports', [['3']]],
    ["FROM problem_reports WHERE status IN", [['1', '1']]],
    ["FROM problem_reports WHERE status = 'new'", [['2', '0']]],
    ['DELETE FROM problem_reports', []],
  ]);
  t('🔴 порахували 1, видалили 0 — це збій, код 1', runWith(new Set(), base(lied)), 1);

  // 🔴 стан, якого не покриває жодна гілка → 1 і жодного DELETE
  const stranger = fakeDb([
    ['SELECT count(*) FROM problem_reports', [['4']]],
    ["FROM problem_reports WHERE status IN", [['1', '1']]],
    ["FROM problem_reports WHERE status = 'new'", [['2', '0']]],
    ['DELETE FROM problem_reports', [['a1', '2025-01-01']]],
  ]);
  t('🔴 рядок у стані без правила → код 1', runWith(new Set(), base(stranger)), 1);
  t('…і прострочене НЕ видалялось: умова не доведена', stranger.asked.some((s) => s.startsWith('DELETE')), false);

  // журнали: одна гілка TRUE покриває все; DELETE за тією ж умовою віку
  t('умова віку журналу: received_at < зараз − 3 місяці',
    ageClause(ce.branches[0], AS_OF), `(received_at) < '2026-10-30T04:00:00Z'::timestamptz - interval '3 months'`);
  t('підрахунок журналу — WHERE TRUE, тобто всі рядки в одній гілці',
    branchCountSql(ce, ce.branches[0], AS_OF).endsWith('FROM client_errors WHERE TRUE'), true);
  const logs = fakeDb([
    ['SELECT count(*) FROM client_errors', [['3']]],
    ['FROM client_errors WHERE TRUE', [['3', '1']]],
    ['DELETE FROM client_errors WHERE (TRUE) AND (received_at) <', [['c1', '2026-06-01']]],
    ['SELECT count(*) FROM not_found_hits', [['2']]],
    ['FROM not_found_hits WHERE TRUE', [['2', '2']]],
    ['DELETE FROM not_found_hits WHERE (TRUE) AND (created_at) <', [['n1', '2026-09-01'], ['n2', '2026-09-02']]],
  ]);
  const logLines = [];
  t('журнали: прострочене видалено, код 0',
    runWith(new Set(), { ...base(logs), rules: [ce, nf], log: { log: (s) => logLines.push(s), error: () => {} } }), 0);
  t('журнали: підсумок «таблиць 2, перевірено 5, прострочених 3, видалено 3»',
    logLines.some((l) => l.includes('таблиць 2, перевірено 5, прострочених 3, видалено 3')), true);
  t('журнали: позначок немає — вони лише для нерозглянутих заявок', logLines.some((l) => l.includes('позначка')), false);

  // --dry-run: рахує, не видаляє, код 0
  const dry = fakeDb([
    ['SELECT count(*) FROM problem_reports', [['3']]],
    ["FROM problem_reports WHERE status IN", [['1', '1']]],
    ["FROM problem_reports WHERE status = 'new'", [['2', '1']]],
  ]);
  t('--dry-run з простроченими → 0', runWith(new Set(['--dry-run']), base(dry)), 0);
  t('🔴 --dry-run не надсилає DELETE', dry.asked.some((s) => s.startsWith('DELETE')), false);

  // ── argv ──────────────────────────────────────────────────────────
  t('🔴 невідомий прапорець відкидається з переліком відомих',
    throws(() => chooseAction(['--dryrun'], KNOWN_FLAGS, 'x'), '--dry-run'), true);

  // ── юніт systemd ──────────────────────────────────────────────────
  // 🔴 ЮНІТ І СКРИПТ ЗВʼЯЗАНІ ТУТ, У CI (урок CAMP-399: юніт три тижні
  // передавав прапорець, якого скрипт не знав).
  const unit = readFileSync(path.join(ROOT, 'infra/systemd/camptribe-retention.service'), 'utf8');
  const exec = unit.match(/^ExecStart=.*retention-purge\.mjs(.*)$/m);
  const passed = exec ? exec[1].trim().split(/\s+/).filter(Boolean) : null;
  t('юніт systemd запускає саме цей скрипт', exec !== null, true);
  t('юніт передає лише прапорці, які скрипт знає', passed !== null && passed.every((a) => KNOWN_FLAGS.includes(a)), true);
  t('🔴 юніт НЕ сухий: без --dry-run, інакше таймер роками «рахував би»', passed !== null && !passed.includes('--dry-run'), true);
  t('🔴 падіння юніта піднімає лист (OnFailure, CAMP-306)', /^OnFailure=camptribe-failed@%n\.service$/m.test(unit), true);
  t('юніт читає DATABASE_URL з .env API', /^EnvironmentFile=\/srv\/camptribe\/current\/apps\/api\/\.env$/m.test(unit), true);
  const timer = readFileSync(path.join(ROOT, 'infra/systemd/camptribe-retention.timer'), 'utf8');
  t('таймер щодобовий і наздоганяє пропущене (Persistent)', /^OnCalendar=\*-\*-\* \d\d:\d\d:\d\d UTC$/m.test(timer) && /^Persistent=true$/m.test(timer), true);

  // 🔴 Лічильник стверджується, бо випадок, до якого не дійшло,
  // виглядає точно як випадок, що пройшов.
  t('🔴 лічильник: усі випадки дійшли до кінця', p + f, 56);
  console.log(`retention-purge self-test: ran ${p + f}, passed ${p}, failed ${f}`);
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
    flags = chooseAction(process.argv.slice(2), KNOWN_FLAGS, 'retention-purge.mjs');
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
  if (flags.has('--self-test')) process.exit(selfTest());
  try {
    process.exit(runWith(flags));
  } catch (e) {
    // 🔴 Лише помилка ВЖИВАННЯ глушиться в речення. База недоступна,
    // таблиці немає, psql немає — мусить вийти зі стеком (код 1), інакше
    // таймер перетворить аварію на тихе число.
    if (!(e instanceof UsageError)) throw e;
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
}
