import {
  describeTariff,
  formatPeriod,
  formatPrice,
  groupTariffs,
  isRenderableTariff,
  NO_SEASON_LABEL,
  policyLabel,
  type Tariff,
} from '@/lib/tariffs';
import { formatUpdated, SOURCES } from '@/lib/sources';

/**
 * Один спливний блок на всю таблицю; кожен значок «i» — його викликач
 * (CAMP-475). Сталий рядок, а не `useId()`: компонент серверний, і
 * `popoverTarget` мусить збігтись із `id` у тій самій відданій розмітці.
 * На сторінці одна таблиця цін, тож двох таких блоків не буває.
 */
const NOTE_ID = 'tariff-price-note';

/**
 * 🔴 ВИГЛЯД ЇДЕ В РОЗМІТЦІ, щоб тест читав правило з ВІДДАНОГО HTML, а
 * не з константи компонента — як у `pagination.tsx` і `hub-stats.tsx`.
 *
 * Розміри значка — з правила теми про зону натискання: 24px видимого
 * кружка мало для пальця, тому зона розсунута псевдоелементом до 44px
 * (CAMP-345 вимагає 48 для самостійних кнопок; цей значок стоїть
 * усередині рядка таблиці поруч із числом, тож 44 — компроміс, і він
 * названий, а не випадковий).
 */
const PRICE_NOTE_CSS = `
.ct-price{display:inline-flex;align-items:center;gap:6px}
.ct-price__i{position:relative;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 auto;border:1px solid var(--color-line-2);border-radius:50%;background:var(--color-surface);color:var(--color-ink-2);font-size:11px;font-weight:700;line-height:1;cursor:pointer}
.ct-price__i::after{content:"";position:absolute;top:50%;left:50%;width:44px;height:44px;transform:translate(-50%,-50%)}
.ct-price__i:hover,.ct-price__i:focus-visible{border-color:var(--color-heading);color:var(--color-heading)}
.ct-price__i:focus-visible{outline:2px solid var(--color-line-blue);outline-offset:2px}
.ct-price__noseason{font-style:italic}
.ct-price__popup{max-width:420px;margin:auto;padding:16px 20px;border:1px solid var(--color-line-2);border-radius:var(--r,16px);background:var(--color-surface);color:var(--color-ink);font-size:.875rem;line-height:1.6}
.ct-price__popup::backdrop{background:color-mix(in srgb, var(--ink) 35%, transparent)}
`;

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
// 🔴 EXPIRED SEASONS ARE SHOWN AND LABELLED, not hidden. Measured over
// published pages, which is the population this component renders for:
// 435 of the 1 200 pages that show a price have nothing but expired
// seasons. Hiding those would make them look identical to the 57 236
// pages that show no price at all, and would throw away the one useful
// thing we could tell that reader — that the operator's last published
// price was this, and when.
//
// (Earlier revisions of this comment said 449 and 6 157. Both were
// feed-level counts of DATAtourisme records, quoted in a file that
// renders pages; a campsite in the feed is not a page and the two
// populations differ by more than an order of magnitude.)

function Rows({
  tariffs,
  marker,
}: {
  tariffs: Tariff[];
  /**
   * The words stamped on every row of this group, or null for the
   * current one.
   *
   * 🔴 A string, not a boolean, because there are now two ways a price
   * can fail to be today's price and telling a reader the wrong one is
   * as bad as telling them nothing.
   */
  marker: string | null;
}) {
  return (
    <tbody>
      {tariffs.map((t, i) => {
        // 🔴 The guard that makes the rule structural rather than
        // editorial. A row whose price or season will not render is
        // dropped entirely — never rendered as a price beside a blank.
        // The API already refuses to send one; this is the second lock.
        //
        // It lives in lib/tariffs.ts rather than inline here because
        // half of it was unreachable through this component and could
        // therefore never be tested; see the note on the function.
        if (!isRenderableTariff(t)) return null;
        const price = formatPrice(t);
        const period = formatPeriod(t);
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
              <span className="ct-price">
                {price}
                {/* 🔴 CAMP-475. Той самий спливний блок на всі рядки —
                    один `popover`, багато викликачів. Нативний, тож
                    відкривається без жодного JS, закривається Escape і
                    кліком повз, і доступний із клавіатури. Ховер ОДИН
                    тут був би недоступним: з клавіатури навести не
                    можна. */}
                <button
                  type="button"
                  popoverTarget={NOTE_ID}
                  className="ct-price__i"
                  aria-label="Where this price comes from"
                >
                  i
                </button>
              </span>
            </td>
            <td className="py-2 text-ink-2">
              {period === null ? (
                <span className="ct-price__noseason">{NO_SEASON_LABEL}</span>
              ) : (
                <time dateTime={t.validFrom ?? t.validUntil ?? undefined}>
                  {period}
                </time>
              )}
              {marker && (
                // Said on the row as well as in the heading, because a
                // screen reader reaching this cell may not still have
                // the heading in mind, and the whole point is that
                // nobody mistakes it for today's price.
                <span
                  className="block font-semibold text-heading"
                  data-testid="tariff-marker"
                >
                  {marker}
                </span>
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
  now,
}: {
  tariffs: Tariff[] | undefined;
  /** Injected so a test can stand on a fixed day. Defaults to today. */
  now?: Date;
}) {
  // 🔴 Tolerant of the field being absent, like SourceNote above it. The
  // API and the site deploy separately; a price table that is missing is
  // a bug, a page that throws is an outage.
  const { current, upcoming, expired, olderExpired } = groupTariffs(
    tariffs ?? [],
    now ?? new Date(),
  );
  if (current.length === 0 && upcoming.length === 0 && expired.length === 0) {
    return null;
  }

  // Every tariff on this page comes from one source — the merge takes a
  // price list whole or not at all, precisely so this line can be true.
  const first = current[0] ?? upcoming[0] ?? expired[0];
  const source = SOURCES[first.sourceId];
  const updated = formatUpdated(first.sourceUpdatedAt);

  return (
    <section
      data-testid="tariffs"
      aria-labelledby="tariffs-heading"
      className="mt-8 rounded-card border border-line-2 bg-surface-2 p-4"
    >
      <style href="ct-price-note" precedence="ct-components">
        {PRICE_NOTE_CSS}
      </style>
      <h2
        id="tariffs-heading"
        className="text-sm uppercase tracking-[0.08em] text-ink-2"
      >
        What it costs
      </h2>

      <p className="mt-2 text-sm leading-6 text-ink-2">
        <span data-boilerplate="tariffs-intro">
          Published by the operator, not by us. Where the source states a
          season, it is shown beside the price; where it states none, the
          row says so.
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
                  dateTime={first.sourceUpdatedAt}
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
          <Rows tariffs={current} marker={null} />
        </table>
      )}

      {upcoming.length > 0 && (
        // 🔴 Its own block, and it used to have none. `groupTariffs`
        // swept a season starting next April into `current`, so 13 pages
        // printed "1 Apr 2027 – 30 Oct 2027" under "What it costs" with
        // nothing to say it had not begun. A price seven months away is
        // not today's price, and the reader planning tonight is the one
        // who pays for the confusion.
        <div className="mt-5" data-testid="tariffs-upcoming">
          <h3 className="text-sm text-heading">
            {current.length === 0
              ? 'These prices have not started yet'
              : 'A season that has not started'}
          </h3>
          <p className="mt-1 text-sm leading-6 text-ink-2">
            {current.length === 0
              ? 'The source publishes no price for this campsite today. What follows is a season that begins later — ask the operator what it costs now.'
              : 'Published ahead of time by the source. It does not apply yet.'}
          </p>
          <table className="mt-2 w-full text-sm leading-6">
            <caption className="sr-only">
              Prices for a season that has not begun
            </caption>
            <thead>
              <tr className="text-left text-ink-3">
                <th scope="col" className="pb-1 pr-3 font-normal">What</th>
                <th scope="col" className="pb-1 pr-3 font-normal">Price</th>
                <th scope="col" className="pb-1 font-normal">Season</th>
              </tr>
            </thead>
            <Rows tariffs={upcoming} marker="Not started" />
          </table>
        </div>
      )}

      {expired.length > 0 && (
        <div className="mt-5" data-testid="tariffs-expired">
          <h3 className="text-sm text-heading">
            {current.length === 0
              ? 'These prices have expired'
              : 'The last season that ended'}
          </h3>
          {/* The heading above and the per-row "Ended" below are two
              independent statements of the same fact, on purpose — see
              tariff-table.spec.tsx, where removing either one fails. */}
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
            <Rows tariffs={expired} marker="Ended" />
          </table>
        </div>
      )}

      {/* 🔴 CAMP-475. Застереження, яким оплачено показ недатованої ціни.
          Воно НЕ ховається у спливному блоці цілком: речення про те, що
          ціну встановлює оператор, стоїть у розмітці завжди, і читач
          екрана чує його без жодної взаємодії. Спливний блок — це спосіб
          не захаращувати таблицю, а не спосіб заховати застереження. */}
      <div
        popover="auto"
        id={NOTE_ID}
        className="ct-price__popup"
        data-testid="tariffs-price-note"
      >
        Prices come from the campsite&rsquo;s own listing in an official
        tourism network, and some of them carry no stated season. They can
        change. The final price is set by the campsite, not by us &mdash;
        please confirm it with them when you book. We are not the seller and
        take no payment.
      </div>

    </section>
  );
}
