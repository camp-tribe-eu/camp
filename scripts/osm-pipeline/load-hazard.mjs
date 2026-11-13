#!/usr/bin/env node
// CAMP-502: вивантаження OSM (GeoJSONSeq) → таблиця `osm_ctx_hazard`.
//
//   DATABASE_URL=… node scripts/osm-pipeline/load-hazard.mjs --file ctx_hazard.geojsonl[.gz]
//   DATABASE_URL=… node scripts/osm-pipeline/load-hazard.mjs --file … --allow-shrink
//   node scripts/osm-pipeline/load-hazard.mjs --self-test      # справжній Postgres із PostGIS
//
// 🔴 ЧОМУ НЕ `ogr2ogr -overwrite` (рецензія #557). ogr2ogr створює колонку
// лише для тегу, який Є У ВИВАНТАЖЕННІ. Вивантаження без жодного `tunnel`
// (Мальта) давало таблицю без колонки `tunnel`, а запит картки кемпінга
// (`disturbance.ts`, скалярний підзапит у SPOT_DETAIL_SQL) читає її на
// КОЖНІЙ сторінці: `column x.tunnel does not exist` — і падає кожна сторінка
// кемпінга. До того ж `-overwrite` робить DROP живої таблиці.
//
// Тут форма таблиці НЕ ЗАЛЕЖИТЬ від вмісту файлу:
//   • таблицю створює міграція (1797100000000-Disturbance), колонки названі
//     в `HAZARD_COLUMNS`; цей скрипт її не створює й не видаляє;
//   • рядки їдуть через `COPY` у проміжну `osm_ctx_hazard_load` з тим самим
//     фіксованим переліком колонок;
//   • заміна вмісту — `DELETE` + `INSERT` в ОДНІЙ транзакції. Не `TRUNCATE`
//     і не `DROP`: вони беруть ACCESS EXCLUSIVE, і сторінки стояли б (або
//     падали) весь час завантаження. Під MVCC читач бачить старі рядки аж до
//     COMMIT, а після нього — нові; таблиця, її власник, права й індекси
//     лишаються тими самими.
//
// 🔴 ПОТРІБНІ ЛИШЕ node І psql. На бойовій машині немає ні ogr2ogr, ні osmium
// (docs/data-path-to-production.md), тож файл будується на ноутбуці
// (`CTX_LAYERS=hazard load-context.sh …`), а вантажиться будь-де.
//
// 🔴 ОДИН ЗІПСОВАНИЙ РЯДОК КОШТУЄ ОДНОГО РЯДКА: він пропускається й
// рахується, число друкується зі знаменником. Понад `BAD_LINE_BUDGET` —
// відмова: це вже не «один рядок», а обрізаний файл.
//
// 🔴 ТРИ ВІДМОВИ, ЯКІ ЛИШАЮТЬ ЖИВУ ТАБЛИЦЮ НЕДОТОРКАНОЮ:
//   • у файлі нуль придатних рядків;
//   • нове вивантаження менше за половину наявного (типовий випадок —
//     завантажили одну країну замість двадцяти семи) без `--allow-shrink`;
//   • будь-яка помилка всередині транзакції заміни.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createReadStream, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGunzip, gzipSync } from 'node:zlib';

import { chooseAction, flagValue } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

export const KNOWN_FLAGS = Object.freeze(['--self-test', '--file', '--allow-shrink']);

/** Теги, які читає запит картки. Той самий перелік — у DDL міграції (звіряє самотест). */
export const HAZARD_COLUMNS = Object.freeze([
  'name', 'highway', 'railway', 'aeroway', 'iata', 'service', 'tunnel',
]);

/** Частка рядків файлу, яку можна пропустити як зіпсовану (0,1%). */
export const BAD_LINE_BUDGET = 0.001;
/** Нове вивантаження менше за цю частку наявного — відмова без `--allow-shrink`. */
export const SHRINK_FLOOR = 0.5;

/** Помилка ВЖИВАННЯ — код 2 без стеку. */
export class UsageError extends Error {}

const GEOMETRY_DEPTH = Object.freeze({
  Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3,
});
const position = (p) =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const nested = (c, depth) =>
  depth === 0 ? position(c) : Array.isArray(c) && c.length > 0 && c.every((x) => nested(x, depth - 1));

/** Чи це геометрія, яку PostGIS прийме: тип зі списку й числа на кожному листку. */
export function validGeometry(g) {
  if (g === null || typeof g !== 'object') return false;
  const depth = GEOMETRY_DEPTH[g.type];
  if (depth === undefined || !nested(g.coordinates, depth)) return false;
  const lines = (min) => (c) => c.length >= min;
  if (g.type === 'LineString') return g.coordinates.length >= 2;
  if (g.type === 'MultiLineString') return g.coordinates.every(lines(2));
  if (g.type === 'Polygon') return g.coordinates.every(lines(4));
  if (g.type === 'MultiPolygon') return g.coordinates.every((poly) => poly.every(lines(4)));
  return true;
}

/** COPY (text): `\N` для NULL, чотири екрановані символи. */
const copyField = (v) =>
  v === null ? '\\N' : v.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

/**
 * Один рядок файлу → один рядок COPY, або `null`, якщо рядок зіпсований.
 * Порожній рядок і сам роздільник запису (0x1E) — не рядки взагалі: `undefined`.
 */
export function copyLine(raw, fid) {
  const text = raw.replace(/^\u001e/, '').trim();
  if (text === '') return undefined;
  let f;
  try { f = JSON.parse(text); } catch { return null; }
  if (f === null || typeof f !== 'object' || !validGeometry(f.geometry)) return null;
  const props = f.properties !== null && typeof f.properties === 'object' ? f.properties : {};
  const tags = HAZARD_COLUMNS.map((k) => {
    const v = props[k];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  });
  return [String(fid), ...tags, JSON.stringify(f.geometry)].map(copyField).join('\t');
}

const COLS = HAZARD_COLUMNS.join(', ');

/** Усе до даних COPY. Живої таблиці немає — відмова реченням, а не `relation does not exist`. */
export const HEAD_SQL = `
SET client_min_messages = warning;
DO $$ BEGIN
  IF to_regclass('osm_ctx_hazard') IS NULL THEN
    RAISE EXCEPTION 'osm_ctx_hazard is missing: run the migrations first (1797100000000-Disturbance creates it)';
  END IF;
END $$;
DROP TABLE IF EXISTS osm_ctx_hazard_load;
CREATE UNLOGGED TABLE osm_ctx_hazard_load (
  ogc_fid integer NOT NULL, ${HAZARD_COLUMNS.map((c) => `${c} text`).join(', ')}, geojson text NOT NULL
);
COPY osm_ctx_hazard_load (ogc_fid, ${COLS}, geojson) FROM STDIN;
`;

/** Усе після даних: добір колонок старої форми, заміна вмісту однією транзакцією, прибирання. */
export function tailSql({ sent, allowShrink }) {
  if (!Number.isInteger(sent) || sent <= 0) throw new Error(`sent must be a positive integer, got ${sent}`);
  return `\\.
-- Таблиця, яку колись створив ogr2ogr, може не мати колонки. ALTER лише коли
-- її справді бракує: він бере ACCESS EXCLUSIVE, і брати його щоразу нема чого.
DO $$ DECLARE c text; BEGIN
  FOREACH c IN ARRAY ARRAY[${HAZARD_COLUMNS.map((x) => `'${x}'`).join(', ')}] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid = to_regclass('osm_ctx_hazard') AND attname = c AND NOT attisdropped) THEN
      EXECUTE format('ALTER TABLE osm_ctx_hazard ADD COLUMN %I text', c);
    END IF;
  END LOOP;
END $$;
BEGIN;
DO $$ DECLARE got bigint; had bigint; BEGIN
  SELECT count(*) INTO got FROM osm_ctx_hazard_load;
  IF got <> ${sent} THEN
    RAISE EXCEPTION 'staging holds % rows but % were sent: the COPY did not take', got, ${sent};
  END IF;
  SELECT count(*) INTO had FROM osm_ctx_hazard;
  IF ${allowShrink ? 'false' : 'true'} AND got < had * ${SHRINK_FLOOR} THEN
    RAISE EXCEPTION 'the new export has % rows against % in the table (less than half): pass EVERY region, or --allow-shrink if this is meant', got, had;
  END IF;
END $$;
DELETE FROM osm_ctx_hazard;
INSERT INTO osm_ctx_hazard (ogc_fid, geom, ${COLS})
SELECT ogc_fid, ST_SetSRID(ST_GeomFromGeoJSON(geojson), 4326), ${COLS}
  FROM osm_ctx_hazard_load ORDER BY ogc_fid;
COMMIT;
DROP TABLE osm_ctx_hazard_load;
VACUUM (ANALYZE) osm_ctx_hazard;
`;
}

/** Коли придатних рядків немає: закрити COPY, прибрати проміжну, живу не чіпати. */
const ABORT_SQL = '\\.\nDROP TABLE osm_ctx_hazard_load;\n';

const fmt = (n) => n.toLocaleString('uk-UA').replace(/\u00a0/g, ' ');

/**
 * Завантажити файл. Повертає { rc, lines, sent, bad, text }.
 * psql отримує ОДИН потік: шапку, рядки COPY й хвіст — без проміжних файлів.
 */
export async function load({ file, dbUrl, allowShrink = false, env = process.env }) {
  const say = [];
  const input = file.endsWith('.gz')
    ? createReadStream(file).pipe(createGunzip())
    : createReadStream(file);
  const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', dbUrl, '-f', '-'],
    { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.stdout.resume();
  child.stdin.on('error', () => { /* psql вийшов раніше: причину скаже його код і stderr */ });
  const done = new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  const write = (s) => new Promise((resolve) => {
    if (child.stdin.destroyed || !child.stdin.writable) resolve();
    else if (child.stdin.write(s)) resolve();
    else child.stdin.once('drain', resolve);
  });

  await write(HEAD_SQL);
  let lines = 0, sent = 0, bad = 0;
  const firstBad = [];
  let readError = null;
  try {
    for await (const raw of createInterface({ input, crlfDelay: Infinity })) {
      const row = copyLine(raw, sent + 1);
      if (row === undefined) continue;
      lines += 1;
      if (row === null) {
        bad += 1;
        if (firstBad.length < 3) firstBad.push(lines);
        continue;
      }
      sent += 1;
      await write(`${row}\n`);
    }
  } catch (e) {
    readError = e;
  }

  const refuse = async (text) => {
    await write(ABORT_SQL);
    child.stdin.end();
    await done;
    say.push(`✗ ${text} — osm_ctx_hazard лишилась як була`);
    return { rc: 1, lines, sent, bad, text: say.join('\n') };
  };
  if (readError) return refuse(`файл не прочитався до кінця (${readError.message})`);
  if (sent === 0) return refuse(`у файлі 0 придатних рядків із ${fmt(lines)}`);
  if (bad > lines * BAD_LINE_BUDGET) {
    return refuse(`зіпсованих рядків ${fmt(bad)} із ${fmt(lines)} — понад бюджет ` +
      `${BAD_LINE_BUDGET * 100}% (перші: рядки ${firstBad.join(', ')}); це обрізаний файл, а не один рядок`);
  }

  await write(tailSql({ sent, allowShrink }));
  child.stdin.end();
  const code = await done;
  if (code !== 0) {
    say.push(`✗ psql завершився з кодом ${code} — osm_ctx_hazard лишилась як була\n${err.trim()}`);
    return { rc: 1, lines, sent, bad, text: say.join('\n') };
  }
  // 🔴 Число з БАЗИ, а не з лічильника відправленого: «відправив» ≠ «лежить».
  const n = Number(execFileSync('psql', ['-X', '-tA', '-v', 'ON_ERROR_STOP=1', dbUrl, '-c',
    'SELECT count(*) FROM osm_ctx_hazard'], { env, encoding: 'utf8' }).trim());
  if (n !== sent) {
    say.push(`✗ osm_ctx_hazard має ${fmt(n)} рядків, а відправлено ${fmt(sent)} — завантаження не взялося`);
    return { rc: 1, lines, sent, bad, text: say.join('\n') };
  }
  say.push(`✓ osm_ctx_hazard: ${fmt(n)} рядків із ${fmt(lines)} у файлі; пропущено зіпсованих: ${fmt(bad)}` +
    (bad > 0 ? ` (перші: рядки ${firstBad.join(', ')})` : ''));
  return { rc: 0, lines, sent, bad, text: say.join('\n') };
}

export async function runWith(argv, flags, { env = process.env, log = console } = {}) {
  const file = flagValue(argv, '--file');
  if (!file) throw new UsageError('без --file нема чого вантажити: --file ctx_hazard.geojsonl[.gz]');
  if (!env.DATABASE_URL) throw new UsageError('без DATABASE_URL нема куди вантажити');
  const r = await load({ file, dbUrl: env.DATABASE_URL, allowShrink: flags.has('--allow-shrink'), env });
  (r.rc === 0 ? log.log : log.error)(r.text);
  return r.rc;
}

// ── самотест на справжній базі ─────────────────────────────────────
function admin(sql) {
  return execFileSync('psql', ['-d', 'postgres', '-tAX', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** DDL живої таблиці — із файлу міграції, а не з копії тут. */
export function migrationDdl() {
  const src = readFileSync(path.join(ROOT, 'apps/api/src/migrations/1797100000000-Disturbance.ts'), 'utf8');
  const m = src.match(/HAZARD_TABLE_DDL = `([\s\S]*?)`;/);
  if (!m) throw new Error('не знайшов HAZARD_TABLE_DDL у міграції 1797100000000-Disturbance.ts');
  return m[1];
}

async function selfTest() {
  let p = 0, f = 0;
  const t = (what, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) { p += 1; console.log(`  ✓ ${what}`); }
    else { f += 1; console.error(`  ✗ ${what}: ${JSON.stringify(got)}, мало бути ${JSON.stringify(want)}`); }
  };

  // ── чисті функції ────────────────────────────────────────────────
  t('LineString з однією точкою — не геометрія', validGeometry({ type: 'LineString', coordinates: [[1, 2]] }), false);
  t('кільце з трьох точок — не геометрія',
    validGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }), false);
  t('нечислова координата — не геометрія', validGeometry({ type: 'Point', coordinates: ['a', 2] }), false);
  t('невідомий тип — не геометрія', validGeometry({ type: 'GeometryCollection', geometries: [] }), false);
  t('порожній рядок і сам роздільник запису — не рядки', [copyLine('', 1), copyLine('\u001e', 1)], [undefined, undefined]);
  t('обрізаний JSON — зіпсований рядок', copyLine('{"type":"Feature","geom', 1), null);
  t('🔴 табуляція й зворотна коса в назві не ламають COPY',
    copyLine(JSON.stringify({ type: 'Feature', properties: { name: 'A\tB\\C' },
      geometry: { type: 'Point', coordinates: [1, 2] } }), 7).split('\t').slice(0, 2), ['7', 'A\\tB\\\\C']);

  const name = `camp502fix_hazard_${process.pid}`;
  const dir = mkdtempSync(path.join(tmpdir(), 'load-hazard-selftest-'));
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
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const feature = (props, geometry) => JSON.stringify({ type: 'Feature', properties: props, geometry });
    const lineGeom = { type: 'LineString', coordinates: [[4.9, 50.005], [5.1, 50.005]] };
    const file = (nameOf, rows, { gz = false } = {}) => {
      const fp = path.join(dir, nameOf);
      const body = rows.join('\n') + (rows.length > 0 ? '\n' : '');
      writeFileSync(fp, gz ? gzipSync(body) : body);
      return fp;
    };
    const run = (fp, flags = []) => load({ file: fp, dbUrl: url, allowShrink: flags.includes('--allow-shrink') });
    const cli = (args) => {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args],
        { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } });
      return { rc: r.status, text: `${r.stdout}${r.stderr}` };
    };
    const columns = () => sql(`SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
      WHERE attrelid = 'osm_ctx_hazard'::regclass AND attnum > 0 AND NOT attisdropped`);
    // Запит картки називає сім колонок; ця проба — ті самі сім. Якщо бракує бодай однієї, psql падає.
    const readsAll = () => sql(`SELECT count(*) FROM osm_ctx_hazard x WHERE x.highway IS NOT NULL OR x.railway IS NOT NULL
      OR x.aeroway IS NOT NULL OR x.iata IS NOT NULL OR x.service IS NOT NULL OR x.tunnel IS NOT NULL OR x.name IS NOT NULL`);
    const identity = () => sql(`SELECT oid || '/' || relfilenode FROM pg_class WHERE oid = 'osm_ctx_hazard'::regclass`);
    try {
      sql('CREATE EXTENSION IF NOT EXISTS postgis');

      const none = await run(file('none.geojsonl', [feature({ highway: 'motorway' }, lineGeom)]));
      t('🔴 без таблиці — відмова реченням про міграцію',
        [none.rc, none.text.includes('run the migrations first')], [1, true]);

      sql(migrationDdl());
      t('🔴 колонки міграції — рівно ті, що вантажить скрипт',
        columns(), ['ogc_fid', 'geom', ...HAZARD_COLUMNS].join(','));
      const before = identity();

      // 🔴 ВІДТВОРЕННЯ ДЕФЕКТУ: вивантаження БЕЗ жодного tunnel / service / railway.
      const noTags = file('no-tags.geojsonl', [
        feature({ highway: 'motorway', name: 'A1' }, lineGeom),
        feature({ aeroway: 'aerodrome', iata: 'MLA' }, { type: 'Point', coordinates: [14.48, 35.86] }),
      ]);
      const first = cli(['--file', noTags]);
      t('🔴 вивантаження без tunnel/service/railway вантажиться (підпроцесом)', first.rc, 0);
      t('зелене друкує число зі знаменником', first.text.includes('2 рядків із 2 у файлі'), true);
      t('🔴 і запит, що називає всі сім колонок, на такій таблиці НЕ падає', readsAll(), '2');
      t('🔴 колонки після завантаження ті самі, що до', columns(), ['ogc_fid', 'geom', ...HAZARD_COLUMNS].join(','));
      t('геометрія приїхала з SRID 4326',
        sql('SELECT string_agg(DISTINCT ST_SRID(geom)::text, \',\') FROM osm_ctx_hazard'), '4326');
      t('тег, якого у файлі не було, це NULL, а не помилка',
        sql('SELECT count(*) FROM osm_ctx_hazard WHERE tunnel IS NULL AND service IS NULL AND railway IS NULL'), '2');

      // 🔴 Жива таблиця — та сама: ні DROP, ні TRUNCATE (вони міняють oid або relfilenode).
      t('🔴 таблицю не видалено й не обрізано: oid і relfilenode ті самі', identity(), before);

      const mixed = await run(file('mixed.geojsonl.gz', [
        feature({ railway: 'rail', tunnel: 'yes', service: 'siding' }, lineGeom),
        '{"type":"Feature","properties":{"highway":"trunk"},"geometry":{"type":"LineStr',
        feature({ highway: 'trunk' }, lineGeom),
        ...Array.from({ length: 1200 }, () => feature({ highway: 'motorway' }, lineGeom)),
      ], { gz: true }));
      t('🔴 один зіпсований рядок коштує одного рядка (і .gz читається)',
        [mixed.rc, mixed.sent, mixed.bad, sql('SELECT count(*) FROM osm_ctx_hazard')], [0, 1202, 1, '1202']);
      t('пропущене названо зі знаменником', mixed.text.includes('пропущено зіпсованих: 1'), true);
      t('теги приїхали у свої колонки',
        sql("SELECT railway || '/' || tunnel || '/' || service FROM osm_ctx_hazard WHERE railway IS NOT NULL"),
        'rail/yes/siding');

      const empty = await run(file('empty.geojsonl', []));
      t('🔴 порожній файл — відмова, і рядки на місці',
        [empty.rc, sql('SELECT count(*) FROM osm_ctx_hazard')], [1, '1202']);
      const cut = await run(file('cut.geojsonl', [feature({ highway: 'motorway' }, lineGeom), '{"type":"Fea', '{"ty']));
      t('🔴 зіпсованих понад бюджет — відмова, і рядки на місці',
        [cut.rc, cut.text.includes('понад бюджет'), sql('SELECT count(*) FROM osm_ctx_hazard')], [1, true, '1202']);

      const small = file('small.geojsonl', [feature({ highway: 'motorway' }, lineGeom)]);
      const shrunk = await run(small);
      t('🔴 удвічі менше вивантаження — відмова без --allow-shrink, і рядки на місці',
        [shrunk.rc, shrunk.text.includes('less than half'), sql('SELECT count(*) FROM osm_ctx_hazard')], [1, true, '1202']);

      // 🔴 Збій УСЕРЕДИНІ заміни: рядок, який таблиця не прийме. Старі рядки мусять лишитись.
      sql("ALTER TABLE osm_ctx_hazard ADD CONSTRAINT no_boom CHECK (name IS DISTINCT FROM 'boom')");
      const boom = await run(file('boom.geojsonl',
        Array.from({ length: 1300 }, (_, i) => feature({ highway: 'motorway', name: i === 900 ? 'boom' : 'ok' }, lineGeom))));
      t('🔴 збій посеред заміни відкочує її цілком: старі рядки на місці',
        [boom.rc, sql('SELECT count(*) FROM osm_ctx_hazard'), sql("SELECT count(*) FROM osm_ctx_hazard WHERE name = 'ok'")],
        [1, '1202', '0']);
      sql('ALTER TABLE osm_ctx_hazard DROP CONSTRAINT no_boom');

      t('з --allow-shrink менше вивантаження приймається',
        [(await run(small, ['--allow-shrink'])).rc, sql('SELECT count(*) FROM osm_ctx_hazard')], [0, '1']);
      t('проміжна таблиця прибрана', sql("SELECT to_regclass('osm_ctx_hazard_load') IS NULL"), 't');

      // 🔴 Таблиця СТАРОЇ форми (її колись створив ogr2ogr без трьох колонок) добирає їх.
      sql('DROP TABLE osm_ctx_hazard');
      sql('CREATE TABLE osm_ctx_hazard (ogc_fid serial PRIMARY KEY, geom geometry(Geometry,4326), ' +
          'name varchar, highway varchar, aeroway varchar, iata varchar)');
      t('🔴 таблиця у формі ogr2ogr (без tunnel/service/railway) після завантаження читається всіма сімома',
        [(await run(noTags)).rc, readsAll()], [0, '2']);

      t('без --file — відмова вживання', cli([]).rc, 2);
      t('невідомий прапорець — відмова вживання', cli(['--file', noTags, '--force']).rc, 2);
    } catch (e) {
      f += 1;
      console.error(`  ✗ тест на базі впав: ${(e.stderr ?? e.message).toString().trim()}`);
    } finally {
      try { admin(`DROP DATABASE IF EXISTS ${name}`); } catch { /* база тимчасова */ }
    }
  }
  rmSync(dir, { recursive: true, force: true });

  t('🔴 лічильник: усі випадки дійшли до кінця', p + f, 28);
  console.log(`load-hazard self-test: ran ${p + f}, passed ${p}, failed ${f}`);
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
  const argv = process.argv.slice(2);
  let flags;
  try {
    flags = chooseAction(argv, KNOWN_FLAGS, 'load-hazard.mjs', { takesValue: ['--file'] });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
  if (flags.has('--self-test')) process.exit(await selfTest());
  try {
    process.exit(await runWith(argv, flags));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
}
