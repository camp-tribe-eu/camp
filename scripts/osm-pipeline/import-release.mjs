#!/usr/bin/env node
// CAMP-116 / CAMP-118: bring a published campsite extract into the database.
//
//   node scripts/osm-pipeline/import-release.mjs                 # every member state
//   node scripts/osm-pipeline/import-release.mjs fr si           # just these
//   node scripts/osm-pipeline/import-release.mjs --tag osm-2026-09-24
//   node scripts/osm-pipeline/import-release.mjs --self-test
//   CAMP_TEST_DATABASE_URL=… node scripts/osm-pipeline/import-release.mjs --self-test-db
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
// into staging, and run the existing transform.
//
// 🔴 CAMP-332: NOTHING TO INSTALL ON THE SERVER. This used to shell out to
// `gh` (fetch) and `ogr2ogr` (load), and the production machine has
// neither. `gdal-bin` is 19 packages and 92 MB — AV1 and JPEG-XL codecs,
// HDF4, numpy, a MariaDB client — on a box that serves a static site: attack
// surface and patching burden, not megabytes. So:
//
//   gh        → `fetch` (built into Node 22), straight to GitHub's HTTP API
//   ogr2ogr   → PostGIS parses the GeoJSON itself (`ST_GeomFromGeoJSON`);
//               this file reads the asset as a stream and hands the rows to
//               `psql` as one `COPY`
//   npx       → `node apps/api/dist/osm/import-spots.js`, the file the deploy
//               already compiles: no ts-node (a devDependency the server does
//               not have), nothing to fetch from a registry at run time
//
// What is left outside Node is `psql`, which every other script of this
// pipeline already needs. The staging table keeps the shape ogr2ogr gave
// it — one varchar column per OSM tag, `id`, integer `@timestamp` and
// `@version`, `geom` as geometry(Geometry,4326), `ogc_fid` as the key —
// because import-spots.ts reads exactly that. See `loadStaging`.
//
// 🔴 One country at a time, on purpose. The staging table is replaced
// whole (`DROP` + `CREATE`, in one transaction), and import-spots.ts reads
// the whole of it for the country it is given. Two countries in staging at
// once would attribute one country's campsites to the other's argument.

import { execFileSync, spawn } from 'node:child_process';
import { createGunzip, gzipSync } from 'node:zlib';
import { once } from 'node:events';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { EU, GEOFABRIK } from '../ci/check-eu-scope.mjs';

const REPO = 'camp-tribe-eu/camp';
const STAGING = 'osm_camping_staging';
const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

const args = process.argv.slice(2);

// 🔴 Every flag this script acts on, and the positionals it takes: the
// country codes, as in `import-release.mjs --tag osm-2026-09-24 fr si`
// (osm-weekly.yml:403). Anything else is a typo (CAMP-286).
const KNOWN_FLAGS = ['--self-test', '--self-test-db', '--tag', '--max-age-days'];
const FLAGS_WITH_VALUES = ['--tag', '--max-age-days'];
const MAX_COUNTRIES = 27;
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
  // 🔴 BOTH SPELLINGS. `chooseAction` accepts `--tag=osm-2026-09-24` —
  // it has a case saying so — while this read it with `indexOf` and saw
  // nothing, so the tag fell back to "whatever `gh release list --limit
  // 1` returns" and the import rewrote the database from a release
  // nobody asked for, printing a tag nobody asked for (CAMP-286).
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline !== undefined) {
    const value = inline.slice(`--${name}=`.length);
    if (value === '') throw new Error(`--${name} needs a value`);
    return value;
  }
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
 * A DATABASE_URL as libpq's key=value grammar writes it.
 *
 * 🔴 This was written for ogr2ogr, which needs a key=value string, not a
 * URL, and fails in a way that names neither: `PG:postgres://…` makes
 * GDAL append `application_name='GDAL x.y'` without a `?`, and libpq
 * rejects the result. Observed here on the first run as a bare "ERROR 1:
 * PQconnectdb failed." ogr2ogr is gone (CAMP-332) and `psql` takes this
 * form just as well, so the conversion stays — one string, one reading,
 * and the self-test below that pins it against psql's own behaviour is
 * still the only thing that says what each parameter means.
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

/**
 * Is this a release tag we may put in a URL?
 *
 * 🔴 CAMP-201 became this. CodeQL flagged the old file for "indirect
 * command line injection" on 24.09 and the alert sat for eleven days, red
 * on every branch — which is how a repository teaches itself to stop
 * reading alerts. What it suspected was narrower than it said, and it was
 * measured against the real `gh`: a tag beginning with `-` became a flag
 * (`… --json tagName --version` → `unknown flag: --version`), and the `--`
 * separator fixed exactly that.
 *
 * There is no command line any more (CAMP-332), so the question changed
 * shape without going away. The tag reaches here from `--tag` or from the
 * API, i.e. from whoever can name a release, and it ends up inside a URL.
 * `..` or `/` in it would walk to another path on the same host; `?` or
 * `#` would cut the path short and ask GitHub something else.
 *
 * So it is an allowlist, not an escape: letters, digits, `.`, `_`, `-`, a
 * letter or digit first, 100 characters at most. Ours are `osm-2026-10-16`.
 * Everything else is refused before a request is made.
 */
export function checkTag(tag) {
  if (typeof tag !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(tag)) {
    throw new Error(
      `${JSON.stringify(String(tag).slice(0, 60))} is not a release tag this script will put in a URL`,
    );
  }
  return tag;
}

const API = 'https://api.github.com';

/** Where GitHub describes one release, assets and their sizes included. */
export function releaseByTagUrl(tag, repo = REPO) {
  return `${API}/repos/${repo}/releases/tags/${checkTag(tag)}`;
}

/**
 * The newest releases, newest first — not `/releases/latest`.
 *
 * 🔴 Every one of ours is a pre-release (measured 16.10.2026: all five of
 * the newest), and `/releases/latest` is defined as "the newest release
 * that is not a pre-release". It would answer 404 forever.
 */
export function recentReleasesUrl(repo = REPO) {
  return `${API}/repos/${repo}/releases?per_page=10`;
}

/** One asset of one release, by the URL a browser would use. */
export function assetDownloadUrl(tag, asset, repo = REPO) {
  return `https://github.com/${repo}/releases/download/${checkTag(tag)}/${encodeURIComponent(asset)}`;
}

/** GitHub's API wants a User-Agent, and likes to be told which version of it we mean. */
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'camptribe-import-release',
};

function httpFailure(res, url) {
  // 60 requests an hour per address when nobody is logged in; this makes two.
  const hint =
    res.status === 403 || res.status === 429
      ? ' (rate limit? set GITHUB_TOKEN — it is sent to api.github.com and nowhere else)'
      : '';
  const err = new Error(`GitHub answered HTTP ${res.status} for ${new URL(url).pathname}${hint}`);
  // The number, as a number: `isTransient` must not read it back out of prose.
  err.status = res.status;
  return err;
}

/**
 * GET a JSON document from GitHub's API.
 *
 * `fetchImpl` is a parameter so the self-test can point it at a socket
 * of its own; nothing else in this file reads it.
 *
 * 🔴 The token goes to the API host and to no other. A download URL
 * redirects to a CDN, and a token sent along there is a token given away.
 */
export async function fetchJson(url, { fetchImpl = fetch, env = process.env, timeoutMs = 30_000 } = {}) {
  const headers = { ...GH_HEADERS };
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (token && new URL(url).origin === API) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw httpFailure(res, url);
  return res.json();
}

/**
 * Save a release asset to `dest`, streaming — never held whole in memory.
 *
 * No token here, on purpose: the assets are public, and the request is
 * redirected off github.com.
 */
export async function downloadAsset(url, dest, { fetchImpl = fetch, timeoutMs = 600_000 } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': GH_HEADERS['User-Agent'] },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw httpFailure(res, url);
  if (!res.body) throw new Error(`GitHub sent no body for ${new URL(url).pathname}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

/**
 * Is this failure worth another try? A dropped connection, a timeout, a 5xx
 * or a 429 are the network having a moment; a 404 or a 403 will answer the
 * same way every time, and trying again only delays the message.
 */
export function isTransient(err) {
  const status = err?.status;
  if (typeof status === 'number') return status >= 500 || status === 429 || status === 408;
  return true;
}

/**
 * `downloadAsset`, with a second and third chance for the network's bad moments.
 *
 * 🔴 MEASURED 28.10.2026, ON THE MACHINE THIS RUNS ON: 23 of 27 countries
 * imported and four (DK, ES, IT, FR) died with the two words "fetch failed" —
 * and a fresh download of the same four files a minute later worked, 200 each,
 * 0.3 s. An attended run is rerun by the person who watched it fail. A timer
 * has no such person: one dropped connection to GitHub's CDN would have
 * cost a country its refresh for a week, and the unit would have said only
 * that it failed.
 *
 * Only the DOWNLOAD is repeated, and only for a transient failure. The load
 * and the import are not retried here: they write, and a write that failed
 * halfway is a question for a person, not for a loop.
 */
export async function downloadWithRetry(url, dest, { attempts = 3, pauseMs = 2000, ...opts } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await downloadAsset(url, dest, opts);
    } catch (err) {
      last = err;
      if (!isTransient(err) || i === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, pauseMs * i));
    }
  }
  throw last;
}

/**
 * One line that says what went wrong, with the cause the runtime hides.
 *
 * 🔴 undici reports every network failure as `TypeError: fetch failed` and
 * keeps the reason — a connect timeout, a reset, a DNS miss — in `.cause`.
 * The four failures on 28.10.2026 were printed as "fetch failed" and nothing
 * else, which is a message that cannot be acted on.
 */
export function failureReason(err) {
  const base = String(err?.stderr || err?.message || err).split('\n')[0];
  const c = err?.cause;
  const cause = c?.code || c?.message;
  return cause && !base.includes(String(cause)) ? `${base} (${cause})` : base;
}

/**
 * The one tag shape the weekly workflow creates, and the same pattern its
 * prune step uses (`osm-weekly.yml`, "Prune data releases").
 */
export const DATA_TAG = /^osm-(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The tag of the newest DATA release that is not a draft, or '' if there is
 * none.
 *
 * 🔴 "Newest release" became "newest release whose tag is a data tag". This
 * is the call an unattended timer makes every week, and the repository can
 * publish other things — a hand-made release, a deploy marker. The newest
 * of those would have been taken for an extract, and the run would have
 * failed 27 times on "asset not found": loud, but a week lost on a name.
 */
export async function latestTag(opts) {
  const list = await fetchJson(recentReleasesUrl(), opts);
  const first = Array.isArray(list)
    ? list.find((r) => r && !r.draft && typeof r.tag_name === 'string' && DATA_TAG.test(r.tag_name))
    : undefined;
  return first?.tag_name ?? '';
}

/** Days from the release's UTC date to `now`, or null when the tag carries no date. */
export function releaseAgeDays(tag, now = Date.now()) {
  const m = String(tag).match(DATA_TAG);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Date.UTC rolls 31 February over to March; a tag naming it names no day.
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return (now - t) / 86_400_000;
}

/** `--max-age-days` as a whole number of days, or null when it was not given. */
export function parseMaxAge(raw) {
  if (raw === null || raw === undefined) return null;
  if (!/^[1-9][0-9]{0,2}$/.test(String(raw))) {
    throw new Error(`--max-age-days wants a whole number of days (1 to 999), not ${JSON.stringify(String(raw).slice(0, 20))}`);
  }
  return Number(raw);
}

/**
 * Refuse a release that is older than the weekly cycle allows.
 *
 * 🔴 WHY AN UNATTENDED IMPORT NEEDS THIS, AND AN ATTENDED ONE DOES NOT.
 *
 * Every row an import touches gets `last_seen_at = <the moment this run
 * started>` — not the date of the extract. A person running it by hand has
 * just read the release page and knows how old it is. A timer does not:
 * if the Monday workflow fails for three weeks, the timer re-imports the
 * same old release every week, stamps all 63 000 rows "seen just now", and
 * the freshness check — which reads exactly that column — reports the
 * campsites green while the data under it is a month old. The one number
 * that is supposed to say "this is stale" would be written by the thing
 * that makes it stale.
 *
 * So the age is the TAG's, which is the day the extract was built and is
 * the only date this script can read before it downloads anything. Over the
 * limit it stops, names the release, and exits non-zero — the unit fails,
 * which is the alarm. Not given, nothing is checked: the by-hand run keeps
 * working on any tag, including an old one on purpose.
 */
export function checkAge(tag, maxAgeDays, now = Date.now()) {
  if (maxAgeDays === null || maxAgeDays === undefined) return;
  const age = releaseAgeDays(tag, now);
  if (age === null) {
    throw new Error(
      `cannot tell how old ${JSON.stringify(tag)} is (it is not osm-YYYY-MM-DD) — ` +
        '--max-age-days was given, so an age that cannot be proved is a refusal',
    );
  }
  if (age < 0) {
    throw new Error(`release ${tag} is dated in the future (${age.toFixed(1)} days) — refusing`);
  }
  if (age > maxAgeDays) {
    throw new Error(
      `release ${tag} is ${age.toFixed(1)} days old, over the ${maxAgeDays}-day limit — the weekly ` +
        'extract has not been published. Importing it would stamp last_seen_at "now" on old data ' +
        'and the freshness check would call it fresh. Nothing has been imported.',
    );
  }
}

export async function assetSizes(tag, opts) {
  let assets;
  try {
    assets = (await fetchJson(releaseByTagUrl(tag), opts)).assets ?? [];
  } catch (err) {
    console.log(
      `  could not read asset sizes (${String(err.message).split('\n')[0]}) — importing alphabetically`,
    );
    return {};
  }
  const sizes = sizesFromAssets(assets);
  // 🔴 A successful read that matched nothing is the silent failure.
  //
  // The catch above only fires when the request itself fails. If the
  // workflow's asset naming ever drifts from assetFor(), every lookup
  // misses, the order quietly reverts to alphabetical and nothing is
  // printed — "passes on empty input", which is the one thing this
  // project treats as worse than failing.
  if (Object.keys(sizes).length === 0) {
    console.log(
      `  the release lists ${assets.length} asset(s), none of them ours — importing alphabetically`,
    );
  }
  return sizes;
}

// ─────────────────────────────────────────────────────────────────────
// CAMP-332 — reading the asset as a stream
// ─────────────────────────────────────────────────────────────────────
//
// 🔴 THE FORMAT, MEASURED 16.10.2026 on the 27 assets of osm-2026-10-16
// (48 872 features, 35.8 MB unpacked): ONE LINE, no newline anywhere, a
// minified `{"type":"FeatureCollection","features":[{…},{…}]}` written by
// `JSON.stringify` in normalise-export.mjs. It is NOT GeoJSON Lines, so
// "read it line by line" reads the whole file as one line. The largest
// file is France: 12 968 features, 10.3 MB.
//
// So the reader has to find the feature boundaries itself, and it does it
// the plain way: it walks the text once, tracking string state, escapes
// and bracket nesting, and hands out one `features[i]` at a time. Memory
// is one feature, whatever the size of the country.

/** The open bracket each close bracket must meet. */
const OPENER = { 125: 123, 93: 91 }; // } → {   ] → [

/** A JSON object key, escapes decoded; the raw text if it will not decode. */
function decodeKey(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

/**
 * The text of each element of a FeatureCollection's `features` array, one
 * at a time, from a stream of chunks (Buffers or strings).
 *
 * 🔴 STRICT ABOUT THE STRUCTURE, TOLERANT OF ONE BAD RECORD. A feature
 * whose own JSON is broken costs that feature (readFeature reports it);
 * a file whose brackets do not balance, that ends mid-feature, that has
 * no `features` array or has anything after the closing brace, cannot be
 * trusted to say where records start, so it THROWS — and nothing of it
 * may be committed. A file cut short at a record boundary is the case
 * that matters: every record read so far is perfectly good, and
 * importing them would tell import-spots.ts that every campsite after the
 * cut has disappeared.
 */
export async function* featureTexts(chunks) {
  const decoder = new StringDecoder('utf8');
  const stack = []; // open brackets, as char codes
  let inString = false;
  let escaped = false;
  let raw = ''; // the string being read, when it is a child of the top object
  let keepRaw = false;
  let lastString = '';
  let key = null; // the key whose value is being read at depth 1
  let phase = 'start'; // start → top → array → top → done
  let sawFeatures = false;
  let parts = []; // the pieces of the feature being captured
  let from = -1; // where it begins in the chunk being read; -1 = not inside one

  function* scan(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);

      if (inString) {
        if (keepRaw && !(c === 34 && !escaped)) raw += s[i];
        if (escaped) escaped = false;
        else if (c === 92) escaped = true; // \
        else if (c === 34) {
          inString = false;
          if (keepRaw) lastString = raw;
        }
        continue;
      }

      switch (c) {
        case 34: // "
          if (phase === 'start' || phase === 'done') throw new Error('not a JSON object');
          if (phase === 'array' && stack.length === 2) {
            throw new Error('"features" holds something that is not an object');
          }
          inString = true;
          escaped = false;
          raw = '';
          keepRaw = stack.length === 1;
          break;
        case 123: // {
          if (phase === 'done') throw new Error('data after the closing brace of the FeatureCollection');
          if (phase === 'start') phase = 'top';
          else if (phase === 'array' && stack.length === 2) from = i;
          stack.push(c);
          break;
        case 91: // [
          if (phase === 'start' || phase === 'done') throw new Error('not a JSON object');
          if (phase === 'array' && stack.length === 2) {
            throw new Error('"features" holds something that is not an object');
          }
          if (phase === 'top' && stack.length === 1 && key === 'features') {
            if (sawFeatures) throw new Error('two "features" arrays');
            sawFeatures = true;
            phase = 'array';
          }
          stack.push(c);
          break;
        case 125: // }
        case 93: // ]
          if (stack.pop() !== OPENER[c]) throw new Error('brackets do not match');
          if (from >= 0 && stack.length === 2) {
            parts.push(s.slice(from, i + 1));
            const text = parts.join('');
            parts = [];
            from = -1;
            yield text;
          } else if (phase === 'array' && stack.length === 1) {
            phase = 'top';
          } else if (stack.length === 0) {
            phase = 'done';
          }
          break;
        case 58: // :
          if (stack.length === 1 && phase === 'top') key = decodeKey(lastString);
          break;
        case 44: // a comma between values says nothing the brackets do not
        case 32: // whitespace
        case 9:
        case 10:
        case 13:
          break;
        case 65279: // a byte-order mark, once, in front
          if (phase !== 'start') throw new Error('unexpected byte-order mark');
          break;
        default:
          // The start of a number, `true`, `false` or `null`.
          if (phase === 'start') throw new Error('not a JSON object');
          if (phase === 'done') throw new Error('data after the closing brace of the FeatureCollection');
          if (phase === 'array' && stack.length === 2) {
            throw new Error('"features" holds something that is not an object');
          }
      }
    }
    if (from >= 0) {
      parts.push(s.slice(from));
      from = 0;
    }
  }

  for await (const chunk of chunks) {
    yield* scan(typeof chunk === 'string' ? chunk : decoder.write(chunk));
  }
  yield* scan(decoder.end());

  if (phase !== 'done') {
    throw new Error(`the file ends inside the FeatureCollection (${phase}, ${stack.length} bracket(s) open)`);
  }
  if (!sawFeatures) throw new Error('no "features" array — this is not a FeatureCollection');
}

/** A gzip file as a stream of chunks. Errors from either end reach the reader. */
export async function* gunzipChunks(path) {
  const src = createReadStream(path);
  const gz = createGunzip();
  src.on('error', (err) => gz.destroy(err));
  src.pipe(gz);
  try {
    yield* gz;
  } finally {
    src.destroy();
    gz.destroy();
  }
}

/** How many levels of arrays hold the positions of each GeoJSON geometry. */
const COORDINATE_DEPTH = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };

/**
 * Why a GeoJSON geometry cannot be trusted as a place on a map — or null.
 *
 * 🔴 THIS IS NOT REDUNDANT WITH POSTGIS, and measured not to be. Handed
 * `{"type":"Point","coordinates":["x","y"]}`, `ST_GeomFromGeoJSON` does not
 * refuse: it answers `POINT(0 0)` — a campsite in the Gulf of Guinea, with
 * a page, a URL and a slug (and CAMP-87 forbids moving a URL afterwards).
 * `[null,null]` gives the same point, `[["0","0"]]`-shaped rings are read
 * as zeros, an unclosed ring is accepted as it is, and a ring of one point
 * is a polygon. PostGIS 3.6.4, 16.10.2026. ogr2ogr, given the same, logged
 * an error and left the geometry NULL.
 *
 * So the shapes are checked here, record by record, and a record that
 * fails is skipped and counted. What is NOT checked is what only a
 * geometry engine can tell (an empty polygon, a ring that crosses itself):
 * the database does that, through the function in stagingSql, and counts it.
 *
 * Strict where ogr2ogr was kind: a position is exactly two finite numbers
 * (osmium writes no elevation, and a third would give the column a Z the
 * importer has never seen), and a ring is closed and has four positions.
 * GDAL closed a ring by itself and said so on stderr with exit code 0;
 * closing it is making up a vertex.
 */
export function geometryProblem(g) {
  if (g === null || typeof g !== 'object' || Array.isArray(g)) return 'geometry is not an object';
  if (g.type === 'GeometryCollection') {
    if (!Array.isArray(g.geometries)) return 'GeometryCollection has no geometries';
    for (const part of g.geometries) {
      const why = geometryProblem(part);
      if (why) return why;
    }
    return null;
  }
  const depth = COORDINATE_DEPTH[g.type];
  if (depth === undefined) return `geometry type ${JSON.stringify(g.type)} is not one GeoJSON has`;
  const isPosition = (c) =>
    Array.isArray(c) && c.length === 2 && c.every((n) => typeof n === 'number' && Number.isFinite(n));
  const walk = (c, d) => (d === 0 ? isPosition(c) : Array.isArray(c) && c.every((x) => walk(x, d - 1)));
  if (!walk(g.coordinates, depth)) return 'a position is not two finite numbers';
  const lines = { LineString: [g.coordinates], MultiLineString: g.coordinates }[g.type];
  if (lines && lines.some((l) => l.length < 2)) return 'a line has fewer than two positions';
  const rings = { Polygon: g.coordinates, MultiPolygon: g.coordinates?.flat() }[g.type];
  if (rings) {
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    if (rings.some((r) => r.length < 4)) return 'a ring has fewer than four positions';
    if (rings.some((r) => !same(r[0], r[r.length - 1]))) return 'a ring is not closed';
  }
  return null;
}

/**
 * One feature, read and checked. NEVER THROWS: a bad record is a result,
 * because one bad record costs one record and never the whole country.
 *
 * What a record must have, and why each is not optional:
 *   - a string `id`. import-spots.ts reads `WHERE id IS NOT NULL`, so a
 *     row without one would sit in staging and never be imported.
 *   - a geometry that is a place: see geometryProblem. No location, no
 *     campsite page, and a wrong location is worse than none.
 * Everything else is a tag.
 *
 * Blank tag keys are removed by stripBlankKeys, the one place that rule
 * lives, and counted.
 */
export function readFeature(text) {
  let f;
  try {
    f = JSON.parse(text);
  } catch {
    return { skip: 'feature is not valid JSON' };
  }
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(f)) return { skip: 'feature is not an object' };
  if (typeof f.id !== 'string' || f.id === '') return { skip: 'feature has no string id' };
  if (!isObject(f.geometry)) return { skip: 'feature has no geometry' };
  const unreadable = geometryProblem(f.geometry);
  if (unreadable) return { skip: `feature has an unreadable geometry (${unreadable})` };
  const props = f.properties ?? {};
  if (!isObject(props)) return { skip: 'properties is not an object' };
  const blank = stripBlankKeys({ features: [{ properties: props }] });
  return { id: f.id, geometry: JSON.stringify(f.geometry), props, blank };
}

/**
 * PASS 1. Walk the whole file once and learn what the table must look
 * like: which tag keys exist, how many rows there will be, what had to
 * be skipped. Nothing is kept per feature but its keys.
 *
 * A table needs every column before the first row goes in, and a country
 * is not known to have no `fixme` tag until its last feature is read —
 * hence two passes over a file that is a few megabytes, rather than one
 * pass and a guess.
 */
export async function scanFeatures(chunks) {
  const keys = new Set();
  const skipped = {};
  let rows = 0;
  let blankKeys = 0;
  for await (const text of featureTexts(chunks)) {
    const r = readFeature(text);
    if (r.skip) {
      skipped[r.skip] = (skipped[r.skip] ?? 0) + 1;
      continue;
    }
    rows++;
    blankKeys += r.blank;
    for (const k of Object.keys(r.props)) keys.add(k);
  }
  return { keys, rows, skipped, blankKeys };
}

/** Postgres's NAMEDATALEN - 1: a longer identifier is cut, silently. */
const MAX_IDENT_BYTES = 63;
/** `tables can have at most 1600 columns`. */
const MAX_COLUMNS = 1600;
/** Columns this loader makes itself, so no tag may take their names. */
const RESERVED = ['ogc_fid', 'id', 'geom', '@timestamp', '@version'];

/**
 * An OSM key as ogr2ogr named its column: lower case, and `'` `-` `#`
 * written as `_`. ASCII ONLY, as ogr2ogr's own `tolower` is — measured:
 * `payment:sofortüberweisung` came out of it unchanged.
 *
 * Kept, not tidied away, because the names ARE the contract: the
 * importer reads `tags['addr:city']`, backfill-contact.ts reads
 * `st."addr:street"`, and nobody may rename a column under them.
 */
export function launder(key) {
  return key.replace(/[A-Z]/g, (ch) => ch.toLowerCase()).replace(/['\-#]/g, '_');
}

/**
 * Which column each tag key gets — decided once, from every key in the
 * file, and applied to every row.
 *
 * 🔴 TWO KEYS CAN LAUNDER TO ONE NAME, and in today's data they do:
 * `fixme`/`FIXME` in five countries, `Price`/`price`, `ref:cin`/`ref:CIN`,
 * `note:de`/`note:DE`, `payment:Campingcheques`/`…CampingCheques`
 * (measured 16.10.2026). ogr2ogr renames the later one `fixme2` and
 * says so on stderr with exit code 0 — and WHICH one is "later" is GDAL's
 * internal field order, not the file's. Measured in the Netherlands: the
 * single `FIXME` feature took the name `fixme` and the fourteen real
 * `fixme` tags went to `fixme2`.
 *
 * Here a key that is already in its canonical spelling claims the name
 * first and the rest follow in code-unit order, so the same data gives
 * the same columns whatever order the features come in. Nothing is lost
 * and nothing is merged: every key keeps a column of its own.
 *
 * Returned: the columns, whether the two integer attributes exist at all
 * (a release built before CAMP-256 has no `@timestamp`, and import-spots
 * reports that by the column's ABSENCE), and the keys that could not
 * have a column — a control character, or a name longer than Postgres
 * keeps. Those are counted, never swallowed.
 */
export function planColumns(keys) {
  const hasStamp = keys.has('@timestamp');
  const hasVersion = keys.has('@version');
  const taken = new Set(RESERVED);
  const columns = [];
  const dropped = [];
  const wanted = [...keys].filter((k) => k !== '@timestamp' && k !== '@version');
  const canonical = (k) => (launder(k) === k ? 0 : 1);
  wanted.sort((a, b) => canonical(a) - canonical(b) || (a < b ? -1 : a > b ? 1 : 0));
  for (const key of wanted) {
    const base = launder(key);
    if (/[\u0000-\u001f\u007f]/.test(key) || base.trim() === '') {
      dropped.push(key);
      continue;
    }
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
    if (Buffer.byteLength(name) > MAX_IDENT_BYTES) {
      dropped.push(key);
      continue;
    }
    taken.add(name);
    columns.push({ key, name });
  }
  const total = columns.length + 2 + (hasStamp ? 1 : 0) + (hasVersion ? 1 : 0) + 1;
  if (total > MAX_COLUMNS) {
    throw new Error(
      `${columns.length} distinct tag keys would need ${total} columns; Postgres allows ${MAX_COLUMNS}`,
    );
  }
  return { columns, hasStamp, hasVersion, dropped };
}

/** An identifier, quoted so that nothing in it is read as SQL. */
export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** The table name this script will build SQL around, before any quoting. */
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/**
 * A value as COPY's text format wants it: backslash, tab, newline and
 * carriage return escaped, nothing else touched.
 *
 * 🔴 An unescaped tab in one tag would shift every column after it, and
 * an unescaped newline would split a row in two — and COPY would either
 * refuse the file or, worse, accept a row that says something else. The
 * backslash is the escape character itself, so it goes first in the
 * pattern and is doubled: a tag whose value is `\N` must not read as NULL.
 */
export function copyText(value) {
  return value.replace(/[\\\n\r\t]/g, (ch) => COPY_ESCAPES[ch]);
}
const COPY_ESCAPES = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const COPY_NULL = '\\N';

/**
 * One feature as one line of COPY data, in the plan's column order.
 *
 * `tally` receives what had to be changed to make the row loadable, so
 * that a fix is a number somebody can read and never a silence:
 *   nul        a NUL byte removed — PostgreSQL text cannot hold one
 *   badStamp   `@timestamp`/`@version` present but not an integer that fits
 */
export function copyLine(feature, plan, tally) {
  const text = (v) => {
    if (v === null || v === undefined) return COPY_NULL;
    let s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.includes('\u0000')) {
      tally.nul += s.split('\u0000').length - 1;
      s = s.replaceAll('\u0000', '');
    }
    return copyText(s);
  };
  const int = (v) => {
    if (v === undefined || v === null) return COPY_NULL;
    if (Number.isInteger(v) && Math.abs(v) <= 2147483647) return String(v);
    tally.badStamp++;
    return COPY_NULL;
  };
  const own = (k) => (Object.hasOwn(feature.props, k) ? feature.props[k] : undefined);
  const cells = [text(feature.id)];
  if (plan.hasVersion) cells.push(int(own('@version')));
  if (plan.hasStamp) cells.push(int(own('@timestamp')));
  for (const c of plan.columns) cells.push(text(own(c.key)));
  cells.push(copyText(feature.geometry));
  return `${cells.join('\t')}\n`;
}

/**
 * GeoJSON text → geometry, or NULL. Lives in the session's temporary
 * schema, so it is gone when the connection is.
 *
 * Exported so the database self-test can feed it text DIRECTLY: nothing
 * that passes geometryProblem makes PostGIS raise (measured: a duplicated
 * `type` key does, and JSON.parse cannot hand one over), so the
 * EXCEPTION branch is only reachable from here, and only a test that
 * goes round the JS check can say it still works.
 */
export const GEOM_FUNCTION_SQL = [
  'CREATE FUNCTION pg_temp.camp_geom(g text) RETURNS geometry LANGUAGE plpgsql AS $fn$',
  '  DECLARE x geometry;',
  '  BEGIN',
  '    x := ST_SetSRID(ST_GeomFromGeoJSON(g), 4326);',
  '    IF ST_IsEmpty(x) THEN RETURN NULL; END IF;',
  '    RETURN x;',
  '  EXCEPTION WHEN OTHERS THEN RETURN NULL;',
  '  END $fn$;',
].join('\n');

/**
 * The SQL before the data and after it.
 *
 * Everything is ONE TRANSACTION and the COMMIT is the last line written,
 * and only once the whole file has been read: if anything goes wrong —
 * the file, the network, the process — the previous staging table is
 * still there, untouched. ogr2ogr's `-overwrite` gave the same promise.
 *
 * The table is built with `geom` as text and converted in place
 * afterwards, because COPY cannot feed GeoJSON to a geometry column and
 * PostGIS can read it: that is the whole of what ogr2ogr was doing here.
 *
 * 🔴 PER RECORD, NOT PER FILE. `ST_GeomFromGeoJSON` raises on a geometry it
 * cannot read, and one raise inside an ALTER would throw away the country.
 * The conversion goes through a function that answers NULL instead, and
 * the rows with a NULL are deleted and COUNTED. An empty geometry is not a
 * place on a map and takes the same road. (A Z cannot get this far:
 * geometryProblem refuses any position that is not exactly two numbers, so
 * a check for one here would be a second lock on a door nothing can reach.)
 */
export function stagingSql(table, plan, copied) {
  if (!TABLE_NAME.test(table)) throw new Error(`${JSON.stringify(table)} is not a table name this script will use`);
  const T = quoteIdent(table);
  const cols = [quoteIdent('id') + ' varchar'];
  const names = [quoteIdent('id')];
  const add = (name, type) => {
    cols.push(`${quoteIdent(name)} ${type}`);
    names.push(quoteIdent(name));
  };
  if (plan.hasVersion) add('@version', 'integer');
  if (plan.hasStamp) add('@timestamp', 'integer');
  for (const c of plan.columns) add(c.name, 'varchar');
  add('geom', 'text');
  const before = [
    'SET client_min_messages = warning;',
    // The bytes below are UTF-8 whatever the locale of the machine says.
    "SET client_encoding = 'UTF8';",
    'BEGIN;',
    `DROP TABLE IF EXISTS ${T};`,
    `CREATE TABLE ${T} (ogc_fid serial PRIMARY KEY, ${cols.join(', ')});`,
    `COPY ${T} (${names.join(', ')}) FROM STDIN;`,
    '',
  ].join('\n');
  const n = Number(copied);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('nothing to load');
  const after = [
    '\\.',
    // The number of rows COPY took must be the number this side wrote.
    `DO $check$ BEGIN IF (SELECT count(*) FROM ${T}) <> ${n} THEN`,
    `  RAISE EXCEPTION 'COPY took % rows, ${n} were sent', (SELECT count(*) FROM ${T}); END IF; END $check$;`,
    GEOM_FUNCTION_SQL,
    `ALTER TABLE ${T} ALTER COLUMN geom TYPE geometry(Geometry, 4326) USING pg_temp.camp_geom(geom);`,
    `WITH d AS (DELETE FROM ${T} WHERE geom IS NULL RETURNING 1)`,
    `SELECT json_build_object('copied', ${n}, 'badGeometry', (SELECT count(*) FROM d),`,
    `  'staged', (SELECT count(*) FROM ${T}) - (SELECT count(*) FROM d))::text;`,
    `DO $any$ BEGIN IF NOT EXISTS (SELECT 1 FROM ${T}) THEN`,
    `  RAISE EXCEPTION 'no row with a usable geometry'; END IF; END $any$;`,
    `CREATE INDEX ON ${T} USING gist (geom);`,
    `ANALYZE ${T};`,
    'COMMIT;',
    '',
  ].join('\n');
  return { before, after };
}

/**
 * Load one release asset into the staging table. THE REPLACEMENT FOR
 * ogr2ogr, and the only code in this file that talks to the database.
 *
 *   pass 1  read the file, learn the columns            (no database yet)
 *   pass 2  stream rows into `psql … COPY … FROM STDIN` (one transaction)
 *
 * A file that cannot be read to its end fails in pass 1, before the
 * database has been touched. A file that goes wrong in pass 2 is never
 * committed. `psql` is spawned with an argument ARRAY — no shell exists
 * between this file and it — and `-X` so that nobody's ~/.psqlrc runs
 * inside an import.
 *
 * `env` and `chunks` exist for the self-tests: the first lets them take
 * `psql` off the PATH, the second lets them hand the loader a file that
 * breaks the SECOND time it is read — the only way to rehearse a stream
 * that dies after rows have already gone through COPY.
 *
 * @returns {Promise<{staged:number, copied:number, badGeometry:number,
 *   skipped:Object<string,number>, blankKeys:number, droppedKeys:string[],
 *   nul:number, badStamp:number, columns:number, ms:number}>}
 */
export async function loadStaging({ table, gz, db, env = process.env, chunks = () => gunzipChunks(gz) }) {
  const started = Date.now();
  if (!TABLE_NAME.test(table)) throw new Error(`${JSON.stringify(table)} is not a table name this script will use`);
  const scan = await scanFeatures(chunks());
  if (scan.rows === 0) {
    throw new Error(
      `${scan.rows} loadable feature(s) in the file` +
        (Object.keys(scan.skipped).length ? ` (${JSON.stringify(scan.skipped)})` : ''),
    );
  }
  const plan = planColumns(scan.keys);
  const sql = stagingSql(table, plan, scan.rows);

  const child = spawn(
    'psql',
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', `--dbname=${conninfo(db)}`, '-f', '-'],
    { stdio: ['pipe', 'pipe', 'pipe'], env },
  );
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (out = (out + d).slice(-65536)));
  child.stderr.setEncoding('utf8').on('data', (d) => (err = (err + d).slice(-65536)));
  const exited = new Promise((done, fail) => {
    child.on('error', (e) =>
      fail(e.code === 'ENOENT' ? new Error('psql is not installed or not on PATH') : e),
    );
    child.on('close', (code, signal) => done({ code, signal }));
  });
  exited.catch(() => {});
  let pipeBroken = false;
  child.stdin.on('error', () => {
    pipeBroken = true;
  });
  const send = async (text) => {
    if (pipeBroken) throw Object.assign(new Error('psql closed its input'), { pipeClosed: true });
    if (!child.stdin.write(text)) await Promise.race([once(child.stdin, 'drain').catch(() => {}), exited]);
  };

  const tally = { nul: 0, badStamp: 0 };
  let written = 0;
  let failure = null;
  try {
    await send(sql.before);
    let batch = [];
    let size = 0;
    for await (const text of featureTexts(chunks())) {
      const r = readFeature(text);
      if (r.skip) continue;
      const line = copyLine(r, plan, tally);
      batch.push(line);
      written++;
      size += line.length;
      if (size >= 262144) {
        await send(batch.join(''));
        batch = [];
        size = 0;
      }
    }
    // The file was read once already and said how many rows it holds. A
    // different answer means it changed underneath us, and nothing of it
    // may be committed.
    if (written !== scan.rows) {
      throw new Error(`the file changed while it was being loaded (${scan.rows} rows, then ${written})`);
    }
    await send(batch.join(''));
    await send(sql.after);
    child.stdin.end();
  } catch (e) {
    // No COMMIT has been sent, and none will be: the connection closing
    // is what rolls the transaction back.
    failure = e;
    child.kill();
  }

  const { code, signal } = await exited;
  // Our own error wins — unless it is only the echo of psql having died,
  // in which case psql's own words are the useful ones.
  if (failure && !failure.pipeClosed) throw failure;
  if (code !== 0 || failure) {
    const first = err.split('\n').find((l) => l.trim() !== '') ?? `exit ${code ?? signal}`;
    throw Object.assign(new Error(`psql failed: ${first.trim()}`), { stderr: err });
  }
  // The whole of stdout, not its last line: `-X` keeps anybody's psqlrc out
  // of it, so anything else printed there is a surprise to be refused, not
  // something to skip over.
  let result;
  try {
    result = JSON.parse(out);
  } catch {
    throw new Error(`psql said nothing we can read: ${JSON.stringify(out.slice(-200))}`);
  }
  // No cross-check of these numbers against `written` here: it would run
  // AFTER the COMMIT, so it could only report a disagreement, never
  // prevent one. The check that can is inside the transaction — the `DO
  // $check$` block in stagingSql — and the self-test pins it.
  return {
    staged: result.staged,
    copied: written,
    badGeometry: result.badGeometry,
    skipped: scan.skipped,
    blankKeys: scan.blankKeys,
    droppedKeys: plan.dropped,
    nul: tally.nul,
    badStamp: tally.badStamp,
    columns: plan.columns.length,
    ms: Date.now() - started,
  };
}

/** What a load had to change or leave out, in words — or nothing. */
export function loadNotes(r) {
  const notes = [];
  if (r.blankKeys > 0) notes.push(`${r.blankKeys} blank tag${r.blankKeys === 1 ? '' : 's'} dropped`);
  if (r.droppedKeys.length > 0) notes.push(`${r.droppedKeys.length} unusable tag key(s) dropped`);
  if (r.nul > 0) notes.push(`${r.nul} NUL byte(s) removed`);
  if (r.badStamp > 0) notes.push(`${r.badStamp} edit stamp(s) not an integer`);
  if (r.badGeometry > 0) notes.push(`${r.badGeometry} unreadable geometry`);
  for (const [why, n] of Object.entries(r.skipped)) notes.push(`${n} skipped: ${why}`);
  return notes.length ? ` (${notes.join('; ')})` : '';
}

/**
 * The compiled importer, `apps/api/dist/osm/import-spots.js` — found, never
 * built and never fetched.
 *
 * 🔴 This was `npx ts-node src/osm/import-spots.ts …`, and it needed ts-node,
 * a devDependency. Measured on the server 16.10.2026 (release 1581656):
 * `node_modules/ts-node` is NOT there, `typescript` is, and the deploy has
 * already compiled `dist/osm/import-spots.js`. Worse, `npx` goes to a
 * registry for a package it cannot find (npm 10.9.8: even `npx --no <a
 * package that does not exist>` still ASKED the registry — "404 … is not in
 * this registry" — before giving up), so on that machine it would have
 * tried to install the one thing this card says may not be installed.
 *
 * The compiled file is a complete entry point: import-spots.ts guards its
 * `main()` with `require.main === module` and reads the country and the
 * table from process.argv[2] and [3], exactly as ts-node passed them.
 *
 * A missing file stops the run, by name, before the first download.
 */
const API_DIR = fileURLToPath(new URL('../../apps/api/', import.meta.url));
export function importerPath(apiDir = API_DIR) {
  const file = join(apiDir, 'dist', 'osm', 'import-spots.js');
  let present = false;
  try {
    present = statSync(file).isFile();
  } catch {
    // not there
  }
  if (!present) {
    throw new Error(
      `the compiled importer is missing: ${file}\n` +
        '  Build the API first (`npm run build --workspace=apps/api`). This script does not ' +
        'compile, install or download anything.',
    );
  }
  return file;
}

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { encoding: 'utf8', stdio: 'pipe', ...opts });

/** A promise that gives up after `ms`, so a hung case is a failed case. */
const within = (ms, p) =>
  Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`did not finish in ${ms} ms`)), ms).unref())]);

/**
 * A copy of this very file at <dir>/scripts/osm-pipeline/copy.mjs, with its
 * two sibling imports pointed at the real ones — so that it runs from a
 * temporary tree, and so that `../../apps/api/` is a path inside that tree.
 */
function copyOfThisFile(dir, edit = (text) => text) {
  const sibling = (rel) => JSON.stringify(new URL(rel, import.meta.url).href);
  const copy = join(dir, 'scripts', 'osm-pipeline', 'copy.mjs');
  mkdirSync(dirname(copy), { recursive: true });
  writeFileSync(
    copy,
    edit(
      readFileSync(new URL(import.meta.url), 'utf8')
        .replace("'../lib/entrypoint.mjs'", sibling('../lib/entrypoint.mjs'))
        .replace("'../ci/check-eu-scope.mjs'", sibling('../ci/check-eu-scope.mjs')),
    ),
  );
  return copy;
}

async function selfTest() {
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
  // 🔴 CAMP-332: a case that THROWS is a failed case, not a dead run. Without
  // this, every mutation that made a helper throw ended the whole self-test
  // in a stack trace with no line saying which check had been reading it.
  // The `try` is not re-indented, so that the diff stays readable.
  try {

  // 🔴 The conversion that cost the first run. ogr2ogr answers a URL
  // with "ERROR 1: PQconnectdb failed." and nothing else.
  ok('a URL becomes a libpq key=value string',
    conninfo('postgres://localhost:5432/camptribe_dev') ===
      'dbname=camptribe_dev host=localhost port=5432',
    conninfo('postgres://localhost:5432/camptribe_dev'));
  ok('credentials survive, decoded',
    conninfo('postgresql://me:p%40ss@db.example.invalid:6543/app') ===
      'dbname=app host=db.example.invalid port=6543 user=me password=p@ss');
  ok('a key=value string is left alone',
    conninfo('dbname=x host=y') === 'dbname=x host=y');
  ok('a URL with no database falls back rather than producing dbname=',
    conninfo('postgres://localhost/').startsWith('dbname=postgres'));

  // 🔴 Everything after the `?` used to be thrown away.
  ok('sslmode survives — without it a managed Postgres refuses the connection',
    conninfo('postgres://u:p@db.example.invalid/app?sslmode=require') ===
      "dbname=app host=db.example.invalid user=u password=p sslmode=require",
    conninfo('postgres://u:p@db.example.invalid/app?sslmode=require'));
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
    conninfo('postgres://u:two%20words@h.invalid/app') ===
      "dbname=app host=h.invalid user=u password='two words'",
    conninfo('postgres://u:two%20words@h.invalid/app'));
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
    conninfo('postgres://u:pa%0Dss@h.invalid/db') === "dbname=db host=h.invalid user=u password='pa\rss'",
    JSON.stringify(conninfo('postgres://u:pa%0Dss@h.invalid/db')));
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

  // ── CAMP-183, then CAMP-332: reading a release asset goes through no shell ──
  //
  // 🔴 The second case is the whole point and it is not decoration. The
  // old line was `sh -c "gzip -dc '<gz>' > '<json>'"`. A single quote in
  // a path ENDS the quoted run there, and everything after it is read as
  // shell — the quotes that look like protection are the hole. Hand that
  // version this filename and the command breaks apart; hand it to zlib
  // and it is just a name. The first case keeps the plain path honest,
  // so this pair cannot pass by doing nothing at all.
  //
  // The reader since CAMP-332 is a stream, not `gunzipSync`, and the pair
  // is kept on it: the hostile name still has to reach createReadStream.
  const feat = (id, props = {}, geometry = { type: 'Point', coordinates: [14.5, 35.9] }) => ({
    type: 'Feature',
    id,
    geometry,
    properties: props,
  });
  const collect = async (chunks) => {
    const out = [];
    for await (const t of featureTexts(chunks)) out.push(t);
    return out;
  };
  const rejects = async (p) => {
    try {
      await p;
      return false;
    } catch {
      return true;
    }
  };
  const rejectsWith = async (p, re) => {
    try {
      await p;
      return false;
    } catch (e) {
      return re.test(`${e.message} ${e.code ?? ''}`);
    }
  };
  {
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-unpack-'));
    const doc = JSON.stringify({ type: 'FeatureCollection', features: [feat('n1'), feat('n2')] });
    const expected = JSON.stringify([feat('n1'), feat('n2')].map((f) => JSON.stringify(f)));
    const readBack = async (name, bytes = gzipSync(Buffer.from(doc))) => {
      const gz = join(dir, name);
      writeFileSync(gz, bytes);
      return collect(gunzipChunks(gz));
    };
    ok('a .gz is read feature by feature', JSON.stringify(await readBack('europe-malta.geojson.gz')) === expected);
    ok("a path holding a quote, a space and a semicolon reads all the same",
      JSON.stringify(await readBack("it's here; rm -rf .geojson.gz")) === expected);
    // A download cut short must fail LOUDLY: gunzip knows the length it was
    // promised. Every campsite after the cut would otherwise vanish.
    const whole = gzipSync(Buffer.from(doc));
    ok('a .gz cut short is an error, not a short file',
      await rejects(readBack('cut.geojson.gz', whole.subarray(0, whole.length - 10))));
    ok('a file that is not gzip at all is an error',
      await rejects(readBack('plain.geojson.gz', Buffer.from(doc))));
    ok('a file that is not there is an error that says so (ENOENT)',
      await rejectsWith(collect(gunzipChunks(join(dir, 'absent.geojson.gz'))), /ENOENT/));
    rmSync(dir, { recursive: true, force: true });
  }

  // ── CAMP-332: finding the features in a stream ──
  //
  // 🔴 The real files are ONE line. The cases below are cut at EVERY
  // possible chunk size and at every byte, because the places a reader
  // goes wrong are exactly the places a chunk ends: inside an escape,
  // inside a string, between the two bytes of one character, between a
  // `}` and the `,` after it.
  const rich = {
    type: 'FeatureCollection',
    crs: { note: 'a } and a ] and a " inside a foreign member', features: 'not this one' },
    features: [
      feat('n1', { name: 'plain' }),
      feat('w2', { name: 'braces } ] { [ a "quote" and \\ a backslash', 'k"ey': 'v', ' ': 'blank' }),
      feat('a3', { name: 'Ċentru tal-Iskawts — 日本語 🏕️', math: '𝒳' }, {
        type: 'MultiPolygon',
        coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]]],
      }),
      feat('n4', { nested: { a: [1, 2, { b: [] }] }, nul: 'a\u0000b', esc: 'line\nbreak\ttab\u2028' }),
      feat('n5'),
      feat('n6', { features: 'a tag that is called features', '[': ']' }),
    ],
    after: [1, 2, { features: [] }],
  };
  {
    const text = JSON.stringify(rich);
    const wanted = JSON.stringify(rich.features.map((f) => JSON.stringify(f)));
    const bytes = Buffer.from(text);
    const stringChunks = (size) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'));
    const byteChunks = (size) => {
      const out = [];
      for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
      return out;
    };
    const wrong = { str: [], buf: [] };
    for (let size = 1; size <= bytes.length; size++) {
      if (JSON.stringify(await collect(stringChunks(Math.min(size, text.length)))) !== wanted) wrong.str.push(size);
      if (JSON.stringify(await collect(byteChunks(size))) !== wanted) wrong.buf.push(size);
    }
    ok('every feature comes out as the exact text it went in as, at every string chunk size',
      wrong.str.length === 0, `wrong at ${wrong.str.slice(0, 5)}`);
    ok('…and at every BYTE chunk size, so a character split between two chunks survives',
      wrong.buf.length === 0, `wrong at ${wrong.buf.slice(0, 5)}`);
    ok('each piece is a whole JSON document of its own: nothing was cut inside a string or an escape',
      (await collect([text])).every((t) => {
        try {
          JSON.parse(t);
          return true;
        } catch {
          return false;
        }
      }));

    // 🔴 EVERY strict prefix of a valid file is an error. This is the case
    // that matters: a file cut at a record boundary is full of good
    // records, and importing them says every later campsite disappeared.
    const accepted = [];
    for (let i = 0; i < text.length; i++) {
      if (!(await rejects(collect([text.slice(0, i)])))) accepted.push(i);
    }
    ok('every strict prefix of a file is refused, however good the records before the cut',
      accepted.length === 0, `accepted a cut at ${accepted.slice(0, 5)}`);

    // One feature far larger than a chunk.
    const big = JSON.stringify({ type: 'FeatureCollection', features: [feat('n1', { v: 'x'.repeat(300000) })] });
    ok('a feature larger than any chunk comes out whole',
      (await collect(big.match(/[\s\S]{1,4096}/g)))[0].length === JSON.stringify(feat('n1', { v: 'x'.repeat(300000) })).length);
  }
  {
    const refused = {
      'data after the closing brace': '{"features":[]} x',
      'a second object after it': '{"features":[]}{}',
      'two features arrays': '{"features":[],"features":[]}',
      'features that is not an array': '{"features":{}}',
      'a number inside features': '{"features":[1]}',
      'a string inside features': '{"features":["a"]}',
      'an array inside features': '{"features":[[]]}',
      'null inside features': '{"features":[null]}',
      'brackets that do not match': '{"features":[}',
      'an array at the top': '[]',
      'a string at the top': '"x"',
      'no features at all': '{"type":"FeatureCollection"}',
      'nothing at all': '',
      'a bracket that closes the wrong kind, at the very end': '{"features":[]]',
      'an object closed by a square bracket': '{"features":[{"id":"a"}]]',
      'a string after the closing brace': '{"features":[]} "x"',
    };
    const accepted = [];
    for (const [why, doc] of Object.entries(refused)) {
      if (!(await rejects(collect([doc])))) accepted.push(why);
    }
    ok('every malformed shape is an error, never a short result',
      accepted.length === 0, `accepted: ${accepted.join('; ')}`);
    ok('an empty collection is read as empty, not as an error',
      (await collect(['{"type":"FeatureCollection","features":[]}'])).length === 0);
    ok('a byte-order mark in front is let through',
      (await collect(['\uFEFF{"features":[{"id":"a"}]}'])).length === 1);
    ok('a key written with an escape is still `features`',
      (await collect(['{"featur\\u0065s":[{"id":"a"}]}'])).length === 1);
    ok('whitespace between the pieces is fine',
      (await collect(['  {\n "type" : "FeatureCollection" ,\n "features" : [ {"id":"a"} , {"id":"b"} ]\n}\n'])).length === 2);
  }

  // ── CAMP-332: one record ──
  {
    const read = (f) => readFeature(typeof f === 'string' ? f : JSON.stringify(f));
    const good = read(feat('n1', { name: 'A', '': 'blank' }));
    ok('a good feature is read: its id, its geometry as text, its tags',
      good.id === 'n1' && good.geometry === '{"type":"Point","coordinates":[14.5,35.9]}' && good.props.name === 'A');
    ok('a blank tag key is dropped and counted, by stripBlankKeys', good.blank === 1 && !('' in good.props));
    ok('a feature without properties has none, and that is fine', Object.keys(read({ id: 'n1', geometry: { type: 'Point', coordinates: [0, 0] } }).props).length === 0);
    const skipped = (f) => read(f).skip;
    ok('text that is not JSON is skipped, and does not throw', skipped('{"id":') === 'feature is not valid JSON');
    ok('a feature without an id is skipped', skipped({ geometry: { type: 'Point', coordinates: [0, 0] } }) === 'feature has no string id');
    ok('a numeric id is skipped: staging has an id COLUMN, and a number is not what it holds',
      skipped({ id: 7, geometry: { type: 'Point', coordinates: [0, 0] } }) === 'feature has no string id');
    ok('an empty id is skipped', skipped({ id: '', geometry: { type: 'Point', coordinates: [0, 0] } }) === 'feature has no string id');
    ok('a feature without a geometry is skipped', skipped({ id: 'n1' }) === 'feature has no geometry');
    ok('a null geometry is skipped', skipped({ id: 'n1', geometry: null }) === 'feature has no geometry');
    ok('an array where the geometry goes is skipped', skipped({ id: 'n1', geometry: [] }) === 'feature has no geometry');
    ok('properties that are an array are skipped',
      skipped({ id: 'n1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: [] }) === 'properties is not an object');
    ok('something that is not an object at all is skipped', skipped('[1]') === 'feature is not an object');

    ok('a geometry that is not a place is skipped, with the reason in the count',
      skipped(feat('n1', {}, { type: 'Point', coordinates: ['x', 'y'] })) ===
        'feature has an unreadable geometry (a position is not two finite numbers)');

    // 🔴 The shapes PostGIS turns into a place without a word, and one it
    // refuses: measured on 3.6.4. Each of the first group is a campsite in
    // the Gulf of Guinea if this check is gone.
    const geo = (type, coordinates) => geometryProblem({ type, coordinates });
    const square = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const POS = 'a position is not two finite numbers';
    ok('letters, strings that look like numbers, nulls, a missing or short or long position are all refused',
      [['x', 'y'], ['1', '2'], [null, null], [1], [], [1, 2, 3], [1, null], undefined, [[1, 2]]]
        .every((c) => geo('Point', c) === POS),
      JSON.stringify([['x', 'y'], ['1', '2'], [null, null], [1], [], [1, 2, 3], [1, null], undefined, [[1, 2]]].map((c) => geo('Point', c))));
    ok('a coordinate too big to be a number (1e999 reads as Infinity) is refused',
      geo('Point', JSON.parse('[1e999, 2]')) === POS && geo('Point', [NaN, 2]) === POS);
    ok('the same check reaches every depth: a line, a multipoint, a polygon, a multipolygon',
      geo('LineString', [[0, 0], ['a', 1]]) === POS && geo('MultiPoint', [[0, 0], [1]]) === POS &&
        geo('Polygon', [[[0, 0], [1, 0], [1, 1], [0, 'z']]]) === POS &&
        geo('MultiPolygon', [[square], [[[0, 0], [1, 0], [1, 1], [null, 0]]]]) === POS &&
        geo('MultiLineString', [[[0, 0], [1, 1]], [[0, 'q'], [1, 1]]]) === POS);
    ok('a type GeoJSON does not have is refused, by name',
      /"Blob"/.test(geometryProblem({ type: 'Blob', coordinates: [] })) && /"Point "/.test(geometryProblem({ type: 'Point ', coordinates: [1, 2] })) &&
        geometryProblem({ coordinates: [1, 2] }) !== null);
    ok('a geometry that is not an object is refused', [null, [], 'x', 5, undefined].every((g) => geometryProblem(g) === 'geometry is not an object'));
    const open4 = [[0, 0], [1, 0], [1, 1], [2, 2]];
    ok('a line of one position, a ring that is open, a ring of three, a ring of one are refused, with their own reasons',
      geo('LineString', [[0, 0]]) === 'a line has fewer than two positions' &&
        geo('MultiLineString', [[[0, 0], [1, 1]], [[0, 0]]]) === 'a line has fewer than two positions' &&
        geo('Polygon', [open4]) === 'a ring is not closed' &&
        geo('Polygon', [[[0, 0], [1, 0], [1, 1]]]) === 'a ring has fewer than four positions' &&
        geo('Polygon', [[[0, 0], [1, 0], [0, 0]]]) === 'a ring has fewer than four positions' &&
        geo('Polygon', [[[0, 0]]]) === 'a ring has fewer than four positions' &&
        geo('MultiPolygon', [[square], [open4]]) === 'a ring is not closed');
    ok('a hole that is open is refused as well as the shell', geo('Polygon', [square, open4]) === 'a ring is not closed');
    ok('a ring whose last position differs from its first in y alone is not closed',
      geo('Polygon', [[[0, 0], [1, 0], [1, 1], [0, 5]]]) === 'a ring is not closed' &&
        geo('Polygon', [[[0, 0], [1, 0], [1, 1], [7, 0]]]) === 'a ring is not closed');
    ok('a collection is as good as its worst member, and needs members',
      geometryProblem({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2] }, { type: 'Point', coordinates: ['a', 'b'] }] }) === POS &&
        geometryProblem({ type: 'GeometryCollection' }) === 'GeometryCollection has no geometries');
    ok('real shapes pass: a point, a multipoint, a line, a multiline, a polygon with a hole, a multipolygon, a collection',
      [geo('Point', [14.5, 35.9]), geo('MultiPoint', [[1, 2], [3, 4]]), geo('LineString', [[0, 0], [1, 1]]),
        geo('MultiLineString', [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]), geo('Polygon', [square, square]),
        geo('MultiPolygon', [[square], [square, square]]),
        geometryProblem({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2] }] })]
        .every((r) => r === null));
    ok('what only a geometry engine can tell is left to the database: an empty polygon passes here',
      geo('Polygon', []) === null && geo('MultiPolygon', []) === null);

    // scanFeatures: one pass, the numbers a human will read.
    const scan = await scanFeatures([JSON.stringify({ features: [
      feat('n1', { name: 'A', fixme: 'x' }),
      feat('n2', { name: 'B', 'addr:city': 'C', '': 'blank' }),
      { id: 'n3' },
      { geometry: { type: 'Point', coordinates: [0, 0] } },
      feat('n5'),
    ] })]);
    ok('a scan counts the rows it will load, the records it skips, and the blank keys it dropped',
      scan.rows === 3 && scan.blankKeys === 1 &&
        scan.skipped['feature has no geometry'] === 1 && scan.skipped['feature has no string id'] === 1,
      JSON.stringify({ rows: scan.rows, skipped: scan.skipped, blankKeys: scan.blankKeys }));
    ok('…and the union of the tag keys, for the columns',
      [...scan.keys].sort().join(',') === 'addr:city,fixme,name', [...scan.keys].sort().join(','));
  }

  // ── CAMP-332: which column each tag gets ──
  ok('laundering is ogr2ogr’s: lower case, and the quote, the hyphen and the hash become underscores',
    launder("Price") === 'price' && launder('name:sr-Latn') === 'name:sr_latn' &&
      launder('stars:-201707') === 'stars:_201707' && launder("A'B#C") === 'a_b_c');
  ok('…and ASCII only: an accented letter is left exactly as it is',
    launder('payment:sofortüberweisung') === 'payment:sofortüberweisung' && launder('Ünï') === 'Ünï');
  {
    const names = (keys) => Object.fromEntries(planColumns(new Set(keys)).columns.map((c) => [c.key, c.name]));
    ok('two keys that launder to one name each keep a column; the canonical spelling keeps the name',
      JSON.stringify(names(['FIXME', 'fixme'])) === '{"fixme":"fixme","FIXME":"fixme2"}',
      JSON.stringify(names(['FIXME', 'fixme'])));
    ok('…whichever order they were met in',
      JSON.stringify(names(['fixme', 'FIXME'])) === JSON.stringify(names(['FIXME', 'fixme'])));
    ok('three of a kind get three columns',
      JSON.stringify(names(['Price', 'PRICE', 'price'])) === '{"price":"price","PRICE":"price2","Price":"price3"}',
      JSON.stringify(names(['Price', 'PRICE', 'price'])));
    ok('a tag called id, geom or ogc_fid cannot take the loader’s own column',
      JSON.stringify(names(['id', 'geom', 'ogc_fid'])) === '{"geom":"geom2","id":"id2","ogc_fid":"ogc_fid2"}',
      JSON.stringify(names(['id', 'geom', 'ogc_fid'])));
    ok('…nor can one that only launders to it', names(['ID'])['ID'] === 'id2' && names(['GEOM'])['GEOM'] === 'geom2');
    const p = planColumns(new Set(['@timestamp', '@version', 'name']));
    ok('the two integer attributes are columns of their own, not tags', p.hasStamp && p.hasVersion && p.columns.length === 1);
    const q = planColumns(new Set(['name']));
    ok('with no @timestamp in the file there is no such column — that is how import-spots hears of it',
      !q.hasStamp && !q.hasVersion);
    ok('a tag spelled @Timestamp cannot take the integer column', names(['@Timestamp'])['@Timestamp'] === '@timestamp2');
    const long63 = 'a'.repeat(63);
    const d = planColumns(new Set(['a'.repeat(64), long63, `${'é'.repeat(32)}`, 'tab\there', 'ok']));
    ok('a blank key that reached the plan (empty, a space, a no-break space, an em space) is dropped, not made a column',
      (() => {
        const r = planColumns(new Set(['', ' ', '\u00a0', '\u2003']));
        return r.columns.length === 0 && r.dropped.length === 4;
      })());
    ok('a key Postgres would cut, or one with a control character, is dropped and named — not truncated',
      JSON.stringify(d.dropped.sort()) === JSON.stringify(['a'.repeat(64), 'tab\there', 'é'.repeat(32)].sort()) &&
        d.columns.map((c) => c.name).sort().join(',') === `${long63},ok`,
      JSON.stringify(d.dropped));
    ok('a suffix that would push a name past the limit drops that key rather than breaking the table', (() => {
      const r = planColumns(new Set([long63, long63.toUpperCase()]));
      return r.columns.length === 1 && r.dropped.length === 1;
    })());
    ok('more keys than Postgres has columns is an error that says so',
      throws(() => planColumns(new Set(Array.from({ length: 1600 }, (_, i) => `k${i}`)))));
    ok('1597 keys still fit (1600 less ogc_fid, id and geom, with no integer columns)',
      !throws(() => planColumns(new Set(Array.from({ length: 1597 }, (_, i) => `k${i}`)))));
  }

  // ── CAMP-332: a row as COPY wants it ──
  {
    // The inverse of copyText, written from the PostgreSQL manual rather
    // than from the function it checks.
    const unescape = (s) => s.replace(/\\(.)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\' })[c] ?? c);
    const hostile = ['plain', 'tab\there', 'new\nline', 'cr\rhere', 'back\\slash', '\\N', '\\.', '\\\\', 'a\\nb', '', ' ', '"q" \'s\' ;', '𝒳 🏕️ Ċ', 'x'.repeat(100000)];
    ok('every awkward value comes back from COPY escaping as it went in',
      hostile.every((v) => unescape(copyText(v)) === v));
    ok('…and none of them leaves a raw tab, newline or carriage return in the line',
      hostile.every((v) => !/[\t\n\r]/.test(copyText(v))));
    ok('a value that is the two characters \\N is not NULL', copyText('\\N') === '\\\\N');

    const plan = planColumns(new Set(['@timestamp', '@version', 'name', 'fixme', 'FIXME']));
    const tally = { nul: 0, badStamp: 0 };
    const line = copyLine(
      { id: 'n1', geometry: '{"type":"Point"}', props: { '@timestamp': 1787953167, '@version': 4, name: 'A\tB\nC', FIXME: 'upper' } },
      plan, tally);
    ok('a row is one line: id, @version, @timestamp, the tags in the plan’s order, geom',
      line === 'n1\t4\t1787953167\t\\N\tA\\tB\\nC\tupper\t{"type":"Point"}\n', JSON.stringify(line));
    ok('an absent tag is NULL; an absent tag is not a change, so nothing is tallied', tally.nul === 0 && tally.badStamp === 0);
    ok('a feature with no @timestamp and no @version in a file that has them: NULL, and not a "bad" stamp',
      (() => {
        const t = { nul: 0, badStamp: 0 };
        const l = copyLine({ id: 'a', geometry: 'g', props: { name: 'x' } }, plan, t);
        return l === 'a\t\\N\t\\N\t\\N\tx\t\\N\tg\n' && t.badStamp === 0;
      })());

    const t2 = { nul: 0, badStamp: 0 };
    const l2 = copyLine({ id: 'n\u00001', geometry: 'g', props: { name: 'a\u0000b\u0000', '@timestamp': '1787953167', '@version': 1.5, fixme: null, FIXME: 7 } }, plan, t2);
    ok('a NUL byte is removed — PostgreSQL text cannot hold one — and counted',
      l2.startsWith('n1\t') && l2.includes('\tab\t') && t2.nul === 3, JSON.stringify([l2, t2]));
    ok('an @timestamp that is a string, and an @version that is not an integer, become NULL — and are counted, not hidden',
      l2.startsWith('n1\t\\N\t\\N\t') && t2.badStamp === 2, JSON.stringify([l2, t2]));
    ok('JSON null is NULL, a number is its digits, and the whole row is what it should be',
      l2 === 'n1\t\\N\t\\N\t\\N\tab\t7\tg\n', JSON.stringify(l2));
    ok('an @timestamp too big for integer is NULL and counted',
      (() => { const t = { nul: 0, badStamp: 0 }; const l = copyLine({ id: 'a', geometry: 'g', props: { '@timestamp': 2147483648 } }, planColumns(new Set(['@timestamp'])), t); return l === 'a\t\\N\tg\n' && t.badStamp === 1; })());
    ok('a nested value is written as JSON, not as [object Object]',
      copyLine({ id: 'a', geometry: 'g', props: { k: { a: [1, 'x\ty'] } } }, planColumns(new Set(['k'])), { nul: 0, badStamp: 0 }) === 'a\t{"a":[1,"x\\\\ty"]}\tg\n');
    // 🔴 `props[key]` on an object finds what Object.prototype carries. A
    // tag that is called `constructor` somewhere in the country has a
    // column, and every feature WITHOUT it would be written as
    // "function Object() { [native code] }".
    ok('a feature that lacks a tag called constructor, toString or hasOwnProperty gets NULL, not the object’s own methods',
      copyLine({ id: 'a', geometry: 'g', props: {} },
        planColumns(new Set(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])), { nul: 0, badStamp: 0 }) ===
        'a\t\\N\t\\N\t\\N\t\\N\tg\n');
    ok('a tag called __proto__ is an ordinary tag', (() => {
      const props = JSON.parse('{"__proto__":"x"}');
      const pl = planColumns(new Set(['__proto__']));
      return copyLine({ id: 'a', geometry: 'g', props }, pl, { nul: 0, badStamp: 0 }) === 'a\tx\tg\n';
    })());
  }

  // ── CAMP-332: the SQL around the data ──
  {
    const plan = planColumns(new Set(['@timestamp', '@version', 'name', 'a"b', 'x;DROP TABLE t;--', ':colon', "it's"]));
    const sql = stagingSql('osm_camping_staging', plan, 5);
    const all = sql.before + sql.after;
    ok('the table is built in one transaction and COMMIT is the last thing sent, after the data',
      sql.before.includes('BEGIN;') && !sql.before.includes('COMMIT') && sql.after.trimEnd().endsWith('COMMIT;'));
    ok('the data ends at a line holding only a backslash and a dot',
      sql.after.startsWith('\\.\n') && sql.before.trimEnd().endsWith('FROM STDIN;'));
    // (laundered first: `x;DROP TABLE t;--` is lower-cased and loses its hyphens, `it's` its quote)
    ok('every awkward key is a quoted identifier, with its own quotes doubled',
      all.includes('"a""b" varchar') && all.includes('"x;drop table t;__" varchar') &&
        all.includes('":colon" varchar') && all.includes('"it_s" varchar'),
      sql.before.match(/CREATE TABLE .*/)[0]);
    ok('the COPY lists exactly the columns CREATE TABLE makes, ogc_fid left to its sequence', (() => {
      const create = sql.before.match(/CREATE TABLE .*?\((.*)\);\n/)[1].replace(/^ogc_fid serial PRIMARY KEY, /, '');
      const copy = sql.before.match(/COPY .*? \((.*)\) FROM STDIN/)[1];
      return create.split(', ').map((c) => c.replace(/ (varchar|integer|text)$/, '')).join(', ') === copy;
    })());
    ok('geom is text while the rows go in, and is converted afterwards in place',
      sql.before.includes('"geom" text') && sql.after.includes('ALTER COLUMN geom TYPE geometry(Geometry, 4326)'));
    ok('the number of rows sent is what the database compares COPY against, and what it says in the refusal',
      /count\(\*\) FROM "osm_camping_staging"\) <> 5 THEN/.test(sql.after) && sql.after.includes("were sent', (SELECT") && sql.after.includes('COPY took % rows, 5 were sent'));
    ok('a table name with a quote, a space, a semicolon or a leading digit is refused',
      ['a"b', 'a b', 'x;y', '1abc', '', 'a'.repeat(64), 'a-b'].every((t) => throws(() => stagingSql(t, plan, 1))));
    ok('a load of no rows is refused before any SQL exists',
      throws(() => stagingSql('t', plan, 0)) && throws(() => stagingSql('t', plan, NaN)));
    ok('the converted column is typed text → geometry through a function that answers NULL, never an error',
      sql.after.includes('EXCEPTION WHEN OTHERS THEN RETURN NULL'));
  }

  // ── CAMP-332: the URLs (what replaced `gh`) ──
  {
    ok('the release is asked for at exactly this URL',
      releaseByTagUrl('osm-2026-10-16', 'owner/repo') === 'https://api.github.com/repos/owner/repo/releases/tags/osm-2026-10-16');
    ok('the newest releases are listed, not "latest" (all of ours are pre-releases)',
      recentReleasesUrl('owner/repo') === 'https://api.github.com/repos/owner/repo/releases?per_page=10');
    ok('an asset is downloaded from exactly this URL',
      assetDownloadUrl('osm-2026-10-16', 'europe-malta.geojson.gz', 'owner/repo') ===
        'https://github.com/owner/repo/releases/download/osm-2026-10-16/europe-malta.geojson.gz');
    ok('an asset name is percent-encoded into ONE path segment',
      assetDownloadUrl('v1', 'a b/c?d#e', 'o/r') === 'https://github.com/o/r/releases/download/v1/a%20b%2Fc%3Fd%23e');
    // 🔴 The CAMP-201 cases, kept, on what is now the whole of the risk: a
    // tag that makes the URL mean something else.
    const hostile = ['--version', '-R', '--repo=evil/repo', '-', '../x', '..', '.', 'a/b', 'a?b', 'a#b',
      '%2e%2e', 'a b', 'a\nb', 'a\u0000b', '', ' ', 'x'.repeat(101), 'évil', 'a@b', 'a:b', 'a\\b'];
    ok('every hostile tag is refused before a URL exists',
      hostile.every((t) => throws(() => releaseByTagUrl(t)) && throws(() => assetDownloadUrl(t, 'a.gz'))),
      hostile.filter((t) => !throws(() => releaseByTagUrl(t))).join(' | '));
    ok('real tags are not refused',
      ['osm-2026-10-16', 'v1.2.3', 'OSM_2026', 'a', '2026.10'].every((t) => !throws(() => checkTag(t))));
    ok('a non-string is refused', throws(() => checkTag(undefined)) && throws(() => checkTag(null)) && throws(() => checkTag(5)));
    ok('whatever the tag, the URL stays on the same host and under the same repository', (() => {
      const u = new URL(releaseByTagUrl('osm-2026-10-16'));
      return u.origin === 'https://api.github.com' && u.pathname.startsWith('/repos/camp-tribe-eu/camp/releases/tags/');
    })());

    // The token: sent to the API, to nobody else, and never invented.
    const seen = [];
    const spy = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return new Response('{"ok":true}', { status: 200 });
    };
    await fetchJson('https://api.github.com/x', { fetchImpl: spy, env: { GITHUB_TOKEN: 'tok' } });
    await fetchJson('https://evil.example/x', { fetchImpl: spy, env: { GITHUB_TOKEN: 'tok' } });
    await fetchJson('https://api.github.com/x', { fetchImpl: spy, env: {} });
    await fetchJson('https://api.github.com/x', { fetchImpl: spy, env: { GH_TOKEN: 'other' } });
    ok('the token goes to api.github.com, as a bearer header',
      seen[0].headers.Authorization === 'Bearer tok' && seen[3].headers.Authorization === 'Bearer other');
    ok('…and to no other host, and no header is made up when there is none',
      seen[1].headers.Authorization === undefined && seen[2].headers.Authorization === undefined);
    ok('GitHub is told who is asking and which API version is meant',
      seen[0].headers['User-Agent'] === 'camptribe-import-release' && seen[0].headers['X-GitHub-Api-Version'] === '2022-11-28');
    seen.length = 0;
    await downloadAsset('https://github.com/o/r/releases/download/v1/a.gz', join(tmpdir(), `camptribe-dl-${process.pid}`), {
      fetchImpl: async (url, init) => {
        seen.push(init.headers);
        return new Response('x');
      },
    });
    rmSync(join(tmpdir(), `camptribe-dl-${process.pid}`), { force: true });
    ok('a download carries no token even when one is in the environment',
      seen.length === 1 && seen[0].Authorization === undefined && !('Authorization' in seen[0]));

    // newest non-draft
    const latest = (list) => latestTag({ fetchImpl: async () => new Response(JSON.stringify(list), { status: 200 }), env: {} });
    ok('the latest tag is the first release that is not a draft',
      (await latest([{ tag_name: 'draft', draft: true }, { tag_name: 'osm-2026-10-16', draft: false }, { tag_name: 'old' }])) === 'osm-2026-10-16');
    ok('no release at all is the empty string, which main() turns into an error',
      (await latest([])) === '' && (await latest({ message: 'Not Found' })) === '' && (await latest([{ draft: true, tag_name: 'x' }])) === '');
  }

  // 🔴 The age of a release, for an import nobody is watching.
  {
    const latest = (list) => latestTag({ fetchImpl: async () => new Response(JSON.stringify(list), { status: 200 }), env: {} });
    ok('the latest DATA tag skips a newer release that is not one of ours',
      (await latest([{ tag_name: 'v1.2.0', draft: false }, { tag_name: 'deploy-2026-10-27', draft: false }, { tag_name: 'osm-2026-10-26', draft: false }, { tag_name: 'osm-2026-10-19' }])) === 'osm-2026-10-26');
    ok('a list with no data release at all is the empty string, not a stranger’s tag',
      (await latest([{ tag_name: 'v1.2.0', draft: false }])) === '');
    const T = Date.UTC(2026, 9, 27, 4, 30); // Tuesday 04:30, the morning after the Monday build
    ok('the age is counted from the tag’s own UTC date, in days',
      Math.abs(releaseAgeDays('osm-2026-10-26', T) - (28.5 / 24)) < 1e-9, String(releaseAgeDays('osm-2026-10-26', T)));
    ok('a tag with no date in it has no age', releaseAgeDays('v1.2.0', T) === null && releaseAgeDays('osm-2026-10-26-x', T) === null);
    ok('a date that does not exist has no age — 31 February is not rolled into March', releaseAgeDays('osm-2026-02-31', T) === null);
    const stale = (tag, max, now = T) => { try { checkAge(tag, max, now); return null; } catch (e) { return String(e.message); } };
    ok('a release inside the limit passes', stale('osm-2026-10-26', 8) === null);
    ok('…the limit itself passes: 8 days to the hour is not over 8', stale('osm-2026-10-19', 8, Date.UTC(2026, 9, 27, 0, 0)) === null);
    ok('a release over the limit stops the run, names the tag and the age, and says nothing was imported',
      /osm-2026-10-12 is 15\.2 days old, over the 8-day limit/.test(stale('osm-2026-10-12', 8) ?? '') &&
        /Nothing has been imported/.test(stale('osm-2026-10-12', 8) ?? ''), String(stale('osm-2026-10-12', 8)));
    ok('and says WHY: the stamp would be written now on old data', /last_seen_at/.test(stale('osm-2026-10-12', 8) ?? ''));
    ok('with a limit, a tag whose age cannot be proved is refused, not waved through',
      /cannot tell how old/.test(stale('v1.2.0', 8) ?? ''));
    ok('a release dated in the future is refused', /future/.test(stale('osm-2026-11-30', 8) ?? ''));
    ok('with no limit nothing is checked — the by-hand run may take any tag, however old',
      stale('osm-2020-01-01', null) === null && stale('v1.2.0', undefined) === null);
    ok('--max-age-days is a whole number of days', parseMaxAge('8') === 8 && parseMaxAge(null) === null && parseMaxAge(undefined) === null);
    ok('…and anything else is refused, naming the flag',
      ['', '0', '-1', '8d', '8.5', ' 8', 'abc', '1000'].every((v) => throws(() => parseMaxAge(v))) &&
        /--max-age-days/.test((() => { try { parseMaxAge('abc'); } catch (e) { return e.message; } return ''; })()));
    ok('--max-age-days is a flag this script KNOWS, and takes a value (an unknown flag is an error)',
      KNOWN_FLAGS.includes('--max-age-days') && FLAGS_WITH_VALUES.includes('--max-age-days'));
    // 🔴 THE REAL ENTRY POINT, run as a child — the helpers above prove the
    // rule, this proves main() uses it before it touches the network. A copy
    // in a temporary tree with an importer file and a psql that only
    // answers --version; the tag is explicit, so no request is made for it,
    // and a run that got past the age check would go on to ask GitHub.
    // `8` after the flag must not be read as a stray country code.
    {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'camptribe-age-')));
      const copy = copyOfThisFile(dir);
      mkdirSync(join(dir, 'apps', 'api', 'dist', 'osm'), { recursive: true });
      writeFileSync(join(dir, 'apps', 'api', 'dist', 'osm', 'import-spots.js'), '');
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
      ok('an old release with --max-age-days exits non-zero, before any download, naming the age',
        typeof old.status === 'number' && old.status !== 0 && /days old, over the 8-day limit/.test(old.said) &&
          !/could not read asset sizes|member state\(s\)/.test(old.said), old.said.slice(0, 300));
      ok('the value after --max-age-days is not taken for a country code',
        !/is not a two-letter country code/.test(old.said), old.said.slice(0, 300));
      const bad = child(['--tag', 'osm-2020-01-01', '--max-age-days', 'soon', 'mt']);
      ok('a --max-age-days that is not a number stops the run, naming the flag',
        typeof bad.status === 'number' && bad.status !== 0 && /--max-age-days wants a whole number/.test(bad.said), bad.said.slice(0, 300));
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 🔴 A bad moment of the network costs a second chance, not a country's week.
  {
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-retry-'));
    const scripted = (steps) => {
      let n = 0;
      return {
        calls: () => n,
        fetchImpl: async () => {
          const step = steps[Math.min(n++, steps.length - 1)];
          if (step instanceof Error) throw step;
          if (typeof step === 'number') return new Response('no', { status: step });
          return new Response(step);
        },
      };
    };
    const netErr = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
    const dest = join(dir, 'a.gz');
    const go = (steps, extra = {}) => {
      const r = scripted(steps);
      return { r, done: downloadWithRetry('https://github.com/o/r/releases/download/t/a.gz', dest, { fetchImpl: r.fetchImpl, pauseMs: 1, ...extra }) };
    };
    {
      const { r, done } = go([netErr(), netErr(), 'the bytes']);
      await done;
      ok('a download that fails twice on the network and then works lands the file',
        readFileSync(dest, 'utf8') === 'the bytes' && r.calls() === 3, `calls=${r.calls()}`);
    }
    {
      const { r, done } = go([503, 'again']);
      await done;
      ok('a 503 is tried again', r.calls() === 2 && readFileSync(dest, 'utf8') === 'again');
    }
    {
      const { r, done } = go([404, 'never reached']);
      const e = await done.then(() => null, (x) => x);
      ok('a 404 is NOT tried again — it would answer the same, only later',
        e !== null && e.status === 404 && r.calls() === 1, `calls=${r.calls()}`);
    }
    {
      const { r, done } = go([netErr()]);
      const e = await done.then(() => null, (x) => x);
      ok('a network that stays down stops after exactly the attempts it was given, and says why',
        e !== null && r.calls() === 3 && /fetch failed/.test(e.message), `calls=${r.calls()}`);
    }
    {
      const { r, done } = go([netErr()], { attempts: 1 });
      await done.then(() => null, () => null);
      ok('attempts: 1 means one', r.calls() === 1);
    }
    ok('a 5xx, a 429 and a request that never got an answer are transient; a 404 and a 403 are not',
      isTransient({ status: 500 }) && isTransient({ status: 429 }) && isTransient({ status: 503 }) &&
        isTransient(new TypeError('fetch failed')) && !isTransient({ status: 404 }) && !isTransient({ status: 403 }));
    ok('the status of a failed request is a number on the error, not text to be read back',
      await (async () => {
        try {
          await downloadAsset('https://github.com/x', join(dir, 'b.gz'), { fetchImpl: async () => new Response('', { status: 404 }) });
          return false;
        } catch (e) {
          return e.status === 404;
        }
      })());
    ok('a failure is printed with the cause the runtime hides behind "fetch failed"',
      failureReason(netErr()) === 'fetch failed (UND_ERR_CONNECT_TIMEOUT)', failureReason(netErr()));
    ok('…and a plain error is its first line, not a stack',
      failureReason(new Error('boom\n    at x')) === 'boom' && failureReason({ stderr: 'child said\nmore' }) === 'child said');
    rmSync(dir, { recursive: true, force: true });
  }

  // …and the same functions over a real socket: a body that streams, a
  // redirect to a CDN, a 404, a connection cut halfway.
  {
    const payload = Buffer.alloc(5 * 1024 * 1024, 'abcdefghij');
    const server = createServer((req, res) => {
      if (req.url === '/release/file.gz') {
        res.writeHead(302, { Location: '/cdn/file.gz' }).end();
      } else if (req.url === '/cdn/file.gz') {
        res.writeHead(200, { 'Content-Length': payload.length }).end(payload);
      } else if (req.url === '/cut') {
        res.writeHead(200, { 'Content-Length': payload.length });
        res.write(payload.subarray(0, 100000), () => req.socket.destroy());
      } else if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"assets":[{"name":"a","size":1}]}');
      } else if (req.url === '/limited') {
        res.writeHead(403).end('{"message":"API rate limit exceeded"}');
      } else {
        res.writeHead(404).end('<html>not found</html>');
      }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${server.address().port}`;
    const viaLocal = (url, init) => fetch(url.replace(/^https:\/\/[^/]+/, base), init);
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-http-'));
    try {
      const dest = join(dir, 'file.gz');
      await downloadAsset('https://github.com/release/file.gz', dest, { fetchImpl: viaLocal });
      ok('a redirected download of 5 MiB lands byte for byte', readFileSync(dest).equals(payload));
      ok('an asset that is not there is an error naming the status, and writes nothing',
        await (async () => {
          const gone = join(dir, 'gone.gz');
          try {
            await downloadAsset('https://github.com/no/such', gone, { fetchImpl: viaLocal });
            return false;
          } catch (e) {
            return /HTTP 404/.test(e.message) && !existsSync(gone);
          }
        })());
      ok('a connection cut halfway is an error, not a short file that passes',
        await rejects(downloadAsset('https://github.com/cut', join(dir, 'cut.gz'), { fetchImpl: viaLocal })));
      ok('a JSON answer is parsed', (await fetchJson('https://api.github.com/json', { fetchImpl: viaLocal, env: {} })).assets[0].name === 'a');
      ok('a 404 from the API is an error that names the status',
        await (async () => { try { await fetchJson('https://api.github.com/x', { fetchImpl: viaLocal, env: {} }); return false; } catch (e) { return /HTTP 404/.test(e.message); } })());
      ok('a 403 says what to do about the rate limit, and still names the status',
        await (async () => { try { await fetchJson('https://api.github.com/limited', { fetchImpl: viaLocal, env: {} }); return false; } catch (e) { return /HTTP 403/.test(e.message) && /GITHUB_TOKEN/.test(e.message); } })());
      ok('a request that outlives its timeout is an error naming the timeout — and does not hang',
        await rejectsWith(within(3000, fetchJson('https://api.github.com/json', {
          fetchImpl: (u, i) => new Promise((_, no) => i.signal.addEventListener('abort', () => no(i.signal.reason))),
          env: {}, timeoutMs: 20,
        })), /timeout/i));
    } finally {
      server.close();
      server.closeAllConnections?.();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── CAMP-332: the compiled importer is found, never built or fetched ──
  {
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-api-'));
    const wanted = join(dir, 'dist', 'osm', 'import-spots.js');
    ok('a missing compiled importer is an error that names the file and says to build the API', (() => {
      try {
        importerPath(dir);
        return false;
      } catch (e) {
        return e.message.includes(wanted) && /Build the API first/.test(e.message) && /does not\s+compile, install or download/.test(e.message.replace(/\n\s*/g, ' '));
      }
    })());
    mkdirSync(join(dir, 'dist', 'osm', 'import-spots.js'), { recursive: true });
    ok('a DIRECTORY with that name is not an importer', (() => {
      try {
        importerPath(dir);
        return false;
      } catch (e) {
        return e.message.includes(wanted);
      }
    })());
    rmSync(wanted, { recursive: true });
    writeFileSync(wanted, '');
    ok('the compiled importer under the directory is found, as that path', importerPath(dir) === wanted);
    ok('only dist/osm/import-spots.js counts: the TypeScript source beside it does not', (() => {
      const other = mkdtempSync(join(tmpdir(), 'camptribe-api-src-'));
      mkdirSync(join(other, 'src', 'osm'), { recursive: true });
      writeFileSync(join(other, 'src', 'osm', 'import-spots.ts'), '');
      try {
        importerPath(other);
        return false;
      } catch (e) {
        return e.message.includes(join(other, 'dist', 'osm', 'import-spots.js'));
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    })());
    rmSync(dir, { recursive: true, force: true });
  }

  // 🔴 THE REAL ENTRY POINT, run as a child: with no compiled importer the
  // script must stop before it downloads anything — non-zero exit, and the
  // missing path in what it printed. A COPY of this file is run from a
  // temporary tree whose `../../apps/api` has no dist; PATH holds only the
  // directory of this Node, so neither psql nor anything else can answer
  // first, and the order of the two pre-flight checks is part of what is
  // tested (the file is looked for before the process is started).
  {
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-nodist-'));
    const real = realpathSync(dir);
    const copy = copyOfThisFile(dir);
    // 🔴 PATH, У ЯКОМУ Є ЛИШЕ `node` І НІЧОГО БІЛЬШЕ.
    //
    // Раніше тут стояло `{ PATH: dirname(process.execPath) }`, і воно
    // ізолювало `psql` ЛИШЕ на машині розробника. На ноуті node живе в
    // nvm (`~/.nvm/versions/node/…/bin`), а psql — в `/opt/homebrew/bin`,
    // тож тека node справді його не містить.
    //
    // 🔴 НА СЕРВЕРІ ОБИДВА В `/usr/bin`. Заміряно 16.10.2026 на проді:
    // `command -v node` → /usr/bin/node, `command -v psql` → /usr/bin/psql.
    // Тобто PATH із теки node містив і psql, скрипт на ньому не
    // зупинявся, і випадок нижче падав — на тій самій машині, заради
    // якої він і написаний. Сторож був червоний саме там, де потрібен.
    //
    // Тека з одним симлінком не залежить від того, де в системі лежать
    // бінарники: чого в ній немає, того немає напевно.
    const binDir = join(real, '.only-node');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(process.execPath, join(binDir, 'node'));
    const nodeOnly = { PATH: binDir };
    ok('with no compiled importer the script exits non-zero, names the path, and says how to build it', (() => {
      try {
        run('node', [copy, '--tag', 'osm-2026-10-16', 'mt'], { env: nodeOnly });
        return false;
      } catch (e) {
        const said = `${e.stdout}${e.stderr}`;
        return typeof e.status === 'number' && e.status !== 0 &&
          said.includes(join(real, 'apps', 'api', 'dist', 'osm', 'import-spots.js')) && /npm run build --workspace=apps\/api/.test(said);
      }
    })());
    mkdirSync(join(real, 'apps', 'api', 'dist', 'osm'), { recursive: true });
    writeFileSync(join(real, 'apps', 'api', 'dist', 'osm', 'import-spots.js'), '');
    ok('with the importer present and no psql the same entry point stops on psql instead', (() => {
      try {
        run('node', [copy, '--tag', 'osm-2026-10-16', 'mt'], { env: nodeOnly });
        return false;
      } catch (e) {
        const said = `${e.stdout}${e.stderr}`;
        return typeof e.status === 'number' && e.status !== 0 && /psql is not installed/.test(said) && !/compiled importer is missing/.test(said);
      }
    })());
    rmSync(dir, { recursive: true, force: true });
  }
  ok('preflight names a missing psql before anything is downloaded', (() => {
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-nopsql-'));
    mkdirSync(join(dir, 'dist', 'osm'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'osm', 'import-spots.js'), '');
    try {
      preflight({ env: { PATH: dir }, apiDir: dir });
      return false;
    } catch (e) {
      return /psql is not installed/.test(e.message);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })());
  {
    const said = (o) => loadNotes({ blankKeys: 0, droppedKeys: [], nul: 0, badStamp: 0, badGeometry: 0, skipped: {}, ...o });
    ok('a clean load says nothing extra', said({}) === '');
    ok('a blank tag keeps the message it always had', said({ blankKeys: 1 }) === ' (1 blank tag dropped)' && said({ blankKeys: 2 }) === ' (2 blank tags dropped)');
    ok('everything that was changed or left out is named, with its number',
      said({ blankKeys: 1, droppedKeys: ['a', 'b'], nul: 3, badStamp: 2, badGeometry: 4, skipped: { 'feature has no string id': 5 } }) ===
        ' (1 blank tag dropped; 2 unusable tag key(s) dropped; 3 NUL byte(s) removed; 2 edit stamp(s) not an integer; 4 unreadable geometry; 5 skipped: feature has no string id)');
  }
  // 🔴 `--self-test-db` is a flag this script KNOWS (CAMP-286: a flag it
  // does not know falls through to the default action), and without a
  // database it FAILS — it does not skip, and it does not pass.
  ok('--self-test-db with no database fails loudly and names what to set', (() => {
    try {
      run('node', [fileURLToPath(import.meta.url), '--self-test-db'], { env: { PATH: process.env.PATH } });
      return false;
    } catch (e) {
      return e.status === 1 && /CAMP_TEST_DATABASE_URL/.test(String(e.stderr));
    }
  })());
  // 🔴 THE EXIT STATUS OF THE SELF-TEST ITSELF. It is the one thing that
  // turns CI red: the step greps for "import-release self-test:", and the
  // failure line contains that too. A `--self-test` that prints a failure
  // and exits 0 would be a green CI around a red run, and nothing above
  // looks at it. So this runs a COPY of this file in which the expected
  // case count is wrong on purpose, and wants status 1 and the count line.
  // (The child skips this very case — else it would run itself forever.)
  if (process.env.IMPORT_RELEASE_SELFTEST_CHILD === undefined) {
    ok('a self-test that has a failure exits 1', await (async () => {
      const dir = mkdtempSync(join(tmpdir(), 'camptribe-selfexit-'));
      // (anchored to the start of a line: this very line also spells the pattern)
      const copy = copyOfThisFile(dir, (t) => t.replace(/^(\s*)const EXPECTED_CASES = \d+;/m, '$1const EXPECTED_CASES = 99999;'));
      try {
        run('node', [copy, '--self-test'], { env: { PATH: process.env.PATH, IMPORT_RELEASE_SELFTEST_CHILD: '1' } });
        return false;
      } catch (e) {
        return e.status === 1 && /cases ran, expected 99999/.test(String(e.stdout));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })());
  }
  ok('without psql on the PATH the loader says so, rather than "spawn psql ENOENT"', await (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-nopsql-'));
    const gz = join(dir, 'x.geojson.gz');
    writeFileSync(gz, gzipSync(Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [feat('n1')] }))));
    try {
      await loadStaging({ table: 't', gz, db: 'dbname=x', env: { ...process.env, PATH: dir } });
      return false;
    } catch (e) {
      return /psql is not installed/.test(e.message);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })());
  ok('a table name that is not a plain identifier is refused before the file is even opened',
    await (async () => {
      try {
        await loadStaging({ table: 'a"b', gz: '/no/such/file.gz', db: 'dbname=x' });
        return false;
      } catch (e) {
        return /not a table name/.test(e.message);
      }
    })());
  {
    // assetSizes: read off the release, and degraded — loudly — when it cannot be.
    const assets = [{ name: 'europe-malta.geojson.gz', size: 1800 }, { name: 'europe-france.geojson.gz', size: 25793000 }, { name: 'x.count', size: 3 }];
    const answer = (status, body) => ({ env: {}, fetchImpl: async () => new Response(JSON.stringify(body), { status }) });
    const sized = await assetSizes('osm-2026-10-16', answer(200, { assets }));
    ok('the sizes of the countries come off the release, and only the countries',
      sized.fr === 25793000 && sized.mt === 1800 && Object.keys(sized).length === 2, JSON.stringify(sized));
    const log = console.log;
    const said = [];
    console.log = (m) => said.push(m);
    const failed = await assetSizes('osm-2026-10-16', answer(404, { message: 'Not Found' }));
    const none = await assetSizes('osm-2026-10-16', answer(200, { assets: [{ name: 'other.txt', size: 1 }] }));
    console.log = log;
    ok('a release that cannot be read gives no sizes and SAYS so; one with no asset of ours says that',
      Object.keys(failed).length === 0 && Object.keys(none).length === 0 &&
        /could not read asset sizes \(GitHub answered HTTP 404/.test(said[0]) && /none of them ours/.test(said[1]), JSON.stringify(said));
    let requests = 0;
    console.log = () => {};
    const hostile = await assetSizes('../x', { env: {}, fetchImpl: async () => { requests++; return new Response('{}'); } });
    console.log = log;
    ok('a hostile tag gets no sizes, and no request is made for it', Object.keys(hostile).length === 0 && requests === 0, `${requests} request(s)`);
  }
  ok('a file with no loadable feature is refused before psql is started', await (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'camptribe-empty-'));
    const gz = join(dir, 'x.geojson.gz');
    writeFileSync(gz, gzipSync(Buffer.from('{"type":"FeatureCollection","features":[{"id":"n1"}]}')));
    try {
      await loadStaging({ table: 't', gz, db: 'dbname=x', env: { PATH: dir } });
      return false;
    } catch (e) {
      return /0 loadable feature/.test(e.message) && /no geometry/.test(e.message);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })());

  // And the shell itself is gone: nothing in this file may build a
  // command out of an interpolated string again. `execFileSync` with an
  // argument array never reaches a shell, which is why every other call
  // here was already safe.
  //
  // 🔴 Comments are stripped first, and the first version of this check
  // FAILED without that — it matched the note at the call site, which
  // quotes the very line it is warning about. A guard that cannot tell
  // code from prose about code reports the warning as the crime.
  // 🔴 KEYED TO THE SHAPE, not to one spelling, and the first version
  // was not. It forbade the literal `run('sh'` and nothing else, so
  // review walked through it six different ways, each leaving 46/46
  // green: `execFileSync('sh', …)` straight past the `run` wrapper
  // (execFileSync is already imported, so that is the likeliest future
  // edit of all), `run('bash', …)`, `run('/bin/sh', …)`, backticks, a
  // shell name held in a variable, and `{ shell: true }` in the options.
  //
  // Three of those are now caught by name, and `shell: true` by its own
  // rule. The one that remains is a shell name reached through a
  // VARIABLE — a regex cannot follow that, and saying so here is better
  // than implying a completeness this does not have. What it does
  // guarantee: nobody writes a shell into this file by accident.
  const sourceOf = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // Trailing comments too. Stripping only line-leading ones let
      // `unpackGz(gz, json); // was: run('sh', …)` fail the check — the
      // very false alarm this stripping exists to prevent.
      .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');

  const EXEC_CALL = /\bexec\s*\(/;
  const SHELL_CALL =
    /(?:execFileSync|execFile|spawnSync|spawn|run)\s*\(\s*['"`](?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh|dash|ksh)['"`]/;
  // 🔴 The rehearsal's own fixtures are not the code under the rule.
  // They are strings that LOOK like shell calls, on purpose, and a whole
  // file scan reports them — which is how this check failed the moment
  // it was broadened.
  //
  // The first repair sliced the file at `function selfTest(` and kept
  // what was above. That was WORSE than the problem: selfTest is defined
  // before main() in this file, so the slice threw away the call site
  // itself, and every bypass — including simply putting `run('sh', …)`
  // back — passed 50/50. A guard that reads the wrong half of the file
  // is a guard that reads nothing.
  //
  // So the fixtures say where they are. Everything between the two
  // markers is removed and the rest of the file, main() included, is
  // scanned. If a marker is ever deleted the pair no longer matches and
  // the check below says so rather than quietly widening.
  // 🔴 A REGEX, not a string constant, and NOTHING BELOW MAY SPELL THE
  // MARKER OUT. Twice already this file has been bitten by prose that
  // looks like code, and the marker is the sharpest case yet:
  //
  //   - as `const OPEN = '…'` the marker text appears twice, so the
  //     "exactly one region" check counted its own constant and failed;
  //   - written out in a sentence like this one, the region begins at
  //     the SENTENCE and swallows everything down to the closing marker
  //     — including the rule it is supposed to protect. Deleting the
  //     real marker then changed nothing and the rehearsal stayed green.
  //
  // In a regex literal the same characters are escaped, so the plain
  // text exists exactly once: at the fixtures themselves.
  const whole = readFileSync(new URL(import.meta.url), 'utf8');
  const REGION = /\/\* fixtures-not-code \*\/[\s\S]*?\/\* end-fixtures-not-code \*\//g;
  const regions = whole.match(REGION) ?? [];
  ok('the fixtures are marked exactly once', regions.length === 1,
    `${regions.length} region(s)`);
  const source = sourceOf(whole.replace(REGION, ' '));

  ok('no shell is spawned anywhere in this file', !SHELL_CALL.test(source));

  // 🔴 CAMP-332 — A RULE THAT SCANS FOR A THING MUST BE SHOWN TO HAVE ONE
  // TO SCAN. The check above passes on a file with no process launch at
  // all, and CAMP-332 took out three of the four this file had (`gh`
  // twice, `ogr2ogr`) — which is exactly how a guard turns green by
  // construction. So the launches are counted and named.
  //
  // Those with a literal first argument are the ones SHELL_CALL can
  // judge. Those whose first argument is a name held in a variable it
  // cannot, and that blind spot is written down in the comment further up;
  // here it is also PINNED: the variable launches are exactly the wrapper
  // itself and the importer call, and a third one fails this until a person
  // has looked at it.
  const LAUNCH = /(?:execFileSync|execFile|spawnSync|spawn|run)\s*\(\s*([^,)\s][^,)]*)/g;
  const launches = [...source.matchAll(LAUNCH)].map((m) => m[1].trim());
  const literal = launches.filter((a) => /^['"`]/.test(a));
  const variable = launches.filter((a) => !/^['"`]/.test(a));
  ok('the file launches processes by literal name — the shell rule has something to read',
    literal.length >= 2 && literal.includes("'psql'"), JSON.stringify(literal));
  ok('the launches it cannot judge — a variable as the executable — are exactly the two known ones',
    JSON.stringify([...variable].sort()) === JSON.stringify(['cmd', 'process.execPath']), JSON.stringify(variable));

  ok('nothing asks a child process for a shell', !/\bshell\s*:\s*true/.test(source));
  // `execSync` IS a shell, always, whatever it is handed.
  ok('execSync is not used', !/\bexecSync\s*\(/.test(source));
  // 🔴 CAMP-332: and so is `exec`, which the rule above does not name. It
  // was no risk while this file imported only execFileSync; it imports
  // `spawn` now, from the same module, and `exec` is one word away from it.
  ok('exec is not used', !EXEC_CALL.test(source));
  // 🔴 THE UNIT AND THE SCRIPT ARE TIED HERE, IN CI, NOT ONLY ON THE MACHINE.
  // The freshness sentry's unit passed a flag its script did not know for
  // three weeks (CAMP-399): the script swallowed it and the timer reported
  // success over nothing. This script refuses an unknown flag with exit 2,
  // so the same break would fail the first run — but a timer's first run is
  // on a Tuesday at 04:30. Read the unit, here, before it ships.
  {
    const unit = readFileSync(new URL('../../infra/systemd/camptribe-osm-import.service', import.meta.url), 'utf8');
    const line = unit.split('\n').find((l) => /^ExecStart=.*import-release\.mjs/.test(l));
    const passed = line === undefined ? null : line.split('import-release.mjs')[1].trim().split(/\s+/).filter(Boolean);
    const flags = passed === null ? null : passed.filter((a) => a.startsWith('-'));
    ok('the systemd unit calls this script and passes only flags it knows',
      flags !== null && flags.length > 0 && flags.every((f) => KNOWN_FLAGS.includes(f)), String(passed));
    const at = passed === null ? -1 : passed.indexOf('--max-age-days');
    ok('…and it passes --max-age-days with a value parseMaxAge accepts: the age guard is on in the unit that ships',
      at >= 0 && parseMaxAge(passed[at + 1]) !== null, String(passed));
    // 🔴 THE LIMIT IS TIED TO THE BUDGET IT PROTECTS. The age guard exists so
    // that the freshness sentry cannot be blinded by an import of old data; a
    // limit as wide as the sentry's own budget (or wider — `90` passed every
    // other case here) switches that off without anyone seeing it. The budget
    // is READ from the sentry's own table, not typed here a second time: two
    // copies of one number are two truths waiting to part.
    //
    // 🔴 THE MARGIN IS COMPUTED AND IT IS SMALL. The timer fires Tuesday 04:30;
    // after one missed Monday the release is 8.19 days old (passes), but at
    // Wednesday 00:30 it is 9.02 (refused). `Persistent=true` CAN land a run in
    // that window — a machine that was down on Tuesday and boots on Wednesday —
    // and the result is a loud false alarm, never a silent stale import. The
    // limit cannot be raised a day: it has to stay under the 10-day budget.
    {
      const fresh = await import(new URL('../ci/check-data-freshness.mjs', import.meta.url).href);
      const spots = fresh.DB_SOURCES.find((x) => x.table === 'camping_spots');
      const budgetDays = typeof spots?.budgetHours === 'function' ? spots.budgetHours() / 24 : spots?.budgetHours / 24;
      const days = at >= 0 ? Number(passed[at + 1]) : NaN;
      ok('…and that limit is STRICTLY under the freshness budget of camping_spots, read from the sentry — else the guard guards nothing',
        Number.isFinite(days) && Number.isFinite(budgetDays) && days < budgetDays,
        `unit passes --max-age-days ${days}, freshness budget of camping_spots is ${budgetDays} days`);
    }
    ok('…and what the unit names as the script is the file that runs (its path ends scripts/osm-pipeline/import-release.mjs)',
      line !== undefined && /\/scripts\/osm-pipeline\/import-release\.mjs(\s|$)/.test(line), String(line));
  }
  // 🔴 THE HELPERS ARE ONLY AS GOOD AS main()'s USE OF THEM. A retry that is
  // tested and not called is a guard that is green and absent.
  ok('main() downloads through downloadWithRetry, not downloadAsset directly',
    /await downloadWithRetry\(assetDownloadUrl\(/.test(source) && !/await downloadAsset\(assetDownloadUrl\(/.test(source));
  ok('main() reports a failed country through failureReason, so the cause is printed',
    /failures\.push\(\{ code, why: failureReason\(err\) \}\)/.test(source));
  // And the stripping must not blind the check: a trailing comment is
  // removed, a shell call on the same line is not.
  /* fixtures-not-code */
  ok('a shell call survives a trailing comment on its line',
    SHELL_CALL.test(sourceOf(`run('sh', ['-c', 'x']); // note`)));
  ok('a trailing comment mentioning a shell call does not trip it',
    !SHELL_CALL.test(sourceOf(`readFeature(text); // was: run('sh', ['-c', 'x'])`)));
  // 🔴 ЄДИНИЙ ВИПАДОК, ЩО ДОВОДИТЬ «СКРИПТ СТАРТУЄ».
  //
  // Решта 73 перевіряють помічники. Вони всі були зелені тиждень, поки
  // скрипт падав першим рядком main() через невизначений `resolve`.
  // Цей викликає рядок, який падав, і прибирає за собою.
  ok('the work directory can actually be made (main() starts)', (() => {
    const d = makeWorkDir();
    const absolute = d.startsWith('/');
    rmSync(d, { recursive: true, force: true });
    return absolute;
  })());

  ok('each shell name the rule lists is actually matched',
    ['sh', 'bash', 'zsh', 'dash', 'ksh', '/bin/sh', '/usr/bin/bash']
      .every((s) => SHELL_CALL.test(`run('${s}', [])`)));
  // 🔴 CAMP-332 put a second launcher in this file (`spawn`), so each
  // launcher the rule NAMES is shown to be matched, not just `run`.
  ok('each launcher the rule lists is actually matched',
    ['execFileSync', 'execFile', 'spawnSync', 'spawn', 'run']
      .every((fn) => SHELL_CALL.test(`${fn}('sh', [])`)));
  ok('exec( is seen, bare or on an object', EXEC_CALL.test(sourceOf(`exec('ls | wc')`)) && EXEC_CALL.test(sourceOf(`cp.exec('ls | wc')`)));
  /* end-fixtures-not-code */

  } catch (err) {
    ok('the self-test ran to its end', false, `after "${checks.at(-1)?.name.slice(0, 60)}": ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`);
  }

  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  // 🔴 `let`, not `const`. The count guard below did `failed += 1` on a
  // constant, so a wrong EXPECTED_CASES threw
  // `TypeError: Assignment to constant variable` instead of printing the
  // sentence it was written to print. The step still went red — by
  // accident, through a crash — and the guard itself had never been
  // rehearsed (CAMP-286).
  let failed = checks.filter((c) => !c.pass).length;
  // 🔴 CAMP-286: counted and named after this file. Its own header
  // records that `--self-test` printed "73/73 passed" for a week while
  // the import had not started at all — the number was never the
  // question, the line's owner was.
  const EXPECTED_CASES = 206;
  if (checks.length !== EXPECTED_CASES) {
    failed += 1;
    console.log(`✗ ${checks.length} cases ran, expected ${EXPECTED_CASES}`);
  }
  console.log(
    failed
      ? `\n✗ import-release self-test: ${failed} of ${checks.length} failed`
      : `\n✓ import-release self-test: ${checks.length} cases`,
  );
  return failed === 0;
}

/**
 * CAMP-332: the loader against a REAL PostgreSQL with PostGIS.
 *
 *   CAMP_TEST_DATABASE_URL=postgres://… node scripts/osm-pipeline/import-release.mjs --self-test-db
 *
 * 🔴 WHY A SECOND SELF-TEST. `--self-test` runs on any machine and reads no
 * database; everything it says about the loader is about the text it
 * writes. That is not what ogr2ogr was trusted with. This reads the
 * TABLE BACK — column names, column types, values, rows — after a real
 * `psql` has run a real COPY, and it is the only thing in the repository
 * that does: ogr2ogr never ran in CI (it has no GDAL), so the staging
 * table's shape was pinned by nothing.
 *
 * Needs a superuser-ish URL (it makes and drops its own `camp332_*`
 * database) — CAMP_TEST_DATABASE_URL, or CI_DATABASE_URL, which CI sets.
 * 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP: a skipped test reads as a
 * passed one, and this is the file that has been bitten by exactly that.
 */
async function selfTestDb() {
  const adminUrl = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
  if (!adminUrl) {
    console.error(
      '✗ import-release db self-test: set CAMP_TEST_DATABASE_URL (any PostGIS server you may\n' +
        '  CREATE DATABASE on; CI sets CI_DATABASE_URL). It FAILS instead of skipping.',
    );
    return false;
  }
  const checks = [];
  const ok = (n, c, d = '') => checks.push({ name: n, pass: Boolean(c), detail: d });
  const psqlOn = (target, sql) =>
    run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', `--dbname=${conninfo(target)}`, '-c', sql]);
  const dbName = `camp332_${process.pid}_${Date.now()}`;
  const target = new URL(adminUrl);
  target.pathname = `/${dbName}`;
  const url = target.toString();
  const dir = mkdtempSync(join(tmpdir(), 'camptribe-dbtest-'));

  const feat = (id, props = {}, geometry = { type: 'Point', coordinates: [14.5, 35.9] }) => ({
    type: 'Feature',
    id,
    geometry,
    properties: props,
  });
  let files = 0;
  const gzOf = (features, raw) => {
    const path = join(dir, `f${files++}.geojson.gz`);
    writeFileSync(path, gzipSync(Buffer.from(raw ?? JSON.stringify({ type: 'FeatureCollection', features }))));
    return path;
  };
  const q = (sql) => psqlOn(url, sql).trim();
  // 🔴 A load that does not finish is a FAILED load, and the session it left
  // behind is ended: psql alive inside a transaction holds the DROP's lock,
  // so every later case on the same table would wait for it — one
  // regression would then read as a hung run instead of as the cases it broke.
  const load = async (features, table = 'stg', extra = {}) => {
    try {
      return await within(20000, loadStaging({ table, gz: gzOf(features, extra.raw), db: extra.db ?? url, chunks: extra.chunks }));
    } catch (e) {
      if (/did not finish/.test(e.message)) {
        q(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`);
      }
      throw e;
    }
  };
  const rows = (t) =>
    JSON.parse(
      q(`SELECT coalesce(json_agg((to_jsonb(x) - 'geom') || jsonb_build_object('wkt', ST_AsText(x.geom)) ORDER BY x.ogc_fid), '[]')
           FROM ${quoteIdent(t)} x`),
    );
  const ids = (t) => rows(t).map((r) => r.id).join(',');
  const rejectsWith = async (p, re) => {
    try {
      await p;
      return false;
    } catch (e) {
      return re.test(`${e.message} ${e.stderr ?? ''}`);
    }
  };
  const columnsOf = (t) =>
    q(`SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position)
         FROM information_schema.columns WHERE table_name = '${t}'`);

  psqlOn(adminUrl, `CREATE DATABASE ${dbName}`);
  try {
    psqlOn(url, 'CREATE EXTENSION IF NOT EXISTS postgis');

    // ── the shape import-spots.ts reads ─────────────────────────────────
    // 🔴 THESE STRINGS ARE THE CONTRACT, and they are read out of the
    // importer's own source rather than retyped here: if import-spots.ts
    // ever changes what it counts as a tag column, this is the case that
    // says the loader no longer matches it.
    const importer = readFileSync(new URL('../../apps/api/src/osm/import-spots.ts', import.meta.url), 'utf8');
    ok("import-spots.ts still reads tags from the text/varchar columns, and the edit date from two integers",
      importer.includes("data_type IN ('text','character varying')") &&
        importer.includes("column_name IN ('@timestamp', '@version')") &&
        importer.includes("row['@timestamp']") && importer.includes('"${TABLE}"') && importer.includes('s.id IS NOT NULL'));

    const first = await load([
      feat('n1', { name: 'A', 'addr:city': 'C', '@timestamp': 1787953167, '@version': 4 }),
      feat('w2', { name: 'B', '@timestamp': 1686737472, '@version': 2 }, {
        type: 'MultiPolygon',
        coordinates: [[[[0, 0], [0, 1], [1, 1], [0, 0]]]],
      }),
    ]);
    ok('the columns are the ones ogr2ogr made, in its order: key, id, the two integers, one varchar per tag, geom',
      columnsOf('stg') ===
        'ogc_fid:integer,id:character varying,@version:integer,@timestamp:integer,addr:city:character varying,name:character varying,geom:USER-DEFINED',
      columnsOf('stg'));
    ok('geom is geometry(Geometry, 4326)', q("SELECT type || ' ' || srid FROM geometry_columns WHERE f_table_name = 'stg'") === 'GEOMETRY 4326');
    ok('ogc_fid is the primary key',
      q(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
          WHERE i.indrelid = 'stg'::regclass AND i.indisprimary`) === 'ogc_fid');
    ok('there is a GiST index on geom, as ogr2ogr left one',
      q("SELECT count(*) FROM pg_indexes WHERE tablename = 'stg' AND indexdef ILIKE '%USING gist (geom)%'") === '1');
    ok("the importer's own question — which columns are tags? — gets exactly id, addr:city and name",
      q(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
          WHERE table_name = 'stg' AND data_type IN ('text','character varying')`) === 'addr:city,id,name');
    ok('and the edit date columns are integers, which is why they are not tags',
      q(`SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY column_name) FROM information_schema.columns
          WHERE table_name = 'stg' AND column_name IN ('@timestamp','@version')`) === '@timestamp:integer,@version:integer');
    const stg = rows('stg');
    ok('both rows are there, in file order, with typed values',
      stg.length === 2 && stg[0].id === 'n1' && stg[1].id === 'w2' && stg[0].ogc_fid === 1 && stg[1].ogc_fid === 2 &&
        stg[0]['@timestamp'] === 1787953167 && stg[1]['@version'] === 2 && stg[0]['addr:city'] === 'C' && stg[1]['addr:city'] === null,
      JSON.stringify(stg));
    ok('a point and a multipolygon arrive as the places they were',
      stg[0].wkt === 'POINT(14.5 35.9)' && stg[1].wkt === 'MULTIPOLYGON(((0 0,0 1,1 1,0 0)))', `${stg[0].wkt} | ${stg[1].wkt}`);
    ok('every geometry is in 4326', q('SELECT count(*) FROM stg WHERE ST_SRID(geom) <> 4326') === '0');
    ok('the loader reports what it did', first.staged === 2 && first.badGeometry === 0 && first.copied === 2 && first.columns === 2,
      JSON.stringify(first));

    ok('the table has statistics straight after the load, so the importer’s first query is planned on them',
      Number(q("SELECT count(*) FROM pg_stats WHERE tablename = 'stg'")) > 0);

    // ── the geometry function, fed text directly ────────────────────────
    // 🔴 Round the JS check, because that is the only way to reach it. Each
    // answer is typed. The first four are what the function is FOR; the
    // fifth documents WHY geometryProblem exists: PostGIS itself answers
    // POINT(0 0) to letters. If a later PostGIS refuses them, that row
    // flips to NULL and says the JS check has become belt-and-braces.
    {
      const asked = (text) =>
        q(`${GEOM_FUNCTION_SQL};
           SELECT coalesce(ST_AsText(pg_temp.camp_geom($geo$${text}$geo$)), 'NULL')`);
      ok('a point is a point', asked('{"type":"Point","coordinates":[14.5,35.9]}') === 'POINT(14.5 35.9)');
      ok('an empty polygon is NULL — not a place', asked('{"type":"Polygon","coordinates":[]}') === 'NULL');
      ok('an empty collection is NULL too', asked('{"type":"GeometryCollection","geometries":[]}') === 'NULL');
      ok('text PostGIS RAISES on is NULL, not an error — one record, not the country',
        asked('{"type":"Point","coordinates":[1,2],"type":"Polygon"}') === 'NULL' && asked('not json at all') === 'NULL');
      ok('(documented, not wanted) PostGIS reads letters as 0,0 — which is why the shape is checked in JS first',
        asked('{"type":"Point","coordinates":["x","y"]}') === 'POINT(0 0)');
    }

    // ── a geometry with a member of its own ─────────────────────────────
    // 🔴 The whole geometry travels as ONE COPY field, so its text is
    // escaped like any other. A member ending in a backslash is the
    // proof: unescaped, COPY turns `\\` into `\` and the JSON string
    // never ends.
    const wild = await load([feat('n1', { name: 'A' }, { type: 'Point', coordinates: [1, 2], note: 'a\ttab, and it ends in a backslash \\' })], 'stg_wild');
    ok('a geometry with an extra member that holds a backslash and a tab still arrives', wild.staged === 1 && rows('stg_wild')[0].wkt === 'POINT(1 2)', JSON.stringify(wild));

    // ── nobody's ~/.psqlrc runs inside an import ────────────────────────
    // 🔴 `\timing on` prints a "Time:" line AFTER the result, and the loader
    // reads the last line of what psql said.
    {
      const rc = join(dir, 'psqlrc');
      writeFileSync(rc, '\\timing on\n');
      const quiet = await loadStaging({ table: 'stg_rc', gz: gzOf([feat('n1')]), db: url, env: { ...process.env, PSQLRC: rc } });
      ok('a psqlrc that prints after every statement does not change what the loader reads', quiet.staged === 1);
    }

    // ── the database counts the rows too ────────────────────────────────
    // 🔴 The loader says how many rows it sent, and the SQL checks that
    // COPY took that many BEFORE the COMMIT. Nothing in a normal run can make
    // the two differ, so this builds the script by hand and lies once.
    {
      const plan = planColumns(new Set(['name']));
      const three = ['a', 'b', 'c']
        .map((id) => copyLine({ id, geometry: '{"type":"Point","coordinates":[1,2]}', props: { name: id } }, plan, { nul: 0, badStamp: 0 }))
        .join('');
      const feed = (table, claimed) => {
        const sql = stagingSql(table, plan, claimed);
        return run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', `--dbname=${conninfo(url)}`, '-f', '-'], { input: sql.before + three + sql.after });
      };
      ok('three rows, three claimed: committed', JSON.parse(feed('stg_count_ok', 3).trim()).staged === 3 && q('SELECT count(*) FROM stg_count_ok') === '3');
      ok('three rows, four claimed: refused by the database, and no table is left behind', (() => {
        try {
          feed('stg_count_lie', 4);
          return false;
        } catch (e) {
          return /COPY took 3 rows, 4 were sent/.test(String(e.stderr)) && q("SELECT to_regclass('stg_count_lie') IS NULL") === 't';
        }
      })());
    }

    // ── awkward values survive COPY ─────────────────────────────────────
    // 🔴 Every one of these breaks a COPY that does not escape: a tab shifts
    // the columns, a newline splits the row, `\N` is NULL, `\.` ends the
    // data. The values are typed here, not computed.
    const awkward = {
      tab: 'a\tb', nl: 'a\nb', cr: 'a\rb', bs: 'a\\b', nullish: '\\N', dot: '\\.', dbl: '\\\\', esc: 'a\\nb',
      empty: '', space: ' ', quotes: '"q" \'s\' ;', uni: '𝒳 🏕️ Ċentru', big: 'x'.repeat(100000),
      sep: 'a b', ctl: 'a\u0001b\u007fc',
    };
    await load([feat('n1', awkward)], 'stg_awkward');
    const got = rows('stg_awkward')[0];
    const lost = Object.entries(awkward).filter(([k, v]) => got[k] !== v).map(([k]) => k);
    ok('every awkward value is read back exactly, the empty string as an empty string and not as NULL',
      lost.length === 0, `changed: ${lost.join(',')}`);

    // ── two keys, one column name ───────────────────────────────────────
    const lower = feat('n1', { name: 'A', fixme: 'low-1' });
    const upper = feat('n2', { name: 'B', FIXME: 'UP-2' });
    const lower3 = feat('n3', { name: 'C', fixme: 'low-3' });
    await load([lower, upper, lower3], 'stg_ab');
    await load([lower3, upper, lower], 'stg_ba');
    const byId = (t) => Object.fromEntries(rows(t).map((r) => [r.id, [r.fixme, r.fixme2]]).sort(([a], [b]) => (a < b ? -1 : 1)));
    ok('the lower-case key keeps `fixme`, the upper-case one gets `fixme2`, and neither value is lost',
      JSON.stringify(byId('stg_ab')) === '{"n1":["low-1",null],"n2":[null,"UP-2"],"n3":["low-3",null]}', JSON.stringify(byId('stg_ab')));
    ok('the same data in the opposite order gives the same table (ogr2ogr did not)',
      JSON.stringify(byId('stg_ab')) === JSON.stringify(byId('stg_ba')));

    // ── the edit date columns exist only when the file has the attribute ──
    await load([feat('n1', { name: 'A' })], 'stg_none');
    ok('a file with no @timestamp makes no such column — import-spots reports that by its absence',
      !columnsOf('stg_none').includes('@timestamp') && !columnsOf('stg_none').includes('@version'), columnsOf('stg_none'));
    await load([feat('n1', { name: 'A' }), feat('n2', { name: 'B', '@timestamp': 5 })], 'stg_some');
    ok('a file where only some features have it makes the column, NULL where it is missing',
      JSON.stringify(rows('stg_some').map((r) => r['@timestamp'])) === '[null,5]');

    // ── one bad record costs one record ─────────────────────────────────
    const doc = [
      JSON.stringify(feat('good1', { name: 'G1' })),
      '{"type":"Feature","id":"broken","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"a":}}',
      JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }),
      JSON.stringify({ type: 'Feature', id: 'nogeom', geometry: null, properties: {} }),
      // PostGIS answers POINT(0 0) to these two without complaint:
      JSON.stringify(feat('letters', {}, { type: 'Point', coordinates: ['x', 'y'] })),
      JSON.stringify(feat('nulls', {}, { type: 'Point', coordinates: [null, null] })),
      JSON.stringify(feat('withz', {}, { type: 'Point', coordinates: [1, 2, 3] })),
      // …and these pass the shape check and are for the database to refuse:
      JSON.stringify(feat('hollow', {}, { type: 'Polygon', coordinates: [] })),
      JSON.stringify(feat('nowhere', {}, { type: 'MultiPolygon', coordinates: [] })),
      JSON.stringify(feat('good2', { name: 'G2' })),
    ];
    const mixed = await load(null, 'stg_mixed', {
      raw: `{"type":"FeatureCollection","features":[${doc.join(',')}]}`,
    });
    ok('the two good records are loaded and nothing else is — in particular no campsite at 0,0',
      ids('stg_mixed') === 'good1,good2' && q('SELECT count(*) FROM stg_mixed WHERE ST_X(ST_PointOnSurface(geom)) = 0') === '0', ids('stg_mixed'));
    ok('each kind of bad record is counted under its own name',
      mixed.skipped['feature is not valid JSON'] === 1 && mixed.skipped['feature has no string id'] === 1 &&
        mixed.skipped['feature has no geometry'] === 1 &&
        mixed.skipped['feature has an unreadable geometry (a position is not two finite numbers)'] === 3 &&
        mixed.badGeometry === 2, JSON.stringify(mixed));
    ok('and the count reconciles: loaded + unreadable geometry + skipped = every feature in the file',
      mixed.staged + mixed.badGeometry + Object.values(mixed.skipped).reduce((a, b) => a + b, 0) === doc.length);
    ok('the notes line says what was left out',
      /2 unreadable geometry/.test(loadNotes(mixed)) && /1 skipped: feature has no string id/.test(loadNotes(mixed)) &&
        /3 skipped: feature has an unreadable geometry/.test(loadNotes(mixed)), loadNotes(mixed));

    // ── a failure leaves the previous table exactly as it was ───────────
    await load([feat('keep1', { name: 'K1' }), feat('keep2', { name: 'K2' })], 'stg_atomic');
    const intact = () => ids('stg_atomic') === 'keep1,keep2' && rows('stg_atomic')[0].name === 'K1';
    const wholeDoc = JSON.stringify({ type: 'FeatureCollection', features: [feat('x1'), feat('x2'), feat('x3')] });
    ok('a file cut short is refused, and the old table is still there',
      (await rejectsWith(load(null, 'stg_atomic', { raw: wholeDoc.slice(0, wholeDoc.length - 30) }), /ends inside the FeatureCollection/)) && intact());
    ok('a file with no feature that can be loaded is refused, and the old table is still there',
      (await rejectsWith(load([{ id: 'only-an-id' }], 'stg_atomic'), /0 loadable feature/)) && intact());
    ok('an empty file is refused, and the old table is still there',
      (await rejectsWith(load([], 'stg_atomic'), /0 loadable feature/)) && intact());
    // 🔴 The case that needs the database: the table has been DROPPED and
    // rebuilt inside the transaction when the last check fails. The
    // rollback is the only thing that brings the old one back.
    ok('every geometry an empty one: the database refuses at the end, and the DROP is rolled back',
      (await rejectsWith(load([feat('x', {}, { type: 'Polygon', coordinates: [] })], 'stg_atomic'), /no row with a usable geometry/)) && intact());
    // 🔴 And the one that needs the stream to break AFTER rows have gone
    // through COPY. The second pass is handed a cut file; the first said
    // three rows and was believed. The connection is closed without a
    // COMMIT, which is the whole of the rollback.
    // 4 000 features is ~400 KB: more than one batch has been written to
    // psql, and COPY has taken rows, by the time the break comes.
    const bigDoc = JSON.stringify({
      type: 'FeatureCollection',
      features: Array.from({ length: 4000 }, (_, i) => feat(`x${i}`, { name: `Camp ${i}` })),
    });
    const cutSecondTime = (() => {
      let n = 0;
      return () => {
        n++;
        return (async function* () {
          yield n === 1 ? bigDoc : bigDoc.slice(0, bigDoc.length - 30);
        })();
      };
    })();
    ok('a stream that breaks after rows were sent is never committed — and psql is let go, not left waiting',
      (await rejectsWith(within(15000, load(null, 'stg_atomic', { chunks: cutSecondTime })), /ends inside the FeatureCollection/)) && intact());
    // 🔴 A psql left alive holds the DROP's lock until the machine is
    // rebooted, and the NEXT import hangs on it. The count is of client
    // sessions other than this one. A backend takes a few milliseconds to go
    // after its psql has exited, so it is given up to 3 s to do so — a check
    // that flickered under an unrelated mutation (it did, once) is a check
    // nobody can trust — and any that is still there is ended so that the
    // cases below can run.
    {
      const strays = () =>
        Number(q(`SELECT count(*) FROM pg_stat_activity
                   WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`));
      let left = strays();
      for (let i = 0; i < 30 && left > 0; i++) {
        await new Promise((done) => setTimeout(done, 100));
        left = strays();
      }
      if (left > 0) q(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`);
      ok('no database session is left behind by a load that failed', left === 0, `${left} left`);
    }
    const shrinks = (() => {
      let n = 0;
      return () => {
        n++;
        return (async function* () {
          yield n === 1 ? wholeDoc : JSON.stringify({ type: 'FeatureCollection', features: [feat('x1')] });
        })();
      };
    })();
    ok('a file that holds fewer rows the second time it is read is refused too',
      (await rejectsWith(load(null, 'stg_atomic', { chunks: shrinks }), /changed while it was being loaded/)) && intact());
    // 🔴 4 000 rows is more than a pipe holds, so psql has gone away while
    // the loader is still writing, and the loader's own error is "psql closed
    // its input". Only psql's words say what is wrong.
    ok('psql’s own words reach the caller when the database cannot be opened, even with data still to send',
      await rejectsWith(load(null, 'stg_atomic', { raw: bigDoc, db: url.replace(dbName, 'camp332_no_such_database') }), /does not exist/));
    ok('…and the old table is still there', intact());
    ok('a table name that is not a plain identifier is refused',
      await rejectsWith(load([feat('n1')], 'a"b'), /not a table name/));

    // 🔴 Into a table that does not exist yet, `DROP TABLE IF EXISTS` says so
    // as a NOTICE — the first line psql writes to stderr. The caller sees the
    // FIRST line, so the notice must not be there to be seen.
    ok('the first thing a failed load says is the error, not a notice about a table that was never there',
      await (async () => {
        try {
          await load([feat('x', {}, { type: 'Polygon', coordinates: [] })], 'stg_never_existed');
          return false;
        } catch (e) {
          return /no row with a usable geometry/.test(e.message) && !/NOTICE/.test(e.message);
        }
      })());

    // ── loading again replaces, it does not add ─────────────────────────
    await load([feat('n9', { name: 'Z' })], 'stg_atomic');
    ok('a second load leaves one table holding the second file', ids('stg_atomic') === 'n9' && q('SELECT count(*) FROM stg_atomic') === '1');

    // ── keys that are not safe to put in SQL ────────────────────────────
    psqlOn(url, 'CREATE TABLE decoy (x int); INSERT INTO decoy VALUES (1)');
    const sixty3 = 'k'.repeat(63);
    const hostile = {
      'a"b': 'quote', 'x;DROP TABLE decoy;--': 'semi', ':colon': 'colon', 'back\\slash': 'bs', "it's": 'apostrophe',
      'ünï': 'unicode', [sixty3]: 'longest allowed', ['k'.repeat(64)]: 'one too long', 'ctl\u0001key': 'control', 'dollar$$': 'd',
    };
    const h = await load([feat('n1', hostile)], 'stg_hostile');
    const hr = rows('stg_hostile')[0];
    ok('awkward keys become awkward-but-quoted columns, holding their values',
      hr['a"b'] === 'quote' && hr['x;drop table decoy;__'] === 'semi' && hr[':colon'] === 'colon' && hr['back\\slash'] === 'bs' &&
        hr.it_s === 'apostrophe' && hr['ünï'] === 'unicode' && hr[sixty3] === 'longest allowed' && hr['dollar$$'] === 'd',
      Object.keys(hr).join(' | '));
    ok('the key SQL injection would need did nothing: the other table is intact', q('SELECT x FROM decoy') === '1');
    ok('a key too long for Postgres and one with a control character are dropped and COUNTED, not truncated',
      h.droppedKeys.length === 2 && !('k'.repeat(64) in hr), JSON.stringify(h.droppedKeys));

    // ── what had to be changed is a number ──────────────────────────────
    const nul = await load([feat('n1', { name: 'a\u0000b', 'k\u0000': 'x', '@timestamp': '17', '@version': 1.5, '': 'blank' })], 'stg_nul');
    const nr = rows('stg_nul')[0];
    ok('a NUL byte in a value is removed and counted; PostgreSQL text cannot hold one',
      nr.name === 'ab' && nul.nul === 1, JSON.stringify([nr.name, nul.nul]));
    ok('an @timestamp that is a string and an @version that is a fraction are NULL — counted, not guessed',
      nr['@timestamp'] === null && nr['@version'] === null && nul.badStamp === 2, JSON.stringify([nr['@timestamp'], nul.badStamp]));
    ok('a NUL in a key and a blank key are dropped, and each is counted',
      nul.droppedKeys.length === 1 && nul.blankKeys === 1);

    // ── volume: the batches ─────────────────────────────────────────────
    // 🔴 Rows are sent in ~256 KB batches, so a row can straddle none of
    // the boundaries and every boundary is crossed. 20 000 rows is ~40 of
    // them, and the ids prove none was dropped or doubled at a seam.
    const many = Array.from({ length: 20000 }, (_, i) =>
      feat(`n${i}`, { name: `Camp ${i}`, tourism: 'camp_site', [`extra${i % 300}`]: `v${i}`, '@timestamp': 1700000000 + i, '@version': 1 }, {
        type: 'Point',
        coordinates: [10 + (i % 1000) / 1000, 40 + Math.floor(i / 1000) / 100],
      }));
    const big = await load(many, 'stg_many');
    ok('20 000 rows across 300 columns: every row once, in order',
      big.staged === 20000 &&
        q('SELECT concat_ws(\',\', count(*), count(DISTINCT id), min(ogc_fid), max(ogc_fid)) FROM stg_many') === '20000,20000,1,20000' &&
        q(`SELECT count(*) FROM stg_many WHERE id <> 'n' || (ogc_fid - 1)`) === '0',
      q('SELECT count(*), count(DISTINCT id), min(ogc_fid), max(ogc_fid) FROM stg_many'));
    ok('…and the last row is the last row: its edit date is 1700019999', q(`SELECT "@timestamp" FROM stg_many WHERE id = 'n19999'`) === '1700019999');

    // ── whatever the machine's locale says ──────────────────────────────
    // 🔴 psql takes its client encoding from PGCLIENTENCODING and the locale.
    // A server whose LANG is not UTF-8 would turn every `Ċ` into two
    // wrong characters, and nothing would complain: the bytes are valid
    // in either. The script says UTF8 itself.
    await loadStaging({
      table: 'stg_latin', gz: gzOf([feat('n1', { name: 'Ċentru tal-Iskawts 🏕️ ünï' })]), db: url,
      env: { ...process.env, PGCLIENTENCODING: 'LATIN1' },
    });
    ok('a client set to LATIN1 still stores UTF-8 text as it was', rows('stg_latin')[0].name === 'Ċentru tal-Iskawts 🏕️ ünï', rows('stg_latin')[0].name);

    // ── the pre-flight, with the real psql ──────────────────────────────
    {
      const fake = mkdtempSync(join(tmpdir(), 'camptribe-fakeapi-'));
      mkdirSync(join(fake, 'dist', 'osm'), { recursive: true });
      writeFileSync(join(fake, 'dist', 'osm', 'import-spots.js'), '');
      const pf = preflight({ env: process.env, apiDir: fake });
      ok('preflight reports the psql version and where the compiled importer is',
        /^psql \(PostgreSQL\) \d+/.test(pf.psql) && pf.importer === join(fake, 'dist', 'osm', 'import-spots.js'), JSON.stringify(pf));
      ok('preflight refuses a machine that has psql but no compiled importer, and names the file',
        (() => { try { preflight({ env: process.env, apiDir: dir }); return false; } catch (e) { return e.message.includes(join(dir, 'dist', 'osm', 'import-spots.js')); } })());
      rmSync(fake, { recursive: true, force: true });
    }
  } catch (err) {
    ok('the db self-test ran to its end', false, `after "${checks.at(-1)?.name.slice(0, 60)}": ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    try {
      psqlOn(adminUrl, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    } catch (e) {
      console.error(`could not drop ${dbName}: ${String(e.message).split('\n')[0]}`);
    }
  }

  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  // 🔴 Counted, as in --self-test: a run that stopped early must not read
  // as a run that passed.
  const EXPECTED_DB_CASES = 53;
  let failed = checks.filter((c) => !c.pass).length;
  if (checks.length !== EXPECTED_DB_CASES) {
    failed += 1;
    console.log(`✗ ${checks.length} cases ran, expected ${EXPECTED_DB_CASES}`);
  }
  console.log(
    failed
      ? `\n✗ import-release db self-test: ${failed} of ${checks.length} failed`
      : `\n✓ import-release db self-test: ${checks.length} cases`,
  );
  return failed === 0;
}

//
// 🔴 CAMP-286 ADDED `realpathSync`: Node resolves `import.meta.url`
// through the real path and leaves argv[1] as written, so through a
// symlink the two never matched and the self-test silently did not run.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  // 🔴 CAMP-286. `--selftest` used to fall through to `main()`, which
  // downloads a Geofabrik extract and rewrites the database. One letter.
  const action = chooseAction(args, KNOWN_FLAGS, 'import-release.mjs', {
    takesValue: FLAGS_WITH_VALUES,
    positional: MAX_COUNTRIES,
  });
  // 🔴 AND THE POSITIONALS ARE COUNTRY CODES, not merely few enough.
  // `chooseAction` counts them; it cannot know what they mean. Review
  // handed this `--tag T fra`: the count passed, the two-letter filter
  // below silently dropped the typo, and the plan came back as all 27
  // member states — a three-letter slip importing the whole Union
  // (CAMP-286).
  const strays = args
    .filter((a) => !a.startsWith('-'))
    .filter((a, i, all) => all.indexOf(a) === i)
    .filter((a) => readOpt(args, 'tag', null) !== a)
    .filter((a) => readOpt(args, 'max-age-days', null) !== a)
    .filter((a) => !/^[a-z]{2}$/i.test(a));
  if (strays.length > 0) {
    throw new Error(
      `import-release.mjs: ${strays.join(', ')} is not a two-letter country ` +
        'code. A three-letter slip used to be dropped in silence and import ' +
        'all 27 member states (CAMP-286).',
    );
  }
  if (action.has('--self-test')) process.exit((await selfTest()) ? 0 : 1);
  else if (action.has('--self-test-db')) process.exit((await selfTestDb()) ? 0 : 1);
  else await main();
}

/**
 * Тимчасова тека для одного прогону, абсолютним шляхом.
 *
 * 🔴 ВИНЕСЕНО З main() РІВНО ТОМУ, ЩО ЦЕЙ РЯДОК БУВ ЗЛАМАНИЙ ТИЖДЕНЬ.
 *
 * Коміт 141c57f (05.10.2026) додав виклик `resolve()` і не додав імпорт.
 * Скрипт падав першим же рядком роботи — `ReferenceError: resolve is not
 * defined` — тобто жодного релізу не можна було завантажити з того дня.
 *
 * А `--self-test` увесь цей час друкував **73/73 passed**, бо перевіряв
 * помічники й ЖОДНОГО разу не заходив у main(). Сімдесят три зелені
 * твердження про скрипт, який не стартує.
 *
 * Тому рядок тепер живе у функції, яку самоперевірка справді викликає:
 * щоб «воно запускається» було перевіреним, а не припущеним.
 */
export function makeWorkDir() {
  return resolve(mkdtempSync(join(tmpdir(), 'camptribe-release-')));
}

/**
 * What this run needs from the machine, checked BEFORE anything is
 * downloaded: the compiled importer under apps/api, and `psql`. A server
 * missing one of them should say so in the first second, not after the first
 * country's download — and must never answer by fetching or building it.
 *
 * The file is looked for FIRST: it costs no process, and it is the one the
 * deploy can leave out.
 */
export function preflight({ env = process.env, apiDir = API_DIR } = {}) {
  const importer = importerPath(apiDir);
  let psql;
  try {
    psql = run('psql', ['--version'], { env }).trim();
  } catch (err) {
    throw new Error(
      err.code === 'ENOENT' ? 'psql is not installed or not on PATH' : `psql does not run: ${err.message.split('\n')[0]}`,
    );
  }
  return { psql, importer };
}

async function main() {
  const { psql, importer } = preflight();
  console.log(`${psql}; importer ${importer}`);

  // Read before any network call: a typo must stop the run at the door.
  const maxAge = parseMaxAge(opt('max-age-days'));
  const tag = opt('tag') ?? (await latestTag());
  if (!tag) throw new Error('no release found');
  // Refused here, once, rather than 27 times as "could not download".
  checkTag(tag);
  checkAge(tag, maxAge);

  console.log(`release ${tag}`);
  const countries = plan(
    args.filter((a) => /^[a-zA-Z]{2}$/.test(a)),
    await assetSizes(tag),
  );
  console.log(`${countries.length} member state(s), smallest first\n`);

  const work = makeWorkDir();
  let done = 0;
  const failures = [];

  try {
    for (const code of countries) {
      const asset = assetFor(code);
      process.stdout.write(`${code.toUpperCase()}  ${asset} … `);
      try {
        const gz = join(work, asset);
        await downloadWithRetry(assetDownloadUrl(tag, asset), gz);

        // 🔴 One load, one transaction, and the COMMIT only after the last
        // feature. See loadStaging for what a bad record and a bad file cost.
        const loaded = await loadStaging({ table: STAGING, gz, db: DB });
        process.stdout.write(`${loaded.staged} staged${loadNotes(loaded)} … `);

        // Run with this very Node and the compiled importer that preflight
        // found: no ts-node, no registry, no PATH lookup. The working
        // directory is apps/api, where the importer's `dotenv` looks for a
        // .env. DATABASE_URL goes through the environment, never the
        // argument list.
        const out = run(process.execPath, [
          importer, code.toUpperCase(), STAGING,
        ], { cwd: API_DIR, env: { ...process.env, DATABASE_URL: DB } });

        const line = out.split('\n').find((l) => /inserted|updated/i.test(l))?.trim();
        console.log(line ?? 'done');
        rmSync(gz, { force: true });
        done++;
      } catch (err) {
        // 🔴 One country's bad day costs that country only. The same rule
        // the workflow's matrix uses, for the same reason: a night's work
        // must not be lost to one bad extract.
        console.log('FAILED');
        failures.push({ code, why: failureReason(err) });
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(`\n${done} imported, ${failures.length} failed`);
  for (const f of failures) console.error(`  ✗ ${f.code}: ${f.why}`);
  if (failures.length > 0) process.exitCode = 1;
}
