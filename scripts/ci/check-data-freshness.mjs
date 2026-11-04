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
    // 🔴 Прийняття ГРУПИ має той самий строк і ту саму смерть. Прострочене
    // прийняття червоніє САМО, навіть якщо решта таблиці свіжа: інакше
    // «до 01.12» означало б «назавжди, якщо більше нічого не зламається».
    for (const [group, a] of Object.entries(s.acceptedGroups ?? {})) {
      if (now >= Date.parse(a.until)) {
        say(s, 'accepted-expired',
          `прийняття протухлості «${group}» скінчилось ${a.until} — причина мусить бути переглянута`);
      }
    }
    // 🔴 «НІКОЛИ» І «ДАВНО» — РІЗНІ ВІДПОВІДІ, і плутати їх не можна.
    // Порожня таблиця — імпортера не налаштували; стара — він зупинився.
    // Перше лагодить людина один раз, друге — повторний запуск.
    if (s.rows === 0) {
      // 🔴 «НІКОЛИ НЕ ЗАПУСКАВСЯ» І «ЗАПУСКАВСЯ Й НІЧОГО НЕ ПРИНІС» —
      // ТЕЖ РІЗНІ ВІДПОВІДІ, і друга досі читалась як перша.
      //
      // Заміряно на проді 03.11.2026 (CAMP-439). `camptribe-air-quality`
      // відпрацював уперше: 4019 станцій записано, ✓ committed. Але
      // модельний растр EEA стоїть із 28.10, збирач його не оновив — і
      // `air_quality_modelled` лишилась порожньою. Сторож сказав
      // «імпортер не запускався жодного разу» й НЕ подзвонив, хоч
      // імпортер запускався чверть години тому.
      //
      // Тобто єдине, що про растр дзвонило, — падіння самого збирача.
      // Прибрати те падіння (а воно дзвонить двічі на добу про шестиденну
      // зупинку в EEA) означало б лишити растр без нагляду взагалі.
      //
      // `provenBy` називає СУСІДНЄ джерело того самого імпортера. Є в
      // сусіда рядки — імпортер живий, і порожнеча тут це зупинка.
      // 🔴 ДОКАЗ ЗАПУСКУ ВИВОДИТЬСЯ З `unit`, А НЕ З ДРУГОГО ПЕРЕЛІКУ.
      //
      // Спершу я написав тут `provenBy: '<імʼя сусіднього джерела>'` —
      // і це був другий перелік того, що поле `unit` уже каже. Два
      // переліки не звіряються, вони розходяться: досить перейменувати
      // джерело, і доказ тихо зникає, а сторож мовчки вертається до
      // старої сліпоти. Рівно за це я критикував `camptribe-infra-drift`
      // у тому ж вечорі.
      //
      // Тепер сусіди знаходяться за `unit`: хто приносить ці дані, те
      // поле вже називає, і воно одне.
      if (s.emptyIsStopWhenUnitRan) {
        if (!s.unit) {
          say(s, 'bad-config',
            'emptyIsStopWhenUnitRan без `unit` — немає за чим шукати сусіда, ' +
              'отже порожнеча тут недоведена');
          continue;
        }
        const siblings = sources.filter((x) => x !== s && x.unit === s.unit);
        if (siblings.length === 0) {
          say(s, 'bad-config',
            `у юніта «${s.unit}» немає інших джерел — доказ запуску недосяжний`);
          continue;
        }
        const alive = siblings.find((x) => x.rows > 0);
        if (alive) {
          say(s, 'empty-though-ran',
            `таблиця порожня, хоч «${alive.name}» має ${alive.rows} — ` +
              `той самий юніт (${s.unit}) запускався, отже це ЗУПИНКА, а не «ще не налаштовано»`);
          continue;
        }
      }
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
 * 🔴 ТРИ ІЗ ДЕВʼЯТИ ІМПОРТЕРІВ МАЮТЬ РОЗКЛАД В РЕПОЗИТОРІЇ (з 28.10.2026 два,
 * з CAMP-113 три): `camptribe-osm-import.timer` (camping_spots),
 * `camptribe-route-poi-import.timer` (osm_route_poi) і
 * `camptribe-fuel-prices.timer` (fuel_station_prices). Решту запускає людина
 * (`osm-weekly.yml` лише публікує екстракт і ДРУКУЄ команду імпорту;
 * `air/import.ts` каже прямо «the refresh is not scheduled»). Тому для
 * шістьох «застарів» означає «людина не запустила», а не «cron упав», і
 * адресат тривоги — людина.
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
    table: 'camping_spots', column: 'last_seen_at', budgetHours: 10 * 24,
    unit: 'camptribe-osm-import' },
  { name: 'osm_route_poi (POI маршрутів)', card: 'CAMP-113',
    table: 'osm_route_poi', column: 'last_seen_at', budgetHours: 10 * 24,
    unit: 'camptribe-route-poi-import' },
  // 🔴 `groupBy: 'source'` — вік таблиці це вік НАЙСТАРІШОГО з трьох
  // джерел, а не найсвіжішого. Імпортер пише кожне джерело окремо й не
  // падає, коли одне недосяжне (28.10.2026 mimit.gov.it не відповідав з
  // прода): Іспанія й Франція оновились, Італія стоїть на 13.10. З
  // `max(fetched_at)` по всій таблиці це читалось би «свіже» — і рівно
  // тоді, коли таймер перестав бити тривогу сам, сторож перестав би
  // бачити застарілу країну.
  { name: 'fuel_station_prices (ціни станцій ES/FR/IT)', card: 'CAMP-154',
    table: 'fuel_station_prices', column: 'fetched_at', budgetHours: 2 * 24,
    groupBy: 'source',
    // 🔴 ПРИЙНЯТО ЗІ СТРОКОМ, І ЦЕ НЕ НАШ ЗБІЙ. Заміряно 02.11.2026:
    // `www.mimit.gov.it` не відповідає зовсім — ані CSV, ані корінь сайту,
    // ані з ноутбука (Бельгія), ані з нашої машини (Hetzner, Німеччина):
    // `curl --max-time 60` → код 000, зʼєднання не встановлюється. Імʼя
    // резолвиться, отже це не перенесення адреси; саму адресу тут не
    // пишемо — сторож публічних адрес веде облік НАШОЇ інфраструктури, і
    // чужий IP у ньому лише послабив би його. Те саме бачать
    // сторонні: issue в `bbarrionuevo/strumentiutili.it` каже, що останнє
    // оновлення даних — 15.10.2026, і запит із серверів GitHub теж падає
    // в таймаут. Наш найсвіжіший рядок — 13.10.2026.
    //
    // Італію приймаємо до 01.12.2026; Іспанія і Франція далі під повним
    // бюджетом у дві доби. Після цієї дати сторож почервоніє САМ і
    // вимагатиме рішення: чекати далі, брати дзеркало (інша ланка
    // походження — питання ліцензії й атрибуції, отже рішення власника)
    // чи прибрати італійські станції зі сторінок.
    acceptedGroups: {
      'it-mimit': {
        until: '2026-12-01',
        why: 'www.mimit.gov.it недосяжний із двох незалежних мереж із ~13.10.2026; DNS живий, адреса не змінювалась; те саме повідомляють сторонні проєкти',
      },
    },
    unit: 'camptribe-fuel-prices' },
  { name: 'spot_tariffs (тарифи DATAtourisme)', card: 'CAMP-147',
    table: 'spot_tariffs', column: 'created_at', budgetHours: 10 * 24,
    unit: null,
    manual: 'ланцюг DATAtourisme (809,7 МБ за 14 с) доведено на машині, але юніта немає — CAMP-400, пункт 2' },
  { name: 'spot_links (звʼязки OSM↔DATAtourisme)', card: 'CAMP-144',
    table: 'spot_links', column: 'created_at', budgetHours: 10 * 24,
    unit: 'camptribe-reconcile-sources' },
  { name: 'webcams (камери Windy)', card: 'CAMP-190',
    table: 'webcams', column: 'fetched_at', budgetHours: 10 * 24,
    unit: null,
    manual: 'збирач Windy запускається руками; юніта немає — CAMP-400, пункт 2' },
  { name: 'bathing_waters (купання EEA)', card: 'CAMP-168',
    table: 'bathing_waters', column: 'created_at',
    budgetHours: () => budgetFromSource('apps/web/src/lib/sources.ts', 'ANNUAL_HEALTHY_DAYS') * 24,
    unit: 'camptribe-bathing-waters' },
  { name: 'air_quality_stations (повітря EEA, станції)', card: 'CAMP-164',
    table: 'air_quality_stations', column: 'read_at',
    budgetHours: () => budgetFromSource('apps/web/src/lib/air-quality.ts', 'AIR_FRESH_FOR_HOURS'),
    unit: 'camptribe-air-quality' },
  { name: 'air_quality_modelled (повітря EEA, модель)', card: 'CAMP-439',
    table: 'air_quality_modelled', column: 'read_at',
    // Той самий `unit`, що в станцій: живі станції доводять, що юніт
    // запускався, а порожній растр при них — зупинка (CAMP-439).
    emptyIsStopWhenUnitRan: true,
    // 🔴 ПРИЙНЯТТЯ ЗІ СТРОКОМ, СХВАЛЕНЕ ВЛАСНИКОМ 04.11.2026.
    //
    // Зупинка доведена й НЕ наша. Заміряно того дня, з контролем:
    //
    //   AQMobile_2025/MOSAIC_GLOBAL_AQI    25.10 → 28.10 12:00  ← наш
    //   AQMobile/MOSAIC_PM25_CONCENTRATION 24.10 → 27.10 23:00
    //   AQMobile/MOSAIC_NO2_CONCENTRATION  24.10 → 27.10 23:00
    //   AQMobile/MOSAIC_O3_CONCENTRATION   24.10 → 27.10 23:00
    //
    // Контроль вирішальний: недатовані сервіси зупинились ТОДІ Ж. Якби
    // ми дивились у застарілу «торішню» адресу, вони були б свіжі. Плюс
    // станції (4019, щодня) приходять зі сховища Azure, не з ArcGIS, і
    // працюють — отже наш канал справний. Офіційного повідомлення про
    // припинення AQMobile немає ні в документації, ні на порталі EEA.
    //
    // Ціна мовчання названа: до 01.12 про цей растр не дзвонимо, і це
    // коштує нам того, що новий дефект У ЦЬОМУ джерелі ми в той час не
    // побачимо. Прийнятно, бо показувати там нічого й так: таблиця
    // порожня від народження, а не протухла.
    //
    // 01.12 тривога повертається САМА й голосніше: прострочене прийняття
    // червоніє окремим випадком, навіть якщо все інше свіже. Забути
    // неможливо — у цьому й сенс строку.
    acceptedUntil: '2026-12-01',
    budgetHours: () => budgetFromSource('apps/web/src/lib/air-quality.ts', 'AIR_FRESH_FOR_HOURS'),
    unit: 'camptribe-air-quality' },
]);

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/**
 * Один запит на таблицю: скільки рядків і найновіша мітка, у UTC ISO.
 *
 * З `groupBy` — найновіша мітка КОЖНОЇ групи, і береться найстаріша з них:
 * таблиця стара рівно настільки, наскільки стара її найзапущеніша частина.
 * Порожня таблиця дає 0 рядків і NULL, як і без `groupBy`.
 *
 * 🔴 ТРЕТЄ ПОЛЕ — ІМ'Я ВИННОЇ ГРУПИ, І ВОНО НЕ ПРИКРАСА.
 *
 * Заміряно на проді 02.11.2026. Лист сторожа щоранку писав:
 *
 *   ✗ fuel_station_prices (ціни станцій ES/FR/IT)  79910 рядків  19.8 діб
 *
 * А в базі було так: `es-minetur` 22 063 рядки оновлені ТОГО Ж ДНЯ,
 * `fr-data-economie` 15 799 теж того дня, і лише `it-mimit` 42 048 стояв
 * на 13.10 — мертвий фід. Тобто дві країни з трьох свіжі, а лист звинувачує
 * таблицю цілком і не каже, яку саме країну чинити.
 *
 * Напрямок виміру правильний (найстаріша група, а не найновіша — інакше
 * жива Іспанія прикривала б мертву Італію). Хибне було ПОВІДОМЛЕННЯ: число
 * рядків береться з усієї таблиці, вік — з найгіршої групи, а ім'я групи
 * не друкувалось ніде. Сторож, який щодня червоніє без адреси, навчає
 * читача пропускати свої листи — і того дня, коли він почервоніє по
 * справжній причині, лист відкриють так само неуважно.
 *
 * 🔴 `k ASC` у впорядкуванні — не оздоба. Дві групи того самого віку без
 * нього давали б довільну з двох, і лист щоранку називав би то Іспанію,
 * то Францію без жодної зміни в даних. Сторож, чиє повідомлення гуляє
 * саме по собі, вчить не вірити його словам.
 *
 * 🔴 `NULLS LAST`, а не `NULLS FIRST` — зауваження рецензії, і воно слушне.
 * `min(m)` мітки NULL ПРОПУСКАЄ. З `NULLS FIRST` упорядкування робило б
 * навпаки: назвало б групу, у якої мітка NULL, тоді як дата в тому ж
 * рядку показувала б найстарішу СЕРЕД НЕПОРОЖНІХ. Ім'я й дата розійшлись
 * би, і рядок звіту став би внутрішньо суперечливим — найгірший стан для
 * сторожа, бо виглядає він при цьому цілком здоровим.
 * `NULLS LAST` ставить ім'я під те саме правило, що й дату.
 */
/**
 * Групи, чия протухлість ПРИЙНЯТА і строк прийняття ще не минув.
 *
 * 🔴 ЧОМУ ГРУПА, А НЕ ДЖЕРЕЛО ЦІЛКОМ. `acceptedUntil` приймає всю таблицю,
 * і для `fuel_station_prices` це було б запобіжником, ширшим за дефект:
 * мертва Італія замовкла б разом із живими Іспанією і Францією, і день,
 * коли зупиниться Іспанія, минув би тихо. Приймається рівно та група, яка
 * справді лежить, — решта таблиці стережеться як раніше.
 */
export function liveAcceptedGroups(s, now) {
  const all = s.acceptedGroups ?? {};
  return Object.keys(all).filter((k) => now < Date.parse(all[k].until));
}

/**
 * Прийняту групу прибирає САМ ЗАПИТ, а не фільтр після нього.
 *
 * Інакше «найстаріша з груп» лишалась би Італією, і вік таблиці далі
 * рахувався б по ній: ми прийняли б скаргу, не прийнявши число, на якому
 * вона стоїть.
 */
const groupFilter = (s, now) => {
  const live = liveAcceptedGroups(s, now);
  if (live.length === 0) return '';
  for (const k of live) {
    // Імена груп — наші константи, не ввід читача. Але запит збирається
    // рядком, і єдиний спосіб, яким це колись перестане бути правдою, —
    // необережна правка конфігу. Тому не екранування, а відмова.
    if (!/^[a-z0-9_-]+$/i.test(k)) throw new Error(`acceptedGroups: «${k}» не схоже на ім'я джерела`);
  }
  return ` WHERE (${s.groupBy})::text NOT IN (${live.map((k) => `'${k}'`).join(', ')})`;
};

export const probeSql = (s, now = Date.now()) =>
  s.groupBy
    ? `WITH g AS (SELECT max(${s.column}) AS m, (${s.groupBy})::text AS k ` +
      `FROM ${s.table}${groupFilter(s, now)} GROUP BY ${s.groupBy}) ` +
      `SELECT (SELECT count(*) FROM ${s.table}), ` +
      `to_char((SELECT min(m) FROM g) AT TIME ZONE 'UTC', ${ISO}), ` +
      `(SELECT k FROM g ORDER BY m ASC NULLS LAST, k ASC LIMIT 1)`
    : `SELECT count(*), to_char(max(${s.column}) AT TIME ZONE 'UTC', ${ISO}) FROM ${s.table}`;

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
    const [n, t, k] = out.split('|');
    return {
      rows: Number(n),
      stamp: t === undefined || t === '' ? null : t,
      // Порожнє поле — не група: так виглядає таблиця без `groupBy` і
      // порожня таблиця з ним. `null` тут чесніший за порожній рядок.
      oldestGroup: k === undefined || k === '' ? null : k,
    };
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
    // 🔴 Прийняту групу ВИДНО В КОЖНОМУ ЗВІТІ, і разом із датою. Прийняття,
    // якого не видно, — це не прийняття, а тиша: рядок стає зеленим, і
    // ніхто не згадає, що за ним стоїть мертве джерело.
    const accepted = liveAcceptedGroups(s, now);
    const held = accepted.length
      ? `  (прийнято до ${accepted.map((k) => `${k} → ${s.acceptedGroups[k].until}`).join(', ')})`
      : '';
    const rows = s.rows === undefined ? '' : `${String(s.rows).padStart(9)} рядків  `;
    // Ім'я винної групи дописуємо лише там, де воно є і де є на що
    // скаржитись: у зеленому рядку «найстаріша з груп» нікого не викриває.
    const who = p && s.oldestGroup ? `  ← найстаріше джерело: ${s.oldestGroup}` : '';
    log.log(`  ${mark} ${s.name.padEnd(46)} ${rows}${detail}${who}${held}`);
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

  // ── CAMP-439: порожня таблиця живого імпортера ───────────────────
  //
  // Справжній стан проду 03.11.2026: станції 4019, растр 0, один юніт.
  const STATIONS = { name: 'станції', rows: 4019, stamp: ok(0), budgetHours: 4,
                     unit: 'camptribe-air-quality' };
  const RASTER = { name: 'растр', rows: 0, stamp: null, budgetHours: 4,
                   unit: 'camptribe-air-quality', emptyIsStopWhenUnitRan: true };
  t('🔴 порожня при живому сусіді — ЗУПИНКА, а не «не запускався»',
    audit([STATIONS, RASTER], NOW).find((p) => p.name === 'растр')?.kind,
    'empty-though-ran');
  t('🔴 і вона ДЗВОНИТЬ у режимі таймера',
    ringing(audit([STATIONS, RASTER], NOW), 'stale').filter((p) => p.name === 'растр').length, 1);
  // 🔴 ЗВОРОТНА МУТАЦІЯ: правка мусить лишити корисне правило живим.
  // Справді нове джерело — обидві таблиці порожні — далі мовчить.
  t('🔴 обидві порожні — це досі «не запускався», і воно мовчить',
    audit([{ ...STATIONS, rows: 0, stamp: null }, RASTER], NOW)
      .find((p) => p.name === 'растр')?.kind, 'never');
  t('і тоді таймер справді мовчить про обидва',
    ringing(audit([{ ...STATIONS, rows: 0, stamp: null }, RASTER], NOW), 'stale').length, 0);
  t('🔴 прапорець без `unit` — збій, а не тиха стара поведінка',
    kind({ name: 'a', rows: 0, stamp: null, budgetHours: 4, emptyIsStopWhenUnitRan: true }),
    'bad-config');
  t('🔴 юніт-одинак — теж збій: доказу запуску взяти нізвідки',
    kind({ name: 'a', rows: 0, stamp: null, budgetHours: 4,
           unit: 'самотній', emptyIsStopWhenUnitRan: true }), 'bad-config');
  t('джерело без прапорця поводиться як раніше',
    kind({ name: 'a', rows: 0, stamp: null, budgetHours: 4, unit: 'u' }), 'never');
  // 🔴 Сусіда шукаємо за `unit`, а не за будь-якими рядками поруч.
  // Тут є і свій сусід (порожній), і чужий юніт із 99 рядками: чужі
  // рядки доказом бути не мусять, тож вирок — «never».
  t('🔴 рядки ЧУЖОГО юніта доказом не є',
    audit([{ ...STATIONS, rows: 0, stamp: null },
           { name: 'інший', rows: 99, stamp: ok(0), budgetHours: 4, unit: 'хтось-інший' },
           RASTER], NOW).find((p) => p.name === 'растр')?.kind, 'never');
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
  // 🔴 РЯДОК ЗАПИТУ — ЦЕ ЛИШЕ РЯДОК. Що саме він повертає (вік найстарішого
  // джерела, а не найновішого рядка) доводиться на справжній таблиці в
  // `apps/api/src/fuel/freshness-probe.db.spec.ts`, який бере цей запит із
  // цього файлу, а не копіює.
  const grouped = probeSql({ table: 'tt', column: 'cc', groupBy: 'g' });
  t('🔴 запит із groupBy бере найстарішу з найновіших міток груп',
    grouped.includes('min(m)') && grouped.includes('max(cc) AS m') && grouped.includes('GROUP BY g'), true);
  // 🔴 Без третього поля лист знову звинувачуватиме таблицю цілком.
  //
  // ⚠️ МЕЖА ЦЬОГО СТОРОЖА, названа рецензією і названа тут навмисно.
  // Детермінованість (`k ASC`) стережеться лише ТЕКСТОМ запиту, а не
  // поведінкою: прибравши `, k ASC` тільки з запиту, тест на справжній
  // базі лишився зеленим 4 прогони з 4 — Postgres випадково повертав ту
  // саму групу. Нав'язати йому інший порядок при однакових мітках ми не
  // можемо, тож поведінкового доказу тут не буде в принципі.
  // Текстова перевірка — це стеля, а не лінощі; хто її послабить,
  // лишить проєкт зовсім без сторожа на цю властивість.
  t('🔴 запит із groupBy повертає ІМʼЯ найстарішої групи, впорядкованої за віком',
    grouped.includes('(g)::text AS k') && grouped.includes('ORDER BY m ASC NULLS LAST, k ASC LIMIT 1'), true);
  t('🔴 рядків рахуємо по ВСІЙ таблиці, а не по найстарішій групі',
    grouped.includes('(SELECT count(*) FROM tt)'), true);
  t('🔴 ціни пального читаються по джерелах — інакше мертва Італія ховається за живою Іспанією',
    DB_SOURCES.find((x) => x.table === 'fuel_station_prices')?.groupBy, 'source');
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

  // ── прийняття ОКРЕМОЇ ГРУПИ: строк, видимість і межа ──
  //
  // 🔴 Прийнято має бути рівно те, що лежить. Запобіжник, ширший за
  // дефект, коштує дорожче за дефект: приймаючи всю таблицю заради
  // мертвої Італії, ми не почули б і зупинку Іспанії.
  const AGROUP = {
    table: 'tt', column: 'cc', groupBy: 'g', budgetHours: 48,
    acceptedGroups: { 'it-mimit': { until: '2026-12-01', why: 'джерело недосяжне ззовні, заміряно з двох мереж' } },
  };
  const BEFORE = Date.parse('2026-11-02T00:00:00Z');
  const AFTER = Date.parse('2026-12-02T00:00:00Z');
  t('🔴 поки прийняття живе — група виходить із ЗАПИТУ, а не фільтрується після',
    probeSql(AGROUP, BEFORE).includes("FROM tt WHERE (g)::text NOT IN ('it-mimit') GROUP BY g"), true);
  t('🔴 строк минув — група повертається в запит сама, без правки коду',
    probeSql(AGROUP, AFTER).includes('NOT IN'), false);
  t('🔴 рядки рахуються по ВСІЙ таблиці навіть із прийнятою групою — знаменник не звужується',
    probeSql(AGROUP, BEFORE).includes('(SELECT count(*) FROM tt)'), true);
  t('🔴 прострочене прийняття групи червоніє САМЕ, навіть коли решта таблиці свіжа',
    audit([{ ...AGROUP, name: 'x', rows: 10, stamp: new Date(AFTER - 3600e3).toISOString() }], AFTER)
      .some((x) => x.kind === 'accepted-expired' && x.text.includes('it-mimit')), true);
  t('поки строк не минув — прийнята група не піднімає скарги',
    audit([{ ...AGROUP, name: 'x', rows: 10, stamp: new Date(BEFORE - 3600e3).toISOString() }], BEFORE).length, 0);
  t('🔴 решта таблиці стережеться як раніше: протухле НЕприйняте джерело дзвонить',
    audit([{ ...AGROUP, name: 'x', rows: 10, stamp: new Date(BEFORE - 100 * 3600e3).toISOString() }], BEFORE)
      .some((x) => x.kind === 'stale'), true);
  // 🔴 ПРИЙНЯТТЯ, ЯКОГО НЕ ВИДНО, — ЦЕ ТИША, А НЕ ПРИЙНЯТТЯ. Рядок стає
  // зеленим, і через місяць ніхто не згадає, що за ним мертве джерело.
  // Тому звіт мусить називати і групу, і дату, у КОЖНОМУ прогоні.
  t('🔴 звіт називає прийняту групу і дату — у зеленому рядку теж', (() => {
    const lines = [];
    const spy = { log: (x) => lines.push(String(x)), error: (x) => lines.push(String(x)) };
    runWith(new Set(['--db', '--stale-only']), {
      now: NOW, log: spy, files, dbUrl: 'postgres://x',
      readDb: () => ({ rows: 5, stamp: ok(1) }),
    });
    const row = lines.find((l) => l.includes('fuel_station_prices'));
    return Boolean(row && row.includes('прийнято до') && row.includes('it-mimit') && row.includes('2026-12-01'));
  })(), true);
  t("🔴 імʼя групи, не схоже на імʼя джерела, — відмова, а не екранування",
    (() => {
      try {
        probeSql({ ...AGROUP, acceptedGroups: { "it'--": { until: '2026-12-01', why: 'x' } } }, BEFORE);
        return false;
      } catch {
        return true;
      }
    })(), true);

  // 🔴 Лічильник стверджується, бо випадок, до якого не дійшло,
  // виглядає точно як випадок, що пройшов.
  t('🔴 лічильник: усі випадки дійшли до кінця', p + f, 49);
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
