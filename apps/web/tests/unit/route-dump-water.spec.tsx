import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import RoutePage from '@/app/routes/[slug]/page';
import RouteMapEmbed from '@/components/route-map-embed';
import { CURATED_ROUTES } from '../../src/data/routes';
import { CAMPSITES_PER_STAGE, STAGE_RADIUS_M, STRAIGHT_LINE_LABEL } from '../../src/lib/routes';
import {
  readDumpWater,
  SERVICE_KINDS,
  SERVICE_RADIUS_M,
  WATER_NEAR_KINDS,
} from '../../src/lib/route-services';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-254 — THE ROUTE PAGE SAYS WHETHER THERE IS DRINKING WATER BESIDE THE
// DISPOSAL POINT, AND HOW FAR.
//
// 🔴 EVERY ASSERTION HERE READS THE HTML OF THE ROUTE PAGE, rendered with the
// API's answer swapped in — never a constant, a class name, a `data-testid`
// on its own, or an `sr-only` caption (`visibleText` drops those). The sentence
// is the product, so it is written out in full below, by hand, and not built
// from the pieces the component builds it from. `data-testid` is used only to
// find WHERE to read; what is asserted is the words a reader meets.
//
// 🔴 The API is never reached: `fetch` is replaced for the duration of each
// render, and anything that is not one of the two endpoints throws.

const route = CURATED_ROUTES[0];
const stages = route.stages.length;

// ── what the API serves, read off its own file ──────────────────────────

const API_FILE = join(__dirname, '..', '..', '..', 'api', 'src', 'routes', 'route-services.ts');

/**
 * The API's own source, for the three things this file must agree with it on:
 * the key the answer travels under, the keys inside it, and which kind
 * carries it.
 *
 * 🔴 Read from DISK, not imported: apps/web and apps/api are separate
 * workspaces and the web test project must not depend on the API's build —
 * `route-stopping-places.spec.tsx` reads the same file for the same reason.
 * Each parse is anchored by its caller, because a regex that finds nothing
 * must not read as "nothing to disagree about".
 */
const apiSource = () => readFileSync(API_FILE, 'utf8');

// ── rendering the page ───────────────────────────────────────────────────

async function withFetch(impl: (url: string) => Response, run: () => Promise<void>) {
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

const nearBody = () => ({
  groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, spots: [] })),
  perPoint: CAMPSITES_PER_STAGE,
  radiusMetres: STAGE_RADIUS_M,
  returned: 0,
});

type Wire = Record<string, unknown>;

/** What the endpoint sends for one stage, given the services it found. */
const servicesBody = (perStage: (stage: number) => Wire[]) => ({
  groups: route.stages.map((s, i) => ({ lat: s.lat, lon: s.lon, services: perStage(i) })),
  radiusMetres: SERVICE_RADIUS_M,
  perKind: 1,
  returned: 0,
  truncated: false,
});

/** The wire shape of one service, written out as the API's mapper writes it. */
const wire = (kind: string, over: Wire = {}): Wire => ({
  kind,
  osmRef: `n${kind.length}`,
  name: null,
  lat: 46.1,
  lon: -1.1,
  metres: 7399,
  phone: null,
  website: null,
  openingHours: null,
  ...over,
});

async function renderRoute(body: unknown): Promise<string> {
  let html = '';
  await withFetch(
    (url) => {
      if (url.includes('/routes/near')) return json(nearBody());
      if (url.includes('/routes/services')) return json(body);
      throw new Error(`unexpected request in a unit test: ${url}`);
    },
    async () => {
      html = await renderAsyncComponent(
        RoutePage,
        { params: Promise.resolve({ slug: route.slug }) },
        { omit: [RouteMapEmbed] },
      );
    },
  );
  return html;
}

/**
 * The n-th row of one kind on the page, as HTML: from its opening testid to
 * the next ROW (found or absent, of any kind) or the end of the list. Rows
 * are siblings in a `<dl>`, so this cannot swallow a neighbour.
 */
function rowOf(html: string, kind: string, nth = 0): string {
  const marker = `data-testid="service-${kind}"`;
  let at = -1;
  for (let i = 0; i <= nth; i++) at = html.indexOf(marker, at + 1);
  if (at < 0) throw new Error(`no ${kind} row #${nth} on the page`);
  const rest = html.slice(at + marker.length);
  const ends = [
    rest.indexOf('</dl>'),
    ...SERVICE_KINDS.flatMap((k) => [
      rest.indexOf(`data-testid="service-${k}"`),
      rest.indexOf(`data-testid="service-${k}-absent"`),
    ]),
  ].filter((n) => n >= 0);
  const next = ends.length > 0 ? Math.min(...ends) : rest.length;
  return html.slice(at, at + marker.length + next);
}

/** Every row of one kind, in page order, found rows only. */
const rowsOf = (html: string, kind: string): string[] =>
  Array.from({ length: occurrences(html, `data-testid="service-${kind}"`) }, (_, i) =>
    rowOf(html, kind, i),
  );

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

/** The water line of one row, as the words a reader meets. */
function waterLine(rowHtml: string): string {
  const m = /<div[^>]*data-testid="service-dump-water"[^>]*>[\s\S]*?<\/div>/.exec(rowHtml);
  if (!m) throw new Error('the row has no water line');
  return visibleText(m[0]);
}

// ── 1. THE CARD'S THREE CASES, AS A READER MEETS THEM ────────────────────

// The sentences, written out by hand. If one of these changes it is a
// decision about what the page says to a driver, and this is where it is
// made.
const FOUND_180 =
  'Drinking water 180 m away in a straight line from this disposal point';
const NONE_500 =
  'Our database holds no drinking water within 500 m of this disposal point';
const UNCHECKED = 'We did not check for drinking water near this disposal point';

/**
 * Seven stages, seven situations, in this order:
 *
 *   0  water 180 m away                    → FOUND_180
 *   1  searched, nothing inside 500 m      → NONE_500   (the API's answer for
 *                                            a tap at 510 m, and for one at
 *                                            800 m, and for none at all)
 *   2  the same payload again              → NONE_500   (deliberately the
 *                                            same: the page cannot tell, and
 *                                            must not pretend to)
 *   3  an API that predates the field      → UNCHECKED
 *   4  a distance beyond its own radius    → UNCHECKED
 *   5  no disposal point within 25 km      → the row's own absent line, and
 *                                            nothing about water
 *   6  a tap 0 m away                      → "0 m away", not a blank
 *
 * Stage 0 also carries a fuel station whose payload has the field — the API
 * never sends it, and the page must not print it if one did.
 */
const SCENARIO: Record<number, Wire[]> = {
  0: [
    wire('dump', { osmRef: 'n1', drinkingWaterNear: { radiusMetres: 500, metres: 180 } }),
    wire('fuel', { osmRef: 'n9', drinkingWaterNear: { radiusMetres: 500, metres: 50 } }),
  ],
  1: [wire('dump', { osmRef: 'n2', drinkingWaterNear: { radiusMetres: 500, metres: null } })],
  2: [wire('dump', { osmRef: 'n3', drinkingWaterNear: { radiusMetres: 500, metres: null } })],
  3: [wire('dump', { osmRef: 'n4' })],
  4: [wire('dump', { osmRef: 'n5', drinkingWaterNear: { radiusMetres: 500, metres: 800 } })],
  5: [],
  6: [wire('dump', { osmRef: 'n7', drinkingWaterNear: { radiusMetres: 500, metres: 0 } })],
};

const scenarioBody = () => servicesBody((i) => SCENARIO[i] ?? []);

test.describe('the disposal point says whether drinking water is beside it', () => {
  test('🔴 the route has the stages this scenario is written for', () => {
    // Anchor: seven situations need seven stages. A shorter route would
    // render fewer rows and every `nth` below would be about another row.
    expect(stages).toBeGreaterThanOrEqual(7);
  });

  test('🔴 water 180 m away: the page says so, in metres, as a straight line, from the disposal point', async () => {
    const html = await renderRoute(scenarioBody());
    const rows = rowsOf(html, 'dump');
    // Found rows: stages 0, 1, 2, 3, 4, 6 — stage 5 has none.
    expect(rows).toHaveLength(6);
    expect(waterLine(rows[0])).toBe(FOUND_180);
    // …and it is IN the row's text as a reader reads it, not only in a
    // fragment this test went and found.
    expect(visibleText(rows[0])).toContain(FOUND_180);
  });

  test('🔴 no water within 500 m: the page says that, in the same tone, and does not leave the line blank', async () => {
    const html = await renderRoute(scenarioBody());
    const rows = rowsOf(html, 'dump');
    expect(waterLine(rows[1])).toBe(NONE_500);
    expect(visibleText(rows[1])).toContain(NONE_500);
    // Not "unknown", not "not known", not "no information": we searched,
    // so it is an answer. (The WATER LINE, not the row: the row's own hours,
    // phone and website say "unknown" about themselves, and rightly.)
    expect(waterLine(rows[1])).not.toMatch(/unknown|not known|no information|did not check/i);
  });

  // 🔴 THE DECISION, WRITTEN AS AN ASSERTION: a tap 510 m away, a tap 800 m
  // away and no tap at all are THE SAME SENTENCE. Only 500 m was searched —
  // the API sends `metres: null` for all three — and a page that said "the
  // nearest is 800 m away" would be quoting a number nobody looked for. The
  // API spec makes the same claim on the wire (cases 3, 4 and 5).
  test('🔴 a tap just beyond the radius and no tap at all read identically', async () => {
    const html = await renderRoute(scenarioBody());
    const rows = rowsOf(html, 'dump');
    expect(waterLine(rows[1])).toBe(waterLine(rows[2]));
  });

  test('🔴 a payload with no usable answer says it did not check, and never says there is none', async () => {
    const html = await renderRoute(scenarioBody());
    const rows = rowsOf(html, 'dump');
    // rows[3]: the field is missing. rows[4]: a distance beyond its radius.
    for (const [i, why] of [
      [3, 'a payload from an API that predates the field'],
      [4, 'a distance beyond its own radius'],
    ] as const) {
      const text = visibleText(rows[i]);
      expect(text.includes(UNCHECKED), why).toBe(true);
      expect(/holds no drinking water/i.test(text), why).toBe(false);
      expect(/\d+ m away/.test(waterLine(rows[i])), why).toBe(false);
    }
  });

  test('a tap on the very point is printed as a distance of zero, not as a blank', async () => {
    const html = await renderRoute(scenarioBody());
    const rows = rowsOf(html, 'dump');
    expect(waterLine(rows[5])).toBe(
      'Drinking water 0 m away in a straight line from this disposal point',
    );
  });

  // 🔴 A stop with no disposal point has nothing to be near. Its row says
  // what it always said, and says nothing about water: "no drinking water
  // within 500 m of it" about a thing that is not there would be a
  // sentence about nothing.
  test('a stop whose database holds no disposal point says that and nothing about water', async () => {
    const html = await renderRoute(scenarioBody());
    expect(occurrences(html, 'data-testid="service-dump-absent"')).toBe(1);
    const absent = html.slice(html.indexOf('data-testid="service-dump-absent"'));
    const absentText = visibleText(absent.slice(0, absent.indexOf('</div>') + 6));
    expect(absentText).toContain(
      'Our database holds no chemical-toilet disposal point within 25 km of this stop',
    );
    expect(absentText).not.toMatch(/drinking water/i);
  });

  test('exactly one water line per disposal point found, and none anywhere else', async () => {
    const html = await renderRoute(scenarioBody());
    expect(occurrences(html, 'data-testid="service-dump-water"')).toBe(6);
  });

  // 🔴 The kind gate, read off the page. The fuel station in stage 0 has the
  // field in its payload; the page prints a water line for disposal points
  // and for nothing else.
  test('🔴 a fuel station whose payload carries the field prints no water line', async () => {
    const html = await renderRoute(scenarioBody());
    const fuel = visibleText(rowOf(html, 'fuel'));
    expect(fuel).not.toMatch(/drinking water/i);
    expect(fuel).not.toContain('disposal point');
  });

  test('every sentence is about the disposal point, never about the stop', async () => {
    const html = await renderRoute(scenarioBody());
    for (const row of rowsOf(html, 'dump')) {
      expect(waterLine(row)).toMatch(/ (?:from|of|near) this disposal point$/);
    }
  });

  // 🔴 NO ROUTING ENGINE ON THIS SITE (CAMP-42): a "2 min walk" beside the
  // water would be a figure we do not compute.
  test('the water line promises no walking time and no road distance', async () => {
    const html = await renderRoute(scenarioBody());
    for (const row of rowsOf(html, 'dump')) {
      expect(waterLine(row)).not.toMatch(
        /\bmin(?:ute)?s?\b|\bwalk|\bdriv(?:e|ing)\b|\bby road\b|\bon foot\b/i,
      );
    }
    // …and the distance it does give is the straight one.
    const rows = rowsOf(html, 'dump');
    expect(waterLine(rows[0])).toContain(STRAIGHT_LINE_LABEL);
  });
});

// ── 2. THE READER, ON EVERYTHING AN API COULD SEND ───────────────────────

test.describe('🔴 readDumpWater: a gap is never an answer of "none"', () => {
  const NOT_AN_ANSWER: [string, unknown][] = [
    ['an API that predates the field', undefined],
    ['null', null],
    ['an empty object', {}],
    ['a radius and no metres key at all', { radiusMetres: 500 }],
    ['metres and no radius', { metres: 180 }],
    ['metres: undefined', { radiusMetres: 500, metres: undefined }],
    ['a radius that is a string', { radiusMetres: '500', metres: 180 }],
    ['metres that is a string', { radiusMetres: 500, metres: '180' }],
    ['a null radius', { radiusMetres: null, metres: null }],
    ['a zero radius', { radiusMetres: 0, metres: null }],
    ['a negative radius', { radiusMetres: -500, metres: null }],
    ['an infinite radius', { radiusMetres: Infinity, metres: null }],
    ['NaN metres', { radiusMetres: 500, metres: NaN }],
    ['negative metres', { radiusMetres: 500, metres: -1 }],
    ['metres beyond the radius', { radiusMetres: 500, metres: 500.5 }],
    ['a boolean for metres', { radiusMetres: 500, metres: true }],
    ['a string where an object was expected', 'near'],
    ['a number where an object was expected', 180],
    ['an array', [500, 180]],
  ];

  for (const [why, raw] of NOT_AN_ANSWER) {
    test(`${why} → unchecked`, () => {
      expect(readDumpWater(raw)).toEqual({ state: 'unchecked' });
    });
  }

  test('the three answers it does give', () => {
    expect(readDumpWater({ radiusMetres: 500, metres: 180 })).toEqual({
      state: 'found',
      metres: 180,
    });
    expect(readDumpWater({ radiusMetres: 500, metres: 0 })).toEqual({
      state: 'found',
      metres: 0,
    });
    expect(readDumpWater({ radiusMetres: 500, metres: 500 })).toEqual({
      state: 'found',
      metres: 500,
    });
    expect(readDumpWater({ radiusMetres: 500, metres: null })).toEqual({
      state: 'none',
      radiusMetres: 500,
    });
  });

  // 🔴 The radius the page prints is the radius it was SENT, not a number
  // of the page's own. A "none" for 750 m must say 750 m.
  test('the radius in the sentence is the radius in the payload', async () => {
    const html = await renderRoute(
      servicesBody(() => [
        wire('dump', { drinkingWaterNear: { radiusMetres: 750, metres: null } }),
      ]),
    );
    expect(waterLine(rowOf(html, 'dump'))).toBe(
      'Our database holds no drinking water within 750 m of this disposal point',
    );
  });
});

// ── 3. THE TWO SIDES SPELL IT THE SAME WAY ───────────────────────────────

test.describe('the API and this page agree on the key, the fields and the kind', () => {
  test('🔴 the key the answer travels under is the one this file writes its payloads with', () => {
    const src = apiSource();
    const m = /^\s+(\w+)\?: RouteDumpWater;/m.exec(src);
    // Anchor: the property was found in the API's RouteService.
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('drinkingWaterNear');
    // …and it is what the rendered page reads: a payload under that key
    // prints the sentence (scenario stage 0), which `FOUND_180` asserts.
    expect(Object.keys(SCENARIO[0][0])).toContain(m?.[1]);
  });

  test('🔴 the two fields inside it are the two this page reads', () => {
    const src = apiSource();
    const m = /export interface RouteDumpWater \{([\s\S]*?)\n\}/.exec(src);
    expect(m).not.toBeNull();
    // Comments out first: a `}` or a colon inside one must not be a field.
    const body = (m?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const keys = [...body.matchAll(/^\s+(\w+)\??:/gm)].map((x) => x[1]).sort();
    expect(keys).toEqual(['metres', 'radiusMetres']);
  });

  test('🔴 the kind that carries the answer is the kind this page prints it for', () => {
    const m = /export const WATER_CHECKED_KIND = '([a-z_]+)'/.exec(apiSource());
    expect(m).not.toBeNull();
    expect([...WATER_NEAR_KINDS]).toEqual([m?.[1]]);
    expect(SERVICE_KINDS as readonly string[]).toContain(m?.[1]);
  });
});
