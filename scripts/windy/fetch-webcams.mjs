#!/usr/bin/env node
// CAMP-190: the webcams near our campsites, by region, into the database.
//
//   node scripts/windy/fetch-webcams.mjs              # fetch and store
//   node scripts/windy/fetch-webcams.mjs --dry-run    # fetch, report, write nothing
//   node scripts/windy/fetch-webcams.mjs --self-test  # no network, no database
//   node scripts/windy/fetch-webcams.mjs --limit=20   # first N regions only
//
// 🔴 THE TERMS FORBID TWO THINGS, AND BOTH ARE SHAPED INTO THIS FILE
// RATHER THAN LEFT TO WHOEVER RUNS IT.
//
//   "continuous scanning of a significant number of available Webcams
//    and/or downloading of significant portions of the Webcam image
//    history"
//
// Either is a material breach and grounds to cut us off. So:
//
//   · One request per REGION, not per campsite. We have 811 regions and
//     65 435 campsites; the per-campsite walk is 65 435 requests and is
//     exactly the "continuous scanning" they name. `regionQueries`
//     refuses to build more than one query per region.
//   · `IMAGE_FIELDS` is not requested and no image is ever written. The
//     table has no column for one. A reader's browser fetches the frame
//     from Windy's CDN at the moment they look, which is the only form
//     of "showing" the terms permit.
//
// 🔴 AND THE KEY NEVER LEAVES THIS PROCESS. It is read from the
// environment, sent in a header, and never logged — `safeUrl` strips it
// from anything that could reach a console or an error message. The repo
// is public.

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

export const API = 'https://api.windy.com/webcams/api/v3/webcams';
export const PROVIDER = 'windy';

/**
 * 🔴 Not the canonical list. `RESERVED_WORDS` in apps/web/src/lib/cems.ts
 * is, and a script cannot import TypeScript — the same split, and the
 * same reason, as scripts/effis/fetch-wildfires.mjs.
 *
 * `cems-panels.spec.ts` discovers every script holding a copy and
 * refuses any that has drifted, so this cannot quietly fall behind.
 */
export const FORBIDDEN_WORDS =
  /\b(warning(?:s)?|danger(?:s|ous|ously)?|risk(?:s|y|ier|iest|ed|ing)?|alert(?:s|ed|ing)?|evacuat(?:e|es|ed|ing|ion|ions))\b/i;

/**
 * 🔴 The ONE query shape that works, and a typo here does not fail — it
 * returns the planet.
 *
 * Measured 04.10.2026:
 *
 *   ?nearby=46.33,13.55,20        → HTTP 200, total 34      (correct)
 *   ?lat=46.33&lon=13.55&radius=20 → HTTP 200, total 68 276  (everything)
 *
 * An unknown parameter is ignored rather than refused, so a mistyped
 * filter silently asks for the whole catalogue — which is both wrong and
 * the "continuous scanning" the terms forbid. Built in one place, and
 * `nearbyParam` refuses anything that is not three finite numbers.
 */
export function nearbyParam(lat, lon, km) {
  for (const [name, v] of [['lat', lat], ['lon', lon], ['km', km]]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`nearby needs a finite ${name}, got ${JSON.stringify(v)}`);
    }
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(`nearby got a point off the Earth: ${lat},${lon}`);
  }
  if (km <= 0 || km > MAX_RADIUS_KM) {
    throw new Error(`nearby radius must be 0 < km <= ${MAX_RADIUS_KM}, got ${km}`);
  }
  return `${lat},${lon},${km}`;
}

/**
 * How far around a region's centre to look.
 *
 * 🔴 Not a taste: 88% of sampled campsites have a camera within 25 km
 * and the median is 8 (CAMP-189). A region is bigger than that, so the
 * radius is the region's own span plus a margin, capped — see
 * `radiusForRegion`.
 */
export const MAX_RADIUS_KM = 250;
export const MIN_RADIUS_KM = 25;

/**
 * 🔴 PACING, and it is not politeness alone.
 *
 * The first dry run over six Austrian regions took `HTTP 429
 * ThrottlerException` on the sixth. Unpaced, a full pass over 812
 * regions would hammer them for twelve minutes — which is the shape of
 * behaviour their terms name as grounds to cut us off, whatever the
 * row counts say.
 *
 * 600 ms between requests is well inside any sane limit and still
 * finishes 811 regions in about eight minutes. A 429 anyway is waited
 * out rather than retried immediately, because retrying into a closed
 * door is how a rate limit becomes a ban.
 */
export const PAUSE_MS = 600;
export const RATE_LIMIT_BACKOFF_MS = 15_000;
export const RATE_LIMIT_TRIES = 4;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Free tier, measured: `limit > 50` is refused outright. */
export const PAGE_LIMIT = 50;

/**
 * Free tier, measured: `offset > 1000` is refused. So a single query can
 * never see more than 1 050 cameras, and a region holding more than that
 * is reported rather than silently truncated.
 */
export const MAX_OFFSET = 1000;

/** Categories a camper is served by; see the migration for the same list. */
export const KEEP_CATEGORIES = new Set([
  'beach',
  'coast',
  'lake',
  'river',
  'mountain',
  'landscape',
  'forest',
  'meteo',
]);

const R_EARTH_KM = 6371;

/** Great-circle kilometres, for the region span and for reporting. */
export function km(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * A radius that covers the region, with a margin, inside the cap.
 *
 * 🔴 From the region's own bounding box, not a constant. Lappi is 600 km
 * across and Brussels is 15; one number for both either misses most of
 * Finland or asks Belgium about Germany.
 */
export function radiusForRegion(r) {
  const half = km(r.minLat, r.minLon, r.maxLat, r.maxLon) / 2;
  if (!Number.isFinite(half) || half <= 0) return MIN_RADIUS_KM;
  return Math.max(MIN_RADIUS_KM, Math.min(MAX_RADIUS_KM, Math.round(half + 25)));
}

/**
 * One query per region. Returns `{ region, nearby }` and refuses to
 * produce two for the same region.
 *
 * 🔴 This is where "not per campsite" is made mechanical rather than
 * remembered. 811 queries at roughly a second is twelve minutes; 65 435
 * is fourteen and a half hours and is the thing they cut people off for.
 */
export const MAX_REGION_QUERIES = 1500;

export function regionQueries(regions) {
  // 🔴 A CEILING, not only a duplicate check.
  //
  // The header above claimed this made "one request per region"
  // mechanical. It did not: review fed it 65 435 campsite-shaped objects
  // and got 65 435 queries back without a murmur, because distinct keys
  // are distinct. The only thing keeping the run honest was that
  // `main()` happens to read the region index.
  //
  // We hold 811 regions. 1 500 is room for the EU to grow and still far
  // below anything that could be called a walk of the campsite table —
  // which is the thing their terms name as grounds to cut us off.
  if (regions.length > MAX_REGION_QUERIES) {
    throw new Error(
      `refusing ${regions.length} queries: this walks REGIONS (we hold about 811), ` +
        `not campsites. More than ${MAX_REGION_QUERIES} means something is feeding ` +
        'this the wrong table, and a walk of the campsite table is the "continuous ' +
        'scanning" the Windy terms name as a material breach.',
    );
  }
  const seen = new Set();
  const out = [];
  for (const r of regions) {
    const key = `${r.country}/${r.slug}`;
    if (seen.has(key)) {
      throw new Error(`refusing a second query for ${key}: one request per region`);
    }
    seen.add(key);
    out.push({ key, country: r.country, nearby: nearbyParam(r.lat, r.lon, radiusForRegion(r)) });
  }
  return out;
}

/** The key, stripped, so no log line can ever carry it. */
export const safeUrl = (u) => String(u).replace(/(key=)[^&]+/gi, '$1REDACTED');

export function listUrl(nearby, offset = 0) {
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,\d+$/.test(nearby)) {
    throw new Error(`refusing to build a URL with a malformed nearby: ${JSON.stringify(nearby)}`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    throw new Error(`offset must be an integer in 0..${MAX_OFFSET}, got ${offset}`);
  }
  // 🔴 `images` is NOT among the included fields. We do not want them,
  // we must not store them, and a field we never ask for is one nobody
  // can accidentally persist.
  return (
    `${API}?limit=${PAGE_LIMIT}&offset=${offset}` +
    `&nearby=${encodeURIComponent(nearby)}` +
    `&include=${encodeURIComponent('location,urls,categories')}`
  );
}

/**
 * One camera from the catalogue, or null when we cannot show it
 * honestly.
 *
 * 🔴 A row without `urls.detail` is dropped, not stored with a blank.
 * Their terms make the link back the condition of showing the image at
 * all, so a camera we cannot link to is a camera we may not use — and
 * the database says so too (`detail_url NOT NULL`).
 */
export function readWebcam(input) {
  if (!input || typeof input !== 'object') return null;
  const id = input.webcamId;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return null;
  // 🔴 A name we may not print beside Copernicus data. Dropped, not
  // edited: rewriting an operator's own name for their camera would be
  // putting words in their mouth, and the picture would carry a name
  // they never used. The table refuses such a row too.
  if (FORBIDDEN_WORDS.test(title)) return null;
  if (input.status && input.status !== 'active') return null;

  const loc = input.location;
  const lat = loc?.latitude;
  const lon = loc?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const country = typeof loc?.country_code === 'string' ? loc.country_code.toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(country)) return null;

  const detail = input.urls?.detail;
  if (typeof detail !== 'string' || !detail.startsWith('https://')) return null;
  const provider = input.urls?.provider;
  const providerUrl =
    typeof provider === 'string' && provider.startsWith('https://') ? provider : null;

  const categories = Array.isArray(input.categories)
    ? input.categories.map((c) => (typeof c === 'string' ? c : c?.id)).filter((c) => typeof c === 'string')
    : [];
  // A camera that shows none of the eight is an airport lounge or a town
  // square; true, and nothing to do with where somebody sleeps.
  if (!categories.some((c) => KEEP_CATEGORIES.has(c))) return null;

  const at = input.lastUpdatedOn;
  const lastFrameAt =
    typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null;

  return {
    provider: PROVIDER,
    ref: String(id),
    title,
    country,
    categories: categories.filter((c) => KEEP_CATEGORIES.has(c)),
    lat,
    lon,
    detailUrl: detail,
    providerUrl,
    lastFrameAt,
  };
}

/** Every page of one region's query, stopping at the tier's own ceiling. */
export async function fetchRegion(nearby, fetchImpl, key, pause = sleep) {
  const out = [];
  let total = null;
  let truncated = false;
  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_LIMIT) {
    let res = null;
    for (let attempt = 1; attempt <= RATE_LIMIT_TRIES; attempt++) {
      // 🔴 EVERY request, including the first page of a region.
      //
      // This used to skip the pause when `offset === 0 && attempt === 1`
      // — and review measured that a typical region is ONE page, so the
      // pause never ran at all inside `fetchRegion`. The whole defence
      // for 811 regions rested on a line in `main()` that no test
      // touched.
      await pause(PAUSE_MS);
      res = await fetchImpl(listUrl(nearby, offset), {
        headers: { 'x-windy-api-key': key },
      });
      // 🔴 Wait it out, do not retry straight into it. A tight retry on
      // a rate limit is how a throttle becomes a ban.
      if (res.status !== 429) break;
      if (attempt < RATE_LIMIT_TRIES) await pause(RATE_LIMIT_BACKOFF_MS * attempt);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${safeUrl(listUrl(nearby, offset))} → HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const page = await res.json();
    if (total === null) total = page.total ?? 0;
    const rows = Array.isArray(page.webcams) ? page.webcams : [];
    out.push(...rows);
    if (rows.length < PAGE_LIMIT) break;
    if (offset + PAGE_LIMIT > MAX_OFFSET) {
      // 🔴 Said out loud rather than silently cut. The free tier stops
      // at 1 050 rows per query; a region with more is a region we have
      // only partly seen, and a count that looks complete is worse than
      // one that admits it is not.
      truncated = (total ?? 0) > out.length;
      break;
    }
  }
  return { total: total ?? 0, rows: out, truncated };
}

/** Prove the rules bite. No network, no database. */
export async function selfTest() {
  let rc = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) console.log(`ok   ${name}`);
    else {
      console.error(`FAIL ${name} ${extra}`);
      rc = 1;
    }
  };
  const threw = (fn, re) => {
    try {
      fn();
      return false;
    } catch (e) {
      return re.test(e.message);
    }
  };

  // --- the query that must never ask for the planet
  ok('nearby accepts a real point', nearbyParam(46.33, 13.55, 25) === '46.33,13.55,25');
  ok('…refuses a string where a number belongs', threw(() => nearbyParam('46.33', 13.55, 25), /finite lat/));
  ok('…refuses a point off the Earth', threw(() => nearbyParam(91, 0, 25), /off the Earth/));
  ok('…refuses a radius of zero or past the cap', threw(() => nearbyParam(46, 13, 0), /radius/) && threw(() => nearbyParam(46, 13, 9999), /radius/));
  // 🔴 THE MEASURED NUMBERS, WRITTEN OUT. The ceiling test used to build
  // its fixture from `MAX_OFFSET`, so raising it 1 000 → 10 000 left the
  // self-test green while a run would issue 201 requests per region and
  // pull 10 050 rows — the "continuous scanning" the header forbids.
  // Both numbers were measured against the free tier: `limit > 50` and
  // `offset > 1000` are refused outright.
  ok('the free tier page size is the measured 50', PAGE_LIMIT === 50, String(PAGE_LIMIT));
  ok('the free tier offset ceiling is the measured 1000', MAX_OFFSET === 1000, String(MAX_OFFSET));
  ok('listUrl refuses an offset past 1000, written out', threw(() => listUrl('46,13,25', 1001), /offset must be/));
  ok('listUrl refuses a malformed nearby', threw(() => listUrl('46.33,13.55'), /malformed nearby/));
  ok('…refuses an offset past the tier ceiling', threw(() => listUrl('46,13,25', MAX_OFFSET + 1), /offset must be/));
  // 🔴 The field we must never request, because a field never asked for
  // is one nobody can accidentally store.
  ok('…never asks for images', !listUrl('46,13,25').includes('images'));

  // --- one request per region, made mechanical
  const region = (slug) => ({ country: 'SI', slug, lat: 46.3, lon: 13.5, minLat: 46, minLon: 13, maxLat: 46.6, maxLon: 14 });
  ok('one query per region', regionQueries([region('a'), region('b')]).length === 2);
  ok(
    '🔴 …and a second query for the same region is refused',
    threw(() => regionQueries([region('a'), region('a')]), /one request per region/),
  );
  ok(
    '🔴 …and so is a list the size of the campsite table',
    threw(
      () => regionQueries(Array.from({ length: MAX_REGION_QUERIES + 1 }, (_x, i) => region(`r${i}`))),
      /continuous scanning/,
    ),
  );

  // --- the radius follows the region, not a constant
  const lappi = radiusForRegion({ minLat: 66, minLon: 20, maxLat: 70, maxLon: 30 });
  const brussels = radiusForRegion({ minLat: 50.78, minLon: 4.24, maxLat: 50.91, maxLon: 4.48 });
  ok('a wide region gets a wide radius', lappi > brussels, `${lappi} vs ${brussels}`);
  ok('…and neither escapes the bounds', lappi <= MAX_RADIUS_KM && brussels >= MIN_RADIUS_KM);
  ok('a region with no span still gets a usable radius', radiusForRegion({ minLat: 1, minLon: 1, maxLat: 1, maxLon: 1 }) === MIN_RADIUS_KM);

  // --- the key never reaches a log
  ok('safeUrl strips a key', safeUrl('https://x/?key=abc123') === 'https://x/?key=REDACTED');
  ok('…wherever it sits in the query', !safeUrl('https://x/?a=1&KEY=abc123&b=2').includes('abc123'));

  // --- a camera we cannot show honestly is not stored
  const full = {
    webcamId: 1, title: 'Bovec', status: 'active',
    location: { latitude: 46.33, longitude: 13.55, country_code: 'si' },
    urls: { detail: 'https://windy.com/webcams/1', provider: 'https://skaping.com/x' },
    categories: [{ id: 'mountain' }], lastUpdatedOn: '2026-10-04T18:10:57.000Z',
  };
  const good = readWebcam(full);
  ok('a complete camera is read', good?.ref === '1' && good.country === 'SI');
  ok('…and its country is upper-cased to ISO', good?.country === 'SI');
  ok('🔴 a camera with no link back is DROPPED, not blanked', readWebcam({ ...full, urls: { provider: 'https://x' } }) === null);
  ok('…and so is one whose link is not https', readWebcam({ ...full, urls: { detail: 'http://windy.com/1' } }) === null);
  ok('an inactive camera is dropped', readWebcam({ ...full, status: 'inactive' }) === null);
  ok('a camera with no usable position is dropped', readWebcam({ ...full, location: { latitude: 'x', longitude: 13 } }) === null);
  ok('…and one off the Earth', readWebcam({ ...full, location: { ...full.location, latitude: 99 } }) === null);
  ok('a country that is not two letters is dropped', readWebcam({ ...full, location: { ...full.location, country_code: 'SLO' } }) === null);
  // 🔴 An ALLOW list, not a deny list. Real categories measured on one
  // query included traffic, city, village and building — none of which
  // the card's deny list named. A new category Windy invents tomorrow is
  // excluded by default, which is the safe direction beside a campsite.
  // 🔴 The rule moved here from the web lib, so the test moved with it.
  ok('🔴 a camera whose own name says a reserved word is dropped', readWebcam({ ...full, title: 'Bovec: flood warning camera' }) === null);
  ok('…in any case and any inflection', readWebcam({ ...full, title: 'ALERT Bay webcam' }) === null && readWebcam({ ...full, title: 'camera at risky point' }) === null);
  ok('…but a lookalike is not the word — "Alerta" is a commune', readWebcam({ ...full, title: 'Alerta › South' })?.title === 'Alerta › South');
  ok('a camera in no useful category is dropped', readWebcam({ ...full, categories: [{ id: 'airport' }] }) === null);
  ok('…and a useful one among useless ones is kept', readWebcam({ ...full, categories: [{ id: 'airport' }, { id: 'beach' }] })?.categories.join() === 'beach');
  ok('a missing provider url is null, not a guess', readWebcam({ ...full, urls: { detail: full.urls.detail } })?.providerUrl === null);
  ok('an unparseable timestamp is null, not now()', readWebcam({ ...full, lastUpdatedOn: 'soon' })?.lastFrameAt === null);

  // --- pacing, which the first real dry run proved was missing
  let slept = [];
  const fakePause = async (ms) => {
    slept.push(ms);
  };
  let calls = 0;
  const limiter = async () => {
    calls += 1;
    // First call is refused as rate-limited, second succeeds.
    if (calls === 1) return { ok: false, status: 429, text: async () => 'ThrottlerException' };
    return { ok: true, status: 200, json: async () => ({ total: 1, webcams: [] }) };
  };
  await fetchRegion('46,13,25', limiter, 'k', fakePause);
  ok('🔴 a 429 is waited out, not retried straight into', slept.some((ms) => ms >= RATE_LIMIT_BACKOFF_MS), JSON.stringify(slept));
  ok('…and the request is made again after the wait', calls === 2, `calls=${calls}`);

  slept = [];
  calls = 0;
  const always429 = async () => {
    calls += 1;
    return { ok: false, status: 429, text: async () => 'no' };
  };
  let gaveUp = false;
  try {
    await fetchRegion('46,13,25', always429, 'k', fakePause);
  } catch (e) {
    gaveUp = /HTTP 429/.test(e.message);
  }
  ok('…and it gives up rather than hammering for ever', gaveUp);
  // 🔴 Count the REQUESTS, not the pauses. An earlier version of this
  // counted sleeps, so raising the loop bound to 99 while leaving the
  // sleep condition alone produced ninety-nine requests with three
  // pauses — unbounded hammering that the test called bounded.
  ok(
    '…after a bounded number of REQUESTS, not merely of pauses',
    calls === RATE_LIMIT_TRIES,
    `made ${calls} requests, expected ${RATE_LIMIT_TRIES}`,
  );

  // 🔴 The pause must be AWAITED, not merely declared. The old test
  // asserted `PAUSE_MS >= 500` — a statement about a constant that
  // survived deleting every `await pause(...)` in the file.
  slept = [];
  calls = 0;
  const onePage = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ total: 1, webcams: [{}] }) };
  };
  await fetchRegion('46,13,25', onePage, 'k', fakePause);
  ok(
    '🔴 a single-page region still pauses — which is the common case',
    calls === 1 && slept.filter((ms) => ms === PAUSE_MS).length === 1,
    `calls=${calls} pauses=${JSON.stringify(slept)}`,
  );
  ok('the pause between requests is a real interval', PAUSE_MS >= 500);

  // 🔴 Truncation is REPORTED, not silently swallowed. The headline
  // claim — "the script says so rather than returning a smaller number"
  // — had no test at all, and `truncated = false` survived every run.
  let served = 0;
  const manyPages = async () => {
    served += 1;
    // Always a full page, so paging runs to the ceiling.
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 5000, webcams: Array.from({ length: PAGE_LIMIT }, () => ({})) }),
    };
  };
  const big = await fetchRegion('46,13,25', manyPages, 'k', fakePause);
  ok('🔴 a region past the tier ceiling is reported as truncated', big.truncated === true);
  ok('…and it stops at the ceiling rather than paging for ever', served <= MAX_OFFSET / PAGE_LIMIT + 1, `served=${served}`);
  const small = await fetchRegion('46,13,25', onePage, 'k', fakePause);
  ok('…while a region that fits is not called truncated', small.truncated === false);

  console.log(rc === 0 ? '\nall self-tests passed' : '\nSELF-TEST FAILED');
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

if (invokedDirectly && process.argv.includes('--self-test')) {
  process.exit(await selfTest());
}

/**
 * Store a batch. Upsert by (provider, ref) so a re-run refreshes rather
 * than duplicating, and `fetched_at` moves so staleness is visible.
 */
export function upsertSql(rows) {
  if (rows.length === 0) return null;
  // 🔴 Nine placeholders per row for the row's own columns, then one
  // more each for `last_frame_at` in a second block at the end.
  //
  // Two blocks rather than ten-per-row because the timestamps are
  // appended as a group below; keeping the arithmetic in one place is
  // what stops a parameter landing in the wrong column, which Postgres
  // would accept wherever the types happen to agree.
  const PER_ROW = 9;
  const tsBase = rows.length * PER_ROW;
  const values = rows
    .map((_r, i) => {
      const b = i * PER_ROW;
      return (
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::text[],` +
        `ST_SetSRID(ST_MakePoint($${b + 6},$${b + 7}),4326)::geography,` +
        `$${b + 8},$${b + 9},$${tsBase + i + 1},now())`
      );
    })
    .join(',');
  const params = rows.flatMap((r) => [
    r.provider, r.ref, r.title, r.country, r.categories, r.lon, r.lat, r.detailUrl, r.providerUrl,
  ]);
  params.push(...rows.map((r) => r.lastFrameAt));
  return {
    text:
      `INSERT INTO webcams (provider, ref, title, country, categories, location, detail_url, provider_url, last_frame_at, fetched_at)
       VALUES ${values}
       ON CONFLICT (provider, ref) DO UPDATE SET
         title = EXCLUDED.title,
         country = EXCLUDED.country,
         categories = EXCLUDED.categories,
         location = EXCLUDED.location,
         detail_url = EXCLUDED.detail_url,
         provider_url = EXCLUDED.provider_url,
         last_frame_at = EXCLUDED.last_frame_at,
         fetched_at = now()`,
    params,
  };
}

// ── running it ──────────────────────────────────────────────────────────

const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';
const REGIONS_URL = process.env.CAMPTRIBE_API ?? 'http://localhost:3001';

/**
 * 🔴 The key comes from the environment and is never written anywhere.
 *
 * The repository is public and a key in a log is a key in the world. It
 * is read here, passed in a header, and `safeUrl` keeps it out of every
 * message this file can produce.
 */
function apiKey() {
  const k = process.env.WINDY_WEBCAMS_API_KEY;
  if (!k) {
    throw new Error(
      'WINDY_WEBCAMS_API_KEY is not set. It lives in apps/api/.env, which is\n' +
        'gitignored. Never paste it into a command line — the shell keeps a history.',
    );
  }
  return k;
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const only = limitArg ? Number(limitArg.slice('--limit='.length)) : null;
  if (limitArg && (!Number.isInteger(only) || only <= 0)) {
    throw new Error(`--limit wants a positive integer, got ${limitArg}`);
  }

  const res = await fetch(`${REGIONS_URL}/spots/map/regions`);
  if (!res.ok) {
    throw new Error(
      `the region index answered HTTP ${res.status}. This import walks OUR regions,\n` +
        'not Windy\'s catalogue, so without it there is nothing to ask about.',
    );
  }
  const regions = await res.json();
  if (!Array.isArray(regions) || regions.length === 0) {
    // 🔴 An empty index is a broken API, not a continent with no regions.
    // Treating it as "nothing to do" would exit 0 over a no-op.
    throw new Error('the region index is empty — refusing to report success over nothing');
  }

  const queries = regionQueries(only ? regions.slice(0, only) : regions);
  console.log(`${queries.length} regions, one request each (never one per campsite)`);

  const key = apiKey();
  const { default: pg } = await import('pg');
  const client = dryRun ? null : new pg.Client({ connectionString: DB });
  if (client) await client.connect();

  let seen = 0;
  let kept = 0;
  const truncated = [];
  const failed = [];

  for (const [i, q] of queries.entries()) {
    if (i > 0) await sleep(PAUSE_MS);
    let page;
    try {
      page = await fetchRegion(q.nearby, fetch, key);
    } catch (err) {
      // 🔴 One region's failure is one region, not the run. But it is
      // COUNTED and printed at the end: a quiet skip would turn a broken
      // half of Europe into a smaller number nobody questions.
      failed.push(`${q.key}: ${(err && err.message) || err}`);
      continue;
    }
    seen += page.rows.length;
    if (page.truncated) truncated.push(`${q.key} (${page.total})`);
    const rows = page.rows.map(readWebcam).filter(Boolean);
    kept += rows.length;
    if (client) {
      const sql = upsertSql(rows);
      if (sql) await client.query(sql.text, sql.params);
    }
    if ((i + 1) % 25 === 0 || i + 1 === queries.length) {
      console.log(`  ${i + 1}/${queries.length} regions · ${seen} seen · ${kept} kept`);
    }
  }

  if (client) {
    const { rows } = await client.query(
      'SELECT count(*)::int AS n, count(DISTINCT country)::int AS countries FROM webcams',
    );
    console.log(`\nstored: ${rows[0].n} cameras across ${rows[0].countries} countries`);
    await client.end();
  } else {
    console.log('\n--dry-run: nothing written');
  }

  if (truncated.length) {
    // 🔴 Said out loud. The free tier stops at 1 050 rows per query, so a
    // region with more has been seen in part. A count that looked whole
    // would be the quiet kind of wrong.
    console.log(
      `\n⚠️ ${truncated.length} region(s) hit the free tier's 1 050-row ceiling and were ` +
        `seen only in part:\n   ${truncated.slice(0, 10).join('\n   ')}`,
    );
  }
  if (failed.length) {
    console.error(`\n✗ ${failed.length} region(s) failed:\n   ${failed.slice(0, 10).join('\n   ')}`);
    return 1;
  }
  return 0;
}

if (invokedDirectly && !process.argv.includes('--self-test')) {
  process.exit(await main(process.argv.slice(2)));
}
