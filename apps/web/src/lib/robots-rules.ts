import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://camptribe.eu';

// CAMP-90. Two different files depending on the mode, because a closed
// environment and a live one need opposite things.

/**
 * The same answer with the mode passed in, so a test can ask BOTH modes from
 * one process.
 *
 * 🔴 WHY THIS IS NOT IN `app/robots.ts`. `isPublic` is a constant read from
 * the environment when the module loads, so every CI run that reads the file
 * can only ever see the closed branch — and the public one, the one that will
 * ship, would otherwise be checked by reading its source text. And a Next
 * metadata route file does not tolerate extra exports (the route-handler rule
 * `route.ts` has, which `tsc` does not report until `.next/types` exists), so
 * the function lives here and `app/robots.ts` only passes the mode.
 * (CAMP-228: the account pages must not appear in the public `disallow`.)
 */
export function robotsFor(open: boolean): MetadataRoute.Robots {
  if (!open) {
    // 🔴 No `sitemap:` line here. Advertising a list of pages we are
    // simultaneously asking nobody to crawl is a contradiction, and
    // Google resolves contradictions however it likes.
    //
    // Note this is belt to the `X-Robots-Tag` braces, not a replacement:
    // a full Disallow stops the crawl, which means the crawler never
    // reads the `noindex` on the page itself. A URL blocked in
    // robots.txt but linked from elsewhere can still appear in results
    // as a bare link. The header is what actually keeps it out, and it
    // is served on every response including files.
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Trip planning is a logged-in, per-user feature - nothing there is
      // meant to rank, and letting it index would waste crawl budget that
      // should go to camping-directory and route pages instead.
      disallow: ['/trips/', '/api/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
