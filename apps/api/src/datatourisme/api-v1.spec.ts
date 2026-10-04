import {
  CAMPSITE_TYPE,
  CATALOG_PAGE_SIZE,
  catalogNodes,
  catalogUrl,
  langMap,
  tariffRef,
  toFeedNode,
} from './api-v1';
import { isCampsiteNode, parsePrices, textPriceNotes } from './prices';

// CAMP-181. The standard this file is held to is the one CAMP-195 put at
// the top of parse.spec.ts: every guard has an input that reaches IT
// ALONE, so deleting that guard turns the suite red.
//
// 🔴 The fixture below is not invented. It is the shape of a real object
// returned by https://api.datatourisme.fr/v1/catalog on 04.10.2026 with
// `fields=*`, trimmed to the keys that matter. `minPrice` really is a
// number here and a string in the feed; the wording really is written
// `{"@fr": …}`; `priceSpecification` really carries no identifier of any
// kind, which is why `tariffRef` exists.
//
// 🔴 AND IT CARRIES `price`, `hasEligiblePolicy` AND `hasPricingMode`
// DELIBERATELY. The first version of this fixture had none of the three,
// so deleting their translation left all sixteen tests green — review
// proved it with nine mutations. A fixture thinner than the code is a
// test suite that agrees with whatever the code does.

const URI =
  'https://data.datatourisme.fr/13/2c29c0aa-bb2f-3dac-9f93-76f39f06bbc5';
const LABEL = 'Forfait 1 à 2 personnes et électricité - 1 nuitée';

const SPEC = {
  priceCurrency: 'EUR',
  minPrice: [22],
  maxPrice: [40],
  price: [22],
  name: { '@fr': LABEL, '@en': 'Pitch package' },
  appliesOnPeriod: [{ startDate: '2026-05-07', endDate: '2026-09-26' }],
  hasPricingOffer: [
    { label: { '@en': 'Pitch', '@fr': 'Emplacement' }, key: 'BarePitch' },
  ],
  hasPricingMode: [{ label: { '@en': 'Overnight' }, key: 'Overnight' }],
  hasEligiblePolicy: [
    { label: { '@en': 'Base rate' }, key: 'BaseRateFullRate' },
  ],
};

const API_OBJECT = {
  uri: URI,
  uuid: '2c29c0aa-bb2f-3dac-9f93-76f39f06bbc5',
  type: ['PointOfInterest', 'Accommodation', CAMPSITE_TYPE],
  lastUpdate: '2026-09-30',
  lastUpdateDatatourisme: '2026-10-01T04:12:00.000Z',
  offers: [
    {
      priceSpecification: [SPEC],
      textPriceSpecification: { '@fr': 'Gratuit pour les moins de 3 ans.' },
    },
  ],
};

const page = (objects: unknown[], next?: string) => ({
  ok: true,
  json: async () => ({
    objects,
    meta: { total: 1, page: 1, page_size: 1, next },
  }),
});

const drain = async (gen: AsyncGenerator<unknown>) => {
  const out: unknown[] = [];
  for await (const n of gen) out.push(n);
  return out;
};

describe('translating an API object into the shape prices.ts reads', () => {
  it('moves the ontology class where isCampsiteNode looks for it', () => {
    const node = toFeedNode(API_OBJECT)!;
    // The API says `type`, the parser reads `@type`. Nothing warns about
    // the difference: a node that keeps `type` is simply not a campsite.
    expect(isCampsiteNode(node)).toBe(true);
    expect(isCampsiteNode(API_OBJECT)).toBe(false);
  });

  it('carries the numbers all the way through the real parser', () => {
    const t = parsePrices(toFeedNode(API_OBJECT)!)?.tariffs[0];
    expect(t?.minPrice).toBe(22);
    expect(t?.maxPrice).toBe(40);
    expect(t?.currency).toBe('EUR');
    expect(t?.validFrom).toBe('2026-05-07');
    expect(t?.validUntil).toBe('2026-09-26');
  });

  // 🔴 THE SILENT ONE. The price survived the first version of this
  // module and the operator's own words did not, so nothing looked
  // broken: `{"@fr": …}` fails `firstLangString`'s tag pattern and comes
  // back null. Measured — `firstLangString({fr:['x']})` gives a string,
  // `firstLangString({'@fr':'x'})` gives null.
  it('carries the operator’s own words, not only the price', () => {
    const t = parsePrices(toFeedNode(API_OBJECT)!)?.tariffs[0];
    expect(t?.label).toBe(LABEL);
    expect(t?.labelLang).toBe('fr');
  });

  // The same failure, one level up and worth 407 records in the feed:
  // prose prices live on the OFFER, and they are a language map too.
  it('carries the prose price the source states in words', () => {
    const notes = textPriceNotes(toFeedNode(API_OBJECT)!);
    expect(notes.map((n) => n.text)).toEqual([
      'Gratuit pour les moins de 3 ans.',
    ]);
  });

  // 🔴 `schema:price` is the exact-amount fallback the parser uses when
  // a tariff states one figure instead of a range, and nothing reached
  // it while the fixture carried both bounds: deleting its translation
  // left every test green. A line with only `price` is a real shape in
  // this source, so it gets its own case.
  it('carries a tariff that states one figure instead of a range', () => {
    const exact = {
      ...API_OBJECT,
      offers: [
        {
          priceSpecification: [
            { ...SPEC, minPrice: [], maxPrice: [], price: [15] },
          ],
        },
      ],
    };
    const t = parsePrices(toFeedNode(exact)!)?.tariffs[0];
    expect(t?.minPrice).toBe(15);
    expect(t?.maxPrice).toBe(15);
  });

  it('carries all three vocabulary tokens, not just the first', () => {
    const t = parsePrices(toFeedNode(API_OBJECT)!)?.tariffs[0];
    expect(t?.offer).toBe('BarePitch');
    expect(t?.mode).toBe('Overnight');
    expect(t?.policy).toBe('BaseRateFullRate');
  });

  // 🔴 The failure this file exists to prevent, asserted directly. Fed
  // the API's own shape, the parser does not crash and does not warn —
  // it rejects every tariff for want of a ref, and an import would
  // report success over nothing. Measured on live data: 35 price
  // specifications, 0 identifiers.
  it('rejects every tariff when the ref is not minted', () => {
    const unminted = {
      ...API_OBJECT,
      '@id': URI,
      '@type': API_OBJECT.type,
      offers: [{ 'schema:priceSpecification': [SPEC] }],
    };
    expect(parsePrices(unminted)?.tariffs ?? []).toHaveLength(0);
  });

  it('keeps the update date the licence requires beside the record', () => {
    expect(parsePrices(toFeedNode(API_OBJECT)!)?.updatedAt).toBe('2026-09-30');
  });

  it('refuses an object with no uri, rather than inventing one', () => {
    expect(toFeedNode({ ...API_OBJECT, uri: undefined })).toBeNull();
  });
});

describe('the language map, which is where the words were lost', () => {
  it('rewrites a map whose every key is a language tag', () => {
    expect(langMap({ '@fr': 'x', '@en': 'y' })).toEqual({
      fr: ['x'],
      en: ['y'],
    });
  });

  // 🔴 `@id` is two letters and passes any `[A-Za-z]{2,3}` test. A node
  // rewritten into `{id: [...]}` loses the identity `vocabToken` reads.
  it('leaves a JSON-LD node alone, however much it looks like one', () => {
    const node = { '@id': 'kb:BarePitch' };
    expect(langMap(node)).toBe(node);
    expect(langMap({ '@fr': 'x', '@id': 'y' })).toEqual({
      '@fr': 'x',
      '@id': 'y',
    });
  });
});

describe('the ref we mint because the API mints none', () => {
  it('is the same on every refresh of the same tariff', () => {
    expect(tariffRef(URI, SPEC)).toBe(tariffRef(URI, { ...SPEC }));
  });

  // 🔴 `JSON.stringify` follows insertion order, so the first version
  // moved the ref when the API returned the same period with its two
  // keys the other way round. `import-prices.ts` upserts without
  // deleting, so a drifting ref prints one tariff on the page twice.
  it('does not move when the source reorders its own keys', () => {
    const reordered = {
      ...SPEC,
      appliesOnPeriod: [{ endDate: '2026-09-26', startDate: '2026-05-07' }],
      hasPricingOffer: [
        { key: 'BarePitch', label: { '@fr': 'Emplacement', '@en': 'Pitch' } },
      ],
    };
    expect(tariffRef(URI, reordered)).toBe(tariffRef(URI, SPEC));
  });

  // Same reason: a translation appearing on a label is not a new tariff.
  it('does not move when a label gains another language', () => {
    const translated = {
      ...SPEC,
      hasPricingOffer: [
        {
          key: 'BarePitch',
          label: { '@en': 'Pitch', '@fr': 'Emplacement', '@de': 'Platz' },
        },
      ],
    };
    expect(tariffRef(URI, translated)).toBe(tariffRef(URI, SPEC));
  });

  // 🔴 `price` and `hasEligiblePolicy` were missing from the first hash
  // although the parser reads both, so a €12 line and a €30 line at one
  // campsite produced the SAME ref and the second was thrown away as a
  // duplicate. Each field the parser reads gets its own case here.
  it.each([
    ['the exact price', { price: [30] }],
    ['who the rate is for', { hasEligiblePolicy: [{ key: 'ChildRate' }] }],
    ['how it is charged', { hasPricingMode: [{ key: 'PerWeek' }] }],
    ['what is priced', { hasPricingOffer: [{ key: 'CamperPitch' }] }],
    ['the lower bound', { minPrice: [23] }],
    ['the upper bound', { maxPrice: [41] }],
    ['the currency', { priceCurrency: 'CHF' }],
    ['the season', { appliesOnPeriod: [{ startDate: '2026-06-01' }] }],
    ['the operator’s wording', { name: { '@fr': 'Autre forfait' } }],
  ])('separates two tariffs that differ only in %s', (_what, patch) => {
    expect(tariffRef(URI, { ...SPEC, ...patch })).not.toBe(
      tariffRef(URI, SPEC),
    );
  });

  it('separates the same tariff text at two campsites', () => {
    expect(tariffRef(URI, SPEC)).not.toBe(tariffRef(`${URI}-other`, SPEC));
  });

  // The ref is ours, not DATAtourisme's, and a row in the database has to
  // be able to say so without anyone remembering this file.
  it('says in the value itself that it is not their identifier', () => {
    expect(tariffRef(URI, SPEC).startsWith('camptribe:')).toBe(true);
  });
});

describe('walking the catalogue', () => {
  it('asks for the fields and the type, at our own page size', () => {
    const url = new URL(catalogUrl());
    expect(url.searchParams.get('type')).toBe(CAMPSITE_TYPE);
    expect(url.searchParams.get('fields')).toBe('*');
    expect(url.searchParams.get('page_size')).toBe(String(CATALOG_PAGE_SIZE));
  });

  it('follows the cursor verbatim instead of rebuilding the query', () => {
    // The cursor is opaque and signed. Rebuilt from parts it stops being
    // the cursor the server handed us.
    const cursor =
      'https://api.datatourisme.fr/v1/catalog?page_size=50&crs=DcHJ';
    expect(catalogUrl(cursor)).toBe(cursor);
  });

  it('reads every page the cursor leads to', async () => {
    const pages = [
      page([API_OBJECT], 'https://api.datatourisme.fr/v1/catalog?crs=2'),
      page([{ ...API_OBJECT, uri: `${URI}-2` }]),
    ];
    let i = 0;
    const out = await drain(
      catalogNodes('k', (async () => pages[i++]) as never),
    );
    expect(out.map((n) => (n as Record<string, unknown>)['@id'])).toEqual([
      URI,
      `${URI}-2`,
    ]);
  });

  // 🔴 An empty page mid-walk is a fault, not an ending. Stopping there
  // turns half an import into a successful one.
  it('does not treat an empty page with a cursor behind it as the end', async () => {
    const pages = [
      page([], 'https://api.datatourisme.fr/v1/catalog?crs=2'),
      page([API_OBJECT]),
    ];
    let i = 0;
    const out = await drain(
      catalogNodes('k', (async () => pages[i++]) as never),
    );
    expect(out).toHaveLength(1);
  });

  // 🔴 Review built this one and it ran 2 001 requests before being
  // killed by hand: the server decides where the walk goes next, so a
  // cursor pointing at its own page is an endless loop unless this side
  // refuses it.
  it('refuses a cursor that points back at a page already read', async () => {
    const self = catalogUrl();
    const run = () =>
      drain(catalogNodes('k', (async () => page([API_OBJECT], self)) as never));
    await expect(run()).rejects.toThrow(/already read/);
  });

  // 🔴 Zero is a failure. The catalogue held 9 438 campsites when this
  // was written; a walk that ends with none has hit a changed filter, a
  // revoked key or a renamed type, and must never hand an importer an
  // empty success to write over what we hold.
  it('refuses to report an empty catalogue as a result', async () => {
    const run = () => drain(catalogNodes('k', (async () => page([])) as never));
    await expect(run()).rejects.toThrow(/no campsites/);
  });

  // The same guard, aimed at what it actually promises. Counting objects
  // instead of campsites let fifty renamed-class rows walk through and
  // raise nothing — the emptiness arrives downstream instead.
  it('refuses a full page that holds no campsites at all', async () => {
    const notCampsites = Array.from({ length: 50 }, (_x, n) => ({
      ...API_OBJECT,
      uri: `${URI}-${n}`,
      type: ['PointOfInterest', 'CampingAndCaravanningSite'],
    }));
    const run = () =>
      drain(catalogNodes('k', (async () => page(notCampsites)) as never));
    await expect(run()).rejects.toThrow(/no campsites/);
  });

  it('stops on an HTTP error instead of returning a short catalogue', async () => {
    const bad = { ok: false, status: 429, json: async () => ({}) };
    const run = () => drain(catalogNodes('k', (async () => bad) as never));
    await expect(run()).rejects.toThrow(/HTTP 429/);
  });
});
