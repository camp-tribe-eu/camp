import { apiFetch } from '@/lib/api';
import { chunkBody, type ChunkMarker, type RegionSummary } from '@/lib/map-chunks';

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
//
// 🔴 CAMP-133: the body is built by `chunkBody`, not here. The index
// records the byte length of each chunk so the map can refuse a view
// that is too heavy, and it measures it by building the body with that
// same function. A second copy of the shape here would make the index
// describe a file nobody downloads.

export const dynamic = 'force-static';
export const dynamicParams = false;

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
  const markers = (await res.json()) as ChunkMarker[];

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

  return new Response(chunkBody(markers), {
    headers: { 'content-type': 'application/geo+json; charset=utf-8' },
  });
}
