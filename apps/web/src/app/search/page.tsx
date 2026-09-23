import type { Metadata } from 'next';
import Link from 'next/link';
import { countryName, getCountries, getSummary } from '@/lib/api';
import { alternatesFor } from '@/lib/i18n';
import SearchEmbed from '@/components/search-embed';

// CAMP-67 — /search.
//
// 🔴 `noindex`, and deliberately so. A search-results page is thin,
// infinite and duplicates the pages it points at; Google's own guidance
// is explicit that internal search results do not belong in an index.
// It stays fully crawlable, so the links out of it still carry weight.
//
// 🔴 Everything below the box works without JavaScript, for the same
// reason /map has a country list under it: the one page a reader lands
// on when they cannot find something must not itself be a dead end.

export const metadata: Metadata = {
  title: 'Search',
  description: 'Find a campsite by name, by region, or by somewhere near it.',
  alternates: alternatesFor('/search'),
  robots: { index: false, follow: true },
};

export default async function SearchPage() {
  const [summary, countries] = await Promise.all([
    getSummary(),
    getCountries(),
  ]);

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <h1 className="text-2xl font-bold text-heading sm:text-3xl">Search</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-2">
        {summary.spots} campsites across {countries.length} countries. Type a
        name, a region, or a town or lake nearby.
      </p>

      <div className="mt-5 max-w-2xl">
        <SearchEmbed />
      </div>

      <section className="mt-10 border-t border-line-2 pt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          Or browse by country
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {countries.map((c) => (
            <li key={c.country}>
              <Link
                href={`/camping/${c.country}`}
                className="inline-flex h-9 items-center rounded-sm border border-line-2 bg-surface px-3 text-sm text-heading hover:border-line-blue"
              >
                {countryName(c.country)} · {c.spots}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
