#!/usr/bin/env node
// CAMP-151: «запит удався і повернув архів» — це теж збій.
//
//   node scripts/ci/check-feed-stall.mjs             # обходить 27 фідів
//   node scripts/ci/check-feed-stall.mjs --self-test # без мережі
//
// 🔴 РЕЖИМ ВІДМОВИ ТУТ НЕ «ЗАПИТ УПАВ». Це «200 OK, і всередині архів».
// Заміряно 13.10.2026 о 16:37 UTC, усі 27 фідів: **Австрія віддавала 34
// блоки, з них чинних нуль, а найсвіжіша публікація була за 119,5 години
// — пʼять діб.** Чехія: 14 блоків, 127,9 години. Франція: 66 блоків,
// 98,6 години.
//
// 🔴 І ЖОДЕН ІЗ ПʼЯТИ НАЯВНИХ СТОРОЖІВ ЦЬОГО НЕ БАЧИТЬ, бо всі вони
// судять про ПРОГІН, а не про країну:
//
//   silent            — ні, Австрія відповіла
//   quietCountries    — ні, `seen > 0`
//   blindCountries    — ні, рівні читабельні
//   yieldLooksBroken  — ні, союз загалом лишив багато
//   tooMuchMissing    — ні, 27 із 27 відповіли
//
// Протерміновані блоки відкидаються мовчки, тож така країна показується
// як нуль попереджень — не відрізнити від спокійної погоди.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';
import { COUNTRIES, dropReason, feedUrl } from '../meteoalarm/fetch-warnings.mjs';

const HOUR_MS = 3_600_000;

/**
 * Скільки годин країна може нічого не публікувати, доки це ще погода.
 *
 * 🔴 ЧИСЛО З ЗАМІРУ, А НЕ ЗІ СТЕЛІ, І ВИБІРКА НАЗВАНА: один зріз усіх 27
 * фідів, 13.10.2026 16:37 UTC. Розподіл «коли востаннє публікували»
 * розпався надвоє, і між половинами порожньо:
 *
 *   з чинними попередженнями   греція 2,7 … угорщина 16,6 год
 *   блоки є, чинних немає       бельгія 31,6 · польща 33,6 · португалія
 *                               56,1 · словенія 58,7 · франція 98,6 ·
 *                               австрія 119,5 · чехія 127,9
 *
 * 48 годин лежить у розриві: втричі вище за найгірший здоровий випадок
 * і нижче за весь явно архівний кластер. Бельгію й Польщу о 31–33
 * годинах воно НЕ підніме — свідомо, бо один зріз не доводить, що доба
 * мовчання це поломка.
 *
 * 🔴 ЦЕ ОДНЕ ЧИТАННЯ. Розрив широкий, але вибірка — один момент часу;
 * число перевірити повторним заміром, а не припущенням.
 */
export const SILENT_BUDGET_HOURS = 48;

/**
 * Що видно в одному фіді. `null` у `newestSentAt` — ніхто нічого не
 * надсилав, тобто фід порожній.
 *
 * 🔴 Чинність рахує `dropReason` ФЕТЧЕРА, не власна копія умови. Друга
 * думка про те, що таке «протерміноване», розійшлася б із першою тихо.
 */
export function observe(payload, now) {
  let seen = 0;
  let inForce = 0;
  let newestSentAt = null;
  for (const entry of payload?.warnings ?? []) {
    const sent = Date.parse(entry?.alert?.sent ?? '');
    if (Number.isFinite(sent) && (newestSentAt === null || sent > newestSentAt)) {
      newestSentAt = sent;
    }
    for (const info of entry?.alert?.info ?? []) {
      seen += 1;
      if (dropReason(entry.alert, info, now) === null) inForce += 1;
    }
  }
  return { seen, inForce, newestSentAt };
}

/**
 * Вирок по одній країні.
 *
 * 🔴 ЧОТИРИ СТАНИ, А НЕ ДВА. «Порожній фід» і «фід з архівом» —
 * протилежні діагнози: перший означає, що служба нічого не публікує,
 * другий — що вона, можливо, перестала публікувати, а старе лишила.
 * Звести їх до «немає попереджень» означало б втратити рівно той
 * випадок, заради якого написана картка.
 */
export function verdict({ country, obs, now, budgetHours = SILENT_BUDGET_HOURS }) {
  if (obs.seen === 0) {
    return { country, state: 'empty', silentHours: null };
  }
  const silentHours =
    obs.newestSentAt === null ? null : (now.getTime() - obs.newestSentAt) / HOUR_MS;
  if (obs.inForce > 0) {
    return { country, state: 'live', silentHours };
  }
  // 🔴 Блоки є, а часу публікації немає — це не «нещодавно», це
  // «невідомо». Невідоме не можна зарахувати на користь джерела.
  if (silentHours === null || silentHours > budgetHours) {
    return { country, state: 'stalled', silentHours };
  }
  return { country, state: 'calm', silentHours };
}

/** Чи є через що бити на сполох, і через що саме. */
export function alarm(verdicts) {
  const stalled = verdicts.filter((v) => v.state === 'stalled');
  return { raised: stalled.length > 0, stalled };
}

const hrs = (h) => (h === null ? 'невідомо' : `${h.toFixed(1)} год`);

async function run() {
  const now = new Date();
  const verdicts = [];
  for (const country of COUNTRIES) {
    try {
      const res = await fetch(feedUrl(country), { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        verdicts.push({ country, state: 'unreachable', silentHours: null, http: res.status });
        continue;
      }
      verdicts.push(verdict({ country, obs: observe(await res.json(), now), now }));
    } catch (e) {
      verdicts.push({ country, state: 'unreachable', silentHours: null, why: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  for (const v of [...verdicts].sort((a, b) => (b.silentHours ?? -1) - (a.silentHours ?? -1))) {
    console.log(`${v.country.padEnd(13)} ${v.state.padEnd(11)} остання публікація ${hrs(v.silentHours)}`);
  }

  const { raised, stalled } = alarm(verdicts);
  if (!raised) {
    console.log(`\n✓ жодна точка не віддає архів (бюджет ${SILENT_BUDGET_HOURS} год)`);
    return 0;
  }
  console.error(`\n✗ ЗАСТІЙ: ${stalled.length} точок віддають 200 без жодного чинного запису`);
  for (const v of stalled) {
    console.error(`  ${v.country}: нічого не публікувалось ${hrs(v.silentHours)}`);
  }

  // 🔴 ТІЛО ДЛЯ ЛЮДИНИ, А НЕ ЛИШЕ КОД ВИХОДУ. Воркфлоу читає це, щоб
  // відкрити ОДНЕ питання й оновлювати його, як це вже робить
  // `check-schedule.mjs`: чотири однакові питання на місяць вимикають,
  // а вимкнений сторож гірший за відсутній.
  //
  // 🔴 І ТУТ ЖЕ СКАЗАНО, ЧОГО ЦЕ НЕ ДОВОДИТЬ. Застій може бути чужим
  // збоєм, а може бути п'ятьма спокійними добами в одній країні. Текст
  // мусить назвати обидві можливості, інакше перший же хибний сигнал
  // навчить усіх не читати наступні.
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    const lines = stalled
      .map((v) => `* **${v.country}** — блоки віддаються, чинних нуль, остання публікація ${hrs(v.silentHours)} тому`)
      .join('\n');
    const body =
      `Ці точки відповіли HTTP 200 і не віддали жодного чинного запису. ` +
      `Бюджет мовчання — ${SILENT_BUDGET_HOURS} год.\n\n${lines}\n\n` +
      `Це НЕ доводить збій на їхньому боці: держава може просто не мати погоди. ` +
      `Що це доводить — що ми показуємо цим країнам «попереджень немає», ` +
      `спираючись на архів, і відрізнити одне від одного з нашого боку не можемо.`;
    appendFileSync(process.env.GITHUB_OUTPUT, `stalled=true\nbody<<CAMPEOF\n${body}\nCAMPEOF\n`);
  }
  return 1;
}

function selfTest() {
  const now = new Date('2026-10-13T16:37:00Z');
  const ago = (h) => new Date(now.getTime() - h * HOUR_MS).toISOString();
  const ahead = (h) => new Date(now.getTime() + h * HOUR_MS).toISOString();

  // 🔴 ФІКСТУРИ — ЦЕ ЗАМІР, А НЕ ВИГАДКА. Числа взяті з обходу всіх 27
  // фідів 13.10.2026 16:37 UTC, і кожна країна тут справді так
  // виглядала.
  //
  // 🔴 БЛОК МУСИТЬ БУТИ ПОВНИЙ, бо чинність судить `dropReason`
  // ФЕТЧЕРА, а він вимагає більшого за `expires`: рівень обізнаності
  // вище першого (1 — зелений, тобто відсутність попередження) і хоч
  // якийсь `event`/`headline`. Перша версія фікстури мала лише
  // `expires` — і три випадки впали, бо фетчерове означення суворіше
  // за моє. Саме тому воно й узяте його, а не переписане тут.
  const block = (sentHoursAgo, expiresIn) => ({
    alert: {
      sent: ago(sentHoursAgo),
      info: [
        {
          expires: expiresIn === null ? ago(1) : ahead(expiresIn),
          event: 'Wind',
          parameter: [{ valueName: 'awareness_level', value: '2; yellow; Moderate' }],
        },
      ],
    },
  });
  const feed = (blocks) => ({ warnings: blocks });

  const cases = [];
  const is = (name, got, want) => {
    cases.push(name);
    if (got !== want) {
      console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      return 1;
    }
    return 0;
  };
  let rc = 0;
  const stateOf = (blocks, budgetHours = SILENT_BUDGET_HOURS) =>
    verdict({ country: 'x', obs: observe(feed(blocks), now), now, budgetHours }).state;

  // Австрія, як вона була: 34 блоки, чинних нуль, публікація 119,5 год.
  rc |= is('австрія 119,5 год без публікацій — застій',
    stateOf(Array.from({ length: 34 }, () => block(119.5, null))), 'stalled');
  // Чехія, 127,9 год.
  rc |= is('чехія 127,9 год — застій',
    stateOf(Array.from({ length: 14 }, () => block(127.9, null))), 'stalled');
  // Бельгія, 31,6 год: під бюджетом, тож це ще погода.
  rc |= is('бельгія 31,6 год — ще не застій',
    stateOf(Array.from({ length: 144 }, () => block(31.6, null))), 'calm');
  // Греція: 150 чинних із 264, публікація 2,7 год.
  rc |= is('греція з чинними — жива',
    stateOf([block(2.7, 6), block(2.7, null)]), 'live');
  // 🔴 Жива навіть тоді, коли публікація СТАРА: чинне попередження на
  // 72 години вперед — це не архів. Ірландія мала 4 чинних при
  // найсвіжішому протермінуванні 107,6 год.
  rc |= is('старе, але ще чинне — жива',
    stateOf([block(200, 6)]), 'live');
  // Люксембург, Мальта, Словаччина: порожній фід — інший діагноз.
  rc |= is('порожній фід — не застій, а порожньо', stateOf([]), 'empty');
  // 🔴 Блоки є, а `sent` нечитабельний: невідоме не зараховується на
  // користь джерела.
  rc |= is('блоки без читабельного sent — застій',
    verdict({ country: 'x', obs: { seen: 5, inForce: 0, newestSentAt: null }, now }).state,
    'stalled');
  // Межа бюджету з обох боків.
  rc |= is('рівно на бюджеті — ще не застій', stateOf([block(48, null)], 48), 'calm');
  rc |= is('на годину за бюджетом — застій', stateOf([block(49, null)], 48), 'stalled');

  // observe() рахує те, що рахує фетчер.
  const obs = observe(feed([block(2, 6), block(3, null)]), now);
  rc |= is('observe: бачить обидва блоки', obs.seen, 2);
  rc |= is('observe: чинний один', obs.inForce, 1);
  rc |= is('observe: найсвіжіша публікація — 2 год', obs.newestSentAt, Date.parse(ago(2)));

  // 🔴 Тривога мусить НАЗИВАТИ країни, а не лише казати «щось не так».
  const raised = alarm([
    verdict({ country: 'austria', obs: observe(feed([block(119.5, null)]), now), now }),
    verdict({ country: 'greece', obs: observe(feed([block(2.7, 6)]), now), now }),
  ]);
  rc |= is('тривога піднята', raised.raised, true);
  rc |= is('тривога називає саме австрію', raised.stalled.map((v) => v.country).join(','), 'austria');
  rc |= is('жодного застою — тиша', alarm([{ country: 'greece', state: 'live' }]).raised, false);

  const EXPECTED_CASES = 15;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-feed-stall self-test: ${cases.length} випадків`);
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

// 🔴 `chooseAction`, а не `argv.includes`: `--selftest`, одна літера
// різниці, провалився б у бойову гілку, обійшов усі 27 фідів і вийшов
// нулем, а крок із назвою «самотест» був би зелений. Цим уже один раз
// проїхались по чотирьох скриптах (CAMP-285).
//
// Порівняння нижче написане дослівно, бо check-script-entrypoints.mjs
// впізнає сторож, ЧИТАЮЧИ його; за помічником це вже не сторож.
if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-feed-stall.mjs');
  process.exit(action.has('--self-test') ? selfTest() : await run());
}
