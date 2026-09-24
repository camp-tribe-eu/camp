import { apiFetch } from '@/lib/api';
import type { RegionSummary } from '@/lib/map-chunks';

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
// Small on purpose: 812 rows, 164 KB measured, no geometry beyond four
// corners and a centre. It is fetched once and answers two questions
// without another request — what is in view, and how many.

export const dynamic = 'force-static';

/**
 * 🔴 A budget in bytes, because bytes are what a phone pays.
 *
 * The index is downloaded before anything is drawn, so it sits in front
 * of every reader on every visit. 400 KB is roughly two and a half times
 * today's 164 KB: room for the map to double without a surprise, and far
 * enough below a megabyte that crossing it is a real signal rather than
 * noise.
 */
const INDEX_BUDGET_BYTES = 400_000;

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

  const body = JSON.stringify(regions);
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
