import { apiFetch } from '@/lib/api';
import type { Amenities, AmenityKey } from '@/lib/api';
import { knownAmenities } from '@/lib/map-filter';
import type { RegionSummary } from '@/lib/map-chunks';

// CAMP-127: one region of the map, as its own file.
//
// 🔴 Cut by REGION, not by bounding box. Neighbouring regions overlap at
// their corners, so bbox chunks would hand the map the same campsite
// twice and make every count it shows wrong — including the cluster
// counts, which is the bug CAMP-35 already spent a day on from the other
// direction.
//
// Measured 24.09.2026: 812 chunks, the largest 1 433 campsites and the
// median 26, covering all 61 557 — including the 135 that carry no region
// at all, which get one chunk per country rather than disappearing.

export const dynamic = 'force-static';
export const dynamicParams = false;

interface Marker {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: string;
  lat: number;
  lon: number;
  amenities: Amenities;
  /** 🔴 Null when the campsite has no page — see canonicalPath. */
  path: string | null;
}

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    slug: string;
    name: string | null;
    type: string;
    /** Null rather than a broken URL. The popup renders text instead. */
    href: string | null;
  } & Partial<Record<AmenityKey, 'yes' | 'no'>>;
}

export async function generateStaticParams() {
  const res = await apiFetch('/spots/map/regions');
  if (!res.ok) {
    throw new Error(`Region index request failed: ${res.status}`);
  }
  const regions = (await res.json()) as RegionSummary[];
  if (regions.length === 0) {
    throw new Error('No regions to build map chunks from.');
  }
  return regions.map((r) => ({
    country: r.country.toLowerCase(),
    // The extension lives in the parameter so the built file keeps it —
    // a static host decides the content type from the name.
    chunk: `${r.slug}.geojson`,
  }));
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ country: string; chunk: string }> },
) {
  const { country, chunk } = await ctx.params;
  const slug = chunk.replace(/\.geojson$/, '');

  const res = await apiFetch(
    `/spots/map/region/${encodeURIComponent(country)}/${encodeURIComponent(slug)}`,
  );
  if (!res.ok) {
    throw new Error(`Chunk ${country}/${slug} failed: ${res.status}`);
  }
  const markers = (await res.json()) as Marker[];

  // 🔴 A chunk the index promised must not come back empty.
  //
  // The index is built from the same rows, so an empty answer here means
  // the two disagree — and the map would draw a region as if it held
  // nothing. Failing the build is the only way that gets noticed.
  if (markers.length === 0) {
    throw new Error(
      `Chunk ${country}/${slug} is empty, but the index lists it. ` +
        'The index and the chunks are out of step.',
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
      // Only what is known — an absent key means unknown, which is what
      // the filters already assume. See knownAmenities.
      ...knownAmenities(m.amenities),
    },
  }));

  return new Response(
    JSON.stringify({ type: 'FeatureCollection', features }),
    { headers: { 'content-type': 'application/geo+json; charset=utf-8' } },
  );
}
