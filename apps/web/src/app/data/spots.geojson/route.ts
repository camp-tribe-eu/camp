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

/**
 * 🔴 An explicit limit, because POINT_LIMIT is not this question.
 *
 * POINT_LIMIT (2 000) is the API's safety valve for ONE viewport, and it
 * is right for that. This route asks for the whole world, so it used to
 * inherit that cap by accident — and on 23.09.2026, when CAMP-101 took
 * the dataset from 1 079 campsites to 3 147, the build stopped with
 * "the dataset no longer fits in one download". The dataset had not
 * outgrown a download at all; it had outgrown a number meant for
 * something else.
 *
 * A sanity ceiling, not a budget: the budget below is in bytes, which is
 * the thing that actually matters to a phone on a campsite's wifi.
 */
const WHOLE_WORLD_LIMIT = 10_000;

/**
 * What we are willing to send to one reader before the map has to start
 * asking per viewport instead.
 *
 * The same shape as the search index's guard, and chosen the same way:
 * measured, then rounded. 3 147 campsites are 1.2 MB of this file
 * uncompressed and about a fifth of that over the wire, because GeoJSON
 * of repeated keys compresses extremely well. 4 MB leaves room to roughly
 * triple the dataset again before anyone has to think about it, and the
 * failure when it arrives is a red build with instructions rather than a
 * map that is quietly missing campsites.
 */
const MAX_BYTES = 4_000_000;

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
  const res = await fetch(
    `${API_BASE}/spots/map/points?bbox=${EVERYTHING}&limit=${WHOLE_WORLD_LIMIT}`,
  );
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
      `More than ${WHOLE_WORLD_LIMIT} campsites: the whole-world snapshot ` +
        'was truncated. The map must now query /spots/map/points per ' +
        'viewport instead of reading this file — the endpoint and its ' +
        'query plan are already in place.',
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

  const body = JSON.stringify({ type: 'FeatureCollection', features });

  // 🔴 The guard that matters: bytes to a reader, not rows in a table.
  // A map that takes four seconds to appear on a phone is a map nobody
  // waits for, and CAMP-39's whole promise is that this file works with
  // the backend switched off — so it has to stay small enough to ship.
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_BYTES) {
    throw new Error(
      `The map snapshot is ${(bytes / 1e6).toFixed(1)} MB, over the ` +
        `${MAX_BYTES / 1e6} MB budget. Either trim what each feature ` +
        'carries, or move the map to per-viewport queries against ' +
        '/spots/map/points.',
    );
  }
  console.log(
    `map snapshot: ${features.length} campsites, ${Math.round(bytes / 1024)} KB ` +
      `(${Math.round((100 * bytes) / MAX_BYTES)}% of the limit)`,
  );

  return new Response(
    body,
    {
      headers: {
        'Content-Type': 'application/geo+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
