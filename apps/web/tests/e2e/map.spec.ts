import { expect, test, type Page } from '@playwright/test';

// CAMP-31 — the map, its source switcher, and its escape hatch.
//
// 🔴 Not one of these tests touches tiles.openfreemap.org.
//
// The card's two criteria are about OUR behaviour: that the switcher
// really changes the tile source, and that the map survives one source
// being down. Proving them against the live provider would make the
// suite depend on a third party that says in its own terms it "may
// discontinue it at any time without notice", and a red build would then
// mean nothing about our code. So every style request is intercepted and
// answered locally, and the tests fail only when we break something.

/** The smallest thing MapLibre accepts as a style. */
const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'bg',
      type: 'background',
      paint: { 'background-color': '#e8e8e8' },
    },
  ],
};

const STYLE_GLOB = '**/styles/*';

/**
 * Serve every style locally and record which ones were asked for.
 * `broken` names the style ids that should fail instead.
 */
async function stubStyles(page: Page, broken: string[] = []) {
  const asked: string[] = [];
  await page.route(STYLE_GLOB, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    asked.push(id);
    if (broken.includes(id)) {
      await route.fulfill({ status: 404, body: 'gone' });
      return;
    }
    await route.fulfill({ json: EMPTY_STYLE });
  });
  return asked;
}

const map = (page: Page) => page.getByTestId('map');

test.describe('/map', () => {
  // 🔴 The regression that cost the most time on this card, and the
  // reason it is the first test.
  //
  // maplibre-gl 6 runs its tile parser in a module worker whose URL it
  // resolves from `import.meta.url`. After bundling that points at a
  // Next chunk, so the browser fetched the HTML 404 page and refused it.
  // The map still appeared, the controls still worked, raster still drew
  // — and every vector layer, ours included, was silently missing. It
  // looked like a data bug for far too long.
  //
  // scripts/copy-maplibre-worker.mjs is what stops that, and a build
  // step nobody can see is exactly the kind that quietly stops running.
  test('the map worker is served as JavaScript, not as the 404 page', async ({
    page,
  }) => {
    for (const file of [
      '/maplibre/maplibre-gl-worker.mjs',
      // Its one dependency, by relative path — they must stay siblings.
      '/maplibre/maplibre-gl-shared.mjs',
    ]) {
      const res = await page.request.get(file);
      expect(res.status(), `${file} is missing from the build`).toBe(200);
      expect(
        res.headers()['content-type'] ?? '',
        `${file} is served as the wrong type`,
      ).toContain('javascript');
    }
  });

  test('renders the map and the campsite points', async ({ page }) => {
    await stubStyles(page);
    const mimeErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /MIME type/i.test(m.text())) {
        mimeErrors.push(m.text());
      }
    });

    await page.goto('/map');
    await expect(map(page)).toBeVisible();
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

    // The points come from our own static GeoJSON, and the worker is
    // what turns it into something drawable.
    const geo = await page.request.get('/data/spots.geojson');
    expect(geo.status()).toBe(200);
    const body = await geo.json();
    expect(body.type).toBe('FeatureCollection');
    expect(body.features.length).toBeGreaterThan(0);

    expect(mimeErrors, 'the worker failed to load').toEqual([]);
  });

  test('the switcher changes the tile source, not just the button', async ({
    page,
  }) => {
    const asked = await stubStyles(page);
    await page.goto('/map');
    await expect(map(page)).toBeVisible();
    await expect.poll(() => asked.length).toBeGreaterThan(0);

    const first = asked[0];
    const other = await page
      .getByRole('button', { pressed: false })
      .first()
      .textContent();

    await page.getByRole('button', { name: other!.trim(), exact: true }).click();

    // 🔴 The assertion is that the browser fetched a DIFFERENT style
    // document — not that the button turned blue. A switcher that only
    // repaints itself would pass every DOM-level check and still leave
    // the reader on the same supplier, which is the one thing this
    // component exists to make replaceable.
    await expect
      .poll(() => asked.filter((id) => id !== first).length, {
        message: 'no second style was requested after switching',
      })
      .toBeGreaterThan(0);
  });

  test('stays usable when a source is down', async ({ page }) => {
    // The default source fails; every other one is fine.
    const asked = await stubStyles(page, ['liberty']);

    await page.goto('/map');
    await expect(map(page)).toBeVisible();

    // It says which supplier failed, rather than showing a grey box.
    await expect(page.getByTestId('map-fallback')).toBeVisible();
    await expect(page.getByTestId('map-fallback')).toContainText(
      'did not respond',
    );

    // And it really moved: a different style was fetched, and the map is
    // now reporting a different active source.
    await expect
      .poll(() => asked.filter((id) => id !== 'liberty').length)
      .toBeGreaterThan(0);
    await expect(map(page)).not.toHaveAttribute('data-active-source', 'liberty');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  });

  test('says so plainly when every source is down', async ({ page }) => {
    // 🔴 The case that used to loop forever: with no source left the
    // list wrapped around and kept switching. A reader who is simply
    // offline should get one sentence and a way to carry on.
    await page.route(STYLE_GLOB, (route) =>
      route.fulfill({ status: 404, body: 'gone' }),
    );

    await page.goto('/map');
    await expect(page.getByTestId('map-fallback')).toContainText(
      'could not be loaded from any of our sources',
    );

    // The way to carry on is on the same page, server-rendered.
    await expect(
      page.getByRole('heading', { name: 'Browse instead' }),
    ).toBeVisible();
  });

  test('works with JavaScript off', async ({ browser }) => {
    // 🔴 The map is the one page that needs JavaScript, which is why the
    // crawl path from CAMP-71 deliberately avoids it. What a reader
    // without JavaScript gets here still has to be an answer, not an
    // apology — so the country list is rendered by the server.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/map');

    await expect(
      page.getByRole('heading', { name: 'Campsite map' }),
    ).toBeVisible();
    const countries = page
      .getByRole('heading', { name: 'Browse instead' })
      .locator('xpath=following-sibling::ul[1]')
      .getByRole('link');
    expect(await countries.count()).toBeGreaterThan(0);

    await context.close();
  });
});
