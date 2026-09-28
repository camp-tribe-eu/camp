import { expect, test } from '@playwright/test';
import { renderComponent, rendersNothing } from './render-component';
import TariffTable from '@/components/tariff-table';
import type { Tariff } from '@/lib/tariffs';

// CAMP-147 — the RENDERED price panel, and the reason this file exists.
//
// 🔴 It did not exist, and an adversarial review proved what that cost.
// With the per-row "Ended" marker, the "These prices have expired"
// heading and the "ask the operator for today's rates" sentence all
// deleted, the whole web suite still reported 457 passed / 0 failed —
// and `verify-prices.ts` went on printing "435 — these pages say so
// rather than staying silent" about a page that by then said nothing at
// all. Only an `sr-only` caption survived, so a sighted reader was told
// nothing whatsoever.
//
// The data layer was never the weak half: four separate mutations
// against `hasValidityPeriod` and `DISPLAYABLE_TARIFF_SQL` were caught.
// The rendering was untested, and the rendering is what the reader gets.
//
// 🔴 So these assert TEXT A PERSON CAN SEE, never a class name and never
// an sr-only caption. `renderToStaticMarkup` is the same server render
// the static export performs.

// 🔴 Rendered through `render-component.ts`, never with JSX in this file.
// Playwright compiles JSX with its own hard-coded runtime, so both the
// spec's JSX and the component's come out as `{__pw_type, ...}` objects
// that React refuses. The bridge converts them and then calls the real
// `renderToStaticMarkup`. Read the note at the top of that file before
// changing any of this.
const render = (
  tariffs: Tariff[] | undefined,
  opts: { withheld?: number; now?: Date } = {},
): string =>
  renderComponent(TariffTable, {
    tariffs,
    withheld: opts.withheld ?? 0,
    now: opts.now ?? new Date('2026-11-15T00:00:00Z'),
  });

const nothing = (tariffs: Tariff[] | undefined): boolean =>
  rendersNothing(TariffTable, {
    tariffs,
    withheld: 0,
    now: new Date('2026-11-15T00:00:00Z'),
  });

/** Everything a person would actually read, tags and sr-only removed. */
const visibleText = (html: string): string =>
  html
    .replace(/<caption class="sr-only">.*?<\/caption>/gs, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tariff = (over: Partial<Tariff> = {}): Tariff => ({
  offer: 'BarePitch',
  mode: 'Overnight',
  policy: 'BaseRateFullRate',
  minPrice: '18.00',
  maxPrice: '25.00',
  currency: 'EUR',
  validFrom: '2026-04-01',
  validUntil: '2026-10-30',
  label: null,
  labelLang: null,
  sourceUpdatedAt: '2026-08-31',
  sourceId: 'datatourisme',
  ...over,
});

// ── the card's central prohibition, at the pixel ────────────────────────

test.describe('an expired price says so where a person can read it', () => {
  // The review's own scenario: a 01.04–30.10.2026 season rendered on
  // 15 November 2026.
  const html = () => render([tariff()]);

  test('🔴 the price is never shown without the word Ended', () => {
    const text = visibleText(html());
    expect(text).toContain('€18');
    expect(text).toContain('Ended');
  });

  test('🔴 the heading says the prices have expired', () => {
    expect(visibleText(html())).toContain('These prices have expired');
  });

  test('🔴 the reader is told to ask the operator', () => {
    expect(visibleText(html())).toContain('ask the operator');
  });

  test('the season itself is printed beside the price', () => {
    expect(visibleText(html())).toContain('1 Apr 2026');
    expect(visibleText(html())).toContain('30 Oct 2026');
  });

  test('none of that survives only as a screen-reader caption', () => {
    // 🔴 The exact hole the review walked through. Stripping every
    // sr-only caption must not strip the warning with it.
    const stripped = visibleText(html());
    expect(stripped).toContain('expired');
  });

  test('the marker is on the row, not only in the heading', () => {
    // A reader who lands mid-table has lost the heading. Counted per
    // row, so deleting the row marker fails even though the heading
    // still passes the test above.
    const out = render([tariff(), tariff({ minPrice: '30.00' })]);
    expect(out.split('Ended').length - 1).toBe(2);
  });
});

test.describe('a season that has not started says so too', () => {
  const html = () =>
    render([tariff({ validFrom: '2027-04-01', validUntil: '2027-10-30' })]);

  test('🔴 it is not printed as if it were today’s price', () => {
    // 13 live pages did exactly that before this group existed.
    const text = visibleText(html());
    expect(text).toContain('1 Apr 2027');
    expect(text).toContain('Not started');
  });

  test('the heading says it has not started', () => {
    expect(visibleText(html())).toContain('have not started yet');
  });

  test('a current season is NOT stamped with a marker', () => {
    // The marker has to mean something. A panel that stamps every row
    // teaches the reader to ignore it.
    const text = visibleText(
      render([tariff({ validFrom: '2026-11-01', validUntil: '2026-12-31' })]),
    );
    expect(text).toContain('€18');
    expect(text).not.toContain('Ended');
    expect(text).not.toContain('Not started');
  });
});

// ── everything else the panel promises ──────────────────────────────────

test.describe('the panel keeps its other promises', () => {
  const current = tariff({ validFrom: '2026-11-01', validUntil: '2026-12-31' });

  test('the source and its update date are on the page', () => {
    // Licence Ouverte 2.0: the source AND the date it last updated what
    // we reuse. On the panel, not only in the footer.
    const text = visibleText(render([current]));
    expect(text).toContain('DATAtourisme');
    expect(text).toContain('31 August 2026');
  });

  test('🔴 the withheld count is stated, not swallowed', () => {
    const text = visibleText(render([current], { withheld: 8 }));
    expect(text).toContain('8 further');
    expect(text).toContain('cannot date');
  });

  test('nothing is claimed when there is nothing to show', () => {
    expect(nothing([])).toBe(true);
    expect(nothing(undefined)).toBe(true);
  });

  test('🔴 an undated tariff cannot be rendered even if one arrives', () => {
    // The API filters these in SQL and `groupTariffs` filters them
    // again. This is the third lock, at the last possible moment.
    expect(nothing([tariff({ validFrom: null, validUntil: null })])).toBe(true);
  });

  test('the operator’s own words carry their language', () => {
    const html = render([
      current,
      tariff({
        validFrom: '2026-11-01',
        validUntil: '2026-12-31',
        label: 'Pour une nuit avec électricité',
        labelLang: 'fr',
      }),
    ]);
    expect(html).toContain('lang="fr"');
    expect(visibleText(html)).toContain('Pour une nuit avec');
  });

  test('older seasons that are not shown are counted out loud', () => {
    const text = visibleText(
      render([
        tariff({ validFrom: '2026-09-01', validUntil: '2026-10-30' }),
        tariff({ validFrom: '2026-04-01', validUntil: '2026-06-30' }),
        tariff({ validFrom: '2026-01-01', validUntil: '2026-03-30' }),
      ]),
    );
    expect(text).toContain('2 older');
  });

  test('🔴 a season with no amount is dropped, not drawn with a blank price', () => {
    // 🔴 The reachable half of the row guard. A tariff that HAS a season
    // and no figure survives `displayableTariffs` — the period is all
    // that step asks about — so this component is the last thing between
    // it and a row reading "Bare pitch, per night … … 1 Nov 2026".
    const html = render([
      current,
      tariff({
        validFrom: '2026-11-01',
        validUntil: '2026-12-31',
        offer: 'TouristTax',
        minPrice: null,
        maxPrice: null,
      }),
    ]);
    expect(visibleText(html)).toContain('€18');
    expect(visibleText(html)).not.toContain('Tourist tax');
    // One row in the current table, not two.
    expect(html.split('<tr class="border-t').length - 1).toBe(1);
  });
});
