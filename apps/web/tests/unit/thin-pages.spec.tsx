import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import RoutePage from '@/app/routes/[slug]/page';
import RoutesIndex from '@/app/routes/page';
import SearchPage from '@/app/search/page';
import ToolsIndex from '@/app/tools/page';
import PackingListBuilder from '@/components/packing-list-builder';
import RouteMapEmbed from '@/components/route-map-embed';
import TripCostCalculator from '@/components/trip-cost-calculator';
import { memberState, memberStateCount } from '@/lib/campsite-count';
import { CURATED_ROUTES } from '../../src/data/routes';
import { CAMPSITES_PER_STAGE, STAGE_RADIUS_M } from '../../src/lib/routes';
import { SERVICE_KINDS, SERVICE_LABEL, SERVICE_RADIUS_M } from '../../src/lib/route-services';
import { renderAsyncComponent, renderComponent } from './render-component';
import { everythingSaid, visibleText } from './rendered-text';

// CAMP-240 — /routes, /tools and /search were "thin". What they now carry
// is checked here, and every check reads the HTML a reader is served.
//
// 🔴 NOT A CONSTANT, NOT A CLASS, NOT AN `sr-only` CAPTION. A breadcrumb
// "exists" when a visible `<nav>` holds links to the pages above this one;
// a distance "has its label" when the card a reader sees says so in
// words; a count of countries is right when the sentence says it. The
// two helpers that read a page are `visibleText` (what a sighted reader
// is shown, hidden elements removed first) and `everythingSaid` (every
// tag a space, which is how block-level spans read).
//
// 🔴 THE EVIDENCE IS NOT MADE OF THE THING MEASURED. Three places where
// that was a risk, and what stands in for the shared field:
//   · the card's distance is compared with a haversine written in THIS
//     file, not with `straightLineLabel`, which produced it;
//   · the member-state count is compared with the EU-27 file the API
//     workspace owns (`eu-member-states.json`), not with the table the
//     function reads;
//   · the catalogue's account of what stands behind a stop is compared
//     with the route page's own sentence about the same thing, rendered
//     separately.

// ── reading a rendered page ──────────────────────────────────────────────

const ABS = (path: string) => `https://camptribe.eu${path}`;

/** Every JSON-LD block in a page, parsed. An unparseable one is a failure. */
function jsonLd(html: string): Record<string, unknown>[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
}

interface Crumb {
  name: string;
  path: string;
}

/** The breadcrumb a crawler is told about. */
function markedUpCrumbs(html: string): Crumb[] {
  const list = jsonLd(html).find((b) => b['@type'] === 'BreadcrumbList');
  if (!list) return [];
  const items = list.itemListElement as {
    position: number;
    name: string;
    item: string;
  }[];
  // Positions from 1 and without gaps, or Google drops the whole list.
  items.forEach((it, i) => expect(it.position).toBe(i + 1));
  return items.map((it) => ({ name: it.name, path: new URL(it.item).pathname }));
}

/**
 * The breadcrumb a reader is shown: every link in the `<nav
 * aria-label="Breadcrumb">`, then the page itself as the last, unlinked,
 * item. `null` when there is no such nav.
 */
function shownCrumbs(html: string): { text: string; links: Crumb[] } | null {
  const nav = /<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/.exec(html);
  if (!nav) return null;
  const links = [
    ...nav[0].matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g),
  ].map((m) => ({ name: visibleText(m[2]), path: m[1] }));
  // `visibleText` of the nav alone: a nav hidden with `hidden` or `sr-only`
  // reads as '' here, which is what a sighted reader gets.
  const text = visibleText(nav[0]).replace(/\s*\/\s*/g, ' / ');
  return { text, links };
}

const render = {
  routes: () => renderComponent(RoutesIndex, {}),
  tools: () => renderComponent(ToolsIndex, {}),
};

/** The countries as the API emitted them, captured 15.10.2026. */
const API_COUNTRIES: { country: string; spots: number; regions: number }[] =
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'api-spots-countries.json'), 'utf8'),
  );

/** `fetch` swapped for one test, always put back. */
async function withFetch(
  impl: (url: string) => Response,
  run: () => Promise<void>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

async function renderSearch(): Promise<string> {
  let html = '';
  await withFetch(
    (url) => {
      // Raw, as the API answers: the page does its own counting.
      if (url.endsWith('/spots/summary')) {
        return json({ spots: 52_501, countries: API_COUNTRIES.length, regions: 806 });
      }
      if (url.endsWith('/spots/countries')) return json(API_COUNTRIES);
      throw new Error(`unexpected request in a unit test: ${url}`);
    },
    async () => {
      html = await renderAsyncComponent(SearchPage, {});
    },
  );
  return html;
}

// 🔴 The readers are tested before anything is read with them: were
// `jsonLd` to return [] or `shownCrumbs` to return null for every page,
// each assertion below that says "there is no X" would pass over a page
// that has one.
test.describe('the readers are not blind', () => {
  test('jsonLd finds the blocks on a page that has them', () => {
    const blocks = jsonLd(render.routes());
    expect(blocks.map((b) => b['@type']).sort()).toEqual(
      ['BreadcrumbList', 'CollectionPage'].sort(),
    );
  });

  test('shownCrumbs finds a nav, and reads nothing from one that is hidden', () => {
    const nav = '<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li>/</li><li aria-current="page">Here</li></ol></nav>';
    expect(shownCrumbs(nav)?.text).toBe('Home / Here');
    expect(shownCrumbs(nav.replace('<nav ', '<nav class="sr-only" '))?.text).toBe('');
    expect(shownCrumbs('<main>no nav here</main>')).toBeNull();
  });
});

// ── 1. THE BREADCRUMB: WHAT A READER SEES IS WHAT A CRAWLER IS TOLD ──────

const PAGES: { name: string; path: string; html: () => Promise<string> | string; last: string }[] = [
  { name: '/routes', path: '/routes', html: render.routes, last: 'Routes' },
  { name: '/tools', path: '/tools', html: render.tools, last: 'Tools' },
  { name: '/search', path: '/search', html: renderSearch, last: 'Search' },
];

for (const page of PAGES) {
  test.describe(`${page.name}: the breadcrumb`, () => {
    test('🔴 a visible trail, home to this page, and the same trail in the JSON-LD', async () => {
      const html = await page.html();
      const marked = markedUpCrumbs(html);
      const shown = shownCrumbs(html);

      expect(marked.length, 'no BreadcrumbList in the JSON-LD').toBeGreaterThanOrEqual(2);
      expect(shown, 'markup with no visible trail').not.toBeNull();

      // The trail a reader reads is the trail a crawler is told.
      expect(shown!.text).toBe(marked.map((c) => c.name).join(' / '));
      // Home first, this page last.
      expect(marked[0]).toEqual({ name: 'CampTribe', path: '/' });
      expect(marked[marked.length - 1]).toEqual({ name: page.last, path: page.path });
      // Every crumb but the last is a link, to the page the markup names;
      // the last is the page itself and is not a link to itself.
      expect(shown!.links).toEqual(marked.slice(0, -1));
      expect(html).toContain('aria-current="page"');
    });

    test('🔴 the page’s own JSON-LD names the page’s own URL', async () => {
      // The `<link rel="canonical">` comes from Next's metadata and is
      // not in what a component renders; it is read off the served HTML
      // in tests/e2e/thin-pages.spec.ts. This is the half that is here.
      const html = await page.html();
      const named = jsonLd(html)
        .filter((b) => b['@type'] !== 'BreadcrumbList')
        .map((b) => b['url']);
      expect(named).toContain(ABS(page.path));
    });
  });
}

// ── 2. /tools: WHAT SHOULD BE ON IT, COUNTED ─────────────────────────────

test.describe('/tools', () => {
  const html = render.tools();
  const text = visibleText(html);

  test('🔴 it links the two tools it describes, and says what each one needs, gives and cannot know', () => {
    for (const href of ['/tools/camper-trip-cost', '/tools/camper-packing-list']) {
      expect(html, `no link to ${href}`).toContain(`href="${href}"`);
    }
    expect(
      (text.match(/You give it/g) ?? []).length,
      'every tool says what it needs',
    ).toBe(2);
    expect((text.match(/You get/g) ?? []).length).toBe(2);
    expect((text.match(/What it does not know/g) ?? []).length).toBe(2);
  });

  test('🔴 the JSON-LD collection lists the same two tools a reader is shown', () => {
    const collection = jsonLd(html).find((b) => b['@type'] === 'CollectionPage') as {
      mainEntity: { numberOfItems: number; itemListElement: { url: string }[] };
    };
    expect(collection.mainEntity.numberOfItems).toBe(2);
    expect(collection.mainEntity.itemListElement.map((i) => i.url)).toEqual([
      ABS('/tools/camper-trip-cost'),
      ABS('/tools/camper-packing-list'),
    ]);
  });

  test('🔴 it links one fuel page for each of the EU-27 member states — no more, no fewer', () => {
    const members = Object.keys(
      (
        JSON.parse(
          readFileSync(
            join(process.cwd(), '..', 'api', 'src', 'osm', 'eu-member-states.json'),
            'utf8',
          ),
        ) as { members: Record<string, string> }
      ).members,
    ).sort();
    // A file that was not read would make the comparison below vacuous.
    expect(members.length).toBe(27);

    const linked = [
      ...html.matchAll(/href="\/tools\/camper-trip-cost\/([a-z]{2})"/g),
    ]
      .map((m) => m[1])
      .sort();
    expect(linked).toEqual(members);
  });

  // 🔴 What the index says you give each tool is checked against what
  // the tool's own form asks for. The index is prose; each row below is
  // one thing it names, the words that stand for it in the index, and the
  // label of the field on the tool's page. If a field is removed from the
  // tool, or a promise removed from the index, a row goes red; one that
  // names a field the tool does not have is the index promising an input
  // that is not there.
  test('🔴 every input the index names is a labelled field on the tool itself', () => {
    // 🔴 Wrapped in a function that returns the element. `renderComponent`
    // CALLS the function it is given, outside React, and both forms use
    // hooks; as a child element they are rendered by React itself.
    const cost = visibleText(renderComponent(() => <TripCostCalculator />, {}));
    const pack = visibleText(renderComponent(() => <PackingListBuilder />, {}));
    // A form that rendered nothing would let every row below pass on '' —
    // no: each row fails on '' — but say it, so the cause reads at once.
    expect(cost.length, 'the calculator rendered nothing').toBeGreaterThan(200);
    expect(pack.length, 'the packing list rendered nothing').toBeGreaterThan(200);

    // The card for each tool, and what it says you give it.
    const gives = (href: string): string => {
      const segment = html
        .split('<li')
        .find((s) => s.includes(`href="${href}"`) && s.includes('You give it'));
      expect(segment, `no card for ${href}`).toBeDefined();
      const said = visibleText(segment!);
      const m = /You give it (.*?) You get/.exec(said);
      expect(m, `${href}: no "You give it" line`).not.toBeNull();
      return m![1].toLowerCase();
    };
    const costGives = gives('/tools/camper-trip-cost');
    const packGives = gives('/tools/camper-packing-list');

    const rows: { tool: string; form: string; field: RegExp; said: string; gives: string }[] = [
      { tool: 'trip cost', form: cost, field: /Country you are driving in/, said: 'country', gives: costGives },
      { tool: 'trip cost', form: cost, field: /\bFuel\b[\s\S]*Diesel[\s\S]*Petrol/, said: 'diesel or petrol', gives: costGives },
      { tool: 'trip cost', form: cost, field: /\bVehicle\b/, said: 'vehicle', gives: costGives },
      { tool: 'trip cost', form: cost, field: /Distance, km/, said: 'distance', gives: costGives },
      { tool: 'trip cost', form: cost, field: /\bNights\b/, said: 'nights', gives: costGives },
      { tool: 'trip cost', form: cost, field: /\bPeople\b/, said: 'people', gives: costGives },
      { tool: 'trip cost', form: cost, field: /Pitch per night/, said: 'pitch', gives: costGives },
      { tool: 'packing list', form: pack, field: /Travelling in[\s\S]*Campervan[\s\S]*Motorhome[\s\S]*Car and tent/, said: 'vehicle', gives: packGives },
      { tool: 'packing list', form: pack, field: /Time of year[\s\S]*Summer[\s\S]*Winter/, said: 'season', gives: packGives },
      { tool: 'packing list', form: pack, field: /\bNights\b/i, said: 'nights', gives: packGives },
      { tool: 'packing list', form: pack, field: /\bPeople\b/i, said: 'people', gives: packGives },
      { tool: 'packing list', form: pack, field: /Cooking at the pitch/, said: 'cook', gives: packGives },
      { tool: 'packing list', form: pack, field: /Pitch has electricity/, said: 'electricity', gives: packGives },
      { tool: 'packing list', form: pack, field: /Travelling with children/, said: 'children', gives: packGives },
      { tool: 'packing list', form: pack, field: /Travelling with a dog/, said: 'dog', gives: packGives },
    ];
    for (const r of rows) {
      expect(r.form, `${r.tool}: the index names "${r.said}" but the tool has no such field`).toMatch(r.field);
      expect(r.gives, `${r.tool}: the index no longer says "${r.said}"`).toContain(r.said);
    }
  });

  test('🔴 it does not claim a tool it does not have', () => {
    // The comparison tool is a gap, said as a gap — and no link to it.
    expect(text).toContain('comparison tool was planned');
    expect(html).not.toMatch(/href="\/tools\/(camper-)?compar/);
  });
});

// ── 3. /routes ───────────────────────────────────────────────────────────

/** Great-circle km, written here so the card is not checked against itself. */
const R_KM = 6371.0088;
function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

test.describe('/routes', () => {
  const html = render.routes();

  /** One route's card, as a reader reads it. */
  const card = (slug: string): string => {
    const m = new RegExp(`<a\\b[^>]*href="/routes/${slug}"[^>]*>([\\s\\S]*?)</a>`).exec(html);
    expect(m, `no card for ${slug}`).not.toBeNull();
    return everythingSaid(m![1])[1];
  };

  test('every route has a card linking to its page', () => {
    const links = [...html.matchAll(/href="\/routes\/([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(links.sort()).toEqual(CURATED_ROUTES.map((r) => r.slug).sort());
  });

  test('🔴 every card prints its distance, and the distance is the sum of straight lines, and says so', () => {
    for (const r of CURATED_ROUTES) {
      const said = card(r.slug);
      const m = /([\d,]+) km in a straight line/.exec(said);
      expect(m, `${r.slug}: no labelled distance on the card — "${said}"`).not.toBeNull();

      let expected = 0;
      for (let i = 1; i < r.stages.length; i++) {
        expected += haversineKm(r.stages[i - 1], r.stages[i]);
      }
      const shown = Number(m![1].replace(/,/g, ''));
      expect(
        Math.abs(shown - expected),
        `${r.slug}: card says ${shown} km, the stops say ${expected.toFixed(1)}`,
      ).toBeLessThanOrEqual(1);

      // 🔴 The only `km` on the card is the labelled one. A second,
      // unlabelled figure beside it is the one a reader takes for a drive.
      expect((said.match(/\bkm\b/g) ?? []).length, `${r.slug}: another km on the card`).toBe(1);
    }
  });

  test('every card says who the route suits, in the filter’s own words', () => {
    for (const r of CURATED_ROUTES) {
      expect(card(r.slug), r.slug).toMatch(/Suits: [A-Z]/);
    }
  });

  test('🔴 the catalogue’s own words promise no hours at the wheel and no money', () => {
    // The design's catalogue promises both ("2–4 hours behind the wheel",
    // "fuel ≈ €84"). We have no routing engine, so neither exists. A
    // property of what WE wrote, not a list of banned phrases: none of
    // our figures is a duration or a price.
    //
    // 🔴 What is read is the lead, the facts line of every card, and the
    // section at the foot — NOT each route's `summary`, which is editorial
    // prose about the ground ("a 40-minute ferry") and a different kind
    // of statement from a figure on a card. They are cut out, and cut out
    // provably: a summary that was not found in its card would mean this
    // test had scanned the wrong text.
    let scanned = '';
    for (const r of CURATED_ROUTES) {
      const said = card(r.slug);
      const parts = said.split(r.summary.replace(/\s+/g, ' ').trim());
      expect(parts.length, `${r.slug}: the summary is not on its card verbatim`).toBe(2);
      scanned += ` ${parts.join(' ')}`;
    }
    const section = /<section\b[^>]*aria-labelledby="how-heading"[\s\S]*?<\/section>/.exec(html);
    expect(section, 'no "how these routes are put together" section').not.toBeNull();
    scanned += ` ${everythingSaid(section![0])[1]}`;
    scanned += ` ${everythingSaid(/<h1\b[\s\S]*?<p\b[\s\S]*?<\/p>/.exec(html)![0])[1]}`;

    expect(scanned).not.toMatch(/\d\s*(?:h|hr|hrs|hours?|min|mins|minutes?)\b/i);
    expect(scanned).not.toMatch(/\bhours?\b/i);
    expect(scanned).not.toMatch(/[€≈]|\beuros?\b/i);
  });

  test('🔴 it says what is not here, in the place a reader comparing routes looks', () => {
    const text = visibleText(html);
    expect(text).toContain('What is not here yet');
    for (const missing of [
      'road distances and driving times',
      'height, width or weight of your vehicle',
      'what the fuel will cost',
      'sum of the straight lines',
    ]) {
      expect(text, `the hub does not say: ${missing}`).toContain(missing);
    }
  });

  test('🔴 the word on the page for how many routes there are is the number there are', () => {
    // "Twelve routes", "twelve rather than fifty" are typed. Add a
    // thirteenth route and they say a thing that is no longer true.
    const word = NUMBER_WORDS[CURATED_ROUTES.length];
    expect(word, 'more routes than the word list has words for').toBeDefined();
    const text = visibleText(html).toLowerCase();
    expect(text).toContain(`${word} routes through the european union`);
    expect(text).toContain(`${word} rather than fifty`);
  });

  test('🔴 what it says stands behind each stop is what the route page says, rendered separately', async () => {
    const catalogue = /up to (\d+) campsites from our database within (\d+) km of it, nearest first, and the nearest recorded example of each of (\d+) kinds of service/.exec(
      visibleText(html),
    );
    expect(catalogue, 'the catalogue no longer says what stands behind a stop').not.toBeNull();

    const route = CURATED_ROUTES[0];
    let page = '';
    await withFetch(
      (url) => {
        if (url.includes('/routes/near')) {
          return json({
            groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, spots: [] })),
            perPoint: CAMPSITES_PER_STAGE,
            radiusMetres: STAGE_RADIUS_M,
            returned: 0,
          });
        }
        if (url.includes('/routes/services')) {
          return json({
            groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, services: [] })),
            radiusMetres: SERVICE_RADIUS_M,
            perKind: 1,
            returned: 0,
            truncated: false,
          });
        }
        throw new Error(`unexpected request in a unit test: ${url}`);
      },
      async () => {
        page = visibleText(
          await renderAsyncComponent(
            RoutePage,
            { params: Promise.resolve({ slug: route.slug }) },
            { omit: [RouteMapEmbed] },
          ),
        );
      },
    );
    const stop = /shows up to (\d+) campsites from our database within (\d+) km of it, nearest first, and the nearest single example of each of (\d+) kinds of service/.exec(
      page,
    );
    expect(stop, 'the route page no longer says what stands behind a stop').not.toBeNull();
    expect(catalogue!.slice(1)).toEqual(stop!.slice(1));
    // And the third number is the closed list's length, not a literal.
    expect(Number(catalogue![3])).toBe(SERVICE_KINDS.length);

    // 🔴 The number is one thing and the list after it is another, and a
    // page can keep the first while the second shrinks ("7 kinds of
    // service: fuel."). Two checks, neither against the constant that
    // built the sentence: the list is as long as the number says, and
    // every kind the ROUTE PAGE labels in its stop blocks is in it.
    const listed = /kinds of service: ([^.]+)\./.exec(visibleText(html));
    expect(listed, 'the catalogue names no kinds of service').not.toBeNull();
    expect(listed![1].split(', ').length).toBe(Number(catalogue![3]));
    for (const label of Object.values(SERVICE_LABEL)) {
      expect(page, `the route page no longer labels "${label}"`).toContain(label);
      expect(
        listed![1].toLowerCase(),
        `the route page labels "${label}" and the catalogue does not name it`,
      ).toContain(label.toLowerCase());
    }
  });
});

// ── 4. /search ───────────────────────────────────────────────────────────

test.describe('/search', () => {
  test('🔴 the source emits 28 codes and the page says 27 countries', async () => {
    // The corpus: what `/spots/countries` answered on 15.10.2026, code for
    // code. 28 entries — the 27 member states and `ax`, Åland.
    expect(API_COUNTRIES.length).toBe(28);
    expect(API_COUNTRIES.map((c) => c.country)).toContain('ax');

    const text = visibleText(await renderSearch());
    expect(text).toContain('across 27 countries');
    expect(text).not.toContain('28 countries');
  });

  test('🔴 folded, the source’s codes ARE the EU-27 — compared with the API workspace’s own file', () => {
    const members = Object.keys(
      (
        JSON.parse(
          readFileSync(
            join(process.cwd(), '..', 'api', 'src', 'osm', 'eu-member-states.json'),
            'utf8',
          ),
        ) as { members: Record<string, string> }
      ).members,
    ).sort();
    expect(members.length).toBe(27);

    const folded = [...new Set(API_COUNTRIES.map((c) => memberState(c.country)))].sort();
    // Equality of the SETS, not of their sizes: a code that is neither a
    // member state nor an alias of one is a failure here, and so is a
    // member state the source stopped emitting.
    expect(folded).toEqual(members);
    expect(memberStateCount(API_COUNTRIES.map((c) => c.country))).toBe(27);
  });

  test('the count counts member states, not codes', () => {
    expect(memberStateCount(['fi', 'ax'])).toBe(1);
    expect(memberStateCount(['ax'])).toBe(1);
    expect(memberStateCount(['FI', 'AX', 'fr'])).toBe(2);
    // A code nobody has told us about is a country of its own — the
    // number rises, it does not silently fold away.
    expect(memberStateCount(['fi', 'ax', 'xx'])).toBe(2);
    expect(memberStateCount([])).toBe(0);
  });

  test('🔴 it says the box searches campsites only, and where the rest of the site is', async () => {
    const html = await renderSearch();
    const text = visibleText(html);
    expect(text).toContain('This box searches campsites only');
    for (const href of ['/map', '/routes', '/guides', '/tools']) {
      expect(html, `no way out to ${href}`).toContain(`href="${href}"`);
    }
    // The count of routes on offer is the count there are.
    expect(text).toContain(`${CURATED_ROUTES.length} curated routes`);
  });

  test('every country chip carries a thousands separator, like the lead does', async () => {
    const text = visibleText(await renderSearch());
    expect(text).toContain('France · 17,915');
    expect(text).not.toMatch(/France · 17915/);
  });
});
