import DROUGHT from '@/data/drought.json';
import DOMAIN from '@/data/drought-domain.json';

// CAMP-200: the EDO drought grid AND its coverage mask, as one plain file.
//
// 🔴 One payload, not two routes. The map needs the grid and the mask
// together or not at all — a grid without its mask is exactly the picture
// that says "no drought" about Malta and about the open sea alike — so two
// requests would only double the latency of something that is useless
// until both have arrived. The body is `{ meta, cdi, domain }`: the grid
// file as committed, plus the `domain` string of the mask file. The mask's
// own `meta` (which dekads it was built from) is for the people who
// rebuild it and is not sent.
//
// 🔴 A file rather than an import, because the map is a client component.
// Bundled, these kilobytes would be parsed into the page's JavaScript for
// every reader who opens /map, including the ones who never look at the
// drought layer. Fetched, they arrive once, and only when the layer is on.
//
// 🔴 A file rather than a live proxy to Copernicus, for the reason
// scripts/edo/fetch-drought.mjs states at length: the service documents
// itself wrongly in four places, and a build that scraped it would answer
// 200 with an old period on the day it changed. The committed file carries
// the dekad, and the page says "no recent drought reading" once that is
// older than its budget.

export const dynamic = 'force-static';

/**
 * 🔴 The ceiling this payload is allowed to reach, checked at build time.
 *
 * Measured 14.10.2026: 102 117 bytes served (`curl -s …/data/drought.json
 * | wc -c` against the production build; `wc -c` of
 * `.next/server/app/data/drought.json.body` says the same). The two
 * committed files are 85 306 and 18 164 bytes (`wc -c`), 103 470 together;
 * the payload is a little smaller because the mask file's own `meta` is
 * not sent. 250 000 is 2.45 times the payload. The grid is fixed by the
 * service, so the only thing that moves the size is how fragmented the
 * classes are: a wetter or drier season changes what gzip finds to
 * squeeze, not the dimensions. Room for the worst dekad by a wide
 * margin, and a build that crosses it stops rather than shipping a map
 * that a phone on a mountain road cannot load.
 */
const BUDGET_BYTES = 250_000;

export async function GET() {
  const body = JSON.stringify({ ...DROUGHT, domain: DOMAIN.domain });
  // Bytes on the wire, not UTF-16 units: the class descriptions carry a
  // typographic apostrophe, and `body.length` would undercount it.
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > BUDGET_BYTES) {
    throw new Error(
      `the drought layer is ${bytes} bytes, over its ${BUDGET_BYTES} budget. ` +
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
