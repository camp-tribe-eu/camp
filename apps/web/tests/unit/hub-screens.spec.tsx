import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import CountryHub from '@/app/camping/[country]/page';
import RegionPage from '@/app/camping/[country]/[region]/page';
import RegionListing from '@/components/region-listing';
import {
  countryTiles,
  enoughRecorded,
  FILL_MIN,
  formatEur,
  MIN_KNOWN,
  readHubStats,
  regionFaq,
  regionTiles,
  type HubRegionStats,
} from '@/lib/hub-stats';
import { renderAsyncComponent, renderNestedAsync } from './render-component';
import { requestReaders, walkImportGraph } from './import-graph';
import { visibleText } from './rendered-text';

// Design-audit §11, screens 1 and 2 — the stat tiles, the two buttons and
// the FAQ, read off the HTML the PAGES render with `fetch` swapped for a
// canned API.
//
// 🔴 EVERY EXPECTED NUMBER BELOW IS A CONSTANT COUNTED BY HAND from the
// fixture as written, never computed here from the fields the code adds
// up. Bovec has electricity yes 16, no 9 over 100 sites: the tile must
// say "16 of 25" and "75 sites have no record" — 25 and 75 are typed in,
// so a page that printed the region's 100 is caught, and so is a test
// that would have re-derived 25 with the code's own formula.
//
// 🔴 THE TWO MUTATIONS THE CARD NAMES are run against this file:
//   · the fill gate removed (a figure prints below 20 % / below 5 known)
//     → Bovec prints a price from 3 sites, Kranj prints electricity from
//       7 of 40, Ptuj from 4 of 4;
//   · the denominator swapped for the whole region
//     → "16 of 100" instead of "16 of 25".
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

// ── The fixture: three regions of one country ───────────────────────────
//
//   Bovec   100 sites · free/wild 7  · electricity 16 yes + 9 no  = 25 (25 %)
//                      · overnight 10 allowed + 2 forbidden = 12 (12 %)
//                      · price on 3 sites (3 %), lowest 9.00
//   Kranj    40 sites · free/wild 0  · electricity 5 + 2 = 7 (17.5 %, ≥ 5)
//                      · overnight 8 + 1 = 9 (22.5 %)       · no price
//   Ptuj      4 sites · free/wild 1  · electricity 2 + 2 = 4 (100 %, < 5)
//                      · overnight 0 · no price · no day read
//
//   Country: 144 sites, 8 free/wild, 3 regions, price on 3 of 144.

const BOVEC: HubRegionStats = {
  region: 'Bovec',
  slug: 'bovec',
  spots: 100,
  readAt: '2026-10-18',
  freeWild: 7,
  electricity: { yes: 16, no: 9 },
  overnight: { allowed: 10, forbidden: 2 },
  price: { known: 3, minEur: '9.00' },
};

const KRANJ: HubRegionStats = {
  region: 'Kranj',
  slug: 'kranj',
  spots: 40,
  readAt: '2026-10-12',
  freeWild: 0,
  electricity: { yes: 5, no: 2 },
  overnight: { allowed: 8, forbidden: 1 },
  price: { known: 0, minEur: null },
};

const PTUJ: HubRegionStats = {
  region: 'Ptuj',
  slug: 'ptuj',
  spots: 4,
  readAt: null,
  freeWild: 1,
  electricity: { yes: 2, no: 2 },
  overnight: { allowed: 0, forbidden: 0 },
  price: { known: 0, minEur: null },
};

const STATS = [BOVEC, KRANJ, PTUJ];

const REGIONS = STATS.map((r) => ({
  region: r.region,
  slug: r.slug,
  spots: r.spots,
  indexable: r.spots >= 3,
}));

const card = (region: string, i: number) => ({
  slug: `camp-${i}`,
  name: `Camp ${i}`,
  country: 'si',
  region,
  type: 'paid',
  amenities: {},
});

const listing = (r: HubRegionStats) => ({
  region: r.region,
  total: r.spots,
  items: Array.from({ length: Math.min(24, r.spots) }, (_, i) => card(r.region, i + 1)),
});

function api(stats: unknown = STATS): Fetcher {
  return (url) => {
    if (url.endsWith('/spots/si/regions')) return json(REGIONS);
    if (url.endsWith('/spots/hub-stats/si')) return json(stats);
    for (const r of STATS) {
      if (url.includes(`/spots/si/${r.slug}?page=`)) return json(listing(r));
    }
    return json({}, 404);
  };
}

async function countryHtml(stats: unknown = STATS): Promise<string> {
  let html = '';
  await withFetch(api(stats), async () => {
    html = await renderAsyncComponent(CountryHub, {
      params: Promise.resolve({ country: 'si' }),
    });
  });
  return html;
}

async function regionHtml(slug: string, stats: unknown = STATS): Promise<string> {
  let html = '';
  await withFetch(api(stats), async () => {
    html = await renderNestedAsync(RegionPage, {
      params: Promise.resolve({ country: 'si', region: slug }),
    });
  });
  return html;
}

/**
 * The words of the "Key figures" tiles ALONE — `visibleText` of the one
 * `<section aria-label="Key figures">`, '' when there is none.
 *
 * 🔴 Why not the whole page: after the hub filters (#364) every region
 * page prints "Electricity", "Showers", "Toilets" as filter chips, so
 * "the page does not say Electricity" stopped meaning "no electricity
 * tile". The section is found by its landmark, not by the shape of a
 * tile, and every "does not say" on it below stands beside a "does say"
 * on the same string, so an empty section cannot satisfy it.
 */
const tilesText = (html: string): string => {
  const m = /<section[^>]*aria-label="Key figures"[^>]*>[\s\S]*?<\/section>/.exec(html);
  return m ? visibleText(m[0]) : '';
};

const AS_OF_18 = 'Counted from our listings as of 18 October 2026.';
const AS_OF_12 = 'Counted from our listings as of 12 October 2026.';

// ── The gate, on the figures alone ──────────────────────────────────────

test.describe('the fill gate', () => {
  test('anchor: the thresholds are the ones the card names', () => {
    expect(FILL_MIN).toBe(0.2);
    expect(MIN_KNOWN).toBe(5);
  });

  test('🔴 below 20 % recorded, nothing — above it, the figure; at it, the figure', () => {
    expect(enoughRecorded(19, 100)).toBe(false);
    expect(enoughRecorded(20, 100)).toBe(true);
    expect(enoughRecorded(25, 100)).toBe(true);
    // 100 % recorded but fewer than five sites is still nothing.
    expect(enoughRecorded(4, 4)).toBe(false);
    expect(enoughRecorded(5, 5)).toBe(true);
  });

  test('🔴 Bovec: electricity 16 of 25 prints, 75 unrecorded named; a price on 3 of 100 does not', () => {
    const tiles = regionTiles(BOVEC);
    expect(tiles.map((t) => t.key)).toEqual(['campsites', 'free-wild', 'electricity']);
    const el = tiles.find((t) => t.key === 'electricity')!;
    expect(el.value).toBe('16 of 25');
    expect(el.note).toBe('sites where OpenStreetMap records it; 75 sites have no record');
    expect(tiles.find((t) => t.key === 'price')).toBeUndefined();
  });

  test('🔴 Kranj: electricity on 7 of 40 (17.5 %) is not printed', () => {
    expect(regionTiles(KRANJ).map((t) => t.key)).toEqual(['campsites', 'free-wild']);
  });

  test('🔴 Ptuj: electricity on all 4 of 4 is not printed — four is under five', () => {
    expect(regionTiles(PTUJ).map((t) => t.key)).toEqual(['campsites', 'free-wild']);
  });

  test('exactly at the gate the figure prints: 3 yes + 2 no over 25 sites', () => {
    const tiles = regionTiles({ ...PTUJ, spots: 25, electricity: { yes: 3, no: 2 } });
    expect(tiles.find((t) => t.key === 'electricity')?.value).toBe('3 of 5');
    expect(tiles.find((t) => t.key === 'electricity')?.note).toBe(
      'sites where OpenStreetMap records it; 20 sites have no record',
    );
  });

  test('a price prints when 20 of 100 sites carry one: the lowest, as the feed wrote it', () => {
    const tiles = regionTiles({ ...BOVEC, price: { known: 20, minEur: '12.50' } });
    const price = tiles.find((t) => t.key === 'price')!;
    expect(price.label).toBe('From');
    expect(price.value).toBe('€12.50 a night');
    expect(price.note).toBe('lowest dated overnight rate; 20 of the 100 sites have one');
    // One under the gate: nothing.
    expect(
      regionTiles({ ...BOVEC, price: { known: 19, minEur: '12.50' } }).find((t) => t.key === 'price'),
    ).toBeUndefined();
  });

  test('money is printed as written: 9.00 → €9, 12.50 → €12.50, 7.5 → €7.5', () => {
    expect(formatEur('9.00')).toBe('€9');
    expect(formatEur('12.50')).toBe('€12.50');
    expect(formatEur('7.5')).toBe('€7.5');
  });
});

// ── Screen 1: the country's tiles ───────────────────────────────────────

test.describe('country tiles', () => {
  test('🔴 144 campsites, 8 free & wild, 3 regions — and no price from 3 of 144', () => {
    const tiles = countryTiles(STATS);
    expect(tiles.map((t) => [t.key, t.value])).toEqual([
      ['campsites', '144'],
      ['free-wild', '8'],
      ['regions', '3'],
    ]);
  });

  test('a price prints when 21 of 100 sites across two regions carry one, the lowest of the two', () => {
    const tiles = countryTiles([
      { ...BOVEC, spots: 60, price: { known: 9, minEur: '11.00' } },
      { ...KRANJ, spots: 40, price: { known: 12, minEur: '9.50' } },
    ]);
    expect(tiles.find((t) => t.key === 'price')?.value).toBe('€9.50 a night');
    expect(tiles.find((t) => t.key === 'price')?.note).toBe(
      'lowest dated overnight rate; 21 of the 100 sites have one',
    );
  });

  test('no rows, no tiles — not four zeros', () => {
    expect(countryTiles([])).toEqual([]);
  });

  test('🔴 one bad row costs one row: the other two still count', () => {
    const rows = readHubStats([BOVEC, { ...KRANJ, freeWild: 41 }, PTUJ]);
    expect(rows.map((r) => r.slug)).toEqual(['bovec', 'ptuj']);
    expect(countryTiles(rows).map((t) => t.value)).toEqual(['104', '8', '2']);
    // And a payload that is not a list is no rows at all.
    expect(readHubStats({ region: 'x' })).toEqual([]);
    expect(readHubStats(null)).toEqual([]);
  });

  test('a row that disagrees with itself is dropped: known answers over the whole, a price with no sites', () => {
    expect(readHubStats([{ ...BOVEC, electricity: { yes: 60, no: 41 } }])).toEqual([]);
    expect(readHubStats([{ ...BOVEC, overnight: { allowed: 99, forbidden: 2 } }])).toEqual([]);
    expect(readHubStats([{ ...BOVEC, price: { known: 0, minEur: '9.00' } }])).toEqual([]);
    expect(readHubStats([{ ...BOVEC, price: { known: 3, minEur: null } }])).toEqual([]);
    expect(readHubStats([{ ...BOVEC, price: { known: 3, minEur: 9 } }])).toEqual([]);
    expect(readHubStats([{ ...BOVEC, readAt: '18.10.2026' }])[0]?.readAt).toBeNull();
  });
});

// ── The FAQ, on the figures alone ───────────────────────────────────────

test.describe('the FAQ asks only what the data answers', () => {
  test('🔴 Bovec: free places and electricity; no overnight question from 12 of 100', () => {
    const faq = regionFaq(BOVEC);
    expect(faq.map((f) => f.key)).toEqual(['free', 'electricity']);
    expect(faq[0].question).toBe('Are there free places to camp in Bovec?');
    expect(faq[0].answer).toBe(
      '7 of the 100 sites we list in Bovec are free campsites or wild camping spots by their OpenStreetMap tag; the other 93 are campsites, motorhome parks or camper stops. ' +
        AS_OF_18,
    );
    expect(faq[1].question).toBe('Do campsites in Bovec have electricity?');
    expect(faq[1].answer).toBe(
      'Of the 25 sites where OpenStreetMap records whether there is electricity, 16 have it and 9 do not. The other 75 sites have no record either way. ' +
        AS_OF_18,
    );
  });

  test('🔴 Kranj: free places (none) and overnight; no electricity question from 7 of 40', () => {
    const faq = regionFaq(KRANJ);
    expect(faq.map((f) => f.key)).toEqual(['free', 'overnight']);
    expect(faq[0].answer).toBe(
      'None of the 40 sites we list in Kranj carries a free-camping or wild-camping tag in OpenStreetMap. ' +
        AS_OF_12,
    );
    expect(faq[1].question).toBe('Can a motorhome stay overnight at campsites in Kranj?');
    expect(faq[1].answer).toBe(
      'For 8 of the 40 sites we list in Kranj, OpenStreetMap says an overnight stay in a motorhome is allowed, and for 1 that it is not. For the other 31 we do not know, which is not the same as not allowed. ' +
        AS_OF_12,
    );
  });

  test('Ptuj: one question, and no day to count from', () => {
    const faq = regionFaq(PTUJ);
    expect(faq.map((f) => f.key)).toEqual(['free']);
    expect(faq[0].answer).toBe(
      '1 of the 4 sites we list in Ptuj is a free campsite or a wild camping spot by their OpenStreetMap tag; the other 3 are campsites, motorhome parks or camper stops.',
    );
  });

  // 🔴 Jõgeva (ee): 21 of 21 free — no "the other 0". Seven regions of
  // Latvia list one site, and it is free — no "1 of the 1 site".
  test('🔴 every site free: "All 21 sites", never "the other 0"', () => {
    const faq = regionFaq({ ...BOVEC, region: 'Jõgeva', spots: 21, freeWild: 21, readAt: '2026-10-16' });
    expect(faq[0].answer).toBe(
      'All 21 sites we list in Jõgeva are free campsites or wild camping spots by their OpenStreetMap tag. Counted from our listings as of 16 October 2026.',
    );
    expect(faq[0].answer).not.toContain('other');
    expect(faq[0].answer).not.toContain(' 0 ');
  });

  test('🔴 one site, and it is free: "The one site", never "1 of the 1"', () => {
    const faq = regionFaq({ ...PTUJ, region: 'Alūksne', spots: 1, freeWild: 1, electricity: { yes: 0, no: 0 } });
    expect(faq[0].answer).toBe(
      'The one site we list in Alūksne is a free campsite or a wild camping spot by its OpenStreetMap tag.',
    );
    expect(faq[0].answer).not.toContain('other');
  });

  test('no site free: "None", with no count of others either', () => {
    const [free] = regionFaq(KRANJ);
    expect(free.answer).toMatch(/^None of the 40 sites we list in Kranj/);
    expect(free.answer).not.toContain('other');
  });

  test('three is the ceiling: a region with every answer asks three', () => {
    const faq = regionFaq({ ...BOVEC, overnight: { allowed: 20, forbidden: 0 } });
    expect(faq.map((f) => f.key)).toEqual(['free', 'overnight', 'electricity']);
    expect(faq[1].answer).toBe(
      'For 20 of the 100 sites we list in Bovec, OpenStreetMap says an overnight stay in a motorhome is allowed. For the other 80 we do not know, which is not the same as not allowed. ' +
        AS_OF_18,
    );
  });

  test('no sites, no questions', () => {
    expect(regionFaq({ ...PTUJ, spots: 0, freeWild: 0, electricity: { yes: 0, no: 0 } })).toEqual([]);
  });
});

// ── Screen 1, as served ─────────────────────────────────────────────────

test.describe('the country page', () => {
  test('anchor: the page renders, with its regions and its tiles', async () => {
    const text = visibleText(await countryHtml());
    expect(text).toContain('Campsites in Slovenia');
    expect(text).toContain('Bovec');
    expect(text).toContain('Kranj');
    expect(text.length).toBeGreaterThan(300);
  });

  test('🔴 the four tiles are three: 144 campsites, 8 free & wild, 3 regions, no price', async () => {
    const text = visibleText(await countryHtml());
    expect(text).toMatch(/Campsites\s+144\b/);
    expect(text).toMatch(/Free & wild spots\s+8\b/);
    expect(text).toMatch(/Regions\s+3\b/);
    expect(text).not.toMatch(/\bFrom\s+€/);
    expect(text).not.toContain('a night');
    expect(text).toContain(AS_OF_18);
  });

  test('a price tile appears once enough sites carry one', async () => {
    const text = visibleText(
      await countryHtml([
        { ...BOVEC, spots: 60, price: { known: 9, minEur: '11.00' } },
        { ...KRANJ, spots: 40, price: { known: 12, minEur: '9.50' } },
      ]),
    );
    expect(text).toMatch(/From\s+€9\.50 a night/);
  });

  test('🔴 the two buttons lead to pages that exist', async () => {
    const html = await countryHtml();
    const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
      href: /href="([^"]*)"/.exec(m[1])?.[1] ?? '',
      text: visibleText(m[2]).trim(),
    }));
    const map = anchors.find((a) => a.text === 'Open on map');
    const plan = anchors.find((a) => a.text === 'Plan a trip');
    expect(map?.href).toBe('/map');
    expect(plan?.href).toBe('/plan');
    for (const a of [map!, plan!]) {
      expect(
        existsSync(join(__dirname, '..', '..', 'src', 'app', a.href, 'page.tsx')),
        `${a.href} has no page`,
      ).toBe(true);
    }
  });

  test('the API without the route: the page stands, with no tiles and no zeros', async () => {
    const html = await countryHtml();
    let without = '';
    await withFetch(
      (url) =>
        url.endsWith('/spots/hub-stats/si') ? json({ statusCode: 404 }, 404) : api()(url),
      async () => {
        without = await renderAsyncComponent(CountryHub, {
          params: Promise.resolve({ country: 'si' }),
        });
      },
    );
    const text = visibleText(without);
    expect(text).toContain('Campsites in Slovenia');
    expect(without).not.toContain('<dl');
    expect(text).not.toMatch(/Campsites\s+0\b/);
    expect(html).toContain('<dl');
  });
});

// ── Screen 2 and the FAQ, as served ─────────────────────────────────────

test.describe('the region page', () => {
  test('anchor: the page renders its listing, its tiles and its questions', async () => {
    const html = await regionHtml('bovec');
    const text = visibleText(html);
    expect(text).toContain('Campsites in Bovec');
    expect(text).toContain('Camp 24');
    expect(text).toContain('Questions about camping in Bovec');
    expect(html).toContain('<details');
  });

  test('🔴 Bovec prints 100, 7 and "16 of 25" with 75 unrecorded — never "16 of 100", never a price', async () => {
    const text = visibleText(await regionHtml('bovec'));
    expect(text).toMatch(/Campsites\s+100\b/);
    expect(text).toMatch(/Free & wild spots\s+7\b/);
    expect(text).toMatch(/Electricity\s+16 of 25\s+sites where OpenStreetMap records it; 75 sites have no record/);
    expect(text).not.toContain('16 of 100');
    expect(text).not.toContain('a night');
    expect(text).toContain(AS_OF_18);
  });

  test('🔴 Bovec asks two questions, in the words of the data, and not the third', async () => {
    const html = await regionHtml('bovec');
    expect(html.match(/<details/g)?.length).toBe(2);
    expect(html).toContain('<summary');
    expect(html).toContain('Are there free places to camp in Bovec?');
    expect(html).toContain(
      '7 of the 100 sites we list in Bovec are free campsites or wild camping spots by their OpenStreetMap tag; the other 93 are campsites, motorhome parks or camper stops. ' +
        AS_OF_18,
    );
    expect(html).toContain('Do campsites in Bovec have electricity?');
    expect(html).toContain(
      'Of the 25 sites where OpenStreetMap records whether there is electricity, 16 have it and 9 do not. The other 75 sites have no record either way. ' +
        AS_OF_18,
    );
    expect(html).not.toContain('stay overnight');
  });

  test('🔴 Kranj: no electricity tile from 7 of 40, free & wild 0, overnight asked, electricity not', async () => {
    const html = await regionHtml('kranj');
    const tiles = tilesText(html);
    expect(tiles).toMatch(/Campsites\s+40\b/);
    expect(tiles).toMatch(/Free & wild spots\s+0\b/);
    expect(tiles).not.toContain('Electricity');
    expect(html.match(/<details/g)?.length).toBe(2);
    expect(html).toContain('Can a motorhome stay overnight at campsites in Kranj?');
    expect(html).toContain(
      'For 8 of the 40 sites we list in Kranj, OpenStreetMap says an overnight stay in a motorhome is allowed, and for 1 that it is not. For the other 31 we do not know, which is not the same as not allowed. ' +
        AS_OF_12,
    );
    expect(html).toContain(
      'None of the 40 sites we list in Kranj carries a free-camping or wild-camping tag in OpenStreetMap. ' +
        AS_OF_12,
    );
    expect(html).not.toContain('have electricity?');
  });

  test('Ptuj: one question, no electricity from 4 of 4, no day line', async () => {
    const html = await regionHtml('ptuj');
    const text = visibleText(html);
    const tiles = tilesText(html);
    expect(tiles).toMatch(/Campsites\s+4\b/);
    expect(tiles).not.toContain('Electricity');
    expect(text).not.toContain('Counted from our listings');
    expect(html.match(/<details/g)?.length).toBe(1);
    expect(html).toContain('Are there free places to camp in Ptuj?');
  });

  test('🔴 a region whose row did not arrive gets NO tiles and NO FAQ — not an empty <details>', async () => {
    const html = await regionHtml('bovec', [KRANJ, PTUJ]);
    const text = visibleText(html);
    expect(text).toContain('Campsites in Bovec');
    expect(text).toContain('Camp 24');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
    expect(html).not.toContain('<dl');
    expect(text).not.toContain('Questions about camping');
    expect(text).not.toContain('Counted from our listings');
  });
});

// ── б) and в) One address for the figures; an empty filter is an answer ─

test.describe('the figures live on the base page only', () => {
  const render = async (props: Parameters<typeof RegionListing>[0], fetcher: Fetcher = api()) => {
    let html = '';
    await withFetch(fetcher, async () => {
      html = await renderNestedAsync(RegionListing, props);
    });
    return html;
  };

  test('anchor: page 1 of the base page has tiles, questions and the listing', async () => {
    const html = await render({ country: 'si', region: 'bovec', page: 1 });
    expect(html).toContain('<dl');
    expect(html).toContain('<details');
    expect(visibleText(html)).toContain('Camp 24');
  });

  test('🔴 page 2 has neither tiles nor questions', async () => {
    const html = await render({ country: 'si', region: 'bovec', page: 2 });
    expect(visibleText(html)).toContain('Camp 24');
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('<details');
    expect(visibleText(html)).not.toContain('Questions about camping');
  });

  test('🔴 a /filter?… address has neither tiles nor questions, and asks for no figures', async () => {
    const asked: string[] = [];
    const html = await render(
      { country: 'si', region: 'bovec', page: 1, searchParams: { types: 'paid' }, live: true },
      (url) => {
        asked.push(url);
        return api()(url);
      },
    );
    expect(visibleText(html)).toContain('Camp 24');
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('<details');
    expect(asked.some((u) => u.includes('/spots/hub-stats/'))).toBe(false);
  });

  test('🔴 an empty filtered result is a page with three actions, not a 404', async () => {
    const html = await render(
      { country: 'si', region: 'bovec', page: 1, searchParams: { types: 'wild' }, live: true },
      (url) =>
        url.includes('/spots/si/bovec?page=1')
          ? json({ region: 'Bovec', total: 100, matched: 0, unknownExcluded: 0, items: [], dropOne: [] })
          : api()(url),
    );
    const text = visibleText(html);
    expect(text).toContain('No wild camping spot is listed in Bovec');
    expect(text).toContain('Clear all filters');
    expect(text).toContain('Other regions in Slovenia');
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('<details');
  });
});

// ── г) The hub pages stay static ────────────────────────────────────────
//
// Nothing in the two pages or in anything they import may read a request:
// no `headers()`, no `cookies()`, no `no-store`, no `force-dynamic`
// anywhere in the graph — and no `searchParams` in the PAGE files, which
// is where Next hands a request over (a page that reads that prop is
// rendered on request, every request). Since the hub filters (#364) the
// shared `RegionListing` and `lib/hub-filters.ts` take an object by that
// name from the /filter route; the static pages pass nothing, so the word
// in a parser is inert and only its use in a page can make a page dynamic.
// Walked through the import graph from the page files, `@/` and relative
// imports only — packages are not ours to check.

test('🔴 the country and region pages and everything they import read no request', () => {
  const SRC = resolve(__dirname, '..', '..', 'src');
  const pages = [
    join(SRC, 'app', 'camping', '[country]', 'page.tsx'),
    join(SRC, 'app', 'camping', '[country]', '[region]', 'page.tsx'),
    join(SRC, 'app', 'camping', '[country]', '[region]', 'page', '[n]', 'page.tsx'),
  ];
  const seen = walkImportGraph(SRC, pages);
  // Anchor: the walk reached the pages' own pieces, or it proves nothing.
  const names = [...seen].map((f) => f.slice(SRC.length + 1));
  expect(names).toContain('lib/hub-stats.ts');
  expect(names).toContain('components/hub-stats.tsx');
  expect(names).toContain('components/region-listing.tsx');
  // CAMP-404: "Driving a camper here" hangs on the same page and must be
  // inside this walk, or the guard would pass over it.
  expect(names).toContain('components/region-driving.tsx');
  expect(seen.size).toBeGreaterThan(10);

  const offenders = requestReaders(SRC, seen);
  for (const file of pages) {
    if (/\bsearchParams\b/.test(readFileSync(file, 'utf8'))) {
      offenders.push(`${file.slice(SRC.length + 1)}: searchParams in a page`);
    }
  }
  expect(offenders).toEqual([]);
});
