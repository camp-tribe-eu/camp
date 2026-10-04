#!/usr/bin/env node
// CAMP-163: the Combined Drought Indicator, sampled where the campsites are.
//
//   node scripts/edo/fetch-drought.mjs              # probe, fetch, write
//   node scripts/edo/fetch-drought.mjs --dry-run    # fetch, summarise, write nothing
//   node scripts/edo/fetch-drought.mjs --self-test  # no network at all
//   node scripts/edo/fetch-drought.mjs --probe      # just say what dekad is newest
//
// 🔴 WHY DROUGHT IS THE ONE SLOW LAYER WE CAN SHOW HONESTLY.
//
// The newest dekad is three weeks old and that is not a fault: the CDI is
// a ten-day product by construction. Every other hazard we looked at had
// to be either fast or dropped. This one can be shown exactly as it is,
// with its dekad printed, and nothing about it pretends to be live.
//
// 🔴 THE DOCUMENTATION OF THIS SERVICE IS WRONG IN SIX PLACES.
//
// docs/emergency-sources.md §4 found four. Two more were measured on
// 04.10.2026 while writing this file, and both are the same shape — a
// thing advertised and not served:
//
//   5. `cdirc` is published as a separate product, "No Drought and
//      Recovery CDI v.4", with its own entry and its own legend URL. It
//      serves the IDENTICAL raster: 0 differing pixels out of 2 188 800
//      against `cdiad` on 2026-09-11, and a byte-identical legend PNG.
//      There is no second layer to fetch.
//   6. `ne_10m_ocean_mask` is in GetCapabilities and answers GetMap with
//      HTTP 400 `PRODUCT_NOT_FOUND`. That one cost a design: it would
//      have been the exact land/water boundary, from the provider, and
//      it does not exist. See `domain mask` below for what replaced it.
//
// So: nothing here is read from GetCapabilities. Not one value.
//
// 🔴 THE AVAILABLE RANGE IS READ FROM A DELIBERATE OUT-OF-RANGE REQUEST.
//
// The capabilities document advertised `2012-01-01/2026-06-11/P10D` while
// the server served 2026-09-01 (§4, 28.09.2026). Six days later the
// server served 2026-09-11. The error body is the only thing that has
// ever been right:
//
//   TIME=2030-01-01 → HTTP 422
//   {"code":"DATE_OUT_OF_RANGE",
//    "details":{"available_range":"2012-01-01 - 2026-09-11"}}
//
// A hard-coded newest dekad would have been stale within the week it was
// written. `probeRange()` asks every run.
//
// 🔴 THE OUTPUT IS COMMITTED, DELIBERATELY.
//
// Same reasoning as scripts/effis/fetch-wildfires.mjs: a build that
// fetched Copernicus at render time would answer "no drought anywhere"
// on the day the service changed shape. This runs by hand, writes a
// file, and a person reads the diff.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { realpathSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'apps', 'web', 'src', 'data', 'drought.json');

const WCS = 'https://drought.emergency.copernicus.eu/api/wcs';

/**
 * 🔴 The ONE coverage. `cdirc` is the same raster (see above) and
 * `cdinx`/`smand` stop in 2024 — both answer DATE_OUT_OF_RANGE for a
 * current dekad, measured 04.10.2026. Naming one here rather than
 * iterating a list is the point: a list invites someone to add the
 * stale ones back.
 */
export const COVERAGE = 'cdiad';

/** Deliberately outside any plausible range, to make the server tell us the real one. */
export const PROBE_DATE = '2030-01-01';

/** A sixty-request rebuild meets a blip. Retry, then say which dekad. */
export const ATTEMPTS = 3;
export const RETRY_PAUSE_MS = 2000;

/**
 * The CDI grid, as the factsheet states it and as every raster we have
 * fetched reports it.
 *
 * Checked against the GeoTIFF's own tags on every fetch — see
 * `readGeoTiff`. A silent re-projection upstream would otherwise move
 * every campsite's sample to the wrong pixel while the file still looked
 * perfectly valid.
 */
export const GRID = Object.freeze({
  width: 1824,
  height: 1200,
  lon0: -25,
  lat0: 72,
  pixel: 1 / 24,
});

/**
 * What we keep. The grid spans the Sahara and the mid-Atlantic; we serve
 * the EU-27's European territory.
 *
 * ⚠️ The French overseas departments are outside the CDI grid entirely
 * (the factsheet's bounding box is -25..51, 22..72), so no crop could
 * include them. They have no drought panel and the reason is the source,
 * not this window.
 */
export const CROP = Object.freeze({ west: -18.5, north: 71.5, east: 34.8, south: 34.5 });

/**
 * The seven classes, from the EDO factsheet for CDI v4.1.1, Table 1.
 *
 * 🔴 `label` IS NOT THE OFFICIAL NAME, AND THAT IS NOT A STYLE CHOICE.
 *
 * The official LEVEL names for 2 and 3 are "Warning" and "Alert". Both
 * are in `RESERVED_WORDS` (apps/web/src/lib/cems.ts): the CEMS terms we
 * publish under do not let us dress Copernicus data as an instruction,
 * and those two words are exactly that. So the labels below are built
 * from the factsheet's INTERPRETATION column instead, which describes a
 * measurement rather than a command.
 *
 * `official` is kept beside each one so that the mapping is auditable —
 * a reader of this file can check our word against theirs — and
 * `checkWording` below refuses to let `official` reach the output.
 */
export const CLASSES = Object.freeze([
  { value: 0, official: 'No drought', label: 'no drought', detail: 'Normal conditions.' },
  {
    value: 1,
    official: 'Watch',
    label: 'less rain than normal',
    detail: 'A precipitation deficit, measured against this place’s own record.',
  },
  {
    value: 2,
    official: 'Warning',
    label: 'dry ground',
    detail: 'The precipitation deficit has reached the soil: soil moisture is below normal.',
  },
  {
    value: 3,
    official: 'Alert',
    label: 'vegetation under stress',
    detail: 'Plant growth is below normal, together with the dry ground and the missing rain.',
  },
  {
    value: 4,
    official: 'Recovery',
    label: 'recovered',
    detail: 'Rain, soil water and plant growth have returned to normal after a dry episode.',
  },
  {
    value: 5,
    official: 'Temporary Soil Moisture recovery',
    label: 'soil recovering',
    detail: 'Soil moisture is back above its threshold, but the dry episode is not closed.',
  },
  {
    value: 6,
    official: 'Temporary vegetation recovery',
    label: 'vegetation recovering',
    detail: 'Plant growth is back above its threshold, but the dry episode is not closed.',
  },
]);

/**
 * 🔴 Not the canonical list. `RESERVED_WORDS` in apps/web/src/lib/cems.ts
 * is, and this script cannot import TypeScript — same split, and same
 * reason, as scripts/effis/fetch-wildfires.mjs. The unit test asserts the
 * two are the same source string, so they can only drift in view.
 */
export const FORBIDDEN_WORDS =
  /\b(warning(?:s)?|danger(?:s|ous|ously)?|risk(?:s|y|ier|iest|ed|ing)?|alert(?:s|ed|ing)?|evacuat(?:e|es|ed|ing|ion|ions))\b/i;

export const ATTRIBUTION = (year) =>
  `Contains modified Copernicus Emergency Management Service information ${year}`;

/**
 * Refuse to write a reserved word.
 *
 * 🔴 Walks the whole structure, not a list of fields someone remembered.
 * The labels above were written to pass this; the `official` names were
 * written to fail it, and a test drives each one through to prove the
 * gate is the reason they never ship rather than our good intentions.
 */
export function checkWording(value, path = 'output') {
  if (typeof value === 'string') {
    if (FORBIDDEN_WORDS.test(value)) {
      throw new Error(
        `REFUSING TO WRITE: ${path} uses a word the CEMS terms reserve for ` +
          `the authorities: ${JSON.stringify(value)}`,
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkWording(v, `${path}[${i}]`));
    return value;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) checkWording(v, `${path}.${k}`);
    return value;
  }
  return value;
}

/** `"2012-01-01 - 2026-09-11"` → `{ first, last }`. */
export function parseRange(body) {
  const raw = typeof body === 'string' ? safeJson(body) : body;
  const range = raw?.details?.available_range;
  if (typeof range !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/.exec(range.trim());
  return m ? { first: m[1], last: m[2] } : null;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function coverageUrl(coverageID, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(time))) {
    throw new Error(`refusing to build a URL with a non-date TIME: ${JSON.stringify(time)}`);
  }
  return (
    `${WCS}?map=DO_WCS&SERVICE=WCS&VERSION=2.0.0&REQUEST=GetCoverage` +
    `&coverageID=${encodeURIComponent(coverageID)}&CRS=EPSG:4326&format=GEOTIFF` +
    `&TIME=${time}`
  );
}

/**
 * Ask the server what it actually has.
 *
 * 🔴 An out-of-range request, every run, never GetCapabilities. See the
 * header: the capabilities document has never once been right about this.
 */
export async function probeRange(fetchImpl = fetch) {
  const res = await fetchImpl(coverageUrl(COVERAGE, PROBE_DATE));
  const body = await res.text();
  const range = parseRange(body);
  if (!range) {
    throw new Error(
      `the out-of-range probe did not report a range (HTTP ${res.status}). ` +
        'Nothing here may fall back to GetCapabilities or to a remembered ' +
        `date — both have been wrong. Body: ${body.slice(0, 300)}`,
    );
  }
  return range;
}

/**
 * How old is the newest dekad, in whole days?
 *
 * 🔴 Dates only, both sides, so a run at 23:00 and a run at 01:00 do not
 * disagree by a day about the same dekad.
 */
export function dekadAgeDays(dekad, today) {
  const a = Date.parse(`${dekad}T00:00:00Z`);
  const b = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Read an uncompressed single-band GeoTIFF into `{ width, height, lon0,
 * lat0, pixel, px }`.
 *
 * 🔴 Reads the geometry from the FILE, then compares it with `GRID`. The
 * whole panel is "the value at this campsite's pixel"; a re-projection
 * or a resolution change upstream would keep every byte valid and move
 * every answer somewhere else on the map. That must be loud.
 */
export function readGeoTiff(buf) {
  const d = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const little = d[0] === 0x49 && d[1] === 0x49;
  if (!little && !(d[0] === 0x4d && d[1] === 0x4d)) throw new Error('not a TIFF');
  const u16 = (o) => (little ? d.readUInt16LE(o) : d.readUInt16BE(o));
  const u32 = (o) => (little ? d.readUInt32LE(o) : d.readUInt32BE(o));
  const f64 = (o) => (little ? d.readDoubleLE(o) : d.readDoubleBE(o));

  const ifd = u32(4);
  const n = u16(ifd);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
  }
  const SIZES = { 1: 1, 3: 2, 4: 4, 12: 8 };
  const read = (tag) => {
    const t = tags.get(tag);
    if (!t) return null;
    const size = SIZES[t.type];
    if (!size) throw new Error(`unsupported TIFF type ${t.type} on tag ${tag}`);
    const total = size * t.count;
    const base = total > 4 ? u32(t.at) : t.at;
    const out = [];
    for (let i = 0; i < t.count; i++) {
      const o = base + i * size;
      out.push(t.type === 12 ? f64(o) : t.type === 4 ? u32(o) : t.type === 3 ? u16(o) : d[o]);
    }
    return out;
  };

  const width = read(256)?.[0];
  const height = read(257)?.[0];
  const bits = read(258)?.[0] ?? 8;
  const scale = read(33550);
  const tie = read(33922);
  const offsets = read(273);
  const counts = read(279);
  if (!width || !height || !offsets || !counts) throw new Error('TIFF is missing basic tags');
  if (bits !== 8) throw new Error(`expected an 8-bit band, got ${bits}`);

  const px = Buffer.concat(
    offsets.map((o, i) => d.subarray(o, o + counts[i])),
  );
  if (px.length !== width * height) {
    throw new Error(`pixel data is ${px.length} bytes, expected ${width * height}`);
  }

  const got = {
    width,
    height,
    lon0: tie ? tie[3] : NaN,
    lat0: tie ? tie[4] : NaN,
    pixel: scale ? scale[0] : NaN,
  };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  if (
    got.width !== GRID.width ||
    got.height !== GRID.height ||
    !near(got.lon0, GRID.lon0) ||
    !near(got.lat0, GRID.lat0) ||
    !near(got.pixel, GRID.pixel)
  ) {
    throw new Error(
      'the CDI grid moved. Expected ' +
        `${GRID.width}x${GRID.height} at (${GRID.lon0},${GRID.lat0}) px ${GRID.pixel}, got ` +
        `${got.width}x${got.height} at (${got.lon0},${got.lat0}) px ${got.pixel}. ` +
        'Every sample below is a lookup by pixel, so this would silently ' +
        'answer about the wrong place rather than fail.',
    );
  }
  return { ...got, px };
}

/** The crop window, in whole pixels, as integers the decoder can reproduce. */
export function cropWindow(grid = GRID, crop = CROP) {
  const col0 = Math.max(0, Math.floor((crop.west - grid.lon0) / grid.pixel));
  const col1 = Math.min(grid.width, Math.floor((crop.east - grid.lon0) / grid.pixel) + 1);
  const row0 = Math.max(0, Math.floor((grid.lat0 - crop.north) / grid.pixel));
  const row1 = Math.min(grid.height, Math.floor((grid.lat0 - crop.south) / grid.pixel) + 1);
  return {
    col0,
    row0,
    width: col1 - col0,
    height: row1 - row0,
    lon0: grid.lon0 + col0 * grid.pixel,
    lat0: grid.lat0 - row0 * grid.pixel,
    pixel: grid.pixel,
  };
}

export function cropPixels(px, grid, win) {
  // 🔴 Takes the PIXELS, not the object `readGeoTiff` returns. Passing
  // the object used to throw "px.copy is not a function" three frames
  // deep; say which argument is wrong, here, where the caller is.
  if (!Buffer.isBuffer(px)) {
    throw new TypeError(
      `cropPixels wants the pixel buffer, got ${px && typeof px === 'object' ? 'the readGeoTiff object — pass its .px' : typeof px}`,
    );
  }
  const out = Buffer.allocUnsafe(win.width * win.height);
  for (let r = 0; r < win.height; r++) {
    px.copy(out, r * win.width, (win.row0 + r) * grid.width + win.col0, (win.row0 + r) * grid.width + win.col0 + win.width);
  }
  return out;
}

export const encode = (buf) => gzipSync(buf, { level: 9 }).toString('base64');
export const decode = (s) => gunzipSync(Buffer.from(s, 'base64'));

/** The class at a coordinate, or null when the point is off the cropped grid. */
export function sampleAt(win, px, lon, lat) {
  const col = Math.floor((lon - win.lon0) / win.pixel);
  const row = Math.floor((win.lat0 - lat) / win.pixel);
  if (col < 0 || col >= win.width || row < 0 || row >= win.height) return null;
  return px[row * win.width + col];
}

/**
 * The study-domain mask: which pixels the CDI algorithm actually answers
 * about.
 *
 * 🔴 WHY THIS EXISTS AT ALL, and it is the heart of the card.
 *
 * The factsheet says the algorithm "assigns each pixel **in the study
 * domain** to one of the seven classes", and class 0 is "Normal
 * conditions (No drought)" — a real answer, not a gap. Outside the study
 * domain the raster carries 0 too, as fill. So a single raster cannot
 * tell "we measured, and this place is fine" from "we do not cover this
 * place", and those two sentences are not interchangeable on a page
 * somebody plans a trip from.
 *
 * `docs/emergency-sources.md` §4 left this open in writing: "value 0 in
 * this raster conflates 'no drought class here' with 'outside the
 * computed domain', and we did not separate them … Not checked".
 *
 * The provider publishes `ne_10m_ocean_mask` in GetCapabilities, which
 * would have answered it exactly. It returns HTTP 400 PRODUCT_NOT_FOUND.
 *
 * So it is measured: a pixel the algorithm has EVER classified as
 * anything but 0, in any dekad of the archive, is inside the domain.
 *
 * 🔴 AND THE MEASUREMENT PROVES ITSELF SATURATED.
 *
 * Too few dekads and a stretch of land that simply never had a dry spell
 * reads as "we do not cover this place" — understating what we know. So
 * `buildMask` does not accept a number of dekads chosen by whoever ran
 * it: it requires that the last `SATURATION_TAIL` dekads added NOTHING.
 * Measured 04.10.2026 over 29 dekads spanning 2012–2026: growth stops
 * dead after the tenth, and the final six added exactly 0 pixels each.
 */
export const SATURATION_TAIL = 5;

export function maskBits(width, height) {
  return Buffer.alloc(Math.ceil((width * height) / 8));
}

export const maskGet = (bits, i) => (bits[i >> 3] >> (i & 7)) & 1;
export const maskSet = (bits, i) => {
  bits[i >> 3] |= 1 << (i & 7);
};

/**
 * Fold one dekad's cropped pixels into the mask. Returns how many pixels
 * this dekad ADDED — the number the saturation rule reads.
 */
export function foldIntoMask(bits, px) {
  let added = 0;
  for (let i = 0; i < px.length; i++) {
    if (px[i] !== 0 && !maskGet(bits, i)) {
      maskSet(bits, i);
      added += 1;
    }
  }
  return added;
}

/**
 * Build the mask, and refuse to return one that has not stopped growing.
 *
 * `rasters` is an iterable of cropped pixel buffers, oldest first.
 */
export function buildMask(rasters, win, tail = SATURATION_TAIL) {
  const bits = maskBits(win.width, win.height);
  const growth = [];
  for (const px of rasters) {
    if (px.length !== win.width * win.height) {
      throw new Error(`a dekad is ${px.length} bytes, expected ${win.width * win.height}`);
    }
    growth.push(foldIntoMask(bits, px));
  }
  if (growth.length <= tail) {
    throw new Error(
      `${growth.length} dekads cannot show saturation: the rule needs more ` +
        `than ${tail}, so that the last ${tail} can be seen to add nothing.`,
    );
  }
  const last = growth.slice(-tail);
  const stillGrowing = last.reduce((a, b) => a + b, 0);
  if (stillGrowing > 0) {
    throw new Error(
      `the domain mask has not saturated: the last ${tail} dekads still added ` +
        `${last.join(', ')} pixels. Feed it more dekads. An unsaturated mask ` +
        'calls dry-but-ordinary land "not covered", which hides a true ' +
        '"no drought" from the reader.',
    );
  }
  return { bits, growth, set: growth.reduce((a, b) => a + b, 0) };
}

/**
 * What the page says about one campsite.
 *
 * 🔴 Three outcomes, and keeping them apart is the whole point:
 *   - off the cropped grid, or outside the study domain → we do not know
 *   - class 0 → measured, and there is no drought here
 *   - class 1..6 → the stage, in our words
 */
export function readingAt(win, px, bits, lon, lat) {
  const col = Math.floor((lon - win.lon0) / win.pixel);
  const row = Math.floor((win.lat0 - lat) / win.pixel);
  if (col < 0 || col >= win.width || row < 0 || row >= win.height) {
    return { known: false, why: 'outside the area this indicator covers' };
  }
  const i = row * win.width + col;
  if (!maskGet(bits, i)) {
    return { known: false, why: 'outside the area this indicator covers' };
  }
  const value = px[i];
  const cls = CLASSES.find((c) => c.value === value);
  if (!cls) return { known: false, why: 'the indicator returned a class we do not know' };
  return { known: true, value, label: cls.label, detail: cls.detail };
}

/**
 * 🔴 Dekads are the 1st, 11th and 21st. Nothing else is one, and a date
 * that is not one would be silently served as its neighbour.
 */
export function isDekad(date) {
  return /^\d{4}-\d{2}-(01|11|21)$/.test(String(date));
}

/**
 * Dekads from across the archive, oldest first, for the mask.
 *
 * 🔴 SPREAD ON PURPOSE, not the most recent N. Drought is regional and
 * seasonal: ten consecutive dekads of one wet autumn would leave half of
 * Europe looking like it is not covered.
 *
 * 🔴 EVERY YEAR GETS EVERY SEASON, and the first draft did not. It gave
 * each year ONE month from a rotating list, so summer — when most of
 * Europe carries a class at all — appeared in a third of the years. The
 * real run refused the result: the last five dekads still added 1 618,
 * 127, 105, 1 077 and 0 pixels. That refusal is the check doing its job,
 * and it is the reason this function is shaped the way it is rather than
 * the way it was.
 *
 * The spread is an argument; `buildMask`'s saturation rule is the proof.
 */
export const MASK_MONTHS = ['02', '05', '08', '11'];

export function maskDekads(firstYear, lastYear) {
  const out = [];
  for (let y = firstYear; y <= lastYear; y++) {
    for (const m of MASK_MONTHS) out.push(`${y}-${m}-11`);
  }
  return out;
}

/**
 * 🔴 A rebuild that is refused must not cost the download again.
 *
 * `buildMask` can reject a whole run on its last dekad, and it should:
 * the alternative is shipping a mask that hides good news. But re-reading
 * sixty 2 MB rasters from a public service to add four more is rude, so
 * a run may keep them. The cache is keyed by dekad and the files are
 * verified by `readGeoTiff` on the way back in, exactly like a fresh one.
 */
async function getCoverage(time, fetchImpl = fetch, cacheDir = null) {
  const cached = cacheDir ? join(cacheDir, `${COVERAGE}-${time}.tif`) : null;
  if (cached) {
    try {
      return cropPixels(readGeoTiff(await readFile(cached)).px, GRID, cropWindow());
    } catch {
      // Unreadable or half-written: fetch it again rather than trust it.
    }
  }
  // 🔴 A rebuild is sixty requests, so a blip is not an exception, it is
  // Tuesday. One dekad came back HTTP 200 with a body that was not a
  // TIFF; the same dekad fetched cleanly a minute later. Without this,
  // the whole rebuild died three frames deep on "not a TIFF" and never
  // said WHICH dekad or what had arrived instead.
  let last = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await fetchImpl(coverageUrl(COVERAGE, time));
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      last = `HTTP ${res.status}: ${buf.toString('utf8', 0, 200)}`;
    } else {
      try {
        const px = cropPixels(readGeoTiff(buf).px, GRID, cropWindow());
        if (cached) await writeFile(cached, buf);
        return px;
      } catch (err) {
        // Say what actually arrived. A JSON error served as HTTP 200
        // reads as gibberish otherwise.
        const head = buf.toString('utf8', 0, 120).replace(/[^\x20-\x7e]/g, '.');
        last = `${err.message} (${buf.length} bytes, starts "${head}")`;
      }
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * RETRY_PAUSE_MS));
  }
  throw new Error(`GetCoverage ${time} failed ${ATTEMPTS} times. Last: ${last}`);
}

export function buildOutput({ dekad, range, win, px, today }) {
  const age = dekadAgeDays(dekad, today);
  const out = {
    meta: {
      source: 'Copernicus Emergency Management Service, European Drought Observatory',
      indicator: 'Combined Drought Indicator (CDI) v4.1.1',
      coverage: COVERAGE,
      dekad,
      dekadAgeDays: age,
      availableRange: range,
      fetchedAt: today.toISOString(),
      attribution: ATTRIBUTION(today.getUTCFullYear()),
      // 🔴 Said here, once, so no page has to decide it for itself: this
      // is a ten-day product and three weeks old is its normal state.
      cadenceNote:
        'The CDI is published once every ten days. A reading two or three weeks ' +
        'old is the newest there is, not a stale one.',
      grid: { width: win.width, height: win.height, lon0: win.lon0, lat0: win.lat0, pixel: win.pixel },
      classes: CLASSES.map(({ value, label, detail }) => ({ value, label, detail })),
    },
    cdi: encode(px),
  };
  checkWording(out);
  return out;
}

export function buildDomainFile({ win, built, dekads, today }) {
  const out = {
    meta: {
      note:
        'Which pixels the indicator answers about at all. Built once from ' +
        'dekads spread across the archive, because the published ocean mask ' +
        'this would have come from is advertised and not served.',
      builtAt: today.toISOString(),
      dekads,
      growth: built.growth,
      inDomain: built.set,
      ofPixels: win.width * win.height,
      grid: { width: win.width, height: win.height, lon0: win.lon0, lat0: win.lat0, pixel: win.pixel },
    },
    domain: encode(built.bits),
  };
  checkWording(out);
  return out;
}

/** Prove the gates bite. Nothing here touches the network. */
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

  // --- the range comes from the error body, and only from there
  ok(
    'parseRange reads the available range out of a DATE_OUT_OF_RANGE body',
    JSON.stringify(
      parseRange('{"code":"DATE_OUT_OF_RANGE","details":{"available_range":"2012-01-01 - 2026-09-11"}}'),
    ) === '{"first":"2012-01-01","last":"2026-09-11"}',
  );
  ok('…and reports nothing rather than a guess when the body is not that', parseRange('<html>') === null);
  ok('…including a body that has a range of the wrong shape', parseRange('{"details":{"available_range":"soon"}}') === null);

  // --- a URL can only be built for a date
  ok('coverageUrl refuses a non-date TIME', threw(() => coverageUrl(COVERAGE, '2026-09'), /non-date TIME/));
  ok('coverageUrl names exactly one coverage', coverageUrl(COVERAGE, '2026-09-11').includes('coverageID=cdiad'));
  ok(
    '…and carries the incantation the service answers to',
    /map=DO_WCS/.test(coverageUrl(COVERAGE, '2026-09-11')) &&
      /VERSION=2\.0\.0/.test(coverageUrl(COVERAGE, '2026-09-11')),
  );

  // --- dekads
  ok('a dekad is the 1st, 11th or 21st', isDekad('2026-09-01') && isDekad('2026-09-11') && isDekad('2026-09-21'));
  ok('…and nothing else is', !isDekad('2026-09-05') && !isDekad('2026-09-30'));
  ok('age is whole days', dekadAgeDays('2026-09-11', new Date('2026-10-04T23:30:00Z')) === 23);
  ok(
    '…and does not move with the hour of the run',
    dekadAgeDays('2026-09-11', new Date('2026-10-04T00:30:00Z')) ===
      dekadAgeDays('2026-09-11', new Date('2026-10-04T23:30:00Z')),
  );

  // --- the grid check
  const tiff = (over = {}) => {
    const g = { width: GRID.width, height: GRID.height, lon0: GRID.lon0, lat0: GRID.lat0, pixel: GRID.pixel, ...over };
    const px = Buffer.alloc(g.width * g.height);
    // One IFD, seven entries, tags ascending, then the two geo arrays,
    // then the pixels. Offsets are computed rather than guessed: an
    // earlier draft laid the geo tags out by hand and fed this check a
    // raster whose origin read (0, 0) — which the check then correctly
    // refused, for the wrong reason.
    const COUNT = 7;
    const ifdAt = 8;
    const ifdLen = 2 + COUNT * 12 + 4;
    const scaleAt = ifdAt + ifdLen;
    const tieAt = scaleAt + 3 * 8;
    const pxAt = tieAt + 6 * 8;

    const entries = [
      [256, 4, 1, g.width],
      [257, 4, 1, g.height],
      [258, 3, 1, 8],
      [273, 4, 1, pxAt],
      [279, 4, 1, px.length],
      [33550, 12, 3, scaleAt],
      [33922, 12, 6, tieAt],
    ];
    const ifd = Buffer.alloc(ifdLen);
    ifd.writeUInt16LE(COUNT, 0);
    entries.forEach(([tag, type, count, value], i) => {
      const o = 2 + i * 12;
      ifd.writeUInt16LE(tag, o);
      ifd.writeUInt16LE(type, o + 2);
      ifd.writeUInt32LE(count, o + 4);
      // 🔴 A SHORT that fits inline lives in the FIRST two bytes of the
      // value field, not the last. Writing it as a UInt32 happens to
      // work little-endian and would not big-endian; written as what it
      // is, so the fixture cannot teach the reader a wrong habit.
      if (type === 3) ifd.writeUInt16LE(value, o + 8);
      else ifd.writeUInt32LE(value, o + 8);
    });

    const scale = Buffer.alloc(3 * 8);
    scale.writeDoubleLE(g.pixel, 0);
    scale.writeDoubleLE(g.pixel, 8);
    const tie = Buffer.alloc(6 * 8);
    tie.writeDoubleLE(g.lon0, 3 * 8);
    tie.writeDoubleLE(g.lat0, 4 * 8);

    const head = Buffer.alloc(8);
    head.write('II', 0, 'ascii');
    head.writeUInt16LE(42, 2);
    head.writeUInt32LE(ifdAt, 4);
    return Buffer.concat([head, ifd, scale, tie, px]);
  };

  ok('readGeoTiff accepts the grid the factsheet describes', readGeoTiff(tiff()).width === GRID.width);
  for (const [what, over] of [
    ['width', { width: GRID.width - 1 }],
    ['height', { height: GRID.height + 1 }],
    ['origin', { lon0: -24 }],
    ['resolution', { pixel: 1 / 12 }],
  ]) {
    ok(`…and refuses a raster whose ${what} moved`, threw(() => readGeoTiff(tiff(over)), /the CDI grid moved/));
  }

  // --- the crop and the sampler agree with each other
  const win = cropWindow();
  ok('the crop sits on whole pixels of the source grid', Number.isInteger(win.col0) && Number.isInteger(win.row0));
  ok(
    '…and its own origin is the source origin plus those pixels',
    Math.abs(win.lon0 - (GRID.lon0 + win.col0 * GRID.pixel)) < 1e-12,
  );
  ok('cropPixels says which argument is wrong', threw(() => cropPixels({ px: Buffer.alloc(1) }, GRID, win), /pass its \.px/));

  // --- the domain mask, which is the card's whole point
  const pxs = (vals) => {
    const b = Buffer.alloc(win.width * win.height);
    for (const [i, v] of vals) b[i] = v;
    return b;
  };
  const quiet = Array.from({ length: SATURATION_TAIL + 1 }, () => pxs([[0, 0]]));
  ok(
    'buildMask refuses a mask that is still growing',
    threw(() => buildMask([pxs([[1, 2]]), ...Array.from({ length: SATURATION_TAIL }, (_x, i) => pxs([[i + 2, 2]]))], win), /has not saturated/),
  );
  ok(
    '…and refuses too few dekads to judge saturation at all',
    threw(() => buildMask([pxs([[1, 2]])], win), /cannot show saturation/),
  );
  const settled = buildMask([pxs([[5, 3]]), ...quiet], win);
  ok('…and accepts one whose tail added nothing', settled.set === 1);

  // --- the three readings, kept apart
  const grid = pxs([[5, 3], [6, 0]]);
  const lonOf = (i) => win.lon0 + (i % win.width) * win.pixel + win.pixel / 2;
  const latOf = (i) => win.lat0 - Math.floor(i / win.width) * win.pixel - win.pixel / 2;
  const inDrought = readingAt(win, grid, settled.bits, lonOf(5), latOf(5));
  ok('a classified pixel reports its stage', inDrought.known && inDrought.value === 3);
  const outside = readingAt(win, grid, settled.bits, lonOf(6), latOf(6));
  ok('🔴 a pixel the indicator never covers says so', !outside.known);
  const settled2 = buildMask([pxs([[5, 3], [6, 1]]), ...quiet], win);
  const noDrought = readingAt(win, grid, settled2.bits, lonOf(6), latOf(6));
  ok(
    '🔴 …while a covered pixel reading 0 says there is NO DROUGHT, not "no data"',
    noDrought.known && noDrought.value === 0 && /no drought/.test(noDrought.label),
    JSON.stringify(noDrought),
  );
  ok('off the cropped grid is not known either', !readingAt(win, grid, settled.bits, 60, 40).known);

  // --- the language gate
  ok('checkWording lets our own labels through', !threw(() => checkWording(CLASSES.map((c) => ({ label: c.label, detail: c.detail }))), /./));
  for (const c of CLASSES) {
    if (!FORBIDDEN_WORDS.test(c.official)) continue;
    ok(
      `🔴 the official name "${c.official}" cannot reach the output`,
      threw(() => checkWording({ label: c.official }), /REFUSING TO WRITE/),
    );
  }
  ok('…and it looks inside arrays and nested objects', threw(() => checkWording({ a: [{ b: 'severe risk' }] }), /output\.a\[0\]\.b/));
  ok('…and the attribution itself is clean', !FORBIDDEN_WORDS.test(ATTRIBUTION(2026)));

  // --- the spread of dekads for the mask
  const ds = maskDekads(2012, 2026);
  ok('mask dekads are all real dekads', ds.every(isDekad));
  ok('…and span every year of the archive', new Set(ds.map((d) => d.slice(0, 4))).size === 15);
  ok('…across more than one season', new Set(ds.map((d) => d.slice(5, 7))).size > 1);

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

if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.exit(selfTest());
  } else {
    const today = new Date();
    const range = await probeRange();
    console.log(`available range (from the out-of-range probe): ${range.first} … ${range.last}`);
    if (!isDekad(range.last)) throw new Error(`the newest date is not a dekad: ${range.last}`);
    console.log(`newest dekad ${range.last} is ${dekadAgeDays(range.last, today)} days old`);
    if (args.includes('--probe')) process.exit(0);

    const win = cropWindow();
    const px = await getCoverage(range.last);
    const out = buildOutput({ dekad: range.last, range, win, px, today });
    console.log(`cdi grid ${win.width}x${win.height}, ${out.cdi.length} bytes encoded`);

    if (args.includes('--rebuild-mask')) {
      const dekads = maskDekads(Number(range.first.slice(0, 4)), Number(range.last.slice(0, 4)))
        .filter((d) => d <= range.last);
      const cacheArg = args.find((a) => a.startsWith('--cache='));
      const cacheDir = cacheArg ? cacheArg.slice('--cache='.length) : null;
      if (cacheDir) await mkdir(cacheDir, { recursive: true });
      const rasters = [];
      for (const d of dekads) {
        rasters.push(await getCoverage(d, fetch, cacheDir));
        console.log(`mask: ${rasters.length}/${dekads.length} dekads (${d})`);
      }
      const built = buildMask(rasters, win);
      console.log(`domain: ${built.set} pixels; last dekads added ${built.growth.slice(-SATURATION_TAIL).join(', ')}`);
      const domainFile = buildDomainFile({ win, built, dekads, today });
      if (!args.includes('--dry-run')) {
        await writeFile(join(dirname(OUT), 'drought-domain.json'), `${JSON.stringify(domainFile)}\n`, 'utf8');
        console.log('wrote drought-domain.json');
      }
    }

    if (args.includes('--dry-run')) {
      console.log('--dry-run: nothing written');
    } else {
      await writeFile(OUT, `${JSON.stringify(out)}\n`, 'utf8');
      console.log(`wrote ${OUT}`);
    }
  }
}
