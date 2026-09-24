import type { Metadata } from 'next';
import Link from 'next/link';
import TripCostCalculator from '@/components/trip-cost-calculator';
import FuelPriceTable from '@/components/fuel-price-table';
import { FUEL, isStale, longDate, ranked } from '@/lib/fuel';
import { abs, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-55 — "how much does a camper trip cost".
//
// 🔴 What makes this page different from the thousand others answering
// the same query: one of its numbers is a fact with a date on it, and it
// says plainly which one. The Commission's Weekly Oil Bulletin gives us
// the price of a litre in every member state, refreshed every Thursday.
// Campsite prices we do not have and do not pretend to.
//
// That is also why the page is worth indexing at all. A calculator whose
// inputs are all guesses is a widget; a calculator built on a published
// weekly measurement is a reason to come back.

export const metadata: Metadata = {
  title: 'What does a camper trip cost?',
  description:
    'Work out the cost of a camper trip with this week’s real fuel prices for all 27 EU countries, published by the European Commission.',
  alternates: alternatesFor('/tools/camper-trip-cost'),
};

/**
 * 🔴 Every answer here is checkable against the data in the same repo.
 *
 * FAQPage markup on invented answers is the fastest way to teach an
 * assistant to quote us wrongly, so these four are the only questions we
 * can answer from what we hold.
 */
function faq() {
  const diesel = ranked('diesel');
  const cheapest = diesel[0];
  const dearest = diesel[diesel.length - 1];
  const week = longDate(FUEL.bulletinDate);

  return [
    {
      q: 'Where is diesel cheapest in the EU right now?',
      a: `In the week of ${week}, ${cheapest.name}, at €${cheapest.price.toFixed(3)} a litre including taxes. The most expensive was ${dearest.name} at €${dearest.price.toFixed(3)}. Figures from the European Commission's Weekly Oil Bulletin.`,
    },
    {
      q: 'How much fuel does a motorhome use?',
      a: 'Somewhere between 8 and 18 litres per 100 km depending on size, load and terrain. We offer 12 as a starting point and expect you to replace it — we have not measured your vehicle, and a calculator that pretends otherwise is guessing at the largest part of your answer.',
    },
    {
      q: 'What does a campsite pitch cost per night?',
      a: 'We do not know, and we do not publish a number we have not got. This site links to campsite operators rather than mirroring their prices, so the pitch figure in the calculator is yours to enter.',
    },
    {
      q: 'How current are these fuel prices?',
      // 🔴 The last clause used to read "so the figures here are never
      // more than a few days behind the pumps". That is a claim about
      // THIS PAGE today, true only if somebody ran the fetch script this
      // week — and nothing enforced it. Worse, it was emitted inside
      // FAQPage markup, in the machine-readable form an assistant quotes
      // back. Now the answer states the week these figures are from and
      // describes the Commission's schedule as the Commission's, which
      // is the part that is true regardless of when we last refreshed.
      a: `They are the consumer prices for the week of ${week} — that date is on every price shown here. The European Commission collects the figures from member states on a Wednesday and publishes them the following day; this page is refreshed against that bulletin, and says so rather than claiming to be live.`,
    },
  ];
}

export default function TripCostPage() {
  const questions = faq();

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          '@id': `${abs('/tools/camper-trip-cost')}#app`,
          name: 'Camper trip cost calculator',
          url: abs('/tools/camper-trip-cost'),
          applicationCategory: 'TravelApplication',
          operatingSystem: 'Any',
          browserRequirements: 'Works without an account',
          // 🔴 Free, and said in the vocabulary rather than in prose,
          // because "is this behind a signup" is the first thing both a
          // reader and an assistant want to know.
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
          isAccessibleForFree: true,
        })}
      />
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          '@id': `${abs('/tools/camper-trip-cost')}#faq`,
          mainEntity: questions.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        })}
      />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
        What does a camper trip cost?
      </h1>
      <p className="mt-4 max-w-prose text-ink-2">
        Fuel is the part of a camper budget that moves, and it is the part
        anyone can look up: the European Commission publishes consumer prices
        for every EU country every Thursday. This calculator uses those,
        dated, for the week of {longDate(FUEL.bulletinDate)}.
      </p>
      <p className="mt-3 max-w-prose text-ink-2">
        What it does not do is guess at the rest.{' '}
        <strong className="text-ink">We hold no campsite prices</strong> — this
        site links to operators instead of mirroring their rates — so the pitch
        figure is yours to fill in, and the result tells you which half of the
        total came from a measurement and which half came from you.
      </p>

      {/* 🔴 isStale existed and nothing called it — a guard written and
          then left unwired, which is the same as not having one. If the
          bulletin has not been refreshed in three weeks the page says so
          in its own voice, above the numbers, instead of leaving the
          reader to do date arithmetic on a line of small print. */}
      {isStale(new Date()) && (
        <p
          data-testid="stale-fuel"
          className="mt-6 max-w-prose rounded-card border border-amber bg-surface-2 p-4 text-ink"
        >
          <strong>These prices are out of date.</strong> They are from{' '}
          {longDate(FUEL.bulletinDate)}, and the European Commission has
          published newer ones since. Treat the fuel figures below as
          historical until this page is refreshed.
        </p>
      )}

      <TripCostCalculator />

      <FuelPriceTable />

      <section className="mt-12" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-2xl font-bold text-heading">
          Questions we can actually answer
        </h2>
        <dl className="mt-4 max-w-prose space-y-5">
          {questions.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold text-heading">{f.q}</dt>
              <dd className="mt-1 text-ink-2">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-10 text-ink-2">
        Looking for somewhere to put the van?{' '}
        <Link className="underline" href="/map">
          The map
        </Link>{' '}
        has every campsite we hold, and{' '}
        <Link className="underline" href="/tools/camper-packing-list">
          the packing list
        </Link>{' '}
        covers what to take.
      </p>
    </main>
  );
}
