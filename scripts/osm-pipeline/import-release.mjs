#!/usr/bin/env node
// CAMP-116 / CAMP-118: bring a published campsite extract into the database.
//
//   node scripts/osm-pipeline/import-release.mjs                 # every member state
//   node scripts/osm-pipeline/import-release.mjs fr si           # just these
//   node scripts/osm-pipeline/import-release.mjs --tag osm-2026-09-24
//   node scripts/osm-pipeline/import-release.mjs --self-test
//
// 🔴 WHY THIS EXISTS.
//
// The weekly workflow builds one `.geojson.gz` per country and publishes
// it as a release asset — free, no expiry, reachable by URL. The release
// notes then told you to import it with
//
//     ./scripts/osm-pipeline/import.sh <file>.osm.pbf osm_camping_staging
//
// which asks for a `.osm.pbf` the release does not contain. Following the
// instruction meant re-downloading 25 GB of extracts to rebuild something
// the workflow had already built. Measured 24.09.2026: the EU-27 assets
// together are a few megabytes.
//
// So this does the step the instruction skipped: fetch the asset, load it
// into staging exactly as import.sh's third step does, and run the
// existing transform. Nothing new is invented — the ogr2ogr line and the
// transform are the ones already in use.
//
// 🔴 One country at a time, on purpose. The staging table is loaded with
// `-overwrite`, and import-spots.ts reads the whole of it for the country
// it is given. Two countries in staging at once would attribute one
// country's campsites to the other's argument.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EU, GEOFABRIK } from '../ci/check-eu-scope.mjs';

const REPO = 'camp-tribe-eu/camp';
const STAGING = 'osm_camping_staging';
const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/**
 * A DATABASE_URL as ogr2ogr actually wants it.
 *
 * 🔴 ogr2ogr needs a libpq key=value string, not a URL, and it fails in a
 * way that names neither: `PG:postgres://…` makes GDAL append
 * `application_name='GDAL x.y'` without a `?`, and libpq rejects the
 * result. Observed here on the first run as a bare "ERROR 1:
 * PQconnectdb failed."
 *
 * The shell pipeline solved this once in _pgconn.sh, with a comment
 * explaining that the near-miss form is the dangerous one — it prints
 * ERROR 1, the layer does not load, and everything downstream computes
 * against stale data. This is the same conversion, because the same
 * trap is one character away.
 */
export function conninfo(url) {
  if (!/^postgres(ql)?:\/\//.test(url)) return url; // already key=value
  const u = new URL(url);
  const parts = [`dbname=${decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres'}`];
  if (u.hostname) parts.push(`host=${u.hostname}`);
  if (u.port) parts.push(`port=${u.port}`);
  if (u.username) parts.push(`user=${decodeURIComponent(u.username)}`);
  if (u.password) parts.push(`password=${decodeURIComponent(u.password)}`);
  return parts.join(' ');
}

/** Asset name for a country, from the single country→extract table. */
export function assetFor(code) {
  const path = GEOFABRIK[String(code).toLowerCase()];
  if (!path) throw new Error(`${code} is not an EU member state`);
  return `${path.replace('/', '-')}.geojson.gz`;
}

/**
 * Which countries to do, in a deterministic order.
 *
 * 🔴 Smallest first. A run that is going to fail on a schema surprise
 * should fail on Malta's 18 campsites in seconds, not after France's
 * 25,793 — and on a long unattended job the difference is a night.
 */
export function plan(requested, sizes) {
  const wanted = requested.length > 0 ? requested.map((c) => c.toLowerCase()) : [...EU];
  const unknown = wanted.filter((c) => !GEOFABRIK[c]);
  if (unknown.length > 0) {
    throw new Error(`not EU member states: ${unknown.join(', ')}`);
  }
  return [...new Set(wanted)].sort(
    (a, b) => (sizes?.[a] ?? 0) - (sizes?.[b] ?? 0) || a.localeCompare(b),
  );
}

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { encoding: 'utf8', stdio: 'pipe', ...opts });

function selfTest() {
  const checks = [];
  const ok = (n, c, d = '') => checks.push({ name: n, pass: Boolean(c), detail: d });
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  // 🔴 The conversion that cost the first run. ogr2ogr answers a URL
  // with "ERROR 1: PQconnectdb failed." and nothing else.
  ok('a URL becomes a libpq key=value string',
    conninfo('postgres://localhost:5432/camptribe_dev') ===
      'dbname=camptribe_dev host=localhost port=5432',
    conninfo('postgres://localhost:5432/camptribe_dev'));
  ok('credentials survive, decoded',
    conninfo('postgresql://me:p%40ss@db.example:6543/app') ===
      'dbname=app host=db.example port=6543 user=me password=p@ss');
  ok('a key=value string is left alone',
    conninfo('dbname=x host=y') === 'dbname=x host=y');
  ok('a URL with no database falls back rather than producing dbname=',
    conninfo('postgres://localhost/').startsWith('dbname=postgres'));

  ok('an asset name is derived from the shared table',
    assetFor('fr') === 'europe-france.geojson.gz', assetFor('fr'));
  ok('Czechia keeps Geofabrik’s own spelling',
    assetFor('cz') === 'europe-czech-republic.geojson.gz', assetFor('cz'));
  ok('Ireland keeps its combined extract name',
    assetFor('ie') === 'europe-ireland-and-northern-ireland.geojson.gz');
  ok('case does not matter', assetFor('FR') === assetFor('fr'));
  ok('a non-member has no asset', throws(() => assetFor('ch')));

  ok('no argument means every member state', plan([], {}).length === 27);
  ok('an explicit list is honoured', plan(['fr', 'si'], {}).join(',') === 'fr,si');
  ok('duplicates collapse', plan(['fr', 'FR', 'fr'], {}).join(',') === 'fr');
  ok('a non-member is refused before anything is downloaded',
    throws(() => plan(['ch'], {})));

  // 🔴 The ordering rule, because it is what makes an overnight run
  // fail fast instead of failing late.
  ok('the smallest country goes first',
    plan(['fr', 'mt', 'si'], { fr: 25793, mt: 18, si: 447 }).join(',') === 'mt,si,fr');
  ok('without sizes the order is still deterministic',
    plan(['si', 'fr', 'mt'], {}).join(',') === plan(['mt', 'fr', 'si'], {}).join(','));

  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed === 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (!invokedDirectly) {
  // imported for its functions
} else if (args.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
} else {
  await main();
}

async function main() {
  const tag =
    opt('tag') ??
    run('gh', ['release', 'list', '-R', REPO, '--limit', '1', '--json', 'tagName', '-q', '.[0].tagName']).trim();
  if (!tag) throw new Error('no release found');

  const countries = plan(args.filter((a) => /^[a-zA-Z]{2}$/.test(a)), {});
  console.log(`release ${tag} — ${countries.length} member state(s)\n`);

  const work = mkdtempSync(join(tmpdir(), 'camptribe-release-'));
  let done = 0;
  const failures = [];

  try {
    for (const code of countries) {
      const asset = assetFor(code);
      process.stdout.write(`${code.toUpperCase()}  ${asset} … `);
      try {
        run('gh', ['release', 'download', tag, '-R', REPO, '-p', asset, '-D', work, '--clobber']);
        const gz = join(work, asset);
        const json = gz.replace(/\.gz$/, '');
        run('sh', ['-c', `gzip -dc '${gz}' > '${json}'`]);

        // The same load as import.sh's third step, against the same table.
        run('ogr2ogr', [
          '-f', 'PostgreSQL', `PG:${conninfo(DB)}`, json,
          '-nln', STAGING, '-overwrite',
          '-lco', 'GEOMETRY_NAME=geom', '-t_srs', 'EPSG:4326',
        ]);

        const out = run('npx', [
          'ts-node', 'src/osm/import-spots.ts', code.toUpperCase(), STAGING,
        ], { cwd: 'apps/api', env: { ...process.env, DATABASE_URL: DB } });

        const line = out.split('\n').find((l) => /inserted|updated/i.test(l))?.trim();
        console.log(line ?? 'done');
        rmSync(json, { force: true });
        rmSync(gz, { force: true });
        done++;
      } catch (err) {
        // 🔴 One country's bad day costs that country only. The same rule
        // the workflow's matrix uses, for the same reason: a night's work
        // must not be lost to one bad extract.
        console.log('FAILED');
        failures.push({ code, why: String(err.stderr || err.message).split('\n')[0] });
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(`\n${done} imported, ${failures.length} failed`);
  for (const f of failures) console.error(`  ✗ ${f.code}: ${f.why}`);
  if (failures.length > 0) process.exitCode = 1;
}
