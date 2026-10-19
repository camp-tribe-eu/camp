import { expect, test } from '@playwright/test';
import CampsitePage from '@/app/camping/[country]/[region]/[slug]/page';
import Home from '@/app/page';
import { GET as llmsTxt } from '@/app/llms.txt/route';
import Attribution from '@/content/legal/attribution';
import Database from '@/content/legal/database';
import { renderAsyncComponent, renderComponent } from './render-component';
import { visibleText } from './rendered-text';
import { CLIENT_ISLANDS } from './client-islands';

// CAMP-325 — `context.station` is `railway=station` OR `railway=halt`, and
// 3 163 of 9 838 entries (32.1%, `camptribe_dev`, 15.10.2026) stand on a
// halt: a platform with no staff and no ticket office. PR #256 fixed the
// API's "Railway stop" and the JSON-LD and left the visible page, the prose
// paragraph, llms.txt, the home page and the legal text saying "station".
//
// 🔴 EVERY ASSERTION READS THE HTML (or the llms.txt body) THE SITE SERVES.
// Not `RAILWAY_STOP`, not a class, not a `data-testid`. The five places are
// rendered for real — the real `CampsitePage`, `Home`, the real `GET` of
// `/llms.txt`, the real legal pages — with `fetch` swapped for a canned API.
// A constant can be right while the page prints something else, and the old
// state of this repository was exactly that: a constant in jsonld.ts that
// said "stop" over a page that said "station".
//
// 🔴 EACH "SAYS STOP" CHECK IS PAIRED WITH A "DOES NOT SAY STATION" ONE, and
// the negative is never the only one: "does not print station" is also true
// of a page that prints nothing (silence satisfies a negative).
//
// 🔴 WHAT MAY STILL SAY "station", AND WHY IT IS TRUE:
//   · the air-quality monitoring station (components/air-quality.tsx);
//   · the question "How far is the nearest railway station or stop?" — it
//     asks about both and is what a searcher types (lib/railway-stop.ts);
//   · the legal page, which names `railway=station` as one of the two values.
// Each is removed by name before a negative is read, so the remaining text
// has no excuse.

type Fetcher = (url: string) => Response | Promise<Response>;

async function withFetch<T>(impl: Fetcher, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type Station = { m: number; name?: string };

// A campsite as the API returns it. Only what the page reads; the only
// measured fact is the station, so the prose paragraph is that one clause.
const spot = (station: Station) => ({
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
  missingSince: null,
  context: { station },
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
});

const PARAMS = { country: 'hr', region: 'istria', slug: 'camping-test' };

/** The campsite page as served: the HTML, what a reader sees, the JSON-LD. */
async function renderPage(station: Station) {
  const html = await withFetch(
    (url) =>
      url.includes('/spots/hr/istria/camping-test')
        ? json({ spot: spot(station), nearby: [] })
        : json({}, 404),
    () =>
      renderAsyncComponent(
        CampsitePage,
        { params: Promise.resolve(PARAMS) },
        { omit: CLIENT_ISLANDS },
      ),
  );
  // Every string in every JSON-LD block in the HTML — the markup a crawler
  // reads, as the page printed it, not as jsonld.ts builds it.
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ];
  for (const b of blocks) walk(JSON.parse(b[1]));
  return { html, text: visibleText(html), markup: strings, blocks: blocks.length };
}

/** What a station-word check may ignore: each phrase is true, see above. */
const TRUE_STATIONS = /railway station or stop|monitoring station/gi;
const withoutTrueStations = (s: string) => s.replace(TRUE_STATIONS, '');

const NAMED: Station = { m: 2100, name: 'Lesce-Bled' };

test.describe('the campsite page: a stop, in the row, the facts, the sentence and the markup', () => {
  test('anchor: the page renders the campsite, its station fact and its markup', async () => {
    const { text, markup, blocks } = await renderPage(NAMED);
    // 🔴 Asserted first. If the page rendered nothing, every "does not say
    // station" below would pass over an empty string.
    expect(text).toContain('Camping Test');
    expect(text).toContain('Getting there');
    expect(text.length).toBeGreaterThan(300);
    expect(blocks, 'the page lost its JSON-LD').toBeGreaterThan(0);
    expect(markup.some((m) => /railway/.test(m))).toBe(true);
  });

  test('🔴 the visible "Getting there" row says railway stop, and gives the name and the distance', async () => {
    const { text, html } = await renderPage(NAMED);
    expect(text).toContain('Getting there Nearest railway stop Lesce-Bled, 2.1 km');
    expect(html).toMatch(/<dt[^>]*>Nearest railway stop<\/dt>/);
  });

  test('🔴 the "What’s around it" row names the stop, not a station', async () => {
    const { text, html } = await renderPage(NAMED);
    expect(html).toMatch(/<dt[^>]*>Lesce-Bled railway stop<\/dt>/);
    expect(text).toContain('Lesce-Bled railway stop 2.1 km');
  });

  test('🔴 the sentence under the heading says railway stop', async () => {
    const { text } = await renderPage(NAMED);
    expect(text).toContain('This campsite, 2.1 km from Lesce-Bled railway stop.');
  });

  test('🔴 the prose paragraph says railway stop', async () => {
    const { text } = await renderPage(NAMED);
    expect(text).toContain('The nearest railway stop is Lesce-Bled, 2.1 km off.');
  });

  test('🔴 nowhere on the page, in what is read or in the markup, is the stop called a station', async () => {
    const { text, markup } = await renderPage(NAMED);
    expect(withoutTrueStations(text)).not.toMatch(/\bstation\b/i);
    for (const m of markup) {
      expect(withoutTrueStations(m), m).not.toMatch(/\bstation\b/i);
    }
  });

  test('🔴 the visible row and the JSON-LD say the same thing about the same stop', async () => {
    const { html, markup } = await renderPage(NAMED);
    // The label is read from the page's own row, and the markup is asked for
    // exactly that label. Two constants that happened to agree would not do:
    // this is the page and its graph agreeing about one field.
    const label = html.match(/<dt[^>]*>(Lesce-Bled[^<]*)<\/dt>/)?.[1];
    expect(label, 'no row for the station on the page').toBe('Lesce-Bled railway stop');
    expect(markup).toContain(`Distance to ${label}`);
    expect(markup).toContain(
      'Lesce-Bled railway stop is 2.1 km away in a straight line. We do not know whether a bus or a path connects the two.',
    );
    expect(markup.some((m) => m.includes(`from ${label}`))).toBe(true);
    // The heading the reader meets first names the same kind of thing as
    // the row below it, and so as the markup: one noun phrase, three places.
    const heading = html.match(/<dt[^>]*>(Nearest [^<]*)<\/dt>/)?.[1];
    expect(heading).toBe('Nearest railway stop');
    expect(label).toBe(`Lesce-Bled ${heading!.replace('Nearest ', '')}`);
  });

  test('🔴 a stop with no name is still a stop, in all four places', async () => {
    const { text, html, markup } = await renderPage({ m: 900 });
    expect(html).toMatch(/<dt[^>]*>Nearest railway stop<\/dt>/);
    expect(text).toContain('Getting there Nearest railway stop Railway stop, 900 m');
    expect(html).toMatch(/<dt[^>]*>Railway stop<\/dt>/);
    expect(text).toContain('This campsite, 900 m from a railway stop.');
    expect(text).toContain('A railway stop is 900 m away.');
    expect(markup).toContain('Distance to the nearest railway stop');
    expect(withoutTrueStations(text)).not.toMatch(/\bstation\b/i);
    for (const m of markup) expect(withoutTrueStations(m), m).not.toMatch(/\bstation\b/i);
  });
});

// 🔴 The prose paragraph has FOUR shapes by distance, each with and without a
// name — eight strings in `stationClause`. They are listed one by one,
// because a single "it says stop" assertion on one distance leaves seven of
// them free to say "station" again. Each is read from the rendered page.
test.describe('the prose paragraph, every shape of it, as the page prints it', () => {
  const cases: { why: string; station: Station; says: string }[] = [
    { why: 'walkable, named', station: { m: 900, name: 'Nin' }, says: 'Nin railway stop is 900 m away, so you can arrive by train.' },
    { why: 'walkable, unnamed', station: { m: 900 }, says: 'A railway stop is 900 m away.' },
    { why: 'a short ride, named', station: { m: 5000, name: 'Nin' }, says: 'The nearest railway stop is Nin, 5 km off.' },
    { why: 'a short ride, unnamed', station: { m: 5000 }, says: 'The nearest railway stop is 5 km off.' },
    { why: 'far, named', station: { m: 25_000, name: 'Nin' }, says: 'The railway does not come close — Nin is the nearest railway stop, 25 km off.' },
    { why: 'far, unnamed', station: { m: 25_000 }, says: 'The railway does not come close: the nearest railway stop is 25 km off.' },
    { why: 'very far, named', station: { m: 50_000, name: 'Nin' }, says: 'You will want a car here: the nearest railway stop, Nin, is 50 km away.' },
    { why: 'very far, unnamed', station: { m: 50_000 }, says: 'You will want a car here: the nearest railway stop is 50 km away.' },
  ];

  for (const c of cases) {
    test(`${c.why}: "${c.says}"`, async () => {
      const { text } = await renderPage(c.station);
      expect(text).toContain(c.says);
      expect(withoutTrueStations(text)).not.toMatch(/\bstation\b/i);
    });
  }
});

test.describe('/llms.txt, which AI assistants read, says railway stop and says what it covers', () => {
  async function llms(): Promise<string> {
    const res = await withFetch(
      (url) =>
        url.includes('/spots/countries')
          ? json([{ country: 'hr', spots: 10, regions: 2 }])
          : json({}, 404),
      () => llmsTxt(),
    );
    return res.text();
  }

  test('anchor: the file renders, with the section the lines below live in', async () => {
    const body = await llms();
    expect(body).toContain('# CampTribe');
    expect(body).toContain('## What the data is, and what it is not');
  });

  test('🔴 the summary line says "to a railway stop"', async () => {
    expect(await llms()).toContain(
      'to the nearest town, to a supermarket and to a railway stop, plus elevation and terrain.',
    );
  });

  test('🔴 the data line says "nearest railway stop" and that it is a station or a halt', async () => {
    expect(await llms()).toContain(
      'nearest railway stop (a railway station or a smaller halt; the record does not say which)',
    );
  });

  test('🔴 no line calls the field a station, apart from the gloss that names both', async () => {
    const body = (await llms()).replace(
      'a railway station or a smaller halt',
      '',
    );
    expect(body).not.toMatch(/railway station/i);
    expect(body).not.toMatch(/\bnearest station\b/i);
  });
});

test.describe('the home page, which says what is computed for every campsite', () => {
  async function home(): Promise<string> {
    const html = await withFetch(
      (url) =>
        url.includes('/spots/summary')
          ? json({ spots: 61_558, countries: 27, regions: 800 })
          : url.includes('/spots/countries')
            ? json([{ country: 'hr', spots: 10, regions: 2 }])
            : url.includes('/spots/notable')
              ? json([])
              : json({}, 404),
      () => renderAsyncComponent(Home, undefined as never),
    );
    return visibleText(html);
  }

  test('anchor: the hero renders', async () => {
    const text = await home();
    expect(text).toContain('Every campsite, and what is around it');
  });

  test('🔴 the hero lists "a railway stop" among the things we compute', async () => {
    const text = await home();
    expect(text).toContain(
      'the distance to water, to the nearest town and to a railway stop, its elevation and its terrain',
    );
    expect(text).not.toMatch(/railway station/i);
  });
});

test.describe('the legal pages describe what the field holds', () => {
  const databaseText = () => visibleText(renderComponent(Database, {}));
  const attributionText = () => visibleText(renderComponent(Attribution, {}));

  test('anchor: both pages render the paragraphs the lines below live in', () => {
    expect(databaseText()).toContain('The distances are ours; several of the names are not.');
    expect(attributionText()).toContain('What we added');
  });

  test('🔴 the database page names the field and says it is a stop, i.e. BOTH values', () => {
    const text = databaseText();
    expect(text).toContain('station — the nearest railway stop, with its distance and name.');
    // Both values, by their OpenStreetMap tags, and the difference between them.
    expect(text).toContain('railway station (OpenStreetMap tag railway=station)');
    expect(text).toContain('a halt (railway=halt)');
    expect(text).toContain('a platform that usually has no staff and no ticket office');
    // And that the record does not keep which one it is — the reason the
    // site says "stop".
    expect(text).toContain('does not say which of the two it is');
  });

  test('🔴 the database page does not say that every entry is a station', () => {
    // The one place a station may be named is in the tag that lists the
    // two values, so it is taken out before the question is asked.
    const text = databaseText()
      .replace('railway station (OpenStreetMap tag railway=station)', '')
      .replace('and not station', '');
    expect(text).not.toMatch(/nearest railway station/i);
    expect(text).not.toMatch(/town, shop or station/i);
  });

  test('🔴 the sentence about names read from OpenStreetMap lists a railway stop', () => {
    expect(databaseText()).toContain(
      'names a nearby lake, town, shop or railway stop, that name is read from OpenStreetMap',
    );
  });

  test('🔴 the attribution page lists a railway stop among what we computed', () => {
    const text = attributionText();
    expect(text).toContain('Distance to the nearest water, town, supermarket and railway stop');
    expect(text).not.toMatch(/supermarket and station/i);
  });
});
