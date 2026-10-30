import { expect, test } from '@playwright/test';
import RegionPage from '@/app/camping/[country]/[region]/page';
import { INSIGHT_MIN_KNOWN } from '@/lib/region-insights';
import { renderNestedAsync } from './render-component';
import { visibleText } from './rendered-text';

// "Camping in <region>" — what the REGION PAGE says, read off the HTML it
// renders, with `fetch` swapped for a canned API.
//
// 🔴 EVERY EXPECTED NUMBER BELOW IS A CONSTANT COUNTED BY HAND from the
// payload as written, never computed here from the same fields the code
// adds up. The payload says electricity yes 4, no 2 over a region of 10
// sites; the sentence must say "Of the 6 sites" — the 6 is typed in, so a
// page that printed the region's 10 is caught, and so is a test that
// would have re-derived 6 with the code's own formula.
//
// 🔴 THE TWO MUTATIONS THE CARD NAMES are run against this file:
//   · denominator = all campsites of the region  → "Of the 10 sites …"
//   · the threshold of five removed               → the 4-known sentence prints
// Both must turn this file red; the matrix is in the pull request.

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

const REGION = { region: 'Bovec', slug: 'bovec', spots: 10, indexable: true };

const card = (i: number) => ({
  slug: `camp-${i}`,
  name: `Camp ${i}`,
  country: 'si',
  region: 'Bovec',
  type: 'paid',
  amenities: {},
});

const LISTING = {
  region: 'Bovec',
  total: 10,
  items: Array.from({ length: 10 }, (_, i) => card(i + 1)),
};

/** The payload the API sends: 10 sites, counts as named in each test. */
const payload = (over: Record<string, unknown> = {}) => ({
  region: 'Bovec',
  spots: 10,
  readAt: '2026-10-18',
  types: { paid: 6, rv_park: 2, camper_stop: 1, free: 0, wild: 1 },
  amenities: {
    electricity: { yes: 4, no: 2 }, // known 6
    toilets: { yes: 5, no: 0 }, // known 5 — exactly the threshold
    shower: { yes: 3, no: 1 }, // known 4 — one under it
  },
  surroundings: {
    computedAt: '2026-09-25',
    supermarket: { known: 7, within: 4 },
    station: { known: 6, within: 3 },
    water: {
      named: 7,
      top: { name: 'Lake Bohinj', sites: 5, nearestM: 10, farthestM: 1500 },
    },
  },
  ...over,
});

async function pageText(insights: unknown, status = 200): Promise<string> {
  let html = '';
  await withFetch(
    (url) => {
      if (url.endsWith('/spots/si/regions')) return json([REGION]);
      if (url.includes('/spots/si/bovec?page=1')) return json(LISTING);
      if (url.endsWith('/spots/insights/si/bovec')) return json(insights, status);
      return json({}, 404);
    },
    async () => {
      html = await renderNestedAsync(RegionPage, {
        params: Promise.resolve({ country: 'si', region: 'bovec' }),
      });
    },
  );
  return visibleText(html);
}

/**
 * The words of the "Camping in …" block ALONE — `visibleText` of the one
 * `<section>` the component renders, '' when there is none.
 *
 * 🔴 Why not the whole page: after the hub filters (#364) the same page
 * prints "Electricity", "Showers", "Toilets" as filter chips, so "the
 * page does not say Showers" stopped meaning "the block prints no line
 * about showers". The block is found by its landmark, not by the shape
 * of a line, so a rewording of the lines cannot blind this; and every
 * "does not say" below is paired with a "does say" on the SAME string,
 * so an empty section cannot satisfy it either.
 */
async function blockText(insights: unknown, status = 200): Promise<string> {
  let html = '';
  await withFetch(
    (url) => {
      if (url.endsWith('/spots/si/regions')) return json([REGION]);
      if (url.includes('/spots/si/bovec?page=1')) return json(LISTING);
      if (url.endsWith('/spots/insights/si/bovec')) return json(insights, status);
      return json({}, 404);
    },
    async () => {
      html = await renderNestedAsync(RegionPage, {
        params: Promise.resolve({ country: 'si', region: 'bovec' }),
      });
    },
  );
  const m = /<section[^>]*aria-labelledby="region-insights-heading"[^>]*>[\s\S]*?<\/section>/.exec(html);
  return m ? visibleText(m[0]) : '';
}

test.describe('the region page says what is counted', () => {
  // 🔴 The anchor, first: the page renders with its listing AND the block.
  // Without this, every "does not say" below passes over an empty string.
  test('anchor: the page renders the listing and the block', async () => {
    const text = await pageText(payload());
    expect(text).toContain('Campsites in Bovec');
    expect(text).toContain('Camp 10');
    expect(text).toContain('Camping in Bovec');
    expect(text.length).toBeGreaterThan(300);
  });

  // 🔴 ASSERTIONS ON NUMBERS, NOT ON PROSE. The sentence frame was
  // reworded once already (review: six lines on one frame, the date three
  // times over); what a reader must get is each figure with its label, so
  // that is what is asserted — the label, the numbers, their order.
  test('🔴 the denominator is the sites with a recorded answer (6), not the region (10)', async () => {
    const text = await pageText(payload());
    expect(text).toMatch(/Electricity — 4 of the 6 sites where this is recorded have it, 2 do not/);
    expect(text).not.toMatch(/Electricity — .*of the 10 sites where this is recorded/);
  });

  test('🔴 four known values print nothing; five print the line', async () => {
    expect(INSIGHT_MIN_KNOWN).toBe(5);
    const text = await blockText(payload());
    // shower: yes 3 + no 1 = 4 → no line about showers at all, not even
    // one that says there is not enough data. Read off the block, not
    // the page: the filter chips above it say "Showers" on every page.
    expect(text).not.toContain('Showers');
    expect(text).not.toContain('not enough');
    // toilets: yes 5 + no 0 = 5 → printed, as "all 5".
    expect(text).toMatch(/Toilets — all 5 of the 5 sites where this is recorded/);
  });

  // 🔴 THE REVIEW'S SECOND FINDING. "all 6 … where this is recorded" over a
  // region of 111 reads as "toilets everywhere" unless the line itself says
  // how many have no record. The number is spots − known, typed in here
  // from the payload (10 − 6 = 4, 10 − 5 = 5), and absent when known ==
  // spots. 🔴 And it is PER AMENITY: 4 and 5 here, never one shared rest.
  test('🔴 each line counts its own unrecorded sites, and only when there are any', async () => {
    const text = await pageText(payload());
    expect(text).toMatch(/Toilets — all 5 of the 5 sites where this is recorded; 5 sites have no record\./);
    expect(text).toMatch(/Electricity — 4 of the 6 sites where this is recorded have it, 2 do not; 4 sites have no record\./);
    // known == spots: 7 + 3 = 10 of 10 — no tail, the line ends on the answer.
    const full = await pageText(
      payload({ amenities: { electricity: { yes: 7, no: 3 }, toilets: { yes: 0, no: 0 }, shower: { yes: 0, no: 0 } } }),
    );
    expect(full).toMatch(/Electricity — 7 of the 10 sites where this is recorded have it, 3 do not\./);
    expect(full).not.toContain('no record');
    // one unrecorded site: singular.
    const one = await pageText(
      payload({ amenities: { electricity: { yes: 9, no: 0 }, toilets: { yes: 0, no: 0 }, shower: { yes: 0, no: 0 } } }),
    );
    expect(one).toMatch(/Electricity — all 9 of the 9 sites where this is recorded; 1 site has no record\./);
    // none: five explicit "no" tags are a recorded answer, not a gap.
    const none = await pageText(
      payload({ amenities: { electricity: { yes: 0, no: 5 }, toilets: { yes: 0, no: 0 }, shower: { yes: 0, no: 0 } } }),
    );
    expect(none).toMatch(/Electricity — none of the 5 sites where this is recorded; 5 sites have no record\./);
  });

  test('the same amenity at 4 and at 5, with nothing else changed', async () => {
    const four = await blockText(
      payload({ amenities: { electricity: { yes: 2, no: 2 }, toilets: { yes: 0, no: 0 }, shower: { yes: 0, no: 0 } } }),
    );
    // The block is there (its type line prints) and says nothing of electricity.
    expect(four).toMatch(/10 sites:/);
    expect(four).not.toContain('Electricity');
    const five = await blockText(
      payload({ amenities: { electricity: { yes: 3, no: 2 }, toilets: { yes: 0, no: 0 }, shower: { yes: 0, no: 0 } } }),
    );
    expect(five).toMatch(/Electricity — 3 of the 5 sites where this is recorded have it, 2 do not; 5 sites have no record\./);
  });

  test('types: the region count is the denominator only here, where every row has one', async () => {
    const text = await pageText(payload());
    expect(text).toMatch(/10 sites: 6 paid campsites, 2 motorhome parks, 1 camper stop, 1 wild camping spot\./);
  });

  test('surroundings: distances with a number, water by its name, never "by a river"', async () => {
    const text = await pageText(payload());
    expect(text).toMatch(/Supermarket within 2 km — 4 of the 7 sites with computed surroundings\./);
    expect(text).toMatch(/Railway stop within 2 km — 3 of the 6 sites with computed surroundings\./);
    expect(text).toMatch(/Nearest named water — Lake Bohinj for 5 of the 7 sites whose nearest water has a name, 10 m to 1\.5 km away\./);
    expect(text).not.toContain('by a river');
    expect(text).not.toContain('near a lake');
  });

  // 🔴 The date ONCE per block, both readings named, not once per line —
  // review counted the first version saying the same day three times over.
  test('🔴 the two days are said once, at the foot, and nothing is a percentage', async () => {
    // Read off this block alone: "Driving a camper here" (CAMP-404) sits
    // beside it and says its own days, once, at its own foot.
    const block = await blockText(payload());
    expect(block.length).toBeGreaterThan(100);
    expect(block.match(/Counted as of/g)).toHaveLength(1);
    expect(block.match(/18 October 2026/g)).toHaveLength(1);
    expect(block.match(/25 September 2026/g)).toHaveLength(1);
    expect(block).toContain('Counted as of 18 October 2026; surroundings computed 25 September 2026.');
    expect(block).not.toContain('%');
    expect(block).not.toMatch(/per ?cent/i);
    // Six lines print for this payload (types, electricity, toilets,
    // supermarket, station, water); showers is under the threshold.
    expect(block.match(/ — /g)).toHaveLength(5);
    // One day only when both readings fall on it.
    const same = await blockText(payload({ readAt: '2026-09-25' }));
    expect(same).toContain('Counted as of 25 September 2026.');
    expect(same.match(/25 September 2026/g)).toHaveLength(1);
    expect(same).not.toContain('surroundings computed');
  });

  test('🔴 a region with nothing above the threshold gets no block at all', async () => {
    const text = await pageText(
      payload({
        spots: 4,
        types: { paid: 4, rv_park: 0, camper_stop: 0, free: 0, wild: 0 },
        amenities: { electricity: { yes: 2, no: 2 }, toilets: { yes: 1, no: 0 }, shower: { yes: 0, no: 0 } },
        surroundings: {
          computedAt: '2026-09-25',
          supermarket: { known: 4, within: 4 },
          station: { known: 4, within: 0 },
          water: { named: 4, top: { name: 'Soča', sites: 4, nearestM: 1, farthestM: 2 } },
        },
      }),
    );
    expect(text).toContain('Campsites in Bovec');
    expect(text).not.toContain('Camping in Bovec');
    expect(text).not.toContain('Counted as of');
    expect(text).not.toContain('no data');
  });

  test('a figure without a day is not printed, and the foot names only the day that is', async () => {
    const text = await blockText(payload({ readAt: null }));
    expect(text).not.toContain('Electricity');
    expect(text).not.toMatch(/10 sites:/);
    // The surroundings still have their day.
    expect(text).toMatch(/Supermarket within 2 km — 4 of the 7/);
    expect(text).toContain('Surroundings computed 25 September 2026.');
    expect(text).not.toContain('Counted as of');
  });

  test('an API without the route, or with a payload of the wrong shape, means no block — not a crash', async () => {
    for (const [body, status] of [
      [{}, 404],
      [{ region: 'Bovec' }, 200],
      [payload({ amenities: { electricity: { yes: 'four', no: 2 } } }), 200],
      [null, 200],
      ['Bovec', 200],
    ] as const) {
      const text = await pageText(body, status);
      expect([JSON.stringify(body), text.includes('Campsites in Bovec')]).toEqual([JSON.stringify(body), true]);
      expect([JSON.stringify(body), text.includes('Camping in Bovec')]).toEqual([JSON.stringify(body), false]);
      expect([JSON.stringify(body), text.includes('undefined')]).toEqual([JSON.stringify(body), false]);
    }
  });
});
