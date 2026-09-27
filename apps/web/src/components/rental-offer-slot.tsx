import Link from 'next/link';
import { AffiliateLink, AffiliateNotice } from '@/components/affiliate-notice';
import type { Offer } from '@/lib/affiliate';

// CAMP-4 — where a commission link goes, and what stands there until one
// exists.
//
// 🔴 THE EMPTY STATE IS THE FEATURE.
//
// There are no affiliate accounts yet (CAMP-98), so `offers` is an empty
// array on every page of this section in every build made today. The easy
// thing would be to render nothing at all. This renders the slot, says
// plainly that it is empty and why, and offers the reader the thing we
// can actually give them instead — our own campsite data and the fuel
// calculator, neither of which pays us anything.
//
// Three reasons, in order of how much they cost to get wrong:
//
//   1. An invented offer is the worst thing this page could contain. No
//      price, no vehicle, no company and no availability exists here, and
//      "from €69/day" as a placeholder would be a lie that outlives the
//      placeholder.
//   2. A section that silently disappears cannot be reviewed. Visible
//      emptiness is a to-do that the owner, and any reader, can see.
//   3. The disclosure has to be part of the template rather than part of
//      the launch. Wiring it now means the first real link is disclosed
//      by construction.

export default function RentalOfferSlot({
  offers,
  where,
}: {
  offers: Offer[];
  /** Named in the empty state, so the reader knows what is missing. */
  where: string;
}) {
  if (offers.length === 0) {
    return (
      <section
        data-testid="rental-offer-slot"
        data-state="empty"
        aria-labelledby="rental-offers-heading"
        className="mt-10 rounded-card border border-dashed border-line-2 bg-surface-2 p-5"
      >
        <h2
          id="rental-offers-heading"
          className="text-xl font-semibold text-heading"
        >
          Where to rent one in {where}
        </h2>
        <p className="mt-3 max-w-prose text-ink-2">
          We have no rental partner for {where}, so there is nothing here to
          click. We are not going to fill the gap with a company we have no
          relationship with, a price nobody quoted us or a vehicle nobody has
          seen — every other number on this page is one we measured, and a
          made-up one here would tell you exactly how much the rest is worth.
        </p>
        <p className="mt-3 max-w-prose text-ink-2">
          What we can give you today is the part that is ours:{' '}
          <Link className="underline" href="/search">
            search
          </Link>{' '}
          and{' '}
          <Link className="underline" href="/map">
            the map
          </Link>{' '}
          cover every campsite we hold, and{' '}
          <Link className="underline" href="/tools/camper-trip-cost">
            the trip cost calculator
          </Link>{' '}
          prices the fuel from the European Commission&rsquo;s weekly
          bulletin. None of those pays us anything either.
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="rental-offer-slot"
      data-state="filled"
      aria-labelledby="rental-offers-heading"
      className="mt-10 rounded-card border border-line-2 bg-surface p-5"
    >
      <h2
        id="rental-offers-heading"
        className="text-xl font-semibold text-heading"
      >
        Where to rent one in {where}
      </h2>
      {/* 🔴 The group notice, above the links rather than under them. See
          components/affiliate-notice.tsx for why proximity rather than
          existence is the rule that matters. */}
      <AffiliateNotice>
        <ul className="mt-3 space-y-4">
          {offers.map((offer) => (
            <li
              key={`${offer.network.id}-${offer.programme}`}
              className="border-t border-line-2 pt-4 first:border-0 first:pt-0"
            >
              <h3 className="font-semibold text-heading">
                <AffiliateLink href={offer.href}>{offer.programme}</AffiliateLink>
              </h3>
              {/* Our sentence about the partner, never theirs — see the
                  `note` field in lib/affiliate.ts. */}
              <p className="mt-1 max-w-prose text-ink-2">{offer.note}</p>
            </li>
          ))}
        </ul>
      </AffiliateNotice>
    </section>
  );
}
