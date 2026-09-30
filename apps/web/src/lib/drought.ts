// CAMP-163 — the drought layer's rules, with no React and no map in them.
//
// 🔴 THE LAYER IS HONEST ABOUT WHAT IT IS: A DATED, SLOW INDICATOR.
//
// The Combined Drought Indicator (CDI) of Copernicus EDO is published per
// DEKAD — a ten-day period — and its newest period is weeks old when the
// service is healthy. Measured 28.09.2026: the newest began 27 days
// earlier and nothing was broken. docs/emergency-sources.md §4 and §12 say
// the same, so this is the one hazard layer where old is normal, and
// where the page must say the period out loud rather than imply a
// currency it does not have.
//
// The two mistakes this file exists to prevent are mirror images:
//
//   - a 27-day-old period drawn as broken ("no fresh data" every week
//     would teach readers to ignore the words on the week it matters), and
//   - a period that IS stale drawn as current: the two layers `smand` and
//     `cdinx` are still advertised and stop in 2024, and a service that
//     lists what it holds would put them on a 2026 page.
//
// So the budget is stated (`FRESH_FOR_DAYS`), measured from the FIRST DAY
// OF THE PERIOD, and enforced here on what the page is given — not on
// what the fetch script believed when it wrote the file.
//
// 🔴 THE SECOND THING IT MUST NEVER DO IS SPEAK WITH SOMEBODY ELSE'S
// AUTHORITY. EDO is a CEMS product, so the licence applies: the data "does
// not constitute in any way an early warning for which only
// national/regional institutions are authorized"
// (https://drought.emergency.copernicus.eu/terms&conditions, read
// 28.09.2026). "Warning", "danger", "risk" and "alert" are not ours to say
// beside it — and the SOURCE'S OWN class names are two of them. The CDI
// calls its three drought classes Watch, Warning and Alert, so this file
// names them by their rank instead ("class 2 of 3"), which is also all a
// reader can be told without us interpreting them.
// `tests/unit/cems-panels/drought.panel.ts` reads every state for all of it.
//
// 🔴 THE THIRD THING IS TO NEVER RENDER NOTHING. A cell of 0 is not an
// answer: the raster holds "no drought class" and "outside the area
// Copernicus computes" as the same number, so a blank on this map is not
// an all-clear, and every state — including the campsite outside the grid
// and the row of the file we could not read — has a sentence.

import { CEMS_NOTICE, RESERVED_WORDS } from './cems';
import { formatDay } from './wildfires';

/** Where the map fetches the grid from. */
export const DROUGHT_URL = '/data/drought.json';

/**
 * 🔴 How many whole days after the first day of its period the newest CDI
 * may be before the page says "no fresh data".
 *
 * docs/emergency-sources.md §12: healthy is "up to 30 days" and "more than
 * ~40 days and a dekad was skipped". `scripts/edo/fetch-drought.mjs`
 * carries the same number and `tests/unit/drought.spec.ts` asserts the two
 * are equal.
 *
 * 🔴 Measured from the dekad's START, not from when WE read it. That one
 * clock covers both failures: a pipeline nobody re-ran and a period
 * Copernicus skipped both make the newest period we hold older than this,
 * and neither can be told apart from the other by our own timestamp — nor
 * needs to be.
 */
export const FRESH_FOR_DAYS = 40;

/** The coverage this page reads. Anything else is refused, whatever its date. */
export const COVERAGE = 'cdiad';

/** Highest value with a known meaning; above it is a cell we cannot read. */
export const MAX_KNOWN_VALUE = 6;
/** What the fetch script writes for a cell holding a value nobody has explained. */
export const UNRECOGNISED = 9;

export interface DroughtMeta {
  /** When WE last succeeded against EDO. ISO instant. */
  fetchedAt: string;
  source: string;
  sourceUrl: string;
  /** The CEMS terms, which govern the wording as well as the credit. */
  termsUrl: string;
  attribution: string;
  /** Whose job an official notice is — never ours. */
  authorityNote: string;
  product: string;
  /** The EDO layer this was read from. Only `cdiad` is accepted. */
  coverage: string;
  /** First day of the ten-day period the grid describes, YYYY-MM-DD. */
  dekad: string;
}

/** The raster, decoded: one byte per cell, row-major from the north-west corner. */
export interface CdiGrid {
  west: number;
  north: number;
  cellsPerDegree: number;
  width: number;
  height: number;
  cells: Uint8Array;
  /** Cells in rows we could not read, or holding a value we do not know. */
  unreadable: number;
}

export interface DroughtFeed {
  meta: DroughtMeta;
  grid: CdiGrid;
}

/**
 * 🔴 The feed's strings that reach the reader's eyes, as text — the same
 * list seen from two sides: the panel prints these and `readFeed` gates
 * exactly these.
 */
export const RENDERED_META = ['source', 'attribution', 'authorityNote', 'product'] as const satisfies readonly (keyof DroughtMeta)[];

/** …and the ones it turns into links. */
export const RENDERED_LINKS = ['sourceUrl', 'termsUrl'] as const satisfies readonly (keyof DroughtMeta)[];

export type DroughtState =
  /** The fetch is still in flight. Not the same as having nothing. */
  | { kind: 'loading' }
  /** The file would not load or is not the shape we wrote. */
  | { kind: 'missing' }
  /** It loaded, and the newest period in it is past the budget. */
  | { kind: 'stale'; meta: DroughtMeta; daysOld: number }
  | { kind: 'fresh'; meta: DroughtMeta; grid: CdiGrid; daysOld: number };

// ── dekads ───────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' → that day at 00:00 UTC in ms, or null when it is not a real date. */
function dayMs(label: unknown): number | null {
  if (typeof label !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return null;
  const ms = Date.parse(`${label}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  // '2026-02-31' parses in some engines and is not a day.
  return new Date(ms).toISOString().slice(0, 10) === label ? ms : null;
}

/** A dekad is named by its first day: the 1st, the 11th or the 21st. */
export function isDekadStart(label: unknown): label is string {
  return dayMs(label) !== null && ['01', '11', '21'].includes((label as string).slice(8, 10));
}

export interface DekadPeriod {
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day, YYYY-MM-DD: the 10th, the 20th, or the month's last day. */
  end: string;
  /** "11–20 September 2026". */
  label: string;
}

/** The ten-day period a dekad label names, or null when it names none. */
export function dekadPeriod(label: unknown): DekadPeriod | null {
  if (!isDekadStart(label)) return null;
  const day = Number(label.slice(8, 10));
  const [year, month] = [Number(label.slice(0, 4)), Number(label.slice(5, 7))];
  // Day 0 of the next month is the last day of this one — leap years and 28-day Februaries included.
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDay = day === 1 ? 10 : day === 11 ? 20 : lastOfMonth;
  const month2 = String(month).padStart(2, '0');
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  });
  return {
    start: label,
    end: `${year}-${month2}-${String(endDay).padStart(2, '0')}`,
    label: `${day}–${endDay} ${monthName} ${year}`,
  };
}

/** Whole days from the first day of the dekad to `now`. Negative when it is ahead. */
export function dekadAgeDays(label: string, now: Date): number {
  const start = dayMs(label);
  if (start === null) return Number.NaN;
  return Math.floor((now.getTime() - start) / 86_400_000);
}

// ── the grid ─────────────────────────────────────────────────────────────

/**
 * One row of `"0:39,1:2,0:1783"` into `out[offset … offset + width)`.
 * False, with nothing trusted, when the row is not exactly `width` cells of
 * runs we can read.
 */
function decodeRow(row: unknown, width: number, out: Uint8Array, offset: number): boolean {
  if (typeof row !== 'string' || row.length === 0) return false;
  const runs = row.split(',');
  let at = 0;
  for (const run of runs) {
    const colon = run.indexOf(':');
    if (colon !== 1) return false; // one digit of value, then the count
    const value = run.charCodeAt(0) - 48;
    if (value < 0 || value > 9) return false;
    const count = Number(run.slice(2));
    // 🔴 No `at + count > width` bound here, and that is measured, not an
    // omission: a run that overruns the row is refused by the sum check
    // below, its row is then filled with UNRECOGNISED, and `readGrid` visits
    // every later row, which rewrites its own slice — so what an overrun
    // wrote into its neighbours never survives. `TypedArray.fill` clamps at
    // the end of the array, so the last row cannot write past it either.
    // Rows overrunning by 3, by 50 and by 10⁹ left 0 of 2 188 800 cells
    // different and took no longer; a bound that changes nothing is a line
    // that misleads about what guards what. The tests that hold this are the
    // overrunning rows in "a row that will not decode costs that row".
    if (!Number.isInteger(count) || count <= 0) return false;
    out.fill(value > MAX_KNOWN_VALUE ? UNRECOGNISED : value, offset + at, offset + at + count);
    at += count;
  }
  return at === width;
}

/**
 * The grid, or null when its shape is not the one we wrote.
 *
 * 🔴 ONE BAD ROW COSTS ONE ROW. A row that will not decode is filled with
 * `UNRECOGNISED` and counted, and every other row is read; the panel says
 * that some of the file could not be read, and a campsite in such a row is
 * told so. What costs the whole layer is a file with the wrong NUMBER of
 * rows, or with nothing readable at all — there is then no grid to sample,
 * and `missing` says so instead of drawing a blank.
 */
export function readGrid(input: unknown): CdiGrid | null {
  if (!input || typeof input !== 'object') return null;
  const g = input as Record<string, unknown>;
  const { west, north, cellsPerDegree, width, height, rows } = g;
  if (typeof west !== 'number' || !Number.isFinite(west) || west < -180 || west > 180) return null;
  if (typeof north !== 'number' || !Number.isFinite(north) || north < -90 || north > 90) return null;
  if (
    typeof cellsPerDegree !== 'number' ||
    !Number.isInteger(cellsPerDegree) ||
    cellsPerDegree < 1 ||
    cellsPerDegree > 3600
  ) {
    return null;
  }
  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1) return null;
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 1) return null;
  if (width * height > 10_000_000) return null;
  if (!Array.isArray(rows) || rows.length !== height) return null;

  const cells = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    if (!decodeRow(rows[r], width, cells, r * width)) {
      cells.fill(UNRECOGNISED, r * width, (r + 1) * width);
    }
  }
  // A cell is unreadable whether its row would not decode or the script
  // marked the value — both are stored as UNRECOGNISED.
  let unreadable = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === UNRECOGNISED) unreadable++;
  // Nothing readable is not a grid: there is nothing to sample.
  if (unreadable === cells.length) return null;
  return { west, north, cellsPerDegree, width, height, cells, unreadable };
}

// ── what a cell means ────────────────────────────────────────────────────

export type CdiCell =
  /** 0: no class here — and NOT "no drought", see the header. */
  | { kind: 'none' }
  /** 1–3: one of the three primary drought classes, 1 the lowest. */
  | { kind: 'drought'; level: 1 | 2 | 3 }
  /** 4–6: one of three recovery classes; which is which we do not say. */
  | { kind: 'recovery' }
  /** A cell we could not read. */
  | { kind: 'unreadable' };

export type CdiSample =
  | CdiCell
  /** The point is beyond the edge of Copernicus's grid. */
  | { kind: 'outside' }
  /** The point has no usable coordinates. */
  | { kind: 'unplaced' };

/**
 * 🔴 What each value means — established by comparing the raster with the
 * service's own rendering on 2026-09-11, not read from its documentation:
 * `cdiad` paints exactly values 1–3 (yellow, orange, red) and leaves 4–6
 * transparent; `cdirc` paints 0 white and 4–6 in three other colours. The
 * layer's abstract names the three primary classes and three recovery
 * classes, in that order. Which recovery class is which is not established,
 * so nothing here names one.
 */
export function classOfValue(value: number): CdiCell {
  // A cell is a byte. Anything that is not a whole number is not one, and
  // must not be rounded into the class it happens to sit between.
  if (!Number.isInteger(value)) return { kind: 'unreadable' };
  if (value === 0) return { kind: 'none' };
  if (value >= 1 && value <= 3) return { kind: 'drought', level: value as 1 | 2 | 3 };
  if (value >= 4 && value <= MAX_KNOWN_VALUE) return { kind: 'recovery' };
  return { kind: 'unreadable' };
}

/**
 * The value of the cell a point falls in.
 *
 * The corner of the grid is the corner of cell (0, 0) — GDAL's "Area"
 * convention, and what the service's DescribeCoverage says once its cell-
 * centre origin is moved half a cell — so a point is in cell
 * `floor((lon − west) · n)`, `floor((north − lat) · n)`. Checked against
 * `gdallocationinfo` on a crop written by another program, in
 * `tests/unit/drought-fetch.spec.ts`.
 */
export function sampleAt(grid: CdiGrid, lat: number, lon: number): CdiSample {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { kind: 'unplaced' };
  const col = Math.floor((lon - grid.west) * grid.cellsPerDegree);
  const row = Math.floor((grid.north - lat) * grid.cellsPerDegree);
  if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return { kind: 'outside' };
  return classOfValue(grid.cells[row * grid.width + col]);
}

// ── how it is drawn ──────────────────────────────────────────────────────

/**
 * 🔴 NOT a traffic light. Red on a class of drought is the CAMP-162
 * vocabulary rendered in CSS, and the campsite markers are already #C83D28.
 * One hue, pale to dark, for the three primary classes, and a cool colour
 * for recovery. The legend in the panel and the pixels on the map read
 * from this one table, so they cannot drift apart.
 */
export const CDI_COLOURS = {
  1: '#F2D98A',
  2: '#D9A441',
  3: '#A5541B',
  recovery: '#8FB8CC',
} as const;

export const CDI_LEGEND: readonly { key: string; colour: string; label: string }[] = [
  { key: 'drought-1', colour: CDI_COLOURS[1], label: 'Drought class 1 of 3, the lowest' },
  { key: 'drought-2', colour: CDI_COLOURS[2], label: 'Drought class 2 of 3' },
  { key: 'drought-3', colour: CDI_COLOURS[3], label: 'Drought class 3 of 3, the highest' },
  { key: 'recovery', colour: CDI_COLOURS.recovery, label: 'Recovering after drought' },
];

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** RGB for a cell value, or null when it is not drawn (no class, or unreadable). */
export function colourOfValue(value: number): [number, number, number] | null {
  if (value >= 1 && value <= 3) return rgb(CDI_COLOURS[value as 1 | 2 | 3]);
  if (value >= 4 && value <= MAX_KNOWN_VALUE) return rgb(CDI_COLOURS.recovery);
  return null;
}

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOfMercatorY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);

/**
 * How many output rows per source cell, at the grid's shortest cells.
 *
 * 🔴 ONE, and it is the smallest whole number that is safe — measured on the
 * shipped 1 824 × 1 200 grid (its geometry is the service's, and does not
 * move with the data):
 *
 *     rows/cell   output rows   source rows skipped   buffer
 *         2          3 695              0             25.7 MiB
 *         1          1 848              0             12.9 MiB
 *         0.98       1 811              1             12.6 MiB
 *         0.9        1 663             15             11.6 MiB
 *
 * A source row is skipped once the picture has fewer than 1 816 rows, so 1
 * keeps a margin of 32 rows over the cliff and 2 buys nothing but a buffer
 * twice the size — and the same factor again in the GPU texture, on a
 * phone. It used to be 2, on the belief that finer rows were more accurate;
 * the accuracy is bounded by half an output row either way (below), and
 * nothing measured a difference.
 *
 * Held from BOTH sides in tests/unit/drought.spec.ts: a value under 1 makes
 * "no source row is skipped" fail (0.9 skips 15), and one over about 1.05
 * makes "the picture fits its memory budget" fail (2 is 25.7 MiB).
 */
export const OVERLAY_ROWS_PER_CELL = 1;

export interface DroughtOverlay {
  width: number;
  height: number;
  /** RGBA, row-major from the north. Cells with no drawn class are transparent. */
  data: Uint8ClampedArray;
  /** Upper-left, upper-right, lower-right, lower-left, as MapLibre wants an image source's corners. */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
}

/**
 * The grid as a picture MapLibre can lay over the map.
 *
 * 🔴 RESAMPLED INTO WEB MERCATOR, and not a courtesy. The raster is
 * equirectangular (a cell is 1/24° both ways) and MapLibre stretches an
 * image linearly in MERCATOR space between its four corners. Laid on as
 * it is, the middle of the picture (47°N) would land at about 53.5°N —
 * 700 km off — and every campsite would sit on the class of a place six
 * degrees away. So each output row is one latitude in mercator space and
 * takes its colour from the source row that latitude falls in.
 *
 * One output row per source cell at the southern edge, where cells are
 * shortest in mercator space (`OVERLAY_ROWS_PER_CELL` says why one is
 * enough), so the picture never skips a source row. The class UNDER a
 * campsite marker is the one the panel reports, to within half an output
 * row — 0.8 km at 71°N to 2 km at 35°N, the EU-27's northern and southern
 * edges; the panel reads the grid itself and is the source of truth.
 */
export function paintOverlay(grid: CdiGrid): DroughtOverlay {
  const cpd = grid.cellsPerDegree;
  const south = grid.north - grid.height / cpd;
  const east = grid.west + grid.width / cpd;
  const yTop = mercatorY(grid.north);
  const yBottom = mercatorY(south);
  const cellY = Math.PI / 180 / cpd / Math.cos((Math.min(Math.abs(south), Math.abs(grid.north)) * Math.PI) / 180);
  const outHeight = Math.max(1, Math.ceil((yTop - yBottom) / (cellY / OVERLAY_ROWS_PER_CELL)));
  const data = new Uint8ClampedArray(grid.width * outHeight * 4);

  const palette = new Map<number, [number, number, number] | null>();
  for (let v = 0; v <= 9; v++) palette.set(v, colourOfValue(v));

  for (let r = 0; r < outHeight; r++) {
    const y = yTop - ((r + 0.5) * (yTop - yBottom)) / outHeight;
    const lat = latOfMercatorY(y);
    const srcRow = Math.min(grid.height - 1, Math.max(0, Math.floor((grid.north - lat) * cpd)));
    for (let c = 0; c < grid.width; c++) {
      const colour = palette.get(grid.cells[srcRow * grid.width + c]);
      if (!colour) continue;
      const at = (r * grid.width + c) * 4;
      data[at] = colour[0];
      data[at + 1] = colour[1];
      data[at + 2] = colour[2];
      data[at + 3] = 255;
    }
  }
  return {
    width: grid.width,
    height: outHeight,
    data,
    coordinates: [
      [grid.west, grid.north],
      [east, grid.north],
      [east, south],
      [grid.west, south],
    ],
  };
}

// ── the file, and the state the page is in ───────────────────────────────

/**
 * Is this the file we wrote, or something else?
 *
 * 🔴 Tolerant on the way in and strict about what it admits. A deploy
 * where the data file is half-written, or served as an HTML error page by
 * a CDN, must reach `missing` — which SAYS SO — rather than throw inside a
 * React render and take the map down with it.
 */
export function readFeed(input: unknown): DroughtFeed | null {
  if (!input || typeof input !== 'object') return null;
  const feed = input as { meta?: unknown; grid?: unknown };
  const meta = feed.meta as Partial<DroughtMeta> | undefined;
  if (!meta || typeof meta !== 'object') return null;

  if (typeof meta.fetchedAt !== 'string' || Number.isNaN(Date.parse(meta.fetchedAt))) return null;

  // 🔴 The layer's identity, checked on the page as well as in the script.
  // `smand` and `cdinx` are advertised as current and stop in 2024; the
  // script cannot build a request for either, and this is the second lock
  // on the same door, for a file that came from somewhere else.
  if (meta.coverage !== COVERAGE) return null;

  if (!isDekadStart(meta.dekad)) return null;
  const dekadStart = dayMs(meta.dekad)!;
  // A read cannot predate the period it describes.
  if (Date.parse(meta.fetchedAt) < dekadStart) return null;

  if (typeof meta.attribution !== 'string' || meta.attribution.length === 0) return null;
  // 🔴 The credit the CEMS terms name for modified data — and with the
  // year of the DATA. A notice frozen at another year is the stale
  // attribution the licence exists to prevent.
  if (!CEMS_NOTICE.test(meta.attribution)) return null;
  const year = meta.dekad.slice(0, 4);
  if (!new RegExp(`information ${year}\\b`).test(meta.attribution)) return null;

  if (typeof meta.authorityNote !== 'string' || meta.authorityNote.length === 0) return null;

  // 🔴 EVERY string the panel prints, not only the two most likely: the
  // gate that guards "no reserved word beside CEMS data" is only as wide
  // as this list, and the list is the panel's own.
  for (const key of RENDERED_META) {
    const value = meta[key];
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    if (RESERVED_WORDS.test(value)) return null;
  }
  for (const key of RENDERED_LINKS) {
    const value = meta[key];
    if (typeof value !== 'string' || !/^https:\/\/\S+$/.test(value)) return null;
  }

  const grid = readGrid(feed.grid);
  if (!grid) return null;
  return { meta: meta as DroughtMeta, grid };
}

/**
 * What state the layer is in, from the raw thing that arrived.
 *
 * 🔴 A period 27 days old is FRESH here, on purpose — see the header. A
 * period more than `FRESH_FOR_DAYS` old is `stale`, and a period dated in
 * the future is stale too: a clock that reads "−4 days old" would pass
 * every budget for ever, which is the shape of a guard that agrees with
 * the bug.
 */
export function droughtState(input: unknown, now: Date): DroughtState {
  const feed = readFeed(input);
  if (!feed) return { kind: 'missing' };
  const daysOld = dekadAgeDays(feed.meta.dekad, now);
  const clockBehind = Date.parse(feed.meta.fetchedAt) > now.getTime() + 60_000;
  if (!(daysOld >= 0) || daysOld > FRESH_FOR_DAYS || clockBehind) {
    return { kind: 'stale', meta: feed.meta, daysOld };
  }
  return { kind: 'fresh', meta: feed.meta, grid: feed.grid, daysOld };
}

// ── the words ────────────────────────────────────────────────────────────

/** A campsite the reader picked on the map. */
export interface DroughtPick {
  name: string | null;
  lat: number;
  lon: number;
}

export interface DroughtNote {
  /** 'quiet' when there is a class to report, 'gap' when there is not. */
  tone: 'quiet' | 'gap';
  headline: string;
  detail: string;
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * A campsite name we may print.
 *
 * 🔴 A name comes from OpenStreetMap, which anyone may edit, and it is
 * printed beside CEMS data under OUR voice. One that says a word the terms
 * reserve costs the NAME, not the sentence: the campsite is still a
 * campsite, and "this campsite" says everything the reader needs.
 */
export function printableName(name: string | null | undefined): string | null {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed.length > 0 && !RESERVED_WORDS.test(trimmed) ? trimmed : null;
}

const CELL_NOTE =
  'Each cell is about 4.6 km from north to south, so it describes the surrounding area, not the ground at a pitch.';

/**
 * The words under the map, for every state the layer can be in.
 *
 * 🔴 Every branch returns a sentence, and none is ever empty: this is what
 * stands between a blank and a reader who takes the blank for an all-clear.
 */
export function droughtNote(state: DroughtState, pick: DroughtPick | null): DroughtNote {
  if (state.kind === 'loading') {
    return {
      tone: 'gap',
      headline: 'Loading the Copernicus EDO drought layer…',
      detail:
        'Nothing is drawn yet. An empty map here means we are still fetching, not that no drought has been recorded.',
    };
  }

  if (state.kind === 'missing') {
    return {
      tone: 'gap',
      headline: 'No fresh drought data — we could not load the Copernicus EDO layer.',
      detail:
        'Nothing is drawn here, and that is a gap in what we hold, not a statement that no drought has been recorded.',
    };
  }

  if (state.kind === 'stale') {
    const began = formatDay(state.meta.dekad);
    const gap = 'Nothing is drawn, and that is a gap in what we hold, not a statement that no drought has been recorded.';
    // 🔴 A period dated ahead of the clock is not an age. Said as what it
    // is, because the reader's question is "can I trust this".
    if (state.daysOld < 0) {
      return {
        tone: 'gap',
        headline: 'No fresh drought data.',
        detail:
          `The newest ten-day period we hold is dated ${began ?? 'with a date we cannot read'}, which is in the future — ` +
          `a clock somewhere is wrong, so the map is off rather than showing a period we cannot place. ${gap}`,
      };
    }
    const when = Number.isFinite(state.daysOld)
      ? `${days(state.daysOld)} ago, past our ${FRESH_FOR_DAYS}-day budget for this indicator`
      : 'at a time we cannot read';
    return {
      tone: 'gap',
      headline: 'No fresh drought data.',
      detail:
        `The newest ten-day period we hold began ${began ? `on ${began}` : 'on a date we cannot read'}, ${when}, ` +
        `so the map is off rather than showing an old period as the current one. ${gap}`,
    };
  }

  const { meta, grid } = state;
  const period = dekadPeriod(meta.dekad);
  // `readFeed` refused any dekad that is not a period, so this is never null.
  const label = period ? period.label : meta.dekad;
  // 🔴 The age is stated and called normal: 27 days is what a healthy
  // service looks like. Saying only "N days" would invite the misreading
  // this whole file exists to prevent.
  const age =
    `That period began ${days(state.daysOld)} ago. Copernicus publishes this indicator per ten-day period, ` +
    `days to weeks after the period ends, so an age of up to ${FRESH_FOR_DAYS} days is normal for it.`;
  const unreadable =
    grid.unreadable > 0
      ? ' Part of the file could not be read, so some areas are left blank for that reason.'
      : '';
  const caveat = `${CELL_NOTE} ${meta.authorityNote}${unreadable}`;
  const indicator = `Copernicus EDO's Combined Drought Indicator for ${label}`;

  if (!pick) {
    return {
      tone: 'quiet',
      headline: `${indicator} is drawn on the map.`,
      detail:
        `Select a campsite to see the class recorded at its location. Where nothing is drawn, no class is recorded — that is not the same as no drought. ${age} ${caveat}`,
    };
  }

  const at = printableName(pick.name) ?? 'this campsite';
  const sample = sampleAt(grid, pick.lat, pick.lon);
  switch (sample.kind) {
    case 'drought':
      return {
        tone: 'quiet',
        headline: `At ${at}, ${indicator} records drought class ${sample.level} of 3.`,
        detail:
          'Class 1 is the lowest of the three drought classes and class 3 the highest. ' +
          `The indicator combines Copernicus's precipitation, soil-moisture and vegetation anomalies. ${age} ${caveat}`,
      };
    case 'recovery':
      return {
        tone: 'quiet',
        headline: `At ${at}, ${indicator} records a recovery class.`,
        detail:
          'Recovery classes mark areas Copernicus describes as recovering towards normal conditions after drought. ' +
          `${age} ${caveat}`,
      };
    case 'none':
      return {
        tone: 'gap',
        headline: `At ${at}, ${indicator} records no drought class.`,
        detail:
          'Its raster holds "no drought" and "outside the area it computes" as the same value, so this is not the same as being told the area is free of drought. ' +
          `${age} ${caveat}`,
      };
    case 'outside': {
      const east = grid.west + grid.width / grid.cellsPerDegree;
      const south = grid.north - grid.height / grid.cellsPerDegree;
      return {
        tone: 'gap',
        headline: `${at[0].toUpperCase()}${at.slice(1)} lies outside the area Copernicus's grid covers, so ${indicator} says nothing about it.`,
        detail:
          `The grid runs from ${Math.abs(grid.west)}°${grid.west < 0 ? 'W' : 'E'} to ${Math.abs(east)}°${east < 0 ? 'W' : 'E'} and ` +
          `from ${south}°N to ${grid.north}°N. That is a gap in what Copernicus published, not a statement that no drought has been recorded. ${age}`,
      };
    }
    case 'unreadable':
      return {
        tone: 'gap',
        headline: `We could not read ${indicator} at ${at}.`,
        detail:
          'Part of Copernicus\'s file was not readable at this location, so nothing is shown for it — that is a gap in what we hold, not a statement that no drought has been recorded. ' +
          age,
      };
    case 'unplaced':
      return {
        tone: 'gap',
        headline: `We cannot place ${at} on the map, so we cannot say what ${indicator} holds for it.`,
        detail: `That is a gap in what we hold, not a statement that no drought has been recorded. ${age}`,
      };
  }
}
