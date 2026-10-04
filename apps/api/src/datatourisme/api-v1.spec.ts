import {
  CAMPSITE_TYPE,
  CATALOG_PAGE_SIZE,
  catalogNodes,
  catalogUrl,
  tariffRef,
  toFeedNode,
} from './api-v1';
import { isCampsiteNode, parsePrices } from './prices';

// CAMP-181. The standard this file is held to is the one CAMP-195 put at
// the top of parse.spec.ts: every guard has an input that reaches IT
// ALONE, and deleting that guard reddens EXACTLY ONE test here.
//
// 🔴 The fixture below is not invented. It is the shape of a real object
// returned by https://api.datatourisme.fr/v1/catalog on 04.10.2026 with
// `fields=*`, trimmed to the keys that matter and with the campsite's
// own name left out. `minPrice` really is a number here and a string in
// the feed; `priceSpecification` really carries no identifier of any
// kind, which is the whole reason `tariffRef` exists.

const URI =
  'https://data.datatourisme.fr/13/2c29c0aa-bb2f-3dac-9f93-76f39f06bbc5';

const SPEC = {
  priceCurrency: 'EUR',
  minPrice: [22],
  maxPrice: [40],
  name: { '@fr': 'Forfait 1 à 2 personnes et électricité - 1 nuitée' },
  appliesOnPeriod: [{ startDate: '2026-05-07', endDate: '2026-09-26' }],
  hasPricingOffer: [
    { label: { '@en': 'Pitch', '@fr': 'Emplacement' }, key: 'BarePitch' },
  ],
};

const API_OBJECT = {
  uri: URI,
  uuid: '2c29c0aa-bb2f-3dac-9f93-76f39f06bbc5',
  type: ['PointOfInterest', 'Accommodation', CAMPSITE_TYPE],
  lastUpdate: '2026-09-30',
  lastUpdateDatatourisme: '2026-10-01T04:12:00.000Z',
  offers: [{ priceSpecification: [SPEC] }],
};

const page = (objects: unknown[], next?: string) => ({
  ok: true,
  json: async () => ({
    objects,
    meta: { total: 1, page: 1, page_size: 1, next },
  }),
});

describe('translating an API object into the shape prices.ts reads', () => {
  it('moves the ontology class where isCampsiteNode looks for it', () => {
    const node = toFeedNode(API_OBJECT)!;
    // The API says `type`, the parser reads `@type`. Nothing warns about
    // the difference: a node that keeps `type` is simply not a campsite.
    expect(isCampsiteNode(node)).toBe(true);
    expect(isCampsiteNode(API_OBJECT)).toBe(false);
  });

  it('carries the tariff all the way through the real parser', () => {
    const parsed = parsePrices(toFeedNode(API_OBJECT)!);
    expect(parsed?.tariffs).toHaveLength(1);
    expect(parsed?.tariffs[0].minPrice).toBe(22);
    expect(parsed?.tariffs[0].maxPrice).toBe(40);
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

  it('restores the vocabulary node shape without translating the token', () => {
    const node = toFeedNode(API_OBJECT)!;
    expect(parsePrices(node)?.tariffs[0].offer).toBe('BarePitch');
  });

  it('keeps the update date the licence requires beside the record', () => {
    expect(parsePrices(toFeedNode(API_OBJECT)!)?.updatedAt).toBe('2026-09-30');
  });

  it('refuses an object with no uri, rather than inventing one', () => {
    expect(toFeedNode({ ...API_OBJECT, uri: undefined })).toBeNull();
  });
});

describe('the ref we mint because the API mints none', () => {
  it('is the same on every refresh of the same tariff', () => {
    expect(tariffRef(URI, SPEC)).toBe(tariffRef(URI, { ...SPEC }));
  });

  it('separates two different tariffs at one campsite', () => {
    expect(tariffRef(URI, SPEC)).not.toBe(
      tariffRef(URI, { ...SPEC, minPrice: [23] }),
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
    const out = [];
    for await (const n of catalogNodes(
      'k',
      (async () => pages[i++]) as never,
    )) {
      out.push(n['@id']);
    }
    expect(out).toEqual([URI, `${URI}-2`]);
  });

  // 🔴 An empty page mid-walk is a fault, not an ending. Stopping there
  // turns half an import into a successful one.
  it('does not treat an empty page with a cursor behind it as the end', async () => {
    const pages = [
      page([], 'https://api.datatourisme.fr/v1/catalog?crs=2'),
      page([API_OBJECT]),
    ];
    let i = 0;
    const out = [];
    for await (const n of catalogNodes(
      'k',
      (async () => pages[i++]) as never,
    )) {
      out.push(n['@id']);
    }
    expect(out).toEqual([URI]);
  });

  // 🔴 Zero is a failure. The catalogue held 9 438 campsites when this
  // was written; a walk that ends with none has hit a changed filter, a
  // revoked key or a renamed type, and must never hand an importer an
  // empty success to write over what we hold.
  it('refuses to report an empty catalogue as a result', async () => {
    const run = async () => {
      const out = [];
      for await (const n of catalogNodes('k', (async () =>
        page([])) as never)) {
        out.push(n);
      }
      return out;
    };
    await expect(run()).rejects.toThrow(/no campsites/);
  });

  it('stops on an HTTP error instead of returning a short catalogue', async () => {
    const bad = { ok: false, status: 429, json: async () => ({}) };
    const run = async () => {
      const out = [];
      for await (const n of catalogNodes('k', (async () => bad) as never)) {
        out.push(n);
      }
      return out;
    };
    await expect(run()).rejects.toThrow(/HTTP 429/);
  });
});
