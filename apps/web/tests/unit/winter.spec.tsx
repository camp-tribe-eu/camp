import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import WinterPage from '@/app/camping/winter/page';
import { hubHref, parseHubQuery } from '@/lib/hub-filters';
import { winterSitemapEntry, winterText, winterView, readWinter } from '@/lib/winter';
import { renderAsyncComponent } from './render-component';
import { decodeEntities, visibleText } from './rendered-text';

// CAMP-525 — /camping/winter as the HTML a reader is served.
//
// 🔴 THE EVIDENCE IS NOT MADE OF THE THING MEASURED. The API and the CMS
// below are stubs written in THIS file; the payload's numbers are hand
// counts, and the CMS sentences are deliberately NOT the ones the migration
// seeds, so a sentence that reaches the HTML came through the CMS path and
// not from a constant in the code. The migration's own words are read from
// its source at the bottom and rendered through the same path.
//
// 🔴 Every assertion reads `visibleText` of the rendered page or an `href`
// in it — never a constant, a class, a data attribute or an `sr-only`.

type Sec = { slot: string; heading: string | null; body: string | null };

const CMS: Sec[] = [
  { slot: 'intro', heading: 'Intro', body: 'Cold months, open gates.' },
  { slot: 'countries', heading: 'Where the gates stay open', body: '{{yes}} places in {{countries}} countries say they open in winter; the season is written down for {{known}} of {{total}}.' },
  { slot: 'country-card', heading: 'x', body: '{{yes}} winter-open (known {{known}}/{{total}})' },
  { slot: 'region-link', heading: 'x', body: '{{region}} · {{yes}}/{{spots}}' },
  { slot: 'none', heading: 'x', body: 'Without a record, {{count}} of {{countries}}: {{names}}.' },
  { slot: 'empty', heading: 'x', body: 'Nobody has recorded a winter opening yet.' },
  { slot: 'pain', heading: 'Short of supplies', body: 'What runs out first.' },
  { slot: 'water', heading: 'Taps', body: 'Taps freeze.' },
  { slot: 'dump', heading: 'Waste', body: 'Dump points lock.' },
  { slot: 'gas', heading: 'LPG', body: 'Bottles empty.' },
  { slot: 'figure', heading: 'x', body: '{{count}} out of {{total}} winter-open sites, {{km}} km' },
  { slot: 'method', heading: 'x', body: 'Straight line, {{km}} km.' },
  { slot: 'as-of', heading: 'x', body: 'As of {{readAt}}.' },
];

const region = (name: string, slug: string, spots: number, known: number, yes: number) => ({
  region: name, slug, spots, known, yes,
});
const country = (
  code: string, spots: number, known: number, yes: number,
  regions: unknown[], within: [number, number, number],
) => ({
  country: code, spots, known, yes, regions,
  withinRadius: { water: within[0], dump: within[1], gas: within[2] },
});

/**
 * Hand counts. Open: AT 7 of 40 (known 10), SI 3 of 26 (known 4).
 * No winter yes: HR (3 sites, none known), DE (100 sites, 5 known — all «no»).
 * All countries: yes 10, known 19, total 169.
 */
const API = {
  radiusM: 10_000,
  readAt: '2026-11-10',
  countries: [
    country('at', 40, 10, 7, [region('Tirol', 'tirol', 9, 4, 3)], [5, 2, 0]),
    country('de', 100, 5, 0, [], [0, 0, 0]),
    country('hr', 3, 0, 0, [], [0, 0, 0]),
    country('si', 26, 4, 3, [region('Winterland', 'winterland', 5, 3, 2), region('Thinland', 'thinland', 21, 1, 1)], [1, 2, 1]),
  ],
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

interface World {
  cms?: Sec[] | null;
  noindex?: boolean;
  api?: unknown;
  apiStatus?: number;
  hubs?: string[];
}

function stub(raw: string, w: World): Response {
  const url = new URL(raw);
  if (url.pathname === '/pages/winter') {
    if (w.cms === null) return new Response('nf', { status: 404 });
    return json({
      slug: 'winter', title: 'Winter title', metaTitle: null,
      metaDescription: 'Winter description.', noindex: w.noindex ?? false,
      sections: (w.cms ?? CMS).map((s) => ({
        type: 'prose', variant: null, subheading: null, imageUrl: null, imageAlt: null,
        ctaHref: null, ctaLabel: null, items: [], ...s,
      })),
    });
  }
  if (url.pathname === '/spots/winter') {
    return w.apiStatus && w.apiStatus !== 200
      ? new Response('x', { status: w.apiStatus })
      : json(w.api ?? API);
  }
  if (url.pathname === '/spots/countries') {
    return json((w.hubs ?? ['si']).map((c) => ({ country: c, spots: 10, regions: 2 })));
  }
  return new Response('not found', { status: 404 });
}

async function withWorld<T>(w: World, f: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((u: string) => Promise.resolve().then(() => stub(String(u), w))) as typeof fetch;
  try {
    return await f();
  } finally {
    globalThis.fetch = real;
  }
}

const render = (w: World = {}) =>
  withWorld(w, () => renderAsyncComponent(WinterPage, undefined as never));

const links = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: decodeEntities(m[1]),
    rel: /\brel="([^"]+)"/.exec(m[0])?.[1],
    text: visibleText(m[2]),
  }));

// ── what is counted, as the reader reads it ───────────────────────────────

test('🔴 the page says what the API counted, in the CMS\'s sentences — lead, country cards, unrecorded countries', async () => {
  const html = await render();
  const text = visibleText(html);

  expect(text).toContain('Cold months, open gates.');
  expect(text).toContain('Where the gates stay open');
  expect(text).toContain(
    '10 places in 2 countries say they open in winter; the season is written down for 19 of 169.',
  );
  // Largest first: Austria 7, then Slovenia 3.
  expect(text.indexOf('Austria')).toBeLessThan(text.indexOf('Slovenia'));
  expect(text).toContain('7 winter-open (known 10/40)');
  expect(text).toContain('3 winter-open (known 4/26)');
  // The two countries with no winter yes are NOT cards; they are named once, with the denominator.
  expect(text).toContain('Without a record, 2 of 4: Croatia, Germany.');
  expect(text).not.toContain('0 winter-open');
  expect(text).not.toContain('{{');
});

test('🔴 each service figure is a count AND its denominator, per country, from the API', async () => {
  const text = visibleText(await render());
  expect(text).toContain('Taps');
  expect(text).toContain('Waste');
  expect(text).toContain('LPG');
  // AT: water 5, dump 2, gas 0 — of its 7. SI: 1, 2, 1 — of its 3.
  expect(text).toContain('5 out of 7 winter-open sites, 10 km');
  expect(text).toContain('2 out of 7 winter-open sites, 10 km');
  expect(text).toContain('0 out of 7 winter-open sites, 10 km');
  expect(text).toContain('1 out of 3 winter-open sites, 10 km');
  expect(text).toContain('2 out of 3 winter-open sites, 10 km');
  expect(text).toContain('Straight line, 10 km. As of 2026-11-10.');
});

test('🔴 links go to the filtered region hubs at their one canonical address, nofollow; the country hub only where it exists', async () => {
  const html = await render({ hubs: ['si'] });
  const l = links(html);
  expect(l.filter((x) => x.href.includes('/filter'))).toEqual([
    { href: '/camping/at/tirol/filter?styles=winter', rel: 'nofollow', text: 'Tirol · 3/9' },
    { href: '/camping/si/winterland/filter?styles=winter', rel: 'nofollow', text: 'Winterland · 2/5' },
    { href: '/camping/si/thinland/filter?styles=winter', rel: 'nofollow', text: 'Thinland · 1/21' },
  ]);
  // Slovenia has a hub and is a link; Austria has none in this world and is plain text.
  expect(l.find((x) => x.text === 'Slovenia')?.href).toBe('/camping/si');
  expect(l.find((x) => x.text === 'Austria')).toBeUndefined();
  expect(visibleText(html)).toContain('Austria');
});

test('the filtered address is the one the hub itself would redirect to (no second spelling)', () => {
  const q = parseHubQuery({ styles: 'winter' });
  expect(q.styles).toEqual(['winter']);
  expect(hubHref('/camping/si/winterland', q)).toBe('/camping/si/winterland/filter?styles=winter');
});

// ── 🔴 only the confirmed ─────────────────────────────────────────────────

test('🔴 an unconfirmed campsite, a zero-yes region and a zero-yes country never reach the page, even smuggled in the payload', async () => {
  const smuggled = {
    ...API,
    countries: API.countries.map((c) =>
      c.country === 'si'
        ? {
            ...c,
            // A closed campsite by name, and a region that has only «no» records.
            campsites: [{ name: 'Closed Camp Smuggled', winter: 'no' }],
            regions: [
              ...c.regions,
              region('Closedland', 'closedland', 8, 8, 0),
            ],
          }
        : c,
    ),
  };
  const html = await render({ api: smuggled });
  const text = visibleText(html);
  expect(text).not.toContain('Closed Camp Smuggled');
  expect(text).not.toContain('Closedland');
  expect(html).not.toContain('closedland');
  // The zero-yes countries are not cards and carry no figure line.
  expect(links(html).some((x) => x.text === 'Germany' || x.text === 'Croatia')).toBe(false);
  expect(text).not.toContain('0 out of 0');
  expect(text).not.toContain('0 winter-open');
});

// ── nothing empty is drawn ────────────────────────────────────────────────

test('🔴 no winter record anywhere: one sentence, no table, no headings over nothing', async () => {
  const none = { ...API, countries: API.countries.filter((c) => c.yes === 0) };
  const text = visibleText(await render({ api: none }));
  expect(text).toContain('Nobody has recorded a winter opening yet.');
  expect(text).not.toContain('Where the gates stay open');
  expect(text).not.toContain('Short of supplies');
  expect(text).not.toContain('Taps');
  expect(text).not.toContain('Without a record');
  expect(text).not.toContain('{{');
});

test('🔴 an API without the route reads as «nothing recorded», not as a table of zeros', async () => {
  const text = visibleText(await render({ apiStatus: 404 }));
  expect(text).toContain('Nobody has recorded a winter opening yet.');
  expect(text).not.toContain('0 winter-open');
  expect(text).not.toContain('Short of supplies');
});

test('no CMS page is a 404, and so is a page missing one of its slots', async () => {
  await expect(render({ cms: null })).rejects.toThrow();
  await expect(render({ cms: CMS.filter((s) => s.slot !== 'figure') })).rejects.toThrow();
  await expect(render({ cms: CMS.map((s) => (s.slot === 'method' ? { ...s, body: '  ' } : s)) })).rejects.toThrow();
});

test('🔴 a CMS template naming a number the page does not supply fails the render, never prints «{{…}}»', async () => {
  const typo = CMS.map((s) => (s.slot === 'country-card' ? { ...s, body: '{{yes}} of {{everything}}' } : s));
  await expect(render({ cms: typo })).rejects.toThrow(/everything/);
});

test('one bad country row costs one row', async () => {
  const bad = {
    ...API,
    countries: [
      ...API.countries,
      { ...country('ee', 10, 99, 5, [], [0, 0, 0]) }, // known above spots
      { ...country('lt', 10, 5, 3, [], [4, 0, 0]) }, // 4 taps among 3 campsites
      { ...country('xx1', 10, 5, 3, [], [0, 0, 0]) },
      null,
    ],
  };
  const text = visibleText(await render({ api: bad }));
  expect(text).toContain('7 winter-open (known 10/40)');
  expect(text).not.toContain('Estonia');
  expect(text).not.toContain('Lithuania');
});

// ── the sitemap ───────────────────────────────────────────────────────────

test('sitemap: an entry with the import day as lastmod — and none for noindex, an empty payload or a page without slots', async () => {
  expect(await withWorld({}, winterSitemapEntry)).toEqual({ path: '/camping/winter', lastmod: '2026-11-10' });
  expect(await withWorld({ noindex: true }, winterSitemapEntry)).toBeNull();
  expect(
    await withWorld({ api: { ...API, countries: API.countries.filter((c) => c.yes === 0) } }, winterSitemapEntry),
  ).toBeNull();
  expect(await withWorld({ apiStatus: 500 }, winterSitemapEntry)).toBeNull();
  expect(await withWorld({ cms: CMS.slice(1) }, winterSitemapEntry)).toBeNull();
  expect(await withWorld({ cms: null }, winterSitemapEntry)).toBeNull();
});

// ── the words the migration seeds, through the same path ──────────────────

test('🔴 the migration\'s own words satisfy the page: every slot present, every {{key}} supplied', async () => {
  const src = readFileSync(
    join(__dirname, '../../../api/src/migrations/1797900000000-WinterPageText.ts'),
    'utf8',
  );
  const sections: Sec[] = [
    ...src.matchAll(/slot: '([^']+)',\s*heading: '([^']*)',\s*body: (?:'((?:[^'\\]|\\.)*)'|null)/g),
  ].map((m) => ({ slot: m[1], heading: m[2], body: m[3] ?? null }));
  expect(sections.map((s) => s.slot).sort()).toEqual(CMS.map((s) => s.slot).sort());
  expect(winterText(sections.map((s) => ({ ...s, type: 'prose', variant: null, subheading: null, imageUrl: null, imageAlt: null, ctaHref: null, ctaLabel: null, items: [] })))).not.toBeNull();

  const text = visibleText(await render({ cms: sections }));
  expect(text).toContain('10 campsites in 2 countries are recorded as open in winter.');
  expect(text).toContain('Winter opening is recorded for 19 of 169 campsites');
  expect(text).toContain('7 open in winter, recorded for 10 of 40 campsites');
  expect(text).toContain('Tirol: 3 of 9');
  expect(text).toContain('2 of 4 countries have no campsite recorded as open in winter');
  expect(text).toContain('5 of 7 winter-open campsites have one within 10 km');
  expect(text).toContain('Counted from our listings as of 2026-11-10.');
  expect(text).not.toContain('{{');
});

test('readWinter refuses what is not a payload', () => {
  expect(readWinter(null)).toBeNull();
  expect(readWinter({ radiusM: 0, countries: [] })).toBeNull();
  expect(readWinter({ radiusM: 10000, countries: 'x' })).toBeNull();
  expect(readWinter(API)?.countries.map((c) => c.country)).toEqual(['at', 'de', 'hr', 'si']);
  expect(winterView(null, winterText(CMS.map((s) => ({ ...s, type: 'prose', variant: null, subheading: null, imageUrl: null, imageAlt: null, ctaHref: null, ctaLabel: null, items: [] })))!, new Set()).rows).toEqual([]);
});
