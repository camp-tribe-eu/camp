import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Debt #3 (CAMP-60): catch the regressions no functional test can see.
//
// Every other suite asks whether the right things are on the page. None
// of them notices a padding that collapsed, a colour token that stopped
// resolving, a heading that wrapped into three lines on a phone, or a
// footer that climbed over the content. Those ship silently and are
// found by a reader.
//
// 🔴 What makes this reliable rather than the usual screenshot-test
// misery, stated as rules and enforced below:
//
// 1. CI only. A baseline is a rendering of a font by a particular
//    platform; a macOS baseline and a Linux runner never agree. The
//    snapshot path carries {platform} so the two can never be confused,
//    and the baselines in the repository are the runner's.
//
// 2. Fixed data. CI seeds apps/api/test/fixtures/ci-seed.sql, so the
//    counts and names on these pages are the same on every run. That is
//    what makes screenshotting a data-driven site possible at all — and
//    it is why these must not be pointed at a live database.
//
// 3. The map canvas is masked. Tiles come from a third party over the
//    network; a screenshot including them would fail on their bad day
//    rather than on our bad change. Masking the canvas still guards
//    everything around it — the controls, the filter chips, the
//    layout — which is where our CSS actually lives.
//
// 4. Animations off, and the page is waited for rather than slept on.

/** Viewports worth guarding: the phone most readers use, and a laptop. */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 800 },
];

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'countries', path: '/camping' },
  { name: 'map', path: '/map' },
  { name: 'not-found', path: '/camping/xx/nowhere/nothing-here' },
];

/**
 * Everything that is allowed to look different between runs.
 *
 * 🔴 Kept short on purpose. Every mask is a piece of the page this test
 * stops guarding, so a mask needs a reason that is about the world
 * rather than about the test being annoying.
 */
async function masks(page: Page) {
  return [
    // Third-party tiles over the network.
    page.locator('canvas'),
    // MapLibre writes its own attribution bar, including a tile-provider
    // string we do not control.
    page.locator('.maplibregl-ctrl-attrib'),
  ];
}

/**
 * 🔴 CAMP-153. Pin the wildfire note so /map's baseline is about LAYOUT.
 *
 * The note under the map says something different in every state, and the
 * state is a function of the calendar: `wildfires.json` carries the
 * moment it was last fetched, and the page stops calling it fresh 72
 * hours later. A baseline recorded while it was fresh therefore fails on
 * the fourth day for no reason but the date — and on a data refresh, for
 * the words in the file. Both are correct behaviour that a screenshot
 * cannot tell from a regression, and a suite that goes red by itself is
 * a suite people delete.
 *
 * So the clock is fixed and the feed is ours: two small fires in Portugal
 * (the map opens over Croatia, so the note says none is in view) and the
 * shipped `meta` — credit, authority note, licence links — with only the
 * two dates moved. What the baseline guards is how that note sits on the
 * page. What the note SAYS in each state is asserted, on the page, by
 * tests/e2e/wildfire-layer.spec.ts.
 */
async function pinFireLayer(page: Page) {
  const shipped = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'src', 'data', 'wildfires.json'), 'utf8'),
  ) as { meta: Record<string, unknown> };
  const fire = (lng: number, lat: number, id: string) => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lng, lat],
          [lng + 0.05, lat],
          [lng + 0.05, lat + 0.05],
          [lng, lat + 0.05],
          [lng, lat],
        ],
      ],
    },
    properties: { id, date: '2026-09-20', country: 'PT', place: 'Portel', hectares: 60 },
  });
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'));
  await page.route('**/data/wildfires.json', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        meta: {
          ...shipped.meta,
          fetchedAt: '2026-09-28T11:00:00.000Z',
          since: '2026-09-14',
          windowDays: 14,
        },
        features: [fire(-8, 39, 'v-1'), fire(-7.5, 39.5, 'v-2')],
      },
    }),
  );
}

/**
 * 🔴 CAMP-163. Pin the drought note for the same reason, and by the same
 * means: it says a different thing in every state, and the state is a
 * function of the calendar — `drought.json` names a dekad, and the page
 * stops calling it fresh 40 days after it began. A baseline recorded while
 * it was fresh would fail on the 41st day, and on every data refresh.
 *
 * The clock is the one `pinFireLayer` fixed (28.09.2026, which is 17 days
 * after the 11th), and the file is the shipped one with ONLY the two dates
 * moved onto that clock — the period, its credit's year and the read time.
 * The grid is the shipped grid: the canvas is masked, so its content cannot
 * change what is guarded here, which is how the note sits on the page. What
 * the note SAYS in each state is asserted, on the page, by
 * tests/e2e/drought-layer.spec.ts.
 */
async function pinDroughtLayer(page: Page) {
  const shipped = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'src', 'data', 'drought.json'), 'utf8'),
  ) as { meta: Record<string, string>; grid: unknown };
  await page.route('**/data/drought.json', (route) =>
    route.fulfill({
      json: {
        meta: {
          ...shipped.meta,
          dekad: '2026-09-11',
          fetchedAt: '2026-09-28T11:00:00.000Z',
          // The credit carries the year of the DATA, and the page checks it.
          attribution: shipped.meta.attribution.replace(/information \d{4}/, 'information 2026'),
        },
        grid: shipped.grid,
      },
    }),
  );
}

async function settle(page: Page) {
  // Fonts decide layout. A screenshot taken before they load captures
  // the fallback metrics and differs from every later run.
  await page.evaluate(() => document.fonts.ready);
  // And give the map its chance to either draw or not — either way the
  // canvas is masked, but a half-built control bar is not.
  await page.waitForLoadState('networkidle').catch(() => {});
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const subject of PAGES) {
      test(`${subject.name} looks the way it did`, async ({ page }) => {
        if (subject.name === 'map') {
          await pinFireLayer(page);
          await pinDroughtLayer(page);
        }
        await page.goto(subject.path);
        await settle(page);

        await expect(page).toHaveScreenshot(
          `${subject.name}-${viewport.name}.png`,
          {
            fullPage: true,
            animations: 'disabled',
            // Caret blink is a one-pixel diff that fails a run at random.
            caret: 'hide',
            mask: await masks(page),
            // 🔴 A small tolerance, not zero. Text antialiasing varies by
            // a pixel or two between runs of the same browser on the same
            // machine; zero tolerance means a red build every few days,
            // and a suite that cries wolf gets deleted. 0.2% of the page
            // is far below any real layout change and far above noise.
            maxDiffPixelRatio: 0.002,
          },
        );
      });
    }
  });
}
