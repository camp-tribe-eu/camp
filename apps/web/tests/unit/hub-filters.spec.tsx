import { expect, test } from '@playwright/test';
import RegionListing from '@/components/region-listing';
import FilteredRegionPage from '@/app/camping/[country]/[region]/filter/page';
import { AMENITY_KEYS, SPOT_TYPES, type SpotCard } from '@/lib/api';
import { hubHref, parseHubQuery } from '@/lib/hub-filters';
import { renderAsyncComponent } from './render-component';
import { decodeEntities, visibleText } from './rendered-text';

// The region hub's filters, sort and empty state (design-audit §11,
// screens 2 and 3), as the HTML a reader is served.
//
// 🔴 THE EVIDENCE IS NOT MADE OF THE THING MEASURED. The API below is a
// stub written in THIS file: it reads the query string the page sent and
// filters thirty rows with its own `if`s — not with `matchesStrict`, not
// with anything from `hub-filters.ts`. So when the page says "26 sites
// match", 26 was counted here, from rows listed here, and the page is
// right only if it asked the API the right question and printed the
// API's answer rather than the length of the page it holds.
//
// 🔴 Every assertion reads `visibleText` of the rendered page or an
// `href` in it — never a constant, a class, a data attribute or an
// `sr-only` caption.

const COUNTRY = 'si';
const REGION = 'testland';
const BASE = `/camping/${COUNTRY}/${REGION}`;

type Row = SpotCard;

/**
 * Thirty rows, built so that every number below is a hand count:
 *   26 free   — 10 with a recorded shower, 8 with a recorded no, 8 unrecorded
 *    3 paid   — all with a recorded shower
 *    1 wild   — shower no, laundry unrecorded
 * Nobody has a laundry. Two rows are nameless.
 */
const ROWS: Row[] = [];
const row = (slug: string, type: Row['type'], a: Partial<Row['amenities']>, name: string | null = slug) =>
  ROWS.push({
    slug,
    name,
    country: 'SI',
    region: 'Testland',
    type,
    amenities: a as Row['amenities'],
  });
for (let i = 1; i <= 10; i++) row(`free-shower-${i}`, 'free', { shower: 'yes' });
for (let i = 1; i <= 8; i++) row(`free-noshower-${i}`, 'free', { shower: 'no' });
for (let i = 1; i <= 8; i++) row(`free-unknown-${i}`, 'free', {}, i > 6 ? null : `free-unknown-${i}`);
for (let i = 1; i <= 3; i++) row(`paid-${i}`, 'paid', { shower: 'yes', water: 'yes' });
row('wild-1', 'wild', { shower: 'no' });

const FREE = ROWS.filter((r) => r.type === 'free').length; // 26
const PAID = ROWS.filter((r) => r.type === 'paid').length; // 3
const SHOWER_YES = ROWS.filter((r) => r.amenities.shower === 'yes').length; // 13
const SHOWER_UNRECORDED = ROWS.filter((r) => r.amenities.shower === undefined).length; // 8
expect(FREE).toBe(26);
expect(PAID).toBe(3);
expect(SHOWER_YES).toBe(13);
expect(SHOWER_UNRECORDED).toBe(8);

/**
 * Hand counts. A chip's count is what the reader gets after clicking it:
 * an off chip ADDS its value to the current filters, an on chip REMOVES
 * it. Rows: 26 free (10 shower yes, 8 no, 8 unrecorded), 3 paid (shower
 * and water yes), 1 wild (shower no). Nobody has anything else.
 */
const zero = (keys: readonly string[], over: Record<string, number> = {}) =>
  Object.fromEntries(keys.map((k) => [k, over[k] ?? 0]));
const HAND: Record<
  string,
  {
    facets: { types: Record<string, number>; amenities: Record<string, number> };
    dropOne?: { kind: string; key: string; matched: number }[];
  }
> = {
  // nothing chosen: each type alone; each amenity alone
  '||0': {
    facets: {
      types: zero(SPOT_TYPES, { free: 26, paid: 3, wild: 1 }),
      amenities: zero(AMENITY_KEYS, { shower: 13, water: 3 }),
    },
  },
  // paid on: free → free+paid 29; paid → off → 30; wild → paid+wild 4;
  // amenities with paid: shower 3, water 3
  'paid||0': {
    facets: {
      types: zero(SPOT_TYPES, { free: 29, paid: 30, camper_stop: 3, rv_park: 3, wild: 4 }),
      amenities: zero(AMENITY_KEYS, { shower: 3, water: 3 }),
    },
  },
  // free on: off → 30; paid → 29; wild → 27; the others add nobody → 26;
  // amenities with free: shower 10
  'free||0': {
    facets: {
      types: zero(SPOT_TYPES, { free: 30, paid: 29, camper_stop: 26, rv_park: 26, wild: 27 }),
      amenities: zero(AMENITY_KEYS, { shower: 10 }),
    },
  },
  // shower on: types under shower: free 10, paid 3; shower → off → 30;
  // water → shower+water → the 3 paid
  '|shower|0': {
    facets: {
      types: zero(SPOT_TYPES, { free: 10, paid: 3 }),
      amenities: zero(AMENITY_KEYS, { shower: 30, water: 3 }),
    },
  },
  // wild + laundry: nobody has a laundry, so every type chip is 0 and so
  // is wild's own (laundry alone); laundry's own → wild alone → 1
  'wild|laundry|0': {
    facets: {
      types: zero(SPOT_TYPES),
      amenities: zero(AMENITY_KEYS, { laundry: 1 }),
    },
    dropOne: [
      { kind: 'type', key: 'wild', matched: 0 },
      { kind: 'amenity', key: 'laundry', matched: 1 },
    ],
  },
};

/** The stub API's own filter. Its own `if`s, on purpose. */
function stubFilter(url: URL) {
  const split = (v: string | null) => (v ? v.split(',') : []);
  const types = split(url.searchParams.get('types'));
  const amenities = split(url.searchParams.get('amenities'));
  const unknown = url.searchParams.get('unknown') === '1';
  const page = Number(url.searchParams.get('page') ?? '1');

  const val = (r: Row, k: string) =>
    (r.amenities as unknown as Record<string, string | undefined>)[k];
  const typeOk = (r: Row, ts: string[]) => ts.length === 0 || ts.includes(r.type);
  const strict = (r: Row, as: string[]) => as.every((k) => val(r, k) === 'yes');
  const lenient = (r: Row, as: string[]) => as.every((k) => val(r, k) !== 'no');
  const pass = (r: Row, ts = types, as = amenities) =>
    typeOk(r, ts) && (unknown ? lenient(r, as) : strict(r, as));

  const matched = ROWS.filter((r) => pass(r));
  const lenientCount = ROWS.filter((r) => typeOk(r, types) && lenient(r, amenities)).length;

  // 🔴 NOT COMPUTED. The chip counts and the drop-one counts are looked
  // up in a table written by hand from the thirty rows above — never
  // derived with a formula, because a formula here would be a copy of
  // the implementation and would agree with its defects (review found
  // exactly that: "Free 0" on a chip whose click gave 23). The page is
  // right only if the number it prints beside a chip is the `matched`
  // the stub's own filter gives for the chip's href.
  const key = `${types.join(',')}|${amenities.join(',')}|${unknown ? 1 : 0}`;
  const hand = HAND[key];
  const facets = hand?.facets;
  const dropOne = hand?.dropOne;
  const sorted = [...matched].sort(
    (a, b) =>
      Number(a.name === null) - Number(b.name === null) ||
      (a.name ?? a.slug).localeCompare(b.name ?? b.slug),
  );
  return {
    region: 'Testland',
    total: ROWS.length,
    matched: matched.length,
    unknownExcluded: unknown ? 0 : lenientCount - matched.length,
    items: sorted.slice((page - 1) * 24, page * 24),
    ...(facets ? { facets } : {}),
    ...(dropOne ? { dropOne } : {}),
    sort: url.searchParams.get('sort') ?? 'name',
  };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** Every request the page makes, answered by the stub; recorded for inspection. */
const asked: string[] = [];
function stubApi(raw: string): Response {
  const url = new URL(raw);
  asked.push(url.pathname + url.search);
  if (url.pathname === `/spots/${COUNTRY}/regions`) {
    return json([
      { region: 'Testland', slug: REGION, spots: ROWS.length, indexable: true },
      { region: 'Otherland', slug: 'otherland', spots: 4, indexable: false },
    ]);
  }
  if (url.pathname === `/spots/${COUNTRY}/${REGION}`) return json(stubFilter(url));
  return new Response('not found', { status: 404 });
}

async function withStub<T>(run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => stubApi(String(url)))) as typeof fetch;
  asked.length = 0;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

/** The hub, rendered, for a query string. `{}` is the plain region page. */
const render = (searchParams: Record<string, string>) =>
  withStub(() =>
    renderAsyncComponent(RegionListing, {
      country: COUNTRY,
      region: REGION,
      page: parseHubQuery(searchParams).page,
      searchParams,
    }),
  );

/** Every `href` in a piece of markup, attribute order and entities aside. */
const hrefsIn = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => decodeEntities(m[1]));

/**
 * The campsite links in the card list — the `<ul class="ct-cards …">`
 * after the toolbar and the filter panel (CAMP-452). One link per card,
 * so these are the cards.
 */
function cardLinks(html: string): string[] {
  const main = html.slice(html.indexOf('<main'));
  const list = /<ul class="ct-cards[^"]*">([\s\S]*?)<\/ul>\s*(?:<nav|<section)/.exec(main);
  return list ? hrefsIn(list[1]) : [];
}

/** The `<style>` blocks React hoisted into the served markup, as one string. */
const servedCss = (html: string) =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

/** The sort dropdown's option list (region-toolbar.tsx), as rendered. */
const sortOptions = (html: string) =>
  /<div class="ct-sort__options"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';

// ── the filter narrows the same region ────────────────────────────────────

test('the plain hub lists the region; types=free lists fewer, and says how many', async () => {
  const all = visibleText(await render({}));
  const free = await render({ types: 'free' });
  const freeText = visibleText(free);

  expect(all).toContain(`${ROWS.length} sites in Testland`);
  // The plain hub does not claim a match count it was not asked for.
  expect(all).not.toContain('sites match');

  expect(freeText).toContain(`${FREE} sites match`);
  expect(FREE).toBeLessThan(ROWS.length);
  // Every card on the page is a free one, and there are 24 of them —
  // not 26: the number printed is the API's count, not the page's length.
  const links = cardLinks(free);
  expect(links).toHaveLength(24);
  for (const href of links) expect(href).toMatch(new RegExp(`^${BASE}/free-`));
});

test('🔴 types=paid: the three paid rows, nothing else, and "3 sites match"', async () => {
  const html = await render({ types: 'paid' });
  expect(visibleText(html)).toContain(`${PAID} sites match`);
  expect(cardLinks(html).sort()).toEqual([
    `${BASE}/paid-1`,
    `${BASE}/paid-2`,
    `${BASE}/paid-3`,
  ]);
  // It asked the API with the filter, not after the fact.
  expect(asked).toContain(`/spots/${COUNTRY}/${REGION}?page=1&types=paid`);
});

test('amenities=shower: strict count, and the unrecorded named beside it with a link', async () => {
  const html = await render({ amenities: 'shower' });
  const text = visibleText(html);
  expect(text).toContain(`${SHOWER_YES} sites match`);
  expect(text).toContain(`${SHOWER_UNRECORDED} more where nobody recorded showers`);
  expect(hrefsIn(html)).toContain(`${BASE}/filter?amenities=shower&unknown=1`);
  expect(hrefsIn(html)).toContain(BASE); // clear filters
});

test('chips carry the API\'s counts and link to the toggled state', async () => {
  const html = await render({ types: 'paid' });
  const text = visibleText(html);
  // Counts under the current amenity filter (none): each type's own size.
  // Chips are inline links, so the reading runs them together: "Free 29Paid 30".
  // With paid on: Free adds (26 + 3), Paid removes itself (all 30).
  expect(text).toMatch(/Free 29(?!\d)/);
  expect(text).toMatch(/Paid 30(?!\d)/);
  expect(text).toMatch(/Wild camping 4(?!\d)/);
  // "Showers" with paid on: the paid rows that have one.
  expect(text).toMatch(new RegExp(`Showers ${PAID}(?!\\d)`));
  const hrefs = hrefsIn(html);
  // Toggling "Free" on adds it; toggling "Paid" off is the plain hub.
  expect(hrefs).toContain(`${BASE}/filter?types=free%2Cpaid`);
  expect(hrefs).toContain(BASE);
});

test('sort is a dropdown of plain links in the toolbar, the current one not a link', async () => {
  const html = await render({ types: 'free', sort: 'facilities' });
  const hrefs = hrefsIn(html);
  // CAMP-452: the options live in a `<details>` in the sticky toolbar —
  // opened without a script, like the FAQ — and the trigger names the
  // current order.
  const trigger = /<summary class="ct-sort__trigger"[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? '';
  expect(visibleText(trigger)).toBe('Sort by Most recorded facilities');
  const options = sortOptions(html);
  expect(hrefsIn(options)).toEqual([
    `${BASE}/filter?types=free`,
    `${BASE}/filter?types=free&sort=type`,
  ]);
  expect(visibleText(options)).toBe('Name Most recorded facilities Type');
  expect(options).toContain('aria-current="true" class="ct-sort__option">Most recorded facilities<');
  expect(asked).toContain(`/spots/${COUNTRY}/${REGION}?page=1&types=free&sort=facilities`);
  // Page 2 of a filtered set stays in the query string, never /page/2.
  expect(hrefs).toContain(`${BASE}/filter?types=free&sort=facilities&page=2`);
  expect(hrefs).not.toContain(`${BASE}/page/2`);
});

// ── every chip predicts its own click ─────────────────────────────────────

/** The chips of the filter bar: label, count and href, as rendered. */
function chips(html: string): { label: string; count: number; href: string }[] {
  const nav = /<nav aria-label="Filter campsites"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  return [...nav.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ href: decodeEntities(m[1]), text: visibleText(m[2]) }))
    .filter((c) => /\d+$/.test(c.text))
    .map((c) => ({
      href: c.href,
      label: c.text.replace(/\s*\d+$/, ''),
      count: Number(/(\d+)$/.exec(c.text)![1]),
    }));
}

test('🔴 the number on every chip is what its link answers', async () => {
  const states: Record<string, string>[] = [
    {},
    { types: 'paid' },
    { types: 'free' },
    { amenities: 'shower' },
    { types: 'wild', amenities: 'laundry' },
  ];
  for (const sp of states) {
    const html = await render(sp);
    const all = chips(html);
    expect(all.length, JSON.stringify(sp)).toBe(SPOT_TYPES.length + AMENITY_KEYS.length);
    for (const chip of all) {
      const target = new URL(chip.href, 'http://x');
      const after = await render(Object.fromEntries(target.searchParams));
      const said = visibleText(after);
      const got = target.pathname.endsWith('/filter')
        ? Number(/(\d+) sites? match/.exec(said)?.[1])
        : Number(/(\d+) sites? in Testland/.exec(said)?.[1]);
      expect({ from: sp, chip: chip.label, count: chip.count }).toEqual({
        from: sp,
        chip: chip.label,
        count: got,
      });
    }
  }
});

test('a filtered set says its pages beside its count, not in the region sentence', async () => {
  const html = await render({ types: 'free' });
  const text = visibleText(html);
  expect(text).toContain(`${FREE} sites match · page 1 of 2`);
  expect(text).toContain(`${ROWS.length} sites in Testland, Slovenia.`);
  expect(text).not.toContain(`${ROWS.length} sites in Testland, Slovenia — page`);
});

test('a filtered page past its set is a 404; page=1e20 reads as page 1', async () => {
  await expect(render({ types: 'paid', page: '3' })).rejects.toThrow(/404|NOT_FOUND/);
  expect(parseHubQuery({ page: '1e20' }).page).toBe(1);
  expect(parseHubQuery({ page: '99999999999999999999' }).page).toBe(1);
});

test('live: an API that cannot be reached is a 404, not a 500; at build time it throws', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
  try {
    await expect(
      renderAsyncComponent(RegionListing, { country: COUNTRY, region: REGION, page: 1, searchParams: { types: 'paid' }, live: true }),
    ).rejects.toThrow(/404|NOT_FOUND/);
    await expect(
      renderAsyncComponent(RegionListing, { country: COUNTRY, region: REGION, page: 1 }),
    ).rejects.toThrow(/fetch failed/);
  } finally {
    globalThis.fetch = real;
  }
});

// ── the crawl stays off the filter combinations ───────────────────────────

test('🔴 every link into /filter?… is rel="nofollow"; every other link is not', async () => {
  const cases: Record<string, string>[] = [
    {},
    { types: 'paid' },
    { types: 'wild', amenities: 'laundry' },
    { types: 'free', sort: 'facilities' },
    // Only a sort: "Name" leads to the static region — the one way back.
    { sort: 'facilities' },
  ];
  for (const sp of cases) {
    const html = await render(sp);
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    expect(anchors.length).toBeGreaterThan(20);
    for (const a of anchors) {
      const href = decodeEntities(/\bhref="([^"]+)"/.exec(a)?.[1] ?? '');
      const nofollow = /\brel="nofollow"/.test(a);
      expect(nofollow, `${JSON.stringify(sp)}: ${a}`).toBe(href.includes('/filter?'));
    }
    // And the chips really are the thing being checked: at least 14 of them lead into /filter.
    expect(anchors.filter((a) => /rel="nofollow"/.test(a)).length).toBeGreaterThanOrEqual(14);
  }
  // Sort-only: the "Name" sort link is the plain region, and followable.
  const sortOnly = await render({ sort: 'facilities' });
  const sortRow = sortOptions(sortOnly);
  expect(hrefsIn(sortRow)).toContain(BASE);
  expect(/<a\b[^>]*\bhref="[^"]*testland"[^>]*rel="nofollow"/.test(sortRow)).toBe(false);
});

// ── the crawl path is intact ──────────────────────────────────────────────

test('the first `main ul li a` is still a campsite, not a filter chip', async () => {
  const html = await render({});
  const main = html.slice(html.indexOf('<main'));
  const firstList = /<ul[\s\S]*?<li[\s\S]*?<a\b[^>]*\bhref="([^"]+)"/.exec(main);
  expect(firstList?.[1]).toMatch(new RegExp(`^${BASE}/[a-z0-9-]+$`));
});

// ── CAMP-452: the controls sit above what they control, and the map shows the same set ──
//
// 🔴 Every assertion below reads the served HTML: the `<style>` React
// hoisted, the order of the elements, the text of the map's legend —
// never a constant of the component.

test('🔴 one query, two consumers: the cards AND the map legend follow the same filter', async () => {
  // Nothing filtered: 24 cards of 30, and the map promises no highlight.
  const plain = await render({});
  expect(cardLinks(plain)).toHaveLength(24);
  expect(visibleText(plain)).toContain('Loading the map of Testland.');
  expect(visibleText(plain)).not.toContain('Highlighted when it arrives');

  // Paid: the three paid cards, and the map says it highlights paid campsites.
  const paid = await render({ types: 'paid' });
  expect(cardLinks(paid).sort()).toEqual([`${BASE}/paid-1`, `${BASE}/paid-2`, `${BASE}/paid-3`]);
  expect(visibleText(paid)).toContain(
    'Loading the map of Testland. Highlighted when it arrives: Paid.',
  );

  // Free with showers: ten free cards with a shower, and the legend names both.
  const both = await render({ types: 'free', amenities: 'shower' });
  const links = cardLinks(both);
  expect(links).toHaveLength(10);
  for (const href of links) expect(href).toMatch(new RegExp(`^${BASE}/free-shower-`));
  expect(visibleText(both)).toContain(
    'Loading the map of Testland. Highlighted when it arrives: Free, Showers.',
  );
  // 🔴 The legend is the island's own reading of its `filter` prop. A page
  // that handed the map a different query than the list — mutation:
  // `filter={mapFilter}` → the empty query in region-listing.tsx — prints
  // "Loading the map of Testland." here while the cards stay filtered.
});

test('🔴 the toolbar is sticky, in the served CSS, and stands between the map and the cards', async () => {
  const html = await render({ types: 'paid' });
  const css = servedCss(html);
  expect(css, 'the toolbar stylesheet is not in the served HTML').toContain('.ct-toolbar{');
  const rule = /\.ct-toolbar\{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(rule).toContain('position:sticky');
  // The theme's offset for a sticky block under the sticky header:
  // `top:calc(var(--header-height-sticky) + 24px)`; our header writes its
  // own height into `--ct-header-h` (site-header-frame.tsx), 63px without JS.
  expect(rule).toContain('top:calc(var(--ct-header-h,63px) + 24px)');

  // Order in the document: map legend → toolbar → filter panel → cards.
  const main = html.slice(html.indexOf('<main'));
  const at = (needle: string) => {
    const i = main.indexOf(needle);
    expect(i, `${needle} is not on the page`).toBeGreaterThan(-1);
    return i;
  };
  const legend = at('data-testid="region-map-legend"');
  const toolbar = at('data-testid="region-toolbar"');
  const panel = at('aria-label="Filter campsites"');
  const cards = at('<ul class="ct-cards');
  expect(legend).toBeLessThan(toolbar);
  expect(toolbar).toBeLessThan(panel);
  expect(panel).toBeLessThan(cards);
});

test('the text column holds prose and figures only — nothing that filters or sorts', async () => {
  const html = await render({});
  const main = html.slice(html.indexOf('<main'));
  const column = /<div class="ct-region__text">([\s\S]*?)<div class="ct-region__map">/.exec(main)?.[1];
  expect(column, 'the two-column block is missing on the base page').toBeDefined();
  expect(column).not.toContain('ct-check');
  expect(column).not.toContain('ct-sort');
  expect(column).not.toContain('<select');
  expect(column).not.toContain('type="checkbox"');
});

test('🔴 every chip is drawn as a checkbox BEFORE the click: a 24px box, and the tick hidden until chosen', async () => {
  const html = await render({ types: 'paid' });
  const nav = /<nav aria-label="Filter campsites"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  const anchors = [...nav.matchAll(/<a\b[^>]*class="ct-check"[^>]*>([\s\S]*?)<\/a>/g)];
  expect(anchors).toHaveLength(SPOT_TYPES.length + AMENITY_KEYS.length);
  for (const [, inner] of anchors) {
    // The box is the first thing in the chip, before the label.
    expect(inner.trimStart().startsWith('<span class="ct-check__box" aria-hidden="true"><svg')).toBe(true);
  }
  // Exactly one chip is on, and it is the paid one.
  const on = anchors.filter(([a]) => /aria-current="true"/.test(a));
  expect(on).toHaveLength(1);
  expect(visibleText(on[0][1])).toMatch(/^Paid \d+$/);

  // The served rules: the box has a size and a border in the OFF state,
  // and the tick's opacity goes 0 → 1 only with `aria-current="true"`.
  const css = servedCss(html);
  const box = /\.ct-check__box\{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(box).toContain('width:24px');
  expect(box).toContain('height:24px');
  expect(box).toContain('border:1px solid');
  expect(box).not.toMatch(/display:none|opacity:0|visibility:hidden/);
  expect(/\.ct-check__box svg\{[^}]*opacity:0[;}]/.test(css)).toBe(true);
  expect(/\.ct-check\[aria-current="true"\] \.ct-check__box svg\{[^}]*opacity:1[;}]/.test(css)).toBe(true);
  expect(
    /\.ct-check\[aria-current="true"\] \.ct-check__box\{[^}]*background-color:var\(--color-line-blue\)/.test(css),
  ).toBe(true);
});

test('active filters are pills in the toolbar, each a link to the state without it', async () => {
  const html = await render({ types: 'paid', amenities: 'shower' });
  const bar = /<nav aria-label="Sort and current filters"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  const pills = [...bar.matchAll(/<a\b[^>]*class="ct-pill[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: decodeEntities(/\bhref="([^"]+)"/.exec(m[0])?.[1] ?? ''),
    rel: /\brel="([^"]+)"/.exec(m[0])?.[1],
    text: visibleText(m[1]),
  }));
  expect(pills).toEqual([
    { href: `${BASE}/filter?amenities=shower`, rel: 'nofollow', text: 'Paid' },
    { href: `${BASE}/filter?types=paid`, rel: 'nofollow', text: 'Showers' },
  ]);
  expect(visibleText(bar)).toContain('Filters (2)');
  // And the plain hub has no pills and no count.
  const plain = /<nav aria-label="Sort and current filters"[\s\S]*?<\/nav>/.exec(await render({}))?.[0] ?? '';
  expect(plain).not.toContain('ct-pill');
  expect(visibleText(plain)).toContain('Every site in the region');
});

// ── screen 3: the empty state ─────────────────────────────────────────────

test('🔴 a combination with no match renders the reason and three actions — not a 404, not a blank list', async () => {
  // wild + laundry: nobody has a laundry; the one wild row has it unrecorded.
  const html = await render({ types: 'wild', amenities: 'laundry' });
  const text = visibleText(html);

  expect(text).toContain('0 sites match');
  expect(text).toContain('Nothing matches all 2 filters');
  expect(text).toContain('No wild camping spot in Testland is recorded with laundry');
  expect(text).toContain('1 site has no record of laundry');
  // Which filter to drop: removing "Laundry" leaves the wild row (1);
  // removing "Wild camping" leaves nobody with a laundry (0).
  expect(text).toContain('Drop “Laundry” and 1 site comes back');

  expect(cardLinks(html)).toEqual([]);

  const actions = /<div[^>]*data-hub-empty-actions[^>]*>([\s\S]*?)<\/div>/.exec(html);
  expect(actions).not.toBeNull();
  const links = [...(actions?.[1] ?? '').matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => [decodeEntities(m[1]), visibleText(m[2])] as const,
  );
  expect(links).toEqual([
    [`${BASE}/filter?types=wild`, 'Remove “Laundry”'],
    [BASE, 'Clear all filters'],
    [`/camping/${COUNTRY}`, 'Other regions in Slovenia'],
  ]);
});

test('an empty SECOND page of a filtered set is still a 404', async () => {
  await expect(render({ types: 'paid', page: '2' })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
});

// ── one address per state ─────────────────────────────────────────────────

test('/filter with nothing to filter redirects to the static address', async () => {
  const props = {
    params: Promise.resolve({ country: COUNTRY, region: REGION }),
    searchParams: Promise.resolve({ bogus: '1' }),
  };
  await expect(FilteredRegionPage(props)).rejects.toMatchObject({
    digest: expect.stringMatching(new RegExp(`NEXT_REDIRECT;replace;${BASE};308`)),
  });
  const page3 = { ...props, searchParams: Promise.resolve({ page: '3' }) };
  await expect(FilteredRegionPage(page3)).rejects.toMatchObject({
    digest: expect.stringContaining(`${BASE}/page/3;308`),
  });
});

test('a state under another spelling redirects to its one address', async () => {
  const canonical = `${BASE}/filter?types=paid&amenities=shower`;
  for (const sp of [
    { types: 'paid', amenities: 'shower', page: '1' },
    { types: 'paid', amenities: 'shower', sort: 'name' },
    { amenities: 'shower', types: 'paid' },
    { types: 'paid,bogus', amenities: 'shower' },
  ]) {
    const props = {
      params: Promise.resolve({ country: COUNTRY, region: REGION }),
      searchParams: Promise.resolve(sp),
    };
    await expect(FilteredRegionPage(props), JSON.stringify(sp)).rejects.toMatchObject({
      digest: expect.stringContaining(`${canonical};308`),
    });
  }
  // And the canonical spelling itself renders rather than redirecting.
  await withStub(async () => {
    const out = await FilteredRegionPage({
      params: Promise.resolve({ country: COUNTRY, region: REGION }),
      searchParams: Promise.resolve({ types: 'paid', amenities: 'shower' }),
    });
    expect(out).toBeTruthy();
  });
});

test('{wild, free} and {free, wild} are one URL', () => {
  const a = parseHubQuery({ types: 'wild,free', amenities: 'water,shower' });
  const b = parseHubQuery({ types: 'free,wild', amenities: 'shower,water' });
  expect(hubHref(BASE, a)).toBe(hubHref(BASE, b));
  expect(hubHref(BASE, a)).toBe(`${BASE}/filter?types=free%2Cwild&amenities=water%2Cshower`);
});
