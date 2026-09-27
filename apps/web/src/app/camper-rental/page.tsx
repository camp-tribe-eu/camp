import type { Metadata } from 'next';
import Link from 'next/link';
import RentalChecklist from '@/components/rental-checklist';
import RentalDisclosure from '@/components/rental-disclosure';
import RentalOfferSlot from '@/components/rental-offer-slot';
import { RentalShapes, RentalThresholds } from '@/components/rental-thresholds';
import { collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import { longDate } from '@/lib/fuel';
import {
  count,
  MEASURED,
  publishableCountries,
  rentalOffers,
} from '@/lib/rental';

// CAMP-4 / CAMP-54 — the camper rental landing page.
//
// 🔴 WHAT THIS PAGE IS FOR, GIVEN THAT WE CANNOT SELL ANYTHING YET.
//
// Camper rental is the project's primary monetisation route and we have
// no affiliate accounts (CAMP-98), no partner, no inventory and no
// prices. The temptation in that position is to publish a page that
// looks like a marketplace and is furnished with invented numbers. This
// is the other thing: a page that answers the questions a first-time
// renter in the Union actually has, from sources that can be named, and
// that leaves the commercial slot visibly empty until there is something
// honest to put in it.
//
// The content is deliberately the part nobody publishes in one piece —
// the licence line at 3 500 kg and everything else that changes at the
// same number, the dimensions that decide your toll class, the questions
// that decide the bill. That is also the part that does not go stale and
// does not need a partner's cooperation to write.

export const metadata: Metadata = {
  title: 'Renting a camper in the EU',
  description:
    'What a camper hire in the European Union actually commits you to: the 3.5 tonne licence line, toll classes set by height, payload, cross-border rules and the questions that decide the bill. No prices, because we hold none.',
  alternates: alternatesFor('/camper-rental'),
};

export default function CamperRentalHub() {
  const countries = publishableCountries();
  const offers = rentalOffers('hub');

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: 'Renting a camper in the EU',
            description:
              'Licence classes, vehicle dimensions, tolls, insurance and cross-border rules for hiring a camper in the European Union, with country pages for twelve member states.',
            path: '/camper-rental',
            items: countries.map((c) => ({
              name: `Renting a camper in ${c.name}`,
              path: `/camper-rental/${c.code}`,
            })),
          }),
        )}
      />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
        Renting a camper in the EU
      </h1>

      <p className="mt-4 max-w-prose text-ink-2">
        This page is about the things that are decided before you drive
        away: which licence covers the vehicle, what it is allowed to weigh
        once loaded, what it costs to take on a motorway, and what the
        contract has quietly made your problem. Those answers differ across
        the twenty-seven member states and they are not collected anywhere
        in one piece, which is the only reason this page exists.
      </p>

      <p className="mt-4 max-w-prose text-ink-2">
        <strong className="text-ink">
          There are no prices and no vehicles here.
        </strong>{' '}
        We hold no rental inventory, we have no partner, and we are not
        going to invent a fleet to look busier than we are. Every number on
        these pages is either a count of our own{' '}
        {count(MEASURED.total.spots)} campsite records — measured on{' '}
        <time dateTime={MEASURED.measuredAt}>
          {longDate(MEASURED.measuredAt)}
        </time>{' '}
        — or a limit somebody with the authority to set it wrote down, cited
        where it appears.
      </p>

      {/* 🔴 In the template from day one, above the content it qualifies,
          and truthful about the fact that it currently qualifies nothing.
          See components/rental-disclosure.tsx. */}
      <RentalDisclosure offers={offers.length} />

      <section
        aria-labelledby="mass-line-heading"
        className="mt-12 rounded-card border border-line-blue bg-accent-surface p-6"
      >
        <h2
          id="mass-line-heading"
          className="text-2xl font-bold text-heading"
        >
          Almost everything changes at 3 500 kg
        </h2>
        <p className="mt-3 max-w-prose text-ink-2">
          If you read one thing on this page, read this. A single number —
          the maximum authorised mass stamped on the vehicle — decides three
          separate things at once, and they are administered by three
          different sets of people who will not warn you about each other.
        </p>
        <ul className="mt-4 max-w-prose list-disc space-y-3 pl-5 text-ink-2">
          <li>
            <strong className="text-ink">Your licence.</strong> Category B
            covers motor vehicles up to 3 500 kg. Above that you need C1,
            which is a separate medical and a separate test — not something
            a rental desk can arrange on the morning of the hire.
          </li>
          <li>
            <strong className="text-ink">Your tolls.</strong> In Austria and
            Slovenia the vignette is sold for vehicles up to 3 500 kg and
            simply does not exist above it; heavier vehicles belong in the
            distance-based systems built for lorries, with an on-board unit
            obtained in advance. The same threshold recurs across central
            Europe.
          </li>
          <li>
            <strong className="text-ink">Your payload.</strong> The mass in
            running order of a motor caravan already counts a 75 kg driver
            and a nearly full fuel tank. What is left between that and 3 500
            kg is everything else you intend to carry — and fresh water
            weighs a kilogram a litre, so a full tank can be a third of it.
          </li>
        </ul>
        <p className="mt-4 max-w-prose text-sm leading-6 text-ink-2">
          Sources:{' '}
          <a
            className="underline"
            href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02006L0126-20220101"
            rel="noopener noreferrer"
            target="_blank"
          >
            Directive 2006/126/EC on driving licences, Article 4(4)
          </a>{' '}
          and{' '}
          <a
            className="underline"
            href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02012R1230-20190101"
            rel="noopener noreferrer"
            target="_blank"
          >
            Regulation (EU) No 1230/2012 on masses and dimensions
          </a>
          . Both are consolidated texts on EUR-Lex; a member state may
          transpose details differently, and its own transport authority is
          the last word.
        </p>
      </section>

      <RentalThresholds />
      <RentalShapes />
      <RentalChecklist />

      <section
        aria-labelledby="countries-heading"
        className="mt-12"
        data-testid="rental-country-index"
      >
        <h2 id="countries-heading" className="text-2xl font-bold text-heading">
          Twelve member states, in detail
        </h2>
        <p className="mt-3 max-w-prose text-ink-2">
          {/* 🔴 The number is twelve on purpose, and the page says why —
              the same argument CAMP-130 made against publishing 951
              templated guides. A reader is entitled to know whether they
              are looking at a considered list or a generated one. */}
          Not two hundred city pages. A page is here because there are
          things true of that country and not of its neighbour — a toll
          system, a winter rule, a law about where you may sleep — and
          because our own campsite records say something about it that they
          do not say about anywhere else. Countries where we could not meet
          both tests do not have a page, and would rather not have a thin
          one.
        </p>

        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {countries.map((c) => (
            <li
              key={c.code}
              className="rounded-card border border-line-2 bg-surface p-5"
            >
              <h3 className="text-lg font-semibold">
                <Link
                  className="text-heading underline"
                  href={`/camper-rental/${c.code}`}
                >
                  Renting a camper in {c.name}
                </Link>
              </h3>
              <p className="mt-2 text-ink-2">{c.angle}</p>
            </li>
          ))}
        </ul>
      </section>

      <RentalOfferSlot offers={offers} where="Europe" />

      <section
        aria-labelledby="missing-heading"
        className="mt-12 border-t border-line-2 pt-8"
      >
        <h2 id="missing-heading" className="text-xl font-semibold text-heading">
          What this section does not have yet, and why
        </h2>
        <p className="mt-3 max-w-prose text-ink-2">
          No prices, no availability, no vehicle listings and no partners.
          The affiliate applications are open and unanswered, and until they
          are answered there is nothing to show — so the slot above stays
          empty rather than being filled with something that looks like an
          offer.
        </p>
        <p className="mt-3 max-w-prose text-ink-2">
          When there are partners, they will arrive as plain links in this
          writing, not as a synchronised feed of somebody else&rsquo;s
          inventory. That is an architecture decision rather than a stage:
          mirroring a partner&rsquo;s prices means publishing numbers that
          are stale the week after, and it is the same reason{' '}
          <Link className="underline" href="/tools/camper-trip-cost">
            the trip cost calculator
          </Link>{' '}
          prices fuel from the European Commission and asks you for the
          campsite fee.
        </p>
      </section>
    </main>
  );
}
