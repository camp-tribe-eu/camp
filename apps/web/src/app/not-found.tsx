import Link from 'next/link';
import { countryName, getCountries, getPlaces } from '@/lib/api';
import PathRecovery from '@/components/path-recovery';

// CAMP-73 — the 404.
//
// 🔴 Why this is not a detail for us specifically. The OSM import runs
// weekly (CAMP-28): campsites disappear, tags change, slugs are rebuilt.
// Dead URLs are guaranteed, and organic traffic will keep arriving at
// them from a Google index that has not recrawled yet. An empty 404 is a
// visitor we did not pay for and did not get either.
//
// So this page does three things in order of how much they help:
// work out what the reader meant from the URL, offer the country and
// region hubs, and only then apologise.
//
// 🔴 The search box the card asked for is here as of CAMP-67. It was
// deliberately absent before — there was no search on the site, and a box
// that goes nowhere is worse than no box. Now there is one, so the
// promise this page makes is one it can keep.

export default async function NotFound() {
  // Both are already cached by the API layer, and this page is built
  // once, so the cost is paid at build time and never again.
  const [places, countries] = await Promise.all([getPlaces(), getCountries()]);

  return (
    <main className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-2">
        404
      </p>
      <h1 className="mt-2 text-3xl font-bold md:text-[42px]">
        That page is not here
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        Campsite data comes from OpenStreetMap and we reimport it every week,
        so addresses do change. Nothing is lost — here is the way back in.
      </p>

      {/* 🔴 A GET form, not a script. It works with JavaScript switched
          off — which matters more here than anywhere else on the site,
          because this is the page a reader lands on when something has
          already gone wrong. */}
      <form action="/search" method="get" className="mt-6 flex max-w-lg gap-2">
        <label htmlFor="nf-q" className="sr-only">
          Search campsites
        </label>
        <input
          id="nf-q"
          name="q"
          type="search"
          placeholder="A campsite, a region, or a place nearby"
          data-testid="notfound-search"
          className="h-11 flex-1 rounded-sm border border-line-2 bg-surface px-3 text-base text-heading placeholder:text-ink-3"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-sm border border-line-blue bg-accent-surface px-4 text-sm font-semibold text-heading"
        >
          Search
        </button>
      </form>

      <PathRecovery places={places} />

      <section className="mt-8">
        <h2 className="text-xl font-bold md:text-[25px]">Browse by country</h2>
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

      <p className="mt-8 text-sm text-ink-2">
        Or start from{' '}
        <Link href="/camping" className="underline">
          all campsites
        </Link>{' '}
        or{' '}
        <Link href="/map" className="underline">
          the map
        </Link>
        .
      </p>
    </main>
  );
}
