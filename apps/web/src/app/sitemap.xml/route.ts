import { sitemapChildren, sitemapIndexXml, isoDate, SITE } from '@/lib/sitemap';

// CAMP-39: the index. robots.txt points here, and Search Console is told
// this URL once — so its meaning must not change as the site grows.

export const dynamic = 'force-static';

export async function GET() {
  const children = await sitemapChildren();
  const xml = sitemapIndexXml(
    children.map((name) => ({
      loc: `${SITE}/sitemaps/${name}.xml`,
      lastmod: isoDate(new Date()),
    })),
  );
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
