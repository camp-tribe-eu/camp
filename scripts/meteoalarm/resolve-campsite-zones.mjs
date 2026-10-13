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
import { readFileSync, realpathSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { SCHEMES_USED, USED_SOURCES, rowsFrom, usesPairs, verdict } from './zone-coverage.mjs';

const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';
const STAGING = 'warning_zones_staging';

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
// є сама зона. Заміряно після першого запису 13.10.2026: з 30 411 кодів
// EMMA **338 (1.1%)** належать зоні іншої країни — DE↔NL 68, NL→BE 43,
// PL→DE 18, BE→FR 14, AT→DE 8, GR→MK 20.
//
// Лишаємо навмисно. Кемпінг за 300 метрів від кордону справді лежить
// усередині сусідської зони, і попередження, видане для неї, його таки
// накриває — погода кордону не знає. Відфільтрувати «чужі» зони означало
// б викинути попередження, які стосуються місця.
//
// 🔴 А ось чого в цьому числі НЕМАЄ, попри перше враження: 92 випадки
// `IE → EI` не прикордонні. Ірландські зони EMMA несуть ОБИДВА префікси
// — `IE…` (30 зон) і `EI…` (21), `country` в обох `IE`. Хибною була моя
// міряльна евристика «перші дві літери коду — це країна», не дані.
// Префікс коду не є кодом країни, і якщо колись знадобиться країна
// зони — вона лежить у властивості `country` джерела.
//
// Зони країн, чиїх фідів ми не тягнемо (`MK`, 20 випадків), інертні: код
// лежить, збігтися йому нема з чим.
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

/** The measurement, built from the same select for the same reason. */
export function coverageSql(schemes = SCHEMES_USED) {
  return `
    WITH found AS (${codesSelect(schemes)})
    SELECT s.country,
           count(*) AS total,
           count(*) FILTER (WHERE cardinality(found.codes) = 0) AS missing
      FROM found JOIN camping_spots s ON s.id = found.id
     GROUP BY s.country ORDER BY s.country`;
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
  steps.push({ name: 'coverage', sql: coverageSql() });
  // 🔴 Прибирання В КІНЦІ Й ЗАВЖДИ. Проміжна таблиця на 3 806 полігонів
  // лишилась би в продакшн-базі після кожного прогону.
  steps.push({ name: 'drop staging', sql: `DROP TABLE IF EXISTS ${STAGING}` });
  return steps;
}

const psql = (sql) => execFileSync('psql', [DB, '-tAX', '-c', sql], { encoding: 'utf8' }).trim();

function cacheDir() {
  const dir = path.join(tmpdir(), 'camp-287-zones');
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function sourceRows() {
  const dir = cacheDir();
  const lines = [];
  let dropped = 0;
  for (const [scheme, src] of Object.entries(USED_SOURCES)) {
    const file = path.join(dir, `${scheme}.json`);
    if (!existsSync(file)) {
      const res = await fetch(src.url);
      if (!res.ok) throw new Error(`GET ${src.url} returned ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
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

function selfTest() {
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
  const cov = coverageSql();
  check(upd.includes(codesSelect()), 'запис користується ТИМ САМИМ select, що й замір');
  check(cov.includes(codesSelect()), 'замір користується ним теж');
  check(/missing_since IS NULL/.test(codesSelect()), 'зниклі рядки не чіпаємо');
  check(/'\{\}'/.test(codesSelect()), "🔴 без зони пишемо порожній масив, не NULL — це різні відповіді");
  check(/ST_Contains/.test(codesSelect()), 'зона мусить МІСТИТИ точку, не лише бути поруч');

  const vals = pairsValues();
  check(vals.includes("('FR','NUTS3')"), 'Франція зʼєднується по NUTS3');
  check(!vals.includes("('FR','EMMA_ID')"), '🔴 і НЕ по EMMA_ID: 97.5% покриття, 0% збігів');
  check(vals.includes("('BE','NUTS2')") && vals.includes("('BE','EMMA_ID')"), 'Бельгія має обидві');
  check(!/\bSE\b/.test(vals), 'Швеція не зʼєднується ні з чим — її фід кодів не несе');
  check(
    pairsValues({ AT: ['EMMA_ID'] }) === "('AT','EMMA_ID')",
    'пари будуються з переданого набору, а не з глобального',
  );

  const EXPECTED_CASES = 17;
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
  if (action.has('--self-test')) process.exit(selfTest());
  process.exit(await run({ apply: action.has('--apply') }));
}
