#!/usr/bin/env node
// CAMP-287 крок 1: заповнити `camping_spots.warning_areas`.
//
//   node scripts/meteoalarm/resolve-campsite-zones.mjs [--self-test] [--apply]
//
// Без `--apply` НІЧОГО не пише: рахує покриття й друкує його. Писати
// просять окремо, бо `UPDATE` по 57 тисячах рядків не має ставатися
// тому, що хтось хотів подивитись число.
//
// 🔴 ЦЕ НЕ МОЖНА ЗАПУСКАТИ З GITHUB ACTIONS, і картка цього не знала.
// CAMP-287 каже «запускати разом із `warning-geography.yml`, який уже
// щотижневий». Той воркфлоу живе в Actions, а колонка — у продакшн-базі
// на нашому сервері, куди в Actions доступу немає й не повинно бути.
// Тож місце цього скрипта — таймер systemd поруч із нічною збіркою, а в
// Actions лишається те, що там і було: вимірювання покриття.
//
// 🔴 ЩО САМЕ ПИШЕМО, вирішує перепис у `zone-coverage.mjs`, не цей
// файл. Франція лежить у полігонах MeteoAlarm на 97.5% і попереджає в
// NUTS3; EMMA-код на французькому рядку не збігся б ніколи. Тому
// з'єднання йде ПАРАМИ «країна × схема, яку вона вживає».

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { SCHEMES_USED, USED_SOURCES, rowsFrom, usesPairs, verdict } from './zone-coverage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';
const STAGING = 'warning_zones_staging';

/** Живих рядків, які після запису лишились NULL. Мусить бути нуль. */
export const NO_NULLS_SQL =
  'SELECT count(*) FROM camping_spots ' +
  'WHERE missing_since IS NULL AND location IS NOT NULL AND warning_areas IS NULL';

/** `('AT','EMMA_ID'),('BE','EMMA_ID'),…` — the join, from the census. */
export function pairsValues(schemes = SCHEMES_USED) {
  return usesPairs(schemes)
    .map(([country, scheme]) => `('${country}','${scheme}')`)
    .join(',');
}

/**
 * What a campsite's codes are, as SQL.
 *
 * 🔴 ОДИН ЗАПИТ ЖИВЕ В ОДНІЙ КОНСТАНТІ, і самотест імпортує САМЕ ЦЮ.
 * Репетиція, що пише власний `SELECT`, перевіряє свій запит, а не той,
 * що поїде в продакшн — у нас це вже коштувало семи зелених галочок над
 * зламаним станом.
 *
 * `LEFT JOIN` і `coalesce(..., '{}')`: кемпінг, під яким не знайшлося
 * жодної зони, дістає ПОРОЖНІЙ масив, а не NULL. NULL означає «резолвер
 * сюди не дійшов», `{}` — «дійшов і там нічого». Панель каже про них
 * різне, тож злити їх в одне означало б перетворити дірку в конвеєрі на
 * твердження про погоду.
 */
// 🔴 ЗОНА СУСІДНЬОЇ КРАЇНИ — ЦЕ НЕ ПОМИЛКА, І ЦЕ ЗАМІРЯНО.
//
// З'єднання бере схеми, які вживає країна КЕМПІНГА, але не питає, чиєю
// є сама зона. Заміряно після першого запису 13.10.2026 за властивістю
// `country` самого джерела: з 30 411 кодів EMMA **246 (0.8%)** належать
// зоні іншої країни — DE↔NL, NL→BE, PL→DE, BE→FR, AT→DE, GR→MK.
//
// Лишаємо навмисно. Кемпінг за 300 метрів від кордону справді лежить
// усередині сусідської зони, і попередження, видане для неї, його таки
// накриває — погода кордону не знає.
//
// 🔴 СПЕРШУ Я НАПИСАВ ТУТ 338, І ЦЕ БУЛО ЧИСЛО ІНШОГО ЗАМІРУ. Його дала
// евристика «перші дві літери коду — це країна», і 92 з тих 338 були
// ірландські зони з префіксом `EI…` при `country: IE` — тобто ВСЕРЕДИНІ
// числа, а не поза ним, як стверджував цей самий коментар. 338 − 92 =
// 246, і правильне число те, що з властивості `country`, бо саме її
// коментар і приписує вживати. Префікс коду не є кодом країни.
//
// Зони країн, чиїх фідів ми не тягнемо (`MK`), інертні: код лежить,
// збігтися йому нема з чим.
export function codesSelect(schemes = SCHEMES_USED) {
  return `
    SELECT s.id,
           coalesce(array_agg(DISTINCT z.scheme || ':' || z.code)
                      FILTER (WHERE z.code IS NOT NULL), '{}') AS codes
      FROM camping_spots s
      LEFT JOIN (VALUES ${pairsValues(schemes)}) AS u(country, scheme)
             ON u.country = s.country
      LEFT JOIN ${STAGING} z
             ON z.scheme = u.scheme AND ST_Contains(z.geom, s.location)
     WHERE s.missing_since IS NULL AND s.location IS NOT NULL
     GROUP BY s.id`;
}

/** The write, built from the same select so the two cannot disagree. */
export function updateSql(schemes = SCHEMES_USED) {
  return `
    WITH found AS (${codesSelect(schemes)})
    UPDATE camping_spots t
       SET warning_areas = found.codes
      FROM found
     WHERE found.id = t.id`;
}

/**
 * Що БУЛО Б записано — для прогону без `--apply`.
 *
 * Рахується з того самого CTE, і це правильно саме тут: писати нема що,
 * тож питання стоїть «скільки знайшлося б».
 */
export function wouldCoverSql(schemes = SCHEMES_USED) {
  return `
    WITH found AS (${codesSelect(schemes)})
    SELECT s.country,
           count(*) AS total,
           count(*) FILTER (WHERE cardinality(found.codes) = 0) AS missing
      FROM found JOIN camping_spots s ON s.id = found.id
     GROUP BY s.country ORDER BY s.country`;
}

/**
 * Що СПРАВДІ лежить у колонці — для прогону з `--apply`.
 *
 * 🔴 ЦЕ ВИПРАВЛЕННЯ БЛОКЕРА, І ВІН БУВ У МОЄМУ ВЛАСНОМУ МІРКУВАННІ.
 *
 * Перша редакція міряла покриття тим самим CTE в обох режимах. Я мав
 * випадок «покриття міряється ПІСЛЯ запису, інакше звіт не про те, що
 * лежить у базі» — і він не давав обіцяного, бо число не залежало від
 * запису взагалі.
 *
 * Рецензія це довела: мутація `SET warning_areas = found.codes` →
 * `'{}'::text[]` лишала самотест зеленим, прогін друкував «92.7%» і
 * «✓ записано», а в колонці ставало 0 заповнених із 57 082.
 *
 * Тепер після запису звіт читає САМУ КОЛОНКУ. Та сама мутація дає 0%,
 * а підлога нижче перетворює 0% на ненульовий код виходу.
 */
export function storedCoverSql() {
  return `
    SELECT country,
           count(*) AS total,
           count(*) FILTER (WHERE warning_areas IS NULL
                               OR cardinality(warning_areas) = 0) AS missing
      FROM camping_spots
     WHERE missing_since IS NULL AND location IS NOT NULL
     GROUP BY country ORDER BY country`;
}

/**
 * Every statement this run will issue, in order.
 *
 * 🔴 ПОСЛІДОВНІСТЬ, А НЕ ЛИШЕ ДАНІ. У мене вже був випадок, коли
 * `--apply` був зламаний ЗАВЖДИ, а всі тести на дані зеленіли: вони
 * перевіряли функцію, а не те, що її хтось кличе. Тут план будується
 * окремо від виконання, і самотест читає саме план.
 */
export function plan({ apply }) {
  const steps = [
    { name: 'column exists', sql: "SELECT 1 FROM information_schema.columns WHERE table_name='camping_spots' AND column_name='warning_areas'" },
    { name: 'drop staging', sql: `DROP TABLE IF EXISTS ${STAGING}` },
    { name: 'create staging', sql: `CREATE TABLE ${STAGING} (scheme text, code text, gj text)` },
    { name: 'load', copy: true },
    { name: 'geometry', sql: `ALTER TABLE ${STAGING} ADD COLUMN geom geometry(Geometry,4326)` },
    { name: 'make valid', sql: `UPDATE ${STAGING} SET geom = ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(gj), 4326))` },
    { name: 'index', sql: `CREATE INDEX ON ${STAGING} USING GIST (geom)` },
    { name: 'analyze', sql: `ANALYZE ${STAGING}` },
  ];
  if (apply) steps.push({ name: 'write', sql: updateSql() });
  if (apply) {
    // 🔴 ІНВАРІАНТ, ЯКОГО ПІДЛОГА НЕ ЛОВИТЬ. `LEFT JOIN` → `JOIN` у
    // `codesSelect` викидає кемпінги без зони з результату, тож `UPDATE`
    // їх не торкається й вони лишаються NULL. Частка при цьому та сама
    // — рецензія заміряла 100% на такій мутації. Але NULL означає
    // «резолвер сюди не дійшов», а він дійшов: після запису живих NULL
    // не може бути жодного.
    steps.push({ name: 'no nulls left', sql: NO_NULLS_SQL });
  }
  steps.push({ name: 'coverage', sql: apply ? storedCoverSql() : wouldCoverSql() });
  // 🔴 Прибирання В КІНЦІ Й ЗАВЖДИ. Проміжна таблиця на 3 806 полігонів
  // лишилась би в продакшн-базі після кожного прогону.
  steps.push({ name: 'drop staging', sql: `DROP TABLE IF EXISTS ${STAGING}` });
  return steps;
}

const psql = (sql) => execFileSync('psql', [DB, '-tAX', '-c', sql], { encoding: 'utf8' }).trim();

// 🔴 КЕШ ЛЕЖИТЬ У РЕПОЗИТОРІЇ, А НЕ В /tmp, і це не смак — це три
// алерти CodeQL на цьому PR (`js/insecure-temporary-file` двічі,
// `js/file-system-race`). Шлях у `os.tmpdir()` передбачуваний, а на
// Linux тека ще й спільна для всіх на машині: хто завгодно міг покласти
// туди свій `EMMA_ID.json` ДО нас — `existsSync` сказав би «вже є», і
// ми залили б у продакшн-базу чужі полігони, нічого не завантаживши.
// `mkdtempSync`, як у import-release.mjs, це знімає, але знімає й кеш:
// 61 МБ щоразу. `.cache/` у корені вже в .gitignore (рядок 94), лежить
// під правами власника й переживає прогін.
const CACHE = path.join(HERE, '..', '..', '.cache', 'camp-287-zones');

/**
 * Чи тека кешу приватна: лежить під `root` і НЕ під спільною текою ОС.
 *
 * 🔴 Винесено в чисту функцію не задля краси. Перша версія перевіряла
 * обидві умови на живому шляху — і на будь-якій машині, де репозиторій
 * не всередині /tmp, перша умова спрацьовувала завжди першою, а друга
 * не червоніла НІ ПІД ЯКОЮ мутацією. Два запобіжники прикривали один
 * одного. На сконструйованих шляхах кожна половина ізолюється: саме
 * друга половина — єдина, хто говорить на машині, де сам репозиторій
 * розпакований у тимчасову теку.
 */
export const cacheIsPrivate = (dir, root, osTmp) =>
  dir.startsWith(root + path.sep) && !dir.startsWith(osTmp + path.sep);

function cacheDir() {
  mkdirSync(CACHE, { recursive: true, mode: 0o700 });
  return CACHE;
}

/**
 * Завантажити (або взяти з кешу) кожне джерело й скласти TSV-рядки.
 *
 * 🔴 Параметри існують заради репетиції, і це єдина причина. Без них
 * мутація «пиши одразу в кеш, без .part» виживала: жоден випадок не
 * доходив сюди, бо справжній прогін іде в мережу. Тепер репетиція
 * проходить ТУ САМУ послідовність викликів і дивиться, під яким ім'ям
 * файл з'являється вперше.
 */
export async function sourceRows({
  dir = cacheDir(),
  sources = USED_SOURCES,
  fetchImpl = fetch,
  write = writeFileSync,
} = {}) {
  const lines = [];
  let dropped = 0;
  for (const [scheme, src] of Object.entries(sources)) {
    const file = path.join(dir, `${scheme}.json`);
    if (!existsSync(file)) {
      const res = await fetchImpl(src.url);
      if (!res.ok) throw new Error(`GET ${src.url} returned ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      // 🔴 РОЗБИРАЄМО ДО ТОГО, як файл стане кешем, і це не педантизм.
      // Сервер, що віддав сторінку-помилку з кодом 200, пройшов би
      // `res.ok`, осів у кеші як `EMMA_ID.json` — і КОЖЕН наступний
      // прогін читав би його, падав на `JSON.parse` і падав би так
      // довіку: `existsSync` каже «вже є», завантаження не повторюється.
      // Вийти з цього можна було б лише руками, видаливши теку.
      // Платимо одним зайвим розбором на холодний кеш.
      const parsed = JSON.parse(bytes.toString('utf8'));
      if (parsed?.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
        throw new Error(`${src.url} віддав не FeatureCollection`);
      }
      // 🔴 І лише тепер — спершу в `.part`, і лише `renameSync` робить
      // файл кешем. Обірване на половині лишалось би під власним ім'ям,
      // і наступний прогін узяв би його мовчки. Перейменування в межах
      // однієї теки атомарне.
      const part = `${file}.part`;
      write(part, bytes);
      renameSync(part, file);
    }
    const made = rowsFrom(JSON.parse(readFileSync(file, 'utf8')), scheme, src.idField);
    // 🔴 Заміряне число зон — у `USED_SOURCES`. Джерело, що віддало
    // інакше, змінилось під нами, і це треба побачити, а не всереднити.
    if (made.lines.length !== src.zones) {
      console.warn(
        `⚠ ${scheme}: ${made.lines.length} зон, а 13.10.2026 було ${src.zones} — джерело змінилось`,
      );
    }
    lines.push(...made.lines);
    dropped += made.dropped;
  }
  return { lines, dropped };
}

async function run({ apply }) {
  const steps = plan({ apply });
  if (!psql(steps[0].sql)) {
    console.error(
      '✗ колонки `warning_areas` немає. Спершу міграція ' +
        '1791300000000-WarningAreas, інакше писати нема куди.',
    );
    return 1;
  }

  const { lines, dropped } = await sourceRows();
  const tsv = path.join(cacheDir(), 'zones.tsv');
  writeFileSync(tsv, lines.join('\n') + '\n');
  console.log(`зон до завантаження: ${lines.length}${dropped ? `, відкинуто ${dropped}` : ''}`);

  try {
    for (const step of steps.slice(1)) {
      if (step.copy) {
        execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-q', '-c',
          `\\copy ${STAGING} (scheme, code, gj) FROM '${tsv}'`], { stdio: 'inherit' });
        continue;
      }
      if (step.name === 'no nulls left') {
        const left = Number(psql(step.sql));
        if (left !== 0) {
          console.error(
            `✗ після запису ${left} живих кемпінгів лишились NULL. ` +
              'NULL означає «резолвер не дійшов», а він дійшов — отже ' +
              'запис оминув ці рядки замість написати їм порожній масив.',
          );
          return 1;
        }
        continue;
      }
      if (step.name === 'coverage') {
        const rows = psql(step.sql).split('\n').filter(Boolean).map((l) => {
          const [country, total, missing] = l.split('|');
          return { country, total: Number(total), missing: Number(missing) };
        });
        const total = rows.reduce((n, r) => n + r.total, 0);
        const placed = total - rows.reduce((n, r) => n + r.missing, 0);
        const v = verdict(total, placed, rows);
        if (!v.ok) {
          console.error(`✗ ${v.why}`);
          return 1;
        }
        console.log(`\n${placed} із ${total} кемпінгів розташовано — ${v.share}%`);
        for (const r of v.short.slice(0, 10)) {
          console.log(`  ${r.country}: ${r.missing} без коду з ${r.total}`);
        }
        continue;
      }
      psql(step.sql);
    }
  } finally {
    psql(`DROP TABLE IF EXISTS ${STAGING}`);
  }

  console.log(apply ? '\n✓ warning_areas записано' : '\n✓ нічого не записано — це був замір; пиши з --apply');
  return 0;
}

async function selfTest() {
  let rc = 0;
  const cases = [];
  const check = (cond, m) => {
    cases.push(m);
    if (!cond) {
      console.error(`✗ REHEARSAL FAILED: ${m}`);
      rc = 1;
    }
  };

  // 🔴 ПОСЛІДОВНІСТЬ ВИКЛИКІВ, не лише дані.
  const dry = plan({ apply: false }).map((s) => s.name);
  const wet = plan({ apply: true }).map((s) => s.name);
  check(!dry.includes('write'), '🔴 прогін без --apply НЕ МАЄ писати нічого');
  check(wet.includes('write'), '--apply мусить писати');
  check(wet.filter((n) => n === 'write').length === 1, 'пише рівно один раз, не двічі');
  check(dry[0] === 'column exists', 'перше питання — чи є взагалі куди писати');
  check(
    dry[dry.length - 1] === 'drop staging' && wet[wet.length - 1] === 'drop staging',
    'проміжна таблиця прибирається останнім кроком в обох режимах',
  );
  check(
    wet.indexOf('write') < wet.indexOf('coverage'),
    'покриття міряється ПІСЛЯ запису, інакше звіт не про те, що лежить у базі',
  );
  check(
    plan({ apply: true }).find((s) => s.name === 'load')?.copy === true,
    'зони заливаються копіюванням, не рядковими INSERT',
  );

  // 🔴 ЗАПИТ ОДИН, і він тут імпортований, а не переписаний.
  const upd = updateSql();
  check(upd.includes(codesSelect()), 'запис користується ТИМ САМИМ select, що й замір «було б»');
  check(wouldCoverSql().includes(codesSelect()), 'прогін без запису міряє тим самим select');
  check(/missing_since IS NULL/.test(codesSelect()), 'зниклі рядки не чіпаємо');
  check(/ST_Contains/.test(codesSelect()), 'зона мусить МІСТИТИ точку, не лише бути поруч');

  // 🔴 ЗАПИС МУСИТЬ ІТИ САМЕ В ЦЮ КОЛОНКУ. Рецензія показала, що
  // `upd.includes(codesSelect())` проходить і тоді, коли `SET` пише в
  // зовсім іншу колонку — перевірялась наявність підзапиту, не ціль.
  check(/SET\s+warning_areas\s*=/.test(upd), '🔴 запис іде в warning_areas, а не кудись');
  check(/=\s*found\.codes/.test(upd), '🔴 і пише знайдені коди, а не константу');

  // 🔴 БЕЗ ЗОНИ — ПОРОЖНІЙ МАСИВ, НЕ NULL. Перевірка була текстова
  // (`/'\{\}'/`), і рецензія обійшла її, лишивши `'{}'` у коментарі SQL
  // та прибравши сам `coalesce`.
  check(/coalesce\(array_agg/.test(codesSelect()), 'порожнечу дає coalesce, а не випадковий текст');
  check(
    codesSelect().replace(/--[^\n]*/g, '').includes("'{}'"),
    "🔴 і порожній масив стоїть у КОДІ, не в коментарі",
  );

  // 🔴 ПІСЛЯ ЗАПИСУ ЗВІТ ЧИТАЄ КОЛОНКУ, А НЕ ПЕРЕРАХОВУЄ CTE.
  // Це той самий блокер: мутація `SET … = '{}'` лишала звіт на 92.7%,
  // бо він не питав у колонки нічого.
  const stored = storedCoverSql();
  check(/FROM camping_spots/.test(stored), 'звіт після запису читає таблицю');
  check(/warning_areas/.test(stored), '🔴 і саме колонку warning_areas');
  check(!stored.includes(codesSelect()), '🔴 і НЕ перераховує той самий CTE');
  check(
    plan({ apply: true }).find((x) => x.name === 'coverage')?.sql === stored,
    'з --apply у плані стоїть саме звіт по колонці',
  );
  check(
    plan({ apply: false }).find((x) => x.name === 'coverage')?.sql === wouldCoverSql(),
    'без --apply — звіт «скільки знайшлося б»',
  );

  // 🔴 ІНВАРІАНТ ПРО NULL. Підлога ловить стерту колонку, але не ловить
  // запис, що ОМИНУВ рядки: частка лишається та сама, а без зони замість
  // `{}` стоїть NULL. Рецензія заміряла це на мутації `LEFT JOIN`→`JOIN`.
  check(wet.includes('no nulls left'), '🔴 після запису перевіряємо, що живих NULL не лишилось');
  check(!dry.includes('no nulls left'), 'без запису перевіряти нема чого');
  check(
    wet.indexOf('write') < wet.indexOf('no nulls left'),
    'перевірка NULL іде ПІСЛЯ запису',
  );
  check(/warning_areas IS NULL/.test(NO_NULLS_SQL), 'і питає саме про NULL у колонці');
  check(/missing_since IS NULL/.test(NO_NULLS_SQL), 'серед живих рядків, не всіх');

  const vals = pairsValues();
  check(vals.includes("('FR','NUTS3')"), 'Франція зʼєднується по NUTS3');
  check(!vals.includes("('FR','EMMA_ID')"), '🔴 і НЕ по EMMA_ID: 97.5% покриття, 0% збігів');
  check(vals.includes("('BE','NUTS2')") && vals.includes("('BE','EMMA_ID')"), 'Бельгія має обидві');
  check(!/\bSE\b/.test(vals), 'Швеція не зʼєднується ні з чим — її фід кодів не несе');
  check(
    pairsValues({ AT: ['EMMA_ID'] }) === "('AT','EMMA_ID')",
    'пари будуються з переданого набору, а не з глобального',
  );

  // 🔴 Кеш не в спільній теці — те саме, що зняв три алерти CodeQL.
  // Перевіряється ВЛАСТИВІСТЬ, а не рядок: «лежить під репозиторієм і
  // не під os.tmpdir()». Інакше наступний, хто захоче зробити шлях
  // коротшим, поверне /tmp і побачить зелене.
  check(
    cacheIsPrivate('/repo/.cache/zones', '/repo', '/tmp') === true,
    'тека під репозиторієм і поза /tmp — приватна',
  );
  check(
    cacheIsPrivate('/elsewhere/.cache/zones', '/repo', '/tmp') === false,
    'тека поза репозиторієм — не приватна',
  );
  // 🔴 Єдиний випадок, де говорить саме умова про теку ОС: шлях лежить
  // під коренем (перша умова каже «так») і водночас у /tmp.
  check(
    cacheIsPrivate('/tmp/work/repo/.cache/zones', '/tmp/work/repo', '/tmp') === false,
    '🔴 під коренем, але всередині /tmp — не приватна: туди чужий файл кладеться раніше за наш',
  );
  check(
    cacheIsPrivate(cacheDir(), path.resolve(HERE, '..', '..'), realpathSync(tmpdir())) === true,
    'справжня тека кешу цього скрипта приватна',
  );

  // 🔴 ТА САМА ПОСЛІДОВНІСТЬ ВИКЛИКІВ, що й у справжньому прогоні —
  // `sourceRows`, не загорнута навколо неї обгортка. Дивимось не на
  // дані, а на ім'я, під яким файл з'являється ВПЕРШЕ.
  {
    const dir = mkdtempSync(path.join(tmpdir(), 'camp-287-rehearsal-'));
    const sources = { TEST: { url: 'https://example.invalid/z', idField: 'code', zones: 1 } };
    const body = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ properties: { code: 'X1' }, geometry: { type: 'Point', coordinates: [0, 0] } }],
    });
    const seen = [];
    const write = (p, b) => {
      seen.push(p);
      writeFileSync(p, b);
    };
    const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => Buffer.from(body) });

    const got = await sourceRows({ dir, sources, fetchImpl, write });
    check(got.lines.length === 1, 'репетиція завантаження дає рядок, а не порожнечу');
    check(
      seen.length === 1 && seen[0].endsWith('.json.part'),
      '🔴 завантажене пишеться СПЕРШУ у .part — під власним ім\'ям обірване лишилось би кешем',
    );
    check(
      existsSync(path.join(dir, 'TEST.json')) && !existsSync(seen[0]),
      'після успіху в кеші лежить .json і не лишається .part',
    );

    // І зрив посеред запису: у кеші не має з'явитись НІЧОГО під іменем,
    // яке наступний прогін прийме за готове.
    const dir2 = mkdtempSync(path.join(tmpdir(), 'camp-287-rehearsal-'));
    const halfWrite = (p, b) => {
      writeFileSync(p, b.subarray(0, 3));
      throw new Error('обірвано');
    };
    let threw = false;
    try {
      await sourceRows({ dir: dir2, sources, fetchImpl, write: halfWrite });
    } catch {
      threw = true;
    }
    check(threw, 'зрив посеред запису не ковтається');
    check(
      !existsSync(path.join(dir2, 'TEST.json')),
      '🔴 після зриву кеш ПОРОЖНІЙ — інакше наступний прогін мовчки візьме обрізок',
    );
    check(
      readdirSync(dir2).every((f) => f.endsWith('.part')),
      'усе, що лишилось від зриву, має суфікс .part і не читається як кеш',
    );

    // 🔴 І сторінка-помилка з кодом 200. Саме вона осідала в кеші як
    // готовий .json і ламала КОЖЕН наступний прогін — назавжди.
    // 🔴 Четвертий і пʼятий рядки існують тому, що без них половини
    // умови прикривали одна одну: `{"type":"Feature"}` не має й
    // `features`, тож обидві половини казали «ні» разом, і прибрати
    // будь-яку з них можна було безкарно — матриця показала дві вижилі
    // мутації. Нижче кожна половина лишається єдиною, хто говорить.
    for (const [label, payload] of [
      ['HTML замість JSON', '<!doctype html><title>502</title>'],
      ['JSON, але не FeatureCollection', '{"type":"Feature","properties":{}}'],
      ['правильний type, але features немає', '{"type":"FeatureCollection"}'],
      ['features є, але type чужий', '{"type":"Feature","features":[]}'],
    ]) {
      const d = mkdtempSync(path.join(tmpdir(), 'camp-287-rehearsal-'));
      let blew = false;
      try {
        await sourceRows({
          dir: d,
          sources,
          fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from(payload) }),
          write,
        });
      } catch {
        blew = true;
      }
      check(blew, `🔴 ${label} з кодом 200 — це помилка, а не дані`);
      check(
        !existsSync(path.join(d, 'TEST.json')),
        `🔴 ${label} НЕ осідає в кеші — інакше кожен наступний прогін падав би довіку`,
      );
      rmSync(d, { recursive: true, force: true });
    }

    rmSync(dir, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }

  const EXPECTED_CASES = 48;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ REHEARSAL FAILED: ${cases.length} cases ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  console.log(
    rc === 0
      ? `✓ resolve-campsite-zones self-test: ${cases.length} cases over the plan and the query`
      : `✗ resolve-campsite-zones self-test: ${cases.length} cases, at least one failed`,
  );
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

if (invokedDirectly) {
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test', '--apply'],
    'resolve-campsite-zones.mjs',
  );
  if (action.has('--self-test')) process.exit(await selfTest());
  process.exit(await run({ apply: action.has('--apply') }));
}
