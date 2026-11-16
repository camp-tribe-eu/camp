import { expect, test } from '@playwright/test';
import RegionListing from '@/components/region-listing';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-441 (58): the campsite cards of a region page — their picture, and
// the line they no longer print.
//
// 🔴 Every claim reads the HTML the page serves. The stub API below is
// written here, with four hand-made campsites:
//
//   outlined   a Polygon outline and coordinates       → its own shape
//   pointed    coordinates, no outline                  → the region's cloud, marked
//   bare       neither                                  → the cloud, not marked
//   garbled    an outline that is not GeoJSON           → as pointed: one bad
//              geometry costs one thumbnail, not the page
//
// and, apart, the region's own points (what the map's chunk route holds).

const COUNTRY = 'si';
const REGION = 'testland';

const SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [14.0, 46.0],
      [14.002, 46.0],
      [14.002, 46.001],
      [14.0, 46.001],
      [14.0, 46.0],
    ],
  ],
};

const amen = (o: Record<string, string> = {}) => o;

const ITEMS = [
  { slug: 'outlined', name: 'Outlined', country: 'SI', region: 'Testland', type: 'paid', amenities: amen({ shower: 'yes' }), lat: 46.0005, lon: 14.001, outline: SQUARE },
  { slug: 'pointed', name: 'Pointed', country: 'SI', region: 'Testland', type: 'free', amenities: amen(), lat: 46.2, lon: 14.3, outline: null },
  { slug: 'bare', name: 'Bare', country: 'SI', region: 'Testland', type: 'free', amenities: amen() },
  { slug: 'garbled', name: 'Garbled', country: 'SI', region: 'Testland', type: 'free', amenities: amen(), lat: 46.1, lon: 14.1, outline: { type: 'Polygon', coordinates: 'x' } },
];

const POINTS = [
  { lat: 46.0, lon: 14.0 },
  { lat: 46.2, lon: 14.3 },
  { lat: 46.1, lon: 14.1 },
  { lat: 46.3, lon: 14.5 },
].map((p) => ({ ...p, slug: 's', name: null, type: 'free', amenities: null, path: null }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function render(points: unknown | null = POINTS, items: unknown[] = ITEMS): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = ((raw: string) =>
    Promise.resolve().then(() => {
      const url = new URL(String(raw));
      if (url.pathname === `/spots/${COUNTRY}/regions`)
        return json([{ region: 'Testland', slug: REGION, spots: items.length, indexable: true }]);
      if (url.pathname === `/spots/map/region/${COUNTRY}/${REGION}`)
        return points === null ? json({}, 500) : json(points);
      if (url.pathname === `/spots/${COUNTRY}/${REGION}`)
        return json({ region: 'Testland', total: items.length, matched: items.length, items });
      return json({}, 404);
    })) as typeof fetch;
  try {
    return await renderAsyncComponent(RegionListing, { country: COUNTRY, region: REGION, page: 1, searchParams: {} });
  } finally {
    globalThis.fetch = real;
  }
}

/** The `<li>` of one card, by the campsite's link. */
function cardOf(html: string, slug: string): string {
  const at = html.indexOf(`href="/camping/${COUNTRY}/${REGION}/${slug}"`);
  expect(at, `no card for ${slug}`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<li', at), html.indexOf('</li>', at));
}

test('🔴 a campsite with an outline is drawn by its own outline, fitted and closed', async () => {
  const card = cardOf(await render(), 'outlined');
  const d = /<path class="ct-art__shape" d="([^"]*)"/.exec(card)?.[1];
  expect(d, 'no outline in the card').toBeDefined();
  // Four corners and the closing vertex, then Z, inside the 160 x 90 tile.
  expect(d).toMatch(/^M[\d. ]+(L[\d. ]+){4}Z$/);
  for (const n of d!.match(/\d+(\.\d+)?/g)!.map(Number)) {
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(160);
  }
  expect(card).not.toContain('<use');
});

test('🔴 without an outline: the region cloud, this campsite marked; without coordinates: the cloud, no mark', async () => {
  const html = await render();
  for (const slug of ['pointed', 'garbled']) {
    const card = cardOf(html, slug);
    expect(card, slug).toContain('<use href="#ct-region-cloud"');
    expect(card, slug).toMatch(/<circle class="ct-art__mark" cx="[\d.]+" cy="[\d.]+" r="/);
    expect(card, slug).not.toContain('ct-art__shape');
  }
  const bare = cardOf(html, 'bare');
  expect(bare).toContain('<use href="#ct-region-cloud"');
  expect(bare).not.toContain('ct-art__mark');
  // The cloud is defined ONCE and referenced by every card that needs it.
  expect(html.match(/<symbol id="ct-region-cloud"/g)).toHaveLength(1);
  expect(html.match(/<use href="#ct-region-cloud"/g)).toHaveLength(3);
  // The two marks are in different places: the picture says WHICH campsite.
  const at = (slug: string) => /cx="([\d.]+)" cy="([\d.]+)"/.exec(cardOf(html, slug))!.slice(1).join(',');
  expect(at('pointed')).not.toBe(at('garbled'));
});

test('🔴 "Facilities not recorded" is gone from the cards, and a recorded facility is still printed', async () => {
  const html = await render();
  expect(visibleText(html)).not.toContain('Facilities not recorded');
  expect(visibleText(cardOf(html, 'pointed'))).toBe('PointedFree campsiteView campsite');
  expect(visibleText(cardOf(html, 'outlined'))).toContain('Showers');
  // No facilities: no empty row either — an empty tag row is a 16px hole.
  expect(cardOf(html, 'pointed')).not.toContain('ct-card__tags');
  expect(cardOf(html, 'outlined')).toContain('ct-card__tags');
});

test('🔴 the region whose points cannot be read: cards stand, outlines still drawn, no empty frame', async () => {
  for (const points of [null, [], 'nope']) {
    const html = await render(points);
    expect(html.match(/class="ct-card"/g), String(points)).toHaveLength(ITEMS.length);
    expect(cardOf(html, 'outlined')).toContain('ct-art__shape');
    for (const slug of ['pointed', 'bare', 'garbled']) {
      const card = cardOf(html, slug);
      expect(card, `${String(points)} ${slug}`).not.toContain('ct-card__image');
      expect(card).not.toContain('<svg');
    }
    expect(html).not.toContain('<symbol');
  }
});

test('the note about the data stands on the filter panel, once', async () => {
  const html = await render();
  const text = visibleText(html);
  expect(text.match(/Facilities come from OpenStreetMap contributors/g)).toHaveLength(1);
  expect(text).toContain('not recorded, which is not the same as not there');
});

test('🔴 the region page carries the bottom panel: filters link, sort, density 3 radios (middle on), back to top', async () => {
  const html = await render();
  const panel = /<nav aria-label="Filter, sort and view"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  expect(panel).toContain('data-testid="region-toolbar"');
  expect(panel).toMatch(/<a href="#filters"[^>]*>[\s\S]*Filters<\/a>/);
  expect(panel).toContain('<summary');
  const radios = [...panel.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('name="ct-density"'));
  expect(radios).toHaveLength(3);
  expect(radios.filter((t) => /\bchecked\b/.test(t))).toHaveLength(1);
  expect(/\bid="ct-density-b"/.test(radios.find((t) => /\bchecked\b/.test(t))!)).toBe(true);
  expect(panel).toMatch(/<a href="#top"[^>]*aria-label="Back to top"/);
  // The grid the radios drive is the one the page draws, and the rules that drive it are served.
  expect(html).toContain('<ul class="ct-cards');
  expect(html).toContain('body:has(#ct-density-c:checked) .ct-cards{');
  // Nothing sticky at the top any more: the island has nothing to cover.
  expect(/\.ct-toolbar\{[^}]*sticky/.test(html)).toBe(false);
});
