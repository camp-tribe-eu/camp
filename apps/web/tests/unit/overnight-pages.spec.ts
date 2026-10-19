import { expect, test } from '@playwright/test';
import CampsitePage from '@/app/camping/[country]/[region]/[slug]/page';
import CountryHub from '@/app/camping/[country]/page';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';
import { CLIENT_ISLANDS } from './client-islands';

// CAMP-255 — what the PAGES say about staying the night.
//
// 🔴 EVERY ASSERTION READS THE HTML THE PAGE RENDERS, through the same
// `visibleText` the other page specs use: hidden elements removed first, no
// attributes, no class names, no `data-testid`. A check must not assert a
// property it cannot see — and a component can be right while the PAGE
// hands it the wrong field, which only the page's own output shows. So
// these render the real `CampsitePage` and the real `CountryHub`, with
// `fetch` swapped for a canned API, and never touch a network.
//
// 🔴 The mutation the card names — "make `unknown` read as `forbidden` for
// one place" — is run against THIS file and against the component file; the
// matrix is in the pull request.

type Fetcher = (url: string) => Response | Promise<Response>;

async function withFetch(impl: Fetcher, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// A campsite as the API returns it. Only what the page reads.
const spot = (overnight: unknown) => ({
  slug: 'camping-test',
  name: 'Camping Test',
  country: 'hr',
  region: 'Istria',
  type: 'paid',
  lat: 45.1,
  lon: 13.9,
  amenities: {
    electricity: 'yes',
    water: 'unknown',
    shower: 'yes',
    toilets: 'unknown',
    dogFriendly: 'unknown',
    wifi: 'unknown',
    greyWater: 'unknown',
    laundry: 'unknown',
    wheelchair: 'unknown',
    wheelchairFull: 'unknown',
  },
  ownerOverrides: {},
  lastSeenAt: '2026-10-12T05:00:00.000Z',
  // 🔴 CAMP-256: the page now says "Record last edited: …", and with no
  // date it says "Not known" — which is also the word this file asserts is
  // ABSENT from a page whose overnight answer is allowed or forbidden. The
  // fixture carries a date so that the assertions below keep asking what
  // they were written to ask: that the OVERNIGHT answer is not "Not known".
  osmRecordEditedAt: '2023-06-14T10:11:12.000Z',
  missingSince: null,
  context: {},
  description: null,
  descriptionLang: null,
  stars: null,
  website: null,
  contact: {},
  sources: [
    {
      id: 'osm',
      ref: 'w1',
      updatedAt: '2026-10-12',
      fields: ['name', 'location', 'amenities'],
    },
  ],
  warningAreas: null,
  tariffs: [],
  ...(overnight === undefined ? {} : { overnight }),
});

const PARAMS = { country: 'hr', region: 'istria', slug: 'camping-test' };

async function pageText(overnight: unknown): Promise<string> {
  let html = '';
  await withFetch(
    (url) =>
      url.includes('/spots/hr/istria/camping-test')
        ? json({ spot: spot(overnight), nearby: [] })
        : json({}, 404),
    async () => {
      html = await renderAsyncComponent(
        CampsitePage,
        { params: Promise.resolve(PARAMS) },
        { omit: CLIENT_ISLANDS },
      );
    },
  );
  return visibleText(html);
}

const ALLOWED = {
  status: 'allowed',
  source: 'osm:motorhome=yes',
  checkedAt: '2026-10-12',
};
const FORBIDDEN = {
  status: 'forbidden',
  source: 'osm:motorhome=no',
  checkedAt: '2026-10-12',
};
const UNKNOWN = { status: 'unknown', source: null, checkedAt: null };

test.describe('a campsite page says the answer outright', () => {
  // 🔴 The anchor, asserted first. If the page rendered nothing at all,
  // every "does not say X" below would pass over an empty string.
  test('anchor: the page renders, with the campsite and the section', async () => {
    const text = await pageText(ALLOWED);
    expect(text).toContain('Camping Test');
    expect(text).toContain('Staying the night in a motorhome');
    expect(text.length).toBeGreaterThan(300);
  });

  test('allowed: says Allowed, who said it, which tag, and when', async () => {
    const text = await pageText(ALLOWED);
    expect(text).toContain('Allowed — according to OpenStreetMap (motorhome=yes), read on 12 October 2026.');
    expect(text).toContain('not a ruling');
    expect(text).not.toContain('Not allowed');
    expect(text).not.toContain('Not known');
  });

  test('forbidden: says Not allowed with the same three facts', async () => {
    const text = await pageText(FORBIDDEN);
    expect(text).toContain('Not allowed — according to OpenStreetMap (motorhome=no), read on 12 October 2026.');
    expect(text).not.toContain('Not known');
  });

  // 🔴 THE RULE. Unknown is a sentence, it is not a no, and it lists what
  // to check on the spot — the card's three: signs, the municipal rule,
  // seasonal limits.
  test('🔴 unknown: says Not known, says it is not a no, and lists what to check', async () => {
    const text = await pageText(UNKNOWN);
    expect(text).toContain('Not known. We have no source that says whether a motorhome may stay the night here.');
    expect(text).toContain('That is a gap in the data, not a no.');
    expect(text).toContain('Check on the spot or before you go');
    expect(text).toContain('Signs at the place');
    // Read as it is served: the item ends on a whole phrase, not on a
    // preposition that leaves the sentence hanging ("…along the road in.").
    expect(text).toContain(
      'Signs at the place — a no-overnight, no-camping or no-motorhome sign at the entrance or on the road leading to it.',
    );
    expect(text).not.toContain('the road in.');
    expect(text).toContain('The municipal rule');
    expect(text).toContain('Seasonal or time limits');
    // …and it never says either answer.
    expect(text).not.toContain('Not allowed');
    expect(text).not.toContain('Allowed —');
    expect(text).not.toContain('according to OpenStreetMap');
  });

  test('an API that has never heard of the field reads as not known, not as a crash and not as a no', async () => {
    const text = await pageText(undefined);
    expect(text).toContain('Not known.');
    expect(text).toContain('Signs at the place');
    expect(text).not.toContain('Not allowed');
  });

  // 🔴 The second lock on "no source, no claim": an answer with its source
  // or its day missing, or a source we cannot name, is NOT printed.
  test('🔴 an answer with nothing behind it is not printed', async () => {
    for (const bad of [
      { status: 'allowed', source: null, checkedAt: '2026-10-12' },
      { status: 'allowed', source: 'osm:motorhome=yes', checkedAt: null },
      { status: 'forbidden', source: '', checkedAt: '2026-10-12' },
      { status: 'allowed', source: 'osm:motorhome=yes', checkedAt: 'last Tuesday' },
      { status: 'allowed', source: 'someone-told-me:yes', checkedAt: '2026-10-12' },
      { status: 'allowed' },
      { status: 'maybe', source: 'osm:motorhome=yes', checkedAt: '2026-10-12' },
      'allowed',
      null,
    ]) {
      const text = await pageText(bad);
      expect([JSON.stringify(bad), text.includes('Allowed —')]).toEqual([JSON.stringify(bad), false]);
      expect([JSON.stringify(bad), text.includes('Not allowed')]).toEqual([JSON.stringify(bad), false]);
      expect([JSON.stringify(bad), text.includes('Not known.')]).toEqual([JSON.stringify(bad), true]);
    }
  });

  // The general warning stays; this does not replace it.
  test('the travel notice is still there beside it', async () => {
    const text = await pageText(ALLOWED);
    expect(text).toContain('finding it on this map is not permission to camp there');
  });

  test('the source note credits OSM with the overnight answer only when it gave one', async () => {
    // The API declares the field conditionally; the page prints what it is
    // told. A page whose sources list says "overnight stay" prints it.
    let html = '';
    await withFetch(
      (url) =>
        url.includes('/spots/hr/istria/camping-test')
          ? json({
              spot: {
                ...spot(ALLOWED),
                sources: [
                  {
                    id: 'osm',
                    ref: 'w1',
                    updatedAt: '2026-10-12',
                    fields: ['name', 'location', 'amenities', 'overnight'],
                  },
                ],
              },
              nearby: [],
            })
          : json({}, 404),
      async () => {
        html = await renderAsyncComponent(
          CampsitePage,
          { params: Promise.resolve(PARAMS) },
          { omit: CLIENT_ISLANDS },
        );
      },
    );
    // The whole credited list, in the order the page prints it — not the
    // bare words, which the section above also uses.
    expect(visibleText(html)).toContain('name, location, facilities, overnight stay');
  });
});

// ── the country page ─────────────────────────────────────────────────────

async function countryText(regions: unknown[], country = 'mt'): Promise<string> {
  let html = '';
  await withFetch(
    (url) => (url.includes('/regions') ? json(regions) : json({}, 404)),
    async () => {
      html = await renderAsyncComponent(CountryHub, {
        params: Promise.resolve({ country }),
      });
    },
  );
  return visibleText(html);
}

const region = (
  name: string,
  spots: number,
  extra: Record<string, unknown> = {},
) => ({ region: name, slug: name.toLowerCase(), spots, indexable: true, ...extra });

test.describe('a country page says what it knows — and what it does not', () => {
  test('anchor: renders the country and its regions', async () => {
    const text = await countryText([region('Gozo', 4)]);
    expect(text).toContain('Campsites in Malta');
    expect(text).toContain('Gozo');
  });

  // 🔴 The card's second check, verbatim in spirit: a country with zero
  // coverage is NOT an empty block and NOT a bare 0.
  test('🔴 zero coverage: says we do not know at ANY of them, with the count', async () => {
    const text = await countryText([
      region('Gozo', 4, { overnightAllowed: 0, overnightForbidden: 0, overnightReadAt: '2026-10-12' }),
      region('Malta', 9, { overnightAllowed: 0, overnightForbidden: 0, overnightReadAt: '2026-10-05' }),
    ]);
    expect(text).toContain(
      'We do not know whether a motorhome may stay the night at any of the 13 campsites we list in Malta.',
    );
    // The date of the cut is the LATEST reading, beside the claim.
    expect(text).toContain('Counted from our listings as of 12 October 2026.');
    expect(text).not.toContain('says an overnight stay');
  });

  test('an API that sends no counts at all reads as the same sentence', async () => {
    const text = await countryText([region('Gozo', 4), region('Malta', 9)]);
    expect(text).toContain('We do not know whether a motorhome may stay the night at any of the 13 campsites');
  });

  test('some coverage: counts from our rows, unknown by subtraction, and not-the-same-as-no', async () => {
    const text = await countryText(
      [
        region('Istria', 612, { overnightAllowed: 12, overnightForbidden: 3, overnightReadAt: '2026-10-12' }),
        region('Kvarner', 388, { overnightAllowed: 8, overnightForbidden: 0, overnightReadAt: '2026-10-12' }),
      ],
      'hr',
    );
    expect(text).toContain('For 20 of the 1,000 campsites we list in Croatia, OpenStreetMap says an overnight stay in a motorhome is allowed and for 3 that it is not.');
    expect(text).toContain('For the other 977 we do not know, which is not the same as not allowed');
    expect(text).toContain('Counted from our listings as of 12 October 2026.');
  });

  test('the figure never appears as a percentage', async () => {
    const text = await countryText(
      [region('Istria', 612, { overnightAllowed: 12, overnightForbidden: 3, overnightReadAt: '2026-10-12' })],
      'hr',
    );
    expect(text).not.toMatch(/\d\s*%/);
  });
});
