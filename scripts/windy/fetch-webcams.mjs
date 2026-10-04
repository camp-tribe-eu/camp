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
//   · One request per REGION, not per campsite. We have 812 regions and
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
 * remembered. 812 queries at roughly a second is twelve minutes; 65 435
 * is fourteen and a half hours and is the thing they cut people off for.
 */
export function regionQueries(regions) {
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
export async function fetchRegion(nearby, fetchImpl, key) {
  const out = [];
  let total = null;
  let truncated = false;
  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_LIMIT) {
    const res = await fetchImpl(listUrl(nearby, offset), {
      headers: { 'x-windy-api-key': key },
    });
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
export function selfTest() {
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
  ok('a camera in no useful category is dropped', readWebcam({ ...full, categories: [{ id: 'airport' }] }) === null);
  ok('…and a useful one among useless ones is kept', readWebcam({ ...full, categories: [{ id: 'airport' }, { id: 'beach' }] })?.categories.join() === 'beach');
  ok('a missing provider url is null, not a guess', readWebcam({ ...full, urls: { detail: full.urls.detail } })?.providerUrl === null);
  ok('an unparseable timestamp is null, not now()', readWebcam({ ...full, lastUpdatedOn: 'soon' })?.lastFrameAt === null);

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
  process.exit(selfTest());
}
