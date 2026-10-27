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

/** The stub API's own filter. Its own `if`s, on purpose. */
function stubFilter(url: URL) {
  const split = (v: string | null) => (v ? v.split(',') : []);
  const types = split(url.searchParams.get('types'));
  const amenities = split(url.searchParams.get('amenities'));
  const unknown = url.searchParams.get('unknown') === '1';
  const page = Number(url.searchParams.get('page') ?? '1');

  const typeOk = (r: Row, ts: string[]) => ts.length === 0 || ts.includes(r.type);
  const strict = (r: Row, as: string[]) =>
    as.every((k) => (r.amenities as Record<string, string>)[k] === 'yes');
  const lenient = (r: Row, as: string[]) =>
    as.every((k) => (r.amenities as Record<string, string>)[k] !== 'no');
  const pass = (r: Row, ts = types, as = amenities) =>
    typeOk(r, ts) && (unknown ? lenient(r, as) : strict(r, as));

  const matched = ROWS.filter((r) => pass(r));
  const lenientCount = ROWS.filter((r) => typeOk(r, types) && lenient(r, amenities)).length;

  const facets = {
    types: Object.fromEntries(
      SPOT_TYPES.map((t) => [t, ROWS.filter((r) => pass(r, [t])).length]),
    ),
    amenities: Object.fromEntries(
      AMENITY_KEYS.map((k) => [
        k,
        ROWS.filter((r) => pass(r, types, amenities.includes(k) ? amenities : [...amenities, k])).length,
      ]),
    ),
  };
  const dropOne = [
    ...types.map((t) => ({
      kind: 'type',
      key: t,
      matched: ROWS.filter((r) => pass(r, types.filter((x) => x !== t))).length,
    })),
    ...amenities.map((k) => ({
      kind: 'amenity',
      key: k,
      matched: ROWS.filter((r) => pass(r, types, amenities.filter((x) => x !== k))).length,
    })),
  ];
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
    facets,
    dropOne,
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

/** The campsite links in the card list — the `<ul>` after the filters. */
function cardLinks(html: string): string[] {
  const main = html.slice(html.indexOf('<main'));
  const list = /<ul class="mt-6 grid[^"]*">([\s\S]*?)<\/ul>\s*(?:<nav|<section)/.exec(main);
  return list ? hrefsIn(list[1]) : [];
}

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
  // Chips are inline links, so the reading runs them together: "Free 26Paid 3".
  expect(text).toMatch(new RegExp(`Free ${FREE}(?!\\d)`));
  expect(text).toMatch(new RegExp(`Paid ${PAID}(?!\\d)`));
  expect(text).toMatch(/Wild camping 1(?!\d)/);
  // "Showers" with paid on: the paid rows that have one.
  expect(text).toMatch(new RegExp(`Showers ${PAID}(?!\\d)`));
  const hrefs = hrefsIn(html);
  // Toggling "Free" on adds it; toggling "Paid" off is the plain hub.
  expect(hrefs).toContain(`${BASE}/filter?types=free%2Cpaid`);
  expect(hrefs).toContain(BASE);
});

test('sort is three plain links, the current one not a link', async () => {
  const html = await render({ types: 'free', sort: 'facilities' });
  const hrefs = hrefsIn(html);
  const sortRow = /<p>Sort:[\s\S]*?<\/p>/.exec(html)?.[0] ?? '';
  expect(hrefsIn(sortRow)).toEqual([
    `${BASE}/filter?types=free`,
    `${BASE}/filter?types=free&sort=type`,
  ]);
  expect(visibleText(sortRow)).toBe('Sort: Name · Most recorded facilities · Type');
  expect(asked).toContain(`/spots/${COUNTRY}/${REGION}?page=1&types=free&sort=facilities`);
  // Page 2 of a filtered set stays in the query string, never /page/2.
  expect(hrefs).toContain(`${BASE}/filter?types=free&sort=facilities&page=2`);
  expect(hrefs).not.toContain(`${BASE}/page/2`);
});

// ── the crawl path is intact ──────────────────────────────────────────────

test('the first `main ul li a` is still a campsite, not a filter chip', async () => {
  const html = await render({});
  const main = html.slice(html.indexOf('<main'));
  const firstList = /<ul[\s\S]*?<li[\s\S]*?<a\b[^>]*\bhref="([^"]+)"/.exec(main);
  expect(firstList?.[1]).toMatch(new RegExp(`^${BASE}/[a-z0-9-]+$`));
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

test('{wild, free} and {free, wild} are one URL', () => {
  const a = parseHubQuery({ types: 'wild,free', amenities: 'water,shower' });
  const b = parseHubQuery({ types: 'free,wild', amenities: 'shower,water' });
  expect(hubHref(BASE, a)).toBe(hubHref(BASE, b));
  expect(hubHref(BASE, a)).toBe(`${BASE}/filter?types=free%2Cwild&amenities=water%2Cshower`);
});
