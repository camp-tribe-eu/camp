import { execFileSync } from 'node:child_process';
import { MAP_DRAWN, waitForMapState } from '../map-ready';
import { axeViolations } from './axe';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openMapRetryingThrottle } from './open-map';
import { INITIAL_VIEW } from '@/lib/map-sources';

// CAMP-200, in a browser, because the things that matter here are only true
// of a real server's headers, a real WebGL canvas and a real network.
//
// 🔴 A CHECK MUST NOT ASSERT A PROPERTY IT CANNOT SEE. The unit specs prove
// the payload, the reader and the pixels the painter writes; they cannot
// prove that a switched-off layer sends no request, that the picture reaches
// the canvas and is in the right PLACE, or that a Content Security Policy
// lets it be drawn at all. The first version of this layer (CAMP-163, PR #84)
// passed every unit test and drew nothing: it handed MapLibre a `data:` URL,
// MapLibre fetches image sources, and `connect-src` refused it — one line in
// the console and an empty map. Everything below reads the page: the network,
// the text a reader would read, the href a reader would click, the console,
// and — for "is it drawn, and where" — the pixels.

const SHIPPED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'src', 'data', 'drought.json'), 'utf8'),
) as { meta: Record<string, unknown> & { dekad: string; classes: { value: number; label: string }[] }; cdi: string };
const DOMAIN = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'src', 'data', 'drought-domain.json'), 'utf8'),
) as { meta: { grid: Record<string, number> }; domain: string };

const NOTE = '[data-testid="drought-layer-note"]';
const MAP = '[data-testid="map"]';
const CHIP = '[data-layer="drought"]';
const FILE_URL = /\/data\/drought\.json(\?|$)/;

const DAY = 86_400_000;
const START = Date.parse(`${SHIPPED.meta.dekad}T00:00:00Z`);
/** The browser's clock, `daysOld` whole days after the shipped dekad began, at midday. */
const clockAt = (daysOld: number) => new Date(START + daysOld * DAY + 12 * 3_600_000);

/**
 * The date the panel must print for a dekad, worked out here and not by the
 * page's own function — a second, plain implementation, so a wrong label in
 * the page is a disagreement and not two copies of one mistake.
 */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const month = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ][m - 1];
  return `${d} ${month} ${y}`;
}

/** What the route serves: the grid file as committed, plus the mask's string and the mask's grid. */
const SERVED = { ...SHIPPED, domain: DOMAIN.domain, domainGrid: DOMAIN.meta.grid };

/** Serve a doctored payload in place of the real one. */
async function serveDrought(page: Page, body: unknown) {
  await page.route(FILE_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

/** Every request the page makes for the drought file, in order. */
function watchDrought(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (FILE_URL.test(r.url())) seen.push(r.url());
  });
  return seen;
}

/**
 * A grid we write ourselves, so the right answer at every place is known.
 * `cell` is the class at a latitude and longitude, `covered` is whether the
 * indicator answers there at all.
 */
function synthetic(opts: {
  lon0: number;
  lat0: number;
  pixel: number;
  width: number;
  height: number;
  cell: (lat: number, lon: number) => number;
  covered: (lat: number, lon: number) => boolean;
}) {
  const n = opts.width * opts.height;
  const cdi = new Uint8Array(n);
  const domain = new Uint8Array(Math.ceil(n / 8));
  for (let r = 0; r < opts.height; r++) {
    for (let c = 0; c < opts.width; c++) {
      const lat = opts.lat0 - (r + 0.5) * opts.pixel;
      const lon = opts.lon0 + (c + 0.5) * opts.pixel;
      const i = r * opts.width + c;
      cdi[i] = opts.cell(lat, lon);
      if (opts.covered(lat, lon)) domain[i >> 3] |= 1 << (i & 7);
    }
  }
  const grid = { width: opts.width, height: opts.height, lon0: opts.lon0, lat0: opts.lat0, pixel: opts.pixel };
  return {
    meta: { ...SHIPPED.meta, grid },
    cdi: gzipSync(Buffer.from(cdi)).toString('base64'),
    domain: gzipSync(Buffer.from(domain)).toString('base64'),
    domainGrid: grid,
  };
}

/** A grid holding one class everywhere the opening view reaches. */
const uniform = (value: number) =>
  synthetic({
    lon0: 0, lat0: 60, pixel: 0.5, width: 80, height: 60,
    cell: () => value,
    covered: () => true,
  });

/** The flat land of the stub basemap, unless a test asks for another. */
const STUB_LAND = '#e8e8e8';

/** A flat, local basemap, so the pixels are ours. See wildfire-layer.spec.ts. */
async function stubStyles(page: Page, land: string = STUB_LAND) {
  await page.route('**/styles/*', async (route) => {
    await route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': land } }],
      },
    });
  });
}

/**
 * Campsites we place ourselves; `[]` is a map with no markers. See map.spec.ts.
 * A point is `paid` unless it says what it is: the kinds are the five OSM gives
 * us (`TYPE_COLOUR` in map-palette.ts), and a test about one kind's colour has
 * to be able to ask for it.
 */
async function stubSpots(page: Page, points: { lng: number; lat: number; name: string; type?: string }[]) {
  await page.route('**/data/spots/index.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: [
        {
          country: 'HR', region: 'Fixture', slug: 'fixture', count: points.length,
          minLon: -180, minLat: -85, maxLon: 180, maxLat: 85, lon: 0, lat: 0,
        },
      ],
    }),
  );
  await page.route('**/data/spots/*/*.geojson', (route) =>
    route.fulfill({
      contentType: 'application/geo+json',
      json: {
        type: 'FeatureCollection',
        features: points.map((p, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: {
            slug: `fixture-${i}`, name: p.name, type: p.type ?? 'paid', href: '/camping',
            electricity: 'yes', water: 'unknown', shower: 'no', dogFriendly: 'unknown', wifi: 'unknown',
          },
        })),
      },
    }),
  );
}

async function skipWithoutWebGL(page: Page) {
  const ok = await page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
  test.skip(!ok, 'no WebGL2 in this browser — the map, and so the drought layer, cannot render');
}

/**
 * Open /map, retrying only when the page itself did not render (the API
 * rate-limits). Вікно повторів зв'язане ЧАСОМ — чому саме так, написано
 * в `open-map.ts`.
 */
async function openMap(page: Page, land: string = STUB_LAND) {
  await stubStyles(page, land);
  await openMapRetryingThrottle(page, { mapSelector: MAP, afterGoto: skipWithoutWebGL });
}

/** Wait until the map has stopped fetching and drawn. */
async function mapReady(page: Page) {
  await page.waitForSelector(MAP);
  // 🔴 CAMP-382: було `!== 'loading'`, і помилка в назві атрибута робила
  // це чекання порожнім — `null !== 'loading'` істинне негайно. Заміряно:
  // 309 мс і зелено, замість 20 000 мс і червоно.
  await waitForMapState(page, MAP_DRAWN, 30_000);
  await page.waitForTimeout(1500);
}

/** Switch the layer on and wait for the file to have answered. */
async function switchOn(page: Page) {
  await page.locator(CHIP).click();
  await expect(page.locator(CHIP)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(NOTE)).toBeVisible();
  await expect(page.locator(NOTE)).not.toHaveAttribute('data-state', 'loading');
  await page.waitForTimeout(1500);
}

const said = async (page: Page) => (await page.locator(NOTE).innerText()).replace(/\s+/g, ' ');

/** The four words the CEMS terms reserve, and the instructions no service of ours may give. */
const RESERVED = /\b(warning|danger|dangerous|risk|risky|alert|evacuate|evacuation|do not|don't|avoid|unsafe|stay away)s?\b/i;

/** WebKit on Linux cannot photograph a WebGL canvas reliably; see wildfire-layer.spec.ts. */
const cameraUnreliable = (browserName: string) => browserName === 'webkit' && process.platform === 'linux';

// 🔴 ПОТРІЙНИЙ БЮДЖЕТ, А НЕ АБСОЛЮТНІ 90 СЕКУНД (CAMP-304). Тут
// стояло `test.describe.configure({ timeout: 90_000 })` — число, яке
// перекривало бюджет рушія й тим скасовувало множник, виміряний для
// webkit. `test.slow()` потроює ТОЙ бюджет, що чинний для проєкту:
// chromium лишається з 90 с, webkit отримує 270. Намір автора («утричі
// більше за норму») збережено, а норма тепер залежить від браузера.
test.beforeEach(() => {
  test.slow();
});

// ── off means off ────────────────────────────────────────────────────────

test.describe('a layer that is off costs nothing', () => {
  test('🔴 by default the file is never asked for: no request at all, however long the map is open', async ({ page }) => {
    // Not "a request that is fast". There is NO request. Seen twice, so a
    // later request that the first look missed is still caught: once by the
    // network as the test sees it, and once by the browser's own resource
    // timing, which sees fetches the page itself made.
    //
    // 🔴 Mutation: delete `defaultOn: false` from the drought entry in
    // map-layers.ts — fails. Mutation: drop the `!droughtOn ||` half of the
    // guard in the fetching effect in campsite-map.tsx — fails.
    const requests = watchDrought(page);
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    // Somebody using the map: another layer off and on, another basemap.
    await page.locator('[data-layer="wildfire"]').click();
    await page.locator('[data-layer="wildfire"]').click();
    const other = page.locator('[data-source]:not([aria-pressed="true"])').first();
    await other.click();
    await page.waitForTimeout(1500);

    await expect(page.locator(CHIP), 'the switch must exist, or "off" means "not built"').toHaveCount(1);
    await expect(page.locator(CHIP)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
    await expect(page.locator(NOTE), 'a note about a layer nobody switched on is noise').toHaveCount(0);
    expect(requests, 'the drought file was requested while the layer was off').toEqual([]);
    const timed = await page.evaluate(
      () => performance.getEntriesByType('resource').filter((e) => /\/data\/drought\.json/.test(e.name)).length,
    );
    expect(timed, "the browser's own resource timing saw a request for the drought file").toBe(0);
  });

  test('switching it on asks exactly once, and off and on again does not ask twice', async ({ page }) => {
    // 🔴 Mutation: drop the `droughtAsked` guard — the second switch-on
    // fails here. Mutation: ask on every `droughtOn` change — same.
    await page.clock.setFixedTime(clockAt(27));
    const requests = watchDrought(page);
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    expect(requests).toEqual([]);

    await switchOn(page);
    expect(requests.length, 'switching on asked for the file').toBe(1);
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');

    await page.locator(CHIP).click();
    await expect(page.locator(CHIP)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
    await expect(page.locator(NOTE)).toHaveCount(0);

    await page.locator(CHIP).click();
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'current');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
    expect(requests.length, 'switching it back on asked again').toBe(1);
  });
});

// ── what the page says ───────────────────────────────────────────────────

test.describe('the note under the map', () => {
  test('says the period, shows the key, and credits Copernicus beside the data — from the file the route really serves', async ({ page }) => {
    // 🔴 The REAL route, not a stub: this is the one place the payload the
    // server sends is gunzipped by the browser's own DecompressionStream and
    // turned into a state. The clock is the test's, because a reading goes
    // "behind" once a publication is missed and a test against the committed
    // file would go red in November for no reason but the calendar.
    await page.clock.setFixedTime(clockAt(27));
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    await switchOn(page);

    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'current');
    await expect(note).toHaveAttribute('data-tone', 'quiet');
    const text = await said(page);

    expect(text).toContain(`ten-day period beginning ${dayLabel(SHIPPED.meta.dekad)}`);
    expect(text).toContain(String(SHIPPED.meta.cadenceNote));
    // The key: the file's own words for every class…
    for (const c of SHIPPED.meta.classes) expect(text, `class ${c.value}`).toContain(c.label);
    // …and what a bare place means, which must not be the same as "no drought".
    expect(text).toContain('not coloured: outside the area the indicator covers');
    // The credit, rendered, with the links a reader can follow.
    expect(text).toContain(String(SHIPPED.meta.indicator));
    expect(text).toMatch(/Read from Copernicus on \d{1,2} \w+ \d{4}/);
    expect(text).toMatch(/Contains modified Copernicus Emergency Management Service information \d{4}/);
    await expect(note.getByRole('link', { name: String(SHIPPED.meta.source) })).toHaveAttribute(
      'href',
      String(SHIPPED.meta.sourceUrl),
    );
    await expect(note.getByRole('link', { name: 'CEMS terms' })).toHaveAttribute(
      'href',
      String(SHIPPED.meta.termsUrl),
    );
    // 🔴 The words the licence reserves, read off the RENDERED page.
    expect(text).not.toMatch(RESERVED);
  });

  test('🔴 a hostile payload is refused, said in words, and the reserved word never reaches the page', async ({ page }) => {
    // The gate is in `readMeta`. A file written by an older script, or by
    // hand, must land on "no drought reading" and not print a word the CEMS
    // terms forbid beside their data.
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, {
      ...SERVED,
      meta: { ...SHIPPED.meta, cadenceNote: 'A reading this old is a risk to plan around.' },
    });
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    await switchOn(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'missing');
    const text = await said(page);
    expect(text).toContain('No drought reading');
    expect(text).not.toMatch(RESERVED);
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
  });

  test('the note has no serious accessibility violation', async ({ page }) => {
    await page.clock.setFixedTime(clockAt(27));
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    await switchOn(page);
    expect(
      await axeViolations(page, {
        tags: ['wcag2a', 'wcag2aa'],
        include: NOTE,
      }),
    ).toEqual([]);
  });

  test('🔴 nothing in the console: no policy violation, no error, while the layer draws, goes off and comes back', async ({ page }) => {
    // THE DEFECT THIS REPLACES. The first version drew through a `data:` URL
    // and the production Content Security Policy refused it. The map looked
    // fine, the panel said "drawn on the map", and the console held the only
    // evidence. Reading the console is how it was found; this keeps it found.
    // 🔴 Mutation: go back to an `image` source with `url: canvas.toDataURL()`
    // — this fails on "Refused to connect … Content Security Policy".
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 200)}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
    await page.clock.setFixedTime(clockAt(27));
    await stubSpots(page, [{ lng: INITIAL_VIEW.lng, lat: INITIAL_VIEW.lat, name: 'Fixture campsite 0' }]);
    await openMap(page);
    await mapReady(page);
    await switchOn(page);
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
    await page.locator(CHIP).click();
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
    await page.locator(CHIP).click();
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
    await page.waitForTimeout(1000);
    expect(problems).toEqual([]);
  });
});

// ── when there is nothing to draw, it says so ────────────────────────────

test.describe('a payload we cannot use is said in words, never drawn, never a blank', () => {
  const broken: [string, (page: Page) => Promise<unknown>][] = [
    ['a 500', (page) => page.route(FILE_URL, (r) => r.fulfill({ status: 500, body: 'boom' }))],
    ['a 404 from a bad deploy', (page) => page.route(FILE_URL, (r) => r.fulfill({ status: 404, body: 'gone' }))],
    ['an HTML error page served as 200', (page) => page.route(FILE_URL, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>502</html>' }))],
    ['a network failure', (page) => page.route(FILE_URL, (r) => r.abort('failed'))],
    ['a payload that is not our shape', (page) => serveDrought(page, { not: 'a drought file' })],
    ['a grid that will not gunzip', (page) => serveDrought(page, { ...SERVED, cdi: Buffer.from('plain bytes').toString('base64') })],
    ['a mask that is missing', (page) => serveDrought(page, { meta: SHIPPED.meta, cdi: SHIPPED.cdi })],
    // 🔴 The mask is there, and so is its size: it was cut from another grid
    // (rows and columns swapped — the same number of cells). The browser
    // reads the real payload through `readDroughtPayload`, so this is the one
    // place the geometry check is run in a page.
    ['a mask cut from a different grid', (page) => serveDrought(page, {
      ...SERVED,
      domainGrid: { ...DOMAIN.meta.grid, width: DOMAIN.meta.grid.height, height: DOMAIN.meta.grid.width },
    })],
    ['a mask that does not say which grid it was cut from', (page) => serveDrought(page, {
      ...SHIPPED, domain: DOMAIN.domain,
    })],
  ];
  for (const [what, arrange] of broken) {
    test(`${what} says “No drought reading” and draws nothing`, async ({ page }) => {
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(e.message.slice(0, 200)));
      await page.clock.setFixedTime(clockAt(27));
      await arrange(page);
      await stubSpots(page, []);
      await openMap(page);
      await mapReady(page);
      await switchOn(page);
      await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'missing');
      await expect(page.locator(NOTE)).toHaveAttribute('data-tone', 'gap');
      expect(await said(page)).toContain('No drought reading');
      expect(await said(page)).toContain('nothing is drawn');
      await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
      expect(problems).toEqual([]);
    });
  }

  test('a period 40 days old is still drawn, the last day inside the budget', async ({ page }) => {
    // 🔴 Mutation: `>` → `>=` in `droughtState` — this fails.
    await page.clock.setFixedTime(clockAt(40));
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    await switchOn(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'current');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
  });

  test('a period 41 days old is refused, said in words, and nothing is drawn', async ({ page }) => {
    await page.clock.setFixedTime(clockAt(41));
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    await switchOn(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'behind');
    await expect(note).toHaveAttribute('data-tone', 'gap');
    const text = await said(page);
    expect(text).toContain('No recent drought reading');
    expect(text).toContain(dayLabel(SHIPPED.meta.dekad));
    expect(text).toContain('Nothing is drawn on the map.');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
  });
});

// ── the pixels ───────────────────────────────────────────────────────────

/** RGBA at each (x, y) of a PNG, read inside the page so no decoder is needed here. */
async function pixelsOf(page: Page, png: Buffer, at: [number, number][]) {
  return page.evaluate(
    async ({ b64, at }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return at.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data));
    },
    { b64: png.toString('base64'), at },
  );
}

/** Take the cookie banner off the picture: it is fixed to the bottom of the viewport. */
async function dismissBanner(page: Page) {
  const reject = page.getByRole('button', { name: 'Reject' });
  if (await reject.count()) await reject.first().click();
  await expect(reject).toHaveCount(0);
}

// ── can the three kinds be told apart? ───────────────────────────────────
//
// 🔴 THE PIXEL TEST BELOW CHECKED THAT THE MAP DREW WHAT THE TABLE SAYS, and
// with a tolerance of 3 out of 255 it said the same thing about a class 0 at
// ΔE 7 from the bare map as about one at ΔE 45: the expected colour was
// worked out from the same table the page reads, so any table agrees with
// itself. That is a check of COMPOSITING — that alpha × raster-opacity
// reaches the screen the way the palette guard models it — and it keeps its
// name for that. It cannot say a reader can tell the three kinds apart.
//
// What can is the distance between the pixels THE BROWSER PAINTED, measured
// the way this repository measures a colour pair everywhere else
// (`scripts/ci/check-map-palette.mjs`). The thresholds are that file's and
// are read from it, below, so this cannot drift to a number of its own.

const MIN_DELTA_E = 25;

type Rgb = [number, number, number];
const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrastRatio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function lab([r, g, b]: Rgb): Rgb {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (B * 0.9505 + G * 0.1192 + R * 0.0193) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const deltaE = (a: Rgb, b: Rgb) => {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

test.describe('the colour maths the pixel checks use', () => {
  test('agrees with scripts/ci/check-map-palette.mjs at points that script was run on', () => {
    // Pinned, because this is a second implementation of that script's maths
    // and a second implementation agrees with the first only if somebody
    // checks. Black and white are the ends of both scales. The third pair is
    // the first version of class 0 (#9CC5A1 at 22.9%) over the stub basemap's
    // #E8E8E8 — measured 14.10.2026 by the script: ΔE 6.5, contrast 1.10.
    expect(deltaE([255, 255, 255], [0, 0, 0])).toBeCloseTo(100, 1);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    const old = [0, 1, 2].map((i) => Math.round(0.229412 * [0x9c, 0xc5, 0xa1][i] + (1 - 0.229412) * 232)) as Rgb;
    expect(deltaE(old, [232, 232, 232])).toBeCloseTo(6.5, 1);
    expect(contrastRatio(old, [232, 232, 232])).toBeCloseTo(1.1, 2);
  });

  test('the thresholds are the script’s own, read from it', () => {
    const script = readFileSync(join(__dirname, '..', '..', '..', '..', 'scripts', 'ci', 'check-map-palette.mjs'), 'utf8');
    expect(script).toContain(`export const MIN_DELTA_E = ${MIN_DELTA_E};`);
  });
});

test.describe('the picture', () => {
  test('🔴 it really reaches the canvas: the same map with the layer on and off differs', async ({ page, browserName }) => {
    test.skip(cameraUnreliable(browserName), 'WebKit on Linux cannot photograph a canvas — see wildfire-layer.spec.ts');
    // The words say the layer is drawn; this proves it. Class 3 everywhere,
    // so wherever the map opens there is something to see.
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, uniform(3));
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    const map = page.locator(MAP);
    const before = await map.screenshot();
    await switchOn(page);
    await expect(map).toHaveAttribute('data-drought-drawn', '1');
    const on = await map.screenshot();

    await page.locator(CHIP).click();
    await expect(map).toHaveAttribute('data-drought-drawn', '0');
    await page.waitForTimeout(1500);
    const off = await map.screenshot();

    expect(Buffer.compare(on, off) === 0, 'the map looked identical with the drought layer on and off — nothing was drawn').toBe(false);
    // And "off" is the map as it was before the layer was ever touched.
    expect(Buffer.compare(before, off) === 0, 'switching the layer off did not restore the map').toBe(true);
  });

  test('🔴 it is in the right PLACE, and bare where the indicator does not look', async ({ page, browserName }) => {
    test.skip(cameraUnreliable(browserName), 'WebKit on Linux cannot photograph a canvas — see wildfire-layer.spec.ts');
    // A checkerboard of 1° cells — class 1 where floor(lat) + floor(lon) is
    // even, class 3 where it is odd — so that both axes are tested: a picture
    // laid on the map without resampling into mercator would put the middle
    // of the grid some degrees away and every cell edge in the wrong place.
    //
    // Two more things the mask exists for:
    //  · west of 14.5°E the raster holds class 3 — the LOUDEST value — and the
    //    mask says the indicator does not look there. It must be bare.
    //  · a 2° block at 16–18°E, 44–46°N is covered and holds 0: normal
    //    conditions, which must be tinted, and not bare.
    //
    // 🔴 Both sit within about a degree and a half of the opening view's
    // centre (15.1°E), because the map is only ~380 px wide on a phone and
    // about 3.6° of longitude is all it shows there: a mask edge at 10°E
    // was on the screen on a laptop and nowhere on a Pixel 7, and the first
    // run of this test said so on `mobile-chrome` and nowhere else.
    //
    // Each pixel is turned into a latitude and longitude from the bounds the
    // map itself publishes, and the colour there is compared with what this
    // DEFINITION says is at that place — written in degrees, not in cells.
    // 🔴 Mutation: space the overlay's rows evenly in latitude — fails.
    // 🔴 Mutation: delete the mask line from `readingAt` — the west part of
    // the map turns brown and this fails.
    const inBlock = (lat: number, lon: number) => lon >= 16 && lon < 18 && lat >= 44 && lat < 46;
    const grid = synthetic({
      lon0: 6, lat0: 50, pixel: 0.25, width: 72, height: 40,
      cell: (lat, lon) => (lon < 14.5 ? 3 : inBlock(lat, lon) ? 0 : (Math.floor(lat) + Math.floor(lon)) % 2 === 0 ? 1 : 3),
      covered: (_lat, lon) => lon >= 14.5,
    });
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, grid);
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    await dismissBanner(page);
    await switchOn(page);
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
    await expect.poll(async () => await page.locator(MAP).getAttribute('data-bounds')).not.toBeNull();
    await page.locator(MAP).scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    const map = page.locator(MAP);
    const [west, south, east, northB] = (await map.getAttribute('data-bounds'))!.split(',').map(Number);
    const box = (await map.boundingBox())!;
    const yOf = (lat: number) => Math.asinh(Math.tan((lat * Math.PI) / 180));
    const latAt = (y: number) => (Math.atan(Math.sinh(yOf(northB) - (y / box.height) * (yOf(northB) - yOf(south)))) * 180) / Math.PI;
    const lonAt = (x: number) => west + (x / box.width) * (east - west);

    // Only look at pixels well away from a cell edge: the overlay is rows of
    // about 1.5 km, and a pixel on the edge of a degree is a coin toss.
    const away = (v: number) => Math.abs(v - Math.round(v)) > 0.08;
    const BASE = 232;
    const blend = (hex: string, alpha: number): number[] => {
      const eff = (0.76 * alpha) / 255;
      return [0, 2, 4].map((i) => Math.round(eff * parseInt(hex.slice(1 + i, 3 + i), 16) + (1 - eff) * BASE));
    };
    const want = (lat: number, lon: number) => {
      if (lon < 14.5) return { name: 'bare', rgb: [BASE, BASE, BASE] };
      if (inBlock(lat, lon)) return { name: 'class 0, tinted', rgb: blend('#9CFE84', 255) };
      return (Math.floor(lat) + Math.floor(lon)) % 2 === 0
        ? { name: 'class 1', rgb: blend('#F0E442', 255) }
        : { name: 'class 3', rgb: blend('#DC050C', 255) };
    };

    const spots: { at: [number, number]; name: string; rgb: number[] }[] = [];
    // …and away from the map's own controls: the zoom buttons at the top
    // right and the attribution strip along the bottom.
    for (let y = 30; y < box.height - 45; y += 17) {
      for (let x = 30; x < box.width - 30; x += 23) {
        if (x > box.width - 80 && y < 100) continue;
        const lat = latAt(y);
        const lon = lonAt(x);
        if (!away(lat) || !away(lon) || Math.abs(lon - 14.5) < 0.08) continue;
        spots.push({ at: [x, y], ...want(lat, lon) });
      }
    }
    expect(spots.length, 'too few pixels to say anything').toBeGreaterThan(40);
    // The three things under test are each actually on the screen.
    for (const name of ['bare', 'class 0, tinted', 'class 1', 'class 3']) {
      expect(spots.some((s) => s.name === name), `no sampled pixel falls on "${name}" — the view moved`).toBe(true);
    }

    const shot = await map.screenshot();
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const read = await pixelsOf(page, shot, spots.map((s) => [s.at[0] * dpr, s.at[1] * dpr]));
    const wrong: string[] = [];
    spots.forEach((s, i) => {
      const got = read[i];
      // 🔴 COMPOSITING, NOT LEGIBILITY. This says the browser laid each class
      // on the map at the strength the table and the layer's raster-opacity
      // give it. 3 out of 255 is measured: over 674–714 sampled pixels the
      // worst deviation from the blend computed above was 0 in Chromium and 1
      // in Firefox and WebKit. It is NOT a statement that the kinds read
      // apart — a tolerance of 3 is as green at ΔE 7 as at ΔE 45. That is the
      // next block's.
      if (Math.max(...s.rgb.map((v, k) => Math.abs(v - got[k]))) > 3) {
        wrong.push(`(${s.at}) lat ${latAt(s.at[1]).toFixed(2)} lon ${lonAt(s.at[0]).toFixed(2)}: wanted ${s.name} ${s.rgb}, got ${got.slice(0, 3)}`);
      }
    });
    expect(wrong.slice(0, 5), `${wrong.length} of ${spots.length} pixels were the wrong colour`).toEqual([]);

    // 🔴 CAN THE KINDS BE TOLD APART — from the pixels the browser painted,
    // not from the table. "Covered, and fine" must not read as "not covered"
    // (bare), nor as the drought classes beside it: that is the distinction
    // this card exists to make. Measured on the stub basemap's flat #E8E8E8,
    // the one surface this test controls; the same question over every
    // basemap colour we serve is `scripts/ci/check-map-palette.mjs`'s.
    //
    // Mutation: move class 0 back to `#9CC5A1` at alpha 90 in
    // `lib/drought-colours.ts` AND change the literal in `want()` above to
    // match — the compositing check stays green, as it must, and this fails
    // on ΔE 6.5.
    const pixelOf = (name: string): Rgb => {
      const i = spots.findIndex((s) => s.name === name);
      return read[i].slice(0, 3) as Rgb;
    };
    const bare = pixelOf('bare');
    const zero = pixelOf('class 0, tinted');
    const one = pixelOf('class 1');
    const three = pixelOf('class 3');
    expect(deltaE(zero, bare), 'class 0 against the bare map, ΔE').toBeGreaterThanOrEqual(MIN_DELTA_E);
    expect(deltaE(zero, one), 'class 0 against class 1, ΔE').toBeGreaterThanOrEqual(MIN_DELTA_E);
    expect(deltaE(zero, three), 'class 0 against class 3, ΔE').toBeGreaterThanOrEqual(MIN_DELTA_E);

    // 🔴 THERE IS NO "SCALE RUNS THE RIGHT WAY ROUND" CHECK HERE ANY MORE. This
    // block used to assert, in the pixels, that class 0 is lighter than class 1 and
    // class 1 lighter than class 3 — a rule about OUR ladder (CAMP-200: an earlier
    // version made "no drought" the darkest thing on the map). CAMP-315, owner,
    // 14.10.2026: the series is EDO's now, so what it looks like is the source's
    // to say, and a test that pinned our order would fail, for the wrong reason,
    // the day EDO changes a colour. It happens to hold today (over #E8E8E8 the
    // luminances are 0.79, 0.75 and 0.19) and is no longer a requirement.
    //
    // 🔴 AND THE KEY READS WHAT THE MAP PAINTS. Each swatch's colour is read
    // off the page as the browser computed it, laid on the same flat colour
    // the stub basemap is, and compared with the pixel the canvas really
    // holds for that class — a key shown at a strength the picture does not
    // have is a key that explains nothing. (The unit spec compares the
    // swatch with what the painter writes; this is the end of that chain, in
    // a real browser, with `raster-opacity` applied by WebGL.)
    //
    // Mutation: paint the swatch with `row.hex` instead of `row.swatch` in
    // drought-layer-panel.tsx — class 0's key becomes a strong dark green
    // beside a pixel of the same green at 65%… and for any class drawn at
    // under full strength, fails here.
    const swatches = await page.locator('[data-testid="drought-legend"] li').evaluateAll((lis) =>
      lis.map((li) => ({
        label: (li.textContent ?? '').replace(/\s+/g, ' ').trim(),
        css: li.querySelector('[data-swatch]') ? getComputedStyle(li.querySelector('[data-swatch]')!).backgroundColor : null,
      })),
    );
    for (const [label, pixel] of [
      ['no drought', zero],
      ['less rain than normal', one],
      ['vegetation under stress', three],
    ] as [string, Rgb][]) {
      const row = swatches.find((r) => r.css && r.label.includes(label));
      expect(row, `no legend row for “${label}”`).toBeTruthy();
      const m = row!.css!.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)!;
      const a = m[4] === undefined ? 1 : Number(m[4]);
      const shown = [1, 2, 3].map((k) => Math.round(a * Number(m[k]) + (1 - a) * BASE));
      expect(
        Math.max(...shown.map((v, k) => Math.abs(v - pixel[k]))),
        `“${label}”: the swatch over #E8E8E8 is ${shown}, the map paints ${pixel}`,
      ).toBeLessThanOrEqual(3);
    }
  });

  test('🔴 switching the basemap does not take the picture with it', async ({ page, browserName }) => {
    test.skip(cameraUnreliable(browserName), 'WebKit on Linux cannot photograph a canvas — see wildfire-layer.spec.ts');
    // `setStyle` discards every source and layer, so the picture has to be put
    // back on each `styledata` — the same defect the fire layer's history
    // records ("the layer silently emptied itself the first time a reader
    // changed the basemap"), and one that leaves the panel saying the layer is
    // on over a map that shows nothing.
    // 🔴 Mutation: delete the `attachDrought(...)` call from `attach` in
    // campsite-map.tsx — this fails, on the flag and on the pixels.
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, uniform(3));
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    await switchOn(page);
    const map = page.locator(MAP);
    await expect(map).toHaveAttribute('data-drought-drawn', '1');

    const other = page.locator('[data-source]:not([aria-pressed="true"])').first();
    const id = await other.getAttribute('data-source');
    await other.click();
    await expect(map).toHaveAttribute('data-active-source', id!);
    await page.waitForTimeout(1500);
    await expect(map).toHaveAttribute('data-drought-drawn', '1');
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'current');
    const on = await map.screenshot();

    await page.locator(CHIP).click();
    await expect(map).toHaveAttribute('data-drought-drawn', '0');
    await page.waitForTimeout(1500);
    const off = await map.screenshot();
    expect(Buffer.compare(on, off) === 0, 'after a basemap change the drought layer was on and drew nothing').toBe(false);
  });

  test('a stale period leaves nothing on the canvas', async ({ page, browserName }) => {
    test.skip(cameraUnreliable(browserName), 'WebKit on Linux cannot photograph a canvas — see wildfire-layer.spec.ts');
    // The words say nothing is drawn; this proves it. Photographed against
    // the same page with the layer switched off by hand.
    await page.clock.setFixedTime(clockAt(60));
    await serveDrought(page, uniform(3));
    await stubSpots(page, []);
    await openMap(page);
    await mapReady(page);
    await switchOn(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'behind');
    const map = page.locator(MAP);
    const stale = await map.screenshot();
    await page.locator(CHIP).click();
    await expect(page.locator(CHIP)).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(1500);
    const off = await map.screenshot();
    expect(Buffer.compare(stale, off) === 0, 'a stale period changed the canvas — it was drawn').toBe(true);
  });
});

// ── CAMP-319: a marker's FILL over the Alert class, on the pixels ─────────
//
// `check-map-palette.mjs` says that a `wild` marker's fill and the pixel the
// drought layer paints under it are, over the Alert class (3), almost one
// colour — `fillOnlyOnPixel()`: ΔE 6.9 on the worst basemap surface, against a
// floor of 25 — and that the marker is carried by its dark ring alone. That
// number is ARITHMETIC: a fill hex and a blend, both worked out in a script.
// This is the only place it is held against what a browser PAINTS: the
// marker's own pixels against the layer's, on a canvas.
//
// 🔴 IT PINS A KNOWN BAD STATE, ON PURPOSE. It does not say the markers are
// fine. It says they are exactly as bad as the guard says, and that the
// guard's arithmetic is the picture's. The day someone fixes the markers (a
// lighter `wild`, a ring that cuts the fill off, a halo) it goes red and says
// so; the answer is to close CAMP-319 and rewrite this, not to widen it.
//
// 🔴 THE EXPECTATION IS WORKED OUT BY THE GUARD, IN ITS OWN PROCESS, NOT BY
// THIS FILE. "The colour maths the pixel checks use" above is a second
// implementation of ΔE; using it for the expected value as well would make the
// test agree with itself. The browser supplies the measurement, the guard
// supplies the expectation, and they share nothing but the palette both are
// asked about.
//
// 🔴 THE WORST CASE IS REPRODUCED, NOT HUNTED FOR. The guard's worst pair is
// `wild` over class 3 on `liberty.trunk`; the stub basemap is one flat colour,
// so it is given that colour for the test, and the layer over it is exactly
// the pixel the guard computes. (`ci-seed.sql` is not touched for this:
// `check-fixture-counts.mjs` holds its 72 campsites, 37 and 35 by country, and
// /map prints them — a test makes the case reproducible for less.)
//
// 🔴 WHAT THE AGREEMENT CANNOT CATCH, AND IS NOT CLAIMED TO: a change to the
// palette itself (`TYPE_COLOUR.wild`, `DROUGHT_COLOURS[3]`) moves the guard's
// number and the painted pixel together, so the agreement stays green. That is
// the second assertion's — the pair must still be one the guard reports as
// merged — and what the first catches is the page painting something other
// than the palette the guard measured.
const GUARD = join(__dirname, '..', '..', '..', '..', 'scripts', 'ci', 'check-map-palette.mjs');

type GuardRow = { klass: number; marker: string; where: string; pixel: string; contrast: number; deltaE: number; bg: string };

/**
 * Every (`wild`, class 3) pair the guard measures, worst first — one per
 * basemap surface it knows, plus the stub's flat land — and the fill the guard
 * holds for `wild`. Asked of the guard in a child process, started the way CI
 * starts it (`--experimental-strip-types`), so the numbers are the guard's.
 */
function guardWildOverAlert(): { rows: GuardRow[]; fill: string | null } {
  const source = `
    import { fillOnlyOnPixel, everyFill, BASEMAP } from ${JSON.stringify(pathToFileURL(GUARD).href)};
    const land = { ...BASEMAP, stub: ${JSON.stringify(STUB_LAND)} };
    const rows = fillOnlyOnPixel(undefined, undefined, land)
      .filter((r) => r.marker === 'wild' && r.klass === 3)
      .map((r) => ({ ...r, bg: land[r.where] }));
    const fill = everyFill().find(([name]) => name === 'wild');
    console.log(JSON.stringify({ rows, fill: fill ? fill[1] : null }));
  `;
  const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', source], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

/**
 * 🔴 THE TOLERANCE: 1.7 ΔE, AND WHERE IT COMES FROM.
 *
 * It is the error of the instrument, and nothing else. The browser composites
 * the layer at `raster-opacity` on the GPU and the guard rounds the same blend
 * to whole 8-bit channels; "it is in the right PLACE" above found the two
 * apart by at most 1 out of 255 in a channel (0 in Chromium, 1 in Firefox and
 * WebKit, on the runners that file was written on). ΔE is steep here — marker
 * and layer are both near red — so one step matters: the worst ΔE moves when
 * every one of the six channels (the marker's pixel AND the layer's) is off by
 * one is 1.49 on the guard's worst surface and 1.64 on the stub's land, found
 * by trying all 3⁶ = 729 combinations. 1.64 rounded up to a tenth is 1.7, and
 * the test below recomputes that, so the number cannot drift from its reason.
 *
 * On the machine this was written on (macOS, Chromium, Firefox and WebKit,
 * device pixel ratios 1, 2 and 2.625) the browser and the guard agreed to the
 * third decimal — the marker painted exactly its fill, the layer exactly the
 * guard's blend — so the tolerance is headroom for other GPUs, not a
 * correction for this one.
 *
 * 🔴 WHAT 1.7 DOES NOT SEPARATE: a marker drawn at 90% opacity reads about
 * 0.7 ΔE from the guard's number here, inside the tolerance. What it does
 * separate is a different colour: white reads 91, `paid` 40.
 */
const PIXEL_TOLERANCE = 1.7;

/** The middle value of each channel over a block of RGBA readings. */
function medianPixel(block: number[][]): Rgb {
  return [0, 1, 2].map((k) => {
    const v = block.map((p) => p[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  }) as Rgb;
}

test.describe('a marker’s fill over the Alert class (CAMP-319)', () => {
  test('the tolerance is the instrument’s own: one 8-bit step in every channel of both pixels, rounded up to a tenth', () => {
    // Worked out here from the guard's own pairs, so a palette that moves the
    // pairs moves the number and this says so, instead of a comment going stale.
    const { rows, fill } = guardWildOverAlert();
    expect(fill, 'the guard holds no fill for wild').toBeTruthy();
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
    const pairs = [rows[0], rows.find((r) => r.where === 'stub')];
    let worst = 0;
    for (const pair of pairs) {
      expect(pair, 'a pair the tests below use is missing from the guard').toBeTruthy();
      const a = rgb(fill!);
      const b = rgb(pair!.pixel);
      const exact = deltaE(a, b);
      for (let m = 0; m < 3 ** 6; m++) {
        let k = m;
        const off = Array.from({ length: 6 }, () => {
          const d = (k % 3) - 1;
          k = Math.floor(k / 3);
          return d;
        });
        const moved = deltaE(a.map((v, i) => v + off[i]) as Rgb, b.map((v, i) => v + off[3 + i]) as Rgb);
        worst = Math.max(worst, Math.abs(moved - exact));
      }
    }
    expect(worst, 'one step moved nothing: the sweep did not run').toBeGreaterThan(1);
    expect(
      PIXEL_TOLERANCE,
      `one 8-bit step in every channel now moves ΔE by up to ${worst.toFixed(3)}, so the tolerance should be ${Math.ceil(worst * 10) / 10}. ` +
        `The guard's pairs moved (the markers or the layer palette changed): if CAMP-319 is being closed, this goes with the other assertions; ` +
        `if not, set the tolerance to that figure — and not to anything wider`,
    ).toBe(Math.ceil(worst * 10) / 10);
  });

  for (const surface of ['worst', 'stub'] as const) {
    test(`🔴 wild over class 3 on ${surface === 'worst' ? 'the surface the guard calls the worst' : 'the stub basemap’s own land'}: the ΔE the guard computes is the ΔE the browser painted`, async ({ page, browserName }) => {
      test.skip(cameraUnreliable(browserName), 'WebKit on Linux cannot photograph a canvas — see wildfire-layer.spec.ts');
      const { rows, fill } = guardWildOverAlert();
      expect(rows.length, 'the guard measures no (wild, class 3) pair — there is nothing to hold the picture to').toBeGreaterThan(1);
      const want = surface === 'worst' ? rows[0] : rows.find((r) => r.where === 'stub');
      expect(want, 'the guard has no row for the stub basemap').toBeTruthy();
      const pair = want!;

      // Class 3 everywhere the map opens, one `wild` marker at the middle of
      // the opening view, and the guard's own surface as the flat land under it.
      await page.clock.setFixedTime(clockAt(27));
      await serveDrought(page, uniform(3));
      await stubSpots(page, [{ lng: INITIAL_VIEW.lng, lat: INITIAL_VIEW.lat, name: 'Fixture campsite 0', type: 'wild' }]);
      await openMap(page, pair.bg);
      await mapReady(page);
      await dismissBanner(page);
      await switchOn(page);
      const map = page.locator(MAP);
      await expect(map).toHaveAttribute('data-drought-drawn', '1');
      // 🔴 THE MARKER IS ON THE CANVAS — MapLibre's own count of the campsites
      // it painted, and where. An empty map has to fail here, in words, and
      // not reach a comparison that would have nothing to compare.
      await expect(map, 'the map painted no campsite marker: there is nothing to measure').toHaveAttribute('data-visible-points', '1');
      await expect.poll(async () => await map.getAttribute('data-point-at'), { message: 'the map did not say where the marker is' }).not.toBeNull();
      await expect(map).toHaveAttribute('data-camera', 'still');
      await map.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);

      const [mx, my] = (await map.getAttribute('data-point-at'))!.split(',').map(Number);
      const shot = await map.screenshot();
      const dpr = await page.evaluate(() => window.devicePixelRatio);

      // 🔴 THE MEDIAN OF A 5 × 5 BLOCK OF DEVICE PIXELS, not one pixel. The
      // marker's centre is published rounded to a CSS pixel, the screenshot is
      // in device pixels (2.625 per CSS pixel on the Pixel 7), and the fill's
      // edge is anti-aliased: one pixel could be the ring's. The block is 2
      // device pixels either side of the centre — inside the fill, whose
      // radius is 4.5 CSS pixels at the opening zoom less half the 1.5 px ring
      // (about 3.8) — and the median shrugs off the four corners if the
      // anti-aliasing reaches them. The layer-only pixel is the same block 30
      // CSS pixels to the left, well clear of the ring; the right-hand one is
      // there to say the layer is uniform and nothing else is in the way.
      const HALF = 2;
      const sites: [string, number, number][] = [['marker', mx, my], ['left', mx - 30, my], ['right', mx + 30, my]];
      const blockAt = (x: number, y: number): [number, number][] => {
        const out: [number, number][] = [];
        for (let dy = -HALF; dy <= HALF; dy++)
          for (let dx = -HALF; dx <= HALF; dx++) out.push([Math.round(x * dpr) + dx, Math.round(y * dpr) + dy]);
        return out;
      };
      const per = (2 * HALF + 1) ** 2;
      const read = await pixelsOf(page, shot, sites.flatMap(([, x, y]) => blockAt(x, y)));
      const [markerPx, leftPx, rightPx] = sites.map((_, i) => medianPixel(read.slice(i * per, (i + 1) * per)));

      expect(
        Math.max(...leftPx.map((v, k) => Math.abs(v - rightPx[k]))),
        `the layer is not uniform either side of the marker: ${leftPx} against ${rightPx}`,
      ).toBeLessThanOrEqual(1);

      const measured = deltaE(markerPx, leftPx);
      test.info().annotations.push({
        type: 'camp-319',
        description: `${pair.where} ${pair.bg}: marker ${markerPx} on layer ${leftPx}: measured ΔE ${measured.toFixed(3)}, guard ΔE ${pair.deltaE.toFixed(3)} (fill ${fill}, pixel ${pair.pixel}), dpr ${dpr}`,
      });
      expect(
        Math.abs(measured - pair.deltaE),
        `wild over class 3 on ${pair.where} ${pair.bg}: the browser painted the marker as ${markerPx} on a layer pixel of ${leftPx}, ΔE ${measured.toFixed(2)}; ` +
          `the guard computes ΔE ${pair.deltaE.toFixed(2)} for the fill ${fill} on the pixel ${pair.pixel}`,
      ).toBeLessThanOrEqual(PIXEL_TOLERANCE);

      // 🔴 THE KNOWN STATE. Both numbers — the guard's and the picture's — are
      // under the floor, so a marker's fill and the layer under it read as one
      // colour. When this fails the markers were fixed: close CAMP-319.
      expect(
        pair.deltaE,
        `the guard no longer reports a wild marker as merging with class 3 on ${pair.where} (ΔE ${pair.deltaE.toFixed(1)}, floor ${MIN_DELTA_E}): ` +
          `the markers were changed — update CAMP-319, and rewrite or delete this test`,
      ).toBeLessThan(MIN_DELTA_E);
      expect(measured, `the browser paints a wild marker apart from class 3 (ΔE ${measured.toFixed(1)}, floor ${MIN_DELTA_E}): CAMP-319 is fixed`).toBeLessThan(MIN_DELTA_E);
    });
  }
});
