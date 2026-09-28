import {
  describeTariff,
  formatPeriod,
  formatPrice,
  groupTariffs,
  policyLabel,
  type Tariff,
} from '@/lib/tariffs';
import { formatUpdated, SOURCES } from '@/lib/sources';

// CAMP-147 — the campsite's price list.
//
// 🔴 A TABLE, because the data is a table. Measured over the whole feed:
// a priced campsite publishes a median of 3 tariffs and as many as 83,
// by pitch type and by season. "From €13.50" is one row of that, chosen
// by us, and it stops being true the week the high season starts. The
// reader who arrives in August is the one who pays for that choice.
//
// 🔴 EVERY ROW SHOWS ITS SEASON. Not a footnote, not a tooltip — the
// third column, on every row, because a price without its period is the
// thing this card forbids outright.
//
// 🔴 EXPIRED SEASONS ARE SHOWN AND LABELLED, not hidden. 449 campsites
// have nothing but expired seasons; hiding those would make them look
// identical to the 6 157 that publish no price at all, and would throw
// away the one useful thing we could tell that reader — that the
// operator's last published price was this, and when.

function Rows({
  tariffs,
  ended,
}: {
  tariffs: Tariff[];
  ended: boolean;
}) {
  return (
    <tbody>
      {tariffs.map((t, i) => {
        const price = formatPrice(t);
        const period = formatPeriod(t);
        // 🔴 The guard that makes the rule structural rather than
        // editorial. A row whose price or season will not render is
        // dropped entirely — never rendered as a price beside a blank.
        // The API already refuses to send one; this is the second lock.
        if (!price || !period) return null;
        const policy = policyLabel(t.policy);
        return (
          <tr
            key={`${t.sourceId}-${t.validFrom ?? ''}-${t.offer ?? ''}-${i}`}
            className="border-t border-line-2 align-top"
          >
            <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-2">
              {describeTariff(t)}
              {policy && policy !== 'Base rate' && (
                <span className="block text-ink-3">{policy}</span>
              )}
              {t.label && (
                // 🔴 The operator's own words, verbatim, with their
                // language. Never translated and never read for a
                // number — several of these sentences contain figures
                // that are not the price in the cell beside them.
                <span
                  lang={t.labelLang ?? undefined}
                  className="mt-1 block whitespace-pre-line text-ink-3"
                >
                  {t.label}
                </span>
              )}
            </th>
            <td className="py-2 pr-3 font-semibold text-heading tabular-nums">
              {price}
            </td>
            <td className="py-2 text-ink-2">
              <time dateTime={t.validFrom ?? t.validUntil ?? undefined}>
                {period}
              </time>
              {ended && (
                // Said on the row as well as in the heading, because a
                // screen reader reaching this cell may not still have
                // the heading in mind, and the whole point is that
                // nobody mistakes it for today's price.
                <span className="block font-semibold text-heading">Ended</span>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}

export default function TariffTable({
  tariffs,
  withheld = 0,
  now,
}: {
  tariffs: Tariff[] | undefined;
  withheld?: number;
  /** Injected so a test can stand on a fixed day. Defaults to today. */
  now?: Date;
}) {
  // 🔴 Tolerant of the field being absent, like SourceNote above it. The
  // API and the site deploy separately; a price table that is missing is
  // a bug, a page that throws is an outage.
  const { current, expired, olderExpired } = groupTariffs(
    tariffs ?? [],
    now ?? new Date(),
  );
  if (current.length === 0 && expired.length === 0) return null;

  // Every tariff on this page comes from one source — the merge takes a
  // price list whole or not at all, precisely so this line can be true.
  const sourceId = (current[0] ?? expired[0]).sourceId;
  const source = SOURCES[sourceId];
  const updated = formatUpdated((current[0] ?? expired[0]).sourceUpdatedAt);

  return (
    <section
      data-testid="tariffs"
      aria-labelledby="tariffs-heading"
      className="mt-8 rounded-card border border-line-2 bg-surface-2 p-4"
    >
      <h2
        id="tariffs-heading"
        className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-2"
      >
        What it costs
      </h2>

      <p className="mt-2 text-sm leading-6 text-ink-2">
        <span data-boilerplate="tariffs-intro">
          Published by the operator, not by us. Each price is shown with the
          season it applies to, because these are seasonal rates.
        </span>{' '}
        {source && (
          <>
            Source:{' '}
            <a
              href={source.url}
              className="underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {source.name}
            </a>
            {updated && (
              <>
                , last updated{' '}
                <time
                  dateTime={(current[0] ?? expired[0]).sourceUpdatedAt}
                  data-testid="tariffs-source-date"
                >
                  {updated}
                </time>
              </>
            )}
            .
          </>
        )}
      </p>

      {current.length > 0 && (
        <table className="mt-3 w-full text-sm leading-6">
          <caption className="sr-only">
            Prices published for this campsite, with the season each applies to
          </caption>
          <thead>
            <tr className="text-left text-ink-3">
              <th scope="col" className="pb-1 pr-3 font-normal">What</th>
              <th scope="col" className="pb-1 pr-3 font-normal">Price</th>
              <th scope="col" className="pb-1 font-normal">Season</th>
            </tr>
          </thead>
          <Rows tariffs={current} ended={false} />
        </table>
      )}

      {expired.length > 0 && (
        <div className="mt-5" data-testid="tariffs-expired">
          <h3 className="text-sm font-semibold text-heading">
            {current.length === 0
              ? 'These prices have expired'
              : 'The last season that ended'}
          </h3>
          <p className="mt-1 text-sm leading-6 text-ink-2">
            {/* 🔴 Said outright. A tariff whose season has passed shown
                without this line is not a price, it is history — and the
                reader concludes we invent things. */}
            {current.length === 0
              ? 'The source publishes no current price for this campsite. What follows is the last season it recorded, and it has ended — ask the operator for today’s rates.'
              : 'Kept here because the source still publishes it. It does not apply now.'}
            {olderExpired > 0 && (
              // The omission, stated. Some operators price week by week
              // and publish a year of them; the earlier seasons tell a
              // reader nothing the last one does not, but silently
              // dropping 64 rows would be us editing somebody's price
              // list without saying so.
              <>
                {' '}
                <span data-testid="tariffs-older">
                  The source also publishes {olderExpired} older{' '}
                  {olderExpired === 1 ? 'price' : 'prices'} from earlier
                  seasons, which are not shown.
                </span>
              </>
            )}
          </p>
          <table className="mt-2 w-full text-sm leading-6">
            <caption className="sr-only">
              Prices whose season has already ended
            </caption>
            <thead>
              <tr className="text-left text-ink-3">
                <th scope="col" className="pb-1 pr-3 font-normal">What</th>
                <th scope="col" className="pb-1 pr-3 font-normal">Price</th>
                <th scope="col" className="pb-1 font-normal">Season</th>
              </tr>
            </thead>
            <Rows tariffs={expired} ended />
          </table>
        </div>
      )}

      {withheld > 0 && (
        // 🔴 The gap, stated. The source publishes these with no season
        // at all and we will not print an undated price — but a table
        // that silently holds back two thirds of a price list has
        // misrepresented it by omission.
        <p
          className="mt-4 text-sm leading-6 text-ink-2"
          data-testid="tariffs-withheld"
        >
          The source publishes {withheld} further{' '}
          {withheld === 1 ? 'price' : 'prices'} for this campsite with no
          validity period. We do not show a price we cannot date.
        </p>
      )}
    </section>
  );
}
