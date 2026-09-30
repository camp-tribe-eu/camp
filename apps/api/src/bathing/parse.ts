// CAMP-168: one ArcGIS feature in, one storable bathing water out — or a
// named refusal.
//
// 🔴 Pure, and separate from the fetch, so every rule below is testable
// without a network and without a database. The importer's only job is
// to call this once per record and to count what it says.
//
// 🔴 ONE BAD RECORD COSTS ONE RECORD. Every refusal here is per-row and
// carries a reason the importer tallies; nothing in this file throws.

import { isEuMemberState, normaliseCountry } from '../osm/eu';
import {
  BATHING_SEASON,
  BATHING_STATUS_SOURCE_VALUES,
  type BathingStatus,
} from './source';

/** The fields of layer 3 we read. Everything else in the feature is ignored. */
export interface BathingFeatureAttributes {
  bathingWaterIdentifier?: unknown;
  bathingWaterName?: unknown;
  countryCode?: unknown;
  EU27?: unknown;
  bwWaterCategory?: unknown;
  bwProfileLink?: unknown;
  qualityStatus?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

export interface BathingWaterRecord {
  /** `bathingWaterIdentifier`, e.g. "FRP12345678". Unique in the layer. */
  ref: string;
  name: string;
  /** Lower-case ISO 3166-1 alpha-2, as eu-member-states.json spells it. */
  country: string;
  /** Coastal | Lake | River | Transitional, verbatim from the source. */
  category: string;
  season: number;
  status: BathingStatus;
  /** The national bathing water profile, or null where the source has none. */
  profileUrl: string | null;
  lat: number;
  lon: number;
}

export type BathingRejectReason =
  | 'no-ref'
  | 'no-name'
  | 'not-eu27'
  | 'unknown-country'
  | 'no-coordinates'
  | 'coordinates-out-of-range'
  | 'unknown-status';

/**
 * Where a refusal is reported.
 *
 * 🔴 A sink rather than a `{ ok, reason }` union, and the reason is this
 * package's `tsconfig`: it sets `strictNullChecks: false`, under which
 * TypeScript will not narrow a union on a boolean discriminant — so
 * `if (!result.ok) result.reason` does not compile here. The same idiom
 * as datatourisme/prices.ts, so both importers count refusals one way.
 */
export type BathingRejectSink = (reason: BathingRejectReason) => void;

/**
 * 🔴 THE SOURCE DOES NOT SPEAK ISO. Greece is `EL` here, not `GR`.
 *
 * `EL` is the Eurostat/NUTS code for Greece; ISO 3166-1 leaves it
 * unassigned and calls the country `GR`, which is what
 * eu-member-states.json holds. Ask `isEuMemberState('EL')` and the
 * answer is a perfectly confident **no**.
 *
 * Measured against the live layer on 28.09.2026: **1 734 of the 22 010
 * EU-27 bathing waters are Greek**, and every one of them would have
 * been dropped as "outside the Union" by a membership check that did not
 * translate first — silently, with no error and a coverage report that
 * still said 26 of 27 countries and looked fine at a glance.
 *
 * This is the same failure eu.ts already records for `AX` (Natural Earth
 * emitting a subdivision code for Åland): two sources, one membership
 * list, and a disagreement about what a country is. The lesson that file
 * draws is to write the alias down rather than derive it, so it is
 * written down — in eu.ts, where the list lives, as
 * `NON_ISO_COUNTRY_CODE`, and applied by `normaliseCountry` so a future
 * caller cannot forget it.
 */

/** Coordinates that cannot be on Earth, and the bounds a page can trust. */
const LAT_LIMIT = 90;
const LON_LIMIT = 180;

const STATUS_OF_SOURCE_VALUE: Readonly<Record<string, BathingStatus>> = {
  Excellent: 'excellent',
  Good: 'good',
  Sufficient: 'sufficient',
  Poor: 'poor',
  'Not classified': 'not_classified',
};

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function finite(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * A link a page may render, or null.
 *
 * 🔴 http and https only, and it is not paranoia about this source: the
 * value is free text typed by 27 national administrations and it lands
 * in an `href` on a page we serve. 9 736 of the 22 010 links are plain
 * `http://` (measured 28.09.2026) — those are kept, because a working
 * insecure link to a national authority is worth more to a reader than
 * no link, and the browser will say what it thinks of it.
 */
export function readProfileUrl(v: unknown): string | null {
  const raw = text(v);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null;
}

/** One feature in; a storable record, or null with the reason reported. */
export function parseBathingFeature(
  attrs: BathingFeatureAttributes,
  season: number = BATHING_SEASON,
  reject: BathingRejectSink = () => undefined,
): BathingWaterRecord | null {
  const refuse = (reason: BathingRejectReason) => {
    reject(reason);
    return null;
  };

  const ref = text(attrs.bathingWaterIdentifier);
  if (!ref) return refuse('no-ref');

  const name = text(attrs.bathingWaterName);
  if (!name) return refuse('no-name');

  // 🔴 The source's own EU-27 flag is read, but it does NOT decide. Our
  // scope is the owner's standing decision and it lives in one file; a
  // column in somebody else's dataset is corroboration, not authority.
  // Both are required to agree, and they do for all 22 010 rows.
  if (text(attrs.EU27) !== 'EU-27') return refuse('not-eu27');

  const country = normaliseCountry(text(attrs.countryCode));
  if (!isEuMemberState(country)) return refuse('unknown-country');

  const lat = finite(attrs.latitude);
  const lon = finite(attrs.longitude);
  if (lat === null || lon === null) return refuse('no-coordinates');
  if (Math.abs(lat) > LAT_LIMIT || Math.abs(lon) > LON_LIMIT) {
    return refuse('coordinates-out-of-range');
  }

  // 🔴 An unrecognised class is refused, never coerced to "not
  // classified". If the EEA adds a sixth value we want an import that
  // reports it, not one that quietly files it under the word this page
  // uses for "the authorities did not classify this water".
  const sourceStatus = text(attrs.qualityStatus);
  const status = sourceStatus
    ? STATUS_OF_SOURCE_VALUE[sourceStatus]
    : undefined;
  if (!status) return refuse('unknown-status');

  return {
    ref,
    name,
    country,
    category: text(attrs.bwWaterCategory) ?? 'Unknown',
    season,
    status,
    profileUrl: readProfileUrl(attrs.bwProfileLink),
    lat,
    lon,
  };
}

/** The source spellings, exported so a test can prove the map is total. */
export { BATHING_STATUS_SOURCE_VALUES, STATUS_OF_SOURCE_VALUE };
