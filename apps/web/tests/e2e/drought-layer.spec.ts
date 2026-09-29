import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { INITIAL_VIEW } from '@/lib/map-sources';

// CAMP-163, in a browser, because the things that matter here are only true
// of a real server's headers and a real WebGL canvas.
//
// 🔴 A CHECK MUST NOT ASSERT A PROPERTY IT CANNOT SEE. The unit specs prove
// the sentences and the sampler; they cannot prove the picture reaches the
// canvas, that it is in the right PLACE, or that a Content Security Policy
// lets it be drawn at all. The first version of this layer passed every unit
// test and drew nothing: it handed MapLibre a `data:` URL, MapLibre fetches
// image sources, and `connect-src` refused it — one line in the console and
// an empty map. Everything below reads the page: the text a reader would
// read, the href a reader would click, the console, and — for "is it drawn,
// and where" — the pixels.

const SHIPPED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'src', 'data', 'drought.json'), 'utf8'),
) as { meta: Record<string, string>; grid: Record<string, unknown> };

const NOTE = '[data-testid="drought-note"]';
const MAP = '[data-testid="map"]';

const DAY = 86_400_000;
const START = Date.parse(`${SHIPPED.meta.dekad}T00:00:00Z`);
/** The browser's clock, `daysOld` whole days after the shipped dekad began, at midday. */
const clockAt = (daysOld: number) => new Date(START + daysOld * DAY + 12 * 3_600_000);

/**
 * The period the shipped dekad names, worked out here from the date and not
 * by the page's own function — a second, plain implementation, so a wrong
 * label in the page is a disagreement and not two copies of one mistake.
 */
function periodLabel(dekad: string): string {
  const [y, m, d] = dekad.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = d === 1 ? 10 : d === 11 ? 20 : last;
  const month = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ][m - 1];
  return `${d}–${end} ${month} ${y}`;
}

/** The shipped file, with `fetchedAt` six hours before the browser's clock. */
const shippedAt = (
  daysOld: number,
  meta: Record<string, unknown> = {},
  grid: unknown = SHIPPED.grid,
) => ({
  meta: {
    ...SHIPPED.meta,
    fetchedAt: new Date(clockAt(daysOld).getTime() - 6 * 3_600_000).toISOString(),
    ...meta,
  },
  grid,
});

/** A 1 824 × 1 200 grid holding one value everywhere. */
const uniform = (value: number) => ({
  ...SHIPPED.grid,
  rows: Array.from({ length: 1200 }, () => `${value}:1824`),
});

async function serveDrought(page: Page, body: unknown | null, status = 200) {
  await page.route('**/data/drought.json', async (route) => {
    if (body === null) {
      await route.fulfill({ status, contentType: 'text/html', body: '<html>502</html>' });
      return;
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

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
  test.skip(!ok, 'no WebGL2 in this browser — the map, and so the drought note, cannot render');
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

/** Wait until the layer has answered and the map has stopped fetching. */
async function settle(page: Page) {
  await expect(page.locator(NOTE)).toBeVisible();
  await expect(page.locator(NOTE)).not.toHaveAttribute('data-state', 'loading');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map"]')?.getAttribute('data-map-state') !== 'loading',
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1500);
}

const said = async (page: Page) => (await page.locator(NOTE).innerText()).replace(/\s+/g, ' ');

/** The four words the CEMS terms reserve, and the instructions no service of ours may give. */
const RESERVED = /\b(warning|danger|dangerous|risk|risky|alert|evacuate|evacuation|do not|don't|avoid|unsafe|stay away)s?\b/i;

/** WebKit on Linux cannot photograph a WebGL canvas reliably; see wildfire-layer.spec.ts. */
const cameraUnreliable = (browserName: string) => browserName === 'webkit' && process.platform === 'linux';

test.describe.configure({ timeout: 90_000 });

test.describe('the drought layer', () => {
  test('says the period, calls its age normal, credits Copernicus, and links the terms — on the page', async ({ page }) => {
    // 🔴 The card's own case: the shipped period, read 27 days after it began.
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, shippedAt(27));
    await openMap(page);
    await settle(page);

    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'fresh');
    await expect(note).toHaveAttribute('data-dekad', SHIPPED.meta.dekad);
    await expect(note).toHaveAttribute('data-days-old', '27');
    const text = await said(page);

    expect(text).toContain(`Combined Drought Indicator for ${periodLabel(SHIPPED.meta.dekad)}`);
    // 🔴 27 days is what a healthy service looks like, and the page says so
    // instead of leaving the reader to wonder whether it is broken.
    expect(text).toContain('That period began 27 days ago');
    expect(text).toContain('an age of up to 40 days is normal for it');
    expect(text).not.toMatch(/no fresh/i);
    // The credit, rendered, beside the data, with the year — and the links.
    expect(text).toMatch(/Contains modified Copernicus Emergency Management Service information \d{4}/);
    expect(text).toContain('© European Union');
    expect(text).toContain(`read from Copernicus on`);
    await expect(note.getByRole('link', { name: /Copernicus European Drought Observatory/ })).toHaveAttribute(
      'href',
      SHIPPED.meta.sourceUrl,
    );
    await expect(note.getByRole('link', { name: /CEMS terms/ })).toHaveAttribute('href', SHIPPED.meta.termsUrl);
    // The legend, and the sentence that says what an undrawn cell is.
    for (const label of ['Drought class 1 of 3, the lowest', 'Drought class 3 of 3, the highest', 'Recovering after drought']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Not drawn: no class recorded, which is not the same as no drought');
    // …and whose decision it is.
    expect(text).toContain('national and regional services are authorised');
    expect(text).not.toMatch(RESERVED);
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
  });

  test('🔴 nothing in the console: no policy violation, no error, while the layer draws', async ({ page }) => {
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
    await serveDrought(page, shippedAt(27));
    await stubSpots(page, [{ lng: INITIAL_VIEW.lng, lat: INITIAL_VIEW.lat, name: 'Fixture campsite 0' }]);
    await openMap(page);
    await settle(page);
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
    expect(problems).toEqual([]);
  });

  test('a period 40 days old is still drawn, the last day inside the budget', async ({ page }) => {
    // 🔴 Mutation: `>` → `>=` in `droughtState` — this fails.
    await page.clock.setFixedTime(clockAt(40));
    await serveDrought(page, shippedAt(40));
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'fresh');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
  });

  test('a period 41 days old is refused, said in words, and nothing is drawn', async ({ page }) => {
    await page.clock.setFixedTime(clockAt(41));
    await serveDrought(page, shippedAt(41));
    await openMap(page);
    await settle(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'stale');
    const text = await said(page);
    expect(text).toContain('No fresh drought data');
    expect(text).toContain('began on');
    expect(text).toContain('41 days ago, past our 40-day budget');
    expect(text).toContain('not a statement that no drought has been recorded');
    // Its OWN words, and none of the failed load's.
    expect(text).not.toContain('could not load');
    // No data on screen, so no colours and no credit for data.
    expect(text).not.toContain('Drought class 1 of 3');
    expect(text).not.toContain('Contains modified');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
  });

  test('🔴 the loading sentence is on the page, not merely a state name', async ({ page }) => {
    // An empty map while the file is in flight and an empty map because it
    // failed are the same picture; only the sentence tells them apart.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.clock.setFixedTime(clockAt(27));
    await page.route('**/data/drought.json', async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shippedAt(27)) });
    });
    await openMap(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'loading');
    const waiting = await said(page);
    expect(waiting).toContain('Loading the Copernicus EDO drought layer');
    expect(waiting).toContain('still fetching');
    expect(waiting).not.toContain('No fresh drought data');
    release();
    await expect(note).toHaveAttribute('data-state', 'fresh');
  });

  for (const [what, serve] of [
    ['a 500 from our own file', (page: Page) => serveDrought(page, {}, 500)],
    ['an HTML page served in its place', (page: Page) => serveDrought(page, null, 200)],
    ['a file with the credit stripped', (page: Page) => serveDrought(page, shippedAt(27, { attribution: '' }))],
    ['a file that says it is smand', (page: Page) => serveDrought(page, shippedAt(27, { coverage: 'smand' }))],
    ['a file that says it is cdinx', (page: Page) => serveDrought(page, shippedAt(27, { coverage: 'cdinx' }))],
    [
      'a file whose note speaks with a national service’s authority',
      (page: Page) => serveDrought(page, shippedAt(27, { authorityNote: 'An official drought warning: severe risk, evacuate.' })),
    ],
  ] as const) {
    test(`${what} says “no fresh data”, never nothing, and draws nothing`, async ({ page }) => {
      await page.clock.setFixedTime(clockAt(27));
      await serve(page);
      await openMap(page);
      await settle(page);
      await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'missing');
      const text = await said(page);
      expect(text).toContain('No fresh drought data');
      expect(text).toContain('could not load the Copernicus EDO layer');
      expect(text).toContain('not a statement that no drought has been recorded');
      expect(text).not.toMatch(RESERVED);
      await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
    });
  }

  test('switched off, the layer says it is the control and not an all-clear — and switching back on draws', async ({ page }) => {
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, shippedAt(27));
    await openMap(page);
    await settle(page);
    await page.locator('[data-layer="drought"]').click();
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'off');
    const off = await said(page);
    expect(off).toContain('switched off');
    expect(off).toContain('not an all-clear');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '0');
    await page.locator('[data-layer="drought"]').click();
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'fresh');
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
  });

  test('the switch says none of the four words, in its label or its tooltip', async ({ page }) => {
    await openMap(page);
    const chip = page.locator('[data-layer="drought"]');
    await expect(chip).toHaveText('Drought');
    expect((await chip.getAttribute('title')) ?? '').not.toMatch(RESERVED);
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

// ── the campsite the reader picks ────────────────────────────────────────

test.describe('the class at the campsite, in the panel', () => {
  const CENTRE = { lng: INITIAL_VIEW.lng, lat: INITIAL_VIEW.lat };

  async function pick(page: Page, name: string) {
    await stubSpots(page, [{ ...CENTRE, name }]);
    await openMap(page);
    await settle(page);
    await expect
      .poll(async () => await page.locator(MAP).getAttribute('data-point-at'), { timeout: 20_000 })
      .not.toBeNull();
    await page.locator(MAP).scrollIntoViewIfNeeded();
    const box = (await page.locator(MAP).boundingBox())!;
    const [x, y] = (await page.locator(MAP).getAttribute('data-point-at'))!.split(',').map(Number);
    await page.mouse.click(box.x + x, box.y + y);
    await expect(page.locator('.maplibregl-popup-content')).toBeVisible();
  }

  test('🔴 a click names the class at THAT campsite, and closing the card takes it away', async ({ page }) => {
    // The whole grid holds class 2, so which campsite is clicked and where the
    // map is looking cannot change the answer: what this proves is that the
    // click reaches the panel, and that closing the card clears it.
    // 🔴 Mutation: delete `setPicked` from `onPointClick` — fails on the first
    // assertion; delete the `close` handler — fails on the last.
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, shippedAt(27, {}, uniform(2)));
    await pick(page, 'Fixture campsite 0');
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-sample', 'drought');
    const text = await said(page);
    expect(text).toContain('At Fixture campsite 0');
    expect(text).toContain('records drought class 2 of 3');
    expect(text).toContain(`Combined Drought Indicator for ${periodLabel(SHIPPED.meta.dekad)}`);
    expect(text).not.toMatch(RESERVED);

    await page.locator('.maplibregl-popup-close-button').dispatchEvent('click');
    await expect(page.locator('.maplibregl-popup-content')).toHaveCount(0);
    await expect(note).toHaveAttribute('data-sample', '');
    expect(await said(page)).toContain('Select a campsite');
  });

  test('🔴 a campsite where the raster holds no class says so — it is not blank and it is not an all-clear', async ({ page }) => {
    // Malta's case, reached in the browser: 0 of the 14 campsites in Malta
    // stand on a classified cell. The whole grid holds 0 here.
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, shippedAt(27, {}, uniform(0)));
    await pick(page, 'Camping Valletta');
    await expect(page.locator(NOTE)).toHaveAttribute('data-sample', 'none');
    const text = await said(page);
    expect(text).toContain('At Camping Valletta');
    expect(text).toContain('records no drought class');
    expect(text).toContain('not the same as being told the area is free of drought');
    expect(text).not.toMatch(RESERVED);
  });

  test('🔴 a campsite name we may not print is not on the page', async ({ page }) => {
    // The one string a third party writes into this panel. The fixture
    // carries exactly what the claim is about.
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, shippedAt(27, {}, uniform(3)));
    await pick(page, 'Camping Danger Bay Alert');
    await expect(page.locator(NOTE)).toHaveAttribute('data-sample', 'drought');
    const text = await said(page);
    expect(text).toContain('At this campsite,');
    expect(text).toContain('records drought class 3 of 3');
    expect(text).not.toMatch(RESERVED);
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
      return { size: [img.width, img.height], px: at.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data)) };
    },
    { b64: png.toString('base64'), at },
  );
}

test.describe('the picture', () => {
  test('🔴 the picture really reaches the canvas: the same map with the layer on and off differs', async ({ page, browserName }) => {
    test.skip(cameraUnreliable(browserName), 'WebKit on Linux cannot photograph a canvas — see wildfire-layer.spec.ts');
    // The words say the layer is drawn; this proves it. Every class everywhere,
    // so wherever the map opens there is something to see.
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, shippedAt(27, {}, uniform(3)));
    await stubSpots(page, []);
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'fresh');
    const map = page.locator(MAP);
    const on = await map.screenshot();

    await page.locator('[data-layer="drought"]').click();
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'off');
    await page.waitForTimeout(1500);
    const off = await map.screenshot();

    expect(Buffer.compare(on, off) === 0, 'the map looked identical with the drought layer on and off — nothing was drawn').toBe(false);
  });

  test('🔴 the picture is in the right PLACE: colours on the canvas are the cells at those latitudes and longitudes', async ({ page, browserName }) => {
    test.skip(cameraUnreliable(browserName), 'WebKit on Linux cannot photograph a canvas — see wildfire-layer.spec.ts');
    // A checkerboard of 1° cells — class 1 where floor(lat) + floor(lon) is
    // even, class 3 where it is odd — so that both axes are tested: a
    // picture laid on the map without resampling into mercator would put
    // 47°N about 6° away, and every band edge would be in the wrong place.
    // Each pixel is turned into a latitude and longitude from the bounds the
    // map itself publishes, and the colour there is compared with the class
    // the checkerboard holds at that place.
    // 🔴 Mutation: space the overlay's rows evenly in latitude — fails.
    const W = 1824;
    const H = 1200;
    const north = 72;
    const rows = Array.from({ length: H }, (_, r) => {
      const lat = Math.floor(north - (r + 0.5) / 24);
      const runs: string[] = [];
      for (let c = 0; c < W / 24; c++) {
        const lon = Math.floor(-25 + c + 0.5);
        runs.push(`${(lat + lon) % 2 === 0 ? 1 : 3}:24`);
      }
      return runs.join(',');
    });
    await page.clock.setFixedTime(clockAt(27));
    await serveDrought(page, shippedAt(27, {}, { ...SHIPPED.grid, rows }));
    await stubSpots(page, []);
    await openMap(page);
    await settle(page);
    await expect(page.locator(MAP)).toHaveAttribute('data-drought-drawn', '1');
    await expect.poll(async () => await page.locator(MAP).getAttribute('data-bounds')).not.toBeNull();
    // The cookie banner is fixed to the bottom of the viewport and is photographed with
    // whatever part of the map it covers — as white pixels the layer never drew.
    const reject = page.getByRole('button', { name: 'Reject' });
    if (await reject.count()) await reject.first().click();
    await expect(reject).toHaveCount(0);
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
    const spots: { at: [number, number]; class: 1 | 3 }[] = [];
    // …and away from the map's own controls: the zoom buttons at the top right
    // and the attribution strip along the bottom.
    for (let y = 30; y < box.height - 45; y += 17) {
      for (let x = 30; x < box.width - 30; x += 23) {
        if (x > box.width - 80 && y < 100) continue;
        const lat = latAt(y);
        const lon = lonAt(x);
        if (!away(lat) || !away(lon)) continue;
        spots.push({ at: [x, y], class: (Math.floor(lat) + Math.floor(lon)) % 2 === 0 ? 1 : 3 });
      }
    }
    expect(spots.length, 'too few pixels to say anything').toBeGreaterThan(40);

    const shot = await map.screenshot();
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const read = await pixelsOf(page, shot, spots.map((s) => [s.at[0] * dpr, s.at[1] * dpr]));
    // The basemap is #e8e8e8 and the layer is drawn at 60% opacity.
    const blend = (hex: string) => [0, 2, 4].map((i) => Math.round(0.6 * parseInt(hex.slice(1 + i, 3 + i), 16) + 0.4 * 232));
    const expected = { 1: blend('#F2D98A'), 3: blend('#A5541B') };
    const wrong: string[] = [];
    spots.forEach((s, i) => {
      const got = read.px[i];
      const want = expected[s.class];
      if (Math.max(...want.map((v, k) => Math.abs(v - got[k]))) > 10) {
        wrong.push(`(${s.at}) lat ${latAt(s.at[1]).toFixed(2)} lon ${lonAt(s.at[0]).toFixed(2)}: wanted class ${s.class} ${want}, got ${got.slice(0, 3)}`);
      }
    });
    expect(wrong.slice(0, 5), `${wrong.length} of ${spots.length} pixels were the wrong colour`).toEqual([]);
  });

  test('a stale period leaves nothing on the canvas', async ({ page, browserName }) => {
    test.skip(cameraUnreliable(browserName), 'WebKit on Linux cannot photograph a canvas — see wildfire-layer.spec.ts');
    // The words say the layer is off; this proves it. Photographed against the
    // same page with the layer switched off by hand.
    await page.clock.setFixedTime(clockAt(60));
    await serveDrought(page, shippedAt(60, {}, uniform(3)));
    await stubSpots(page, []);
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'stale');
    const map = page.locator(MAP);
    const stale = await map.screenshot();
    await page.locator('[data-layer="drought"]').click();
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'off');
    await page.waitForTimeout(1500);
    const off = await map.screenshot();
    expect(Buffer.compare(stale, off) === 0, 'a stale period changed the canvas — it was drawn').toBe(true);
  });
});
