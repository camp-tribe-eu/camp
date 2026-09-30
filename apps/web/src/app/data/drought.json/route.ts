import DROUGHT from '@/data/drought.json';

// CAMP-163: the Copernicus EDO Combined Drought Indicator for one dekad,
// as a plain file.
//
// 🔴 A file rather than an import, because the map is a client component.
// Bundled, these 335 KB would be parsed into the page's JavaScript for
// every reader who opens /map, including the ones who never look at the
// drought layer. Fetched, they arrive once, gzipped, and only when the
// layer is on.
//
// 🔴 A file rather than a live proxy to Copernicus, for the reason
// scripts/edo/fetch-drought.mjs states at length: the service documents
// itself wrongly in four places, and a build that scraped it would answer
// 200 with an old period on the day it changed. The committed file carries
// the dekad, and the page says "no fresh data" once that is older than its
// budget.

export const dynamic = 'force-static';

/**
 * 🔴 The ceiling this file is allowed to reach, checked at build time.
 *
 * Measured 29.09.2026: 342 963 bytes on disk (`wc -c`), one string per
 * row of the 1 824 × 1 200 grid. The grid is fixed by the service, so the
 * only thing that moves the size is how fragmented the classes are — a
 * wetter or drier week changes the run count, not the dimensions. 700 KB
 * is twice today's file: room for the most fragmented dekad by a wide
 * margin, and a build that crosses it stops rather than shipping a map
 * that a phone on a mountain road cannot load.
 */
const BUDGET_BYTES = 700_000;

export async function GET() {
  const body = JSON.stringify(DROUGHT);
  if (body.length > BUDGET_BYTES) {
    throw new Error(
      `the drought layer is ${body.length} bytes, over its ${BUDGET_BYTES} budget. ` +
        'Check what changed in scripts/edo/fetch-drought.mjs, or raise this ' +
        'deliberately after measuring what it costs on a phone.',
    );
  }
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // A day: the indicator changes every ten days at most, and the
      // page's own freshness budget is measured in weeks.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
