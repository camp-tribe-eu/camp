import type { Metadata } from 'next';
import Link from 'next/link';
import { getGuides, PROVENANCE_LABEL } from '@/lib/guides';
import { abs, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-66 — the guides index.
//
// 🔴 What this section is NOT. The plan called for 100–200 articles on
// wild-camping law, gear and winter camping. We publish none of those,
// and the reason is in the page itself: we would be writing about
// twenty-seven jurisdictions we have not checked, and our own terms
// disclaim exactly that advice. What we can write about is what we
// measured, and that is what is here.

export const metadata: Metadata = {
  title: 'Guides',
  description:
    'What our data actually says about campsites in each region — including what nobody has recorded.',
  alternates: alternatesFor('/guides'),
};

export default async function GuidesIndex() {
  const guides = await getGuides();

  const byCategory = new Map<string, typeof guides>();
  for (const g of guides) {
    const list = byCategory.get(g.category) ?? [];
    list.push(g);
    byCategory.set(g.category, list);
  }

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          '@id': `${abs('/guides')}#page`,
          name: 'Guides',
          url: abs('/guides'),
          description:
            'What our data says about campsites in each region, including the gaps.',
        })}
      />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">Guides</h1>
      <p className="mt-4 max-w-prose text-ink-2">
        Each of these answers one question about one region, using counts from
        our own records. They say how many campsites have something recorded —
        and how many have nothing, which is usually the larger number and the
        reason to trust the rest.
      </p>

      {guides.length === 0 ? (
        // An empty section is worse than no section: it advertises our
        // own backlog. Say so plainly rather than render a bare heading.
        <p className="mt-8 max-w-prose text-ink-2">
          There are no guides yet.
        </p>
      ) : (
        [...byCategory.entries()].map(([category, list]) => (
          <section key={category} className="mt-10">
            <h2 className="text-xl font-bold capitalize md:text-[25px]">
              {category === 'region' ? 'By region' : category}
            </h2>
            <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {list.map((g) => (
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
        ))
      )}
    </main>
  );
}
