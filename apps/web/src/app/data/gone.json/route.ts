import GONE from '@/generated/gone.json';

// CAMP-73: the campsites that answer 410, as a plain file.
//
// 🔴 Same generated file the middleware and the /gone page read. It is
// published rather than kept internal for two reasons: the tests need to
// know which URLs should be gone without hard-coding a slug — slugs move
// when the dedup rule changes (CAMP-39) — and when a crawl report one
// day disagrees with us, this is the thing to look at first.
//
// It carries no personal data and nothing that is not already public:
// these are OpenStreetMap-derived campsites that no longer exist.

export const dynamic = 'force-static';

export async function GET() {
  return new Response(JSON.stringify(GONE), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Short, because the list changes with each weekly import and a
      // stale copy would point at campsites that have come back.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
