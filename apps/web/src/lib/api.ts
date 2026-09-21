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
