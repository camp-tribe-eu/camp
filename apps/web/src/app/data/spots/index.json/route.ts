import { apiFetch } from '@/lib/api';
import {
  VIEW_BUDGET_BYTES,
  chunkWeight,
  overlaps,
  type RegionSummary,
} from '@/lib/map-chunks';

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

/**
 * The heaviest view the map can be asked to draw, however far in the
 * reader zooms.
 *
 * 🔴 CAMP-133: a rehearsal of the safeguard, not a hope about it.
 *
 * `VIEW_BUDGET_BYTES` refuses a view that weighs too much and tells the
 * reader to zoom in. But a chunk is a WHOLE region, and zooming in does
 * not make it smaller — so at a point where several large regions'
 * bounding boxes overlap there is a floor below which no amount of
 * zooming goes. If that floor ever rises above the budget, the map will
 * tell a reader in southern Germany to zoom in, and keep telling them,
 * for ever.
 *
 * Measured 27.09.2026: the worst point in EU-27 is lon 10.196, lat
 * 49.406 — Bayern, Baden-Württemberg and Hessen — at 0.92 MB of real
 * bytes and 1.25 MB of budget, against a 1.75 MB budget. 1.40× of room.
 *
 * Checked over the corners of every region's box, because the worst
 * overlap always sits on one of them: a point strictly inside a set of
 * boxes can be moved towards a corner without leaving any of them.
 */
function heaviestUnavoidableView(regions: readonly RegionSummary[]): {
  bytes: number;
  lon: number;
  lat: number;
  keys: string[];
} {
  let worst = { bytes: 0, lon: 0, lat: 0, keys: [] as string[] };
  for (const r of regions) {
    for (const [lon, lat] of [
      [r.minLon, r.minLat],
      [r.minLon, r.maxLat],
      [r.maxLon, r.minLat],
      [r.maxLon, r.maxLat],
    ] as const) {
      const point = { west: lon, east: lon, south: lat, north: lat };
      const hit = regions.filter((o) => overlaps(point, o));
      const bytes = hit.reduce((n, o) => n + chunkWeight(o.count), 0);
      if (bytes > worst.bytes) {
        worst = {
          bytes,
          lon,
          lat,
          keys: hit.map((o) => `${o.country.toLowerCase()}/${o.slug}`),
        };
      }
    }
  }
  return worst;
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

  const floor = heaviestUnavoidableView(regions);
  if (floor.bytes > VIEW_BUDGET_BYTES) {
    throw new Error(
      `At lon ${floor.lon.toFixed(3)}, lat ${floor.lat.toFixed(3)} the map ` +
        `cannot draw markers at any zoom: the regions overlapping that point ` +
        `weigh ${(floor.bytes / 1_048_576).toFixed(2)} MB against a ` +
        `${(VIEW_BUDGET_BYTES / 1_048_576).toFixed(2)} MB budget, and a chunk ` +
        `is a whole region however far you zoom in. Chunks there: ` +
        `${floor.keys.join(', ')}. Split those regions or raise ` +
        'VIEW_BUDGET_BYTES — do not ship a map that says "zoom in" for ever.',
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
