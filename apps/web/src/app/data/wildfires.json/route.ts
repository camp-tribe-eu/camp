import WILDFIRES from '@/data/wildfires.json';

// CAMP-153: the EU-27 wildfire perimeters, as a plain file.
//
// 🔴 A file rather than an import, because the map is a client component.
// Bundled, these 245 KB would be parsed into the page's JavaScript for
// every reader who opens /map, including the ones who never look at the
// fire layer. Fetched, they arrive once, gzipped — 31 KB measured — and
// only when the layer is on.
//
// 🔴 A file rather than a live proxy to Copernicus, for the reason
// scripts/effis/fetch-wildfires.mjs states at length: a build that
// scraped EFFIS would answer 200 with an empty layer on the day the
// service changed, and an empty fire layer reads as "all clear". The
// committed file carries the moment we last succeeded, and the page says
// "no fresh data" once that is older than its budget.

export const dynamic = 'force-static';

/**
 * 🔴 The ceiling this file is allowed to reach, checked at build time.
 *
 * Measured 28.09.2026: 278 fires over the 14 days to that date, 245 KB
 * on disk and 31 KB over the wire. 600 KB is a bit over twice today's
 * file — room for a worse fortnight than any in this season — and far
 * enough below the map's own 1.75 MB view budget that a fire layer can
 * never be what makes a view too heavy to draw.
 *
 * A build that crosses it stops, rather than shipping a map that a phone
 * on a mountain road cannot load. The alternative to failing here is
 * discovering it in the one place it matters.
 */
const BUDGET_BYTES = 600_000;

export async function GET() {
  const body = JSON.stringify(WILDFIRES);
  if (body.length > BUDGET_BYTES) {
    throw new Error(
      `the wildfire layer is ${body.length} bytes, over its ${BUDGET_BYTES} budget. ` +
        'Narrow the window in scripts/effis/fetch-wildfires.mjs, or raise this ' +
        'deliberately after measuring what it costs on a phone.',
    );
  }
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Short: the perimeters are derived daily, and a cached copy older
      // than that would defeat the freshness budget the page enforces.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
