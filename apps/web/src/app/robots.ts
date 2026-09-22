import type { MetadataRoute } from 'next';
import { isPublic } from '@/lib/environment';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://camptribe.eu';

// CAMP-90. Two different files depending on the mode, because a closed
// environment and a live one need opposite things.

export default function robots(): MetadataRoute.Robots {
  if (!isPublic) {
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
