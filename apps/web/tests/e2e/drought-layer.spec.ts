import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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

/** A flat, local basemap, so the pixels are ours. See wildfire-layer.spec.ts. */
async function stubStyles(page: Page) {
  await page.route('**/styles/*', async (route) => {
    await route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e8e8' } }],
      },
    });
  });
}

/** Campsites we place ourselves; `[]` is a map with no markers. See map.spec.ts. */
async function stubSpots(page: Page, points: { lng: number; lat: number; name: string }[]) {
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
            slug: `fixture-${i}`, name: p.name, type: 'paid', href: '/camping',
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

/** Open /map, retrying only when the page itself did not render (the API rate-limits). */
async function openMap(page: Page) {
  await stubStyles(page);
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    if ((await page.locator(MAP).count()) > 0) return;
    if ((await page.getByText('This page did not load properly').count()) === 0) return;
    await page.waitForTimeout(3000 * (attempt + 1));
  }
  throw new Error('/map never rendered: the API kept refusing the region index');
}

/** Wait until the map has stopped fetching and drawn. */
async function mapReady(page: Page) {
  await page.waitForSelector(MAP);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map"]')?.getAttribute('data-map-state') !== 'loading',
    undefined,
    { timeout: 30_000 },
  );
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

test.describe.configure({ timeout: 90_000 });

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
    const result = await new AxeBuilder({ page })
      .include(NOTE)
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
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

const MIN_CONTRAST = 3;
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
    expect(script).toContain(`export const MIN_CONTRAST = ${MIN_CONTRAST};`);
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
      const eff = (0.65 * alpha) / 255;
      return [0, 2, 4].map((i) => Math.round(eff * parseInt(hex.slice(1 + i, 3 + i), 16) + (1 - eff) * BASE));
    };
    const want = (lat: number, lon: number) => {
      if (lon < 14.5) return { name: 'bare', rgb: [BASE, BASE, BASE] };
      if (inBlock(lat, lon)) return { name: 'class 0, tinted', rgb: blend('#1C4418', 255) };
      return (Math.floor(lat) + Math.floor(lon)) % 2 === 0
        ? { name: 'class 1', rgb: blend('#F2D98A', 255) }
        : { name: 'class 3', rgb: blend('#A5541B', 255) };
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
    // on ΔE 6.5 and 1.10:1.
    const pixelOf = (name: string): Rgb => {
      const i = spots.findIndex((s) => s.name === name);
      return read[i].slice(0, 3) as Rgb;
    };
    const bare = pixelOf('bare');
    const zero = pixelOf('class 0, tinted');
    const one = pixelOf('class 1');
    const three = pixelOf('class 3');
    expect(deltaE(zero, bare), 'class 0 against the bare map, ΔE').toBeGreaterThanOrEqual(MIN_DELTA_E);
    expect(contrastRatio(zero, bare), 'class 0 against the bare map, contrast').toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(deltaE(zero, one), 'class 0 against class 1, ΔE').toBeGreaterThanOrEqual(MIN_DELTA_E);
    expect(deltaE(zero, three), 'class 0 against class 3, ΔE').toBeGreaterThanOrEqual(MIN_DELTA_E);

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
