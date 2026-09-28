import {
  firstLangString,
  isCampsiteNode,
  parseAmount,
  parseIsoDate,
  parsePriceSpec,
  parsePrices,
  textPriceNotes,
} from './prices';
import type { JsonLdNode, RejectReason } from './prices';

// CAMP-147. Every fixture below is the SHAPE of a real record from the
// 810 MB archive, trimmed to the field under test. Nothing here is
// invented from the schema.org documentation — the feed and the
// documentation disagree in several places and the feed wins.

/** A campsite as the feed writes one: six types at once. */
const campsite = (extra: Partial<JsonLdNode> = {}): JsonLdNode => ({
  '@id': 'https://data.datatourisme.fr/10/abc',
  '@type': [
    'schema:Accommodation',
    'schema:LodgingBusiness',
    'Accommodation',
    'CampingAndCaravanning',
    'PlaceOfInterest',
    'PointOfInterest',
  ],
  lastUpdate: '2026-09-24',
  ...extra,
});

const spec = (extra: Partial<JsonLdNode> = {}): JsonLdNode => ({
  '@id': 'https://data.datatourisme.fr/spec-1',
  '@type': ['schema:PriceSpecification', 'PriceSpecification'],
  'schema:priceCurrency': 'EUR',
  ...extra,
});

describe('isCampsiteNode', () => {
  it('accepts a record whose six types include CampingAndCaravanning', () => {
    expect(isCampsiteNode(campsite())).toBe(true);
  });

  it('rejects a hotel, which also carries schema:LodgingBusiness', () => {
    // 🔴 The trap the card records: filtering on schema:LodgingBusiness
    // drags every hotel in France into the campsite import.
    expect(
      isCampsiteNode({
        '@type': [
          'schema:Accommodation',
          'schema:LodgingBusiness',
          'Hotel',
          'PlaceOfInterest',
        ],
      }),
    ).toBe(false);
  });

  it('rejects a record that only mentions the type inside a review', () => {
    // 🔴 Measured: over a 462-object slice 219 files contain the string
    // and 27 are campsites. The other 192 carry it here — the scheme a
    // review was issued under. A grep-shaped filter over-selects 8-fold.
    expect(
      isCampsiteNode({
        '@type': ['Museum', 'PlaceOfInterest'],
        hasReview: [
          {
            hasReviewValue: { isCompliantWith: ['CampingAndCaravanning'] },
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('parseAmount', () => {
  it('reads the feed’s own shapes', () => {
    expect(parseAmount(['13.5'])).toBe(13.5);
    expect(parseAmount(['550'])).toBe(550);
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount(18)).toBe(18);
  });

  it('reads a French decimal comma', () => {
    expect(parseAmount(['13,50'])).toBe(13.5);
  });

  it('refuses the empty and the absent rather than calling them zero', () => {
    // 🔴 Number('') and Number(' ') and Number([]) are all 0 — three
    // ways for a missing price to become a free campsite.
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(' ')).toBeNull();
    expect(parseAmount([])).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });

  it('refuses a float32 artefact the feed actually contains', () => {
    // 🔴 Four real records carry this: 2.80 put through a 32-bit float
    // upstream and printed back at full precision.
    expect(parseAmount(['2.7999999523162841796875'])).toBeNull();
  });

  it('refuses the negative prices the feed actually contains', () => {
    expect(parseAmount(['-1'])).toBeNull();
    expect(parseAmount(['-5'])).toBeNull();
  });

  it('refuses a negative or non-finite JSON number', () => {
    // 🔴 Added because mutation testing found the hole. Every negative
    // case above is a STRING, and strings are already refused by the
    // pattern — so breaking the numeric branch's sign check changed
    // nothing and every test stayed green. JSON-LD may carry a bare
    // number, and this is the branch that reads it.
    expect(parseAmount(-5)).toBeNull();
    expect(parseAmount([-1])).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
    expect(parseAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('refuses an ambiguous thousands separator instead of guessing', () => {
    // "1,500" is 1.5 or 1500 depending on the locale. Guessing wrong is
    // wrong by a factor of a thousand, on a price.
    expect(parseAmount(['1,500'])).toBeNull();
  });

  it('refuses exponent notation and anything with a unit attached', () => {
    expect(parseAmount(['1e3'])).toBeNull();
    expect(parseAmount(['12 €'])).toBeNull();
    expect(parseAmount(['à partir de 13'])).toBeNull();
  });
});

describe('parseIsoDate', () => {
  it('reads the date format the feed writes', () => {
    expect(parseIsoDate('2026-04-01')).toBe('2026-04-01');
    expect(parseIsoDate(['2026-09-26'])).toBe('2026-09-26');
  });

  it('refuses a day that does not exist', () => {
    // 🔴 Matches the pattern, is not a date. new Date() rolls it forward
    // to 3 March without complaining.
    expect(parseIsoDate('2026-02-31')).toBeNull();
  });

  it('refuses a French date rather than reading it upside down', () => {
    expect(parseIsoDate('01/04/2026')).toBeNull();
  });

  it('refuses the empty string', () => {
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
  });
});

describe('firstLangString', () => {
  it('returns the text WITH its language', () => {
    expect(firstLangString({ fr: ['Semaine mini en HLL'] })).toEqual({
      text: 'Semaine mini en HLL',
      lang: 'fr',
    });
  });

  it('prefers the original French over a translation', () => {
    expect(firstLangString({ en: ['Weekly'], fr: ['A la semaine'] })).toEqual({
      text: 'A la semaine',
      lang: 'fr',
    });
  });

  it('refuses a bare string, which carries no language', () => {
    // 🔴 Text without a language is what the page would render into a
    // lang attribute as a guess.
    expect(firstLangString('A la semaine')).toBeNull();
  });

  it('skips a language whose value is blank', () => {
    expect(firstLangString({ fr: ['   '], en: ['Per week'] })).toEqual({
      text: 'Per week',
      lang: 'en',
    });
  });
});

describe('parsePriceSpec', () => {
  it('reads a full tariff line', () => {
    const t = parsePriceSpec(
      spec({
        'schema:minPrice': ['18'],
        'schema:maxPrice': ['25'],
        appliesOnPeriod: [
          {
            '@type': ['Period'],
            startDate: '2026-04-01',
            endDate: '2026-09-26',
          },
        ],
        hasPricingOffer: [{ '@id': 'kb:BarePitch' }],
        hasPricingMode: [{ '@id': 'kb:Overnight' }],
        hasEligiblePolicy: [{ '@id': 'kb:BaseRateFullRate' }],
        name: { fr: ['Pour une nuit avec électricité'] },
      }),
    );
    expect(t).toEqual({
      ref: 'https://data.datatourisme.fr/spec-1',
      offer: 'BarePitch',
      mode: 'Overnight',
      policy: 'BaseRateFullRate',
      minPrice: 18,
      maxPrice: 25,
      currency: 'EUR',
      validFrom: '2026-04-01',
      validUntil: '2026-09-26',
      label: 'Pour une nuit avec électricité',
      labelLang: 'fr',
    });
  });

  it('refuses a specification that states a currency and no amount', () => {
    // 🔴 1 264 of the feed's 15 526 specifications are exactly this, and
    // they are the single biggest reason the card's "4 459 campsites
    // with a real price" is really 3 433. A currency is not a price.
    const reasons: RejectReason[] = [];
    expect(
      parsePriceSpec(spec({ name: { fr: ['Tarifs'] } }), (r) =>
        reasons.push(r),
      ),
    ).toBeNull();
    expect(reasons).toEqual(['no-amount']);
  });

  it('refuses a range that runs backwards instead of printing it', () => {
    // 🔴 400 real specifications have min > max. Rendered, one of them
    // reads "from €5.60 to €4.95".
    const reasons: RejectReason[] = [];
    expect(
      parsePriceSpec(
        spec({ 'schema:minPrice': ['5.6'], 'schema:maxPrice': ['4.95'] }),
        (r) => reasons.push(r),
      ),
    ).toBeNull();
    expect(reasons).toEqual(['range-backwards']);
  });

  it('refuses an amount with no currency rather than assuming euros', () => {
    const reasons: RejectReason[] = [];
    const bare = spec({ 'schema:minPrice': ['18'] });
    delete bare['schema:priceCurrency'];
    expect(parsePriceSpec(bare, (r) => reasons.push(r))).toBeNull();
    expect(reasons).toEqual(['no-currency']);
  });

  it('normalises the 97 records that shout "Eur"', () => {
    expect(
      parsePriceSpec(
        spec({ 'schema:priceCurrency': 'Eur', 'schema:minPrice': ['18'] }),
      )?.currency,
    ).toBe('EUR');
  });

  it('turns schema:price into an exact range, not a floor', () => {
    // 721 records carry schema:price. It is the price, so the page must
    // print "€13.50" and not "from €13.50".
    const t = parsePriceSpec(spec({ 'schema:price': ['13.5'] }));
    expect(t?.minPrice).toBe(13.5);
    expect(t?.maxPrice).toBe(13.5);
  });

  it('keeps a tariff that states no season, with both dates null', () => {
    // 🔴 Stored, never displayed. Dropping it at import would destroy
    // the evidence of how much of the feed is undatable; the read path
    // is what refuses it.
    const t = parsePriceSpec(spec({ 'schema:minPrice': ['18'] }));
    expect(t).not.toBeNull();
    expect(t?.validFrom).toBeNull();
    expect(t?.validUntil).toBeNull();
  });

  it('strips the kb: prefix but keeps the publisher’s own token', () => {
    const t = parsePriceSpec(
      spec({
        'schema:minPrice': ['18'],
        hasPricingOffer: [{ '@id': 'kb:CamperPitch' }],
      }),
    );
    expect(t?.offer).toBe('CamperPitch');
  });
});

describe('textPriceNotes', () => {
  const prose = 'Tarif Mobilhome à partir de 450 € / semaine';

  it('carries prose verbatim, with its language', () => {
    expect(
      textPriceNotes(
        campsite({
          offers: [{ textPriceSpecification: [{ fr: [prose] }] }],
        }),
      ),
    ).toEqual([{ text: prose, lang: 'fr' }]);
  });

  it('never produces a number from prose', () => {
    // 🔴 The card forbids this outright. 407 records state a price in
    // words and every one contains a figure a regex would happily take —
    // "450 € / semaine" is one kind of mobile home for one week, not the
    // campsite's price, and the sentence around it is what says so.
    const notes = textPriceNotes(
      campsite({ offers: [{ textPriceSpecification: [{ fr: [prose] }] }] }),
    );
    for (const note of notes) {
      for (const value of Object.values(note)) {
        expect(typeof value).toBe('string');
      }
    }
  });

  it('does not let a prose price reach the tariff table', () => {
    // 🔴 The same rule stated where it actually matters: a record with
    // prose and no specification produces ZERO tariffs.
    const parsed = parsePrices(
      campsite({ offers: [{ textPriceSpecification: [{ fr: [prose] }] }] }),
    );
    expect(parsed?.tariffs).toEqual([]);
    expect(parsed?.textNotes).toHaveLength(1);
  });
});

describe('parsePrices', () => {
  it('refuses a record with no update date', () => {
    // 🔴 Licence Ouverte 2.0 requires the source AND the date it last
    // updated what we reuse. parse.ts refuses a campsite for this; a
    // price is where a missing date does the most damage.
    const undated = campsite({ offers: [] });
    delete undated.lastUpdate;
    expect(parsePrices(undated)).toBeNull();
  });

  it('falls back to lastUpdateDatatourisme when lastUpdate is absent', () => {
    const node = campsite({ offers: [] });
    delete node.lastUpdate;
    node.lastUpdateDatatourisme = '2026-09-25T03:24:38.421Z';
    expect(parsePrices(node)?.updatedAt).toBe('2026-09-25');
  });

  it('returns nothing at all for a record that is not a campsite', () => {
    expect(
      parsePrices({ '@type': ['Hotel'], lastUpdate: '2026-09-24' }),
    ).toBeNull();
  });

  it('collects tariffs from every offer on the record', () => {
    const parsed = parsePrices(
      campsite({
        offers: [
          {
            'schema:priceSpecification': [
              spec({ '@id': 'a', 'schema:minPrice': ['18'] }),
              spec({ '@id': 'b', 'schema:minPrice': ['25'] }),
            ],
          },
          {
            'schema:priceSpecification': [
              spec({ '@id': 'c', 'schema:minPrice': ['450'] }),
            ],
          },
        ],
      }),
    );
    expect(parsed?.tariffs.map((t) => t.ref)).toEqual(['a', 'b', 'c']);
  });

  it('collapses a specification URI repeated within one campsite', () => {
    // The unique index is (spot, source, ref). Measured: this never
    // happens in today's feed — but the importer must not be the thing
    // that discovers it started to.
    const parsed = parsePrices(
      campsite({
        offers: [
          {
            'schema:priceSpecification': [
              spec({ '@id': 'same', 'schema:minPrice': ['18'] }),
              spec({ '@id': 'same', 'schema:minPrice': ['25'] }),
            ],
          },
        ],
      }),
    );
    expect(parsed?.tariffs).toHaveLength(1);
  });
});
