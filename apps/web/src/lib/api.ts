// CAMP-34: the one place that knows where the API lives.
//
// The API runs on our VPS, the site on Cloudflare Pages, so this is a real
// cross-origin call and the base URL differs per environment. Hard-coding
// it in pages would mean finding every call site the day the host changes.

import type { SpotSource } from './sources';

export type { SpotSource };

export const API_BASE =
  process.env.API_BASE_URL ?? 'http://localhost:3001';

export type AmenityValue = 'yes' | 'no' | 'unknown';

export interface Amenities {
  electricity: AmenityValue;
  water: AmenityValue;
  shower: AmenityValue;
  toilets: AmenityValue;
  dogFriendly: AmenityValue;
  wifi: AmenityValue;
  greyWater: AmenityValue;
  laundry: AmenityValue;
  /** Any level of wheelchair access, including `limited`. */
  wheelchair: AmenityValue;
  /** Step-free access only — `limited` is a no here. See ACCESSIBILITY_KEYS. */
  wheelchairFull: AmenityValue;
}

export type AmenityKey = keyof Amenities;

/**
 * 🔴 One list, in one place, in the order a reader reads them.
 *
 * Adding `toilets` meant finding five separate hard-coded copies of the
 * same five keys — in the JSON-LD, the region cards, the campsite page,
 * the map popup and the GeoJSON route — and being sure none was missed.
 * Grep found them, but grep is not a guarantee, and the failure mode is
 * an amenity that exists in the data and is invisible on one surface
 * with nothing to indicate it.
 *
 * The next one is a line here.
 */
export const AMENITY_KEYS: AmenityKey[] = [
  'electricity',
  'water',
  'shower',
  // Sanitary facilities together: a reader checking for one is checking
  // for the other.
  'toilets',
  'greyWater',
  'laundry',
  'dogFriendly',
  'wifi',
  // 🔴 Last in this list but shown in their own group — see
  // ACCESSIBILITY_KEYS. They belong here so nothing that walks every
  // amenity (the GeoJSON route, the campsite page) can miss them.
  'wheelchair',
  'wheelchairFull',
];

/**
 * CAMP-25: accessibility is its own group on every surface.
 *
 * 🔴 Not a style choice. Someone scanning for a shower and someone who
 * cannot climb a step are not doing the same thing, and the second is the
 * one competitors leave out — which is the whole reason the card exists.
 * Burying it as tick-box nine of eleven is how it gets missed.
 */
export const ACCESSIBILITY_KEYS: AmenityKey[] = ['wheelchair', 'wheelchairFull'];

/** Everything that is not accessibility, in reading order. */
export const GENERAL_AMENITY_KEYS: AmenityKey[] = AMENITY_KEYS.filter(
  (k) => !ACCESSIBILITY_KEYS.includes(k),
);

/** Full labels — the campsite page and the structured data. */
export const AMENITY_LABEL: Record<AmenityKey, string> = {
  electricity: 'Electricity',
  water: 'Drinking water',
  shower: 'Showers',
  toilets: 'Toilets',
  greyWater: 'Grey-water disposal',
  laundry: 'Laundry',
  dogFriendly: 'Dogs allowed',
  wifi: 'Wi-Fi',
  // 🔴 The wording carries the distinction the data makes. "Wheelchair
  // access" alone would read as step-free to the person who needs it,
  // and 43 of our 87 answered sites are tagged `limited` — so saying it
  // plainly is the difference between a useful filter and a wasted trip.
  wheelchair: 'Wheelchair access, incl. limited',
  wheelchairFull: 'Step-free wheelchair access',
};

/** Short labels — the chips on listing cards, where space is the constraint. */
export const AMENITY_LABEL_SHORT: Record<AmenityKey, string> = {
  electricity: 'Electricity',
  water: 'Water',
  shower: 'Showers',
  toilets: 'Toilets',
  greyWater: 'Grey water',
  laundry: 'Laundry',
  dogFriendly: 'Dogs',
  wifi: 'Wi-Fi',
  // 🔴 Short, but the distinction survives. "Wheelchair" alone reads as
  // step-free to the person who needs it, and 43 of our 87 answered
  // campsites are tagged `limited` — so the qualifier stays even here,
  // where space is the constraint.
  wheelchair: 'Wheelchair, incl. limited',
  wheelchairFull: 'Step-free',
};

/** The campsite types a reader can filter by, in the card's order. */
export const SPOT_TYPES = ['free', 'paid', 'camper_stop', 'rv_park', 'wild'] as const;
export type SpotType = (typeof SPOT_TYPES)[number];

/**
 * Short labels — the filter chips. `SPOT_TYPE_LABEL` further down is the
 * prose form ("Free campsite", "Wild camping spot") that a sentence on a
 * page needs; a chip has one line and says the distinguishing word.
 */
export const SPOT_TYPE_LABEL_SHORT: Record<SpotType, string> = {
  free: 'Free',
  paid: 'Paid',
  camper_stop: 'Camper stop',
  rv_park: 'RV park',
  wild: 'Wild camping',
};

// CAMP-33: the computed surroundings. Mirrors apps/api/src/osm/spot-context.ts.
export type WaterKind = 'sea' | 'lake' | 'reservoir' | 'river';
export type TerrainType = 'flat' | 'rolling' | 'hilly' | 'mountainous';

export interface NearestFeature {
  m: number;
  name?: string;
}

export interface SpotContext {
  water?: NearestFeature & { kind: WaterKind };
  town?: NearestFeature;
  supermarket?: NearestFeature;
  station?: NearestFeature;
  elevation?: number;
  terrain?: { relief: number; type: TerrainType };
  at?: { lat: number; lon: number };
}

/** 98 → "98 m"; 2616 → "2.6 km". Never rounded in the flattering direction. */
export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export const WATER_LABEL: Record<WaterKind, string> = {
  sea: 'Sea',
  lake: 'Lake',
  reservoir: 'Reservoir',
  river: 'River',
};

export const TERRAIN_LABEL: Record<TerrainType, string> = {
  flat: 'Flat',
  rolling: 'Rolling',
  hilly: 'Hilly',
  mountainous: 'Mountainous',
};

export interface Spot {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: 'free' | 'paid' | 'wild' | 'camper_stop' | 'rv_park';
  lat: number;
  lon: number;
  amenities: Amenities;
  ownerOverrides: Record<string, unknown>;
  lastSeenAt: string | null;
  missingSince: string | null;
  /**
   * CAMP-105: false when this page carries nothing but a name and a
   * point. Decided by the API in SQL, so the page and the sitemap cannot
   * disagree. Defaults to true if an older API omits it — a page that
   * ranks when it should not is visible; one that quietly vanishes is not.
   */
  indexable?: boolean;
  context: SpotContext;
  /**
   * CAMP-101. The operator's own words, in their own language — carried
   * verbatim and rendered with `lang`. We never translate them: a machine
   * translation of somebody's description, published as if it were
   * theirs, is invention.
   */
  description: string | null;
  descriptionLang: string | null;
  /** Official national classification, 1–5, where a source publishes one. */
  stars: number | null;
  website: string | null;
  /** Which source gave which field, and when it last changed it. */
  sources: SpotSource[];
}

export interface NearbySpot {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: Spot['type'];
  metres: number;
}

export interface SpotIndexEntry {
  country: string;
  region: string;
  slug: string;
  lastSeenAt: string | null;
  /** When the page's content last actually changed — the sitemap's lastmod. */
  contentChangedAt: string | null;
  /**
   * CAMP-105: false when the page carries nothing but a name and a point.
   *
   * Decided by the API in SQL, never recomputed here — the sitemap asks
   * this about ten thousand pages and the page asks it about one, and two
   * implementations of one rule drift.
   */
  indexable: boolean;
}

/** Null rather than throw: a missing campsite is a 404, not a broken build. */
export async function getSpot(
  country: string,
  region: string,
  slug: string,
): Promise<{ spot: Spot; nearby: NearbySpot[] } | null> {
  const res = await fetch(
    `${API_BASE}/spots/${encodeURIComponent(country)}/${encodeURIComponent(
      region,
    )}/${encodeURIComponent(slug)}`,
    // Campsite data changes at most once a week (CAMP-28), so revalidating
    // daily is already far more often than the data moves.
    { next: { revalidate: 86400 } },
  );
  if (!res.ok) return null;
  return res.json();
}

export async function getSpotIndex(): Promise<SpotIndexEntry[]> {
  const res = await fetch(`${API_BASE}/spots/index`, {
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];
  return res.json();
}

// ── CAMP-71: hubs ────────────────────────────────────────────────────────

export interface CountrySummary {
  country: string;
  spots: number;
  regions: number;
}

export interface RegionSummary {
  region: string;
  slug: string;
  spots: number;
  /** False below the threshold — the page exists but carries `noindex`. */
  indexable: boolean;
}

export interface SpotCard {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: Spot['type'];
  amenities: Amenities;
}

export async function getCountries(): Promise<CountrySummary[]> {
  const res = await fetch(`${API_BASE}/spots/countries`, {
    next: { revalidate: 86400 },
  });
  return res.ok ? res.json() : [];
}

export async function getRegions(country: string): Promise<RegionSummary[]> {
  const res = await fetch(
    `${API_BASE}/spots/${encodeURIComponent(country)}/regions`,
    { next: { revalidate: 86400 } },
  );
  return res.ok ? res.json() : [];
}

export async function getRegionSpots(
  country: string,
  region: string,
  page = 1,
): Promise<{ region: string | null; total: number; items: SpotCard[] }> {
  const res = await fetch(
    `${API_BASE}/spots/${encodeURIComponent(country)}/${encodeURIComponent(
      region,
    )}?page=${page}`,
    { next: { revalidate: 86400 } },
  );
  if (!res.ok) return { region: null, total: 0, items: [] };
  return res.json();
}

export const REGION_PER_PAGE = 24;

// ── CAMP-41: the home page ───────────────────────────────────────────────

export interface SiteSummary {
  spots: number;
  countries: number;
  regions: number;
}

/** Real totals. The home page never rounds these up into a promise. */
export async function getSummary(): Promise<SiteSummary> {
  const res = await fetch(`${API_BASE}/spots/summary`, {
    next: { revalidate: 86400 },
  });
  return res.ok ? res.json() : { spots: 0, countries: 0, regions: 0 };
}

/** The campsites we know most about — see the API for the ranking rule. */
export async function getNotable(): Promise<(SpotCard & {
  context?: SpotContext;
})[]> {
  const res = await fetch(`${API_BASE}/spots/notable`, {
    next: { revalidate: 86400 },
  });
  return res.ok ? res.json() : [];
}

/**
 * "SI" → "Slovenia". Intl ships the list with the runtime, so this needs no
 * table of our own and no translation file — and it will follow the site's
 * language once i18n lands (CAMP-40).
 */
export function countryName(code: string, locale = 'en'): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: 'region' }).of(
        code.toUpperCase(),
      ) ?? code.toUpperCase()
    );
  } catch {
    return code.toUpperCase();
  }
}

/** Owner corrections win over OSM at read time (CAMP-86). */
export function withOwnerOverrides(spot: Spot): Spot {
  const o = spot.ownerOverrides ?? {};
  if (!Object.keys(o).length) return spot;
  return {
    ...spot,
    ...(typeof o.name === 'string' ? { name: o.name } : {}),
    amenities: { ...spot.amenities, ...((o.amenities as Partial<Amenities>) ?? {}) },
  };
}

export const SPOT_TYPE_LABEL: Record<Spot['type'], string> = {
  paid: 'Campsite',
  free: 'Free campsite',
  wild: 'Wild camping spot',
  camper_stop: 'Camper stop',
  rv_park: 'Motorhome park',
};

// CAMP-73 — the campsites that are gone, and where to send their traffic.

export interface GoneSpot {
  /** The URL that must now answer 410. */
  path: string;
  name: string | null;
  missingSince: string;
  nearest: { path: string; name: string | null; metres: number } | null;
}

// 🔴 No getGone() here on purpose. The gone list is read from the file
// scripts/gen-gone.mjs writes, because the middleware reads that same
// file — and when the page fetched its own copy instead, Next's fetch
// cache handed it a stale one and the two disagreed about which
// campsites were gone. A second way to obtain the same data is what
// caused that, so there is now only one.

/**
 * Every country and region we hold, for the recovery offered on a 404.
 *
 * 🔴 Fetched once and embedded in the page rather than queried when
 * someone lands on a dead URL. A 404 page that needs the API to be up is
 * a 404 page that is broken exactly when things are going wrong.
 */
export interface Place {
  country: string;
  name: string;
  regions: { slug: string; name: string; spots: number }[];
}

export async function getPlaces(): Promise<Place[]> {
  const countries = await getCountries();
  return Promise.all(
    countries.map(async (c) => ({
      country: c.country,
      name: countryName(c.country),
      regions: (await getRegions(c.country)).map((r) => ({
        slug: r.slug,
        name: r.region,
        spots: r.spots,
      })),
    })),
  );
}
