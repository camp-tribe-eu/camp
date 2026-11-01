#!/usr/bin/env node
// CAMP-113: bring the route-POI layer of a published release into the database.
//
//   node scripts/osm-pipeline/import-route-poi.mjs                   # every member state the release holds
//   node scripts/osm-pipeline/import-route-poi.mjs lu mt             # just these
//   node scripts/osm-pipeline/import-route-poi.mjs --tag osm-2026-11-02
//   node scripts/osm-pipeline/import-route-poi.mjs --max-age-days 9  # what the timer passes
//   node scripts/osm-pipeline/import-route-poi.mjs --self-test
//
// 🔴 WHY THIS EXISTS (decision of 28.10.2026).
//
// `osm_route_poi` — fuel, charging, water, dump stations, rest areas, shops,
// food and lodging between campsites — was refreshed by hand with
// load-route-poi.sh on a machine holding all 27 extracts, and went 14+ days
// stale: the last position of ours in the freshness sentry's daily mail.
// The production machine cannot take that job (osmium, ogr2ogr, ~25 GB of
// extracts next to a live site). So the layer is now cut where the
// campsites already are — in osm-weekly.yml, from the same PBF, one country
// per job — and published in the same weekly `osm-YYYY-MM-DD` release as
// `<region>.rpoi.geojson.gz`. This file is the other half: the machine
// pulls the assets and loads them, the way import-release.mjs does for
// camping_spots. It is the same chain, not a second one, and it reuses that
// file's parts rather than copying them: the age rule (`checkAge`), the
// release lookup, the download with retries, and the streaming loader that
// replaced ogr2ogr (CAMP-332) — nothing to install on the server.
//
// 🔴 THE AGE LIMIT IS NOT DECORATION. The loader stamps every row it sees
// `last_seen_at = now`, and the freshness sentry reads exactly that column.
// An unattended import of an OLD release would stamp two million rows
// "seen just now" and the sentry would call stale data fresh — the failure
// that nearly happened to the campsites before `--max-age-days` existed.
// The limit is the tag's date, checked before any download, and the
// systemd unit passes it; the self-test reads the unit and requires the
// number to be STRICTLY under the sentry's budget for `osm_route_poi`.
//
// 🔴 ONE STAGING TABLE, EVERY COUNTRY, ONE LOADER RUN. load-route-poi.ts
// checks the WHOLE table after it writes — every kind non-empty, the LPG
// and gas layers, the list rules, the EU leak guard over 2.3 million rows
// (about 2½ minutes). Twenty-seven runs would be twenty-seven of those on
// the production machine. So each asset is streamed into a part table and
// appended to `osm_route_poi_staging`, and the loader runs ONCE, handed the
// codes of the countries that arrived: it removes unseen rows in those
// countries only (a partial release — the workflow publishes one on
// purpose when a country's build fails — must not read as "every French
// fuel station has gone").
//
// 🔴 One country's bad day costs that country only; the run still exits
// non-zero, which fails the unit, which is the alarm. A country the release
// does not hold is one of those failures, by name.

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { EU, GEOFABRIK } from '../ci/check-eu-scope.mjs';
import {
  assetDownloadUrl,
  checkAge,
  checkTag,
  conninfo,
  downloadWithRetry,
  failureReason,
  fetchJson,
  latestTag,
  loadNotes,
  loadStaging,
  makeWorkDir,
  parseMaxAge,
  quoteIdent,
  readOpt,
  releaseByTagUrl,
} from './import-release.mjs';

export const STAGING = 'osm_route_poi_staging';
/** Where one asset lands before it is appended — the loader never reads it. */
export const PART = 'osm_route_poi_staging_part';
const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

const args = process.argv.slice(2);

// 🔴 Every flag this script acts on, and the positionals it takes (country
// codes). Anything else is a typo and stops the run (CAMP-286).
export const KNOWN_FLAGS = ['--self-test', '--tag', '--max-age-days'];
export const FLAGS_WITH_VALUES = ['--tag', '--max-age-days'];
const MAX_COUNTRIES = 27;

const opt = (name, fallback = null) => readOpt(args, name, fallback);

/** The release asset the workflow publishes for one country. */
export function assetFor(code) {
  const path = GEOFABRIK[String(code).toLowerCase()];
  if (!path) throw new Error(`${code} is not an EU member state`);
  return `${path.replace('/', '-')}.rpoi.geojson.gz`;
}

/**
 * Which countries to do, smallest first — a schema surprise should fail on
 * Malta in seconds, not after Germany's 430 000 features.
 */
export function plan(requested, sizes = {}) {
  const wanted = requested.length > 0 ? requested.map((c) => c.toLowerCase()) : [...EU];
  const unknown = wanted.filter((c) => !GEOFABRIK[c]);
  if (unknown.length > 0) throw new Error(`not EU member states: ${unknown.join(', ')}`);
  const size = (c) => sizes[c] ?? Number.MAX_SAFE_INTEGER;
  return [...new Set(wanted)].sort((a, b) => size(a) - size(b) || a.localeCompare(b));
}

/**
 * Split the plan by what the release actually holds. A country without an
 * asset is a failure by name, decided here from the release listing and
 * not discovered 404 by 404.
 */
export function partition(codes, assets) {
  const byName = new Map(assets.map((a) => [a.name, Number(a.size) || 0]));
  const present = [];
  const missing = [];
  const sizes = {};
  for (const code of codes) {
    const size = byName.get(assetFor(code));
    if (size === undefined) missing.push(code);
    else {
      present.push(code);
      sizes[code] = size;
    }
  }
  return { present, missing, sizes };
}

const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_:]{0,62}$/;

/**
 * The SQL that moves one loaded part into the shared staging table.
 *
 * `first` creates the shared table (dropping last week's). Every tag column
 * of the part that the shared table lacks is added; then the rows are
 * copied and the count is asserted INSIDE the transaction, so a copy that
 * lost rows is a rollback and not a number in a log.
 */
export function appendSql({ first, partColumns, stagingColumns, expectedTotal }) {
  const bad = [...partColumns, ...stagingColumns].filter((c) => !COLUMN_NAME.test(c));
  if (bad.length > 0) throw new Error(`column names this script will not use: ${bad.join(', ')}`);
  const n = Number(expectedTotal);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('nothing to append');
  const S = quoteIdent(STAGING);
  const P = quoteIdent(PART);
  const base = ['ogc_fid', 'id', 'geom'];
  const tags = partColumns.filter((c) => !base.includes(c));
  const have = new Set(first ? [] : stagingColumns);
  const lines = ['BEGIN;'];
  if (first) {
    lines.push(`DROP TABLE IF EXISTS ${S};`);
    lines.push(`CREATE TABLE ${S} (ogc_fid serial PRIMARY KEY, id varchar, geom geometry(Geometry, 4326));`);
  }
  for (const c of tags) {
    if (!have.has(c)) lines.push(`ALTER TABLE ${S} ADD COLUMN ${quoteIdent(c)} varchar;`);
  }
  const cols = ['id', 'geom', ...tags].map(quoteIdent).join(', ');
  lines.push(`INSERT INTO ${S} (${cols}) SELECT ${cols} FROM ${P};`);
  lines.push(
    `DO $check$ BEGIN IF (SELECT count(*) FROM ${S}) <> ${n} THEN`,
    `  RAISE EXCEPTION 'staging holds % rows, ${n} expected after this country', (SELECT count(*) FROM ${S}); END IF; END $check$;`,
  );
  lines.push(`DROP TABLE ${P};`);
  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { encoding: 'utf8', stdio: 'pipe', ...opts });

/** One SQL text through psql, as an argument array — no shell between. */
function psql(db, sql, env = process.env) {
  return run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', `--dbname=${conninfo(db)}`, '-c', sql], { env });
}

function columnsOf(db, table) {
  const out = psql(
    db,
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = '${table}' ORDER BY ordinal_position`,
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Download one country, stream it into the part table, append it. Returns
 * what was staged. Throws for anything that is not a country's full load —
 * and loadStaging already refuses a file with 0 features, so an empty
 * country is a failure here, never a success with nothing in it.
 */
export async function stageCountry({ tag, code, work, db, first, total, download = downloadWithRetry, load = loadStaging }) {
  const asset = assetFor(code);
  const gz = join(work, asset);
  await download(assetDownloadUrl(tag, asset), gz);
  const loaded = await load({ table: PART, gz, db });
  rmSync(gz, { force: true });
  if (!(loaded.staged > 0)) throw new Error(`${asset}: 0 features staged`);
  const sql = appendSql({
    first,
    partColumns: columnsOf(db, PART),
    stagingColumns: first ? [] : columnsOf(db, STAGING),
    expectedTotal: total + loaded.staged,
  });
  psql(db, sql);
  return loaded;
}

/**
 * The loop: every country, one failure costs one country, and the loader
 * runs once over what arrived. `stage` and `loader` are parameters so the
 * self-test can drive the loop without a network or a database.
 */
export async function importCountries(codes, { stage, loader, say = console.log }) {
  let total = 0;
  const done = [];
  const failures = [];
  for (const code of codes) {
    const asset = assetFor(code);
    let line = `${code.toUpperCase()}  ${asset} … `;
    try {
      const loaded = await stage({ code, first: done.length === 0, total });
      total += loaded.staged;
      done.push(code);
      line += `${loaded.staged} staged${loadNotes(loaded)} (total ${total})`;
      say(line);
    } catch (err) {
      say(`${line}FAILED`);
      failures.push({ code, why: failureReason(err) });
    }
  }
  let loaderOk = false;
  if (done.length > 0) {
    say(`\nloader over ${done.length} member state(s): ${done.map((c) => c.toUpperCase()).join(' ')}`);
    try {
      say(loader(done));
      loaderOk = true;
    } catch (err) {
      failures.push({ code: 'loader', why: failureReason(err) });
    }
  }
  return { done, total, failures, loaderOk };
}

const API_DIR = fileURLToPath(new URL('../../apps/api/', import.meta.url));

/** The compiled loader — found, never built, never fetched (CAMP-332). */
export function loaderPath(apiDir = API_DIR) {
  const file = join(apiDir, 'dist', 'osm', 'load-route-poi.js');
  let present = false;
  try {
    present = statSync(file).isFile();
  } catch {
    // not there
  }
  if (!present) {
    throw new Error(
      `the compiled loader is missing: ${file}\n` +
        '  Build the API first (`npm run build --workspace=apps/api`). This script does not ' +
        'compile, install or download anything.',
    );
  }
  return file;
}

export function preflight({ env = process.env, apiDir = API_DIR } = {}) {
  const loader = loaderPath(apiDir);
  let psqlVersion;
  try {
    psqlVersion = run('psql', ['--version'], { env }).trim();
  } catch (err) {
    throw new Error(
      err.code === 'ENOENT' ? 'psql is not installed or not on PATH' : `psql does not run: ${err.message.split('\n')[0]}`,
    );
  }
  return { psql: psqlVersion, loader };
}

async function main() {
  const { psql: psqlVersion, loader } = preflight();
  console.log(`${psqlVersion}; loader ${loader}`);

  // Read before any network call: a typo must stop the run at the door.
  const maxAge = parseMaxAge(opt('max-age-days'));
  const tag = opt('tag') ?? (await latestTag());
  if (!tag) throw new Error('no release found');
  checkTag(tag);
  // 🔴 Before the listing, before any download: an old release is refused
  // here, once, and nothing below runs. See the header.
  checkAge(tag, maxAge);
  console.log(`release ${tag}`);

  const requested = args.filter((a) => /^[a-zA-Z]{2}$/.test(a));
  const assets = (await fetchJson(releaseByTagUrl(tag))).assets ?? [];
  const { present, missing, sizes } = partition(plan(requested), assets);
  const codes = plan(present, sizes);
  console.log(`${codes.length} member state(s) in the release, smallest first; ${missing.length} missing\n`);

  const work = makeWorkDir();
  let result;
  try {
    result = await importCountries(codes, {
      stage: ({ code, first, total }) => stageCountry({ tag, code, work, db: DB, first, total }),
      loader: (done) =>
        run(process.execPath, [loader, ...done.map((c) => c.toUpperCase())], {
          cwd: API_DIR,
          env: { ...process.env, DATABASE_URL: DB },
        }),
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  for (const code of missing) result.failures.push({ code, why: `release ${tag} holds no ${assetFor(code)}` });

  console.log(`\n${result.done.length} member state(s) staged (${result.total} features), ${result.failures.length} failed`);
  for (const f of result.failures) console.error(`  ✗ ${f.code}: ${f.why}`);
  if (result.failures.length > 0 || !result.loaderOk) process.exitCode = 1;
}

// ─────────────────────────────────────────────────────────────────────
// --self-test
// ─────────────────────────────────────────────────────────────────────

/**
 * A copy of this file at <dir>/scripts/osm-pipeline/copy.mjs with its three
 * sibling imports pointed at the real ones, so that it runs from a temporary
 * tree and `../../apps/api/` is a path inside that tree.
 */
function copyOfThisFile(dir) {
  const sibling = (rel) => JSON.stringify(new URL(rel, import.meta.url).href);
  const copy = join(dir, 'scripts', 'osm-pipeline', 'copy.mjs');
  mkdirSync(dirname(copy), { recursive: true });
  writeFileSync(
    copy,
    readFileSync(new URL(import.meta.url), 'utf8')
      .replace("'../lib/entrypoint.mjs'", sibling('../lib/entrypoint.mjs'))
      .replace("'../ci/check-eu-scope.mjs'", sibling('../ci/check-eu-scope.mjs'))
      .replace("'./import-release.mjs'", sibling('./import-release.mjs')),
  );
  return copy;
}

async function selfTest() {
  const checks = [];
  const ok = (name, cond, detail = '') => checks.push({ name, pass: Boolean(cond), detail });
  const threw = (fn, re) => {
    try {
      fn();
      return false;
    } catch (e) {
      return re.test(e.message);
    }
  };
  const rejects = async (p, re) => {
    try {
      await p;
      return false;
    } catch (e) {
      return re.test(e.message);
    }
  };
  const source = readFileSync(new URL(import.meta.url), 'utf8');

  // ── the names the workflow and this file must agree on ─────────────
  ok('the asset for a country is the workflow’s <region>.rpoi.geojson.gz', assetFor('mt') === 'europe-malta.rpoi.geojson.gz' && assetFor('IE') === 'europe-ireland-and-northern-ireland.rpoi.geojson.gz');
  ok('a country outside the Union has no asset', threw(() => assetFor('ch'), /not an EU member state/));
  {
    const yaml = readFileSync(new URL('../../.github/workflows/osm-weekly.yml', import.meta.url), 'utf8');
    ok('osm-weekly.yml runs extract-route-poi.sh and publishes .rpoi.geojson.gz — the asset this file downloads',
      /scripts\/osm-pipeline\/extract-route-poi\.sh/.test(yaml) && /\.rpoi\.geojson\.gz/.test(yaml), '');
    ok('…and the shell script sources the one filter list load-route-poi.sh uses',
      /^\. "\$FILTERS_FILE"$/m.test(readFileSync(new URL('./extract-route-poi.sh', import.meta.url), 'utf8')) &&
        /route-poi-filters\.sh/.test(readFileSync(new URL('./load-route-poi.sh', import.meta.url), 'utf8')));
  }

  // ── the plan ───────────────────────────────────────────────────────
  ok('plan() with nothing asked is every member state', plan([]).length === EU.length && plan([]).every((c) => GEOFABRIK[c]));
  ok('plan() sorts smallest first and dedupes', JSON.stringify(plan(['fr', 'mt', 'FR'], { fr: 100, mt: 1 })) === '["mt","fr"]');
  ok('plan() refuses a code that is not a member state', threw(() => plan(['uk']), /not EU member states: uk/));
  {
    const assets = [{ name: 'europe-malta.rpoi.geojson.gz', size: 5 }, { name: 'europe-malta.geojson.gz', size: 9 }];
    const p = partition(['mt', 'lu'], assets);
    ok('partition() names the country the release does not hold, and reads sizes from the .rpoi assets only',
      JSON.stringify(p) === '{"present":["mt"],"missing":["lu"],"sizes":{"mt":5}}', JSON.stringify(p));
  }

  // ── the append ─────────────────────────────────────────────────────
  {
    const first = appendSql({ first: true, partColumns: ['ogc_fid', 'id', 'name', 'fuel:lpg', 'geom'], stagingColumns: [], expectedTotal: 3 });
    ok('the first country creates the shared table and adds its tag columns',
      /DROP TABLE IF EXISTS "osm_route_poi_staging";/.test(first) && /CREATE TABLE "osm_route_poi_staging" \(ogc_fid serial PRIMARY KEY, id varchar, geom geometry\(Geometry, 4326\)\);/.test(first) &&
        /ADD COLUMN "name" varchar;/.test(first) && /ADD COLUMN "fuel:lpg" varchar;/.test(first), first);
    ok('…copies id, geom and the tags, and never ogc_fid',
      /INSERT INTO "osm_route_poi_staging" \("id", "geom", "name", "fuel:lpg"\) SELECT "id", "geom", "name", "fuel:lpg" FROM "osm_route_poi_staging_part";/.test(first));
    const next = appendSql({ first: false, partColumns: ['ogc_fid', 'id', 'name', 'shop', 'geom'], stagingColumns: ['ogc_fid', 'id', 'geom', 'name', 'fuel:lpg'], expectedTotal: 10 });
    ok('a later country does not drop the table and adds only the columns it lacks',
      !/DROP TABLE IF EXISTS "osm_route_poi_staging"/.test(next) && /ADD COLUMN "shop" varchar;/.test(next) && !/ADD COLUMN "name"/.test(next), next);
    ok('the running total is asserted inside the transaction, before COMMIT',
      /RAISE EXCEPTION 'staging holds % rows, 10 expected/.test(next) && next.indexOf('RAISE EXCEPTION') < next.indexOf('COMMIT;'));
    ok('the part is dropped once appended', /DROP TABLE "osm_route_poi_staging_part";/.test(next));
    ok('a column name it cannot quote safely is refused', threw(() => appendSql({ first: true, partColumns: ['id', 'geom', 'x"y'], stagingColumns: [], expectedTotal: 1 }), /column names this script will not use/));
    ok('nothing to append is refused', threw(() => appendSql({ first: true, partColumns: ['id', 'geom'], stagingColumns: [], expectedTotal: 0 }), /nothing to append/));
  }

  // ── an empty country is a failure, not a success with nothing in it ──
  {
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-rpoi-empty-'));
    const gz = join(dir, 'europe-malta.rpoi.geojson.gz');
    writeFileSync(gz, gzipSync(Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [] }))));
    // the download "succeeds" by leaving the file where it is; the real
    // loader then reads it — and refuses before any psql is spawned.
    const r = await rejects(
      stageCountry({ tag: 'osm-2026-11-02', code: 'mt', work: dir, db: 'postgres://nobody@127.0.0.1:1/none', first: true, total: 0, download: async () => gz }),
      /0 loadable feature\(s\)/,
    );
    ok('a release asset with 0 features is refused by the loader, before psql — an empty country never becomes "every POI here has gone"', r);
    rmSync(dir, { recursive: true, force: true });
  }

  // ── the loop: one failure costs one country, the loader runs once ───
  {
    const said = [];
    const loaderCalls = [];
    const res = await importCountries(['mt', 'lu', 'cy'], {
      stage: async ({ code, first, total }) => {
        if (code === 'lu') throw new Error('boom');
        return { staged: code === 'mt' ? 3 : 4, first, total, skipped: {}, blankKeys: 0, droppedKeys: [], nul: 0, badStamp: 0, badGeometry: 0 };
      },
      loader: (done) => {
        loaderCalls.push(done);
        return 'ok';
      },
      say: (l) => said.push(l),
    });
    ok('one country failing does not stop the others, and is a failure by name',
      JSON.stringify(res.done) === '["mt","cy"]' && res.failures.length === 1 && res.failures[0].code === 'lu' && /boom/.test(res.failures[0].why), JSON.stringify(res));
    ok('the loader runs ONCE, over the countries that arrived — not the ones that failed',
      JSON.stringify(loaderCalls) === '[["mt","cy"]]', JSON.stringify(loaderCalls));
    ok('the running total is what the first/next flags are computed from',
      res.total === 7 && said.some((l) => /CY .* \(total 7\)/.test(l)), said.join(' | '));
    const none = await importCountries(['mt'], { stage: async () => { throw new Error('x'); }, loader: () => { throw new Error('must not run'); }, say: () => {} });
    ok('with nothing staged the loader is not run at all', none.done.length === 0 && none.loaderOk === false && none.failures.length === 1);
    const bad = await importCountries(['mt'], { stage: async () => ({ staged: 1, skipped: {}, blankKeys: 0, droppedKeys: [], nul: 0, badStamp: 0, badGeometry: 0 }), loader: () => { throw new Error('kind food loaded nothing'); }, say: () => {} });
    ok('a loader that rolls back is a failure of the run', bad.loaderOk === false && bad.failures.some((f) => f.code === 'loader' && /food/.test(f.why)));
  }

  // ── the age limit, through a child process ─────────────────────────
  //
  // 🔴 checkAge is import-release.mjs's and is tested there; what THIS proves
  // is that main() here calls it before anything touches the network. A copy
  // in a temporary tree with an empty compiled loader and a psql that only
  // answers --version; the tag is explicit, so no request is made for it,
  // and a run that got past the age check would go on to ask GitHub for the
  // release listing (and print "release osm-…" first).
  {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'camptribe-rpoi-age-')));
    const copy = copyOfThisFile(dir);
    mkdirSync(join(dir, 'apps', 'api', 'dist', 'osm'), { recursive: true });
    writeFileSync(join(dir, 'apps', 'api', 'dist', 'osm', 'load-route-poi.js'), '');
    const binDir = join(dir, '.bin');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(process.execPath, join(binDir, 'node'));
    writeFileSync(join(binDir, 'psql'), '#!/bin/sh\necho "psql (fake) 17.0"\n', { mode: 0o755 });
    const child = (extra) => {
      try {
        return { status: 0, said: run('node', [copy, ...extra], { env: { PATH: binDir }, timeout: 20000 }) };
      } catch (e) {
        return { status: e.status, said: `${e.stdout}${e.stderr}` };
      }
    };
    const old = child(['--tag', 'osm-2020-01-01', '--max-age-days', '8', 'mt']);
    ok('an old release with --max-age-days exits non-zero, before any request, naming the age',
      typeof old.status === 'number' && old.status !== 0 && /days old, over the 8-day limit/.test(old.said) && !/^release osm-/m.test(old.said), old.said.slice(0, 300));
    ok('…and the limit is read from the flag, not from a country code', !/not EU member states/.test(old.said), old.said.slice(0, 300));
    const bad = child(['--tag', 'osm-2020-01-01', '--max-age-days', 'soon', 'mt']);
    ok('a --max-age-days that is not a number stops the run, naming the flag',
      typeof bad.status === 'number' && bad.status !== 0 && /--max-age-days wants a whole number/.test(bad.said), bad.said.slice(0, 300));
    const typo = child(['--selftest']);
    ok('a flag this script does not know is refused with exit 2, not run as the default action (CAMP-286)',
      typo.status === 2 && /--selftest/.test(typo.said), `${typo.status} ${typo.said.slice(0, 200)}`);
    const dated = child(['--tag', 'v1.2.0', '--max-age-days', '8']);
    ok('a tag whose age cannot be read is a refusal when a limit was given',
      typeof dated.status === 'number' && dated.status !== 0 && /cannot tell how old/.test(dated.said), dated.said.slice(0, 300));
    rmSync(dir, { recursive: true, force: true });
  }

  // ── the unit that ships, tied to the sentry's budget ───────────────
  {
    const unit = readFileSync(new URL('../../infra/systemd/camptribe-route-poi-import.service', import.meta.url), 'utf8');
    const line = unit.split('\n').find((l) => /^ExecStart=.*import-route-poi\.mjs/.test(l));
    const passed = line === undefined ? null : line.split('import-route-poi.mjs')[1].trim().split(/\s+/).filter(Boolean);
    const flags = passed === null ? null : passed.filter((a) => a.startsWith('-'));
    ok('the systemd unit calls this script and passes only flags it knows',
      flags !== null && flags.length > 0 && flags.every((f) => KNOWN_FLAGS.includes(f)), String(passed));
    const at = passed === null ? -1 : passed.indexOf('--max-age-days');
    ok('…and it passes --max-age-days with a value parseMaxAge accepts: the age guard is on in the unit that ships',
      at >= 0 && parseMaxAge(passed[at + 1]) !== null, String(passed));
    const fresh = await import(new URL('../ci/check-data-freshness.mjs', import.meta.url).href);
    const poi = fresh.DB_SOURCES.find((x) => x.table === 'osm_route_poi');
    const budgetDays = typeof poi?.budgetHours === 'function' ? poi.budgetHours() / 24 : poi?.budgetHours / 24;
    const days = at >= 0 ? Number(passed[at + 1]) : NaN;
    ok('…and that limit is STRICTLY under the freshness budget of osm_route_poi, read from the sentry — else the guard guards nothing',
      Number.isFinite(days) && Number.isFinite(budgetDays) && days < budgetDays,
      `unit passes --max-age-days ${days}, freshness budget of osm_route_poi is ${budgetDays} days`);
    ok('…and what the unit names as the script is the file that runs',
      line !== undefined && /\/scripts\/osm-pipeline\/import-route-poi\.mjs(\s|$)/.test(line), String(line));
    const timer = readFileSync(new URL('../../infra/systemd/camptribe-route-poi-import.timer', import.meta.url), 'utf8');
    ok('the timer fires on Tuesday, after the Monday build, and catches up a missed run',
      /^OnCalendar=Tue /m.test(timer) && /^Persistent=true$/m.test(timer), timer);
  }

  // ── no shell anywhere between this file and a process ──────────────
  ok('nothing asks a child process for a shell', !/\bshell\s*:\s*true/.test(source));
  ok('execSync and exec are not used', !/\bexecSync\s*\(/.test(source) && !/(^|[^A-Za-z_.])exec\s*\(/.test(source));

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.pass || !c.detail ? '' : `\n      ${c.detail}`}`);
  console.log(
    failed.length
      ? `\n✗ import-route-poi self-test: ${failed.length} of ${checks.length} cases FAILED`
      : `\nimport-route-poi self-test: ${checks.length} cases passed`,
  );
  return failed.length === 0;
}

// 🔴 The entry guard, written out (check-script-entrypoints.mjs reads this
// comparison), through the real path on both sides (CAMP-286).
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  // 🔴 An unknown flag is exit 2 with the flag named — never the default
  // action (CAMP-286: `--selftest`, one letter, used to import the Union),
  // and never a stack trace a timer's journal would have to be read for.
  let action;
  try {
    action = chooseAction(args, KNOWN_FLAGS, 'import-route-poi.mjs', {
      takesValue: FLAGS_WITH_VALUES,
      positional: MAX_COUNTRIES,
    });
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(2);
  }
  // 🔴 The positionals are country codes, not merely few enough (CAMP-286).
  const strays = args
    .filter((a) => !a.startsWith('-'))
    .filter((a, i, all) => all.indexOf(a) === i)
    .filter((a) => readOpt(args, 'tag', null) !== a)
    .filter((a) => readOpt(args, 'max-age-days', null) !== a)
    .filter((a) => !/^[a-z]{2}$/i.test(a));
  if (strays.length > 0) {
    throw new Error(`import-route-poi.mjs: ${strays.join(', ')} is not a two-letter country code`);
  }
  if (action.has('--self-test')) process.exit((await selfTest()) ? 0 : 1);
  else {
    main().catch((err) => {
      console.error(`::error::${failureReason(err)}`);
      process.exit(1);
    });
  }
}
