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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EU, GEOFABRIK } from '../ci/check-eu-scope.mjs';

const REPO = 'camp-tribe-eu/camp';
const STAGING = 'osm_camping_staging';
const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

const args = process.argv.slice(2);
/**
 * The value of a `--flag value` pair.
 *
 * 🔴 A flag with no value is an error, not a default. Review found
 * `--tag` written last on the line falling silently back to "the latest
 * release" — so `import-release.mjs fr --tag` would import France from
 * whatever happened to be newest, print a tag nobody asked for, and
 * succeed. A typo must stop the run, not change what it imports.
 */
export function readOpt(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} needs a value`);
  }
  return value;
}

const opt = (name, fallback = null) => readOpt(args, name, fallback);

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
  const parts = [];
  const add = (key, value) => parts.push(`${key}=${quoteValue(value)}`);

  add('dbname', decodeURIComponent(u.pathname.replace(/^\/+/, '')) || 'postgres');
  // 🔴 `hostname` keeps the brackets of an IPv6 literal, and libpq does
  // not want them: `postgres://[::1]:5432/db` produced `host=[::1]` and
  // psql answered "could not translate host name". The Python twin never
  // had this because urlparse strips them. Same invisible-locally,
  // fatal-in-production shape as the dropped sslmode.
  if (u.hostname) add('host', u.hostname.replace(/^\[|\]$/g, ''));
  if (u.port) add('port', u.port);
  if (u.username) add('user', decodeURIComponent(u.username));
  if (u.password) add('password', decodeURIComponent(u.password));

  // 🔴 The query string is not decoration — `?sslmode=require` is the
  // whole difference between an encrypted connection and a refused one.
  //
  // Review found this dropping everything after the `?`. Locally that is
  // invisible, because a local socket needs none of it; the day the URL
  // points at a managed Postgres (every one of them requires TLS) the
  // import would fail with a message about SSL that names nothing in
  // this file. libpq's URI parameters ARE its keywords, one for one, so
  // they carry across unchanged.
  for (const key of new Set(u.searchParams.keys())) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`DATABASE_URL carries a parameter libpq cannot name: ${key}`);
    }
    // Ours win: the URL's own user/host/port are the authoritative ones.
    if (parts.some((p) => p.startsWith(`${key}=`))) continue;
    // 🔴 The LAST value, because that is what libpq does with a repeated
    // keyword — proven against psql 17: `dbname=a dbname=b` opens b. This
    // took the first, so `?sslmode=disable&sslmode=require` meant
    // "disable" here and "require" in every other client reading the same
    // URL, including our own shell twin. A TLS downgrade, and two of our
    // tools disagreeing about one string.
    const values = u.searchParams.getAll(key);
    const value = values[values.length - 1];
    // A blank parameter is dropped rather than sent as `key=''`, which
    // libpq rejects outright (`invalid sslmode value: ""`). Writing
    // nothing is what the URL meant and what it used to do.
    if (value === '') continue;
    add(key, value);
  }
  return parts.join(' ');
}

/**
 * A value as libpq's key=value grammar requires it.
 *
 * 🔴 Values were pasted in raw. libpq splits on whitespace, so a password
 * containing a space silently became a password plus a garbage keyword —
 * and a single quote or backslash corrupted everything after it. Neither
 * is exotic: a generated password is exactly where those characters come
 * from, and the failure would arrive as an authentication error nobody
 * would trace back to string concatenation.
 *
 * Quoted when it must be, bare when it need not, so the common case
 * stays readable in the logs.
 */
export function quoteValue(value) {
  const v = String(value);
  if (v !== '' && !/[\s'\\]/.test(v)) return v;
  return `'${v.replace(/([\\'])/g, '\\$1')}'`;
}

/**
 * Drop OSM tags whose key is blank.
 *
 * 🔴 One feature in 25,793 does this, and it broke the whole country.
 *
 * ogr2ogr turns each property into a column, and a blank key becomes a
 * zero-length identifier that Postgres refuses outright, with the error
 * "zero-length delimited identifier". France was the only one of
 * twenty-seven to fail, and it failed completely: 25,793 campsites lost
 * to a single malformed tag somebody typed into OpenStreetMap. Measured
 * 24.09.2026 — exactly one blank key across 724 distinct properties.
 *
 * A tag with no name carries no information by definition, so dropping it
 * loses nothing. The count is returned rather than swallowed, because a
 * sanitiser that quietly fixes things is one nobody notices has started
 * fixing a lot of things.
 */
export function stripBlankKeys(collection) {
  let dropped = 0;
  for (const feature of collection.features ?? []) {
    const props = feature.properties;
    if (!props) continue;
    for (const key of Object.keys(props)) {
      if (key.trim() === '') {
        delete props[key];
        dropped++;
      }
    }
  }
  return dropped;
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
  // 🔴 An unknown size goes LAST, not first.
  //
  // It defaulted to 0, so a country the release is missing sorted ahead
  // of Malta — and the workflow publishes partial releases on purpose
  // (`complete=partial` when a region fails). The run would then open
  // with a block of downloads guaranteed to fail, which is the exact
  // opposite of the "fail fast on Malta's 18" this sort exists for.
  // With every size unknown they are all equal and the tiebreak makes
  // the order alphabetical, as before.
  const size = (c) => sizes?.[c] ?? Number.MAX_SAFE_INTEGER;
  return [...new Set(wanted)].sort(
    (a, b) => size(a) - size(b) || a.localeCompare(b),
  );
}

/**
 * Byte size per country, read from the release itself.
 *
 * 🔴 plan() has sorted smallest-first since it was written, and until now
 * it was handed `{}` — so the sort key was always 0 and the order was
 * alphabetical: Austria first, Malta twenty-first. The comment described
 * behaviour the code never had, which is worse than no comment, because
 * the next person reads it and believes a failing run will fail fast.
 *
 * A failure to read the sizes is not a failure of the import: the order
 * degrades to alphabetical, which is what it already was, and says so.
 */
export function sizesFromAssets(assets) {
  const byName = new Map(assets.map((a) => [a.name, Number(a.size) || 0]));
  const sizes = {};
  for (const code of EU) {
    const size = byName.get(assetFor(code));
    if (size) sizes[code] = size;
  }
  return sizes;
}

function assetSizes(tag) {
  let assets;
  try {
    assets = JSON.parse(
      run('gh', ['release', 'view', tag, '-R', REPO, '--json', 'assets']),
    ).assets ?? [];
  } catch (err) {
    console.log(
      `  could not read asset sizes (${String(err.message).split('\n')[0]}) — importing alphabetically`,
    );
    return {};
  }
  const sizes = sizesFromAssets(assets);
  // 🔴 A successful read that matched nothing is the silent failure.
  //
  // The catch above only fires when gh itself fails. If the workflow's
  // asset naming ever drifts from assetFor(), every lookup misses, the
  // order quietly reverts to alphabetical and nothing is printed —
  // "passes on empty input", which is the one thing this project treats
  // as worse than failing.
  if (Object.keys(sizes).length === 0) {
    console.log(
      `  the release lists ${assets.length} asset(s), none of them ours — importing alphabetically`,
    );
  }
  return sizes;
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

  // 🔴 Everything after the `?` used to be thrown away.
  ok('sslmode survives — without it a managed Postgres refuses the connection',
    conninfo('postgres://u:p@db.neon.tech/app?sslmode=require') ===
      "dbname=app host=db.neon.tech user=u password=p sslmode=require",
    conninfo('postgres://u:p@db.neon.tech/app?sslmode=require'));
  ok('several parameters all survive',
    conninfo('postgres://h/app?sslmode=require&connect_timeout=10') ===
      'dbname=app host=h sslmode=require connect_timeout=10');
  ok('a parameter cannot overwrite the host the URL already gave',
    conninfo('postgres://real.host/app?host=evil.host') ===
      'dbname=app host=real.host');
  ok('a parameter libpq could not name is refused, not dropped',
    throws(() => conninfo('postgres://h/app?not a keyword=1')));

  // 🔴 libpq splits on whitespace, so an unquoted space is a second keyword.
  ok('a password with a space is quoted',
    conninfo('postgres://u:two%20words@h/app') ===
      "dbname=app host=h user=u password='two words'",
    conninfo('postgres://u:two%20words@h/app'));
  ok("a password with a quote and a backslash is escaped",
    quoteValue("a'b\\c") === "'a\\'b\\\\c'", quoteValue("a'b\\c"));
  ok('an ordinary value stays bare, so the log stays readable',
    quoteValue('camptribe_dev') === 'camptribe_dev');
  ok('an empty value is written as empty, not as nothing',
    quoteValue('') === "''");

  // ── the twins must agree, because two tools read one DATABASE_URL ──
  // Every case below was measured against psql 17 and against
  // _pgconn.sh; both now produce the same string.
  ok('a carriage return in a password is quoted (libpq splits on isspace)',
    conninfo('postgres://u:pa%0Dss@h/db') === "dbname=db host=h user=u password='pa\rss'",
    JSON.stringify(conninfo('postgres://u:pa%0Dss@h/db')));
  ok('an IPv6 host loses its brackets, which libpq does not want',
    conninfo('postgres://[::1]:5432/db') === 'dbname=db host=::1 port=5432',
    conninfo('postgres://[::1]:5432/db'));
  ok('a repeated parameter takes the LAST value, as libpq does',
    conninfo('postgres://h/db?sslmode=disable&sslmode=require') ===
      'dbname=db host=h sslmode=require',
    conninfo('postgres://h/db?sslmode=disable&sslmode=require'));
  ok('a blank parameter is dropped, not sent as an empty string',
    conninfo('postgres://h/db?sslmode=') === 'dbname=db host=h');
  ok('a doubled slash before the database name is not part of it',
    conninfo('postgres://h//db') === 'dbname=db host=h');
  ok('a key with a leading digit is refused, as in the shell twin',
    throws(() => conninfo('postgres://h/db?1abc=1')));

  // ── the order the countries are done in ───────────────────────────
  ok('a country the release is missing goes last, not first', (() => {
    // fr is huge but present; xx-sized mt is absent from the release.
    const order = plan(['fr', 'mt', 'si'], { fr: 25793000, si: 447000 });
    return order.join(',') === 'si,fr,mt';
  })(), plan(['fr', 'mt', 'si'], { fr: 25793000, si: 447000 }).join(','));

  // 🔴 The single malformed tag that cost France 25,793 campsites.
  ok('a blank key is dropped', (() => {
    const c = { features: [{ properties: { '': 'x', name: 'Camp' } }] };
    return stripBlankKeys(c) === 1 && !('' in c.features[0].properties) &&
      c.features[0].properties.name === 'Camp';
  })());
  ok('whitespace-only keys count as blank', (() => {
    const c = { features: [{ properties: { ' ': 1, '\t': 2, ok: 3 } }] };
    return stripBlankKeys(c) === 2 && c.features[0].properties.ok === 3;
  })());
  ok('a clean file is left untouched', (() => {
    const c = { features: [{ properties: { name: 'A' } }, { properties: { name: 'B' } }] };
    return stripBlankKeys(c) === 0 && c.features.length === 2;
  })());
  ok('a feature without properties does not crash',
    stripBlankKeys({ features: [{}, { properties: null }] }) === 0);
  ok('an empty collection is fine', stripBlankKeys({ features: [] }) === 0);
  ok('a collection with no features key is fine', stripBlankKeys({}) === 0);

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

  // 🔴 …and the sizes now actually reach it. They did not before.
  ok('sizes are read off the release assets', (() => {
    const sizes = sizesFromAssets([
      { name: 'europe-france.geojson.gz', size: 25793000 },
      { name: 'europe-malta.geojson.gz', size: 1800 },
      { name: 'something-else.txt', size: 5 },
    ]);
    return sizes.fr === 25793000 && sizes.mt === 1800 &&
      Object.keys(sizes).length === 2;
  })());
  ok('a release with no assets yields no sizes rather than throwing',
    Object.keys(sizesFromAssets([])).length === 0);
  ok('real sizes put the small country first',
    plan(['fr', 'mt'], sizesFromAssets([
      { name: 'europe-france.geojson.gz', size: 25793000 },
      { name: 'europe-malta.geojson.gz', size: 1800 },
    ])).join(',') === 'mt,fr');

  // 🔴 A flag with no value used to mean "whatever is newest".
  ok('--tag written last is an error, not a silent default',
    throws(() => readOpt(['fr', '--tag'], 'tag')));
  ok('--tag followed by another flag is an error too',
    throws(() => readOpt(['--tag', '--dry-run'], 'tag')));
  ok('--tag with a value is read', readOpt(['--tag', 'osm-2026-09-24'], 'tag') === 'osm-2026-09-24');
  ok('an absent flag still falls back', readOpt(['fr'], 'tag', 'latest') === 'latest');

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

  console.log(`release ${tag}`);
  const countries = plan(
    args.filter((a) => /^[a-zA-Z]{2}$/.test(a)),
    assetSizes(tag),
  );
  console.log(`${countries.length} member state(s), smallest first\n`);

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

        // 🔴 Before ogr2ogr sees it. See stripBlankKeys.
        const collection = JSON.parse(readFileSync(json, 'utf8'));
        const dropped = stripBlankKeys(collection);
        if (dropped > 0) {
          writeFileSync(json, JSON.stringify(collection));
          process.stdout.write(`(${dropped} blank tag${dropped === 1 ? '' : 's'} dropped) `);
        }

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
