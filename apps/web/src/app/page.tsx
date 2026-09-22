import type { Metadata } from 'next';
import Link from 'next/link';
import {
  countryName,
  formatDistance,
  getCountries,
  getNotable,
  getSummary,
  SPOT_TYPE_LABEL,
  WATER_LABEL,
} from '@/lib/api';
import { abs, jsonLdProps } from '@/lib/jsonld';

// CAMP-41 — the home page.
//
// The card states the job in one line: a reader wants to answer three
// questions — where to stay, which way to drive, what to drive — and the
// page must answer them rather than be a shop window.
//
// 🔴 Two decisions made against the mock-up, both for the same reason.
//
// The mock-up's headline reads "55,376 campsites across Europe". We have
// a fraction of that. Printing the aspiration would be the same lie as a
// stock photograph of a place nobody visited, on the most-read page we
// own, so the number is read from the database and grows on its own —
// as it did the day Croatia was imported, with no change here.
//
// The mock-up's hero is a search form. Search does not exist yet
// (CAMP-67) and a box that swallows what you type is worse than no box.
// The hero is a country chooser instead: it is still a form in the sense
// that matters — you state where you are going and it takes you there —
// and it works with JavaScript off, which the search box would not.
//
// What is deliberately absent: routes, rentals and guides sections. They
// have no pages behind them (CAMP-45, CAMP-54, CAMP-66). A section that
// describes something a reader cannot reach is an advertisement for our
// own backlog.

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default async function Home() {
  const [summary, countries, notable] = await Promise.all([
    getSummary(),
    getCountries(),
    getNotable(),
  ]);

  return (
    <main>
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          '@id': `${abs('/')}#website`,
          name: 'CampTribe',
          url: abs('/'),
          description:
            'Campsites across Europe with their surroundings calculated from open data.',
        })}
      />

      <Hero summary={summary} countries={countries} />
      <HowItWorks />
      <Countries countries={countries} />
      <Notable spots={notable} />
    </main>
  );
}

function Hero({
  summary,
  countries,
}: {
  summary: Awaited<ReturnType<typeof getSummary>>;
  countries: Awaited<ReturnType<typeof getCountries>>;
}) {
  return (
    <section className="border-b border-line-2 bg-surface">
      <div className="mx-auto max-w-wrap px-4 py-12 md:py-16 xl:px-6">
        <h1 className="max-w-[18ch] text-3xl font-bold leading-tight md:text-[42px]">
          Every campsite, and what is around it
        </h1>
        <p className="mt-4 max-w-prose text-ink-2">
          {/* The real count, from the database. It reads as small today
              and that is correct — it is the number we can stand behind. */}
          {summary.spots.toLocaleString('en-GB')} campsites and motorhome
          parks across {summary.regions.toLocaleString('en-GB')} regions, each
          with the distance to water, to the nearest town and to a railway
          station, its elevation and its terrain — calculated by us, published
          by nobody else.
        </p>

        {/* 🔴 The two funnels as separate cards, not tabs. A tab hides one
            of them behind a click, and the mock-up's own note (CAMP-81) is
            that an inactive tab is not an entrance. */}
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-card border border-line-2 bg-bg p-5">
            <h2 className="text-base font-semibold">Where to stay</h2>
            <p className="mt-1 text-sm text-ink-2">
              Pick a country to see its regions and campsites.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {countries.map((c) => (
                <li key={c.country}>
                  <Link
                    href={`/camping/${c.country}`}
                    className="inline-flex h-10 items-center gap-2 rounded border border-line bg-surface px-3 text-sm font-medium text-heading transition-colors hover:border-line-blue"
                  >
                    {countryName(c.country)}
                    <span className="tabular-nums text-ink-2">{c.spots}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm">
              <Link href="/camping" className="underline">
                All campsites
              </Link>
            </p>
          </div>

          {/* 🔴 The second funnel is named and honestly empty rather than
              hidden. Removing it would misrepresent what the site is for;
              inventing a rental listing would misrepresent what it has. */}
          <div className="rounded-card border border-dashed border-line bg-transparent p-5">
            <h2 className="text-base font-semibold text-ink-2">
              What to drive
            </h2>
            <p className="mt-1 max-w-prose text-sm text-ink-2">
              Camper rental comparison is not built yet. When it is, it will
              compare what actually decides a trip — licence category, weight
              and whether the vehicle fits the campsite — not the price you
              could already find elsewhere.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: 'Find places',
      body:
        'Campsites from OpenStreetMap, refreshed weekly, with the gaps shown as gaps rather than filled in with guesses.',
    },
    {
      title: 'See the surroundings',
      body:
        'How far the lake is, how high the site sits, whether a train stops within walking distance — computed for every campsite.',
    },
    {
      title: 'Plan the drive',
      body:
        'Route planning and weather along the way are being built. Nothing here pretends they are ready.',
    },
  ];

  return (
    <section className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
      <h2 className="text-xl font-bold md:text-[25px]">How this works</h2>
      <ol className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
              Step {i + 1}
            </span>
            <h3 className="mt-1 text-base font-semibold">{s.title}</h3>
            <p className="mt-1 max-w-prose text-sm text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * 🔴 The most important section on the page, and not for people.
 *
 * Almost nobody arrives at a directory through its home page — they land
 * on a deep page from a search. What the home page is for is giving the
 * crawler a route into the country hubs, and through them into every
 * campsite. That is why this is a plain list of links and not a carousel:
 * a carousel shows one item and hides the rest behind JavaScript.
 */
function Countries({
  countries,
}: {
  countries: Awaited<ReturnType<typeof getCountries>>;
}) {
  if (countries.length === 0) return null;
  return (
    <section className="border-y border-line-2 bg-surface">
      <div className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
        <h2 className="text-xl font-bold md:text-[25px]">Countries</h2>
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {countries.map((c) => (
            <li key={c.country}>
              <Link
                href={`/camping/${c.country}`}
                className="block rounded-card border border-line-2 bg-bg p-4 transition-colors hover:border-line-blue"
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
      </div>
    </section>
  );
}

/**
 * 🔴 "The ones we know most about", and the heading says exactly that.
 *
 * Not "featured", not "best", not "top rated". We have no reviews, no
 * ratings and nobody has visited any of these, so a claim of quality
 * would be invented — on the home page, which is the worst place to
 * start inventing. The ranking is a fact about our data: how many
 * amenities are actually recorded, and whether there is a named lake or
 * river nearby.
 */
function Notable({ spots }: { spots: Awaited<ReturnType<typeof getNotable>> }) {
  if (spots.length === 0) return null;
  return (
    <section className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
      <h2 className="text-xl font-bold md:text-[25px]">
        The campsites we know most about
      </h2>
      <p className="mt-2 max-w-prose text-sm text-ink-2">
        Ranked by how much has actually been recorded about them, not by any
        opinion of ours — we have not been to any of them, and there are no
        reviews on this site.
      </p>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spots.map((s) => {
          const region = (s.region ?? '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          const water = s.context?.water;
          const known = Object.values(s.amenities ?? {}).filter(
            (v) => v !== 'unknown',
          ).length;
          return (
            <li
              key={s.slug}
              className="rounded-card border border-line-2 bg-surface p-4 shadow-card"
            >
              <Link
                href={`/camping/${s.country.toLowerCase()}/${region}/${s.slug}`}
                className="font-semibold text-heading hover:underline"
              >
                {s.name ?? SPOT_TYPE_LABEL[s.type]}
              </Link>
              <p className="mt-1 text-sm text-ink-2">
                {s.region}
                {water?.name
                  ? ` · ${formatDistance(water.m)} from ${water.name}`
                  : water
                    ? ` · ${formatDistance(water.m)} from the nearest ${WATER_LABEL[
                        water.kind
                      ].toLowerCase()}`
                    : ''}
              </p>
              <p className="mt-2 text-xs text-ink-2">
                <span className="tabular-nums">{known}</span> of 5 facilities
                recorded
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
