import type { Metadata } from 'next';
import Link from 'next/link';
import { FUEL, longDate } from '@/lib/fuel';
import { abs, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

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

const TOOLS = [
  {
    href: '/tools/camper-trip-cost',
    title: 'What does a camper trip cost?',
    body: 'Fuel priced from the European Commission’s weekly bulletin, for all 27 member states. Campsite prices are yours to enter — we hold none, and say so.',
  },
  {
    href: '/tools/camper-packing-list',
    title: 'Camper packing list',
    body: 'Built from how you travel, ticked off as you go, and shareable with whoever is loading the van.',
  },
];

export default function ToolsIndex() {
  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          '@id': `${abs('/tools')}#page`,
          name: 'Tools',
          url: abs('/tools'),
          description:
            'Free planning tools for camper trips in the EU, built on published data.',
        })}
      />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">Tools</h1>
      <p className="mt-4 max-w-prose text-ink-2">
        Both work without an account and without JavaScript doing the thinking
        for you. Where a number comes from a measurement, the page says which
        measurement and when — the fuel figures below are from the week of{' '}
        {longDate(FUEL.bulletinDate)}.
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
          </li>
        ))}
      </ul>

      <p className="mt-10 max-w-prose text-ink-3">
        A camper comparison tool was planned alongside these. It needs rental
        models and prices from partners we have not integrated yet, and a
        comparison assembled from numbers we made up would undo the point of
        the other two. It arrives when the data does.
      </p>
    </main>
  );
}
