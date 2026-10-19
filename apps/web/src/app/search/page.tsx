import type { Metadata } from 'next';
import Link from 'next/link';
import { countryName, getCountries, getSummary } from '@/lib/api';
import {
  memberStateCount,
  printable,
  searchDescription,
  searchLead,
} from '@/lib/campsite-count';
import { alternatesFor } from '@/lib/i18n';
import Breadcrumbs from '@/components/breadcrumbs';
import SearchEmbed from '@/components/search-embed';
import { abs, breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { getRoutes } from '@/lib/routes';
import { ButtonLink } from '@/components/button';

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

const crumbs = [
  { name: 'CampTribe', path: '/' },
  { name: 'Search', path: '/search' },
];

export default async function SearchPage() {
  const [summary, countries] = await Promise.all([
    getSummary(),
    getCountries(),
  ]);

  const routeCount = getRoutes().length;

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      {/* 🔴 Our own guard asked for this — check-structured-data failed
          the build with "1 page(s) carry no JSON-LD at all". The type is
          SearchResultsPage, which schema.org genuinely has; describing a
          results page as a plain WebPage would pass the check and say
          something slightly untrue.

          🔴 What is NOT here: Google's sitelinks-searchbox markup. It
          needs a `query-input` property that is Google's own convention
          rather than schema.org vocabulary, and our validator — rightly —
          only knows the vocabulary. That is its own card, not a thing to
          smuggle in by loosening the checker. */}
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'SearchResultsPage',
          '@id': `${abs('/search')}#page`,
          name: 'Search',
          description: searchDescription(printable(summary.spots)),
          url: abs('/search'),
          inLanguage: 'en',
        })}
      />
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <Breadcrumbs crumbs={crumbs} />

      <h1 className="mt-4 text-2xl font-bold text-heading sm:text-3xl">
        Search
      </h1>
      <p className="mt-2 max-w-prose text-sm text-ink-2">
        {/* 🔴 CAMP-240. `memberStateCount`, not `countries.length`: the
            list has 28 codes and one of them is Åland, which is Finland.
            "Across 28 countries" was a false sentence on a page whose
            site serves 27. See lib/campsite-count.ts. */}
        {searchLead(
          printable(summary.spots),
          memberStateCount(countries.map((c) => c.country)),
        )}
        . Type a name, a region, or a town or lake nearby.
      </p>

      <div className="mt-5 max-w-2xl">
        <SearchEmbed />
      </div>

      <section className="mt-10 border-t border-line-2 pt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          Or browse by country
        </h2>
        <ul className="mt-3 flex flex-wrap gap-x-2 gap-y-3">
          {countries.map((c) => (
            <li key={c.country}>
              <ButtonLink
                href={`/camping/${c.country}`} size="sm">
                {countryName(c.country)} · {c.spots.toLocaleString('en-GB')}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </section>

      {/* 🔴 CAMP-240. What the box does NOT search, said on the page that
          has the box. The design's search (09-guides.html) groups its
          results by campsites, routes, guides and cities; ours finds
          campsites only, and a reader who types a route's name and gets
          "nothing" is told the site has no such route. These are the
          places the other things live. The design's "often searched"
          and "recently viewed" are not here: we keep no search log to
          say what is often searched, and recently viewed is a feature
          of the browser, not a sentence for this page. */}
      <section className="mt-10 border-t border-line-2 pt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          Not looking for a campsite?
        </h2>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          This box searches campsites only. The rest of the site is in these
          places.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-ink-2">
          <li>
            <Link className="font-semibold text-heading underline" href="/map">
              The map
            </Link>{' '}
            — every campsite we hold, on one map you can filter.
          </li>
          <li>
            <Link className="font-semibold text-heading underline" href="/routes">
              Routes
            </Link>{' '}
            — {routeCount} curated routes through the EU, stop by stop.
          </li>
          <li>
            <Link className="font-semibold text-heading underline" href="/guides">
              Guides
            </Link>{' '}
            — one question about one region, answered from our own records.
          </li>
          <li>
            <Link className="font-semibold text-heading underline" href="/tools">
              Tools
            </Link>{' '}
            — what a trip costs with this week&rsquo;s fuel prices, and what to
            pack.
          </li>
        </ul>
      </section>
    </main>
  );
}
