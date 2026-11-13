import { TRUST_LABEL, type TrustLegendRow, type TrustStatus } from '@/lib/trust';

// CAMP-521 — the word next to a value that says where the value came from.
//
// 🔴 VISIBLE TEXT, NOT AN ATTRIBUTE. `data-trust-status` is there for the
// guard to find the element; what the guard READS is the word a person
// reads. A status that lived only in an attribute, a class or a tooltip
// would be a status the page does not show.

export function TrustMark({
  status,
  className,
}: {
  status: TrustStatus;
  className?: string;
}) {
  return (
    <span data-trust-status={status} className={className}>
      {TRUST_LABEL[status]}
    </span>
  );
}

/**
 * What the status words on this page mean. Only the words that are on the
 * page, and only with a sentence from the CMS — no rows, no block.
 */
export function TrustLegend({
  heading,
  rows,
}: {
  heading: string | null;
  rows: readonly TrustLegendRow[];
}) {
  if (rows.length === 0 || !heading) return null;
  return (
    <section
      data-testid="trust-legend"
      aria-labelledby="trust-legend-heading"
      className="mt-8 rounded-card border border-line-2 bg-surface-2 p-4"
    >
      <h2
        id="trust-legend-heading"
        className="text-sm uppercase tracking-[0.08em] text-ink-2"
      >
        {heading}
      </h2>
      <dl className="mt-3 space-y-2 text-sm leading-6 text-ink-2">
        {rows.map((r) => (
          <div key={r.status} data-trust-meaning={r.status}>
            <dt className="inline font-semibold text-heading">{r.label}</dt>
            {' — '}
            {/* 🔴 The same sentence on every page that uses the word, so
                the near-duplicate guard leaves it out — the sentence only,
                not the row: WHICH words a page uses is the page's own. */}
            <dd className="inline" data-boilerplate="trust-meaning">
              {r.meaning}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
