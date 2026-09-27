import Link from 'next/link';

// CAMP-4 — the commercial disclosure, in the template rather than in the
// footer, and on every page of this section from its first day.
//
// 🔴 WHY IT IS AT THE TOP AND NOT AT THE BOTTOM.
//
// The Unfair Commercial Practices Directive (2005/29/EC) treats failing
// to identify the commercial intent of a communication as a misleading
// omission — Article 7(2) — and the affiliate networks' own terms require
// the same thing. Both are about the moment of decision: a reader decides
// whether to trust a recommendation while reading it, and a notice below
// the fold is read after that decision or not at all.
//
// 🔴 WHY IT SAYS SOMETHING DIFFERENT WHEN THERE ARE NO LINKS.
//
// Today there are no affiliate links anywhere on this site: the network
// applications are CAMP-98 and they are not done. A page that announced
// "some links here earn us commission" with no such link on it would be a
// false statement made in the name of honesty — small, but this section's
// entire argument is that we do not overstate.
//
// So the component takes the page's real offer count and tells the truth
// about it either way. That also means the day the first link appears,
// the disclosure is already how it appears, rather than something
// somebody has to remember.

export default function RentalDisclosure({ offers }: { offers: number }) {
  return (
    <aside
      data-testid="rental-disclosure"
      aria-label="How this section is funded"
      className="mt-6 rounded-card border border-line-blue bg-accent-surface p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-heading">
        How this page is paid for
      </h2>
      {offers > 0 ? (
        <p className="mt-2 max-w-prose text-sm leading-6 text-ink-2">
          <strong className="text-heading">
            Some links on this page are affiliate links.
          </strong>{' '}
          If you book through one, the provider may pay us a commission. It
          costs you nothing, it does not change the price, and it does not
          change anything else on this page — commission buys no place in our
          listings and no sentence in our writing. Every such link is marked
          before you click it.{' '}
          <Link href="/legal/terms#links" className="underline">
            How this works
          </Link>
          .
        </p>
      ) : (
        <p className="mt-2 max-w-prose text-sm leading-6 text-ink-2">
          <strong className="text-heading">
            There are no affiliate links on this page yet.
          </strong>{' '}
          Camper rental commission is how this site is meant to pay for
          itself, and we would rather say so than let you find out. We have
          no rental partner at the moment, so there is nothing here earning
          us anything — and nothing on this page has been written to make an
          offer look good. When that changes, every commission link will be
          marked as one before you click it.{' '}
          <Link href="/legal/terms#links" className="underline">
            How this works
          </Link>
          .
        </p>
      )}
    </aside>
  );
}
