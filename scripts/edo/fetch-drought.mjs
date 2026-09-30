#!/usr/bin/env node
// CAMP-163: the Copernicus EDO Combined Drought Indicator, one dekad, as a
// grid the page can sample at a campsite.
//
//   node scripts/edo/fetch-drought.mjs             # fetch and write
//   node scripts/edo/fetch-drought.mjs --dry-run   # fetch, summarise, write nothing
//   node scripts/edo/fetch-drought.mjs --self-test # no network at all
//
// 🔴 WHY THIS EXISTS, AND WHY IT IS THE EASY ONE.
//
// Drought is the one hazard on docs/emergency-sources.md whose slowness
// forgives us. The CDI is published per DEKAD — a ten-day period — and its
// newest period is weeks old when the service is perfectly healthy. So the
// layer can be honest without pretending to be live: it names the period
// out loud and never implies a currency it does not have.
//
// 🔴 WHAT IT IS NOT.
//
// Under the CEMS terms this data "does not constitute in any way an early
// warning for which only national/regional institutions are authorized".
// We mirror what Copernicus recorded, dated, with the credit the terms
// dictate. Nothing this script writes may say more (`checkMetaWording`).
//
// 🔴 THE DOCUMENTATION OF THIS SOURCE IS WRONG, AND THIS FILE IS WRITTEN
// AS IF IT WERE. Measured 28–29.09.2026 (docs/emergency-sources.md §4):
//
//  1. GetCapabilities advertises `2012-01-01/2026-06-11/P10D` for `cdiad`.
//     The service serves 2026-09-11 (and answered 2026-09-01 the day
//     before), and says so — in the ERROR it returns for a date it does
//     not have. So the range is read from a DELIBERATE out-of-range
//     request (`probeRange`) on every run, and GetCapabilities is never
//     requested at all: nothing here can be lied to by it.
//  2. `smand` and `cdinx` are advertised as current and stop in 2024
//     (`available_range` ends 2024-07-01 and 2024-01-01). They are
//     excluded BY NAME — `wcsUrl` cannot build a request for them — and,
//     independently, a run whose newest period is older than the budget
//     refuses to write, so a future stale layer that is NOT on the list
//     is stopped by its age.
//  3. The Low-Flow Index (`lfinx_300_*`) is advertised and returns a
//     fully transparent PNG for every date. Excluded by name.
//  4. Seven layers declare `queryable="1"` and answer GetFeatureInfo with
//     HTTP 400 `Invalid request type`. Nothing here asks: the value at a
//     campsite is read from the raster we fetch, by us.
//
// And two things nobody documents, found while writing the reader:
//
//  5. The GeoTIFF's strips are NOT stored in row order. For 2026-09-11 the
//     first five strips (rows 0–19) sit at the END of the file. A reader
//     that assumes strips follow each other from the first offset rotates
//     the map by 20 rows — about 92 km — and every campsite in Europe gets
//     the wrong value with nothing to say so. `readGeoTiff` follows
//     StripOffsets one strip at a time.
//  6. The file for 2026-09-11 carries NO GeoKeyDirectory — no CRS at all —
//     where the file for 2026-09-01 carried EPSG:4326. So the grid is
//     never taken from the file's own declaration of its projection: the
//     tie point and pixel scale are read and then CHECKED against the grid
//     we sample with (`assertCdiGrid`), and a moved grid is refused.
//
// 🔴 THE OUTPUT IS COMMITTED, AND THAT IS DELIBERATE — the same reasoning
// as scripts/effis/fetch-wildfires.mjs: a build that scraped Copernicus
// would answer 0 on the day the service changed. This runs by hand, writes
// a file, and a human reads the diff. The page reads the dekad out of the
// file and says "no fresh data" once it is more than FRESH_FOR_DAYS old.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
// One list of reserved words for every script. `scripts/effis` cannot
// import TypeScript, so its literal is one of the three that
// `apps/web/tests/unit/cems-panels.spec.ts` asserts equal; re-using that
// binding here means this script cannot hold a fourth that drifts.
import { FORBIDDEN_WORDS } from '../effis/fetch-wildfires.mjs';

export { FORBIDDEN_WORDS };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'apps', 'web', 'src', 'data', 'drought.json');

export const EDO_HOME = 'https://drought.emergency.copernicus.eu/';
export const WCS = 'https://drought.emergency.copernicus.eu/api/wcs';
export const CEMS_TERMS = 'https://drought.emergency.copernicus.eu/terms&conditions';

/** The one coverage this script reads: Combined Drought Indicator v4.1. */
export const COVERAGE = 'cdiad';
export const PRODUCT = 'Combined Drought Indicator (CDI) v4.1';

/**
 * 🔴 Layers this service ADVERTISES and this script will not touch, each
 * with the measurement that put it here. Named, not derived: "everything
 * the service lists" is the rule that would have put 2024 on a 2026 page.
 */
export const EXCLUDED_LAYERS = {
  smand: 'stops 2024-07-01 while still advertised (measured 28.09.2026)',
  cdinx: 'stops 2024-01-01 while still advertised (measured 28.09.2026)',
  lfinx_300_sms: 'Low-Flow Index: advertised, returns a transparent PNG for every date',
  lfinx_300_mds: 'Low-Flow Index: advertised, returns a transparent PNG for every date',
  lfinx_300_lgs: 'Low-Flow Index: advertised, returns a transparent PNG for every date',
};

/**
 * The date used to ask the service what it holds. Nothing has data in
 * 2099, so the service answers with the range it really serves.
 */
export const PROBE_TIME = '2099-01-01';

/**
 * How old, in whole days from the FIRST day of its dekad, the newest
 * period may be before the page says "no fresh data".
 *
 * docs/emergency-sources.md §12: healthy is "up to 30 days" and "more than
 * ~40 days and a dekad was skipped". Measured: on 28.09.2026 the newest
 * period began 27 days earlier and the service was working. The page
 * carries its own copy, and `drought.spec.ts` asserts the two are equal.
 */
export const FRESH_FOR_DAYS = 40;

/**
 * The grid every CDI GeoTIFF from this coverage is on. Measured with GDAL
 * 29.09.2026 on both 2026-09-01 and 2026-09-11: 1 824 × 1 200 cells,
 * upper-left corner (−25, 72), cell 1/24° — about 4.6 km north to south.
 */
export const GRID = { west: -25, north: 72, cellsPerDegree: 24, width: 1824, height: 1200 };

/**
 * What a cell may hold. 0 is "no class here" (which the raster does NOT
 * separate from "outside the area Copernicus computes"), 1–3 are the three
 * primary drought classes and 4–6 the three recovery classes.
 *
 * Established by comparing the raster with the service's own rendering on
 * 2026-09-11: `cdiad` paints exactly values 1–3 (yellow, orange, red) and
 * leaves 4–6 transparent, `cdirc` paints 0 white and 4–6 in three other
 * colours — 60 621 of 61 462 value-1 cells were yellow, 193 795 of 195 222
 * value-2 cells orange, 36 541 of 36 844 value-3 cells red. Anything
 * above 6 is a value nobody has told us the meaning of.
 */
export const MAX_KNOWN_VALUE = 6;
/** Stored for a cell holding a value we do not know. It costs that cell. */
export const UNRECOGNISED = 9;

/**
 * A run in which more than this share of the cells is unrecognised is not
 * a few odd cells, it is a changed format: refuse it. One in a thousand is
 * far above anything measured (0 of 2 188 800 on both dekads read).
 */
export const UNRECOGNISED_CEILING = 0.001;

/**
 * The words that must still be in the CEMS terms. Read 29.09.2026, all
 * present in the served HTML (18 978 bytes). Short on purpose: the served
 * page wraps lines, and "the European and Global Drought Observatories
 * (CEMS EDO and GDO)" is split across one, so the longer string is absent
 * from the bytes — the trap scripts/effis/fetch-wildfires.mjs records.
 */
export const CEMS_MARKERS = [
  '(CEMS EDO and GDO)',
  'does not constitute in any way an early warning for which only national/regional institutions',
  'Contains modified Copernicus Emergency Management Service information',
];

/** Whose job an official notice is — our words, their authority, none of the reserved ones. */
export const AUTHORITY_NOTE =
  'Copernicus publishes this for information only. Only national and regional services are authorised to issue official notices for their own area.';

/**
 * The credit the CEMS terms dictate for data that has been changed, with
 * the year of the DATA. Ours is changed — decoded, re-encoded, sampled and
 * recoloured — so this is the "Contains modified" notice, not "Generated
 * using".
 */
export const attributionFor = (year) => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(
      `the CEMS notice needs a real year, got ${JSON.stringify(year)} — ` +
        'the terms name it "[Year]" and a credit with the wrong one is not the credit they asked for',
    );
  }
  return (
    `Contains modified Copernicus Emergency Management Service information ${year} ` +
    '— Copernicus EDO/GDO, © European Union'
  );
};

// ---------------------------------------------------------------------
// Dekads
// ---------------------------------------------------------------------

/** 'YYYY-MM-DD' → that day at 00:00 UTC in ms, or null when it is not a real date. */
export function dayMs(label) {
  if (typeof label !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!m) return null;
  const ms = Date.parse(`${label}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  // '2026-02-31' parses in some engines and is not a day.
  return new Date(ms).toISOString().slice(0, 10) === label ? ms : null;
}

/**
 * A dekad is named by its first day: the 1st, the 11th or the 21st.
 * Anything else is not a period we can describe truthfully, whatever the
 * service says: "P10D from 2012-01-01" in GetCapabilities would drift off
 * these dates within a month, and it is one more thing in that document
 * that is not what the service does.
 */
export function isDekadStart(label) {
  return dayMs(label) !== null && ['01', '11', '21'].includes(label.slice(8, 10));
}

/** Whole days from the first day of the dekad to `now`. Negative when it is ahead. */
export function ageInDays(label, now) {
  const start = dayMs(label);
  if (start === null) throw new Error(`not a date: ${JSON.stringify(label)}`);
  return Math.floor((now.getTime() - start) / 86_400_000);
}

// ---------------------------------------------------------------------
// The request builder — where the exclusions live
// ---------------------------------------------------------------------

/**
 * 🔴 The only place a WCS URL is made, and it refuses the layers this
 * service advertises falsely.
 *
 * A rule kept by remembering it survives until the first hurried edit, so
 * it is a throw: no request can be built for `smand`, `cdinx` or the
 * Low-Flow Index, and none for a coverage that is not the one we read.
 * The parameters are the documented incantation and only it — measured
 * 28.09.2026: `VERSION=2.0.1` errors, and `VERSION=2.0.0` without
 * `map=DO_WCS` answers HTTP 502.
 */
export function wcsUrl({ coverage = COVERAGE, time }) {
  if (Object.hasOwn(EXCLUDED_LAYERS, coverage)) {
    throw new Error(
      `REFUSING TO BUILD A REQUEST FOR "${coverage}": ${EXCLUDED_LAYERS[coverage]}. ` +
        'This service advertises layers it does not serve; see docs/emergency-sources.md §4.',
    );
  }
  if (coverage !== COVERAGE) {
    throw new Error(
      `REFUSING TO BUILD A REQUEST FOR "${coverage}": the only coverage this script reads is ` +
        `"${COVERAGE}". A layer is added by measuring it, not by finding it in a list.`,
    );
  }
  if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(time)) {
    throw new Error(`TIME must be a bare YYYY-MM-DD date, got ${JSON.stringify(time)}`);
  }
  const u = new URL(WCS);
  u.searchParams.set('map', 'DO_WCS');
  u.searchParams.set('SERVICE', 'WCS');
  u.searchParams.set('VERSION', '2.0.0');
  u.searchParams.set('REQUEST', 'GetCoverage');
  u.searchParams.set('coverageID', coverage);
  u.searchParams.set('CRS', 'EPSG:4326');
  u.searchParams.set('format', 'GEOTIFF');
  u.searchParams.set('TIME', time);
  return u.toString();
}

// ---------------------------------------------------------------------
// The range — asked for, never read from the documentation
// ---------------------------------------------------------------------

/**
 * The range out of the error body a date-out-of-range request returns:
 * `{"code":"DATE_OUT_OF_RANGE", … "available_range":"2012-01-01 - 2026-09-11"}`.
 * Anything else — a different code, a different shape, a range whose end is
 * not a date — is an error and not a guess.
 */
export function parseAvailableRange(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`the range probe did not answer in JSON: ${String(body).slice(0, 200)}`);
  }
  if (parsed?.code !== 'DATE_OUT_OF_RANGE') {
    throw new Error(
      `the range probe was not answered with DATE_OUT_OF_RANGE (got ${JSON.stringify(parsed?.code)}), ` +
        'so the service no longer states its range this way',
    );
  }
  const raw = parsed?.details?.available_range;
  const m = typeof raw === 'string' ? /^(\d{4}-\d{2}-\d{2}) - (\d{4}-\d{2}-\d{2})$/.exec(raw) : null;
  if (!m || dayMs(m[1]) === null || dayMs(m[2]) === null) {
    throw new Error(`the range probe carried no readable available_range: ${JSON.stringify(raw)}`);
  }
  if (dayMs(m[1]) > dayMs(m[2])) {
    throw new Error(`the range runs backwards: ${JSON.stringify(raw)}`);
  }
  return { first: m[1], newest: m[2] };
}

/**
 * Ask the service what it holds, by asking for 2099.
 *
 * 🔴 A probe that gets DATA back has not measured the range: it has found
 * a service that serves a date in 2099, and everything downstream assumed
 * that could not happen.
 */
export async function probeRange(io, coverage = COVERAGE) {
  const url = wcsUrl({ coverage, time: PROBE_TIME });
  const res = await io.get(url);
  if (res.status === 200) {
    throw new Error(
      `the range probe for ${PROBE_TIME} returned HTTP 200 and ${res.bytes.length} bytes — ` +
        'the service answered a date it cannot have, so its range cannot be read this way',
    );
  }
  const answer = parseAvailableRange(new TextDecoder().decode(res.bytes));
  return { requested: PROBE_TIME, ...answer };
}

// ---------------------------------------------------------------------
// The GeoTIFF — read by us, strip by strip
// ---------------------------------------------------------------------

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8 };
const T = {
  width: 256, height: 257, bits: 258, compression: 259, photometric: 262,
  stripOffsets: 273, samples: 277, rowsPerStrip: 278, stripByteCounts: 279,
  planar: 284, tileWidth: 322, sampleFormat: 339,
  pixelScale: 33550, tiePoint: 33922, geoKeys: 34735,
};

/**
 * A single-band 8-bit GeoTIFF, decoded — and nothing else.
 *
 * 🔴 It refuses what it does not fully understand instead of guessing:
 * compression, tiling, more than one band, a sample that is not an
 * unsigned byte, BigTIFF. A reader that "mostly works" on a format the
 * service changes tomorrow would put a confident, wrong value on every
 * campsite in Europe.
 *
 * 🔴 And it follows `StripOffsets`. The files this service returns store
 * their strips out of row order (see the header, point 5).
 */
export function readGeoTiff(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < 16) throw new Error(`not a TIFF: ${buf.length} bytes`);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const order = String.fromCharCode(buf[0], buf[1]);
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF: no byte-order mark');
  const le = order === 'II';
  const magic = view.getUint16(2, le);
  if (magic === 43) throw new Error('BigTIFF is not supported');
  if (magic !== 42) throw new Error(`not a TIFF: magic ${magic}`);

  const ifd = view.getUint32(4, le);
  if (ifd < 8 || ifd + 2 > buf.length) throw new Error('the first IFD lies outside the file');
  const entries = view.getUint16(ifd, le);
  if (ifd + 2 + entries * 12 > buf.length) throw new Error('the IFD runs past the end of the file');

  const tags = new Map();
  for (let i = 0; i < entries; i++) {
    const at = ifd + 2 + i * 12;
    const tag = view.getUint16(at, le);
    const type = view.getUint16(at + 2, le);
    const count = view.getUint32(at + 4, le);
    const size = TYPE_SIZE[type];
    if (size === undefined) continue; // a type we never read; its tag is not one we need
    const bytes = size * count;
    const start = bytes <= 4 ? at + 8 : view.getUint32(at + 8, le);
    if (start + bytes > buf.length) throw new Error(`tag ${tag} points outside the file`);
    const values = [];
    for (let k = 0; k < count; k++) {
      const p = start + k * size;
      if (type === 3) values.push(view.getUint16(p, le));
      else if (type === 4) values.push(view.getUint32(p, le));
      else if (type === 12) values.push(view.getFloat64(p, le));
      else if (type === 1 || type === 2) values.push(buf[p]);
      else values.push(NaN); // RATIONAL: present, unused
    }
    tags.set(tag, values);
  }

  const one = (tag, name, fallback) => {
    const v = tags.get(tag);
    if (v === undefined) {
      if (fallback !== undefined) return fallback;
      throw new Error(`the GeoTIFF has no ${name}`);
    }
    return v[0];
  };

  const width = one(T.width, 'ImageWidth');
  const height = one(T.height, 'ImageLength');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`unusable size ${width} × ${height}`);
  }
  if (width * height > 50_000_000) throw new Error(`refusing a ${width} × ${height} raster`);
  if (one(T.bits, 'BitsPerSample') !== 8) throw new Error('only 8 bits per sample is understood');
  if (one(T.samples, 'SamplesPerPixel', 1) !== 1) throw new Error('only one band is understood');
  if (one(T.compression, 'Compression', 1) !== 1) {
    throw new Error('only uncompressed rasters are understood; the service returned a compressed one');
  }
  if (one(T.planar, 'PlanarConfiguration', 1) !== 1) throw new Error('only contiguous samples are understood');
  if (one(T.sampleFormat, 'SampleFormat', 1) !== 1) throw new Error('only unsigned integer samples are understood');
  if (tags.has(T.tileWidth)) throw new Error('tiled rasters are not understood');

  const offsets = tags.get(T.stripOffsets);
  const counts = tags.get(T.stripByteCounts);
  const rowsPerStrip = Math.min(one(T.rowsPerStrip, 'RowsPerStrip', height), height);
  if (!offsets || !counts || offsets.length !== counts.length) {
    throw new Error('the strip tables are missing or disagree');
  }
  if (!Number.isInteger(rowsPerStrip) || rowsPerStrip <= 0) throw new Error('unusable RowsPerStrip');
  const strips = Math.ceil(height / rowsPerStrip);
  if (offsets.length !== strips) {
    throw new Error(`expected ${strips} strips for ${height} rows of ${rowsPerStrip}, the file lists ${offsets.length}`);
  }

  const pixels = new Uint8Array(width * height);
  for (let s = 0; s < strips; s++) {
    const firstRow = s * rowsPerStrip;
    const rows = Math.min(rowsPerStrip, height - firstRow);
    const want = rows * width;
    if (counts[s] !== want) throw new Error(`strip ${s} holds ${counts[s]} bytes, ${want} expected`);
    if (offsets[s] + want > buf.length) throw new Error(`strip ${s} lies outside the file`);
    pixels.set(buf.subarray(offsets[s], offsets[s] + want), firstRow * width);
  }

  const scale = tags.get(T.pixelScale);
  const tie = tags.get(T.tiePoint);
  if (!scale || scale.length < 2 || !tie || tie.length < 6) {
    throw new Error('the GeoTIFF carries no ModelPixelScale / ModelTiepoint, so it cannot be placed');
  }
  const [sx, sy] = scale;
  const [i, j, , x, y] = tie;
  return {
    width,
    height,
    pixels,
    pixelSize: { x: sx, y: sy },
    origin: { x: x - i * sx, y: y + j * sy },
    // Reported, and deliberately not relied on: the file for 2026-09-11 has none.
    hasGeoKeys: tags.has(T.geoKeys),
  };
}

/**
 * The raster is on the grid the page samples with, or the run stops.
 *
 * 🔴 The file's own CRS is not consulted — see the header, point 6. What
 * is compared is geometry: size, upper-left corner and cell size, to a
 * tolerance far tighter than a cell. A service that quietly moved or
 * re-cut the grid would otherwise give every campsite the value of a
 * different place.
 */
export function assertCdiGrid(tiff, grid = GRID) {
  const cell = 1 / grid.cellsPerDegree;
  const problems = [];
  if (tiff.width !== grid.width || tiff.height !== grid.height) {
    problems.push(`size ${tiff.width} × ${tiff.height}, expected ${grid.width} × ${grid.height}`);
  }
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  if (!near(tiff.origin.x, grid.west) || !near(tiff.origin.y, grid.north)) {
    problems.push(`upper-left corner (${tiff.origin.x}, ${tiff.origin.y}), expected (${grid.west}, ${grid.north})`);
  }
  if (!near(tiff.pixelSize.x, cell) || !near(tiff.pixelSize.y, cell)) {
    problems.push(`cell ${tiff.pixelSize.x} × ${tiff.pixelSize.y}, expected ${cell}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `REFUSING TO SAMPLE: the raster is not on the grid the page uses — ${problems.join('; ')}. ` +
        'Every campsite would be given the value of a different place.',
    );
  }
  return tiff;
}

// ---------------------------------------------------------------------
// Encoding — one row at a time, so one bad row costs one row
// ---------------------------------------------------------------------

/**
 * The raster as one string per row: `"0:39,1:2,0:1783"` is 39 cells of 0,
 * 2 of 1 and 1 783 of 0. A cell holding a value above `MAX_KNOWN_VALUE`
 * is stored as `UNRECOGNISED` and counted.
 *
 * 🔴 Per row, not per raster, for the rule this project keeps: a corrupted
 * record costs one record. One damaged row in a single run-length string
 * would misalign every cell after it; here it costs that row, and the page
 * reads the rest.
 */
export function encodeRows(pixels, width, height) {
  if (pixels.length !== width * height) {
    throw new Error(`${pixels.length} cells for a ${width} × ${height} raster`);
  }
  const rows = [];
  const byValue = {};
  let unrecognised = 0;
  for (let r = 0; r < height; r++) {
    const runs = [];
    let current = -1;
    let length = 0;
    for (let c = 0; c < width; c++) {
      let v = pixels[r * width + c];
      if (v > MAX_KNOWN_VALUE) {
        v = UNRECOGNISED;
        unrecognised++;
      } else {
        byValue[v] = (byValue[v] ?? 0) + 1;
      }
      if (v === current) {
        length++;
      } else {
        if (length > 0) runs.push(`${current}:${length}`);
        current = v;
        length = 1;
      }
    }
    runs.push(`${current}:${length}`);
    rows.push(runs.join(','));
  }
  return { rows, byValue, unrecognised };
}

/** The refusal to write a format change as if it were a few odd cells. */
export function requireFewUnrecognised(unrecognised, total, ceiling = UNRECOGNISED_CEILING) {
  if (unrecognised / total > ceiling) {
    throw new Error(
      `${unrecognised} of ${total} cells hold a value above ${MAX_KNOWN_VALUE}, more than ` +
        `${(ceiling * 100).toFixed(1)}% — that is a changed format, not a few odd cells. ` +
        'Read the legend again before publishing anything derived from this raster.',
    );
  }
}

// ---------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------

/**
 * 🔴 The only place this script touches the network, as one object, so
 * `--self-test` can run the REAL `collect()` against a world it controls
 * and every guard inside it is watched failing rather than trusted (the
 * lesson scripts/effis/fetch-wildfires.mjs records).
 */
export const REAL_IO = {
  /** One GET: status, and the body as bytes. Never throws on a non-2xx. */
  async get(url) {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
  },
};

/** Throws `messageFor(marker)` for the first marker `body` does not carry. */
export function requireMarkers(body, markers, messageFor) {
  for (const marker of markers) {
    if (!body.includes(marker)) throw new Error(messageFor(marker));
  }
}

/**
 * 🔴 Refuse to WRITE a word the licence reserves for national services.
 * Exported so the unit suite drives it without two live requests.
 */
export function checkMetaWording(meta) {
  const walk = (value, path) => {
    if (typeof value === 'string') {
      if (FORBIDDEN_WORDS.test(value)) {
        throw new Error(
          `REFUSING TO WRITE: ${path} uses a word the CEMS terms reserve for national services — ` +
            `${JSON.stringify(value)}. The data "does not constitute in any way an early warning"; ` +
            'say what Copernicus recorded instead.',
        );
      }
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    }
  };
  walk(meta, 'meta');
  return meta;
}

export async function collect({ now = new Date(), io = REAL_IO, authorityNote = AUTHORITY_NOTE } = {}) {
  // 🔴 The terms, every run. They decide both what we may call this data
  // and how we must credit it; a run that did not read them would keep
  // publishing a credit the terms had changed.
  const termsRes = await io.get(CEMS_TERMS);
  if (termsRes.status !== 200) throw new Error(`the CEMS terms answered HTTP ${termsRes.status}`);
  requireMarkers(
    new TextDecoder().decode(termsRes.bytes),
    CEMS_MARKERS,
    (marker) =>
      `REFUSING TO CONTINUE: the CEMS terms no longer contain ${JSON.stringify(marker)}. ` +
      `Read ${CEMS_TERMS} before publishing: this page decides both our wording and our credit.`,
  );

  // 🔴 The range comes from the service's own error, not from
  // GetCapabilities — which is never requested.
  const range = await probeRange(io);
  if (!isDekadStart(range.newest)) {
    throw new Error(
      `the newest period the service names is ${range.newest}, which is not the 1st, 11th or 21st — ` +
        'we cannot describe it as a ten-day period',
    );
  }
  const age = ageInDays(range.newest, now);
  if (age > FRESH_FOR_DAYS || age < 0) {
    throw new Error(
      `REFUSING TO WRITE: the newest period the service holds began ${range.newest}, ${age} days ` +
        `from now — past the ${FRESH_FOR_DAYS}-day budget. This is what smand and cdinx look like ` +
        'while still advertised; writing it would put an old period on the page as the current one.',
    );
  }

  const res = await io.get(wcsUrl({ coverage: COVERAGE, time: range.newest }));
  if (res.status !== 200) {
    throw new Error(
      `the service advertises ${range.newest} as its newest period and answered HTTP ${res.status} for it: ` +
        new TextDecoder().decode(res.bytes.subarray(0, 300)),
    );
  }
  const tiff = assertCdiGrid(readGeoTiff(res.bytes));
  const { rows, byValue, unrecognised } = encodeRows(tiff.pixels, tiff.width, tiff.height);
  requireFewUnrecognised(unrecognised, tiff.pixels.length);

  const year = Number(range.newest.slice(0, 4));
  const meta = {
    // 🔴 OUR clock. The page's freshness budget reads the DEKAD, and this
    // is shown beside it as "read from Copernicus on …".
    fetchedAt: now.toISOString(),
    source: 'Copernicus European Drought Observatory (EDO)',
    sourceUrl: EDO_HOME,
    termsUrl: CEMS_TERMS,
    attribution: attributionFor(year),
    authorityNote,
    product: PRODUCT,
    coverage: COVERAGE,
    /** First day of the ten-day period this raster describes. */
    dekad: range.newest,
    /** Where the date came from: the service's answer to a date it does not have. */
    range: { probedWith: range.requested, first: range.first, newest: range.newest },
    /** What we read, per value; 0 is the value the raster does not explain. */
    byValue,
    unrecognised,
  };
  checkMetaWording(meta);

  return {
    meta,
    grid: {
      west: GRID.west,
      north: GRID.north,
      cellsPerDegree: GRID.cellsPerDegree,
      width: GRID.width,
      height: GRID.height,
      rows,
    },
  };
}

// ---------------------------------------------------------------------
// Self-test: every rule above, on fixtures, with no network
// ---------------------------------------------------------------------

/**
 * A GeoTIFF, written by hand, for the self-test and the unit suite.
 *
 * 🔴 It is a check on the READER, so it deliberately writes what the
 * service writes and a naïve reader gets wrong: strips out of row order
 * (`stripOrder`) and no GeoKeyDirectory. The real-file check is in
 * `tests/unit/drought-fetch.spec.ts`, against a crop written by a
 * different program and read back by GDAL.
 */
export function buildTiff({
  width,
  height,
  pixels,
  rowsPerStrip = 4,
  stripOrder,
  origin = { x: GRID.west, y: GRID.north },
  cell = 1 / GRID.cellsPerDegree,
  bigEndian = false,
  compression = 1,
  bits = 8,
  geoKeys = false,
  drop = [],
}) {
  const le = !bigEndian;
  const strips = Math.ceil(height / rowsPerStrip);
  const order = stripOrder ?? Array.from({ length: strips }, (_, s) => s);
  const entries = [];
  const add = (tag, type, values) => entries.push({ tag, type, values });
  add(256, 4, [width]);
  add(257, 4, [height]);
  add(258, 3, [bits]);
  add(259, 3, [compression]);
  add(262, 3, [1]);
  add(273, 4, new Array(strips).fill(0)); // patched below
  add(277, 3, [1]);
  add(278, 4, [rowsPerStrip]);
  add(279, 4, Array.from({ length: strips }, (_, s) => Math.min(rowsPerStrip, height - s * rowsPerStrip) * width));
  add(284, 3, [1]);
  add(339, 3, [1]);
  add(33550, 12, [cell, cell, 0]);
  add(33922, 12, [0, 0, 0, origin.x, origin.y, 0]);
  if (geoKeys) add(34735, 3, [1, 1, 0, 1, 2048, 0, 1, 4326]);
  const kept = entries.filter((e) => !drop.includes(e.tag)).sort((a, b) => a.tag - b.tag);

  const sizeOf = { 3: 2, 4: 4, 12: 8 };
  const ifdSize = 2 + kept.length * 12 + 4;
  let cursor = 8 + ifdSize;
  const placed = new Map();
  for (const e of kept) {
    const bytes = sizeOf[e.type] * e.values.length;
    if (bytes > 4) {
      placed.set(e, cursor);
      cursor += bytes + (bytes % 2);
    }
  }
  const dataStart = cursor;
  const stripAt = new Array(strips);
  let at = dataStart;
  for (const s of order) {
    stripAt[s] = at;
    at += Math.min(rowsPerStrip, height - s * rowsPerStrip) * width;
  }
  const offsetsEntry = kept.find((e) => e.tag === 273);
  if (offsetsEntry) offsetsEntry.values = stripAt;

  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  out[0] = out[1] = le ? 0x49 : 0x4d;
  view.setUint16(2, 42, le);
  view.setUint32(4, 8, le);
  view.setUint16(8, kept.length, le);
  const write = (p, type, v) => {
    if (type === 3) view.setUint16(p, v, le);
    else if (type === 4) view.setUint32(p, v, le);
    else view.setFloat64(p, v, le);
  };
  kept.forEach((e, i) => {
    const p = 10 + i * 12;
    view.setUint16(p, e.tag, le);
    view.setUint16(p + 2, e.type, le);
    view.setUint32(p + 4, e.values.length, le);
    const bytes = sizeOf[e.type] * e.values.length;
    const where = bytes > 4 ? placed.get(e) : p + 8;
    if (bytes > 4) view.setUint32(p + 8, where, le);
    e.values.forEach((v, k) => write(where + k * sizeOf[e.type], e.type, v));
  });
  for (let s = 0; s < strips; s++) {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
    out.set(pixels.subarray(s * rowsPerStrip * width, s * rowsPerStrip * width + rows * width), stripAt[s]);
  }
  return out;
}

async function selfTest() {
  const checks = [];
  const ok = (name, cond, detail = '') => checks.push({ name, pass: Boolean(cond), detail: String(detail) });
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  // — the layers this service advertises falsely ————————————————————
  for (const layer of Object.keys(EXCLUDED_LAYERS)) {
    ok(`🔴 no request can be built for ${layer}`, throws(() => wcsUrl({ coverage: layer, time: '2026-09-11' })));
  }
  ok('nor for a coverage nobody measured', throws(() => wcsUrl({ coverage: 'spaST', time: '2026-09-11' })));
  ok('the coverage we read builds, with the documented parameters',
    (() => {
      const u = wcsUrl({ time: '2026-09-11' });
      return ['map=DO_WCS', 'VERSION=2.0.0', 'coverageID=cdiad', 'CRS=EPSG%3A4326', 'TIME=2026-09-11'].every((s) => u.includes(s));
    })());
  ok('a TIME that is not a bare date is refused', throws(() => wcsUrl({ time: '2026-09-11T00:00:00Z' })));

  // — dekads ——————————————————————————————————————————————————————————
  ok('the 1st, 11th and 21st are dekads', ['2026-09-01', '2026-09-11', '2026-09-21'].every(isDekadStart));
  ok('any other day is not', ['2026-09-02', '2026-09-10', '2026-09-31', 'nonsense', null].every((d) => !isDekadStart(d)));
  ok('27 days after the dekad began is 27', ageInDays('2026-09-01', new Date('2026-09-28T12:00:00Z')) === 27);

  // — the range ———————————————————————————————————————————————————————
  const outOfRange = (range) =>
    JSON.stringify({ message: 'x', code: 'DATE_OUT_OF_RANGE', details: { available_range: range } });
  ok('the range is read from the service’s error',
    parseAvailableRange(outOfRange('2012-01-01 - 2026-09-11')).newest === '2026-09-11');
  ok('a different error code is not a range', throws(() => parseAvailableRange(JSON.stringify({ code: 'PRODUCT_NOT_FOUND' }))));
  ok('a range with no end is refused', throws(() => parseAvailableRange(outOfRange('2012-01-01'))));
  ok('a backwards range is refused', throws(() => parseAvailableRange(outOfRange('2026-09-11 - 2012-01-01'))));
  ok('HTML is refused', throws(() => parseAvailableRange('<html>502</html>')));

  // — the reader ——————————————————————————————————————————————————————
  const w = 8;
  const h = 10;
  const px = Uint8Array.from({ length: w * h }, (_, i) => i % 7);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const cropGrid = { west: 0, north: 0, cellsPerDegree: 24, width: w, height: h };
  ok('an ordinary GeoTIFF reads back cell for cell', same(readGeoTiff(buildTiff({ width: w, height: h, pixels: px })).pixels, px));
  ok('🔴 strips out of row order are put back in row order',
    same(readGeoTiff(buildTiff({ width: w, height: h, pixels: px, stripOrder: [2, 0, 1] })).pixels, px));
  ok('big-endian reads too', same(readGeoTiff(buildTiff({ width: w, height: h, pixels: px, bigEndian: true })).pixels, px));
  ok('🔴 a file with no GeoKeyDirectory is read, not refused',
    readGeoTiff(buildTiff({ width: w, height: h, pixels: px })).hasGeoKeys === false);
  ok('a compressed raster is refused', throws(() => readGeoTiff(buildTiff({ width: w, height: h, pixels: px, compression: 5 }))));
  ok('a 16-bit raster is refused', throws(() => readGeoTiff(buildTiff({ width: w, height: h, pixels: px, bits: 16 }))));
  ok('a raster with no tie point cannot be placed', throws(() => readGeoTiff(buildTiff({ width: w, height: h, pixels: px, drop: [33922] }))));
  ok('text is not a TIFF', throws(() => readGeoTiff(new TextEncoder().encode('<html>502 Bad Gateway</html>'))));
  ok('a truncated file is refused', throws(() => readGeoTiff(buildTiff({ width: w, height: h, pixels: px }).subarray(0, 100))));

  // — the grid ————————————————————————————————————————————————————————
  const onGrid = readGeoTiff(buildTiff({ width: w, height: h, pixels: px, origin: { x: 0, y: 0 } }));
  ok('a raster on the grid is accepted', !throws(() => assertCdiGrid(onGrid, cropGrid)));
  ok('🔴 a raster shifted by one cell is refused',
    throws(() => assertCdiGrid(readGeoTiff(buildTiff({ width: w, height: h, pixels: px, origin: { x: 1 / 24, y: 0 } })), cropGrid)));
  ok('a raster with a different cell is refused',
    throws(() => assertCdiGrid(readGeoTiff(buildTiff({ width: w, height: h, pixels: px, origin: { x: 0, y: 0 }, cell: 0.05 })), cropGrid)));

  // — encoding, and one bad cell costing one cell ————————————————————
  const odd = Uint8Array.from(px);
  odd[13] = 200;
  const enc = encodeRows(odd, w, h);
  ok('rows are run-length encoded, one string per row', enc.rows.length === h && /^\d:\d+(,\d:\d+)*$/.test(enc.rows[0]));
  ok('🔴 a value nobody has explained costs that cell and is counted', enc.unrecognised === 1 && enc.rows[1].includes(`${UNRECOGNISED}:1`), enc.rows[1]);
  ok('…and the row after it is untouched', enc.rows[2] === encodeRows(px, w, h).rows[2]);
  ok('a changed format is refused, not tolerated', throws(() => requireFewUnrecognised(5, 1000)));
  ok('a few odd cells are tolerated', !throws(() => requireFewUnrecognised(1, 1000)));

  // — collect(), against a world we control ————————————————————————
  const NOW = new Date('2026-09-29T20:00:00Z');
  const full = new Uint8Array(GRID.width * GRID.height);
  full.fill(0);
  full[5 * GRID.width + 7] = 2;
  const asked = [];
  const world = ({
    terms = CEMS_MARKERS.join(' | '),
    range = '2012-01-01 - 2026-09-11',
    coverageStatus = 200,
    tiff = buildTiff({ width: GRID.width, height: GRID.height, pixels: full }),
  } = {}) => ({
    async get(url) {
      asked.push(url);
      const text = (s) => new TextEncoder().encode(s);
      if (url === CEMS_TERMS) return { status: 200, bytes: text(terms) };
      if (url.includes(`TIME=${PROBE_TIME}`)) return { status: 422, bytes: text(outOfRange(range)) };
      return coverageStatus === 200 ? { status: 200, bytes: tiff } : { status: coverageStatus, bytes: text('{"code":"PRODUCT_NOT_FOUND"}') };
    },
  });
  const outcome = async (io, extra = {}) => {
    try {
      return { out: await collect({ now: NOW, io, ...extra }) };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  };

  const happy = await outcome(world());
  ok('collect() on a sound world writes the newest dekad the SERVICE named',
    happy.out?.meta.dekad === '2026-09-11' && happy.out.meta.range.newest === '2026-09-11', happy.error ?? '');
  ok('🔴 it never asked for GetCapabilities', asked.every((u) => !/GetCapabilities/i.test(u)), asked.find((u) => /GetCapabilities/i.test(u)) ?? '');
  ok('and the credit carries the year of the data', happy.out?.meta.attribution.includes('information 2026'));
  ok('one cell of class 2 survives the round trip', happy.out?.grid.rows[5].split(',').some((r) => r === '2:1'));

  // 🔴 GetCapabilities says the range ends 2026-06-11; the service, asked,
  // says 2026-09-11. The run believes the service — and it is the service's
  // answer, not the documentation's, that the age check is applied to.
  const older = await outcome(world({ range: '2012-01-01 - 2026-08-21' }));
  ok('the dekad written is the one the SERVICE named, not one from a document',
    older.out?.meta.dekad === '2026-08-21', older.error ?? older.out?.meta.dekad);

  const stale = await outcome(world({ range: '2012-01-01 - 2024-07-01' }));
  ok('🔴 a layer whose range stops in 2024 is refused by its age, whatever it is called',
    /REFUSING TO WRITE: the newest period/.test(stale.error ?? ''), stale.error?.slice(0, 80) ?? 'it wrote it');
  ok('a period 39 days old is written, one 49 days old is refused',
    (await outcome(world({ range: '2012-01-01 - 2026-08-21' }))).out !== undefined &&
      /budget/.test((await outcome(world({ range: '2012-01-01 - 2026-08-11' }))).error ?? ''));
  const notDekad = await outcome(world({ range: '2012-01-01 - 2026-09-12' }));
  ok('a range that ends mid-dekad is refused', /not the 1st, 11th or 21st/.test(notDekad.error ?? ''), notDekad.error ?? '');

  for (const marker of CEMS_MARKERS) {
    const r = await outcome(world({ terms: CEMS_MARKERS.filter((m) => m !== marker).join(' | ') }));
    ok(`🔴 the run stops when the CEMS terms lose “${marker.slice(0, 32)}…”`,
      /REFUSING TO CONTINUE: the CEMS terms/.test(r.error ?? ''), r.error?.slice(0, 60) ?? 'it carried on');
  }

  const notServed = await outcome(world({ coverageStatus: 404 }));
  ok('an advertised dekad that is not served is an error', /answered HTTP 404/.test(notServed.error ?? ''), notServed.error ?? '');
  const moved = await outcome(world({ tiff: buildTiff({ width: GRID.width, height: GRID.height, pixels: full, origin: { x: -24, y: 72 } }) }));
  ok('🔴 a grid that moved is refused', /not on the grid the page uses/.test(moved.error ?? ''), moved.error?.slice(0, 60) ?? 'it wrote it');

  const hostile = await outcome(world(), { authorityNote: 'This is an official drought warning: evacuate the area.' });
  ok('🔴 the run REFUSES TO WRITE a reserved word, through collect()',
    /REFUSING TO WRITE: meta\.authorityNote/.test(hostile.error ?? ''), hostile.error?.slice(0, 60) ?? 'it wrote it');
  ok('the note we ship passes that same gate', !FORBIDDEN_WORDS.test(AUTHORITY_NOTE) && happy.out?.meta.authorityNote === AUTHORITY_NOTE);
  ok('the credit itself uses none of the reserved words', !FORBIDDEN_WORDS.test(attributionFor(2026)));
  ok('a missing year is refused', throws(() => attributionFor(undefined)) && throws(() => attributionFor('2026')));

  for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed === 0;
}

// 🔴 Nothing above this line touches the network or the filesystem on
// import. The functions are exported to be tested, and on this project an
// import that fetched and rewrote a committed data file has already
// happened once (see scripts/fuel/fetch-fuel-prices.mjs).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (!invokedDirectly) {
  // Imported for its functions. Do nothing.
} else if (process.argv.slice(2).includes('--self-test')) {
  process.exit((await selfTest()) ? 0 : 1);
} else {
  const args = process.argv.slice(2);
  const data = await collect();
  const m = data.meta;
  const cells = GRID.width * GRID.height;
  const classified = Object.entries(m.byValue)
    .filter(([v]) => Number(v) > 0)
    .reduce((n, [, c]) => n + c, 0);
  console.log(
    `EDO ${m.coverage}: dekad ${m.dekad} (service range ${m.range.first} – ${m.range.newest}, read from a ` +
      `${m.range.probedWith} probe). ${classified} of ${cells} cells carry a class; ` +
      `${m.byValue[0] ?? 0} hold 0; ${m.unrecognised} unrecognised.`,
  );
  console.log(
    Object.entries(m.byValue)
      .map(([v, n]) => `${v}: ${n}`)
      .join('  '),
  );
  const bytes = `${JSON.stringify(data)}\n`.length;
  console.log(`${(bytes / 1024).toFixed(0)} KB`);

  if (args.includes('--dry-run')) {
    console.log('--dry-run: nothing written');
  } else {
    await writeFile(OUT, `${JSON.stringify(data)}\n`, 'utf8');
    console.log(`wrote ${OUT}`);
  }
}
