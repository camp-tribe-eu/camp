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
