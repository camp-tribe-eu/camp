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
// файл. З'єднання йде ПАРАМИ «країна × схема».
//
// 🔴 02.11.2026 ЦЕ БІЛЬШЕ НЕ «СХЕМА, ЯКУ ВОНА ВЖИВАЄ». Франція, Болгарія,
// Румунія, Угорщина й Бельгія попереджають у NUTS, а кемпінг несе
// EMMA_ID: полігони NUTS ми брали в GISCO (EuroGeographics), чия ліцензія
// забороняє комерційне використання. Збігається це лише тому, що
// `fetch-warnings.mjs` дописує до NUTS-області код зони за назвою
// (`nuts-binding.mjs`). Повіти Хорватії — NUTS3 з OpenStreetMap: у списку
// зон MeteoAlarm повітів немає.

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
import { hrCountiesFeatures, HR_COUNTIES } from './osm-hr-counties.mjs';
import {
  OBSOLETE_CACHE,
  SCHEMES_USED,
  SNAP_LIMIT_M,
  LAND_LAYER,
  LAND_SHARE_MIN,
  BEFORE_GISCO,
  BEFORE_GISCO_ALL,
  USED_SOURCES,
  floorsVerdict,
  rowsFrom,
  usesPairs,
  verdict,
} from './zone-coverage.mjs';

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
export function codesSelect(schemes = SCHEMES_USED, limitM = SNAP_LIMIT_M, landMin = LAND_SHARE_MIN) {
  return `
    SELECT s.id,
           coalesce(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS codes,
           coalesce(bool_or(p.snapped), false) AS snapped,
           max(p.snap_m) FILTER (WHERE p.snapped) AS snap_m,
           count(DISTINCT p.code) FILTER (WHERE NOT p.snapped) AS contained,
           coalesce(array_agg(DISTINCT p.code) FILTER (WHERE p.snapped), '{}') AS snapped_codes,
           count(DISTINCT p.code) FILTER (WHERE p.sea) AS sea_contained
      FROM camping_spots s
      LEFT JOIN (VALUES ${pairsValues(schemes)}) AS u(country, scheme)
             ON u.country = s.country
      LEFT JOIN LATERAL (
        -- Containment: every zone of this scheme the point stands in.
        SELECT z.scheme || ':' || z.code AS code, false AS snapped, NULL::float8 AS snap_m,
               (z.scheme = 'EMMA_ID' AND z.land_share < ${landMin}) AS sea
          FROM ${STAGING} z
         WHERE z.scheme = u.scheme AND ST_Contains(z.geom, s.location)
        UNION ALL
        -- 🔴 SNAPPING: ONLY FOR A SCHEME IN WHICH THE POINT STANDS IN NOTHING,
        -- and only to a zone of the campsite's OWN country within the limit.
        -- A generalised outline shaves shores and islands off (see
        -- SNAP_LIMIT_M); a point past the limit is a different place and
        -- stays unplaced. Two steps, as import-spots.ts learned: the index
        -- narrows to eight candidates by bounding box and KNN, and only
        -- those are measured on the sphere. The code breaks a tie so the
        -- winner cannot move between runs.
        SELECT n.scheme || ':' || n.code, true, n.dist, false
          FROM (SELECT 1 WHERE NOT EXISTS (
                  SELECT 1 FROM ${STAGING} c
                   WHERE c.scheme = u.scheme AND ST_Contains(c.geom, s.location))) AS g,
               LATERAL (
                 SELECT k.scheme, k.code,
                        ST_Distance(k.geom::geography, s.location::geography) AS dist
                   FROM (SELECT q.scheme, q.code, q.geom FROM ${STAGING} q
                          WHERE q.scheme = u.scheme AND q.country = s.country
                            -- 🔴 NEVER A SEA ZONE. A campsite that is pulled is
                            -- pulled to land: counties are land by what they
                            -- are, an EMMA zone by its share of land.
                            AND (q.scheme <> 'EMMA_ID' OR q.land_share >= ${landMin})
                            AND q.geom && ST_Expand(s.location, ${limitM} / 30000.0)
                          ORDER BY q.geom <-> s.location LIMIT 8) k
                  WHERE ST_DWithin(k.geom::geography, s.location::geography, ${limitM})
                  ORDER BY dist, k.code LIMIT 1) AS n
      ) p ON true
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
 * The share of each EMMA zone that is land, from the land layer.
 *
 * Planar area ratio in degrees: both areas are measured the same way, so the
 * ratio is right to the precision a 0.5 threshold needs, and it does not
 * need a spheroid. The layer is made valid first — one self-intersecting
 * polygon would otherwise end the run on a TopologyException.
 */
export function landShareSql() {
  return `
    UPDATE ${STAGING} z
       SET land_share = coalesce((
             SELECT sum(ST_Area(ST_Intersection(z.geom, ST_MakeValid(n.geom))))
               FROM ${LAND_LAYER} n
              WHERE n.geom && z.geom), 0) / nullif(ST_Area(z.geom), 0)
     WHERE z.scheme = 'EMMA_ID'`;
}

/**
 * 🔴 A COUNTRY WITH NO LAND ZONE HAS NO ZONES. Its zones are deleted from the
 * staging table and named: its campsites stay without one, which is the true
 * answer and better than a warning for ships. Latvia, whose four zones are
 * all sea, is the case that found it.
 */
export function landlessSql(landMin = LAND_SHARE_MIN) {
  return `
    WITH gone AS (
      DELETE FROM ${STAGING} z
       WHERE z.scheme = 'EMMA_ID'
         AND NOT EXISTS (SELECT 1 FROM ${STAGING} y
                          WHERE y.scheme = 'EMMA_ID' AND y.country = z.country
                            AND y.land_share >= ${landMin})
      RETURNING z.country)
    SELECT coalesce(country, ''), count(*) FROM gone GROUP BY 1 ORDER BY 1`;
}

/**
 * Campsites that hold a sea zone by CONTAINMENT, and how many of them stand
 * on land by the land layer. Not new — every run has done this — but not
 * visible either, and it is the number the owner decides on.
 */
export function seaHeldSql(schemes = SCHEMES_USED) {
  return `
    WITH found AS (${codesSelect(schemes)})
    SELECT count(*) FILTER (WHERE f.sea_contained > 0) AS holding_sea_zone,
           count(*) FILTER (WHERE f.sea_contained > 0 AND EXISTS (
             SELECT 1 FROM ${LAND_LAYER} n WHERE ST_Contains(n.geom, s.location))) AS of_them_on_land,
           count(*) FILTER (WHERE f.sea_contained > 0 AND f.contained = f.sea_contained) AS holding_only_sea
      FROM found f JOIN camping_spots s ON s.id = f.id`;
}

/**
 * 🔴 THE GUARD, ON THE DATA: how many codes a campsite was PULLED to are a
 * sea zone. Reads the zone's kind from the staging table, not from the
 * predicate in `codesSelect`, so a select whose land test was deleted still
 * gets caught. Must be zero.
 */
export function snapKindsSql(schemes = SCHEMES_USED) {
  return `
    WITH found AS (${codesSelect(schemes)})
    SELECT count(*) FROM found f, unnest(f.snapped_codes) c
      JOIN ${STAGING} z ON z.scheme || ':' || z.code = c
     WHERE z.scheme = 'EMMA_ID' AND z.land_share < ${LAND_SHARE_MIN}`;
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
           count(*) FILTER (WHERE cardinality(found.codes) = 0) AS missing,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM unnest(found.codes) c WHERE c LIKE 'NUTS3:%')) AS missing_nuts3
      FROM found JOIN camping_spots s ON s.id = found.id
     GROUP BY s.country ORDER BY s.country`;
}

/**
 * Who got a zone by snapping, per country: total, placed WITHOUT it, placed
 * with it, and how many were snapped. The middle figure is what the
 * replacement alone gave; the difference is what snapping added.
 */
export function snapByCountrySql(schemes = SCHEMES_USED) {
  return `
    WITH found AS (${codesSelect(schemes)})
    SELECT s.country,
           count(*) AS total,
           count(*) FILTER (WHERE found.contained > 0) AS placed_without_snap,
           count(*) FILTER (WHERE cardinality(found.codes) > 0) AS placed,
           count(*) FILTER (WHERE found.snapped) AS snapped
      FROM found JOIN camping_spots s ON s.id = found.id
     GROUP BY s.country ORDER BY s.country`;
}

/** How far the snapped ones were pulled, in buckets, and the farthest. */
export function snapDistancesSql(schemes = SCHEMES_USED) {
  return `
    WITH found AS (${codesSelect(schemes)})
    SELECT count(*) FILTER (WHERE snapped) AS snapped,
           count(*) FILTER (WHERE snapped AND snap_m <= 100) AS le_100m,
           count(*) FILTER (WHERE snapped AND snap_m <= 500) AS le_500m,
           count(*) FILTER (WHERE snapped AND snap_m <= 1000) AS le_1km,
           count(*) FILTER (WHERE snapped AND snap_m <= 3000) AS le_3km,
           count(*) FILTER (WHERE snapped AND snap_m <= 5000) AS le_5km,
           coalesce(round(max(snap_m) FILTER (WHERE snapped)), 0) AS farthest_m
      FROM found`;
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
                               OR cardinality(warning_areas) = 0) AS missing,
           count(*) FILTER (WHERE warning_areas IS NULL OR NOT EXISTS (
             SELECT 1 FROM unnest(warning_areas) c WHERE c LIKE 'NUTS3:%')) AS missing_nuts3
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
    { name: 'land layer exists', sql: `SELECT to_regclass('public.${LAND_LAYER}') IS NOT NULL` },
    { name: 'drop staging', sql: `DROP TABLE IF EXISTS ${STAGING}` },
    { name: 'create staging', sql: `CREATE TABLE ${STAGING} (scheme text, code text, gj text, country text, land_share float8)` },
    { name: 'load', copy: true },
    { name: 'geometry', sql: `ALTER TABLE ${STAGING} ADD COLUMN geom geometry(Geometry,4326)` },
    { name: 'make valid', sql: `UPDATE ${STAGING} SET geom = ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(gj), 4326))` },
    { name: 'index', sql: `CREATE INDEX ON ${STAGING} USING GIST (geom)` },
    // 🔴 КОЖНА ЗОНА EMMA ДІСТАЄ ЧАСТКУ СУХОДОЛУ, і країна, де жодна зона не
    // сухопутна, втрачає всі свої зони: див. `LAND_SHARE_MIN`.
    { name: 'land share', sql: landShareSql() },
    { name: 'landless countries', sql: landlessSql() },
    { name: 'analyze', sql: `ANALYZE ${STAGING}` },
  ];
  // 🔴 Підтягнуте має бути ВИДНО, у обох режимах і ДО запису: після нього
  // колонка не каже, хто потрапив у неї підтягуванням.
  steps.push({ name: 'sea held by containment', sql: seaHeldSql() });
  steps.push({ name: 'snap kinds', sql: snapKindsSql() });
  steps.push({ name: 'snap by country', sql: snapByCountrySql() });
  steps.push({ name: 'snap distances', sql: snapDistancesSql() });
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

/**
 * Чи прийнятне покриття: глобальна підлога І підлога кожної з шести
 * країн, чий зв'язок змінився.
 *
 * 🔴 ОКРЕМА ФУНКЦІЯ, а не рядки в `run`, бо `run` ходить у базу й жодне
 * самотестування його не торкається. Глобальна підлога (80%) не бачить
 * країну в 642 кемпінги — див. `COUNTRY_FLOORS`, — а те, чого не бачить
 * сторож, нічого й не коштує зламати.
 */
export function judgeCoverage(rows) {
  const total = rows.reduce((n, r) => n + r.total, 0);
  const placed = total - rows.reduce((n, r) => n + r.missing, 0);
  const v = verdict(total, placed, rows);
  if (!v.ok) return { ok: false, why: v.why };
  const f = floorsVerdict(rows);
  if (!f.ok) return { ok: false, why: f.why };
  return { ok: true, total, placed, share: v.share, short: v.short, table: f.table };
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
/**
 * Де лежить кеш, якщо скрипт лежить у `here`.
 *
 * 🔴 Окрема функція, бо інакше прив'язку до `HERE` не довести: мутація
 * `path.join(process.cwd(), …)` ВИЖИВАЛА всі випадки — у CI прогін іде
 * з кореня, тож cwd і корінь репозиторію збігаються, і перевірка на
 * живому шляху однаково каже «так». Тут аргумент чужий, і підміна його
 * на cwd червоніє.
 */
export const cachePathFor = (here) =>
  path.join(here, '..', '..', '.cache', 'camp-287-zones');

const CACHE = cachePathFor(HERE);

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
  // 🔴 Без `mode`. Він тут був і НІЧОГО не робив: `mkdirSync` накладає
  // права лише коли створює теку, а на вже наявній — ні. Заміряно:
  // `chmod 755` на теці, потім `mkdirSync(…, {mode: 0o700})` лишає
  // `drwxr-xr-x`, і прибрати цей аргумент можна було безкарно. Права
  // тут дає не він, а те, що тека лежить у репозиторії під обліковим
  // записом власника, а не в спільній теці ОС.
  mkdirSync(CACHE, { recursive: true });
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
  // 🔴 Полігони GISCO (EuroGeographics) — «не для комерційного
  // використання». Попередня версія резолвера кешувала їх під цими
  // іменами, і на сервері вони лежать досі: прибираємо, а не сподіваємось.
  for (const old of OBSOLETE_CACHE) rmSync(path.join(dir, old), { force: true });
  for (const [scheme, src] of Object.entries(sources)) {
    // 🔴 Ім'я кешу — власність джерела, не схеми: `NUTS3.json` на сервері
    // це GISCO, і `existsSync` віддав би його як «повіти Хорватії».
    const file = path.join(dir, src.file ?? `${scheme}.json`);
    // Те, що щойно завантажили, вже розібране — удруге 33 МБ не парсимо.
    let collection = null;
    if (!existsSync(file)) {
      const res = await fetchImpl(src.url, src.headers ? { headers: src.headers } : undefined);
      if (!res.ok) throw new Error(`GET ${src.url} returned ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      // 🔴 РОЗБИРАЄМО ДО ТОГО, як файл стане кешем, і це не педантизм.
      // Сервер, що віддав сторінку-помилку з кодом 200, пройшов би
      // `res.ok`, осів у кеші як `EMMA_ID.json` — і КОЖЕН наступний
      // прогін читав би його, падав на `JSON.parse` і падав би так
      // довіку: `existsSync` каже «вже є», завантаження не повторюється.
      // Вийти з цього можна було б лише руками, видаливши теку.
      // Платимо одним зайвим розбором на холодний кеш.
      collection = JSON.parse(bytes.toString('utf8'));
      if (
        collection?.type !== 'FeatureCollection' ||
        !Array.isArray(collection.features) ||
        // 🔴 І порожній `features` — теж помилка. Без цієї умови 200 із
        // `{"type":"FeatureCollection","features":[]}` осідав у кеші
        // назавжди: далі про розходження з `src.zones` сказав би лише
        // `console.warn`, а це той самий «падає довіку» на поділку нижче.
        // Усі три справжні джерела віддають 2 006 / 1 480 / 320 зон.
        collection.features.length === 0
      ) {
        throw new Error(`${src.url} віддав не FeatureCollection із зонами`);
      }
      // 🔴 І лише тепер — спершу в тимчасовий файл, і лише `renameSync`
      // робить його кешем. Обірване на половині лишалось би під власним
      // ім'ям, і наступний прогін узяв би його мовчки. Перейменування в
      // межах однієї теки атомарне.
      //
      // 🔴 PID У НАЗВІ, і це не прикраса. З однаковим `.part` два
      // одночасні прогони — нічний таймер і ручний запуск — б'ються за
      // той самий файл: один падає `ENOENT` на `rename`, другий читає
      // кеш, який сусід опублікував недописаним. Вікно — секунди запису
      // 33 МБ, тобто цілком досяжне.
      const part = `${file}.${process.pid}.part`;
      try {
        write(part, bytes);
        renameSync(part, file);
      } finally {
        // Після вдалого перейменування його вже немає; після зриву —
        // є, і прибрати його має той, хто створив.
        rmSync(part, { force: true });
      }
    }
    let raw = collection ?? JSON.parse(readFileSync(file, 'utf8'));
    // 🔴 Джерело, чий формат не збігається з потрібним (Nominatim →
    // `NUTS_ID`), має власний відбір: він повертає лише те, за що
    // ручається, і ІМЕНУЄ решту. Один повіт, якого OSM більше не підтверджує,
    // коштує одного повіту, а не прогону.
    if (src.select) {
      const picked = src.select(raw);
      for (const r of picked.rejected) console.warn(`⚠ ${scheme} ${r.code ?? ''}: ${r.why}`);
      raw = { type: 'FeatureCollection', features: picked.features };
    }
    const made = rowsFrom(raw, scheme, src.idField, src.countryField);
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

/**
 * 🔴 Підтягнутий кемпінг не сміє дістати морську зону: рахується по ДАНИХ.
 * `wrong` — скільки підтягнутих кодів належить зоні з часткою суходолу
 * нижче межі. Мусить бути нуль.
 */
export function judgeSnapKinds(wrong) {
  return wrong > 0
    ? { ok: false, why: `${wrong} code(s) a campsite was pulled to are SEA zones — a land campsite must never be given a warning for ships` }
    : { ok: true };
}

/** The one line the run prints about who was pulled to a zone. */
export function describeSnap(d, limitM = SNAP_LIMIT_M) {
  return (
    `підтягнуто до найближчої зони (≤ ${limitM} м, своєї країни): ${d.snapped} кемпінгів — ` +
    `≤100 м ${d.le100}, ≤500 м ${d.le500}, ≤1 км ${d.le1k}, ≤3 км ${d.le3k}, ≤5 км ${d.le5k}; ` +
    `найдальший ${d.farthestM} м`
  );
}

/** `part` of `total`, to one decimal — the same rounding the verdict uses. */
const pct = (part, total) => Math.round((1000 * part) / total) / 10;

/**
 * Підтягування за межею не відбувається — перевірка по ДАНИХ, не по
 * тексту запиту: найдальший підтягнутий кемпінг мусить лежати в межі.
 *
 * 🔴 Це окремо від самотесту проти справжнього PostGIS (`--self-test-db`):
 * той ловить зламаний запит на синтетичних точках, цей — на справжніх
 * 57 тисячах, коли межу зламали деінде, ніж у тесті.
 */
export function judgeSnap(d, limitM = SNAP_LIMIT_M) {
  if (d.farthestM > limitM) {
    return { ok: false, why: `a campsite was pulled ${d.farthestM} m to a zone — the limit is ${limitM} m` };
  }
  return { ok: true };
}

async function run({ apply }) {
  let snapRows = [];
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
          `\\copy ${STAGING} (scheme, code, gj, country) FROM '${tsv}'`], { stdio: 'inherit' });
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
      // 🔴 ПІДТЯГНУТЕ ДРУКУЄТЬСЯ ОКРЕМО Й ДО ЗАПИСУ. Число, що завтра
      // стрибне, — сигнал, що полігони джерела змінились, а не що в нас
      // більше покриття.
      if (step.name === 'land layer exists') {
        if (psql(step.sql) !== 't') {
          console.error(
            `✗ шару суходолу ${LAND_LAYER} у цій базі немає — без нього не відрізнити морську зону ` +
              'від сухопутної. Його дає імпорт OSM (import-spots).',
          );
          return 1;
        }
        continue;
      }
      if (step.name === 'landless countries') {
        const gone = psql(step.sql).split('\n').filter(Boolean).map((l) => l.split('|'));
        console.log(
          gone.length
            ? `країни, де жодна зона не сухопутна, — їхніх кемпінгів не позначено ніяк: ${gone.map(([c, n]) => `${c} (${n} зон)`).join(', ')}`
            : 'країн без жодної сухопутної зони немає',
        );
        continue;
      }
      if (step.name === 'sea held by containment') {
        const [held, onLand, onlySea] = psql(step.sql).split('|').map(Number);
        console.log(
          `тримають морську зону за ВМІСТОМ (так було завжди): ${held} кемпінгів, з них ${onLand} стоять на суходолі ` +
            `за шаром, ${onlySea} не мають жодної іншої зони`,
        );
        continue;
      }
      if (step.name === 'snap kinds') {
        const wrong = Number(psql(step.sql));
        const bad = judgeSnapKinds(wrong);
        if (!bad.ok) {
          console.error(`✗ ${bad.why}`);
          return 1;
        }
        continue;
      }
      if (step.name === 'snap by country') {
        snapRows = psql(step.sql).split('\n').filter(Boolean).map((l) => {
          const [country, total, withoutSnap, placed, snapped] = l.split('|');
          return {
            country,
            total: Number(total),
            placedWithoutSnap: Number(withoutSnap),
            placed: Number(placed),
            snapped: Number(snapped),
          };
        });
        continue;
      }
      if (step.name === 'snap distances') {
        const [n, le100, le500, le1k, le3k, le5k, far] = psql(step.sql).split('|').map(Number);
        const d = { snapped: n, le100, le500, le1k, le3k, le5k, farthestM: far };
        console.log(`\n${describeSnap(d)}`);
        const bad = judgeSnap(d);
        if (!bad.ok) {
          console.error(`✗ ${bad.why}`);
          return 1;
        }
        continue;
      }
      if (step.name === 'coverage') {
        const rows = psql(step.sql).split('\n').filter(Boolean).map((l) => {
          const [country, total, missing, missingNuts3] = l.split('|');
          return {
            country,
            total: Number(total),
            missing: Number(missing),
            missingNUTS3: Number(missingNuts3),
          };
        });
        const j = judgeCoverage(rows);
        if (!j.ok) {
          console.error(`✗ ${j.why}`);
          return 1;
        }
        console.log(`\n${j.placed} із ${j.total} кемпінгів розташовано — ${j.share}%`);
        for (const r of j.short.slice(0, 10)) {
          console.log(`  ${r.country}: ${r.missing} без коду з ${r.total}`);
        }
        // 🔴 Шість країн, чий зв'язок змінився з прибиранням GISCO, —
        // завжди, а не лише коли щось погано: «було → стало» зі
        // знаменником, бо втрата покриття тут тиха за побудовою.
        {
          const tot = snapRows.reduce((n, r) => n + r.total, 0);
          const mid = snapRows.reduce((n, r) => n + r.placedWithoutSnap, 0);
          console.log(
            `\nуся база: до GISCO ${BEFORE_GISCO_ALL[1]}/${BEFORE_GISCO_ALL[0]} ${pct(BEFORE_GISCO_ALL[1], BEFORE_GISCO_ALL[0])}%  →  ` +
              `після заміни ${mid}/${tot} ${pct(mid, tot)}%  →  після підтягування ${j.placed}/${j.total} ${j.share}%`,
          );
        }
        console.log('\nшість країн, що їхали на GISCO (кемпінгів із хоч одним кодом):');
        console.log('  країна   до GISCO            після заміни         після підтягування   підлога');
        for (const t of j.table) {
          const was = t.was ? `${t.was.placed}/${t.was.total} ${t.was.share}%` : 'немає';
          const sn = snapRows.find((r) => r.country === t.country);
          const mid = sn ? `${sn.placedWithoutSnap}/${sn.total} ${pct(sn.placedWithoutSnap, sn.total)}%` : '?';
          console.log(
            `  ${t.country.padEnd(7)}  ${was.padEnd(19)}  ${mid.padEnd(19)}  ` +
              `${`${t.placed}/${t.total} ${t.share}%`.padEnd(19)}  ${t.floor}%` +
              (sn ? `   (підтягнуто ${sn.snapped})` : ''),
          );
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
  // 🔴 ДО 02.11.2026 ТУТ СТОЯЛО НАВПАКИ («Франція по NUTS3, НЕ по EMMA_ID»).
  // Воно було правдою, доки кемпінг ніс NUTS із полігонів GISCO, чия
  // ліцензія забороняє комерційне використання. Тепер кемпінг несе зону
  // MeteoAlarm, а NUTS-область попередження дістає код тієї ж зони
  // (`fetch-warnings.mjs` + `nuts-binding.mjs`), і `zone-coverage.mjs`
  // перевіряє це зчеплення на живому корпусі.
  check(vals.includes("('FR','EMMA_ID')"), 'Франція зʼєднується по EMMA_ID — зону дописує до її NUTS-областей fetch-warnings');
  check(!vals.includes("('FR','NUTS3')"), '🔴 і НЕ по NUTS3: полігонів NUTS у нас більше нема, а ліцензія GISCO забороняє комерцію');
  check(vals.includes("('BE','EMMA_ID')") && !vals.includes("('BE','NUTS2')"), 'Бельгія — лише EMMA_ID');
  check(
    vals.includes("('HR','EMMA_ID')") && vals.includes("('HR','NUTS3')"),
    'Хорватія тримає обидві: її повіти є лише як NUTS3 з OpenStreetMap',
  );
  check(!/NUTS2/.test(vals), '🔴 жодної пари з NUTS2: джерела для неї немає');
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
  // 🔴 І ДВА ВИПАДКИ ПРО `path.sep`, бо без них обидва `+ path.sep`
  // можна було прибрати безкарно — рецензія це заміряла. Без них
  // `/repo-backup/.cache/zones` при корені `/repo` вважався приватним
  // (сусідній префікс, не вкладеність), а тека під `/tmp-other`
  // читалась як тека в `/tmp`.
  check(
    cacheIsPrivate('/repo-backup/.cache/zones', '/repo', '/tmp') === false,
    '🔴 сусідній префікс кореня — НЕ вкладеність',
  );
  check(
    cacheIsPrivate('/tmp-other/repo/.cache/z', '/tmp-other/repo', '/tmp') === true,
    '🔴 `/tmp-other` — це не `/tmp`',
  );
  check(
    cachePathFor('/a/b/scripts/meteoalarm') === path.join('/a/b', '.cache', 'camp-287-zones'),
    'шлях кешу рахується від теки скрипта, два рівні вгору',
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
      seen.length === 1 && seen[0].endsWith('.part') && !seen[0].endsWith('.json'),
      '🔴 завантажене пишеться СПЕРШУ не під іменем кешу — інакше обірване лишилось би кешем',
    );
    // 🔴 І ім'я тимчасового файлу мусить бути РІЗНИМ у різних процесів.
    // Зі спільним `.part` два одночасні прогони б'ються за один файл:
    // один падає ENOENT на `rename`, другий читає недописане.
    check(
      seen[0].includes(`.${process.pid}.`),
      '🔴 тимчасовий файл носить PID — спільне ім\'я ламає два одночасні прогони',
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
    // 🔴 Тека має бути ПОРОЖНЯ, а не «лише .part». Попередня редакція
    // питала `.every(…)`, а це на порожній теці істинне за побудовою —
    // перевірка, зелена незалежно від коду. Тепер хвіст прибирає той,
    // хто його створив (`finally` при записі), тож питаємо саме це.
    check(
      readdirSync(dir2).length === 0,
      '🔴 після зриву тека кешу ПОРОЖНЯ — хвіст прибирає той, хто його створив',
    );

    // 🔴 І сторінка-помилка з кодом 200. Саме вона осідала в кеші як
    // готовий .json і ламала КОЖЕН наступний прогін — назавжди.
    // 🔴 Четвертий і пʼятий рядки існують тому, що без них половини
    // умови прикривали одна одну: `{"type":"Feature"}` не має й
    // `features`, тож обидві половини казали «ні» разом, і прибрати
    // будь-яку з них можна було безкарно — матриця показала дві вижилі
    // мутації. Нижче кожна половина лишається єдиною, хто говорить.
    for (const [label, payload, ok] of [
      ['HTML замість JSON', '<!doctype html><title>502</title>', true],
      ['JSON, але не FeatureCollection', '{"type":"Feature","properties":{}}', true],
      ['правильний type, але features немає', '{"type":"FeatureCollection"}', true],
      ['features є, але type чужий', '{"type":"Feature","features":[]}', true],
      // 🔴 Порожній перелік зон. Без власної умови він проходив сторож
      // і кешувався назавжди.
      ['FeatureCollection без жодної зони', '{"type":"FeatureCollection","features":[]}', true],
      // 🔴 І сам `res.ok`. Усі фікстури вище казали `ok: true`, тож
      // рядок `if (!res.ok) throw` не був покритий НІЧИМ: прибрати його
      // можна було безкарно, і 5xx із правдоподібним тілом осів би в
      // кеші.
      ['5xx із правдоподібним тілом', '{"type":"FeatureCollection","features":[{"properties":{"code":"X1"},"geometry":{"type":"Point","coordinates":[0,0]}}]}', false],
    ]) {
      const d = mkdtempSync(path.join(tmpdir(), 'camp-287-rehearsal-'));
      let blew = false;
      try {
        await sourceRows({
          dir: d,
          sources,
          fetchImpl: async () => ({
            ok,
            status: ok ? 200 : 503,
            arrayBuffer: async () => Buffer.from(payload),
          }),
          write,
        });
      } catch {
        blew = true;
      }
      check(blew, `🔴 ${label} — це помилка, а не дані`);
      check(
        !existsSync(path.join(d, 'TEST.json')),
        `🔴 ${label} НЕ осідає в кеші — інакше кожен наступний прогін падав би довіку`,
      );
      rmSync(d, { recursive: true, force: true });
    }

    rmSync(dir, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }

  // 🔴 ТРИ РЕЧІ, ЯКИХ ВИМАГАЄ ЗАМІНА GISCO, І КОЖНА — НА ТІЙ САМІЙ
  // `sourceRows`, що їде в прогін.
  {
    const body = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { properties: { code: 'A1' }, geometry: { type: 'Point', coordinates: [0, 0] } },
        { properties: { code: 'B2' }, geometry: { type: 'Point', coordinates: [1, 1] } },
      ],
    });
    const mk = () => mkdtempSync(path.join(tmpdir(), 'camp-gisco-rehearsal-'));
    const fetchImpl = async (url, init) => {
      asked.push({ url, init });
      return { ok: true, arrayBuffer: async () => Buffer.from(body) };
    };
    const asked = [];

    // 1. GISCO, що лишився в кеші від старого резолвера, зникає.
    const stale = mk();
    for (const f of OBSOLETE_CACHE) writeFileSync(path.join(stale, f), '{"type":"FeatureCollection","features":[]}');
    await sourceRows({
      dir: stale,
      sources: { T: { url: 'https://example.invalid/z', idField: 'code', zones: 2, file: 'T.json' } },
      fetchImpl,
    });
    check(
      OBSOLETE_CACHE.every((f) => !existsSync(path.join(stale, f))),
      '🔴 полігони GISCO, що старий резолвер лишив у кеші, видаляються при кожному прогоні',
    );
    check(OBSOLETE_CACHE.length === 2, 'і це рівно два імені, під якими старий резолвер їх клав');

    // 2. Ім'я кешу — із джерела, не зі схеми: `NUTS3.json` на сервері це GISCO.
    const named = mk();
    writeFileSync(path.join(named, 'NUTS3.json'), '{"type":"FeatureCollection","features":[{"properties":{"code":"GISCO"},"geometry":{"type":"Point","coordinates":[0,0]}}]}');
    asked.length = 0;
    const got = await sourceRows({
      dir: named,
      sources: { NUTS3: { url: 'https://example.invalid/hr', idField: 'code', zones: 2, file: 'osm-hr.json' } },
      fetchImpl,
    });
    check(
      asked.length === 1 && got.lines.every((l) => !l.includes('GISCO')) && existsSync(path.join(named, 'osm-hr.json')),
      '🔴 джерело NUTS3 тягнеться по мережі й кешується під СВОЇМ іменем — старий NUTS3.json його не підміняє',
    );

    // 2б. 🔴 Поле країни доходить до рядка. Знайдено живим прогоном: `rowsFrom`
    // уміла брати країну з поля джерела, а `sourceRows` його не передавала, тож
    // 21 ірландська зона з кодом `EI…` лишилась «країною EI», а не `IE`.
    const withCountry = mk();
    const body2 = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ properties: { code: 'EI001', country: 'IE' }, geometry: { type: 'Point', coordinates: [0, 0] } }],
    });
    const got2 = await sourceRows({
      dir: withCountry,
      sources: { T: { url: 'https://example.invalid/z', idField: 'code', countryField: 'country', zones: 1, file: 'T.json' } },
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from(body2) }),
    });
    check(
      got2.lines[0].split('\t')[3] === 'IE',
      `🔴 країна рядка — з поля джерела, не з префікса коду: ${got2.lines[0].split('\t')[3]} (EI001 — ірландська)`,
    );
    rmSync(withCountry, { recursive: true, force: true });

    // 3. Заголовки доходять до запиту; відбір іменує відкинуте й не валить прогін.
    const sel = mk();
    asked.length = 0;
    const warned = [];
    const was = console.warn;
    console.warn = (m) => warned.push(String(m));
    let picked;
    try {
      picked = await sourceRows({
        dir: sel,
        sources: {
          T: {
            url: 'https://example.invalid/z',
            headers: { 'User-Agent': 'rehearsal' },
            select: (c) => ({
              features: c.features.filter((f) => f.properties.code === 'A1'),
              rejected: [{ code: 'B2', why: 'тег змінився' }],
            }),
            idField: 'code',
            zones: 1,
            file: 'T.json',
          },
        },
        fetchImpl,
      });
    } finally {
      console.warn = was;
    }
    check(asked[0]?.init?.headers?.['User-Agent'] === 'rehearsal', 'заголовки джерела (User-Agent для Nominatim) доходять до запиту');
    check(
      picked.lines.length === 1 && picked.lines[0].includes('A1') && !picked.lines.join().includes('B2'),
      '🔴 відкинутий відбором запис коштує одного запису: решта залишається',
    );
    check(
      warned.some((w) => w.includes('B2') && w.includes('тег змінився')),
      '🔴 …і названий разом із причиною, а не лише пораховано',
    );
    // 🔴 І НА ТОМУ САМОМУ ВІДБОРІ, що їде в прогін: один повіт із 21 без
    // тега коштує одного повіту.
    const real = hrCountiesFeatures({
      features: Object.entries(HR_COUNTIES).map(([code, c], i) => ({
        type: 'Feature',
        properties: { osm_type: 'relation', osm_id: c.rel, extratags: { 'ref:nuts:3': i === 3 ? 'XX999' : code } },
        geometry: { type: 'Polygon', coordinates: [] },
      })),
    });
    check(
      real.features.length === 20 && real.rejected.length === 1 && real.rejected[0].code === 'HR024',
      `🔴 повіт, чий ref:nuts:3 змінився, відкинутий один: ${real.features.length} прийнято, ${real.rejected.map((r) => r.code)} відкинуто`,
    );

    // 🔴 І ТРИ СПОСОБИ, ЯКИМИ ПОВІТ МОЖЕ НЕ ДІЙТИ. Кожен — окремо, бо
    // без цього прибрати будь-яку з умов відбору можна було безкарно.
    const feat = (code, over = {}) => ({
      type: 'Feature',
      properties: { osm_type: 'relation', osm_id: HR_COUNTIES[code].rel, extratags: { 'ref:nuts:3': code }, ...over },
      geometry: { type: 'MultiPolygon', coordinates: [] },
    });
    const all = Object.keys(HR_COUNTIES);
    const lacking = hrCountiesFeatures({ features: all.filter((c) => c !== 'HR031').map((c) => feat(c)) });
    check(
      lacking.features.length === 20 && lacking.rejected.length === 1 &&
        lacking.rejected[0].code === 'HR031' && /absent/.test(lacking.rejected[0].why),
      '🔴 повіт, якого немає у відповіді, названий відсутнім, а не зникає мовчки',
    );
    check(hrCountiesFeatures({ features: [] }).rejected.length === 21, 'порожня відповідь відкидає всі 21, а не жодного');
    const foreign = hrCountiesFeatures({ features: [...all.map((c) => feat(c)), feat('HR031', { osm_id: 22238 })] });
    check(
      foreign.features.length === 21 && foreign.rejected.length === 1 && /not one of the counties/.test(foreign.rejected[0].why),
      '🔴 чужа relation (Zala, HU223, що теж має ref:nuts:3) не стає повітом Хорватії',
    );
    const way = hrCountiesFeatures({ features: [...all.filter((c) => c !== 'HR031').map((c) => feat(c)), feat('HR031', { osm_type: 'way' })] });
    check(
      way.features.length === 20 && way.rejected.some((r) => /not one of the counties/.test(r.why)),
      '🔴 `way` з тим самим номером — не `relation`: не приймається',
    );
    const point = hrCountiesFeatures({ features: all.map((c) => (c === 'HR031' ? { ...feat(c), geometry: { type: 'Point', coordinates: [0, 0] } } : feat(c))) });
    check(
      point.features.length === 20 && point.rejected[0]?.code === 'HR031' && /not an area/.test(point.rejected[0].why),
      '🔴 повіт, що прийшов точкою, а не площею, відкинутий — точка нічого не містить',
    );

    for (const d of [stale, named, sel]) rmSync(d, { recursive: true, force: true });
  }

  // 🔴 ПІДТЯГУВАННЯ: що в плані, що в запиті, що в числі. Поведінку запиту
  // перевіряє `--self-test-db` на справжньому PostGIS; тут — те, що можна
  // побачити без бази.
  {
    const dryNames = plan({ apply: false }).map((x) => x.name);
    const wetNames = plan({ apply: true }).map((x) => x.name);
    for (const [label, names] of [['без --apply', dryNames], ['з --apply', wetNames]]) {
      check(
        names.includes('snap by country') && names.includes('snap distances'),
        `🔴 ${label}: підтягнуте рахується й друкується окремим кроком, а не лишається внутрішністю запиту`,
      );
    }
    check(
      wetNames.indexOf('snap distances') < wetNames.indexOf('write') && wetNames.indexOf('snap by country') < wetNames.indexOf('write'),
      'і це ДО запису: після нього колонка не каже, хто підтягнутий',
    );
    check(SNAP_LIMIT_M === 5000, `межа — одна константа, 5 000 м, а не функція від даних (зараз ${SNAP_LIMIT_M})`);
    const importSql = readFileSync(path.join(HERE, '..', '..', 'apps', 'api', 'src', 'osm', 'import-spots.ts'), 'utf8');
    const theirs = /ST_DWithin\(c\.geom::geography, p\.pt::geography, (\d+)\)/.exec(importSql)?.[1];
    check(
      Number(theirs) === SNAP_LIMIT_M,
      `🔴 межа ТА САМА, що в import-spots.ts і на /legal/database (${theirs} м там, ${SNAP_LIMIT_M} м тут)`,
    );
    const sql = codesSelect();
    check(
      new RegExp(`ST_DWithin\\(k\\.geom::geography, s\\.location::geography, ${SNAP_LIMIT_M}\\)`).test(sql),
      'запит бере межу з константи, а не з власного літерала',
    );
    check(/q\.country = s\.country/.test(sql), '🔴 підтягується лише до зони СВОЄЇ країни');
    check(/NOT EXISTS/.test(sql), 'підтягується лише точка, що не стоїть у жодній зоні цієї схеми');
    check(/CREATE TABLE warning_zones_staging \(scheme text, code text, gj text, country text, land_share float8\)/.test(
      plan({ apply: false }).find((x) => x.name === 'create staging').sql), 'проміжна таблиця має колонки країни й частки суходолу');
    // 🔴 МОРСЬКІ ЗОНИ. Поведінку запиту перевіряє `--self-test-db`; тут — що крок
    // у плані, що запит каже, і що межа — одна.
    for (const [label, names] of [['без --apply', dryNames], ['з --apply', wetNames]]) {
      check(
        ['land layer exists', 'land share', 'landless countries', 'snap kinds', 'sea held by containment'].every((n) => names.includes(n)),
        `🔴 ${label}: шар суходолу перевіряється, частка суходолу рахується, країни без суходолу чистяться, а підтягнуте звіряється з родом зони`,
      );
    }
    check(
      wetNames.indexOf('land share') < wetNames.indexOf('landless countries') &&
        wetNames.indexOf('landless countries') < wetNames.indexOf('snap by country') &&
        wetNames.indexOf('snap kinds') < wetNames.indexOf('write'),
      'і в такому порядку: частка → чистка → підтягування → звірка роду → запис',
    );
    check(LAND_SHARE_MIN === 0.5, `межа суходолу — 0.5, дно двогорбого розподілу (зараз ${LAND_SHARE_MIN})`);
    check(
      new RegExp(`q\\.scheme <> 'EMMA_ID' OR q\\.land_share >= ${LAND_SHARE_MIN}`).test(codesSelect()),
      '🔴 підтягування бере лише зону з часткою суходолу від межі (повіти — суходіл за природою)',
    );
    check(/DELETE FROM warning_zones_staging/.test(landlessSql()) && /scheme = 'EMMA_ID'/.test(landlessSql()),
      'країна без суходолу втрачає зони EMMA, а не повіти');
    check(/WHERE z\.scheme = 'EMMA_ID' AND z\.land_share < 0\.5/.test(snapKindsSql()),
      '🔴 звірка роду читає рід зони з проміжної таблиці й питає про МОРСЬКІ, а не повторює умову запиту');
    check(judgeSnapKinds(0).ok === true && judgeSnapKinds(76).ok === false && /76/.test(judgeSnapKinds(76).why),
      '🔴 один підтягнутий морський код — відмова прогону, і причина називає число');
    check(judgeSnap({ farthestM: 5000 }).ok === true, 'рівно на межі — ще в межі');
    check(
      judgeSnap({ farthestM: 5001 }).ok === false && /5001 m/.test(judgeSnap({ farthestM: 5001 }).why),
      '🔴 метр за межею — відмова, і причина називає відстань',
    );
    check(judgeSnap({ farthestM: 0 }).ok === true, 'нікого не підтягнуто — теж гаразд');
    const line = describeSnap({ snapped: 904, le100: 143, le500: 453, le1k: 657, le3k: 845, le5k: 904, farthestM: 4892 });
    check(
      line.includes('904 кемпінгів') && line.includes('≤100 м 143') && line.includes('≤5 км 904') && line.includes('найдальший 4892 м') && line.includes('≤ 5000 м'),
      'рядок про підтягнуте називає скільки, розподіл за відстанню, найдальшого й межу',
    );
  }

  // 🔴 СТОРОЖ, ЩО ЇДЕ В ПРОГІН: `judgeCoverage`, а не `verdict` окремо.
  {
    const rows = [
      { country: 'FR', total: 21759, missing: 8 },
      { country: 'BE', total: 748, missing: 0 },
      { country: 'BG', total: 275, missing: 4 },
      { country: 'HR', total: 642, missing: 0, missingNUTS3: 0 },
      { country: 'HU', total: 615, missing: 0 },
      { country: 'RO', total: 567, missing: 1 },
      { country: 'DE', total: 8364, missing: 15 },
      { country: 'ES', total: 3312, missing: 10 },
      { country: 'IT', total: 4166, missing: 14 },
      { country: 'PL', total: 2085, missing: 1 },
      { country: 'NL', total: 3649, missing: 38 },
      { country: 'SE', total: 2288, missing: 2288 },
      { country: 'AT', total: 791, missing: 7 },
      { country: 'GR', total: 596, missing: 191 },
      { country: 'DK', total: 1987, missing: 5 },
    ];
    // Заповнюємо решту живих рядків країнами, що не мають підлоги, щоб
    // знаменник був справжнім (57 128), а не складений для цього тесту.
    const rest = 57128 - rows.reduce((n, r) => n + r.total, 0);
    const real = [...rows, { country: 'XX', total: rest, missing: 0 }];
    const good = judgeCoverage(real);
    check(good.ok === true && good.table.length === 6, `заміряна дійсність проходить обидві підлоги: ${good.why ?? ''}`);
    // 🔴 Хорватія ціла зникла: глобальний вердикт мовчить, прогін — ні.
    const hrGone = real.map((r) => (r.country === 'HR' ? { ...r, missing: r.total, missingNUTS3: r.total } : r));
    const bad = judgeCoverage(hrGone);
    check(
      bad.ok === false && /^HR: 0 of 642/.test(bad.why),
      `🔴 прогін відмовляє, коли зникла країна, якої глобальна підлога не бачить: ${bad.why}`,
    );
    check(
      judgeCoverage(real.map((r) => ({ ...r, missing: r.total }))).ok === false,
      'і коли зникло все — теж, за глобальною',
    );
  }

  const EXPECTED_CASES = 95;
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

/**
 * 🔴 ЗАПИТ ПРОГАНЯЄТЬСЯ НА СПРАВЖНЬОМУ POSTGIS, бо те, що він робить, —
 * відстань, країна, межа, — текстом не перевіряється. Мутація «межа ×10»
 * лишає в тексті запиту все, що перевіряє текстовий тест, і змінює
 * єдине, що важить: кого підтягнуто.
 *
 * Дві синтетичні країни на рівній місцевості (1° широти ≈ 111 км):
 *   XA — одна зона ((10,50)–(11,51)) і сусідка XB за 0.71 км на схід;
 *   XH — як Хорватія: велика зона EMMA_ID і менша NUTS3 «повіт» у ній.
 * Бази, що тримає цей тест, — його власні: створюється й знищується тут.
 */
async function selfTestDb() {
  let rc = 0;
  const cases = [];
  const check = (cond, m) => {
    cases.push(m);
    if (!cond) {
      console.error(`✗ REHEARSAL FAILED: ${m}`);
      rc = 1;
    }
  };
  const base = process.env.CAMPTRIBE_SELFTEST_PG_BASE ?? 'postgres://localhost:5432';
  const name = `camptribe_selftest_snap_${process.pid}`;
  const url = `${base}/${name}`;
  const q = (conn, sql, ...flags) =>
    execFileSync('psql', [conn, '-v', 'ON_ERROR_STOP=1', '-tAX', '-F', '|', ...flags, '-c', sql], {
      encoding: 'utf8',
    }).trim();

  q(`${base}/postgres`, `CREATE DATABASE ${name}`);
  try {
    q(url, 'CREATE EXTENSION postgis');
    q(
      url,
      `CREATE TABLE camping_spots (id int PRIMARY KEY, country text, missing_since timestamptz,
                                    location geometry(Point,4326), warning_areas text[]);
       CREATE TABLE ${STAGING} (scheme text, code text, country text, geom geometry(Geometry,4326), land_share float8);
       CREATE INDEX ON ${STAGING} USING GIST (geom);
       CREATE TABLE ${LAND_LAYER} (geom geometry(Geometry,4326))`,
    );
    const box = (x0, y0, x1, y1) =>
      `ST_GeomFromText('POLYGON((${x0} ${y0},${x1} ${y0},${x1} ${y1},${x0} ${y1},${x0} ${y0}))',4326)`;
    const zone = (scheme, code, country, g) =>
      `INSERT INTO ${STAGING} VALUES ('${scheme}','${code}','${country}',${g})`;
    q(
      url,
      [
        zone('EMMA_ID', 'XA001', 'XA', box(10, 50, 11, 51)),
        zone('EMMA_ID', 'XB001', 'XB', box(11.03, 50, 12, 51)),
        zone('EMMA_ID', 'XH001', 'XH', box(30, 50, 31, 51)),
        zone('NUTS3', 'XH031', 'XH', box(30, 50.2, 31, 51)),
        zone('EMMA_ID', 'XC001', 'XC', box(40, 50, 41, 51)),
        zone('EMMA_ID', 'XC009', 'XC', box(41.004, 50, 42, 51)),
        // XM: a land zone and, just south of it, a SEA zone (no land under it)
        zone('EMMA_ID', 'XM001', 'XM', box(50, 50, 51, 51)),
        zone('EMMA_ID', 'XM801', 'XM', box(50, 49.5, 51, 49.99)),
        // XL: like Latvia — its only zone is sea
        zone('EMMA_ID', 'XL801', 'XL', box(60, 50, 61, 51)),
      ].join(';'),
    );
    // The land layer is the land boxes and nothing else: no layer under XM801 or XL801.
    q(
      url,
      [
        box(10, 50, 11, 51), box(11.03, 50, 12, 51), box(30, 50, 31, 51), box(40, 50, 41, 51),
        box(41.004, 50, 42, 51), box(50, 50, 51, 51),
      ].map((g) => `INSERT INTO ${LAND_LAYER} VALUES (${g})`).join(';'),
    );
    // The very statements a run issues, in a run's order.
    q(url, landShareSql());
    const gone = q(url, landlessSql());
    // 1° of latitude is 111.2 km, so these are ~3.0, ~6.0 and ~1.42 km.
    const spot = (id, country, lon, lat, gone = false) =>
      `INSERT INTO camping_spots VALUES (${id},'${country}',${gone ? 'now()' : 'NULL'},ST_SetSRID(ST_MakePoint(${lon},${lat}),4326))`;
    q(
      url,
      [
        spot(1, 'XA', 10.5, 50.5), // inside
        spot(2, 'XA', 10.5, 49.973), // ~3.0 km south of the zone
        spot(3, 'XA', 10.5, 49.946), // ~6.0 km south: past the limit
        spot(4, 'XA', 11.02, 50.5), // 0.71 km from FOREIGN XB001, 1.42 km from own XA001
        spot(5, 'XA', 10.5, 49.973, true), // gone: not read at all
        spot(6, 'XH', 30.5, 50.1), // in the region, 11 km from the county
        spot(7, 'XH', 30.5, 50.195), // in the region, ~0.56 km from the county
        spot(8, 'ZZ', 10.5, 50.5), // a country with no scheme
        spot(9, 'XC', 41.003, 50.5), // between two own zones: 0.21 km from XC001, 0.07 km from XC009
        spot(10, 'XM', 50.5, 49.9925), // 0.28 km from the SEA zone, 0.83 km from the land zone
        spot(11, 'XM', 50.5, 49.7), // inside the sea zone, 33 km from any land zone
        spot(12, 'XL', 60.5, 51.02), // a country whose only zone is sea, 2.2 km off it
        spot(13, 'XL', 60.5, 50.5), // …and one inside that sea zone
      ].join(';'),
    );
    const schemes = { XA: ['EMMA_ID'], XH: ['EMMA_ID', 'NUTS3'], XC: ['EMMA_ID'], XM: ['EMMA_ID'], XL: ['EMMA_ID'] };
    const rows = Object.fromEntries(
      q(url, `SELECT id, codes, snapped, round(snap_m)::int, contained, sea_contained FROM (${codesSelect(schemes)}) c ORDER BY id`)
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [id, codes, snapped, m, contained, sea] = l.split('|');
          return [id, { codes, snapped: snapped === 't', m: m === '' ? null : Number(m), contained: Number(contained), sea: Number(sea) }];
        }),
    );

    check(rows[1].codes === '{EMMA_ID:XA001}' && !rows[1].snapped && rows[1].contained === 1,
      'a point inside a zone carries that zone and is NOT marked snapped');
    check(rows[2].codes === '{EMMA_ID:XA001}' && rows[2].snapped && rows[2].contained === 0,
      '🔴 a point ~3 km outside its country\'s only zone is pulled to it, and counted as snapped');
    check(rows[2].m >= 2900 && rows[2].m <= 3300, `…at the distance it really is (${rows[2].m} m; a geography edge is a geodesic, so a little over the 3 003 m of the parallel)`);
    check(rows[3].codes === '{}' && !rows[3].snapped,
      `🔴 a point ~6 km out is NOT pulled — the limit is ${SNAP_LIMIT_M} m and it holds (snap limit mutated ×10 turns this red)`);
    check(rows[4].codes === '{EMMA_ID:XA001}' && rows[4].m >= 1350 && rows[4].m <= 1500,
      `🔴 a point nearer a FOREIGN zone (0.71 km) takes its own country's (${rows[4].m} m), never the neighbour's`);
    check(!(5 in rows), 'a campsite that has gone missing is not read at all');
    check(rows[6].codes === '{EMMA_ID:XH001}' && !rows[6].snapped,
      'one scheme can place a point while another cannot: 11 km from the county, it stays region-only');
    check(rows[7].codes === '{EMMA_ID:XH001,NUTS3:XH031}' && rows[7].snapped && rows[7].contained === 1 && rows[7].m >= 500 && rows[7].m <= 800,
      '🔴 snapping is per SCHEME: inside the region and 0.56 km off the county, it gets the county too, and is counted snapped');
    check(rows[8].codes === '{}' && !rows[8].snapped, 'a country with no scheme is left alone');
    check(rows[9].codes === '{EMMA_ID:XC009}' && rows[9].snapped,
      '🔴 the NEAREST own zone wins, not the first by code: XC009 is 70 m away, XC001 210 m');

    // 🔴 SEA IS NOT A ZONE FOR A CAMPSITE THAT IS PULLED. Review: Latvia's four
    // zones are all sea, and 70 campsites — one 4.7 km inland — were handed
    // warnings for ships.
    const share = Object.fromEntries(
      q(url, `SELECT code, round(land_share::numeric, 2) FROM ${STAGING} ORDER BY code`).split('\n').filter(Boolean).map((l) => l.split('|')),
    );
    check(share.XA001 === '1.00' && share.XM001 === '1.00' && share.XM801 === '0.00',
      `the land share is computed from the land layer: land 1.00, sea 0.00 — got XM001 ${share.XM001}, XM801 ${share.XM801}`);
    check(share.XL801 === undefined && share.XM801 === '0.00',
      '🔴 a country whose only zone is sea has NO zones after the run\'s own clean-up, and one that has a land zone keeps its sea zone');
    check(gone === 'XL|1', `…and the clean-up names what it removed: ${gone} (Latvia is exactly this case)`);
    check(rows[10].codes === '{EMMA_ID:XM001}' && rows[10].snapped,
      `🔴 a point nearer a SEA zone (0.28 km) is pulled to the LAND zone (${rows[10].m} m), never to the sea (allow sea again and this turns red)`);
    check(rows[11].codes === '{EMMA_ID:XM801}' && !rows[11].snapped && rows[11].sea === 1,
      'containment is unchanged and counted: a point inside a sea polygon still holds it, marked as a sea hold');
    check(rows[12].codes === '{}' && !rows[12].snapped,
      '🔴 a campsite of a country with no land zone stays WITHOUT a zone, 2.2 km off its sea zone');
    check(rows[13].codes === '{}', 'and one standing inside that sea zone has none either: empty is more honest than a ship warning');
    const kinds = Number(q(url, snapKindsSql(schemes)));
    check(kinds === 0 && judgeSnapKinds(kinds).ok, 'the data guard counts no snapped sea code');
    check(judgeSnapKinds(1).ok === false && /SEA zones/.test(judgeSnapKinds(1).why), 'and fails, naming the harm, on one');
    const held = q(url, seaHeldSql(schemes)).split('|').map(Number);
    check(held[0] === 1 && held[1] === 0 && held[2] === 1,
      `the sea-hold line counts the one campsite inside a sea polygon, off the land layer, with no other zone — got ${held}`);

    // The summary the run prints, on the same rows.
    const d = q(url, snapDistancesSql(schemes)).split('|').map(Number);
    check(d[0] === 5 && d[5] === 5 && d[6] > 0 && d[6] <= SNAP_LIMIT_M,
      `the distance summary counts the 5 snapped points, all within the limit (farthest ${d[6]} m)`);
    const by = Object.fromEntries(
      q(url, snapByCountrySql(schemes)).split('\n').filter(Boolean).map((l) => {
        const [c, ...rest] = l.split('|');
        return [c, rest.map(Number)];
      }),
    );
    // total, placed without snapping, placed, snapped
    check(by.XA.join() === '4,1,3,2', `XA: 4 live, 1 placed by containment, 3 placed, 2 snapped — got ${by.XA}`);
    check(by.XH.join() === '2,2,2,1', `XH: 2 live, both placed by containment, 1 also snapped — got ${by.XH}`);

    // And the write carries the snapped codes into the column.
    q(url, updateSql(schemes));
    check(q(url, `SELECT warning_areas FROM camping_spots WHERE id = 2`) === '{EMMA_ID:XA001}',
      'the UPDATE writes the snapped code into the column');
    check(q(url, `SELECT warning_areas FROM camping_spots WHERE id = 3`) === '{}',
      'and writes an empty array, not NULL, for the one that stayed out');
  } finally {
    q(`${base}/postgres`, `DROP DATABASE IF EXISTS ${name}`);
  }

  const EXPECTED_CASES = 25;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ REHEARSAL FAILED: ${cases.length} cases ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  console.log(
    rc === 0
      ? `✓ resolve-campsite-zones self-test (PostGIS): ${cases.length} cases over the snapping`
      : `✗ resolve-campsite-zones self-test (PostGIS): ${cases.length} cases, at least one failed`,
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
    ['--self-test', '--self-test-db', '--apply'],
    'resolve-campsite-zones.mjs',
  );
  if (action.has('--self-test')) process.exit(await selfTest());
  if (action.has('--self-test-db')) process.exit(await selfTestDb());
  process.exit(await run({ apply: action.has('--apply') }));
}
