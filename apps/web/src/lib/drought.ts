import { CEMS_NOTICE, RESERVED_WORDS } from './cems';

// CAMP-163 — the Combined Drought Indicator, as the page reads it.
//
// 🔴 THIS LAYER IS SLOW ON PURPOSE AND MUST NOT APOLOGISE FOR IT.
//
// The CDI is published once every ten days. Three weeks old is the
// newest reading that exists, not a broken pipeline — which makes this
// the one hazard layer we can show exactly as it is. Every other source
// in `docs/emergency-sources.md` had to be fast or be dropped.
//
// So the staleness budget here is not the wildfire layer's 72 hours with
// a bigger number in it. It asks a different question: has a dekad been
// SKIPPED? Thirty days is one dekad late and ordinary; past forty, two
// publications have failed to appear and the reading is no longer the
// newest there is, only the last one we got.
//
// 🔴 THE THREE ANSWERS ARE NOT TWO.
//
// The raster says 0 both where the indicator measured normal conditions
// and where it does not look at all, and `docs/emergency-sources.md` §4
// recorded that conflation as unresolved. It is resolved in the data
// file now — see `scripts/edo/fetch-drought.mjs` — and this file's whole
// job is to keep the three apart on the page:
//
//   not covered      → we do not know, and we say so
//   covered, 0       → we DO know, and there is no drought
//   covered, 1..6    → the stage, in our own words
//
// Collapsing the first two into one blank space would turn "we measured
// and your campsite is fine" into silence, and silence on a hazard panel
// reads as bad news.

/** How old a dekad may be before it is no longer simply "the newest one". */
export const DEKAD_HEALTHY_DAYS = 30;

/**
 * Past this, a dekad has been skipped.
 *
 * 🔴 Both numbers are the product's own cadence, not a feeling: dekads
 * are ten days apart, so one missed publication is unremarkable and two
 * is the thing a reader deserves to be told about.
 */
export const DEKAD_SKIPPED_DAYS = 40;

export interface DroughtClass {
  value: number;
  label: string;
  detail: string;
}

export interface DroughtGrid {
  width: number;
  height: number;
  lon0: number;
  lat0: number;
  pixel: number;
}

export interface DroughtMeta {
  source: string;
  sourceUrl: string;
  termsUrl: string;
  indicator: string;
  coverage: string;
  dekad: string;
  dekadAgeDays: number;
  fetchedAt: string;
  attribution: string;
  cadenceNote: string;
  grid: DroughtGrid;
  classes: DroughtClass[];
}

export type DroughtState =
  /** The file would not load, or is not the shape the script writes. */
  | { kind: 'missing' }
  /** It loaded — and a successful read of a skipped dekad is the dangerous case. */
  | { kind: 'behind'; meta: DroughtMeta; daysOld: number }
  | { kind: 'current'; meta: DroughtMeta; daysOld: number; cdi: Uint8Array; domain: Uint8Array };

export type DroughtReading =
  | { known: false; why: string }
  | { known: true; value: number; label: string; detail: string };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 🔴 Every string we will print is checked here, at the door.
 *
 * The data file is written by a script that already refuses reserved
 * words, and that is exactly why this exists too: a file edited by hand,
 * or written by an older copy of the script, reaches the page through
 * this function and nothing else. One gate in the writer protects the
 * writer; a reader that trusts its input has no gate at all.
 */
function wordsAreOurs(meta: DroughtMeta): boolean {
  const strings: string[] = [
    meta.source,
    meta.indicator,
    meta.cadenceNote,
    meta.attribution,
    ...meta.classes.flatMap((c) => [c.label, c.detail]),
  ];
  return !strings.some((s) => RESERVED_WORDS.test(s));
}

function readGrid(input: unknown): DroughtGrid | null {
  if (!input || typeof input !== 'object') return null;
  const g = input as Partial<DroughtGrid>;
  if (!Number.isInteger(g.width) || !Number.isInteger(g.height)) return null;
  if ((g.width as number) <= 0 || (g.height as number) <= 0) return null;
  if (!isFiniteNumber(g.lon0) || !isFiniteNumber(g.lat0)) return null;
  if (!isFiniteNumber(g.pixel) || g.pixel <= 0) return null;
  return { width: g.width as number, height: g.height as number, lon0: g.lon0, lat0: g.lat0, pixel: g.pixel };
}

export function readMeta(input: unknown): DroughtMeta | null {
  if (!input || typeof input !== 'object') return null;
  const m = (input as { meta?: unknown }).meta as Partial<DroughtMeta> | undefined;
  if (!m || typeof m !== 'object') return null;
  for (const key of ['source', 'sourceUrl', 'termsUrl', 'indicator', 'coverage', 'dekad', 'fetchedAt', 'attribution', 'cadenceNote'] as const) {
    if (typeof m[key] !== 'string' || !m[key]) return null;
  }
  // 🔴 The credit is a CONDITION of using this data, with the year in it.
  // A file that lost it is a file we may not render.
  if (!CEMS_NOTICE.test(m.attribution as string)) return null;
  if (!/^\d{4}-\d{2}-(01|11|21)$/.test(m.dekad as string)) return null;
  const grid = readGrid(m.grid);
  if (!grid) return null;
  if (!Array.isArray(m.classes) || m.classes.length === 0) return null;
  const classes: DroughtClass[] = [];
  for (const c of m.classes) {
    if (!c || typeof c !== 'object') return null;
    const k = c as Partial<DroughtClass>;
    if (!Number.isInteger(k.value) || typeof k.label !== 'string' || typeof k.detail !== 'string') return null;
    if (!k.label || !k.detail) return null;
    classes.push({ value: k.value as number, label: k.label, detail: k.detail });
  }
  // 🔴 Links are rendered as hrefs. A file that carried `javascript:` or
  // a bare word here would put it in an anchor on 65 000 pages.
  for (const key of ['sourceUrl', 'termsUrl'] as const) {
    if (!/^https:\/\//.test(m[key] as string)) return null;
  }

  const meta: DroughtMeta = {
    source: m.source as string,
    sourceUrl: m.sourceUrl as string,
    termsUrl: m.termsUrl as string,
    indicator: m.indicator as string,
    coverage: m.coverage as string,
    dekad: m.dekad as string,
    dekadAgeDays: isFiniteNumber(m.dekadAgeDays) ? m.dekadAgeDays : NaN,
    fetchedAt: m.fetchedAt as string,
    attribution: m.attribution as string,
    cadenceNote: m.cadenceNote as string,
    grid,
    classes,
  };
  return wordsAreOurs(meta) ? meta : null;
}

/** Whole days between a dekad and a moment, dates only on both sides. */
export function dekadAgeDays(dekad: string, now: Date): number {
  const a = Date.parse(`${dekad}T00:00:00Z`);
  const b = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * The value at a coordinate, keeping the three answers apart.
 *
 * `cdi` and `domain` are the decoded buffers; `domain` is one BIT per
 * pixel, in the same order.
 */
export function readingAt(
  state: Extract<DroughtState, { kind: 'current' }>,
  lat: number,
  lon: number,
): DroughtReading {
  const { grid } = state.meta;
  const outside = { known: false, why: 'This indicator does not cover this location.' } as const;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return outside;
  const col = Math.floor((lon - grid.lon0) / grid.pixel);
  const row = Math.floor((grid.lat0 - lat) / grid.pixel);
  if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return outside;
  const i = row * grid.width + col;
  if (i >= state.cdi.length) return outside;
  // 🔴 Not covered is not the same as covered-and-fine, and this is the
  // only line that can tell them apart.
  if (((state.domain[i >> 3] >> (i & 7)) & 1) === 0) return outside;
  const value = state.cdi[i];
  const cls = state.meta.classes.find((c) => c.value === value);
  if (!cls) return { known: false, why: 'This indicator returned a value we do not recognise.' };
  return { known: true, value, label: cls.label, detail: cls.detail };
}

/**
 * Turn the two committed files into what the page renders.
 *
 * `decode` is passed in rather than imported so this stays a pure
 * function of its inputs: the browser and the build decompress
 * differently, and a test should not have to own a gzip implementation
 * to assert what a skipped dekad does.
 */
export function droughtState(
  input: unknown,
  domainInput: unknown,
  now: Date,
  decode: (s: string) => Uint8Array,
): DroughtState {
  const meta = readMeta(input);
  if (!meta) return { kind: 'missing' };

  const daysOld = dekadAgeDays(meta.dekad, now);
  // 🔴 A dekad in the future is behind, not fresh. A clock that read
  // "-4 days old" would otherwise satisfy every budget for ever — the
  // shape of a check that agrees with the bug.
  if (!(daysOld >= 0) || daysOld > DEKAD_SKIPPED_DAYS) {
    return { kind: 'behind', meta, daysOld };
  }

  const cdiRaw = (input as { cdi?: unknown }).cdi;
  const domRaw = (domainInput as { domain?: unknown })?.domain;
  if (typeof cdiRaw !== 'string' || typeof domRaw !== 'string') return { kind: 'missing' };

  let cdi: Uint8Array;
  let domain: Uint8Array;
  try {
    cdi = decode(cdiRaw);
    domain = decode(domRaw);
  } catch {
    return { kind: 'missing' };
  }

  const cells = meta.grid.width * meta.grid.height;
  // 🔴 A grid that disagrees with its own pixels is not a smaller map, it
  // is every campsite answering about the wrong place. `readingAt` would
  // happily index into it.
  if (cdi.length !== cells) return { kind: 'missing' };
  if (domain.length !== Math.ceil(cells / 8)) return { kind: 'missing' };

  return { kind: 'current', meta, daysOld, cdi, domain };
}

export interface DroughtNote {
  /** 'quiet' when there is a reading to show, 'gap' when there is not. */
  tone: 'quiet' | 'gap';
  headline: string;
  detail: string;
  /** The dekad this describes, as a reader reads it, or null when there is none. */
  asOf: string | null;
}

/** 2026-09-11 → 11 September 2026. Never invented when the date is not one. */
export function formatDay(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The sentence the panel prints.
 *
 * 🔴 `tone` is 'quiet' or 'gap' and never anything stronger, for the same
 * reason the wildfire note is: the CEMS terms say this data "does not
 * constitute in any way an early warning", so our strongest register is
 * a plain statement of what was measured and when.
 */
export function droughtNote(state: DroughtState, lat: number, lon: number): DroughtNote {
  if (state.kind === 'missing') {
    return {
      tone: 'gap',
      headline: 'No drought reading',
      detail: 'We could not read the Copernicus drought indicator for this campsite.',
      asOf: null,
    };
  }
  if (state.kind === 'behind') {
    return {
      tone: 'gap',
      headline: 'No recent drought reading',
      detail:
        `The newest reading we hold is from ${formatDay(state.meta.dekad) ?? state.meta.dekad}, ` +
        'and at least one ten-day publication has not appeared since.',
      asOf: formatDay(state.meta.dekad),
    };
  }

  const reading = readingAt(state, lat, lon);
  const asOf = formatDay(state.meta.dekad);
  if (!reading.known) {
    return { tone: 'gap', headline: 'No drought reading here', detail: reading.why, asOf };
  }
  return {
    tone: 'quiet',
    headline: reading.value === 0 ? 'No drought here' : `Drought: ${reading.label}`,
    detail: reading.detail,
    asOf,
  };
}
