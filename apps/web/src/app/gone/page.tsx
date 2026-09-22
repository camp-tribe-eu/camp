import type { Metadata } from 'next';
import Link from 'next/link';
import { countryName, getCountries, type GoneSpot } from '@/lib/api';
// 🔴 Read from the file scripts/gen-gone.mjs wrote this build, not
// fetched. Calling the API here gave a copy that Next served from its
// fetch cache, and the middleware — which reads the generated file —
// then returned 410 for a campsite this page could not name. One file,
// written once per build, cannot disagree with itself.
import GONE from '@/generated/gone.json';
import GoneNotice from '@/components/gone-notice';

// CAMP-73 — the body served, with a 410, at the address of a campsite
// that no longer exists.
//
// 🔴 410 rather than 404, and the difference is not pedantry. A 404 says
// "nothing here", which Google treats as possibly temporary and keeps
// recrawling for months. A 410 says "gone on purpose", and it is dropped
// from the index far faster. With a weekly OSM import behind us, we will
// have a steady trickle of these, and we would rather spend our crawl
// budget on campsites that exist.
//
// 🔴 The page also exists at /gone as an ordinary URL, so it can be
// looked at, tested and styled like anything else — but it is `noindex`,
// because /gone itself is not a page anyone should find in search.

export const metadata: Metadata = {
  title: 'Campsite no longer listed',
  description:
    'This campsite has been removed from OpenStreetMap and is no longer listed.',
  robots: { index: false, follow: true },
};

export default async function GonePage() {
  const gone = GONE as GoneSpot[];
  const countries = await getCountries();

  return (
    <main className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-2">
        410 · Gone
      </p>
      <h1 className="mt-2 text-3xl font-bold md:text-[42px]">
        This campsite is no longer listed
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        We only list campsites that are in OpenStreetMap. When one is removed
        there and stays removed across four weekly imports, we take it down
        rather than leave a page describing a place that is not there.
      </p>

      <GoneNotice gone={gone} />

      <section className="mt-8">
        <h2 className="text-xl font-bold md:text-[25px]">Keep looking</h2>
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
        <p className="mt-4 text-sm text-ink-2">
          Or open{' '}
          <Link href="/map" className="underline">
            the map
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
