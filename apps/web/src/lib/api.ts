// CAMP-34: the one place that knows where the API lives.
//
// The API runs on our VPS, the site on Cloudflare Pages, so this is a real
// cross-origin call and the base URL differs per environment. Hard-coding
// it in pages would mean finding every call site the day the host changes.

export const API_BASE =
  process.env.API_BASE_URL ?? 'http://localhost:3001';

export type AmenityValue = 'yes' | 'no' | 'unknown';

export interface Amenities {
  electricity: AmenityValue;
  water: AmenityValue;
  shower: AmenityValue;
  dogFriendly: AmenityValue;
  wifi: AmenityValue;
}

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
  context: SpotContext;
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
