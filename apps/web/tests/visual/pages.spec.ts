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
//    🔴 READ THAT NARROWLY. It means the same ON ONE BUILD. It does not
//    mean the numbers cannot move, and CAMP-182 is what happens when it
//    is read as though it did: the headline went 71 → 72 and Croatia
//    36 → 37 between two runs, and the suite stayed green, because the
//    only record of the numbers was a PNG and
//    `--update-snapshots` had rewritten it from the very thing it was
//    meant to judge.
//
//    Measured afterwards: nothing here is non-deterministic. The count
//    path (`countries()`) touches no clock, and every `LIMIT` in the
//    fixture carries an `ORDER BY`. What moved was the fixture itself —
//    ci-seed.sql changed on 29.09 (CAMP-168) and the two baselines
//    straddle that commit.
//
//    So the numbers now also live in scripts/ci/check-fixture-counts.mjs,
//    computed from the seed file and compared against a written-down
//    expectation. A change to them has to be an edit somebody makes on
//    purpose, not a side effect of a flag.
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

async function settle(page: Page) {
  // Fonts decide layout. A screenshot taken before they load captures
  // the fallback metrics and differs from every later run.
  await page.evaluate(() => document.fonts.ready);
  // And give the map its chance to either draw or not — either way the
  // canvas is masked, but a half-built control bar is not.
  await page.waitForLoadState('networkidle').catch(() => {});
}


/**
 * The size of a PNG, from its header. CAMP-197.
 *
 * 🔴 Needed because the number that matters is a RATIO, and the only
 * exact figure Playwright hands back is a pixel COUNT. Dividing one by
 * the other needs the baseline's own dimensions, so they are read from
 * the file that the comparison was made against — not from the viewport,
 * which is the height of the window and not of a full-page shot.
 */
function pngSize(file: string): { width: number; height: number } {
  const head = readFileSync(file).subarray(16, 24);
  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
}

/**
 * How much of the tolerance this screenshot actually spent. CAMP-197.
 *
 * 🔴 WHY THIS EXISTS. `maxDiffPixelRatio` does not forgive noise — it
 * ACCUMULATES. A baseline can sit at 70% of the budget for a year and
 * the job stays green, so a real change hides inside the allowance until
 * some unrelated edit pushes the same file over the line. That is how a
 * "Tools" menu item lived in a baseline unseen: CAMP-55 re-shot seven of
 * eight baselines, the eighth spent ~2033 pixels of a 2225 budget, and
 * nothing said a word until CAMP-186 added one footer link.
 *
 * 🔴 IT READS THE PIXEL COUNT, NOT THE RATIO PLAYWRIGHT PRINTS, and the
 * first version of this got that wrong. `coreBundle.js` computes the
 * displayed ratio as `Math.ceil(count / area * 100) / 100` — rounded UP
 * to the nearest hundredth. Against a budget of 0.002 that is useless:
 * every non-zero difference, however small, prints as "0.01". The first
 * run duly reported two files at "500% of the budget", which meant only
 * "not byte-identical" and nothing more.
 *
 * The count beside it is exact, so the ratio is computed here from the
 * baseline's own dimensions.
 *
 * Returns null when the images are identical, and a distinct shape when
 * the message cannot be read. 🔴 "Spent nothing" and "could not tell"
 * must never look alike.
 */
async function budgetSpent(
  page: Page,
  name: string,
  baseline: string,
  options: Record<string, unknown>,
): Promise<{ pixels: number; ratio: number } | { unreadable: string } | null> {
  try {
    await expect(page).toHaveScreenshot(name, {
      ...options,
      maxDiffPixels: 0,
      timeout: 15_000,
    });
    return null; // identical
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    const m = text.match(/(\d+) pixels \(ratio/);
    if (!m) return { unreadable: text.split('\n')[0].slice(0, 160) };
    const pixels = Number(m[1]);
    const { width, height } = pngSize(baseline);
    return { pixels, ratio: pixels / (width * height) };
  }
}

/** The blocking tolerance, named once so the report can speak in fractions of it. */
const BUDGET = 0.002;

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const subject of PAGES) {
      test(`${subject.name} looks the way it did`, async ({ page }, testInfo) => {
        if (subject.name === 'map') await pinFireLayer(page);
        await page.goto(subject.path);
        await settle(page);

        const shot = `${subject.name}-${viewport.name}.png`;
        await expect(page).toHaveScreenshot(shot, {
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
            //
            // 🔴 But it ACCUMULATES — see budgetSpent below, and CAMP-197
            // for the menu item that lived inside this allowance unseen.
            maxDiffPixelRatio: BUDGET,
        });

        // CAMP-197, measuring step. Reports only — the threshold that
        // turns this red is chosen from these numbers, not before them.
        const spent = await budgetSpent(
          page,
          shot,
          testInfo.snapshotPath(shot),
          {
            fullPage: true,
            animations: 'disabled',
            caret: 'hide',
            mask: await masks(page),
          },
        );
        const says =
          spent === null
            ? 'identical to the baseline'
            : 'unreadable' in spent
              ? `COULD NOT MEASURE — ${spent.unreadable}`
              : `${spent.pixels} px, ${(spent.ratio * 100).toFixed(4)}% of the page, ` +
                `${((spent.ratio / BUDGET) * 100).toFixed(1)}% of the budget`;
        console.log(`visual-budget\t${shot}\t${says}`);
      });
    }
  });
}
