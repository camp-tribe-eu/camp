import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { renderComponent } from './render-component';
import RouteStageServices, {
  RouteFuelPrices,
} from '@/components/route-services';
import {
  AVERAGE_BADGE,
  NO_STATION_PRICE,
  PRICE_DROP_AFTER_DAYS,
  PRICE_STALE_AFTER_DAYS,
  type RouteFuelPrice,
  type RouteFuelStationPrice,
  type RouteServicePoint,
  type StageServices,
} from '@/lib/route-services';

// CAMP-154 — THE RENDERED fuel row, and why this file is a `.tsx`.
//
// 🔴 A CHECK MUST NOT ASSERT A PROPERTY IT CANNOT SEE.
//
// `tariff-table.spec.tsx` exists because a review deleted every visible
// marker from the price panel — the per-row "Ended", the "These prices
// have expired" heading, the "ask the operator" sentence — and the web
// suite still reported 457 passed / 0 failed, while a verification
// script went on printing "435 pages say so" about pages that by then
// said nothing at all. Only an `sr-only` caption survived.
//
// This card's rules are all rules about what a READER is told:
//
//   - a country average must never read as a station price;
//   - every displayed price carries its measurement date and its source;
//   - never render empty when data is missing.
//
// None of those can be checked against a data structure. So every
// assertion below reads `visibleText` — the HTML a person is served,
// with tags stripped — and never a class name, a `data-testid` or an
// `sr-only` caption.
//
// 🔴 Rendered through `render-component.ts`, never with JSX in this
// file. Playwright compiles JSX with its own hard-coded runtime; read
// the note at the head of that file before changing any of this.

/** Everything a person would actually read. */
const visibleText = (html: string): string =>
  html
    .replace(/<[^>]*class="[^"]*sr-only[^"]*"[^>]*>.*?<\/[a-z]+>/gs, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const NOW = new Date('2026-09-28T12:00:00Z');
const daysBefore = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

const price = (over: Partial<RouteFuelStationPrice> = {}): RouteFuelStationPrice => ({
  grade: 'diesel',
  product: 'Gasolio',
  price: '1.849',
  measuredAt: daysBefore(1),
  source: 'it-mimit',
  ...over,
});

const fuelPoint = (
  prices: RouteFuelStationPrice[] | undefined,
): RouteServicePoint => ({
  kind: 'fuel',
  osmRef: 'n228026277',
  name: 'Eni',
  lat: 44.4949,
  lon: 11.3426,
  metres: 894,
  phone: null,
  website: null,
  openingHours: null,
  ...(prices ? { prices } : {}),
});

/** A stage whose fuel point is the only service, so the text is readable. */
const stage = (prices: RouteFuelStationPrice[] | undefined): StageServices => ({
  lat: 44.4949,
  lon: 11.3426,
  services: [fuelPoint(prices)],
});

const renderStage = (
  prices: RouteFuelStationPrice[] | undefined,
  now: Date = NOW,
): string =>
  renderComponent(RouteStageServices, {
    group: stage(prices),
    looked: true,
    now,
  });

// ── 1. THE PRICE, ITS DATE AND ITS SOURCE ───────────────────────────────

test.describe('🔴 a station price is never shown without its date', () => {
  test('the price, the product and the measurement date are all readable', () => {
    const text = visibleText(renderStage([price()]));
    expect(text).toContain('€1.849');
    // The source's own product name, not the word "petrol".
    expect(text).toContain('Gasolio');
    // The date, written out — 27 September 2026, one day before NOW.
    expect(text).toContain('27 September 2026');
    expect(text).toContain('measured');
  });

  // 🔴 MUTATION PROVEN: delete the `<time>` element from StationPrices
  // and this fails, while the price still renders. A fuel price with no
  // date is a rumour, and it is stale within a day.
  test('the date cannot be removed while the price remains', () => {
    const text = visibleText(renderStage([price()]));
    const priceAt = text.indexOf('€1.849');
    const dateAt = text.indexOf('27 September 2026');
    expect(priceAt).toBeGreaterThanOrEqual(0);
    expect(dateAt).toBeGreaterThan(priceAt);
    // …and within the same breath, not paragraphs away.
    expect(dateAt - priceAt).toBeLessThan(80);
  });

  // 🔴 The two grades on one Bologna forecourt were filed a day apart on
  // 28.09.2026. One date for the row would be false about one of them.
  test('each grade carries its own date', () => {
    const text = visibleText(
      renderStage([
        price({ grade: 'diesel', product: 'Gasolio', measuredAt: daysBefore(2) }),
        price({
          grade: 'petrol',
          product: 'Benzina',
          price: '2.119',
          measuredAt: daysBefore(3),
        }),
      ]),
    );
    expect(text).toContain('26 September 2026');
    expect(text).toContain('25 September 2026');
  });

  // 🔴 France sells 95-octane as SP95 and as E10 at different prices, and
  // 5 619 of its stations post only E10. "Petrol €2.209" would name the
  // wrong fuel at a third of French stations.
  test('prints the product the source published, not a generic grade name', () => {
    const text = visibleText(
      renderStage([
        price({
          grade: 'petrol',
          product: 'E10',
          price: '2.209',
          source: 'fr-data-economie',
        }),
      ]),
    );
    expect(text).toContain('E10');
    expect(text).toContain('€2.209');
  });
});

// ── 2. THE THING THE CARD FORBIDS ───────────────────────────────────────

test.describe('🔴 a country average must never read as a station price', () => {
  const countries: RouteFuelPrice[] = [
    { code: 'IT', name: 'Italy', petrol: 2.031, diesel: 1.921 },
  ];
  const averages = () => visibleText(renderComponent(RouteFuelPrices, { prices: countries }));

  // 🔴 MUTATION PROVEN: delete the badge `<span>` from RouteFuelPrices
  // and this fails. It is the only thing on the page that tells a reader
  // the figure beside "Italy" is not what the pump charges.
  test('the averages block is badged as an average, in words', () => {
    expect(averages()).toContain(AVERAGE_BADGE);
  });

  test('and says outright that it is not any listed station’s price', () => {
    const text = averages();
    expect(text).toContain('for the whole country');
    expect(text).toContain('not for any station listed above');
  });

  // 🔴 The old wording said "we hold no per-station prices, and we are
  // not going to guess at one." That sentence became FALSE the moment
  // this card merged, and a page denying in print the prices printed a
  // few lines above it is worse than one that never claimed either.
  test('no longer claims we hold no per-station prices', () => {
    expect(averages()).not.toContain('we hold no per-station prices');
  });

  // 🔴 The two must not be reachable from one another. A station price
  // renders in the stage block; an average renders at route level; and
  // the average's badge must never appear beside a forecourt.
  test('the badge never appears on a stage’s fuel row', () => {
    expect(visibleText(renderStage([price()]))).not.toContain(AVERAGE_BADGE);
  });
});

// ── 3. NEVER RENDER EMPTY ───────────────────────────────────────────────

test.describe('🔴 a missing price is a sentence, never a blank', () => {
  // 🔴 MUTATION PROVEN: make StationPrices `return null` when the list
  // is empty and this fails. 41.8% of the fuel points we show in ES/FR/IT
  // have no price and 100% of those in the other 24 member states do
  // not — so this is the ordinary case, not the edge, and a blank space
  // beside a pump on a page that promises the price beside the pump is
  // the most misleading thing this card could ship.
  test('says we hold no price when the station has none', () => {
    expect(visibleText(renderStage(undefined))).toContain(NO_STATION_PRICE);
  });

  test('says the same when the prices array arrives empty', () => {
    expect(visibleText(renderStage([]))).toContain(NO_STATION_PRICE);
  });

  // The fuel row itself must still be there — the CAMP-113 rule that
  // every kind is listed at every stage.
  test('the fuel row is still rendered with its label', () => {
    expect(visibleText(renderStage(undefined))).toContain('Fuel');
  });
});

// ── 4. STALE AND EXPIRED ────────────────────────────────────────────────

test.describe('🔴 an old price says how old it is', () => {
  // 🔴 MUTATION PROVEN: change the `p.state === 'stale'` branch to
  // always render 'measured' and this fails. Measured 28.09.2026, 1 193
  // of France's 8 760 diesel prices were between eight and thirty days
  // old; presenting those as today's price is the failure the whole
  // staleness rule exists for.
  test('a price past the window is marked, not presented as current', () => {
    const text = visibleText(
      renderStage([price({ measuredAt: daysBefore(PRICE_STALE_AFTER_DAYS + 3) })]),
    );
    expect(text).toContain('last reported');
    expect(text).toContain('it may have moved since');
  });

  test('a price inside the window is not marked stale', () => {
    const text = visibleText(
      renderStage([price({ measuredAt: daysBefore(PRICE_STALE_AFTER_DAYS - 1) })]),
    );
    expect(text).toContain('measured');
    expect(text).not.toContain('last reported');
  });

  // 🔴 Past a month the number is history. Printing it beside a date
  // does not repair it, because the number is what gets read — so it is
  // not printed at all and the row falls back to saying we have none.
  test('a price older than a month is not shown at all', () => {
    const text = visibleText(
      renderStage([price({ measuredAt: daysBefore(PRICE_DROP_AFTER_DAYS + 1) })]),
    );
    expect(text).not.toContain('€1.849');
    expect(text).toContain(NO_STATION_PRICE);
  });

  // 🔴 The one direction a date bug must not fail in.
  test('an unreadable date is treated as expired, never as fresh', () => {
    const text = visibleText(renderStage([price({ measuredAt: 'soon' })]));
    expect(text).not.toContain('€1.849');
    expect(text).toContain(NO_STATION_PRICE);
  });
});

// ── 5. REFUSED COUNTRIES MUST NOT CREEP IN ──────────────────────────────

test.describe('🔴 a price we cannot attribute is not published', () => {
  // Austria's endpoint answers 200 with no key and no rate limit, and no
  // consumer licence for it exists at all. This is the last gate: even
  // if a row for it somehow reached the database, the page has no
  // attribution to print beside it and therefore prints nothing.
  test('an Austrian row would not render even if it reached the page', () => {
    const text = visibleText(
      renderStage([price({ source: 'at-e-control', price: '1.599' })]),
    );
    expect(text).not.toContain('€1.599');
    expect(text).toContain(NO_STATION_PRICE);
  });

  test('so would a Portuguese or Hungarian one', () => {
    for (const source of ['pt-dgeg', 'hu-holtankoljak']) {
      const text = visibleText(renderStage([price({ source })]));
      expect(text).toContain(NO_STATION_PRICE);
    }
  });

  // 🔴 The float artefact, at the last gate. If anything between the
  // numeric(6,3) column and this page converted the price to a number,
  // it arrives as `1.8489999771118164` — and the page refuses it rather
  // than printing it.
  test('refuses a price that has been through a float', () => {
    const text = visibleText(
      renderStage([price({ price: 1.8489999771118164 as unknown as string })]),
    );
    expect(text).toContain(NO_STATION_PRICE);
    expect(text).not.toContain('1.848');
  });
});

// ── 6. THE TWO COPIES OF THE STALENESS RULE ─────────────────────────────

test.describe('the web and the importer agree on how old is too old', () => {
  // 🔴 The web app cannot import from apps/api, so it keeps its own copy
  // of these numbers. Two copies of a staleness rule is one copy that
  // will be wrong, and it fails silently in the worst direction: the
  // importer keeping a price the page believes it has already discarded.
  test('the thresholds match apps/api/src/fuel/stations.ts', () => {
    const api = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'api',
        'src',
        'fuel',
        'stations.ts',
      ),
      'utf8',
    );
    expect(api).toContain(
      `export const PRICE_STALE_AFTER_DAYS = ${PRICE_STALE_AFTER_DAYS};`,
    );
    expect(api).toContain(
      `export const PRICE_DROP_AFTER_DAYS = ${PRICE_DROP_AFTER_DAYS};`,
    );
  });
});
