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

/**
 * 🔴 Applied until it stops changing the string, not once.
 *
 * `s.replace(/<[^>]*>/g, ' ')` in a single pass is the shape CodeQL
 * calls "incomplete multi-character sanitization", and it is right:
 * removing the tags from `<scr<span>ipt>` leaves `<script`. Nothing in
 * this file is sanitizing anything for display — the input is our own
 * `renderToStaticMarkup` output — but a helper that every assertion
 * below depends on should not be the one place with a known hole in it,
 * and running to a fixpoint costs one extra pass on a string of a few
 * kilobytes.
 */
const stripTags = (html: string): string => {
  let out = html;
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(/<[^>]*>/g, ' ');
  }
  return out;
};

/**
 * 🔴 ONE pass over the string, not one pass per entity.
 *
 * The chained form — `.replace(/&#x27;/g, "'")` then
 * `.replace(/&amp;/g, '&')` — double-unescapes: `&amp;#x27;`, which is
 * a literal `&#x27;` a page wanted to SHOW, comes out as an apostrophe.
 * CodeQL flags it as "double escaping or unescaping" and the bug is
 * real, if harmless here. A single regex with a lookup table cannot
 * revisit what it has already written.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  mdash: '—',
  ndash: '–',
  middot: '·',
  hellip: '…',
};

const decodeEntities = (s: string): string =>
  s.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });

/**
 * Everything a person would actually read.
 *
 * 🔴 `sr-only` content is removed FIRST and deliberately. A screen-reader
 * caption is not something a sighted reader is told, so an assertion it
 * could satisfy would be an assertion about a property the page does not
 * visibly have — which is the exact failure `tariff-table.spec.tsx` was
 * written after. `the helper itself is honest` below proves this works.
 */
const visibleText = (html: string): string => {
  let out = html;
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(
      /<([a-z]+)\b[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g,
      ' ',
    );
  }
  return decodeEntities(stripTags(out)).replace(/\s+/g, ' ').trim();
};

// 🔴 The helper every other assertion in this file leans on, tested.
//
// If it silently returned '' the "must not contain" assertions would all
// pass over a page that said anything at all. `render-component.ts`
// carries `rendersNothing` for the same reason.
test.describe('the helper itself is honest', () => {
  test('removes sr-only content and keeps the visible words', () => {
    expect(
      visibleText('<p>Fuel<span class="sr-only">hidden note</span> €1.849</p>'),
    ).toBe('Fuel €1.849');
  });

  test('decodes each entity once, never twice', () => {
    // `&amp;#x27;` is a page showing the literal text `&#x27;`.
    expect(visibleText('<p>&amp;#x27;</p>')).toBe('&#x27;');
    expect(visibleText('<p>R&amp;D &rsquo;26</p>')).toBe('R&D ’26');
  });

  test('strips tags even when they are nested inside one another', () => {
    expect(visibleText('<div><b>a</b><i>b</i></div>')).toBe('a b');
  });
});

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

  // 🔴 ATTRIBUTION IS A LICENCE CONDITION, AND IT HAS TO BE IN THE
  // OUTPUT, NOT IN A VARIABLE.
  //
  // Review found `displayPrices` resolving `attribution` for every price
  // and the component never reading it: the served row was the price and
  // the date and nothing else. All three sources — datos.gob.es,
  // Licence Ouverte 2.0, IODL 2.0 — require attribution, and the CC BY
  // bulletin two blocks down was already getting it. These assertions
  // read the rendered row, so a value computed and dropped cannot
  // satisfy them.
  test('names the ministry that published the price, on the row', () => {
    const text = visibleText(renderStage([price()]));
    expect(text).toContain('Ministero delle Imprese e del Made in Italy');
  });

  test('links to it, so the reader can check the number at the source', () => {
    const html = renderStage([price()]);
    expect(html).toContain('href="https://carburanti.mise.gov.it/ospzSearch/"');
  });

  test('attributes the Spanish and French ministries on their own rows', () => {
    expect(
      visibleText(renderStage([price({ source: 'es-minetur' })])),
    ).toContain('Ministerio para la Transición Ecológica');
    expect(
      visibleText(renderStage([price({ source: 'fr-data-economie' })])),
    ).toContain('Ministère de l’Économie et des Finances');
  });

  // One line per row, not per grade: a forecourt's two prices come from
  // one ministry and naming it twice adds noise, not permission.
  test('names the ministry once even when the row carries two grades', () => {
    const text = visibleText(
      renderStage([
        price({ grade: 'diesel', product: 'Gasolio' }),
        price({ grade: 'petrol', product: 'Benzina', price: '2.119' }),
      ]),
    );
    expect(text.split('Ministero delle Imprese').length - 1).toBe(1);
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

  // 🔴 THE LITERAL WORDS A READER SEES, NOT THE CONSTANT THEY COME FROM.
  //
  // This assertion was `toContain(AVERAGE_BADGE)` against markup
  // rendered from that same constant — so renaming
  // `AVERAGE_BADGE = 'Country average'` to `'Pump price'` badged a
  // national average AS A PUMP PRICE and all 22 tests still passed,
  // this one included. The corpus shared a field with the thing it
  // measured, which is the defect this project has now hit five times.
  //
  // Writing the words out means the test can only be satisfied by a page
  // that actually says them, and a deliberate rewording has to change
  // this line too — in a diff a reviewer reads.
  test('the averages block is badged as an average, in the words a reader sees', () => {
    expect(averages()).toContain('Country average');
  });

  // …and the constant is what the component renders, so the two cannot
  // drift apart silently in the other direction either.
  test('the badge constant is those same words', () => {
    expect(AVERAGE_BADGE).toBe('Country average');
  });

  test('and says outright that it is not any single station’s price', () => {
    const text = averages();
    expect(text).toContain('for the whole country');
    expect(text).toContain('not the price at any single filling station');
  });

  // 🔴 NO DIRECTIONAL WORD, AND THIS IS THE TEST THAT KEEPS IT THAT WAY.
  //
  // The first rewrite said "not for any station listed ABOVE" while this
  // block renders BEFORE the stage list — inverting the card's central
  // safeguard — and the test then asserted the inverted string, locking
  // it in. A word that has to track the order of two JSX siblings in
  // another file is wrong as a design whichever way it points.
  test('claims nothing about where the stations are on the page', () => {
    const text = averages();
    expect(text).not.toContain('listed above');
    expect(text).not.toContain('listed below');
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
