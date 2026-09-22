import type { Metadata } from 'next';
import Link from 'next/link';
import { countryName, getCountries } from '@/lib/api';
import { collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-71, level 0. The root of the crawl path: home → here → country →
// region → campsite is four clicks, which is the card's criterion, and
// every one of them is a plain <a>. The map does not count — it renders
// client-side, so a crawler that does not run our JavaScript sees nothing.

export const metadata: Metadata = {
  title: 'Campsites in Europe',
  description:
    'Browse campsites, motorhome parks and camper stops across Europe by country and region.',
  alternates: alternatesFor('/camping'),
};

export default async function CampingIndex() {
  const countries = await getCountries();
  const total = countries.reduce((n, c) => n + c.spots, 0);

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: 'Campsites in Europe',
            description: `${total} campsites across ${countries.length} countries.`,
            path: '/camping',
            items: countries.map((c) => ({
              name: countryName(c.country),
              path: `/camping/${c.country}`,
            })),
          }),
        )}
      />
      <h1 className="text-3xl font-bold md:text-[42px]">Campsites in Europe</h1>
      <p className="mt-3 max-w-prose text-ink-2">
        {total.toLocaleString('en-GB')} campsites, motorhome parks and camper
        stops, from OpenStreetMap. Pick a country to see its regions.
      </p>

      {countries.length === 0 ? (
        <p className="mt-8 text-ink-2">No countries have been imported yet.</p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {countries.map((c) => (
            <li key={c.country}>
              <Link
                href={`/camping/${c.country}`}
                className="block rounded-card border border-line-2 bg-surface p-4 shadow-card transition-colors hover:border-line-blue"
              >
                <span className="font-semibold text-heading">
                  {countryName(c.country)}
                </span>
                <span className="mt-1 block text-sm text-ink-2">
                  <span className="tabular-nums">{c.spots}</span>{' '}
                  {c.spots === 1 ? 'campsite' : 'campsites'} ·{' '}
                  <span className="tabular-nums">{c.regions}</span>{' '}
                  {c.regions === 1 ? 'region' : 'regions'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
