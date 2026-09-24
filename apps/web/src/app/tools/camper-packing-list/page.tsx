import type { Metadata } from 'next';
import Link from 'next/link';
import PackingListBuilder from '@/components/packing-list-builder';
import { abs, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-55 — the packing list.
//
// 🔴 The section that is deliberately missing, said out loud on the page
// rather than only in the code. What a driver must legally carry differs
// by member state and changes; /guides refuses to write about
// jurisdictions we have not checked and our terms disclaim that advice.
// A reader who finds no vest on the list should learn why here, not
// discover it at a roadside check.

export const metadata: Metadata = {
  title: 'Camper packing list',
  description:
    'A packing list for a camper trip, built from how you travel — vehicle, season, nights, people. Shareable as a link, and honest about what it leaves out.',
  alternates: alternatesFor('/tools/camper-packing-list'),
};

export default function PackingListPage() {
  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          '@id': `${abs('/tools/camper-packing-list')}#app`,
          name: 'Camper packing list',
          url: abs('/tools/camper-packing-list'),
          applicationCategory: 'TravelApplication',
          operatingSystem: 'Any',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
          isAccessibleForFree: true,
        })}
      />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
        Camper packing list
      </h1>
      <p className="mt-4 max-w-prose text-ink-2">
        Answer four things and the list adjusts: a tent needs a mallet and
        sleeping mats, a motorhome needs levelling ramps and a water hose, and
        a pitch with electricity needs a cable rather than a power bank. Tick
        things off and the link keeps the ticks, so you can send it to whoever
        is actually loading the van.
      </p>

      <section className="mt-6 max-w-prose rounded-card border border-line-2 bg-surface-2 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-2">
          What is not on this list
        </h2>
        <p className="mt-2 text-ink-2">
          <strong className="text-ink">
            Anything you are legally required to carry.
          </strong>{' '}
          Warning triangles, reflective vests, spare bulbs, breathalysers and
          winter-tyre rules differ between EU countries and they change. We
          have not checked twenty-seven sets of road rules, so we are not going
          to put them in a checkbox where they would read as verified. Check
          the rules for each country you drive through before you go — your
          national motoring organisation publishes them.
        </p>
      </section>

      <PackingListBuilder />

      <p className="mt-10 text-ink-2">
        Working out the budget too?{' '}
        <Link className="underline" href="/tools/camper-trip-cost">
          The trip cost calculator
        </Link>{' '}
        uses this week&rsquo;s real fuel prices for every EU country.
      </p>
    </main>
  );
}
