import type { Metadata } from 'next';
import Link from 'next/link';
import { countryName, getCountries, getSummary } from '@/lib/api';
import MapEmbed from '@/components/map-embed';
import { collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-31 — /map.
//
// 🔴 This is the one page on the site that genuinely needs JavaScript,
// and that is why the crawl path from CAMP-71 deliberately does not run
// through it: home → /camping → country → region → campsite is four
// plain links, and the map is an extra way in rather than the only one.
//
// What a reader without JavaScript gets here is not an apology. It is
// the country list — the same route the crawler takes — so the page
// still answers "where can I look?" instead of showing a grey box.
//
// The map itself is loaded by components/map-embed.tsx: Next 15 will not
// allow `ssr: false` in a Server Component, and this page stays a Server
// Component so everything above survives without JavaScript.

export const metadata: Metadata = {
  title: 'Campsite map',
  description:
    'Every campsite we hold, on one map. Pan and zoom, or browse by country.',
  alternates: alternatesFor('/map'),
};

export default async function MapPage() {
  const [summary, countries] = await Promise.all([
    getSummary(),
    getCountries(),
  ]);

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      {/* 🔴 The markup describes the country list, not the map. A crawler
          never runs the map, so claiming this page "contains" every
          campsite would be describing something no machine can see
          here. What it can see, and what it can follow, is the list —
          so that is what the page says it is. */}
      <script
        {...jsonLdProps(
          collectionGraph({
            name: 'Campsite map',
            description: `${summary.spots.toLocaleString('en-GB')} campsites across ${countries.length} countries, on one map.`,
            path: '/map',
            items: countries.map((c) => ({
              name: countryName(c.country),
              path: `/camping/${c.country}`,
            })),
          }),
        )}
      />
      <h1 className="text-3xl font-bold md:text-[42px]">Campsite map</h1>
      <p className="mt-3 max-w-prose text-ink-2">
        {summary.spots.toLocaleString('en-GB')} campsites and motorhome parks.
        Each point is a real entry — nothing is placed approximately.
      </p>

      <div className="mt-6">
        <MapEmbed />
      </div>

      {/* Rendered by the server, so it is here with JavaScript off, and
          it is also a second route into the hubs for a crawler that
          reaches this page. */}
      <noscript>
        <p className="mt-3 rounded border border-line-2 bg-surface p-4 text-sm text-ink-2">
          The map needs JavaScript. Everything on it is reachable without:
          pick a country below.
        </p>
      </noscript>

      <section className="mt-8">
        <h2 className="text-xl font-bold md:text-[25px]">Browse instead</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {countries.map((c) => (
            <li key={c.country}>
              <Link
                href={`/camping/${c.country}`}
                className="inline-flex h-9 items-center gap-2 rounded-sm border border-line-2 bg-surface px-3 text-sm text-heading hover:border-line-blue"
              >
                {countryName(c.country)}
                <span className="tabular-nums text-ink-2">{c.spots}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
