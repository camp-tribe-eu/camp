import type { Metadata } from 'next';
import Link from 'next/link';
import { apiFetch, countryName, getCountries } from '@/lib/api';
import MapEmbed from '@/components/map-embed';
import { collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import type { RegionSummary } from '@/lib/map-chunks';

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

/**
 * How many campsites this page's map actually draws.
 *
 * 🔴 CAMP-133: from the map's own index, not from `/spots/summary`.
 *
 * The page printed the summary — 61 422, measured 27.09.2026 — directly
 * above a map that draws 61 557. The 135 in between are the campsites
 * with no region: `/spots/summary` counts `region IS NOT NULL`, because
 * a campsite with no region has no page (CAMP-34 builds the URL from the
 * region), while the map keeps them because the LOCATION is real. Both
 * queries are right; putting one above the other was not.
 *
 * So the sentence over the map counts what is on the map, from the same
 * file the map reads. The country list below counts something else — the
 * campsites that have a page to browse to — and now says so in words
 * rather than leaving a reader to find a 135-campsite hole.
 */
async function campsitesOnTheMap(): Promise<number> {
  const res = await apiFetch('/spots/map/regions', {
    next: { revalidate: 86400 },
  });
  if (!res.ok) {
    throw new Error(`Region index request failed: ${res.status}`);
  }
  const index = (await res.json()) as RegionSummary[];
  return index.reduce((n, r) => n + r.count, 0);
}

export default async function MapPage() {
  const [onTheMap, countries] = await Promise.all([
    campsitesOnTheMap(),
    getCountries(),
  ]);
  const browsable = countries.reduce((n, c) => n + c.spots, 0);
  const mapOnly = onTheMap - browsable;

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
            // 🔴 The count of what this markup DESCRIBES — the country
            // list — not of what the canvas draws. The two differ by the
            // 135 campsites with no region, and the description of a
            // list of links has to be about the links.
            description: `${browsable.toLocaleString('en-GB')} campsites across ${countries.length} countries, on one map.`,
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
        {onTheMap.toLocaleString('en-GB')} campsites and motorhome parks
        are on this map. Each point is a real entry — nothing is placed
        approximately.
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
        {/* 🔴 The one place the two numbers on this page are reconciled.
            The list counts campsites that HAVE a page; the map counts
            campsites that have a location. A reader who adds the country
            counts up and finds fewer than the map claims deserves the
            reason in a sentence rather than a bug report.

            🔴 And it is absent when there is nothing to reconcile. The
            day every campsite has a region this is one number twice, and
            "The other 0 have no region recorded" is the same kind of
            sentence this card was opened to remove. */}
        {mapOnly > 0 && (
          <p className="mt-2 max-w-prose text-sm text-ink-2">
            These pages cover the{' '}
            {browsable.toLocaleString('en-GB')} campsites we can name a region
            for. The other {mapOnly.toLocaleString('en-GB')} have no region
            recorded yet, so they are on the map but have no page to browse to.
          </p>
        )}
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
