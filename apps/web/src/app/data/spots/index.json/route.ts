import { apiFetch } from '@/lib/api';
import { chunkBody, type ChunkMarker, type RegionSummary } from '@/lib/map-chunks';

// CAMP-127: the map's table of contents.
//
// 🔴 Why this file exists at all.
//
// The map used to read one snapshot of every campsite. That snapshot had
// a hard cap of 20 000 markers and a route that refused — correctly — to
// serve a truncated one. On 24.09.2026 the EU-27 import took the database
// from 9 830 campsites to 61 521, the cap fired, and the map stopped
// working entirely. The file it replaced said, in its own comment, what
// to do on that day; this is that day.
//
// Small on purpose: 812 rows, no geometry beyond four corners, a centre
// and a weight. It is fetched once and answers three questions without
// another request — what is in view, how many, and how much it would
// cost to draw.

export const dynamic = 'force-static';

/**
 * 🔴 A budget in bytes, because bytes are what a phone pays.
 *
 * The index is downloaded before anything is drawn, so it sits in front
 * of every reader on every visit. 400 KB is roughly two and a half times
 * today's size: room for the map to double without a surprise, and far
 * enough below a megabyte that crossing it is a real signal rather than
 * noise.
 */
const INDEX_BUDGET_BYTES = 400_000;

/**
 * How many chunks to measure at once.
 *
 * 🔴 Bounded, not unbounded. 812 simultaneous requests against the API
 * is a self-inflicted outage on the one service the rest of the build
 * also needs; one at a time is 812 sequential round trips. Six is the
 * same shape of answer the map itself uses for fetching chunks.
 */
const MEASURE_CONCURRENCY = 6;

/**
 * The byte weight of every chunk, measured by building it.
 *
 * 🔴 CAMP-133. The map's "this view is too wide" bound used to count
 * chunks and call itself a bound on bytes. Chunks range from 6 kB to
 * 419 kB (measured 27.09.2026), so the count said nothing about what a
 * reader downloads — the heaviest view it allowed weighed 1.96 MB, next
 * door to the 2.4 MB CAMP-127 called unviable. The bound is now in
 * bytes, and this is where the bytes come from: the same `chunkBody`
 * the chunk route serves, measured, not modelled.
 *
 * 🔴 It costs one extra API call per region at build time. Measured on
 * this machine after the region query stopped reading a whole country
 * per chunk (CAMP-133 again): 812 chunks in 7.7 s at this concurrency,
 * against a ~6 minute web build. The alternative — guessing the weight
 * from the campsite count — was measured too, and overstates a real
 * view by up to 2.34×, which would refuse four times as many views as
 * it should.
 */
async function measureChunkBytes(
  regions: readonly RegionSummary[],
): Promise<number[]> {
  const bytes = new Array<number>(regions.length);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= regions.length) return;
      const r = regions[i];
      const country = r.country.toLowerCase();
      const res = await apiFetch(
        `/spots/map/region/${encodeURIComponent(country)}/${encodeURIComponent(r.slug)}`,
      );
      if (!res.ok) {
        throw new Error(`Chunk ${country}/${r.slug} failed: ${res.status}`);
      }
      const markers = (await res.json()) as ChunkMarker[];
      // 🔴 The same disagreement the chunk route refuses to serve, caught
      // one step earlier: an index row whose chunk is empty, or whose
      // chunk holds a different number of campsites than the index
      // promised, means the two are out of step and every count the map
      // shows is built on it.
      if (markers.length !== r.count) {
        throw new Error(
          `Chunk ${country}/${r.slug} holds ${markers.length} campsites but ` +
            `the index says ${r.count}. The index and the chunks are out of step.`,
        );
      }
      bytes[i] = Buffer.byteLength(chunkBody(markers));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MEASURE_CONCURRENCY, regions.length) }, worker),
  );
  return bytes;
}

export async function GET() {
  const res = await apiFetch('/spots/map/regions');
  if (!res.ok) {
    throw new Error(`Region index request failed: ${res.status}`);
  }
  const regions = (await res.json()) as RegionSummary[];

  // 🔴 An empty index is a failure, not an empty map.
  //
  // Nothing downstream can tell the difference between "no regions" and
  // "the query returned nothing", and the second one would produce a
  // silent, permanently blank map — which is the exact shape of failure
  // this card was opened for.
  if (regions.length === 0) {
    throw new Error(
      'The region index is empty. A map with no regions is a broken build, ' +
        'not a map of an empty continent.',
    );
  }

  const measured = await measureChunkBytes(regions);
  const body = JSON.stringify(
    regions.map((r, i) => ({ ...r, bytes: measured[i] })),
  );
  const bytes = Buffer.byteLength(body);
  if (bytes > INDEX_BUDGET_BYTES) {
    throw new Error(
      `The region index is ${(bytes / 1024).toFixed(0)} kB, over the ` +
        `${INDEX_BUDGET_BYTES / 1024} kB budget. Every reader downloads this ` +
        'before the map draws anything — split it by country before raising ' +
        'the number.',
    );
  }

  return new Response(body, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
