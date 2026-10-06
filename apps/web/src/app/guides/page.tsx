import type { Metadata } from 'next';
import Link from 'next/link';
import { countryName } from '@/lib/api';
import { byCountry, byTopic, TOPICS, unparsed } from '@/lib/guide-facets';
import { getGuides } from '@/lib/guides';
import { collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-66 — the guides index. CAMP-210 — the catalogue it had to become.
//
// 🔴 What this section is NOT. The plan called for 100–200 articles on
// wild-camping law, gear and winter camping. We publish none of those,
// and the reason is in the page itself: we would be writing about
// twenty-seven jurisdictions we have not checked, and our own terms
// disclaim exactly that advice. What we can write about is what we
// measured, and that is what is here.
//
// 🔴 AND IT OUTGREW ITS OWN LISTING. This page rendered every guide in
// one flat list, which was right when there were four. Measured on the
// production database on 06.10.2026: **1 268**, all in the single
// category "region". A page of 1 268 links is not a catalogue.
//
// The card's bar is three clicks to any article. A flat list meets that
// on paper — everything is one click away — and fails it in practice,
// because nobody finds one row in 1 268. So the hub lists facets and the
// facet pages list articles: hub → facet → article, two clicks, and
// `guide-facets.spec.ts` asserts over the real corpus that every one of
// the 1 268 appears on both a country page and a topic page.

export const metadata: Metadata = {
  title: 'Guides',
  description:
    'What our data actually says about campsites in each region — including what nobody has recorded.',
  alternates: alternatesFor('/guides'),
};

export default async function GuidesIndex() {
  const guides = await getGuides();
  const countries = byCountry(guides);
  const topics = byTopic(guides);

  // 🔴 Reported, not dropped. A guide whose slug this does not understand
  // belongs to no facet, which means no page links it — an article that
  // exists and cannot be reached. Silence here would look like success.
  const lost = unparsed(guides);

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: 'Guides',
            description:
              'What our data says about campsites in each region, including the gaps.',
            path: '/guides',
            items: topics.map((t) => ({
              name: TOPICS[t.topic],
              path: `/guides/topic/${t.topic}`,
            })),
          }),
        )}
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
        <p className="mt-8 max-w-prose text-ink-2">There are no guides yet.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-2">
            {guides.length.toLocaleString('en-GB')} guides across{' '}
            {countries.length} countries.
          </p>

          <section className="mt-10">
            <h2 className="text-xl font-bold md:text-[25px]">By question</h2>
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((t) => (
                <li key={t.topic}>
                  <Link
                    href={`/guides/topic/${t.topic}`}
                    className="block rounded-card border border-line-2 bg-surface p-4 hover:border-line-blue"
                  >
                    <span className="font-semibold text-heading">
                      {TOPICS[t.topic]}
                    </span>
                    <span className="mt-1 block text-sm text-ink-2">
                      {t.guides.length.toLocaleString('en-GB')} regions
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-bold md:text-[25px]">By country</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {countries.map((c) => (
                <li key={c.country}>
                  <Link
                    href={`/guides/country/${c.country}`}
                    className="block rounded-card border border-line-2 bg-surface p-3 hover:border-line-blue"
                  >
                    <span className="font-semibold text-heading">
                      {countryName(c.country)}
                    </span>
                    <span className="mt-1 block text-sm text-ink-2">
                      {c.guides.length.toLocaleString('en-GB')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {lost.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-bold md:text-[25px]">
                Not filed anywhere
              </h2>
              <p className="mt-2 max-w-prose text-ink-2">
                {lost.length.toLocaleString('en-GB')} of these do not fit the
                shape the catalogue sorts by, so they appear here rather than
                nowhere.
              </p>
              <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {lost.map((g) => (
                  <li key={g.slug}>
                    <Link
                      href={`/guides/${g.slug}`}
                      className="block rounded-card border border-line-2 bg-surface p-4 hover:border-line-blue"
                    >
                      <span className="font-semibold text-heading">{g.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
