// CAMP-35 / CAMP-25: filtering the map, in the browser.
//
// 🔴 Why this is client-side at all. The map reads one static GeoJSON
// file (app/data/spots.geojson) because the whole site runs with the API
// switched off. Filtering therefore has to happen over the features we
// already hold — which is also the better experience: a tick-box that
// answers in a frame instead of a round trip.
//
// 🔴 Why it re-sets the source data rather than calling setFilter.
// MapLibre clusters in a worker when the SOURCE loads, so a layer filter
// hides rendered circles without re-counting them: a cluster would say
// twelve and open to three. Feeding the source a filtered collection
// makes it cluster the right set. That bug is invisible until somebody
// clicks, which is exactly the kind CAMP-35 warns about.
//
// 🔴 This is a second copy of a rule the API also holds, in SQL
// (apps/api/src/spots/filters.ts). That is a real duplication and it is
// accepted for one reason — the two run in different languages on
// different sides of a build — but it is not left on trust: the e2e test
// asks the API for the same filter and compares its count against what
// the map drew.

import { AMENITY_KEYS } from './api';
import type { Amenities, AmenityKey, SpotType } from './api';
import type { OvernightStatus } from './overnight';

export interface MapFilterState {
  /** Empty means every type, not no types. */
  types: SpotType[];
  amenities: AmenityKey[];
  /**
   * The reader has seen how many are unknown and asked to include them.
   *
   * 🔴 About AMENITIES only. It never reaches `overnight` below.
   */
  includeUnknown: boolean;
  /**
   * CAMP-255: only places whose overnight stay is CONFIRMED allowed.
   *
   * 🔴 STRICT, in `matchesStrict` and in `matchesLenient` alike, and there
   * is deliberately no "include the unknown" for it. An amenity filter
   * can offer the places nobody recorded, because a shower we cannot
   * confirm costs the reader a detour. A pin that appears under
   * "allowed" is READ as allowed, so a place we know nothing about must
   * never be drawn there. The reader is told how many are unknown
   * instead (`overnightTally`), which is what the card asks for: the
   * honest number beside the filter, not a quiet padding of it.
   */
  overnight: boolean;
}

export const EMPTY_FILTERS: MapFilterState = {
  types: [],
  amenities: [],
  includeUnknown: false,
  overnight: false,
};

/**
 * How a chunk file writes the overnight answer: one letter, and ONLY for a
 * known one. Absent means unknown — the convention the amenities already
 * use, and for the same reason: 97% of campsites would otherwise spend
 * bytes saying "we do not know" (BYTES_PER_CAMPSITE is a measured budget).
 */
export const OVERNIGHT_CODE = { allowed: 'y', forbidden: 'n' } as const;

/** A marker's status → the chunk's property, or undefined for unknown. */
export function knownOvernight(
  status: OvernightStatus | null | undefined,
): 'y' | 'n' | undefined {
  if (status === 'allowed') return OVERNIGHT_CODE.allowed;
  if (status === 'forbidden') return OVERNIGHT_CODE.forbidden;
  return undefined;
}

/**
 * A chunk feature's property → its status.
 *
 * 🔴 Anything that is not exactly `y` or `n` is `unknown` — a feature
 * from a chunk built before this existed, a typo, a future code. The
 * fallback is the cautious one and the only place it is decided.
 */
export function overnightOf(props: SpotProperties): OvernightStatus {
  if (props.o === OVERNIGHT_CODE.allowed) return 'allowed';
  if (props.o === OVERNIGHT_CODE.forbidden) return 'forbidden';
  return 'unknown';
}

/** Flat properties, as the GeoJSON route writes them. */
export type SpotProperties = Record<string, unknown>;

export function isFiltering(state: MapFilterState): boolean {
  return state.types.length > 0 || state.amenities.length > 0 || state.overnight;
}

/**
 * CAMP-107: the amenities worth writing into the map snapshot.
 *
 * 🔴 Only what is KNOWN. An absent key means unknown, which is exactly
 * what the two matchers below already assume.
 *
 * Writing "unknown" out explicitly cost 2.26 MB of a 4.9 MB file:
 * measured on 24.09.2026, 103 582 of the 105 190 amenity values across
 * 10 519 campsites were the string "unknown", and 96% of campsites had
 * nothing recorded at all. More than half the map snapshot was the
 * words "we do not know", repeated.
 *
 * It lives here rather than in the route because a Next.js route file
 * may export only a route, and because it belongs beside the functions
 * that read what it writes.
 */
export function knownAmenities(
  amenities: Partial<Amenities> | null | undefined,
): Partial<Record<AmenityKey, 'yes' | 'no'>> {
  const out: Partial<Record<AmenityKey, 'yes' | 'no'>> = {};
  for (const key of AMENITY_KEYS) {
    const value = amenities?.[key];
    if (value === 'yes' || value === 'no') out[key] = value;
  }
  return out;
}

function overnightMatches(
  props: SpotProperties,
  state: MapFilterState,
): boolean {
  return !state.overnight || overnightOf(props) === 'allowed';
}

function typeMatches(props: SpotProperties, state: MapFilterState): boolean {
  if (state.types.length === 0) return true;
  return state.types.includes(props.type as SpotType);
}

/**
 * Strict: every requested amenity is a definite yes.
 *
 * Mirrors `amenities ->> key = 'yes'` on the server.
 */
export function matchesStrict(
  props: SpotProperties,
  state: MapFilterState,
): boolean {
  if (!typeMatches(props, state)) return false;
  if (!overnightMatches(props, state)) return false;
  return state.amenities.every((k) => props[k] === 'yes');
}

/**
 * Lenient: no requested amenity is a definite no.
 *
 * Mirrors `amenities ->> key IS DISTINCT FROM 'no'` — including for a
 * property that is absent entirely, which is how a campsite imported
 * before an amenity existed appears. `undefined !== 'no'` keeps it in,
 * which is the right answer: we do not know, and not knowing is not a no.
 */
export function matchesLenient(
  props: SpotProperties,
  state: MapFilterState,
): boolean {
  if (!typeMatches(props, state)) return false;
  // 🔴 The overnight condition is NOT loosened here — see `overnight` on
  // MapFilterState. Only the amenity half of this question is lenient.
  if (!overnightMatches(props, state)) return false;
  return state.amenities.every((k) => props[k] !== 'no');
}

export interface FilterOutcome<F> {
  /** What the map should draw. */
  shown: F[];
  /**
   * How many fell out only because nobody recorded the amenity.
   *
   * 🔴 The number CAMP-35 is really about. Measured on our data,
   * filtering for toilets shows 243 campsites and this says 820 — and
   * without saying so the map would be claiming, silently, that three
   * quarters of Croatia has no toilet.
   */
  unknownExcluded: number;
}

export function applyFilters<F extends { properties: SpotProperties }>(
  features: F[],
  state: MapFilterState,
): FilterOutcome<F> {
  if (!isFiltering(state)) {
    return { shown: features, unknownExcluded: 0 };
  }

  const shown: F[] = [];
  let lenientOnly = 0;

  for (const f of features) {
    const strict = matchesStrict(f.properties, state);
    if (strict) {
      shown.push(f);
      continue;
    }
    if (matchesLenient(f.properties, state)) {
      lenientOnly++;
      if (state.includeUnknown) shown.push(f);
    }
  }

  // Once they are being drawn they are not being excluded. Reporting them
  // anyway would leave "…and 820 more" sitting under a map that is
  // already showing all 820.
  return {
    shown,
    unknownExcluded: state.includeUnknown ? 0 : lenientOnly,
  };
}

// ---------------------------------------------------------------------------
// CAMP-255: the number beside the overnight filter
// ---------------------------------------------------------------------------

export interface OvernightTally {
  allowed: number;
  forbidden: number;
  unknown: number;
}

/**
 * Confirmed against not-known, over what the reader is looking at.
 *
 * 🔴 Over the features that pass every OTHER filter (type, amenities,
 * exactly as `applyFilters` applies them) and partitioned by overnight
 * status — so ticking "Wild camping" and then the overnight filter says
 * how many WILD places are confirmed and how many are not known, not how
 * many in all of Europe. It is the same set the markers are drawn from,
 * which is what lets a reader count the pins and check the sentence.
 *
 * The three always add up to the set; `unknown` is the remainder by
 * construction, never counted from a property that could disagree.
 */
export function overnightTally<F extends { properties: SpotProperties }>(
  features: F[],
  state: MapFilterState,
): OvernightTally {
  const rest = applyFilters(features, { ...state, overnight: false }).shown;
  const tally: OvernightTally = { allowed: 0, forbidden: 0, unknown: 0 };
  for (const f of rest) tally[overnightOf(f.properties)]++;
  return tally;
}

// ---------------------------------------------------------------------------
// The query string — so a filtered map is a link somebody can send
// ---------------------------------------------------------------------------

/**
 * 🔴 Same parameter names as the API takes, so the two are one contract
 * rather than two vocabularies that drift. A reader can paste the map's
 * query string onto /spots/map/points and get the matching answer.
 */
export function toSearchParams(state: MapFilterState): string {
  const p = new URLSearchParams();
  if (state.types.length) p.set('types', state.types.join(','));
  if (state.amenities.length) p.set('amenities', state.amenities.join(','));
  if (state.includeUnknown) p.set('unknown', '1');
  // Same name and same single word as the API takes (`overnight=allowed`),
  // so the map's query string pastes onto /spots/map/points unchanged.
  if (state.overnight) p.set('overnight', 'allowed');
  return p.toString();
}

export function fromSearchParams(
  search: string,
  knownTypes: readonly string[],
  knownAmenities: readonly string[],
): MapFilterState {
  const p = new URLSearchParams(search);
  const pick = (raw: string | null, allowed: readonly string[]): string[] => {
    if (!raw) return [];
    const out: string[] = [];
    for (const part of raw.split(',')) {
      const v = part.trim();
      // Unknown values are dropped rather than rejected: a link shared
      // before an amenity was renamed should still open the map.
      if (allowed.includes(v) && !out.includes(v)) out.push(v);
    }
    return out;
  };
  return {
    types: pick(p.get('types'), knownTypes) as SpotType[],
    amenities: pick(p.get('amenities'), knownAmenities) as AmenityKey[],
    includeUnknown: p.get('unknown') === '1',
    overnight: p.get('overnight') === 'allowed',
  };
}

/** Toggle one value in a list, keeping the declared order stable. */
export function toggle<T>(list: T[], value: T, order: readonly T[]): T[] {
  const next = list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
  return order.filter((v) => next.includes(v));
}
