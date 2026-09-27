import { expect, test, type Page } from '@playwright/test';
import {
  chunkKey,
  chunksInView,
  countInView,
  type Bounds,
  type RegionSummary,
} from '@/lib/map-chunks';

// CAMP-134, defects 2, 3 and 4 of six — the three that need a browser and
// a production build of the real data.
//
//   2  `loaded()` in e2e: the map opens too wide, `data-total` stays 0
//      forever, and the helper waits 20 s for a number that is never
//      coming. Invisible on the fixture, where the map opens in detail.
//   3  the "zoomed-out map" test: it fails on the fixture BECAUSE the
//      fixture is small — the panel honestly says "36 campsites" where
//      the test expects "zoom in". On full data it passes. Backwards.
//   4  `data-map-state="ready"` published with three fetches outstanding
//      and 7 of 14 chunks in hand. The fixture is one chunk and no
//      parallelism, so `ready` there is always honest by accident.
//
// 🔴 WHY THESE FOUR TESTS AND NOT THE E2E MATRIX.
//
// tests/e2e runs 18 files across six browser projects. Running that on
// 61 557 campsites buys almost nothing: most of it is about a page's
// markup, a header, a link, a filter's arithmetic — none of which change
// with the size of the dataset. What DOES change is the four facts below,
// and all four are about a map that no longer fits in one download.
//
// One browser, one viewport, four tests. Everything else stays on the
// fixture, where it is fast and where it belongs.

const map = (page: Page) => page.getByTestId('map');

/** The scale below which nothing in this file means anything. */
const MIN_REGIONS = 100;

interface Sample {
  t: number;
  state: string | null;
  inFlight: number;
  total: number;
  bounds: string | null;
}

/**
 * Watch `data-map-state` change, and record what was still in flight at
 * each change.
 *
 * 🔴 The counter decrements after `res.json()`, not after the headers.
 * The component's own `inFlight` spans the parse too, and a detector that
 * stopped counting earlier would miss exactly the window this is for.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __scale: {
        inFlight: number;
        started: string[];
        finished: string[];
        samples: Sample[];
      };
    };
    w.__scale = { inFlight: 0, started: [], finished: [], samples: [] };
    const isChunk = (u: string) => /\/data\/spots\/[^/]+\/[^/]+\.geojson/.test(u);
    const real = window.fetch;
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const url = String(
        typeof args[0] === 'string' ? args[0] : (args[0] as Request).url,
      );
      const p = real.apply(this as never, args);
      if (!isChunk(url)) return p;
      w.__scale.inFlight += 1;
      w.__scale.started.push(url);
      return p.then(
        (res) => {
          const json = res.json.bind(res);
          res.json = () =>
            json().finally(() => {
              w.__scale.inFlight -= 1;
              w.__scale.finished.push(url);
            });
          return res;
        },
        (err) => {
          w.__scale.inFlight -= 1;
          throw err;
        },
      );
    } as typeof fetch;

    const watch = () => {
      const el = document.querySelector('[data-testid="map"]');
      if (!el) return false;
      const record = () =>
        w.__scale.samples.push({
          t: Date.now(),
          state: el.getAttribute('data-map-state'),
          inFlight: w.__scale.inFlight,
          total: Number(el.getAttribute('data-total') ?? -1),
          bounds: el.getAttribute('data-bounds'),
        });
      record();
      new MutationObserver(record).observe(el, {
        attributes: true,
        attributeFilter: ['data-map-state', 'data-total'],
      });
      return true;
    };
    // 🔴 A poll, not a MutationObserver on the document.
    //
    // The first version of this watched `document.documentElement` for
    // the map to appear, and it recorded NOTHING — an init script runs
    // before the document has a root element, so there was nothing to
    // observe and the observer never attached. The suite went green
    // anyway, because the assertion was "no sample says ready while
    // fetching", and no sample says anything. A detector that cannot
    // observe reports safety, which is the whole subject of this card
    // reproduced inside the check for it.
    //
    // It is caught for good by the assertion in the spec that the sample
    // list is non-empty and has seen a fetch in progress, and prevented
    // here by a method that cannot depend on when it is called.
    const timer = setInterval(() => {
      if (watch()) clearInterval(timer);
    }, 20);
  });
}

interface Scale {
  inFlight: number;
  started: string[];
  finished: string[];
  samples: Sample[];
}

const readScale = (page: Page): Promise<Scale> =>
  page.evaluate(() => (window as unknown as { __scale: Scale }).__scale);

/**
 * The verdict, in one place, so the check and its rehearsal cannot drift.
 *
 * 🔴 A `ready` published while a chunk is still coming. That is the whole
 * defect: measured in the production build, `ready` went out with three
 * fetches outstanding and 7 of 14 chunks in hand, and it never went back,
 * because `loading` is only set when something is missing. The reader was
 * told the map was complete over a third of the data.
 */
const dishonestSamples = (scale: Scale) =>
  scale.samples.filter((s) => s.state === 'ready' && s.inFlight > 0);

/**
 * Hold chunk responses back, so an overlapping refresh is certain rather
 * than lucky.
 *
 * 🔴 Not a trick to make a test pass — the condition this reproduces is
 * an ordinary one. A reader on mobile data waits this long for a 600 kB
 * chunk, and every pan while it is in the air starts the second refresh
 * that produced the defect. On a laptop against localhost the window is
 * a few milliseconds wide and whether the check sees it is a coin toss;
 * a guard that depends on a race going the right way is not a guard.
 */
async function slowChunks(page: Page, ms: number) {
  await page.route('**/data/spots/*/*.geojson', async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** The built index, read the way the map reads it. */
async function builtIndex(page: Page): Promise<RegionSummary[]> {
  const res = await page.request.get('/data/spots/index.json');
  expect(res.status(), 'the built map index is missing').toBe(200);
  const index = (await res.json()) as RegionSummary[];
  expect(
    index.length,
    `${index.length} regions. This suite must run against a build made from ` +
      'the full database — against the fixture it reports green over nothing.',
  ).toBeGreaterThan(MIN_REGIONS);
  return index;
}

const boundsOf = (s: string): Bounds => {
  const [west, south, east, north] = s.split(',').map(Number);
  return { west, south, east, north };
};

async function skipWithoutWebGL(page: Page) {
  const ok = await page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
  test.skip(!ok, 'no WebGL2 in this browser');
}

/** Click the map's own zoom control, letting each animation finish. */
async function zoomIn(page: Page, times: number) {
  const button = page.locator('.maplibregl-ctrl-zoom-in');
  for (let i = 0; i < times; i++) {
    await button.click();
    await page.waitForTimeout(350);
  }
}

test.describe('/map at 61 557 campsites', () => {
  test.describe.configure({ timeout: 180_000 });

  test('🔴 it opens too wide to draw a single campsite, and says so', async ({
    page,
  }) => {
    // Defect 3, asserted the right way round.
    //
    // On the fixture this page opens in detail: 4 regions, every chunk in
    // view, a real count in the panel. A test written there that expects
    // "zoom in" FAILS — and that failure is about the fixture, not about
    // the code. Here the same page must do the opposite, and the two
    // behaviours are both correct.
    await instrument(page);
    const index = await builtIndex(page);

    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();

    await expect(map(page)).toHaveAttribute('data-map-state', 'wide', {
      timeout: 30_000,
    });
    expect(
      Number(await map(page).getAttribute('data-total')),
      'a campsite was drawn at the opening view, so this is no longer the wide case',
    ).toBe(0);

    // The message is the one a reader can act on, and it does not claim
    // the viewport it has not counted.
    const message = page.getByTestId('map-data-state');
    await expect(message).toContainText('zoom in');
    await expect(message).toContainText('regions in view');

    // 🔴 And the panel gives NO number. The failure this replaced printed
    // a bold 0 directly above "3,116 campsites in view".
    const count = page.getByTestId('filter-count');
    await expect(count).toContainText(/zoom in/i);
    await expect(count.locator('strong')).toHaveCount(0);

    // Defect 2's cause, stated as a fact rather than inferred from a
    // timeout: at the opening view NOTHING is fetched, so no amount of
    // waiting will make `data-total` move.
    const scale = await readScale(page);
    expect(
      scale.started,
      'a chunk was fetched at the opening view, so the wide branch did not run',
    ).toEqual([]);

    // The number the wide view does give has to be the index's own.
    const bounds = await map(page).getAttribute('data-bounds');
    if (bounds) {
      const expected = countInView(index, boundsOf(bounds));
      await expect(message).toContainText(expected.toLocaleString('en-GB'));
    }
  });

  test('🔴 zooming in reaches campsites, which is what the helper has to do', async ({
    page,
  }) => {
    // Defect 2. The old helper polled `data-total > 0` for 20 s without
    // touching the map. Above, we proved no chunk is even requested at
    // the opening view — so that helper could only ever time out here,
    // while passing on the fixture. This is the shape a helper must have
    // to work at both sizes.
    await instrument(page);
    await builtIndex(page);

    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();

    let clicks = 0;
    for (let i = 0; i < 8; i++) {
      if (Number(await map(page).getAttribute('data-total')) > 0) break;
      await zoomIn(page, 1);
      clicks++;
      for (let w = 0; w < 10; w++) {
        if (Number(await map(page).getAttribute('data-total')) > 0) break;
        await page.waitForTimeout(150);
      }
    }
    console.log(`markers appeared after ${clicks} zoom clicks`);

    await expect
      .poll(async () => Number(await map(page).getAttribute('data-total')), {
        timeout: 30_000,
        message: 'the map never drew a campsite, however far it was zoomed',
      })
      .toBeGreaterThan(0);
    await expect(map(page)).toHaveAttribute('data-map-state', 'ready', {
      timeout: 30_000,
    });
  });

  test('🔴 "ready" is never published while a chunk is still coming', async ({
    page,
  }) => {
    // Defect 4, and the reason it needs scale: `ready` goes out early
    // only when a second refresh overtakes a first, which needs several
    // chunks in view at once. The fixture has four regions and one chunk.
    await instrument(page);
    await slowChunks(page, 250);
    const index = await builtIndex(page);

    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();

    for (let i = 0; i < 8; i++) {
      if (Number(await map(page).getAttribute('data-total')) > 0) break;
      await zoomIn(page, 1);
      for (let w = 0; w < 10; w++) {
        if (Number(await map(page).getAttribute('data-total')) > 0) break;
        await page.waitForTimeout(150);
      }
    }
    await expect(map(page)).toHaveAttribute('data-map-state', 'ready', {
      timeout: 30_000,
    });

    // 🔴 Pan, then pan back. That is the move that starts a refresh over
    // a refresh — and the one a reader makes constantly.
    const box = (await map(page).boundingBox())!;
    for (const [dx, dy] of [
      [-260, 0],
      [0, -180],
      [240, 140],
    ] as const) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {
        steps: 8,
      });
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    await expect(map(page)).toHaveAttribute('data-map-state', 'ready', {
      timeout: 40_000,
    });
    // Let anything still arriving settle, so the last sample is honest.
    await page.waitForTimeout(1500);

    const scale = await readScale(page);
    const busiest = Math.max(0, ...scale.samples.map((s) => s.inFlight));
    console.log(
      `${scale.samples.length} state changes, ${scale.started.length} chunk ` +
        `fetches, ${busiest} the most ever in flight at once`,
    );

    // 🔴 First: did the detector detect anything at all?
    //
    // An empty result is a failed run, not a clean one. The first version
    // of this test recorded zero samples — its observer never attached —
    // and passed, because "no sample says ready while fetching" is
    // trivially true of no samples. These three lines are what stops this
    // guard from becoming the sixth defect.
    expect(
      scale.samples.length,
      'the state watcher recorded nothing, so this test would pass over any defect',
    ).toBeGreaterThan(2);
    expect(
      scale.samples.some((s) => s.state === 'ready'),
      'the map never reached ready, so nothing was actually examined',
    ).toBe(true);
    expect(
      busiest,
      'no sample ever caught a fetch in progress, so the window this test ' +
        'watches was never observed — it cannot have seen an early `ready`',
    ).toBeGreaterThan(0);

    expect(
      dishonestSamples(scale).map((s) => `ready with ${s.inFlight} still in flight`),
      'the map called itself ready while it was still downloading',
    ).toEqual([]);

    // 🔴 The other half of the same defect: `ready` with 7 of 14 chunks.
    // Every chunk the current view needs must be one the page fetched.
    const bounds = await map(page).getAttribute('data-bounds');
    expect(bounds, 'the map published no bounds').not.toBeNull();
    const { keys, tooMany } = chunksInView(index, boundsOf(bounds!));
    if (!tooMany) {
      const got = new Set(
        scale.finished.map((u) => new URL(u, 'http://x').pathname
          .replace('/data/spots/', '')
          .replace('.geojson', '')),
      );
      const missing = keys.filter((k) => !got.has(k));
      console.log(`${keys.length} chunks in view, ${got.size} fetched`);
      expect(
        missing,
        'the map said ready without the chunks its own viewport needs',
      ).toEqual([]);
    }
  });

  test('🔴 …and the check that says so can still fail', async ({ page }) => {
    // 🔴 Two steps, like every guard in this repository: prove it can
    // still fail, THEN believe the run that says it did not.
    //
    // The test above is only worth its runner time if an early `ready`
    // would actually reach it, and that is not obvious: it depends on a
    // patched `fetch`, on a MutationObserver attaching at the right
    // moment, and on the counter spanning the parse rather than the
    // headers. The first version of all that recorded ZERO samples and
    // passed — the observer never attached, and "no sample says ready
    // while fetching" is trivially true of no samples.
    //
    // So this drives the broken shape end to end. The page really is
    // downloading a chunk; the attribute really is set to `ready` over
    // it; the verdict is computed by the same function. The only thing
    // standing in for the defect is who wrote the attribute — the
    // component's own path cannot be reverted from a test, and reverting
    // it in the source is not this card's to do (four other cards own
    // that file this week).
    await instrument(page);
    await slowChunks(page, 2000);
    await builtIndex(page);

    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();

    // Zoom until chunks start arriving — they will be slow.
    for (let i = 0; i < 8; i++) {
      const busy = await page.evaluate(
        () => (window as unknown as { __scale: Scale }).__scale.inFlight,
      );
      if (busy > 0) break;
      await zoomIn(page, 1);
    }

    const inFlightNow = await page.evaluate(() => {
      const w = window as unknown as { __scale: Scale };
      if (w.__scale.inFlight > 0) {
        // The broken publication, injected: `ready`, over a download.
        document
          .querySelector('[data-testid="map"]')
          ?.setAttribute('data-map-state', 'ready');
      }
      return w.__scale.inFlight;
    });
    expect(
      inFlightNow,
      'no chunk was in flight, so the rehearsal never posed the question',
    ).toBeGreaterThan(0);
    await page.waitForTimeout(200);

    const scale = await readScale(page);
    const caught = dishonestSamples(scale);
    console.log(
      `rehearsal: ${caught.length} dishonest sample(s) — ` +
        caught.map((s) => `ready with ${s.inFlight} in flight`).join('; '),
    );
    expect(
      caught.length,
      'an early `ready` was published over a live download and the check ' +
        'did not notice — so the test above proves nothing',
    ).toBeGreaterThan(0);
  });

  test('🔴 the number on the page is the number in the files', async ({
    page,
  }) => {
    // The map snapshot defect (6) as a reader met it: a panel that said
    // "0 campsites" over a request that had failed. A number on screen
    // has to be one the data behind it supports — and at this size the
    // data behind it is many files rather than one.
    await instrument(page);
    const index = await builtIndex(page);
    const byKey = new Map(index.map((r) => [chunkKey(r), r.count]));

    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();

    for (let i = 0; i < 8; i++) {
      if (Number(await map(page).getAttribute('data-total')) > 0) break;
      await zoomIn(page, 1);
      for (let w = 0; w < 10; w++) {
        if (Number(await map(page).getAttribute('data-total')) > 0) break;
        await page.waitForTimeout(150);
      }
    }
    await expect(map(page)).toHaveAttribute('data-map-state', 'ready', {
      timeout: 30_000,
    });
    await page.waitForTimeout(800);

    const scale = await readScale(page);
    const fetched = [
      ...new Set(
        scale.finished.map((u) =>
          new URL(u, 'http://x').pathname
            .replace('/data/spots/', '')
            .replace('.geojson', ''),
        ),
      ),
    ];
    expect(fetched.length, 'no chunk was fetched at all').toBeGreaterThan(0);

    const fromIndex = fetched.reduce((n, k) => n + (byKey.get(k) ?? 0), 0);
    const onPage = Number(await map(page).getAttribute('data-total'));
    console.log(
      `${fetched.length} chunks fetched; the index promises ${fromIndex}, ` +
        `the map holds ${onPage}`,
    );
    expect(
      onPage,
      'the map holds a different number of campsites than its own files promised',
    ).toBe(fromIndex);

    const shown = Number(await map(page).getAttribute('data-shown'));
    expect(shown, 'more is drawn than was loaded').toBeLessThanOrEqual(onPage);
    await expect(page.getByTestId('filter-count')).toContainText(
      onPage.toLocaleString('en-GB'),
    );
  });
});

test.describe('/search at 61 422 campsites', () => {
  test.describe.configure({ timeout: 180_000 });

  test('🔴 the index loads, which it did not for a month', async ({ page }) => {
    // Defect 5 from the reader's side. The route threw at 6.9 MB against
    // a 1.5 MB ceiling, the file was a 500, and the page said "could not
    // be loaded" — on a fixture of 72 it was 14 KB and perfect.
    const failures: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/data/search/') && !r.ok()) {
        failures.push(`${r.status()} ${r.url()}`);
      }
    });

    await page.goto('/search');
    const search = page.getByTestId('search');
    await expect(search).toBeVisible();

    await page.getByTestId('search-input').fill('Bled');
    await expect(page.getByTestId('search-results')).toBeVisible({
      timeout: 60_000,
    });
    const results = page.getByTestId('search-results').getByRole('listitem');
    expect(await results.count()).toBeGreaterThan(0);

    await expect(search).not.toContainText('could not be loaded');
    expect(failures, 'a search chunk did not load').toEqual([]);

    const count = await page.getByTestId('search-count').textContent();
    console.log(`search says: ${count?.trim()}`);
  });
});
