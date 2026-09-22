// CAMP-39: what belongs in the sitemap, and what deliberately does not.
//
// 🔴 The rule that matters more than the XML: a sitemap lists pages we
// want indexed. A page carrying `noindex` must NOT appear in it — the two
// are contradictory instructions about the same URL, and Google's own
// guidance is that mixed signals get resolved however it likes. So the
// thin region hubs from CAMP-71 and every `page/2` are excluded here,
// even though both are perfectly good pages and stay fully crawlable
// through the country hub.
//
// Shape is a sitemap index from day one, with children under /sitemaps/.
// Today that index points at two files and looks like overkill. It is
// not: the sitemap URL goes into robots.txt and into Search Console, and
// changing its meaning later means resubmitting and re-earning trust for
// something that should have been right once. The 50,000-URL limit is
// reached at roughly a fifth of Europe.

import {
  getCountries,
  getRegions,
  getSpotIndex,
  type SpotIndexEntry,
} from './api';

export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://camptribe.eu';

/** Well under the protocol's 50,000, so a chunk never sits at the edge. */
export const URLS_PER_SITEMAP = 10_000;

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: 'daily' | 'weekly' | 'monthly';
  priority?: string;
}

/** W3C datetime, date-only form — what the protocol asks for. */
export function isoDate(value: string | Date | null | undefined): string {
  const d = value ? new Date(value) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10);
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export function urlsetXml(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const parts = [`    <loc>${escapeXml(u.loc)}</loc>`];
      if (u.lastmod) parts.push(`    <lastmod>${u.lastmod}</lastmod>`);
      if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
      if (u.priority) parts.push(`    <priority>${u.priority}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function sitemapIndexXml(
  children: { loc: string; lastmod: string }[],
): string {
  const body = children
    .map(
      (c) =>
        `  <sitemap>\n    <loc>${escapeXml(c.loc)}</loc>\n    <lastmod>${c.lastmod}</lastmod>\n  </sitemap>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>
`;
}

/** Static pages plus every hub we actually want ranking. */
export async function hubUrls(): Promise<SitemapUrl[]> {
  const urls: SitemapUrl[] = [
    { loc: `${SITE}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE}/camping`, changefreq: 'weekly', priority: '0.9' },
  ];

  for (const country of await getCountries()) {
    urls.push({
      loc: `${SITE}/camping/${country.country}`,
      changefreq: 'weekly',
      priority: '0.8',
    });
    for (const region of await getRegions(country.country)) {
      // 🔴 Thin hubs are noindex (CAMP-71). Listing them here would ask
      // Google to index a page we just told it not to.
      if (!region.indexable) continue;
      urls.push({
        loc: `${SITE}/camping/${country.country}/${region.slug}`,
        changefreq: 'weekly',
        priority: '0.7',
      });
    }
  }
  return urls;
}

export async function campsiteUrls(): Promise<SitemapUrl[]> {
  const index = await getSpotIndex();
  return index.map((s: SpotIndexEntry) => ({
    loc: `${SITE}/camping/${s.country}/${s.region}/${s.slug}`,
    // 🔴 content_changed_at, NOT last_seen_at. The second moves every
    // week when the import merely confirms the site still exists, which
    // would restamp every unchanged page each Monday and teach crawlers
    // that our lastmod is noise. Verified: after a re-import with no
    // data change, last_seen_at moved a day and this did not.
    lastmod: isoDate(s.contentChangedAt ?? s.lastSeenAt),
    changefreq: 'monthly' as const,
    priority: '0.6',
  }));
}

/** The children the index points at, computed the same way both places. */
export async function sitemapChildren(): Promise<string[]> {
  const spots = await getSpotIndex();
  const chunks = Math.max(1, Math.ceil(spots.length / URLS_PER_SITEMAP));
  return [
    'hubs',
    ...Array.from({ length: chunks }, (_, i) => `campsites-${i}`),
  ];
}
