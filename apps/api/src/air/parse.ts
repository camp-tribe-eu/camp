// CAMP-164: one roster row in, one storable station out — and one station
// file in, one reading out — or a named refusal.
//
// 🔴 Pure, and separate from the fetch, so every rule below is testable
// without a network and without a database. The importer's job is to call
// these once per record and to count what they say.
//
// 🔴 ONE BAD RECORD COSTS ONE RECORD. Every refusal here is per-row (or
// per-slot) and carries a reason the importer tallies; nothing in this
// file throws.

import { isEuMemberState, normaliseCountry } from '../osm/eu';
import {
  AIR_KNOWN_OUTSIDE_EU27,
  AIR_POLLUTANTS,
  AIR_STATION_TYPE_OF_SOURCE,
  type AirBasis,
  type AirPollutant,
  type AirStationType,
} from './source';

/** The fields of a roster row we read. Everything else is ignored. */
export interface RosterRow {
  code?: unknown;
  name?: unknown;
  operational?: unknown;
  lon?: unknown;
  lat?: unknown;
  station_type?: unknown;
  area_classification?: unknown;
  municipality?: unknown;
}

export interface StationRecord {
  /** The EEA's own station code, e.g. `DEBB021`. Unique in the roster. */
  code: string;
  name: string;
  municipality: string | null;
  /** Lower-case ISO 3166-1 alpha-2, as eu-member-states.json spells it. */
  country: string;
  type: AirStationType;
  /** Urban | Suburban | Rural … verbatim from the source, or null. */
  area: string | null;
  lat: number;
  lon: number;
}

export type StationRejectReason =
  | 'no-code'
  | 'malformed-code'
  /** A prefix we decided is not in the Union: AD AL BA CH GE IS ME MK NO RS TR UA XK. */
  | 'outside-eu27'
  /** 🔴 A prefix nobody has decided about. The one that must never be silent. */
  | 'unrecognised-country'
  | 'not-operational'
  | 'no-name'
  | 'unknown-station-type'
  | 'no-coordinates'
  | 'coordinates-out-of-range';

/**
 * Where a station refusal is reported. `detail` names the country prefix
 * for the two country reasons, because "3 stations refused as
 * unrecognised" is a count and "UK" is what somebody has to act on.
 */
export type StationRejectSink = (
  reason: StationRejectReason,
  detail?: string,
) => void;

const LAT_LIMIT = 90;
const LON_LIMIT = 180;

/** Two letters and then whatever the network appends. 4 643 of 4 643 match. */
const CODE_SHAPE = /^[A-Z]{2}[A-Z0-9]+$/;

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function finite(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export type CountryVerdict =
  | { verdict: 'eu27'; country: string }
  | { verdict: 'outside-eu27'; country: null }
  | { verdict: 'unrecognised'; country: null };

/**
 * 🔴 THREE outcomes, not two. A membership test says yes or no; a
 * country code the source emits can also be one we have not classified,
 * and treating that as "no" is how a country disappears with exit 0.
 *
 * The prefix goes through `normaliseCountry` first, so `EL` (Greece in
 * the Eurostat spelling, which the bathing water layer of the same
 * agency uses) is a member here exactly as it is there. This roster
 * spells Greece `GR`; nothing below depends on that.
 */
export function judgeStationCountry(prefix: string): CountryVerdict {
  const p = prefix.trim().toUpperCase();
  const country = normaliseCountry(p);
  if (isEuMemberState(country)) return { verdict: 'eu27', country };
  if (AIR_KNOWN_OUTSIDE_EU27.includes(p)) {
    return { verdict: 'outside-eu27', country: null };
  }
  return { verdict: 'unrecognised', country: null };
}

/** One roster row in; a storable EU-27 station, or null with the reason reported. */
export function parseStation(
  row: RosterRow,
  reject: StationRejectSink = () => undefined,
): StationRecord | null {
  const refuse = (reason: StationRejectReason, detail?: string) => {
    reject(reason, detail);
    return null;
  };

  const code = text(row.code);
  if (!code) return refuse('no-code');
  if (!CODE_SHAPE.test(code)) return refuse('malformed-code', code);

  // The country is the first two characters of the code: the roster has
  // no country field. Judged BEFORE anything else about the row, so an
  // unclassified prefix is reported as that even when the row is also
  // malformed in some other way.
  const prefix = code.slice(0, 2);
  const judged = judgeStationCountry(prefix);
  if (judged.verdict === 'unrecognised') {
    return refuse('unrecognised-country', prefix);
  }
  if (judged.verdict === 'outside-eu27') {
    return refuse('outside-eu27', prefix);
  }

  if (row.operational !== 1) return refuse('not-operational', code);

  const name = text(row.name);
  if (!name) return refuse('no-name', code);

  // 🔴 An unknown station kind is refused, never defaulted. The page
  // prints it beside the distance precisely because a traffic station's
  // air is not a campsite's air; a default of "background" would print
  // the comfortable answer for a kind we have not seen.
  const typeName = text(row.station_type);
  const type = typeName ? AIR_STATION_TYPE_OF_SOURCE[typeName] : undefined;
  if (!type) return refuse('unknown-station-type', typeName ?? '');

  const lat = finite(row.lat);
  const lon = finite(row.lon);
  if (lat === null || lon === null) return refuse('no-coordinates', code);
  if (Math.abs(lat) > LAT_LIMIT || Math.abs(lon) > LON_LIMIT) {
    return refuse('coordinates-out-of-range', code);
  }

  return {
    code,
    name,
    municipality: text(row.municipality),
    country: judged.country,
    type,
    area: text(row.area_classification),
    lat,
    lon,
  };
}

// ---------------------------------------------------------------------
// One station's hourly file → the reading a page may show.
// ---------------------------------------------------------------------

export interface PollutantReading {
  pollutant: AirPollutant;
  /** Index level 1–6 of this pollutant alone. */
  band: number;
  /** µg/m³, as published. */
  value: number;
  /** 🔴 True where the value is a gap-filled model estimate, not a report. */
  modelled: boolean;
}

export interface StationReading {
  /** The hour the reading describes, ISO 8601 UTC. */
  hour: string;
  /** The fractional index as published (2.2857 is level 2). */
  index: number;
  /** Index level 1–6: the whole part of `index`. */
  band: number;
  basis: AirBasis;
  /** The pollutant that sets the index. */
  culprit: AirPollutant;
  pollutants: PollutantReading[];
}

export interface PickResult {
  reading: StationReading | null;
  /** Slots that were present but not in a shape we can read. */
  malformedSlots: number;
}

const HOUR_MS = 3_600_000;

/** Start of the hour `now` falls in, epoch ms. */
export function hourStart(now: Date): number {
  return Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
}

/** The two indices agree to the ten decimals the source prints. */
const SAME_INDEX = 1e-6;

type Slot =
  | { kind: 'no-data' }
  | { kind: 'malformed' }
  | {
      kind: 'value';
      index: number;
      band: number;
      culprit: AirPollutant;
      pollutants: PollutantReading[];
    };

function flag(v: unknown): boolean | null {
  if (v === 0 || v === false) return false;
  if (v === 1 || v === true) return true;
  return null;
}

/**
 * One slot of the per-station file, read as strictly as the page will
 * trust it.
 *
 * 🔴 `aqi: 0` is NO DATA, not the best air there is. ES2100A's newest
 * slot is `{"aqi": 0.0, "aqi_SO2": 0.0, "val_SO2": null, …}`; a reader
 * that took the number at its word would print a level below "Good".
 * The same goes for a pollutant whose own index is 0.
 *
 * 🔴 A pollutant counts only where the source gave it an index above
 * zero. `modelled_SO2: 1` sits beside `aqi_SO2: 0.0` and `val_SO2: null`
 * in half the files: the flag defaults to 1 when there is nothing to
 * flag, so counting it would make every such station look partly modelled
 * over a pollutant that was never there.
 *
 * 🔴 The headline index must be its culprit's own index. That holds in
 * 74 649 of 74 649 slots read on 29.09.2026 (255 files), so a slot where
 * it does not is not a slightly odd reading, it is a file we have
 * misunderstood — and it is skipped rather than shown.
 */
function readSlot(v: unknown): Slot {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { kind: 'malformed' };
  }
  const slot = v as Record<string, unknown>;

  const index = finite(slot.aqi);
  if (index === null) return { kind: 'malformed' };
  if (index <= 0) return { kind: 'no-data' };

  const pollutants: PollutantReading[] = [];
  for (const pollutant of AIR_POLLUTANTS) {
    const raw = slot[`aqi_${pollutant}`];
    if (raw === undefined || raw === null) continue;
    const own = finite(raw);
    if (own === null) return { kind: 'malformed' };
    if (own <= 0) continue;

    const value = finite(slot[`val_${pollutant}`]);
    const modelled = flag(slot[`modelled_${pollutant}`]);
    const band = Math.floor(own);
    if (value === null || modelled === null || band < 1 || band > 6) {
      return { kind: 'malformed' };
    }
    pollutants.push({ pollutant, band, value, modelled });
  }
  if (pollutants.length === 0) return { kind: 'malformed' };

  const culprit = pollutants.find(
    (p) => p.pollutant === slot.culprit,
  )?.pollutant;
  if (!culprit) return { kind: 'malformed' };

  const worst = Math.max(
    ...pollutants.map((p) => finite(slot[`aqi_${p.pollutant}`]) as number),
  );
  const culpritIndex = finite(slot[`aqi_${culprit}`]) as number;
  if (
    Math.abs(worst - index) > SAME_INDEX ||
    Math.abs(culpritIndex - index) > SAME_INDEX
  ) {
    return { kind: 'malformed' };
  }

  const band = Math.floor(index);
  if (band < 1 || band > 6) return { kind: 'malformed' };
  return { kind: 'value', index, band, culprit, pollutants };
}

function sortedSlots(
  file: unknown,
  before: number,
): { t: number; v: unknown; keyOk: boolean }[] {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return [];
  return Object.entries(file as Record<string, unknown>)
    .map(([k, v]) => ({ t: Date.parse(k), v }))
    .map((s) => ({ ...s, keyOk: Number.isFinite(s.t) }))
    .filter((s) => !s.keyOk || s.t < before)
    .sort((a, b) => b.t - a.t);
}

/**
 * The newest hour in which the station REPORTED something, or null.
 *
 * 🔴 READS BACK PAST THE NEWEST HOURS, and that is the whole design. The
 * slot of the current hour is fully gap-filled in every file (240 of 240
 * sampled): nobody has reported an hour that has not finished. Taking the
 * newest slot would file a model output under a station's name and let a
 * page say "as reported to the EEA" over it. So slots are read newest
 * first and the first one in which at least one contributing pollutant
 * was reported wins; the ones above it are simply not readings.
 *
 * 🔴 Strictly BEFORE the current hour. A slot at or after it is the hour
 * in progress or a forecast (39 slots ahead in every live file, all
 * fully modelled) — never an observation, whatever its flags claim.
 *
 * What comes back is a fact about the past. Whether it is fresh enough
 * to show is decided where it is shown (`AIR_FRESH_FOR_HOURS`), against
 * the reader's clock, because a static page outlives the import.
 */
export function pickStationReading(file: unknown, now: Date): PickResult {
  const limit = hourStart(now);
  let malformedSlots = 0;

  for (const { t, v, keyOk } of sortedSlots(file, limit)) {
    if (!keyOk) {
      malformedSlots += 1;
      continue;
    }
    const slot = readSlot(v);
    if (slot.kind === 'malformed') {
      malformedSlots += 1;
      continue;
    }
    if (slot.kind === 'no-data') continue;

    const modelledCount = slot.pollutants.filter((p) => p.modelled).length;
    // Every contributing pollutant gap-filled: a model output, not a
    // reading. Skipped, not stored, and not counted as malformed.
    if (modelledCount === slot.pollutants.length) continue;

    return {
      reading: {
        hour: new Date(t).toISOString(),
        index: slot.index,
        band: slot.band,
        basis: modelledCount === 0 ? 'reported' : 'mixed',
        culprit: slot.culprit,
        pollutants: slot.pollutants,
      },
      malformedSlots,
    };
  }
  return { reading: null, malformedSlots };
}

/**
 * What the newest slot before `before` is, for the lag report only:
 * `modelled` where every contributor is gap-filled. Not used by the
 * import.
 */
export function newestSlotBasis(
  file: unknown,
  before: number,
): AirBasis | 'modelled' | null {
  for (const { v, keyOk } of sortedSlots(file, before)) {
    if (!keyOk) continue;
    const slot = readSlot(v);
    if (slot.kind !== 'value') continue;
    const n = slot.pollutants.filter((p) => p.modelled).length;
    if (n === slot.pollutants.length) return 'modelled';
    return n === 0 ? 'reported' : 'mixed';
  }
  return null;
}
