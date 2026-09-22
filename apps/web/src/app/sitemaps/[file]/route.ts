import { notFound } from 'next/navigation';
import {
  campsiteUrls,
  hubUrls,
  sitemapChildren,
  urlsetXml,
  URLS_PER_SITEMAP,
} from '@/lib/sitemap';

// CAMP-39: the children of the sitemap index.
//
// One route rather than a file per chunk, so adding a country adds URLs
// and — past 10,000 campsites — a whole new sitemap file, with no code
// change anywhere. That is the card's acceptance criterion: "a new page
// in the database appears in the sitemap without editing code".

export const dynamic = 'force-static';

export async function generateStaticParams() {
  return (await sitemapChildren()).map((name) => ({ file: `${name}.xml` }));
}

export async function GET(_request: Request, props: { params: Promise<{ file: string }> }) {
  const params = await props.params;
  const name = params.file.replace(/\.xml$/, '');

  if (name === 'hubs') {
    return xml(urlsetXml(await hubUrls()));
  }

  const chunk = /^campsites-(\d+)$/.exec(name);
  if (chunk) {
    const n = Number(chunk[1]);
    const all = await campsiteUrls();
    const slice = all.slice(n * URLS_PER_SITEMAP, (n + 1) * URLS_PER_SITEMAP);
    // An empty chunk means the index and the data disagree — better a
    // 404 a crawler reports than an empty file it silently accepts.
    if (slice.length === 0) notFound();
    return xml(urlsetXml(slice));
  }

  notFound();
}

const xml = (body: string) =>
  new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
