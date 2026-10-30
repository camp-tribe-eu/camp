import { expect, test } from '@playwright/test';
import RegionListing from '@/components/region-listing';
import { INSIGHT_MIN_KNOWN } from '@/lib/region-insights';
import { renderNestedAsync } from './render-component';
import { visibleText } from './rendered-text';

// "Driving a camper here" (CAMP-404) — what the REGION PAGE says to a
// driver of a motorhome, read off the HTML it renders, with `fetch` swapped
// for a canned API.
//
// 🔴 EVERY EXPECTED NUMBER BELOW IS A CONSTANT COUNTED BY HAND from the
// payload as written, never computed here from the fields the code adds
// up. The payload says 10 sites, 3 of them motorhome parks or camper
// stops, a supermarket median over 7 of them and a town median over 6; the
// sentences must say 3, 10, 7 and 6 — typed in — so a page that printed
// the region's 10 where the 7 belongs is caught, and so is a test that
// would have re-derived the 7 with the code's own formula.
//
// 🔴 THE MUTATIONS THE CARD NAMES are run against this file and the DB spec
// beside it (apps/api/src/spots/region-driving.db.spec.ts), matrix in the
// pull request:
//   · median → mean                  (DB spec: 700 → 378 061)
//   · denominator → every site       ("across the 10 sites")
//   · the threshold of five removed  (the 4-known sentence prints)
//   · a zero printed as a sentence   ("no motorhome park")
//   · the block on every page        (page 2, /filter)
//
// 🔴 The block is found by its landmark and every "does not say" below is
// paired with a "does say" on the SAME string, so an empty section cannot
// satisfy it. "Camping in" is a different section: this file does not read
// it, and a line in one cannot hide a line missing from the other.

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

const TYPES = (over: Record<string, number> = {}) => ({
  paid: 6,
  rv_park: 2,
  camper_stop: 1,
  free: 0,
  wild: 1,
  ...over,
});

/** The payload the API sends: 10 sites, figures as named in each test. */
const payload = (over: Record<string, unknown> = {}) => ({
  region: 'Bovec',
  spots: 10,
  readAt: '2026-10-18',
  types: TYPES(), // motorhome parks 2 + camper stops 1 = 3
  amenities: {
    electricity: { yes: 4, no: 2 },
    toilets: { yes: 5, no: 0 },
    shower: { yes: 3, no: 1 },
  },
  surroundings: {
    computedAt: '2026-09-25',
    supermarket: { known: 7, within: 4, medianM: 1200 },
    station: { known: 6, within: 3 },
    town: { known: 6, medianM: 3400 },
    water: {
      named: 7,
      top: { name: 'Lake Bohinj', sites: 5, nearestM: 10, farthestM: 1500 },
    },
  },
  ...over,
});

/** The same payload with the surroundings figures replaced one by one. */
const surroundings = (over: Record<string, unknown>) => ({
  ...payload().surroundings,
  ...over,
});

const api =
  (insights: unknown, status = 200): Fetcher =>
  (url) => {
    if (url.endsWith('/spots/si/regions')) return json([REGION]);
    if (url.includes('/spots/si/bovec?')) return json(LISTING);
    if (url.endsWith('/spots/insights/si/bovec')) return json(insights, status);
    return json({}, 404);
  };

async function html(
  props: Parameters<typeof RegionListing>[0],
  fetcher: Fetcher,
): Promise<string> {
  let out = '';
  await withFetch(fetcher, async () => {
    out = await renderNestedAsync(RegionListing, props);
  });
  return out;
}

const BASE = { country: 'si', region: 'bovec', page: 1 } as const;

/** The whole page, as a reader meets it. */
async function pageText(insights: unknown, status = 200): Promise<string> {
  return visibleText(await html(BASE, api(insights, status)));
}

/**
 * The words of the "Driving a camper here" block ALONE — '' when there is
 * none. Found by its landmark, not by the shape of a line.
 */
async function blockText(insights: unknown, status = 200): Promise<string> {
  const page = await html(BASE, api(insights, status));
  const m =
    /<section[^>]*aria-labelledby="region-driving-heading"[^>]*>[\s\S]*?<\/section>/.exec(page);
  return m ? visibleText(m[0]) : '';
}

test.describe('the region page tells a camper driver what is counted', () => {
  // 🔴 The anchor, first: the page renders with its listing AND the block.
  // Without this, every "does not say" below passes over an empty string.
  test('anchor: the page renders the listing and the block', async () => {
    const text = await pageText(payload());
    expect(text).toContain('Campsites in Bovec');
    expect(text).toContain('Camp 10');
    expect(text).toContain('Driving a camper here');
    const block = await blockText(payload());
    expect(block.length).toBeGreaterThan(200);
  });

  test('🔴 the block says 3 of 10 sites are set up for motorhomes, and which', async () => {
    const block = await blockText(payload());
    expect(block).toContain(
      'Set up for motorhomes — 3 of the 10 sites: 2 motorhome parks, 1 camper stop.',
    );
  });

  // 🔴 THE DENOMINATOR OF A DISTANCE IS THE SITES THAT HAVE ONE. The
  // payload says 10 sites, 7 with a supermarket distance, 6 with a town.
  test('🔴 the medians are over 7 and 6 sites, never over the region\'s 10', async () => {
    const block = await blockText(payload());
    expect(block).toContain(
      'Nearest supermarket — a median of 1.2 km in a straight line, across the 7 sites with computed surroundings.',
    );
    expect(block).toContain(
      'Nearest town or city — a median of 3.4 km in a straight line, across the 6 sites with computed surroundings.',
    );
    expect(block).not.toMatch(/across the 10 sites/);
    expect(block).not.toMatch(/\b111\b/);
  });

  test('INSIGHT_MIN_KNOWN is five', () => {
    expect(INSIGHT_MIN_KNOWN).toBe(5);
  });

  // 🔴 THE THRESHOLD, BOTH SIDES, the same payload and one number moved.
  test('🔴 supermarket: 4 known print nothing, 5 known print the line', async () => {
    const four = await blockText(
      payload({ surroundings: surroundings({ supermarket: { known: 4, within: 2, medianM: 1200 } }) }),
    );
    // The block is there (the town line prints) and says nothing of shops.
    expect(four).toContain('Nearest town or city');
    expect(four).not.toContain('supermarket');
    expect(four).not.toContain('not enough');
    const five = await blockText(
      payload({ surroundings: surroundings({ supermarket: { known: 5, within: 2, medianM: 1200 } }) }),
    );
    expect(five).toContain(
      'Nearest supermarket — a median of 1.2 km in a straight line, across the 5 sites with computed surroundings.',
    );
  });

  test('🔴 town: 4 known print nothing, 5 known print the line', async () => {
    const four = await blockText(
      payload({ surroundings: surroundings({ town: { known: 4, medianM: 3400 } }) }),
    );
    expect(four).toContain('Nearest supermarket');
    expect(four).not.toContain('Nearest town');
    const five = await blockText(
      payload({ surroundings: surroundings({ town: { known: 5, medianM: 3400 } }) }),
    );
    expect(five).toContain(
      'Nearest town or city — a median of 3.4 km in a straight line, across the 5 sites with computed surroundings.',
    );
  });

  test('🔴 the motorhome line: 4 sites print nothing, 5 sites print it', async () => {
    // Three motorhome parks among four sites, then among five.
    const four = await blockText(
      payload({ spots: 4, types: TYPES({ paid: 1, rv_park: 3, camper_stop: 0, wild: 0 }) }),
    );
    expect(four).toContain('Nearest supermarket'); // the block stands
    expect(four).not.toContain('Set up for motorhomes');
    const five = await blockText(
      payload({ spots: 5, types: TYPES({ paid: 2, rv_park: 3, camper_stop: 0, wild: 0 }) }),
    );
    expect(five).toContain('Set up for motorhomes — 3 of the 5 sites are motorhome parks.');
  });

  // 🔴 NO ZERO. `paid` is what a site with no fee tag is defaulted to, and
  // a paid campsite may take a motorhome: "no motorhome park here" would
  // be read as "a camper cannot stay", and it is not what the rows say.
  test('🔴 a region with no motorhome park and no camper stop prints no sentence about it', async () => {
    const block = await blockText(
      payload({ types: TYPES({ paid: 9, rv_park: 0, camper_stop: 0, wild: 1 }) }),
    );
    expect(block).toContain('Nearest supermarket'); // the block stands, on its distances
    expect(block).not.toContain('Set up for motorhomes');
    expect(block).not.toMatch(/\bno motorhome/i);
    expect(block).not.toMatch(/\bnone\b/i);
    expect(block).not.toMatch(/\b0 of\b/);
  });

  test('the motorhome line in its other forms: one site, one type, all of them', async () => {
    const one = await blockText(payload({ types: TYPES({ paid: 8, rv_park: 0, camper_stop: 1 }) }));
    expect(one).toContain('Set up for motorhomes — 1 of the 10 sites is a camper stop.');
    const many = await blockText(payload({ types: TYPES({ paid: 5, rv_park: 4, camper_stop: 0 }) }));
    expect(many).toContain('Set up for motorhomes — 4 of the 10 sites are motorhome parks.');
    const all = await blockText(
      payload({
        spots: 6,
        types: TYPES({ paid: 0, rv_park: 4, camper_stop: 2, wild: 0 }),
      }),
    );
    expect(all).toContain('Set up for motorhomes — all 6 sites: 4 motorhome parks, 2 camper stops.');
  });

  test('a payload whose type counts do not add up to its sites prints no motorhome line', async () => {
    // 6 + 2 + 1 + 0 + 1 = 10; here 6 + 2 + 1 + 0 + 0 = 9 of a claimed 10.
    const block = await blockText(payload({ types: TYPES({ wild: 0 }) }));
    expect(block).toContain('Nearest supermarket');
    expect(block).not.toContain('Set up for motorhomes');
  });

  test('a distance prints as the API gave it: 850 m, 1.5 km — and says it is a straight line', async () => {
    const block = await blockText(
      payload({
        surroundings: surroundings({
          supermarket: { known: 7, within: 4, medianM: 850 },
          town: { known: 6, medianM: 1500 },
        }),
      }),
    );
    expect(block).toContain('Nearest supermarket — a median of 850 m in a straight line,');
    expect(block).toContain('Nearest town or city — a median of 1.5 km in a straight line,');
    // Every distance LINE says it (the intro says it once more, without
    // a "median" in front); a bare "km" under a heading about driving
    // would be taken for a road.
    expect(block.match(/a median of \S+ \S+ in a straight line, across/g)).toHaveLength(2);
  });

  // 🔴 The day ONCE per block, the same two readings as "Camping in".
  test('🔴 the two days are said once, at the foot', async () => {
    const block = await blockText(payload());
    expect(block.match(/Counted as of/g)).toHaveLength(1);
    expect(block).toContain('Counted as of 18 October 2026; surroundings computed 25 September 2026.');
    expect(block).not.toContain('%');
    expect(block).not.toMatch(/per ?cent/i);
    // Three lines: motorhome, supermarket, town.
    expect(block.match(/ — /g)).toHaveLength(3);
    // Only the distances print: only the day of the surroundings.
    const onlyDistances = await blockText(
      payload({ types: TYPES({ paid: 9, rv_park: 0, camper_stop: 0, wild: 1 }) }),
    );
    expect(onlyDistances).toContain('Surroundings computed 25 September 2026.');
    expect(onlyDistances).not.toContain('Counted as of');
    // Only the motorhome count prints: only the day of the tags.
    const onlyCount = await blockText(
      payload({
        surroundings: surroundings({
          supermarket: { known: 4, within: 2, medianM: 1200 },
          town: { known: 4, medianM: 3400 },
        }),
      }),
    );
    expect(onlyCount).toContain('Counted as of 18 October 2026.');
    expect(onlyCount).not.toContain('surroundings computed');
  });

  test('🔴 what the block must NOT say: no road, no height, no percentage, no "by a river"', async () => {
    const block = await blockText(payload());
    expect(block.length).toBeGreaterThan(200);
    for (const word of [/\broad/i, /\bmountain/i, /\bclimb/i, /\belevation/i, /\bheight/i, /\bterrain/i, /%/, /river/i, /railway/i]) {
      // The intro's own "not by road" is the one road word that may stand.
      expect(block.replace('not by road', '')).not.toMatch(word);
    }
  });

  test('🔴 a region with nothing above the threshold gets no block at all — no heading, no "no data"', async () => {
    const text = await pageText(
      payload({
        spots: 4,
        types: TYPES({ paid: 4, rv_park: 0, camper_stop: 0, wild: 0 }),
        surroundings: {
          computedAt: '2026-09-25',
          supermarket: { known: 4, within: 2, medianM: 900 },
          station: { known: 4, within: 0 },
          town: { known: 4, medianM: 2000 },
          water: { named: 4, top: null },
        },
      }),
    );
    expect(text).toContain('Campsites in Bovec');
    expect(text).not.toContain('Driving a camper here');
    expect(text).not.toContain('no data');
    expect(text).not.toContain('not enough');
  });

  test('a median with no day to read it on is not printed', async () => {
    const block = await blockText(
      payload({ surroundings: surroundings({ computedAt: null }) }),
    );
    expect(block).toContain('Set up for motorhomes');
    expect(block).not.toContain('Nearest supermarket');
    expect(block).not.toContain('Nearest town');
    expect(block).not.toContain('surroundings computed');
  });

  // 🔴 AN API THAT DEPLOYS AFTER THE PAGE. It sends no `medianM` and no
  // `town`: "Camping in" must stand exactly as before and this block must
  // say only what it can — never a sentence with "undefined" in it.
  test('🔴 an older API without medians: the motorhome line stands, "Camping in" is untouched', async () => {
    const old = payload();
    const s = old.surroundings as Record<string, unknown>;
    s.supermarket = { known: 7, within: 4 };
    delete s.town;
    const page = await pageText(old);
    expect(page).toContain('Camping in Bovec');
    expect(page).toMatch(/Supermarket within 2 km — 4 of the 7 sites with computed surroundings\./);
    const block = await blockText(old);
    expect(block).toContain('Set up for motorhomes — 3 of the 10 sites');
    expect(block).not.toContain('Nearest supermarket');
    expect(block).not.toContain('undefined');
    expect(block).not.toContain('NaN');
    expect(block).not.toContain('null');
    // And with no motorhome site either, the block is gone — not empty.
    const bare = payload({ types: TYPES({ paid: 9, rv_park: 0, camper_stop: 0, wild: 1 }) });
    const sb = bare.surroundings as Record<string, unknown>;
    sb.supermarket = { known: 7, within: 4 };
    delete sb.town;
    const text = await pageText(bare);
    expect(text).toContain('Camping in Bovec');
    expect(text).not.toContain('Driving a camper here');
  });

  test('a median of the wrong shape is a missing median, not a crash', async () => {
    for (const bad of ['1200', -5, 1.5, null, {}] as const) {
      const p = payload({
        surroundings: surroundings({
          supermarket: { known: 7, within: 4, medianM: bad },
          town: { known: 6, medianM: bad },
        }),
      });
      const block = await blockText(p);
      expect([String(bad), block.includes('Set up for motorhomes')]).toEqual([String(bad), true]);
      expect([String(bad), block.includes('Nearest')]).toEqual([String(bad), false]);
      expect([String(bad), block.includes('undefined')]).toEqual([String(bad), false]);
    }
  });

  test('an API without the route means no block — not a crash', async () => {
    for (const [body, status] of [
      [{}, 404],
      [null, 200],
      ['Bovec', 200],
    ] as const) {
      const text = await pageText(body, status);
      expect([JSON.stringify(body), text.includes('Campsites in Bovec')]).toEqual([JSON.stringify(body), true]);
      expect([JSON.stringify(body), text.includes('Driving a camper here')]).toEqual([JSON.stringify(body), false]);
    }
  });
});

// ── The block lives on the base first page only ────────────────────────
//
// The condition is `baseFirstPage` in region-listing.tsx, the one the
// tiles and the questions already hang on. Page 2 and every /filter?…
// address — hundreds of thousands of them — must not repeat the paragraph,
// and must not even ask the API for the figures.

test.describe('the block lives on the base page only', () => {
  test('anchor: page 1 of the base page has the block', async () => {
    const page = visibleText(await html(BASE, api(payload())));
    expect(page).toContain('Driving a camper here');
    expect(page).toContain('Camp 10');
  });

  test('🔴 page 2 has not', async () => {
    const asked: string[] = [];
    const page = visibleText(
      await html({ ...BASE, page: 2 }, (url) => {
        asked.push(url);
        return api(payload())(url);
      }),
    );
    expect(page).toContain('Camp 10');
    expect(page).not.toContain('Driving a camper here');
    expect(asked.some((u) => u.includes('/spots/insights/'))).toBe(false);
  });

  test('🔴 a /filter?… address has not, and asks for no figures', async () => {
    const asked: string[] = [];
    const page = visibleText(
      await html(
        { ...BASE, searchParams: { types: 'paid' }, live: true },
        (url) => {
          asked.push(url);
          return api(payload())(url);
        },
      ),
    );
    expect(page).toContain('Camp 10');
    expect(page).not.toContain('Driving a camper here');
    expect(asked.some((u) => u.includes('/spots/insights/'))).toBe(false);
  });
});
