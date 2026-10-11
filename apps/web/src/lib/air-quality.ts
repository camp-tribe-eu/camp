// CAMP-164: the EEA's European Air Quality Index, as a reader meets it.
//
// 🔴 THREE THINGS THIS FILE EXISTS TO KEEP TRUE, and each is the
// subject of a test that reads the SERVED HTML, not this file:
//
//   1. A MODEL IS NOT A READING. A `modelled` value — the 1 km raster,
//      or a pollutant the EEA gap-filled with a downscaled CAMS forecast
//      — is labelled "modelled estimate" in words on the page, and the
//      two kinds are told apart by the basis line and by the container,
//      not by a colour or a class.
//   2. THE WORDING IS "AS REPORTED TO THE EEA, NOT FORMALLY VERIFIED".
//      The EEA's own About text says the station data are "not formally
//      verified by countries". We say what the index says, who reported
//      it, and never "the air quality is …".
//   3. A STATION THAT IS NOT REPORTING SAYS "NO FRESH DATA". One station
//      in five is silent in any given hour (docs/emergency-sources.md
//      §9, and 933 of 4 018 in the import that came with this card); an
//      empty section reads as clean air, which is the misreading the
//      card exists to prevent.
//
// 🔴 FRESHNESS IS DECIDED HERE, AGAINST A CLOCK THE CALLER PASSES IN.
//
// The campsite pages are built once and served from a CDN; a reading in
// the HTML is the reading at build time and stays in the HTML for as long
// as the build does. So this file never reads the clock itself: the
// server render passes the build time, and the browser passes its own on
// mount (components/air-quality.tsx), which is what turns a reading that
// has aged past the budget into "no fresh data" on a page nobody has
// rebuilt. The API sends facts with no verdict in them; a function that
// reads the clock cannot be tested, and this one guards a published claim.

import { AIR_SOURCE_ID, HOURLY_DEAD_AFTER_DAYS, shouldFlagStale } from './sources';

// Declared in `sources.ts`, where it is the key of `SOURCES`. See the
// comment beside the declaration for the cycle this avoids.
export { AIR_SOURCE_ID };

/**
 * How old a reading may be and still be shown, in whole hours before the
 * current one. Mirrored from api/src/air/source.ts, which owns the number
 * and the measurement behind it; a unit test asserts they are equal,
 * because two copies of a number is how a page ends up describing a
 * filter it does not have.
 */
export const AIR_FRESH_FOR_HOURS = 4;

/** The radius the API applied, mirrored for the sentence that states it. */
export const AIR_RADIUS_M = 15_000;

/**
 * 🔴 HOW OFTEN THIS SOURCE IS EXPECTED TO CHANGE — declared, and the
 * opposite of the bathing water's. That source is annual and a year-old
 * value is healthy; this one is hourly and a value a few hours old is not.
 * The 730-day "nobody has updated this in over two years" flag in
 * lib/sources.ts is about a different kind of record and must never be
 * what decides this one.
 *
 * 🔴 THIS COMMENT USED TO END "(`shouldFlagStale` refuses to run on it)",
 * which was true until CAMP-166 and false after it. That card replaced
 * the exemption with a budget: the function now has an `hourly` branch
 * and this object is what selects it. A comment describing the old
 * behaviour is worse than none, because it tells the next reader not to
 * look.
 */
export const AIR_FRESHNESS = {
  cadence: 'hourly' as const,
  ageIsNormal: false,
  freshForHours: AIR_FRESH_FOR_HOURS,
};

/**
 * 🔴 The attribution, VERBATIM from the EEA — the sentence its viewer
 * prints about who made the index. There is no `copyrightText` to take it
 * from: it is empty on all five image services behind the index (read
 * 29.09.2026), and api/src/air/source.ts records what was searched. The
 * curly apostrophe (U+2019) is the EEA's.
 *
 * The component RENDERS this constant and the spec asserts against it; a
 * unit test asserts it equals the API's copy, and `verify-attribution.ts`
 * in the API reads the live page and fails if the sentence is not on it.
 */
export const AIR_ATTRIBUTION =
  'The European Air Quality Index was developed jointly by the ' +
  'European Commission’s Directorate General for Environment and the ' +
  'European Environment Agency to inform citizens and public ' +
  'authorities about the recent air quality status across Europe.';

/**
 * 🔴 The credit the EEA's terms actually ask for, printed after theirs.
 *
 * `AIR_ATTRIBUTION` is the EEA's sentence about who DEVELOPED the index.
 * It is true and it is theirs, but it never names a source — and the
 * terms ask for exactly that:
 *
 *   "for commercial or non-commercial purposes, provided that the EEA is
 *    always acknowledged as the original source of the material"
 *     — eea.europa.eu/en/legal-notice, Copyright notice, read 01.10.2026
 *
 * Confirmed for this index in writing by the EEA Enquiry Service, case
 * #309009, 01.10.2026. The API holds the same two constants and a unit
 * test asserts both pairs are equal; api/src/air/verify-attribution.ts
 * reads BOTH live pages — the sentence, and the permission to use it.
 */
export const AIR_SOURCE_CREDIT =
  'Source: European Environment Agency (EEA).';

/** The six levels, as the EEA's viewer names them. Level 1 to 6. */
export const AIR_BAND_LABELS: readonly string[] = [
  'Good',
  'Fair',
  'Moderate',
  'Poor',
  'Very poor',
  'Extremely poor',
];

export type AirBasis = 'reported' | 'mixed';
export type AirStationType = 'traffic' | 'industrial' | 'background';
export const AIR_STATION_TYPES: readonly AirStationType[] = [
  'traffic',
  'industrial',
  'background',
];
export const AIR_POLLUTANTS = ['PM2.5', 'PM10', 'NO2', 'O3', 'SO2'] as const;
export type AirPollutant = (typeof AIR_POLLUTANTS)[number];

export interface AirPollutantReading {
  pollutant: AirPollutant;
  band: number;
  /** µg/m³. */
  value: number;
  /** 🔴 True where the value is a gap-filled model estimate, not a report. */
  modelled: boolean;
}

export interface AirStationFacts {
  code: string;
  name: string;
  municipality: string | null;
  type: AirStationType;
  /** Straight-line metres from the campsite. */
  metres: number;
}

export interface AirReadingFacts {
  /** The hour reported, ISO 8601 UTC. */
  hour: string;
  band: number;
  basis: AirBasis;
  culprit: AirPollutant;
  pollutants: AirPollutantReading[];
  /** When the EEA's file was read, ISO 8601 UTC. */
  readAt: string;
}

/** What the API sends. Facts — no verdict about freshness in it. */
export type AirQualityFacts =
  | { kind: 'station'; station: AirStationFacts; reading: AirReadingFacts | null }
  | { kind: 'modelled'; modelled: { hour: string; band: number; readAt: string } }
  | { kind: 'none' };

/** What the reader is told. Exactly one, always. */
export type AirState =
  | {
      state: 'reported' | 'mixed';
      station: AirStationFacts;
      reading: AirReadingFacts;
      ageHours: number;
    }
  | {
      state: 'modelled';
      hour: string;
      band: number;
      readAt: string;
      ageHours: number;
    }
  | {
      state: 'no-fresh-data';
      reason: 'station-silent' | 'station-stale' | 'model-stale';
      station: AirStationFacts | null;
      /** The last hour we hold, if any. */
      lastHour: string | null;
      /**
       * When WE last read the EEA's file, if the payload said. A
       * different fact from `lastHour`, which is the hour the value
       * describes.
       */
      readAt: string | null;
      /**
       * 🔴 CAMP-198: whether our own collection has stopped, as opposed
       * to the air being quietly unmeasured for a few hours.
       *
       * `shouldFlagStale` has had the rule for this since CAMP-166 —
       * `HOURLY_DEAD_AFTER_DAYS`, an hourly source that has not moved in
       * a whole day — and nothing in the application called it. Decided
       * here rather than in the sentence, because this module already
       * owns the clock and a second place that reads `new Date()` is a
       * second place that can disagree with the first.
       */
      ourFeedStalled: boolean;
    }
  | { state: 'no-data'; reason: 'nothing-covers' | 'unreadable' };

const HOUR_MS = 3_600_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** An ISO instant, or null. Not `new Date(x)` alone: that accepts "1". */
function instant(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

const level = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
};

function readPollutants(v: unknown): AirPollutantReading[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: AirPollutantReading[] = [];
  const seen = new Set<string>();
  for (const p of v) {
    if (!isRecord(p)) return null;
    const pollutant = AIR_POLLUTANTS.find((x) => x === p.pollutant);
    const band = level(p.band);
    const value = num(p.value);
    // 🔴 `modelled` must be a boolean. Anything else — missing, 0, "no" —
    // is refused, never read as "not modelled".
    if (!pollutant || band === null || value === null || typeof p.modelled !== 'boolean') {
      return null;
    }
    if (seen.has(pollutant)) return null;
    seen.add(pollutant);
    out.push({ pollutant, band, value, modelled: p.modelled });
  }
  return out;
}

/**
 * The basis a list of pollutants implies. 🔴 There is no third value: a
 * reading in which EVERY pollutant is modelled is not a station reading
 * at all, and `null` here is what refuses it.
 */
export function basisOf(pollutants: readonly AirPollutantReading[]): AirBasis | null {
  const modelled = pollutants.filter((p) => p.modelled).length;
  if (modelled === 0) return 'reported';
  return modelled < pollutants.length ? 'mixed' : null;
}

function readReading(v: unknown): AirReadingFacts | null {
  if (!isRecord(v)) return null;
  const hour = instant(v.hour);
  const readAt = instant(v.readAt);
  const band = level(v.band);
  const pollutants = readPollutants(v.pollutants);
  const culprit = AIR_POLLUTANTS.find((x) => x === v.culprit);
  if (!hour || !readAt || band === null || !pollutants || !culprit) return null;

  // 🔴 Two independent derivations of the basis must agree: the one the
  // importer stored and the one these pollutants imply. If they do not,
  // one of the two is wrong, and the one that could print "as reported"
  // over a model is not going to be trusted.
  const implied = basisOf(pollutants);
  if (implied === null || v.basis !== implied) return null;

  // The headline level is the worst pollutant's, and the culprit is one
  // of the pollutants it names.
  const worst = Math.max(...pollutants.map((p) => p.band));
  if (band !== worst || !pollutants.some((p) => p.pollutant === culprit)) return null;

  return { hour, band, basis: implied, culprit, pollutants, readAt };
}

/**
 * The API's payload, checked. Never throws, and never widens: anything
 * that is not exactly a shape we know is `null`, which `airState` turns
 * into "could not be read" — a sentence, not a crash, and not a reading.
 *
 * 🔴 The API reads a row out of JSON with an unchecked cast, so the
 * TypeScript type is a promise, not a check. This is the check.
 */
export function readAirQuality(input: unknown): AirQualityFacts | null {
  if (input === undefined || input === null) return { kind: 'none' };
  if (!isRecord(input)) return null;

  if (input.kind === 'none') return { kind: 'none' };

  if (input.kind === 'modelled') {
    const m = input.modelled;
    if (!isRecord(m)) return null;
    const hour = instant(m.hour);
    const readAt = instant(m.readAt);
    const band = level(m.band);
    if (!hour || !readAt || band === null) return null;
    return { kind: 'modelled', modelled: { hour, band, readAt } };
  }

  if (input.kind === 'station') {
    const s = input.station;
    if (!isRecord(s)) return null;
    const code = str(s.code);
    const name = str(s.name);
    const type = AIR_STATION_TYPES.find((t) => t === s.type);
    const metres = num(s.metres);
    if (!code || !name || !type || metres === null || metres < 0) return null;
    const station: AirStationFacts = {
      code,
      name,
      municipality: str(s.municipality),
      type,
      metres,
    };
    if (input.reading === null || input.reading === undefined) {
      return { kind: 'station', station, reading: null };
    }
    const reading = readReading(input.reading);
    return reading ? { kind: 'station', station, reading } : null;
  }
  return null;
}

/**
 * Whole hours between the start of the current hour and `hour`.
 * Hour-granular on purpose: the data is, and a fractional age would make
 * a reading flip to stale at an arbitrary minute.
 */
export function ageHours(hour: string, now: Date): number {
  const current = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return (current - Date.parse(hour)) / HOUR_MS;
}

/**
 * 🔴 Fresh means "not in the future, and not older than the budget". A
 * negative age is a reading from an hour that has not happened by this
 * clock — a skewed clock, or a fault — and neither can be called fresh.
 */
export function isFresh(age: number): boolean {
  return age >= 0 && age <= AIR_FRESH_FOR_HOURS;
}

/**
 * What to tell the reader. Total: every input, including garbage,
 * produces exactly one state, and none of them is "render nothing".
 */
/**
 * 🔴 CAMP-198: our own collection, judged by the rule that already
 * existed for it.
 *
 * `shouldFlagStale` with `AIR_FRESHNESS` is the hourly branch —
 * `HOURLY_DEAD_AFTER_DAYS`, one whole day. The distance from
 * `AIR_FRESH_FOR_HOURS` (four) is deliberate and is the whole point:
 * four hours without a value is a quiet station, a day without one is a
 * pipeline that has stopped, and the reader is owed the difference.
 */
const feedStalled = (readAt: string | null, now: Date): boolean =>
  readAt !== null && shouldFlagStale(AIR_FRESHNESS, readAt, now);

export function airState(input: unknown, now: Date): AirState {
  const facts = readAirQuality(input);
  if (facts === null) return { state: 'no-data', reason: 'unreadable' };

  if (facts.kind === 'none') return { state: 'no-data', reason: 'nothing-covers' };

  if (facts.kind === 'modelled') {
    const age = ageHours(facts.modelled.hour, now);
    if (!isFresh(age)) {
      return {
        state: 'no-fresh-data',
        reason: 'model-stale',
        station: null,
        lastHour: facts.modelled.hour,
        readAt: facts.modelled.readAt,
        ourFeedStalled: feedStalled(facts.modelled.readAt, now),
      };
    }
    return { state: 'modelled', ...facts.modelled, ageHours: age };
  }

  // 🔴 A station that is silent stays the answer. It does NOT hand the
  // page to the model — see airQualitySql.
  const { station, reading } = facts;
  if (!reading) {
    // 🔴 No reading means no `readAt` either, so there is nothing here
    // to judge our own collection by. `false` is therefore "we cannot
    // say", NOT "our feed is healthy" — and the sentence for this branch
    // says so in words rather than implying one of the two.
    return {
      state: 'no-fresh-data',
      reason: 'station-silent',
      station,
      lastHour: null,
      readAt: null,
      ourFeedStalled: false,
    };
  }
  const age = ageHours(reading.hour, now);
  if (!isFresh(age)) {
    return {
      state: 'no-fresh-data',
      reason: 'station-stale',
      station,
      lastHour: reading.hour,
      readAt: reading.readAt,
      ourFeedStalled: feedStalled(reading.readAt, now),
    };
  }
  return { state: reading.basis, station, reading, ageHours: age };
}

// ---------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------

export function levelLabel(band: number): string {
  return AIR_BAND_LABELS[band - 1] ?? 'Not available';
}

/** "Fair (level 2 of 6)". */
export function levelText(band: number): string {
  return `${levelLabel(band)} (level ${band} of 6)`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const two = (n: number) => String(n).padStart(2, '0');

/**
 * "17:00 UTC, 29 September 2026". Formatted by hand from the UTC fields,
 * not with `toLocale…`: the server that builds the page, the browser
 * that hydrates it and CI's runner must print the same string, and an
 * ICU or time zone difference between them is a hydration error.
 */
export function hourLabel(iso: string): string {
  const d = new Date(iso);
  return `${two(d.getUTCHours())}:00 UTC, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "29 September 2026, 19:35 UTC" — when WE read it. */
export function readAtLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** Same rule as lib/api.ts's formatDistance, kept here so a client component need not import the API client. */
export function formatKm(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export const STATION_KIND_LABEL: Record<AirStationType, string> = {
  traffic: 'traffic station',
  industrial: 'industrial station',
  background: 'background station',
};

/**
 * 🔴 The exact wording the card asks for, for a value that was reported.
 * It is NOT printed under a model: "as reported to the EEA" is false of
 * something nobody reported, and a test reads the served HTML of a
 * modelled page for its absence.
 */
export const REPORTED_WORDING = 'As reported to the EEA, not formally verified.';

export const MODELLED_STATION_WORDING =
  'The pollutants marked “modelled estimate” were not reported for this hour. ' +
  'The EEA fills the gap with a model (a Copernicus CAMS forecast, downscaled), ' +
  'so they are estimates, not readings.';

/** 🔴 What is printed under a value that no station reported at all. */
export function modelledPointWording(radiusM: number = AIR_RADIUS_M): string {
  return (
    `No monitoring station lies within ${radiusM / 1000} km of this campsite, so this is the ` +
    `EEA’s 1 km model for this spot: a forecast model downscaled from Copernicus CAMS, ` +
    `not a reading. Not formally verified.`
  );
}

export const NO_FRESH_DATA = 'No fresh data.';

export function noFreshDataSentence(s: Extract<AirState, { state: 'no-fresh-data' }>): string {
  // 🔴 Said FIRST, and in every branch that can know it. When our own
  // collection has stopped, the age of the value is a symptom and the
  // stopped collection is the fact — and a sentence about the station
  // would be describing something we have not looked at for a day.
  // 🔴 ABOUT THIS STATION'S FILE, NOT ABOUT THE FEED. Review read the
  // importer: `apps/api/src/air/import.ts` leaves `read_at` untouched
  // when ONE station's file fails to download (`action: 'keep'`), and
  // writes `read_at = now` for every station it did reach, cleared ones
  // included. So a stale `read_at` on one station is entirely compatible
  // with a healthy importer, and the first version of this clause said
  // "our collection having stopped" — a claim about every other station
  // on the site, made from one row.
  const ours = s.ourFeedStalled
    ? ` Our last read of this station’s file is over ${HOURLY_DEAD_AFTER_DAYS} ` +
      `day old, so what has stopped is our collection for it rather than the ` +
      `hour being quiet.`
    : '';

  if (s.reason === 'model-stale') {
    return (
      `Our last read of the EEA’s modelled index for this location is from ` +
      `${hourLabel(s.lastHour!)}, more than ${AIR_FRESH_FOR_HOURS} hours ago.${ours}`
    );
  }
  const st = s.station!;
  const who = `${st.name} (${STATION_KIND_LABEL[st.type]}, ${formatKm(st.metres)} away)`;
  if (s.reason === 'station-stale') {
    return (
      `The last reading we hold for the nearest station, ${who}, is from ` +
      `${hourLabel(s.lastHour!)}, more than ${AIR_FRESH_FOR_HOURS} hours ago.${ours}`
    );
  }
  // 🔴 CAMP-198: THIS SENTENCE USED TO CLAIM SOMETHING IT CANNOT KNOW.
  //
  // It read "has not reported to the EEA recently, and we hold no
  // reported hour for it" — a statement about the STATION, made from the
  // absence of a row on our side. If our own collection stopped a week
  // ago the station may have been reporting the whole time, and we would
  // have told the reader otherwise.
  //
  // 🔴 AND THE DATA TO TELL THEM APART EXISTS — WE DROP IT. Review read
  // the query: `air_quality_stations.read_at` is written for cleared
  // stations too (`import.ts`, the UPDATE that nulls every reading
  // column sets `read_at` alongside), and `apps/api/src/air/nearby.ts`
  // puts `readAt` INSIDE the `reading` object, which is null in exactly
  // this branch. So "we cannot check" is our own payload shape, not a
  // property of the source. CAMP-243 moves the field out.
  //
  // So it now says what we hold and names both explanations instead of
  // picking the one that happens to blame somebody else.
  return (
    `We hold no reported hour for the nearest station, ${who}. That can mean ` +
    `the station is quiet or that our own collection did not bring one, and ` +
    `this page cannot tell which.`
  );
}

export function noDataSentence(reason: 'nothing-covers' | 'unreadable'): string {
  return reason === 'unreadable'
    ? 'The air-quality data for this location could not be read.'
    : `No air-quality data for this location: no monitoring station lies within ${AIR_RADIUS_M / 1000} km ` +
        `and the EEA’s modelled index does not cover this spot.`;
}

/**
 * 🔴 The sentence about the pollutants that matters for smoke. A station
 * that reports neither PM2.5 nor PM10 cannot see it, and an index built
 * from NO2 alone reading "Good" says nothing about the air a wildfire
 * fills.
 */
export function noParticulatesSentence(pollutants: readonly AirPollutantReading[]): string | null {
  return pollutants.some((p) => p.pollutant === 'PM2.5' || p.pollutant === 'PM10')
    ? null
    : 'This index includes no particulate matter (PM2.5 or PM10).';
}

/** Every sentence this module can print, for the wording checks. */
export function allCopy(): string[] {
  return [
    REPORTED_WORDING,
    MODELLED_STATION_WORDING,
    modelledPointWording(),
    NO_FRESH_DATA,
    noDataSentence('nothing-covers'),
    noDataSentence('unreadable'),
    ...AIR_BAND_LABELS,
  ];
}
