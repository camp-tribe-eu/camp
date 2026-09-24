import { expect, test, type Page } from '@playwright/test';
import { AMENITY_KEYS } from '@/lib/api';
import { INITIAL_VIEW } from '@/lib/map-sources';

// CAMP-31/32 — the map, its source switcher, its escape hatch, and the
// markers.
//
// 🔴 Not one of these tests touches tiles.openfreemap.org.
//
// The cards' criteria are about OUR behaviour: that the switcher really
// changes the tile source, that the map survives one source being down,
// and that points cluster instead of turning Europe into mush. Proving
// them against the live provider would make the suite depend on a third
// party that says in its own terms it "may discontinue it at any time
// without notice", and a red build would then mean nothing about our
// code. So every style request is intercepted and answered locally, and
// the tests fail only when we break something.

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

/**
 * Zoom with the map's own control, which works under touch emulation.
 *
 * 🔴 With a pause between clicks. MapLibre animates each zoom step over
 * about 300ms and a click that lands mid-animation is dropped, so eight
 * clicks fired as fast as Playwright can send them produced far fewer
 * than eight zoom levels — and the test failed reporting that clusters
 * had not resolved, when the map had simply not zoomed as far as the
 * test believed.
 */
async function zoomIn(page: Page, times: number) {
  const button = page.locator('.maplibregl-ctrl-zoom-in');
  for (let i = 0; i < times; i++) {
    await button.click();
    await page.waitForTimeout(350);
  }
}

/** Where the map opens — imported, never copied. A second copy of the
 * centre would silently drift the day the dataset grows and the opening
 * view moves with it, and the tests would then place their fixtures
 * somewhere the map is not looking. */
const CENTRE = { lng: INITIAL_VIEW.lng, lat: INITIAL_VIEW.lat };

/**
 * Replace the campsite data with points we place ourselves.
 *
 * 🔴 Because geography is not a test fixture. These tests first zoomed
 * into the middle of the real dataset and looked for a campsite there.
 * That worked on a desktop viewport and failed on both phones — at the
 * same zoom a 375px-wide screen covers a few square kilometres, and
 * Slovenia holds roughly one campsite per seventy. The tests were
 * measuring the density of Slovenian tourism, not our clustering.
 */
async function stubSpots(
  page: Page,
  points: { lng: number; lat: number; name?: string }[],
) {
  await page.route('**/data/spots.geojson', (route) =>
    route.fulfill({
      contentType: 'application/geo+json',
      json: {
        type: 'FeatureCollection',
        features: points.map((p, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: {
            slug: `fixture-${i}`,
            name: p.name ?? `Fixture campsite ${i}`,
            type: 'paid',
            href: '/camping',
            electricity: 'yes',
            water: 'unknown',
            shower: 'no',
            dogFriendly: 'unknown',
            wifi: 'unknown',
          },
        })),
      },
    }),
  );
}

const map = (page: Page) => page.getByTestId('map');

/**
 * 🔴 Skip, rather than fail, where the browser genuinely cannot run the
 * feature.
 *
 * Headless Firefox on a runner with no GPU has no WebGL2 context, and
 * MapLibre cannot draw anything without one. That is not our bug and no
 * assertion here can make it pass. What IS our bug is what the page does
 * in that browser — it used to replace the whole page with "Application
 * error" — and that has its own test below, which runs everywhere.
 */
async function skipWithoutWebGL(page: Page) {
  const ok = await page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
  test.skip(!ok, 'no WebGL2 in this browser — see the fallback test');
}

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

  test('every marker links to a page that exists', async ({ page }) => {
    // CAMP-32. The href is built by the API, from the same function the
    // pages use, precisely so this holds — and the web app briefly
    // re-derived the region slug itself, which is the way it breaks.
    const geo = await page.request.get('/data/spots.geojson');
    expect(geo.status()).toBe(200);
    const body = await geo.json();
    expect(body.type).toBe('FeatureCollection');
    expect(body.features.length).toBeGreaterThan(0);

    // A handful is enough to catch a broken rule; all of them would make
    // this test scale with the dataset.
    for (const f of body.features.slice(0, 12)) {
      const href = f.properties.href as string;
      expect(href).toMatch(/^\/camping\/[a-z]{2}\/[^/]+\/[^/]+$/);
      const res = await page.request.get(href);
      expect(res.status(), `${href} is a dead marker link`).toBe(200);
    }
  });

  test('a marker carries the facilities we actually hold', async ({ page }) => {
    const body = await (await page.request.get('/data/spots.geojson')).json();

    // 🔴 The three-state rule, checked on the data the map draws from.
    //
    // CAMP-107 changed how the third state is written, not whether it
    // exists: an amenity nobody recorded is now an ABSENT key rather
    // than the string "unknown", because writing that word out 103 582
    // times cost 2.26 MB of a 4.9 MB file. What must never happen is
    // still the same thing — an unrecorded amenity arriving as a
    // definite "no".
    const values = new Set<unknown>();
    let absences = 0;
    for (const f of body.features) {
      for (const key of AMENITY_KEYS) {
        if (key in f.properties) values.add(f.properties[key]);
        else absences++;
      }
    }
    for (const v of values) expect(['yes', 'no']).toContain(v);
    expect(
      values.has(undefined),
      'an amenity was written as an explicit undefined rather than omitted',
    ).toBe(false);
    expect(
      absences,
      'every amenity of every campsite is recorded, which cannot be true',
    ).toBeGreaterThan(0);
  });

  // 🔴 The half of the rule a file cannot prove on its own: that absence
  // means unknown and nothing else. Compared against the API, which is
  // where the three states are still written out in full.
  test('an unrecorded amenity is absent, never a false no', async ({
    page,
    request,
  }) => {
    const api = process.env.API_BASE_URL ?? 'http://localhost:3001';
    const { markers } = await (
      await request.get(`${api}/spots/map/points?bbox=-180,-85,180,85&limit=400`)
    ).json();
    const body = await (await page.request.get('/data/spots.geojson')).json();
    const bySlug = new Map<string, Record<string, unknown>>(
      body.features.map((f: { properties: { slug: string } }) => [
        f.properties.slug,
        f.properties as unknown as Record<string, unknown>,
      ]),
    );

    let compared = 0;
    for (const m of markers as {
      slug: string;
      amenities: Record<string, string>;
    }[]) {
      const props = bySlug.get(m.slug);
      if (!props) continue;
      for (const key of AMENITY_KEYS) {
        const fromApi = m.amenities?.[key] ?? 'unknown';
        if (fromApi === 'unknown') {
          expect(
            key in props,
            `${m.slug}: ${key} is unknown in the API but present on the map`,
          ).toBe(false);
        } else {
          expect(props[key], `${m.slug}: ${key} disagrees with the API`).toBe(
            fromApi,
          );
        }
        compared++;
      }
    }
    // An empty comparison proves nothing.
    expect(compared, 'no campsite was compared').toBeGreaterThan(100);
  });

  test('renders the map and clusters the campsites', async ({ page }) => {
    await stubStyles(page);
    const mimeErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /MIME type/i.test(m.text())) {
        mimeErrors.push(m.text());
      }
    });

    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

    // 🔴 The card's criterion. At the opening zoom the campsites must
    // arrive as a handful of counted bubbles, not as one circle each.
    await expect
      .poll(async () => Number(await map(page).getAttribute('data-visible-clusters')), {
        timeout: 15_000,
        message: 'nothing clustered at the opening zoom',
      })
      .toBeGreaterThan(0);

    expect(mimeErrors, 'the worker failed to load').toEqual([]);
  });

  test('zooming in breaks the clusters into campsites', async ({ page }) => {
    await stubStyles(page);
    // Twenty campsites within a few hundred metres of the opening
    // centre: one bubble at first, twenty circles once we are close.
    await stubSpots(
      page,
      Array.from({ length: 20 }, (_, i) => ({
        lng: CENTRE.lng + (i % 5) * 0.002,
        lat: CENTRE.lat + Math.floor(i / 5) * 0.002,
      })),
    );
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();

    await expect
      .poll(async () => Number(await map(page).getAttribute('data-visible-clusters')), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // 🔴 The zoom-in control, not a double-click. Double-clicking zooms
    // on a desktop and does nothing under touch emulation, so an earlier
    // version of this test passed on three profiles and failed on the
    // two phones — for a reason that had nothing to do with clustering.
    // The control is a real button on every device.
    await zoomIn(page, 8);

    await expect
      .poll(async () => Number(await map(page).getAttribute('data-visible-points')), {
        timeout: 20_000,
        message: 'the clusters never resolved into individual campsites',
      })
      .toBeGreaterThan(0);
    await expect(map(page)).toHaveAttribute('data-visible-clusters', '0');
  });

  test('clicking a campsite opens a card that links to its page', async ({
    page,
  }) => {
    await stubStyles(page);
    // One campsite, exactly where the map opens, so this test is about
    // the card and not about finding a marker.
    await stubSpots(page, [{ ...CENTRE, name: 'Fixture campsite 0' }]);
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();

    await expect
      .poll(async () => await map(page).getAttribute('data-point-at'), {
        timeout: 20_000,
      })
      .not.toBeNull();

    // 🔴 Scrolled into view before the coordinates are read, not after.
    //
    // The click is at absolute viewport pixels, so it only lands on the
    // map if the map is on screen. CAMP-35 added the filter panel above
    // it and the marker moved 35 px below the fold — this test failed in
    // five browsers, which is exactly what it is for, but the fix belongs
    // in both places: the panel got shorter, and this stopped assuming
    // the map is the first thing on the page.
    await map(page).scrollIntoViewIfNeeded();
    const box = (await map(page).boundingBox())!;

    const [x, y] = (await map(page).getAttribute('data-point-at'))!
      .split(',')
      .map(Number);
    await page.mouse.click(box.x + x, box.y + y);

    const popup = page.locator('.maplibregl-popup-content');
    await expect(popup).toBeVisible();

    // 🔴 What the card must NOT contain is as much the point as what it
    // does. We hold no ratings, no photos and no prices, so a card that
    // showed empty stars or a placeholder frame would make every
    // campsite look unrated rather than unrecorded.
    await expect(popup).not.toContainText('★');
    await expect(popup).not.toContainText('undefined');
    await expect(popup).not.toContainText('null');

    const link = popup.getByRole('link', { name: 'Open campsite page' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect((await page.request.get(href!)).status()).toBe(200);

    // The facilities shown are the ones the feature claims — and the two
    // it says nothing about are absent rather than denied.
    await expect(popup).toContainText('Electricity');
    await expect(popup).toContainText('No shower');
    await expect(popup).not.toContainText('Drinking water');
    await expect(popup).not.toContainText('Wi-Fi');
  });

  test('the switcher changes the tile source, not just the button', async ({
    page,
  }) => {
    const asked = await stubStyles(page);
    await page.goto('/map');
    await skipWithoutWebGL(page);
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
    await skipWithoutWebGL(page);
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
    await skipWithoutWebGL(page);
    await expect(page.getByTestId('map-fallback')).toContainText(
      'could not be loaded from any of our sources',
    );

    // The way to carry on is on the same page, server-rendered.
    await expect(
      page.getByRole('heading', { name: 'Browse instead' }),
    ).toBeVisible();
  });

  test('a browser without WebGL gets a sentence, not a broken page', async ({
    browser,
  }) => {
    // 🔴 This is a real defect that CI caught, not a hypothetical.
    //
    // MapLibre's constructor throws when it cannot get a WebGL context.
    // Unhandled, that exception escaped into React and Next replaced the
    // whole page with "Application error: a client-side exception has
    // occurred" — taking out the country list underneath, which was the
    // entire point of having a fallback. Headless Firefox with no GPU
    // behaves exactly this way, and so does a reader with WebGL
    // disabled.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          return null;
        }
        return (real as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    const crashes: string[] = [];
    page.on('pageerror', (e) => crashes.push(e.message));

    await page.goto('/map');

    await expect(page.getByTestId('map-unsupported')).toBeVisible();
    await expect(page.getByTestId('map-unsupported')).toContainText('WebGL');

    // The page is still a page: heading, and the way onward.
    await expect(
      page.getByRole('heading', { name: 'Campsite map' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Browse instead' }),
    ).toBeVisible();
    await expect(
      page.getByText('Application error', { exact: false }),
    ).toHaveCount(0);

    await context.close();
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
