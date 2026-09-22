import { AMENITY_KEYS, API_BASE } from '@/lib/api';
import type { Amenities, AmenityKey } from '@/lib/api';

// CAMP-31/32: every campsite as one GeoJSON file the map fetches once.
//
// 🔴 Static, like the rest of the site. The whole web app runs with the
// backend switched off (CAMP-39) — the API is a build-time dependency
// only — and the map must not be the one thing that breaks that. Putting
// a live endpoint behind the map would also mean a CORS allowlist and a
// publicly reachable API, which is the opposite of what we want while
// the site is still closed.
//
// 🔴 CAMP-32 built the viewport query the card asks for — bbox, GiST
// index, plan verified at 55 000 rows — and this file is now produced BY
// that query, with the whole world as the viewport. So there is one
// query, not two: the day the dataset outgrows a single download, the
// map calls the same endpoint from the browser per viewport instead of
// reading this file, and nothing else changes.
//
// That day is detected here rather than guessed at. The endpoint caps
// its answer and says when it was capped; a capped answer means this
// snapshot is no longer the whole dataset, and the build stops.

export const dynamic = 'force-static';

/** The whole world. The API rejects anything wider. */
const EVERYTHING = '-180,-85,180,85';

interface Marker {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: string;
  lat: number;
  lon: number;
  amenities: Amenities;
  /** Built by the API, from the same function the pages use. */
  path: string;
}

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  // 🔴 Amenities are flattened, one string property per amenity, and the
  // keys come from AMENITY_KEYS rather than being written out here.
  // MapLibre's cluster leaves and feature-state expressions work with
  // flat properties, and a nested object reaches the click handler as a
  // JSON string in some browsers and an object in others — flat removes
  // the question. Listing the keys a second time is how an amenity ends
  // up in the data and missing on the map.
  properties: {
    slug: string;
    name: string | null;
    type: string;
    href: string;
  } & Record<AmenityKey, string>;
}

export async function GET() {
  const res = await fetch(`${API_BASE}/spots/map/points?bbox=${EVERYTHING}`);
  if (!res.ok) {
    throw new Error(`Map points request failed: ${res.status}`);
  }
  const { markers, truncated } = (await res.json()) as {
    markers: Marker[];
    truncated: boolean;
  };

  if (truncated) {
    // Not a warning. A truncated snapshot renders a map that is missing
    // campsites with no sign that anything is wrong, which is the worst
    // possible way to find out we outgrew this design.
    throw new Error(
      'The campsite dataset no longer fits in one download. The map must ' +
        'now query /spots/map/points per viewport instead of reading this ' +
        'file — the endpoint and its query plan are already in place.',
    );
  }

  const features: Feature[] = markers.map((m) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    properties: {
      slug: m.slug,
      name: m.name,
      type: m.type,
      href: m.path,
      ...(Object.fromEntries(
        AMENITY_KEYS.map((k) => [k, m.amenities?.[k] ?? 'unknown']),
      ) as Record<AmenityKey, string>),
    },
  }));

  return new Response(
    JSON.stringify({ type: 'FeatureCollection', features }),
    {
      headers: {
        'Content-Type': 'application/geo+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
