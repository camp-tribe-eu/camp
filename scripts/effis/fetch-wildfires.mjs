#!/usr/bin/env node
// CAMP-153: the EU-27 wildfire perimeters Copernicus has already published.
//
//   node scripts/effis/fetch-wildfires.mjs             # fetch and write
//   node scripts/effis/fetch-wildfires.mjs --dry-run   # fetch, summarise, write nothing
//   node scripts/effis/fetch-wildfires.mjs --self-test # no network at all
//   node scripts/effis/fetch-wildfires.mjs --days=30   # a wider window
//
// 🔴 WHY THIS EXISTS.
//
// The owner's case, in his own words: a fire in Montenegro near a
// campsite, and you should not drive there. A high-sided camper is
// different physics from a car, and the person has the right to know
// before they set off. Copernicus already publishes this; nobody puts it
// next to the campsite they are about to drive to.
//
// 🔴 WHAT IT IS NOT.
//
// Burnt-area perimeters are derived from daily satellite mosaics and only
// catch scars of roughly 30 ha and up. EFFIS says so itself:
//
//   "Burnt scars of approximately 30 hectares in size are mapped"
//   "Daily, two full image mosaics the European territory are processed
//    in EFFIS to derive burnt area maps, every day."
//
// That is trip-planning context, not an evacuation signal, and no line of
// text this script produces may read as an instruction. We mirror what
// Copernicus published, with the date and the attribution; the decision
// stays the driver's.
//
// 🔴 ALWAYS `maxfeatures`. MEASURED, NOT REMEMBERED.
//
// An unbounded GetFeature against ms:modis.ba.poly.season returns 132 MB
// in one response (docs/road-hazard-sources.md §5, measured 28.09.2026).
// `wfsUrl()` below REFUSES to build a GetFeature URL without a positive
// integer `maxfeatures`, so the rule is mechanical rather than
// remembered. The only requests without one are `resultType=hits`, which
// returns a count and no features at all — 713 bytes, measured.
//
// 🔴 THE OUTPUT IS COMMITTED, AND THAT IS DELIBERATE.
//
// Same reasoning as scripts/fuel/fetch-fuel-prices.mjs: a build that
// scraped Copernicus would answer 0 with an empty layer on the day the
// service changed. This runs by hand, writes a file, and a human reads
// the diff. The file carries the moment WE last succeeded, and the page
// says "no fresh data" once that is older than its budget.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'apps', 'web', 'src', 'data', 'wildfires.json');
const MEMBER_STATES = join(
  ROOT,
  'apps',
  'api',
  'src',
  'osm',
  'eu-member-states.json',
);

/** The `/effis` endpoint. The sister `/gwis` WFS times out (§5). */
const WFS = 'https://maps.effis.emergency.copernicus.eu/effis';
const TYPENAME = 'ms:modis.ba.poly.season';
const LICENCE_PAGE =
  'https://forest-fire.emergency.copernicus.eu/about-effis/data-license';
const EFFIS_HOME = 'https://forest-fire.emergency.copernicus.eu/';
/**
 * 🔴 The SECOND document, and the one that decides how we are allowed to
 * speak.
 *
 * CC BY 4.0 is not the whole licence. EFFIS and GWIS are named members of
 * the CEMS early warning and monitoring systems, and the CEMS terms bind
 * every one of them. Read 28.09.2026 (HTTP 200):
 *
 *   "The early warning and monitoring systems of the Copernicus EMS are
 *    composed of the European and Global Flood Awareness Systems (CEMS
 *    EFAS and GloFAS) … the European and Global Drought Observatories
 *    (CEMS EDO and GDO), the European Forest Fire Information System
 *    (EFFIS) and the Global Wildfire Information System (GWIS)"
 *
 *   "Data from the CEMS early warning and monitoring systems is provided
 *    for information purposes only. This means that the data does not
 *    constitute in any way an early warning for which only
 *    national/regional institutions are authorized within their region of
 *    responsibility."
 *
 * So "this is trip-planning context, not an evacuation signal" stopped
 * being our editorial preference the moment CAMP-117 read this page: it
 * is licence text. Nothing we render against an EFFIS product may call
 * itself a warning, a danger or a risk — those are words reserved for the
 * national services, and using them would be claiming an authority the
 * licence explicitly denies us.
 *
 * And the credit is dictated, not paraphrased. For data we have changed —
 * and we have: filtered to the EU-27, cut to a window, rounded onto a
 * grid, renamed the fields — the terms name the notice word for word:
 *
 *   "Where the data of the CEMS early warning and monitoring systems has
 *    been adapted or modified, the user shall provide the following or
 *    similar notice: 'Contains modified Copernicus Emergency Management
 *    Service information [Year]'"
 */
const CEMS_TERMS = 'https://drought.emergency.copernicus.eu/terms&conditions';

/**
 * The words that must still be on the EFFIS licence page.
 *
 * Read 28.09.2026, all three present in the served HTML. Re-read on every
 * run: a licence we merely remember is a licence we will one day be wrong
 * about. Three markers rather than one, because a page that has dropped
 * the Decision but kept the CC BY logo has changed in a way a human
 * should read before we publish anything derived from it.
 */
export const LICENCE_MARKERS = [
  'Creative Commons Attribution 4.0 International (CC BY 4.0)',
  'reuse of Commission documents',
  'reuse is allowed, provided appropriate credit is given',
];

/**
 * The words that must still be in the CEMS terms.
 *
 * Read 28.09.2026, all three present in the served page. They are checked
 * for the same reason as the CC BY markers, and with more at stake: if
 * the disclaimer or the modified-data notice ever changes, every sentence
 * this feature renders has to be re-read before we publish again.
 */
export const CEMS_MARKERS = [
  'European Forest Fire Information System (EFFIS)',
  // 🔴 Stops at "institutions" on purpose. The sentence continues
  // "…are authorized within their region of responsibility", but the
  // served HTML wraps a line there, so the longer string is absent from
  // the raw page and the guard refused a licence that had not changed.
  // Found by running it: the quotation above was checked against the
  // stripped text, and this check reads the bytes.
  'does not constitute in any way an early warning for which only national/regional institutions',
  'Contains modified Copernicus Emergency Management Service information',
];

/**
 * The credit, as the CEMS terms dictate it, plus the CC BY line.
 *
 * 🔴 "Contains modified", not "Generated using". The terms give two
 * notices and they are not interchangeable: the first is for data passed
 * on as it came, the second for data that has been "adapted or modified".
 * Ours has been — EU-27 only, a 14-day window, coordinates rounded onto a
 * ~110 m grid, fields renamed — so claiming the unmodified notice would
 * be a licence breach AND a quiet lie about what the reader is looking at.
 *
 * 🔴 The year comes from the data, not from a constant. "[Year]" in a
 * credit that silently says 2026 for ever is the same stale attribution
 * this project already refuses to ship elsewhere.
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
    '— Copernicus EFFIS/GWIS, © European Union, licensed CC BY 4.0'
  );
};

/**
 * 🔴 Words we may not use about this data, because the licence says the
 * authority to use them belongs to somebody else.
 *
 * Checked against everything this script writes, and again in
 * `apps/web/tests/unit/wildfires.spec.ts` against everything the page
 * renders. Not a style rule: the data "does not constitute in any way an
 * early warning for which only national/regional institutions are
 * authorized".
 */
export const FORBIDDEN_WORDS =
  /\b(warning|warnings|danger|dangerous|risk|risks|risky|alert|alerts|evacuate|evacuation)\b/i;

/**
 * 🔴 EFFIS speaks Eurostat, not ISO 3166, and it costs a whole country.
 *
 * Measured 28.09.2026 with resultType=hits, one request per code:
 *
 *   COUNTRY='GR' →   0 fires        COUNTRY='EL' → 147 fires
 *   COUNTRY='GB' →   0 fires        COUNTRY='UK' → 399 fires
 *
 * So a filter built from our own ISO list returns zero for Greece and
 * nothing anywhere says so — a country that burns every summer silently
 * absent from a fire layer. Same shape as the Åland trap in
 * apps/api/src/osm/eu.ts: the subdivision code that looks wrong is the
 * right one.
 *
 * Written out rather than derived, and checked against the member-state
 * file on every run in both directions, so adding a member state without
 * deciding its EFFIS code is a loud failure rather than a missing map.
 */
export const EFFIS_CODE = {
  at: 'AT', be: 'BE', bg: 'BG', hr: 'HR', cy: 'CY', cz: 'CZ', dk: 'DK',
  ee: 'EE', fi: 'FI', fr: 'FR', de: 'DE', gr: 'EL', hu: 'HU', ie: 'IE',
  it: 'IT', lv: 'LV', lt: 'LT', lu: 'LU', mt: 'MT', nl: 'NL', pl: 'PL',
  pt: 'PT', ro: 'RO', sk: 'SK', si: 'SI', es: 'ES', se: 'SE',
};

/** EFFIS code → our own ISO alpha-2, for writing back out. */
export const ISO_CODE = Object.fromEntries(
  Object.entries(EFFIS_CODE).map(([iso, effis]) => [effis, iso.toUpperCase()]),
);

/**
 * The window, in days, and the ceiling on one response.
 *
 * Measured 28.09.2026, EU-27, with resultType=hits: the whole season is
 * 8 946 fires, the last 30 days 860, the last 14 days 278, the last 7
 * days 106. Fourteen days is the window a trip is planned over, and it is
 * a horizon a reader can hold: "recorded in the last two weeks".
 *
 * 🔴 2 000 is a CEILING, not a page size. The script FAILS if the
 * response comes back holding exactly it, because at that point we cannot
 * tell a complete answer from a truncated one — and a fire layer that is
 * quietly missing its tail is worse than no layer, since people learn to
 * trust it. Seven times the measured 278 is room for a bad fortnight.
 */
export const WINDOW_DAYS = 14;
export const MAX_FEATURES = 2000;

/**
 * Coordinate decimals kept, and why three is not a compromise.
 *
 * The perimeters are traced from MODIS/VIIRS pixels of roughly 250 m.
 * Three decimals is ~110 m of latitude — finer than the source's own
 * resolution, so nothing the satellite actually resolved is lost.
 *
 * Measured over the 278 fires of the 14 days to 28.09.2026: 74 671
 * vertices and 1.90 MB at source precision, 12 677 vertices and 246 KB
 * after rounding and dropping the vertices that rounding made identical.
 * That is 31 KB over the wire gzipped, for a layer that is on by default.
 */
export const DECIMALS = 3;

// ---------------------------------------------------------------------
// The request builder — where the 132 MB rule lives
// ---------------------------------------------------------------------

/**
 * 🔴 The only place a WFS URL is made, and it refuses an unbounded one.
 *
 * The hard rule on this card is "always maxfeatures". A rule enforced by
 * remembering it is a rule that survives until the first hurried edit, so
 * it is a throw instead: a GetFeature without a positive integer
 * `maxfeatures` cannot be constructed. `resultType=hits` is exempt and
 * only because it returns no features at all — the response is a single
 * XML element carrying a number, 713 bytes measured.
 */
export function wfsUrl({ maxfeatures, filter, hits = false }) {
  if (!hits) {
    if (!Number.isInteger(maxfeatures) || maxfeatures <= 0) {
      throw new Error(
        'REFUSING TO BUILD AN UNBOUNDED WFS REQUEST: maxfeatures must be a ' +
          `positive integer, got ${JSON.stringify(maxfeatures)}. ` +
          'Unbounded, this endpoint answers with 132 MB in one response.',
      );
    }
  }
  const u = new URL(WFS);
  u.searchParams.set('service', 'WFS');
  u.searchParams.set('version', '1.1.0');
  u.searchParams.set('request', 'GetFeature');
  u.searchParams.set('typename', TYPENAME);
  if (hits) {
    u.searchParams.set('resultType', 'hits');
  } else {
    u.searchParams.set('outputformat', 'geojson');
    u.searchParams.set('maxfeatures', String(maxfeatures));
  }
  if (filter) u.searchParams.set('filter', filter);
  return u.toString();
}

const eq = (prop, value) =>
  `<PropertyIsEqualTo><PropertyName>${prop}</PropertyName><Literal>${value}</Literal></PropertyIsEqualTo>`;
const ge = (prop, value) =>
  `<PropertyIsGreaterThanOrEqualTo><PropertyName>${prop}</PropertyName><Literal>${value}</Literal></PropertyIsGreaterThanOrEqualTo>`;
const wrap = (inner) =>
  `<Filter xmlns="http://www.opengis.net/ogc">${inner}</Filter>`;

/**
 * The EU-27, as one OGC filter.
 *
 * Measured: the 27 per-country counts sum to 8 946 and this single
 * combined filter returns 8 946. Two independent routes to the same
 * number, which is the only reason to trust either.
 */
export const euFilter = (codes) =>
  `<Or>${codes.map((c) => eq('COUNTRY', c)).join('')}</Or>`;

/**
 * 🔴 The cutoff is a DATE, not a timestamp, because the server compares
 * strings.
 *
 * Measured 28.09.2026, same instant written three ways:
 *
 *   FIREDATE >= '2026-09-01'           → 717
 *   FIREDATE >= '2026-09-01T00:00:00'  → 693
 *
 * FIREDATE is stored as 'YYYY-MM-DD HH:MM:SS' and compared
 * lexicographically, so 'T' (0x54) sorts after the space (0x20) and the
 * ISO form silently drops the 24 fires that started on the cutoff day. A
 * bare date is the form whose string order is also its date order.
 */
export const sinceFilter = (codes, since) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(
      `cutoff must be a bare YYYY-MM-DD date, got ${JSON.stringify(since)} — ` +
        'the server compares FIREDATE as a string and an ISO timestamp drops ' +
        'every fire that started on the cutoff day',
    );
  }
  return wrap(`<And>${euFilter(codes)}${ge('FIREDATE', since)}</And>`);
};

export function windowStart(now, days = WINDOW_DAYS) {
  const t = new Date(now.getTime() - days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Per-record normalising — one bad record costs one record
// ---------------------------------------------------------------------

const round = (v) => Number(v.toFixed(DECIMALS));

/**
 * One ring, rounded, with the vertices rounding made identical removed
 * and the ring closed again.
 *
 * Returns null when nothing survives — a fire smaller than the grid we
 * rounded onto. That is NOT a reason to drop the fire; see `simplify`.
 */
export function simplifyRing(ring, decimals = DECIMALS) {
  const out = [];
  let last = null;
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const [lon, lat] = p;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    // Off the planet: a record we cannot place is a record we cannot draw.
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    const q = [Number(lon.toFixed(decimals)), Number(lat.toFixed(decimals))];
    if (!last || q[0] !== last[0] || q[1] !== last[1]) out.push(q);
    last = q;
  }
  if (out.length < 3) return null;
  const [fx, fy] = out[0];
  const [lx, ly] = out[out.length - 1];
  if (fx !== lx || fy !== ly) out.push([fx, fy]);
  return out.length >= 4 ? out : null;
}

/**
 * 🔴 A fire too small for the grid keeps its own coordinates rather than
 * disappearing.
 *
 * Rounding to ~110 m collapsed 5 of the 278 perimeters in the measured
 * fortnight — the smallest scars, a few hectares. Dropping them would be
 * the layer quietly deciding which fires count, and small is not the same
 * as unimportant when the question is whether to drive somewhere. So the
 * rounding is attempted, and a fire it would erase is kept at full
 * precision instead. Measured: 278 of 278 kept, 246 KB.
 */
export function simplify(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  const rings = (polygon, decimals) => {
    if (!Array.isArray(polygon)) return null;
    const kept = polygon
      .map((r) => simplifyRing(r, decimals))
      .filter((r) => r !== null);
    // The outer ring is the first one; losing it loses the shape.
    return kept.length > 0 ? kept : null;
  };
  const build = (decimals) => {
    if (geometry.type === 'Polygon') {
      const c = rings(geometry.coordinates, decimals);
      return c ? { type: 'Polygon', coordinates: c } : null;
    }
    if (geometry.type === 'MultiPolygon') {
      if (!Array.isArray(geometry.coordinates)) return null;
      const c = geometry.coordinates
        .map((p) => rings(p, decimals))
        .filter((p) => p !== null);
      return c.length > 0 ? { type: 'MultiPolygon', coordinates: c } : null;
    }
    return null;
  };
  // 12 decimals is "as it arrived": more precision than the source has.
  return build(DECIMALS) ?? build(12);
}

/** 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DD', or null if it is not that. */
export function fireDate(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/.exec(raw);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // A date that re-formats to something else was never that date:
  // '2026-02-31' parses in some engines and is not a day.
  return d.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * One EFFIS feature → one of ours, or a reason it was refused.
 *
 * 🔴 ONE BAD RECORD COSTS ONE RECORD. A backwards date range aborted a
 * 12 402-row import on this project once, because the guard rejected bad
 * prices but not bad periods. Nothing in here throws: every refusal comes
 * back as `{ reason }`, is counted by reason, and is printed. The run
 * ends over the records that survived.
 *
 * What is NOT tolerated here is a whole-run fault — a truncated response,
 * a licence page that changed, a country code that maps to nothing. Those
 * are in `collect`, and those do throw.
 */
export function normalise(feature, { since }) {
  if (!feature || typeof feature !== 'object') return { reason: 'not a feature' };
  const p = feature.properties;
  if (!p || typeof p !== 'object') return { reason: 'no properties' };

  // 🔴 ONE scope test, not two. This had a `codes.includes(effis)` check in
  // front of the lookup, and the mutation run showed it could not fail:
  // `memberStateCodes()` has already thrown if the member-state file and
  // this table disagree, so by the time a record gets here the two sets
  // are identical and the second test only looked like a guard. The
  // member-state file stays authoritative — it is what makes that throw
  // possible — and a line that cannot fail is a line that misleads about
  // what guards what (the same finding map-layers.ts records).
  const effis = typeof p.COUNTRY === 'string' ? p.COUNTRY.trim() : '';
  const country = ISO_CODE[effis];
  if (!country) return { reason: `outside the EU-27 (${effis || '—'})` };

  const date = fireDate(p.FIREDATE);
  if (!date) return { reason: `unreadable FIREDATE ${JSON.stringify(p.FIREDATE)}` };
  // 🔴 The server filtered on this too. Checked again on our side because
  // the filter is a string comparison on someone else's column, and a
  // record outside the window we are about to PRINT the dates of is a
  // record that would make the sentence false.
  if (date < since) return { reason: `older than the window (${date})` };

  const hectares = Number(p.AREA_HA);
  if (!Number.isFinite(hectares) || hectares < 0) {
    return { reason: `unreadable AREA_HA ${JSON.stringify(p.AREA_HA)}` };
  }

  const geometry = simplify(feature.geometry);
  if (!geometry) return { reason: 'no drawable geometry' };

  const place = [p.COMMUNE, p.PROVINCE]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(', ');

  return {
    fire: {
      type: 'Feature',
      geometry,
      properties: {
        id: String(p.id ?? ''),
        date,
        country,
        // Empty rather than invented: EFFIS leaves both blank sometimes.
        place,
        hectares: Math.round(hectares),
      },
    },
  };
}

// ---------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------

async function text(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/**
 * 🔴 The only two places this script touches the network, as one object.
 *
 * `collect()` used to call `fetch` directly, which meant every guard inside
 * it — the licence markers, the CEMS markers, the 2 000 ceiling, the
 * refusal to write a reserved word — could be exercised only against
 * Copernicus itself. `--self-test` therefore rehearsed none of them, and
 * measured 29.09.2026: deleting any of the four left it at 49/49. Handing
 * the network in as `io` lets the self-test run the REAL `collect()`
 * against a world it controls, so each guard is watched failing on every
 * run instead of being trusted.
 */
export const REAL_IO = {
  /** A document, as text — the licence page, the CEMS terms, a hits count. */
  text,
  /** The fire window: the WFS response body. */
  async windowText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for the fire window`);
    return res.text();
  },
};

/** Throws `messageFor(marker)` for the first marker `body` does not carry. */
export function requireMarkers(body, markers, messageFor) {
  for (const marker of markers) {
    if (!body.includes(marker)) throw new Error(messageFor(marker));
  }
}

/**
 * A response at the ceiling is a response that may have been cut off.
 * Exported so the self-test can drive the boundary itself: one under
 * passes, the ceiling throws.
 */
export function requireUnderCeiling(count, ceiling = MAX_FEATURES) {
  if (count >= ceiling) {
    throw new Error(
      `the response came back at the ${ceiling} ceiling, so it may be truncated. ` +
        'A fire layer missing its tail is worse than no layer — raise MAX_FEATURES ' +
        'deliberately, or narrow the window, and re-measure.',
    );
  }
}

/**
 * Whose job an official notice is, in our words and on their authority —
 * with none of the words the CEMS terms reserve. A constant so that a
 * test can hand `collect()` a different one and watch it be refused.
 */
export const AUTHORITY_NOTE =
  'Copernicus publishes this for information only. Only national and regional services are authorised to issue official notices for their own area.';

export async function memberStateCodes() {
  const raw = JSON.parse(await readFile(MEMBER_STATES, 'utf8'));
  const members = Object.keys(raw.members);
  // 🔴 Both directions. A member state with no EFFIS code would be
  // silently absent from the filter; an EFFIS code for a country that has
  // left the Union would put it back in. Neither may pass quietly.
  const unmapped = members.filter((m) => !EFFIS_CODE[m]);
  if (unmapped.length > 0) {
    throw new Error(
      `member states with no EFFIS country code: ${unmapped.join(', ')} — ` +
        'decide the code (EFFIS uses Eurostat spellings: EL, not GR) before running this',
    );
  }
  const extra = Object.keys(EFFIS_CODE).filter((c) => !members.includes(c));
  if (extra.length > 0) {
    throw new Error(
      `EFFIS_CODE names countries that are not member states: ${extra.join(', ')}`,
    );
  }
  return members.map((m) => EFFIS_CODE[m]);
}

/** How many fires the whole season holds inside the EU-27. No features. */
export async function seasonCount(codes, io = REAL_IO) {
  const body = await io.text(wfsUrl({ hits: true, filter: wrap(euFilter(codes)) }));
  const m = /numberOfFeatures="(\d+)"/.exec(body);
  if (!m) {
    throw new Error(`no numberOfFeatures in the hits response: ${body.slice(0, 300)}`);
  }
  return Number(m[1]);
}

export async function collect({
  now = new Date(),
  days = WINDOW_DAYS,
  io = REAL_IO,
  authorityNote = AUTHORITY_NOTE,
} = {}) {
  const licence = await io.text(LICENCE_PAGE);
  requireMarkers(
    licence,
    LICENCE_MARKERS,
    (marker) =>
      `REFUSING TO CONTINUE: the EFFIS licence page no longer contains ${JSON.stringify(marker)}. ` +
      `Read ${LICENCE_PAGE} before publishing anything derived from this data.`,
  );

  // 🔴 Both documents, every run. CC BY 4.0 says we may reuse it; the
  // CEMS terms say what we may call it and exactly how to credit it. A
  // run that checked only the first would keep publishing a credit the
  // second had changed, and nothing would report it.
  const terms = await io.text(CEMS_TERMS);
  requireMarkers(
    terms,
    CEMS_MARKERS,
    (marker) =>
      `REFUSING TO CONTINUE: the CEMS terms no longer contain ${JSON.stringify(marker)}. ` +
      `Read ${CEMS_TERMS} before publishing: this page decides both our wording and our credit.`,
  );

  const codes = await memberStateCodes();
  const since = windowStart(now, days);
  const euSeasonTotal = await seasonCount(codes, io);

  const url = wfsUrl({
    maxfeatures: MAX_FEATURES,
    filter: sinceFilter(codes, since),
  });
  const started = Date.now();
  const raw = await io.windowText(url);
  const took = Date.now() - started;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // MapServer answers XML on an error even when geojson was asked for.
    throw new Error(`the window response is not JSON: ${raw.slice(0, 400)}`);
  }
  if (!Array.isArray(parsed.features)) {
    throw new Error('the window response carries no feature array');
  }
  requireUnderCeiling(parsed.features.length);

  const fires = [];
  const rejected = [];
  for (const feature of parsed.features) {
    const out = normalise(feature, { since });
    if (out.fire) fires.push(out.fire);
    else rejected.push({ id: feature?.properties?.id ?? '—', reason: out.reason });
  }

  const byCountry = {};
  for (const f of fires) {
    byCountry[f.properties.country] = (byCountry[f.properties.country] ?? 0) + 1;
  }

  const out = {
    type: 'FeatureCollection',
    meta: {
      // 🔴 OUR clock, and the only one the page's freshness budget reads.
      // Not the freshest LASTUPDATE in the set: a quiet fortnight with no
      // updated record is not a broken pipeline, and conflating the two
      // would make the page cry "no fresh data" every calm week (§8 of
      // docs/road-hazard-sources.md keeps these clocks apart on purpose).
      fetchedAt: now.toISOString(),
      source: 'Copernicus EFFIS / GWIS',
      sourceUrl: EFFIS_HOME,
      licence: 'CC BY 4.0',
      licenceUrl: LICENCE_PAGE,
      termsUrl: CEMS_TERMS,
      // 🔴 The CEMS notice for MODIFIED data, with the year of the data.
      // Rendered next to the shapes, never held as a constant in a
      // component — a credit nobody can see is not a credit.
      attribution: attributionFor(now.getUTCFullYear()),
      /**
       * Whose job it is to tell people what to do, in our words but on
       * their authority — and with none of the words the terms reserve.
       */
      authorityNote,
      layer: TYPENAME,
      windowDays: days,
      since,
      /** What the whole season holds EU-wide, so the window has a scale. */
      euSeasonTotal,
      maxFeatures: MAX_FEATURES,
      kept: fires.length,
      rejected: rejected.length,
      byCountry,
      /** What EFFIS says about its own latency — quoted, not paraphrased. */
      latencyNote:
        'Active fires are updated about six times a day and reach EFFIS within 2–3 hours; burnt-area perimeters are derived daily and map scars of roughly 30 hectares and up.',
    },
    features: fires,
  };

  checkMetaWording(out.meta);

  // 🔴 Reported, not refused. A commune whose name happens to contain one
  // of these words is EFFIS's proper noun, not our assertion, so failing
  // the whole run over it would be the guard that fires on innocent text.
  // The PAGE drops such a label before rendering it (`readFire`); this
  // line exists so a human learns the case is real rather than
  // hypothetical. Measured today over the 278 shipped perimeters: none.
  const oddPlaces = fires
    .map((f) => f.properties.place)
    .filter((place) => place && FORBIDDEN_WORDS.test(place));
  if (oddPlaces.length > 0) {
    console.log(
      `${oddPlaces.length} place name(s) contain a word the CEMS terms reserve; ` +
        `the page will render these unnamed: ${oddPlaces.join(' | ')}`,
    );
  }

  return out;
}

/**
 * 🔴 Refuse to WRITE a word the licence reserves for national services.
 *
 * Exported, and that is the fix rather than a tidy-up: this loop lived
 * inside `collect()`, which needs two live HTTP requests, so the one
 * guard standing between a reserved word and the committed data file was
 * rehearsed only when a human happened to run the script by hand. It is
 * now driven by `apps/web/tests/unit/wildfire-fetch.spec.ts`, which runs
 * in the ordinary unit project on every CI job.
 */
export function checkMetaWording(meta) {
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' && FORBIDDEN_WORDS.test(value)) {
      throw new Error(
        `REFUSING TO WRITE: meta.${key} uses a word the CEMS terms reserve for ` +
          `national services — ${JSON.stringify(value)}. The data "does not constitute ` +
          'in any way an early warning"; say what Copernicus recorded instead.',
      );
    }
  }
  return meta;
}

// ---------------------------------------------------------------------
// Self-test: every rule above, on fixtures, with no network
// ---------------------------------------------------------------------

async function selfTest() {
  const checks = [];
  const ok = (name, cond, detail = '') =>
    checks.push({ name, pass: Boolean(cond), detail: String(detail) });
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  // — the 132 MB rule ————————————————————————————————————————————————
  ok('a GetFeature without maxfeatures cannot be built', throws(() => wfsUrl({})));
  ok('…nor with zero', throws(() => wfsUrl({ maxfeatures: 0 })));
  ok('…nor with a string', throws(() => wfsUrl({ maxfeatures: '2000' })));
  ok('…nor with a fraction', throws(() => wfsUrl({ maxfeatures: 1.5 })));
  ok('…nor with Infinity', throws(() => wfsUrl({ maxfeatures: Infinity })));
  ok(
    'a bounded one carries the limit',
    wfsUrl({ maxfeatures: 7 }).includes('maxfeatures=7'),
  );
  ok(
    'a hits request is exempt and asks for no features',
    (() => {
      const u = wfsUrl({ hits: true });
      return u.includes('resultType=hits') && !u.includes('outputformat');
    })(),
  );

  // — the credit the CEMS terms dictate ——————————————————————————————
  ok(
    'the notice is the one for MODIFIED data',
    attributionFor(2026).startsWith(
      'Contains modified Copernicus Emergency Management Service information 2026',
    ),
    attributionFor(2026),
  );
  ok('and it still carries CC BY 4.0', attributionFor(2026).includes('CC BY 4.0'));
  ok('a missing year is refused', throws(() => attributionFor(undefined)));
  ok('a string year is refused', throws(() => attributionFor('2026')));
  ok('a nonsense year is refused', throws(() => attributionFor(1026)));
  ok(
    '🔴 the credit itself uses none of the reserved words',
    !FORBIDDEN_WORDS.test(attributionFor(2026)),
  );

  // — the words the licence reserves ————————————————————————————————
  ok(
    'the reserved words are caught wherever they appear',
    ['a wildfire warning', 'DANGER ahead', 'fire risk is high', 'weather alerts', 'evacuate now'].every(
      (s) => FORBIDDEN_WORDS.test(s),
    ),
  );
  ok(
    'and ordinary words that merely contain them are not',
    // 🔴 Word boundaries, so "brisk" and "Warwick" are not licence
    // breaches. A guard that fires on innocent text gets switched off.
    ['a brisk walk', 'Warwickshire', 'Alerta is a place'].every(
      (s) => !FORBIDDEN_WORDS.test(s),
    ),
  );
  ok(
    '🔴 the authority sentence we ship says whose job it is without those words',
    (() => {
      const s =
        'Copernicus publishes this for information only. Only national and regional services are authorised to issue official notices for their own area.';
      return !FORBIDDEN_WORDS.test(s) && s.includes('national and regional services');
    })(),
  );

  // — the cutoff format ——————————————————————————————————————————————
  ok('a bare date is accepted', sinceFilter(['PT'], '2026-09-14').includes('2026-09-14'));
  ok(
    'an ISO timestamp is refused, because it drops the cutoff day',
    throws(() => sinceFilter(['PT'], '2026-09-14T00:00:00')),
  );
  ok('a nonsense cutoff is refused', throws(() => sinceFilter(['PT'], 'last week')));
  ok(
    'the window is counted back from the given moment',
    windowStart(new Date('2026-09-28T18:00:00Z'), 14) === '2026-09-14',
    windowStart(new Date('2026-09-28T18:00:00Z'), 14),
  );

  // — Greece —————————————————————————————————————————————————————————
  ok('Greece is EL, not GR', EFFIS_CODE.gr === 'EL', EFFIS_CODE.gr);
  ok('and maps back to our own ISO code', ISO_CODE.EL === 'GR', ISO_CODE.EL);
  ok('27 countries, no more and no fewer', Object.keys(EFFIS_CODE).length === 27);
  ok(
    'every EFFIS code maps back to exactly one member state',
    Object.keys(ISO_CODE).length === 27,
  );

  // — dates ——————————————————————————————————————————————————————————
  ok('a fire date drops the time', fireDate('2026-09-14 02:06:00') === '2026-09-14');
  ok('a bare date is a date', fireDate('2026-09-14') === '2026-09-14');
  ok('31 February is not a day', fireDate('2026-02-31') === null);
  ok('a month of 13 is not a month', fireDate('2026-13-01') === null);
  ok('nothing is not a date', fireDate(null) === null && fireDate('') === null);
  ok('a number is not a date', fireDate(20260914) === null);

  // — geometry ———————————————————————————————————————————————————————
  // Every corner of this one rounds to the same 10.000 / 45.000, so the
  // ring collapses to a point at DECIMALS. It is the shape of the 5 real
  // fires that collapsed in the measured fortnight.
  const tiny = [[[10.00011, 45.00011], [10.00019, 45.00011], [10.00019, 45.00019], [10.00011, 45.00019], [10.00011, 45.00011]]];
  ok(
    'a ring that DOES collapse on the grid is detected',
    simplifyRing(tiny[0]) === null,
  );
  ok(
    'a fire smaller than the grid keeps its own coordinates instead of vanishing',
    (() => {
      const g = simplify({ type: 'Polygon', coordinates: tiny });
      return g !== null && g.coordinates[0].length >= 4 && g.coordinates[0][1][0] === 10.00019;
    })(),
    JSON.stringify(simplify({ type: 'Polygon', coordinates: tiny })?.coordinates?.[0]?.[1]),
  );
  ok(
    'a big perimeter is rounded onto the grid',
    (() => {
      const big = [[[10.00011, 45.0], [11.00019, 45.0], [11.0, 46.0], [10.0, 46.0], [10.00011, 45.0]]];
      const g = simplify({ type: 'Polygon', coordinates: big });
      return g.coordinates[0][0][0] === 10 && g.coordinates[0][1][0] === 11;
    })(),
  );
  ok(
    'a ring that rounding flattened to a line is not a shape',
    simplifyRing([[10, 45], [10.0001, 45], [10.0002, 45], [10, 45]]) === null,
  );
  ok('NaN in a ring is not a place', simplifyRing([[NaN, 45], [11, 45], [11, 46], [10, 45]]) === null);
  ok('a coordinate off the planet is refused', simplifyRing([[200, 45], [11, 45], [11, 46], [200, 45]]) === null);
  ok('a MultiPolygon survives', simplify({ type: 'MultiPolygon', coordinates: [[[[10, 45], [11, 45], [11, 46], [10, 45]]]] })?.type === 'MultiPolygon');
  ok('a Point is not a perimeter', simplify({ type: 'Point', coordinates: [10, 45] }) === null);
  ok('no geometry at all is not a perimeter', simplify(null) === null);

  // — one bad record costs one record ————————————————————————————————
  const good = (over = {}) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]] },
    properties: {
      id: '1', FIREDATE: '2026-09-20 02:06:00', COUNTRY: 'IT',
      AREA_HA: '63', PROVINCE: 'Sicilia', COMMUNE: 'Enna', ...over,
    },
  });
  const opts = { since: '2026-09-14' };
  ok('a sound record survives', normalise(good(), opts).fire?.properties.hectares === 63);
  ok('Greece comes back as GR, not EL', normalise(good({ COUNTRY: 'EL' }), opts).fire?.properties.country === 'GR');
  ok('a non-EU fire is refused, not thrown', Boolean(normalise(good({ COUNTRY: 'UA' }), opts).reason));
  ok('a backwards date is refused, not thrown', Boolean(normalise(good({ FIREDATE: '2025-01-01 00:00:00' }), opts).reason));
  ok('an unreadable area is refused, not thrown', Boolean(normalise(good({ AREA_HA: 'lots' }), opts).reason));
  ok('a negative area is refused', Boolean(normalise(good({ AREA_HA: '-5' }), opts).reason));
  ok('a fire with no perimeter is refused', Boolean(normalise({ ...good(), geometry: null }, opts).reason));
  ok('a missing place is empty, never invented', normalise(good({ PROVINCE: undefined, COMMUNE: undefined }), opts).fire?.properties.place === '');
  ok(
    '🔴 one bad record among four costs exactly one',
    (() => {
      const batch = [good({ id: '1' }), good({ id: '2', FIREDATE: 'yesterday' }), good({ id: '3' }), good({ id: '4' })];
      const kept = batch.map((f) => normalise(f, opts)).filter((r) => r.fire);
      return kept.length === 3 && kept.map((r) => r.fire.properties.id).join(',') === '1,3,4';
    })(),
  );
  ok(
    '🔴 nothing in normalise can abort a run',
    (() => {
      for (const junk of [null, undefined, {}, { properties: null }, { properties: {} }, 'string', 42, []]) {
        try {
          const r = normalise(junk, opts);
          if (!r.reason) return false;
        } catch {
          return false;
        }
      }
      return true;
    })(),
  );

  // — collect() itself, against a world we control ————————————————————
  //
  // 🔴 Everything above tests helpers. The guards that stand between
  // Copernicus and the committed file live INSIDE collect(), which used to
  // need two live HTTP requests to run at all, so none of them was ever
  // watched failing: measured 29.09.2026, deleting the licence-marker
  // loop, the CEMS-marker loop, the 2 000 ceiling or the write-refusal
  // left this self-test at 49/49. These run the real collect() with its
  // network replaced, one guard at a time.
  const NOW = new Date('2026-09-28T18:00:00Z');
  const world = ({
    licence = LICENCE_MARKERS.join(' | '),
    terms = CEMS_MARKERS.join(' | '),
    features = [good()],
    windowBody,
  } = {}) => ({
    text: async (url) =>
      url === LICENCE_PAGE
        ? licence
        : url === CEMS_TERMS
          ? terms
          : '<wfs:FeatureCollection numberOfFeatures="8946"/>',
    windowText: async () =>
      windowBody ?? JSON.stringify({ type: 'FeatureCollection', features }),
  });
  const outcome = async (io, extra = {}) => {
    const log = console.log;
    console.log = () => {}; // the odd-place notice is not a check's business
    try {
      return { out: await collect({ now: NOW, io, ...extra }) };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    } finally {
      console.log = log;
    }
  };

  const happy = await outcome(world());
  ok('collect() on a sound world writes one fire and the modified-data credit',
    happy.out?.meta.kept === 1 &&
      happy.out.meta.attribution.startsWith('Contains modified Copernicus Emergency Management Service information 2026'),
    happy.error ?? '');

  for (const marker of LICENCE_MARKERS) {
    const r = await outcome(world({ licence: LICENCE_MARKERS.filter((m) => m !== marker).join(' | ') }));
    ok(
      `🔴 the run stops when the licence page loses “${marker.slice(0, 32)}…”`,
      /REFUSING TO CONTINUE: the EFFIS licence page/.test(r.error ?? ''),
      r.error?.slice(0, 60) ?? 'it carried on',
    );
  }
  for (const marker of CEMS_MARKERS) {
    const r = await outcome(world({ terms: CEMS_MARKERS.filter((m) => m !== marker).join(' | ') }));
    ok(
      `🔴 the run stops when the CEMS terms lose “${marker.slice(0, 32)}…”`,
      /REFUSING TO CONTINUE: the CEMS terms/.test(r.error ?? ''),
      r.error?.slice(0, 60) ?? 'it carried on',
    );
  }

  const full = (n) => Array.from({ length: n }, (_, i) => good({ id: String(i) }));
  const atCeiling = await outcome(world({ features: full(MAX_FEATURES) }));
  ok('🔴 a response AT the ceiling is refused as possibly truncated', /ceiling/.test(atCeiling.error ?? ''), atCeiling.error?.slice(0, 60) ?? 'it carried on');
  const underCeiling = await outcome(world({ features: full(MAX_FEATURES - 1) }));
  ok('…and one under it is not', underCeiling.out?.meta.kept === MAX_FEATURES - 1, underCeiling.error ?? '');
  ok('the ceiling helper agrees at its boundary',
    throws(() => requireUnderCeiling(5, 5)) && !throws(() => requireUnderCeiling(4, 5)));

  const notJson = await outcome(world({ windowBody: '<ServiceException/>' }));
  ok('an XML error in place of the window is refused', /not JSON/.test(notJson.error ?? ''));

  const hostile = await outcome(world(), {
    authorityNote: 'This is an official fire danger warning: evacuate the area immediately.',
  });
  ok('🔴 the run REFUSES TO WRITE a reserved word, through collect() and not only the helper',
    /REFUSING TO WRITE: meta\.authorityNote/.test(hostile.error ?? ''),
    hostile.error?.slice(0, 60) ?? 'it wrote it');
  ok('the note we ship passes that same gate',
    !FORBIDDEN_WORDS.test(AUTHORITY_NOTE) && happy.out?.meta.authorityNote === AUTHORITY_NOTE);
  ok('checkMetaWording refuses a reserved word in any meta string',
    throws(() => checkMetaWording({ anything: 'severe weather warning' })) &&
      !throws(() => checkMetaWording({ anything: 'a plain sentence' })));

  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed === 0;
}

// 🔴 Nothing above this line touches the network or the filesystem on
// import. The functions are exported to be tested, and on this project an
// import that fetched and rewrote a committed data file has already
// happened once (see scripts/fuel/fetch-fuel-prices.mjs).
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (!invokedDirectly) {
  // Imported for its functions. Do nothing.
} else if (process.argv.slice(2).includes('--self-test')) {
  process.exit((await selfTest()) ? 0 : 1);
} else {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : WINDOW_DAYS;
  if (!Number.isInteger(days) || days <= 0 || days > 366) {
    throw new Error(`--days must be a whole number of days in 1..366, got ${daysArg}`);
  }

  const data = await collect({ days });
  const m = data.meta;
  console.log(
    `EFFIS ${m.layer}: ${m.kept} fires in the EU-27 since ${m.since} ` +
      `(${m.rejected} records refused), out of ${m.euSeasonTotal} EU-27 fires this season.`,
  );
  console.log(
    Object.entries(m.byCountry)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} ${n}`)
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
