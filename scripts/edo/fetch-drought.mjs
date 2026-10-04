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

import { readFile, writeFile } from 'node:fs/promises';
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
