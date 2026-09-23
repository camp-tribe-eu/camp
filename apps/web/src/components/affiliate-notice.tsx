import type { ReactNode } from 'react';
import Link from 'next/link';

// CAMP-56 — saying that a link earns us money, before it is clicked.
//
// 🔴 Why it cannot live in the footer. The rule everywhere that has one
// is proximity, not existence: the US FTC's endorsement guidance asks for
// a disclosure that is "clear and conspicuous" and hard to miss, and in
// the EU the Unfair Commercial Practices Directive (2005/29/EC) treats
// failing to identify commercial intent as a misleading omission. A line
// at the bottom of the page satisfies neither, because the reader decides
// to click before they ever reach it.
//
// So the disclosure sits WITH the link, above the fold of the decision.
//
// 🔴 There are no affiliate links on the site yet (CAMP-54, CAMP-68).
// This exists first on purpose: the day a commission link is added, the
// disclosure is already the way it gets added, rather than a thing
// somebody remembers to do afterwards.

/**
 * Variant A — a group notice.
 *
 * One sentence above a block of links. Best where several commission
 * links sit together, such as a list of rental providers: says it once,
 * clearly, without repeating itself down the page.
 */
export function AffiliateNotice({ children }: { children: ReactNode }) {
  return (
    <section data-testid="affiliate-notice">
      <p className="mb-2 flex max-w-prose items-start gap-2 text-xs leading-5 text-ink-2">
        <AffiliateMark />
        <span>
          If you book through these links we may earn a commission, at no
          cost to you. It does not affect the price, and it does not affect
          what we show — commission buys no place in our listings.{' '}
          <Link href="/legal/terms#links" className="underline">
            How this works
          </Link>
          .
        </span>
      </p>
      {children}
    </section>
  );
}

/**
 * Variant B — a mark on the single link.
 *
 * For a lone commission link inside prose or on a campsite page, where a
 * whole paragraph would be heavier than the thing it describes. The word
 * is written out — not an icon, not an asterisk — because a symbol the
 * reader has to decode is not a disclosure.
 */
export function AffiliateLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={href}
        // 🔴 `sponsored` is the value Google documents for a paid or
        // affiliate link, and `nofollow` is kept beside it for anything
        // that only understands the older one. `noopener` because the
        // link leaves our site.
        rel="sponsored nofollow noopener"
        className="underline decoration-line-blue underline-offset-2"
        data-testid="affiliate-link"
      >
        {children}
      </a>
      <AffiliateMark label />
    </span>
  );
}

/** The mark itself, so both variants say the same word the same way. */
function AffiliateMark({ label = false }: { label?: boolean }) {
  return (
    <span
      data-testid="affiliate-mark"
      // A real badge, in the text colour, at the text size — legible
      // rather than decorative. Nothing here is lighter or smaller than
      // the copy it sits in, which is the whole point.
      className="inline-flex shrink-0 items-center rounded-sm border border-line-blue bg-accent-surface px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-heading"
    >
      {label ? 'Affiliate link' : 'Affiliate'}
    </span>
  );
}
