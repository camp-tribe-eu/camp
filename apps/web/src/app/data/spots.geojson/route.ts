import { API_BASE, getSpotIndex } from '@/lib/api';

// CAMP-31: every campsite as one GeoJSON file the map fetches once.
//
// 🔴 Static, like the rest of the site. The whole web app runs with the
// backend switched off (CAMP-39) — the API is a build-time dependency
// only — and the map must not be the one thing that breaks that. A live
// /api/spots endpoint would put a server back into production for the
// sake of 289 points.
//
// ⚠️ This shape has a ceiling. At roughly 10,000 campsites the file
// stops being something to download in one go and the points need to
// become vector tiles of their own (CAMP-29). The map reads it through
// one function, so that change is contained.

export const dynamic = 'force-static';

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    slug: string;
    name: string | null;
    type: string;
    href: string;
  };
}

export async function GET() {
  const index = await getSpotIndex();

  const features: Feature[] = [];
  for (const entry of index) {
    const res = await fetch(
      `${API_BASE}/spots/${entry.country}/${entry.region}/${entry.slug}?nearby=0`,
    );
    if (!res.ok) continue;
    const { spot } = await res.json();
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [spot.lon, spot.lat] },
      properties: {
        slug: spot.slug,
        name: spot.name,
        type: spot.type,
        href: `/camping/${entry.country}/${entry.region}/${entry.slug}`,
      },
    });
  }

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
