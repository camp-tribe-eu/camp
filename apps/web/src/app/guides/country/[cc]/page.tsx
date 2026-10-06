import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { countryName } from '@/lib/api';
import { byCountry, TOPICS, type Topic } from '@/lib/guide-facets';
import { getGuides, PROVENANCE_LABEL } from '@/lib/guides';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-210 — one of the two facets that make 1 268 guides reachable.
//
// 🔴 A STATIC SEGMENT, DELIBERATELY. The articles live at
// `/guides/<slug>`, so a facet at `/guides/<country>` would be the same
// shape and Next would have to guess. `/guides/country/<cc>` cannot
// collide: a static segment wins over a dynamic sibling, and a reader
// can see from the address what kind of page they are on.
//
// 🔴 EVERY GUIDE ON ONE PAGE, not paged. France has 366 and that is the
// largest. The trade is deliberate: 366 links on one page against eight
// screens of paging to reach the last one, when the card's bar is three
// clicks. `guide-facets.spec.ts` watches the number and fails if a facet
// ever passes a thousand, which is where a page stops being a page.

interface Params {
  cc: string;
}

export async function generateStaticParams() {
  return byCountry(await getGuides()).map((c) => ({ cc: c.country }));
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { cc } = await props.params;
  const name = countryName(cc);
  return {
    title: `Guides for ${name}`,
    description: `What our records say about campsites across ${name}, region by region — including what nobody has recorded.`,
    alternates: alternatesFor(`/guides/country/${cc}`),
  };
}

export default async function GuidesByCountry(props: {
  params: Promise<Params>;
}) {
  const { cc } = await props.params;
  const entry = byCountry(await getGuides()).find((c) => c.country === cc);

  // 🔴 404, not an empty page. A country with no guides is not a page
  // with nothing on it — it is an address that means nothing, and a soft
  // 200 over it would put it in the index and spend crawl budget on air.
  if (!entry) notFound();

  const name = countryName(cc);
  const groups = (Object.keys(TOPICS) as Topic[])
    .map((topic) => ({
      topic,
      guides: entry.guides.filter((g) => g.facets.topic === topic),
    }))
    .filter((g) => g.guides.length > 0);

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: `Guides for ${name}`,
            description: `${entry.guides.length} guides covering campsites across ${name}.`,
            path: `/guides/country/${cc}`,
            items: entry.guides.map((g) => ({
              name: g.title,
              path: `/guides/${g.slug}`,
            })),
          }),
        )}
      />
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'Guides', path: '/guides' },
            { name, path: `/guides/country/${cc}` },
          ]),
        )}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link href="/guides" className="hover:text-heading">
              Guides
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{name}</li>
        </ol>
      </nav>

      <h1 className="mt-4 text-3xl font-bold leading-tight md:text-[42px]">
        Guides for {name}
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        {entry.guides.length.toLocaleString('en-GB')} guides, one per region and
        question. Each counts what our records hold — and says how many
        campsites have nothing recorded, which is usually the larger number.
      </p>

      {groups.map((group) => (
        <section key={group.topic} className="mt-10">
          <h2 className="text-xl font-bold md:text-[25px]">
            {TOPICS[group.topic]}
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {group.guides.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/guides/${g.slug}`}
                  className="block rounded-card border border-line-2 bg-surface p-4 hover:border-line-blue"
                >
                  <span className="font-semibold text-heading">{g.title}</span>
                  {g.summary && (
                    <span className="mt-1 block text-sm text-ink-2">
                      {g.summary}
                    </span>
                  )}
                  {/* The label travels with the link, so a reader knows
                      before they click, not only after. */}
                  <span className="mt-2 block text-xs uppercase tracking-[0.08em] text-ink-2">
                    {PROVENANCE_LABEL[g.provenance]?.short ?? g.provenance}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-10 text-sm text-ink-2">
        Looking for one question across every country?{' '}
        <Link href="/guides" className="underline hover:text-heading">
          The guides index lists them by question too.
        </Link>
      </p>
    </main>
  );
}
