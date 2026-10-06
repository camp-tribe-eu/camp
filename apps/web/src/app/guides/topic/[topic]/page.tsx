import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { countryName } from '@/lib/api';
import { byTopic, isTopic, TOPICS } from '@/lib/guide-facets';
import { CatalogueProvenance } from '@/components/catalogue-provenance';
import { getGuides, PROVENANCE_LABEL } from '@/lib/guides';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-210 — the other facet. See `country/[cc]/page.tsx` for why these
// live under a static segment rather than beside the articles.
//
// This one is the larger of the two: "water" covers 466 regions. Grouped
// by country so the page has structure rather than a 466-item run, and
// so a reader scanning for one country finds it by heading.

interface Params {
  topic: string;
}

export async function generateStaticParams() {
  return byTopic(await getGuides()).map((t) => ({ topic: t.topic }));
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { topic } = await props.params;
  if (!isTopic(topic)) return {};
  return {
    title: `${TOPICS[topic]} — guides`,
    description: `Every region where our records answer one question: ${TOPICS[topic].toLowerCase()}.`,
    alternates: alternatesFor(`/guides/topic/${topic}`),
  };
}

export default async function GuidesByTopic(props: {
  params: Promise<Params>;
}) {
  const { topic } = await props.params;
  // 🔴 Checked against the declared set, not against whatever arrives.
  // `/guides/topic/anything` must be a 404, or it is an address that
  // renders an empty page and invites the index to keep it.
  if (!isTopic(topic)) notFound();

  const entry = byTopic(await getGuides()).find((t) => t.topic === topic);
  if (!entry) notFound();

  const byCountryHere = new Map<string, typeof entry.guides>();
  for (const g of entry.guides) {
    const list = byCountryHere.get(g.facets.country) ?? [];
    list.push(g);
    byCountryHere.set(g.facets.country, list);
  }
  const groups = [...byCountryHere.entries()]
    .map(([country, guides]) => ({ country, guides }))
    .sort(
      (a, b) =>
        b.guides.length - a.guides.length || a.country.localeCompare(b.country),
    );

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: TOPICS[topic],
            description: `${entry.guides.length} regions where our records answer this question.`,
            path: `/guides/topic/${topic}`,
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
            { name: TOPICS[topic], path: `/guides/topic/${topic}` },
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
          <li aria-current="page">{TOPICS[topic]}</li>
        </ol>
      </nav>

      <h1 className="mt-4 text-3xl font-bold leading-tight md:text-[42px]">
        {TOPICS[topic]}
      </h1>

      <CatalogueProvenance guides={entry.guides} />
      <p className="mt-3 max-w-prose text-ink-2">
        {entry.guides.length.toLocaleString('en-GB')} regions across{' '}
        {groups.length} countries. Each one counts what our records hold, and
        says how many campsites have nothing recorded.
      </p>

      {groups.map((group) => (
        <section key={group.country} className="mt-10">
          <h2 className="text-xl font-bold md:text-[25px]">
            <Link
              href={`/guides/country/${group.country}`}
              className="hover:underline"
            >
              {countryName(group.country)}
            </Link>
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
                  <span className="mt-2 block text-xs uppercase tracking-[0.08em] text-ink-2">
                    {PROVENANCE_LABEL[g.provenance]?.short ?? g.provenance}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
