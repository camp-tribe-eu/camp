import type { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumbs from '@/components/breadcrumbs';
import { FUEL, FUEL_COUNTRIES, longDate } from '@/lib/fuel';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import { ButtonLink } from '@/components/button';

// CAMP-55 — the tools section.
//
// 🔴 Two tools, not three. The card also asked for a camper comparison
// tool; it is not here and it is not forgotten. Comparing rental models
// and prices needs partner data we do not have until the affiliate
// integration (CAMP-53), and a comparison built on numbers we invented
// would be the exact thing the other two tools are designed not to be.
// Written on the page rather than only in a ticket, so the gap reads as
// a decision.

export const metadata: Metadata = {
  title: 'Tools',
  description:
    'Free tools for planning a camper trip: what it costs with this week’s real EU fuel prices, and what to pack.',
  alternates: alternatesFor('/tools'),
};

// 🔴 CAMP-240. Three lines per tool, and each one is a claim about the
// tool's page that can be checked there: what you type in is the list of
// labels on the form (components/trip-cost-calculator.tsx,
// components/packing-list-builder.tsx), what comes back is what the
// component renders, and what it does not know is what the tool's own
// page already says it does not. The design (09-guides.html) has no
// index for these — only the two tools — so there is no layout to copy;
// the content comes from the tools, not from a template.
const TOOLS = [
  {
    href: '/tools/camper-trip-cost',
    title: 'What does a camper trip cost?',
    body: 'Fuel priced from the European Commission’s weekly bulletin, for all 27 member states. Campsite prices are yours to enter — we hold none, and say so.',
    youGive:
      'The country, diesel or petrol, your vehicle and what it burns, the distance, the nights, the people, and what you expect a pitch to cost.',
    youGet:
      'A total in which the part that comes from a published measurement is kept apart from the part that comes from you.',
    notKnown:
      'What any campsite charges. We hold no pitch prices, so leave the field empty and the total is fuel only.',
  },
  {
    href: '/tools/camper-packing-list',
    title: 'Camper packing list',
    body: 'Built from how you travel, ticked off as you go, and shareable with whoever is loading the van.',
    youGive:
      'The vehicle, the season, the nights and the people — and whether you cook, have mains electricity, travel with children or with a dog.',
    youGet:
      'A list in groups, with a quantity wherever one follows from your answers, and the ticks kept in the link you share.',
    notKnown:
      'What you are legally required to carry. Those rules differ between member states and change, so they are not on the list, and the page says so.',
  },
];

const crumbs = [
  { name: 'CampTribe', path: '/' },
  { name: 'Tools', path: '/tools' },
];

export default function ToolsIndex() {
  // 🔴 One page per member state, and their names come from the same file
  // the pages themselves are generated from (`FUEL_COUNTRIES` is what
  // `generateStaticParams` and the sitemap read), so this list cannot name
  // a page that does not exist or leave one out.
  const countries = FUEL_COUNTRIES.map((code) => ({
    code,
    name: FUEL.countries[code].name,
  })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      {/* 🔴 CAMP-240. This page carried a bare CollectionPage with no
          items and no breadcrumb. `collectionGraph` is what the hubs
          already use: the page, plus the list of what it links to. The
          list is the two tools, because that is the list a reader is
          given; the 27 country pages below are a second way in, not part
          of this collection. */}
      <script
        {...jsonLdProps(
          collectionGraph({
            name: 'Tools',
            description:
              'Free planning tools for camper trips in the EU, built on published data.',
            path: '/tools',
            items: TOOLS.map((t) => ({ name: t.title, path: t.href })),
          }),
        )}
      />
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <Breadcrumbs crumbs={crumbs} />

      <h1 className="mt-4 text-3xl font-bold leading-tight md:text-[42px]">
        Tools
      </h1>
      <p className="mt-4 max-w-prose text-ink-2">
        {/* 🔴 This paragraph used to promise that both tools "work
            without JavaScript" and pointed at "the fuel figures below",
            of which this page has none. Both were false, and on a site
            whose whole argument is that it does not overstate, a
            throwaway line of copy is exactly where that slips. */}
        Both are free and need no account. Where a number comes from a
        measurement, the page says which measurement and when — the trip
        cost calculator is built on fuel prices published by the European
        Commission for the week of {longDate(FUEL.bulletinDate)}, and its
        table of all 27 countries is served as plain HTML, so it reads
        without JavaScript.
      </p>

      <ul className="mt-8 grid gap-6 md:grid-cols-2">
        {TOOLS.map((t) => (
          <li
            key={t.href}
            className="rounded-card border border-line-2 bg-surface p-5"
          >
            <h2 className="text-xl font-semibold">
              <Link className="text-heading underline" href={t.href}>
                {t.title}
              </Link>
            </h2>
            <p className="mt-2 text-ink-2">{t.body}</p>
            <dl className="mt-4 space-y-3 text-sm leading-6">
              <div>
                <dt className="font-semibold text-heading">You give it</dt>
                <dd className="text-ink-2">{t.youGive}</dd>
              </div>
              <div>
                <dt className="font-semibold text-heading">You get</dt>
                <dd className="text-ink-2">{t.youGet}</dd>
              </div>
              <div>
                <dt className="font-semibold text-heading">
                  What it does not know
                </dt>
                <dd className="text-ink-2">{t.notKnown}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {/* 🔴 CAMP-240. The calculator has a page for every member state —
          the same worked example priced with that country's fuel, and
          the neighbours' prices beside it — and until now the only way
          to one was through the calculator's table. A hub that links to
          two of the twenty-nine pages under it is not much of a hub. */}
      <section aria-labelledby="by-country-heading" className="mt-12">
        <h2
          id="by-country-heading"
          className="text-xl font-bold md:text-[25px]"
        >
          Fuel prices, country by country
        </h2>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          One page for each of the {countries.length} member states, priced
          with that country&rsquo;s fuel for the week of{' '}
          {longDate(FUEL.bulletinDate)}.
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-2 gap-y-3">
          {countries.map((c) => (
            <li key={c.code}>
              <ButtonLink
                href={`/tools/camper-trip-cost/${c.code.toLowerCase()}`} size="sm">
                {c.name}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 max-w-prose text-ink-3">
        A camper comparison tool was planned alongside these. It needs rental
        models and prices from partners we have not integrated yet, and a
        comparison assembled from numbers we made up would undo the point of
        the other two. It arrives when the data does.
      </p>
    </main>
  );
}
