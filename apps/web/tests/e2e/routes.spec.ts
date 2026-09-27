import { expect, test } from './api-request';
import { CURATED_ROUTES } from '../../src/data/routes';

// CAMP-3 / CAMP-45 — the route library, on real pages.
//
// 🔴 What is being defended here is the promise not to invent a number.
//
// The unit specs prove the geometry provider reports unavailable. That is
// not the same as proving the PAGE does not print a road figure — a
// template could easily grow one, from the straight line, from a rough
// "80 km/h" assumption, or from somebody filling the empty box because
// it looked unfinished. This suite reads the rendered page.
//
// It also covers the thing tests went green over on this project once
// before: the map was dead while everything passed. So the map container
// has to actually mount, and the console has to be clean.

/** Everything the console said, so a test can assert it said nothing. */
function collectConsoleErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  return errors;
}

test.describe('the library index', () => {
  test('lists every curated route, and says how many there are', async ({ page }) => {
    await page.goto('/routes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Camping routes',
    );

    for (const r of CURATED_ROUTES) {
      await expect(
        page.getByRole('link', { name: new RegExp(escapeRe(r.name)) }),
        `${r.slug} is missing from the index`,
      ).toBeVisible();
    }

    await expect(page.getByTestId('route-count')).toContainText(
      `All ${CURATED_ROUTES.length} routes`,
    );
  });

  // 🔴 The hub must say what it cannot tell you, not only the route
  // pages. This is where somebody comparing routes looks for a distance.
  test('the hub says the road figures are missing', async ({ page }) => {
    await page.goto('/routes');
    await expect(page.locator('main')).toContainText('road distances and driving times');
    await expect(page.locator('main')).toContainText('straight-line distance');
  });

  test('filtering narrows the list without a reload', async ({ page }) => {
    await page.goto('/routes');
    await page.getByRole('button', { name: 'Winter' }).click();
    await expect(page.getByTestId('route-count')).toContainText(/Showing \d+ of/);
    // Andalusia is the only winter route, and its months wrap the year
    // end — "Nov–Mar", not "Jan–Mar, Nov–Dec".
    await expect(page.locator('main')).toContainText('Nov–Mar');
  });
});

test.describe('a route page', () => {
  for (const route of CURATED_ROUTES) {
    test(`${route.slug} renders its stages and states no road figures`, async ({
      page,
    }) => {
      const errors = collectConsoleErrors(page);
      await page.goto(`/routes/${route.slug}`);

      await expect(page.getByRole('heading', { level: 1 })).toContainText(route.name);

      // The duration we curated, and the straight-line distance, labelled.
      await expect(page.getByTestId('figure-duration')).toContainText(
        `${route.days} days`,
      );
      const straight = page.getByTestId('figure-straight-line');
      await expect(straight).toContainText(/\d+ km/);
      await expect(straight).toContainText('straight line');

      // 🔴 THE CORE ASSERTION OF THIS CARD.
      //
      // Both road slots are present and both are empty. If a routing
      // engine is ever wired in, these fail — which is correct: road
      // figures appearing on the site is a change that should be
      // announced by a failing test, not discovered later.
      await expect(page.getByTestId('figure-road-distance-missing')).toBeVisible();
      await expect(page.getByTestId('figure-driving-time-missing')).toBeVisible();
      await expect(page.getByTestId('figure-road-distance')).toHaveCount(0);
      await expect(page.getByTestId('figure-driving-time')).toHaveCount(0);

      // And nowhere on the page does a number claim to be a drive.
      const main = (await page.locator('main').textContent()) ?? '';
      expect(main, 'the page states a driving time').not.toMatch(
        /\b\d+\s*(h|hours|hrs)\s+(of\s+)?driv/i,
      );
      expect(main, 'the page states a road distance').not.toMatch(
        /\b\d+\s*km\s+by road/i,
      );

      // Every stage is on the page, in order, with its reason.
      for (const stage of route.stages) {
        await expect(
          page.getByRole('heading', { name: stage.name, exact: true }),
          `stage ${stage.name} is missing`,
        ).toBeVisible();
      }

      // Attribution is a licence condition, not a nicety.
      await expect(page.getByTestId('route-sources')).toBeVisible();
      await expect(page.getByTestId('route-sources')).toContainText(
        'OpenStreetMap',
      );

      expect(errors, `console errors on /routes/${route.slug}`).toEqual([]);
    });
  }

  // 🔴 The map has to actually mount. Tests on this project once went
  // green while the map was dead, which is why this is asserted rather
  // than assumed from "the page rendered".
  test('the map mounts, and says its line is not a road', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/routes/france-atlantic-coast');

    const map = page.getByTestId('route-map');
    await expect(map).toBeVisible();
    // MapLibre puts a canvas in it once WebGL is available. Where it is
    // not, the component renders its own notice instead — either is a
    // pass, a blank box is not.
    const drew = await Promise.race([
      map
        .locator('canvas')
        .first()
        .waitFor({ state: 'attached', timeout: 15_000 })
        .then(() => 'canvas' as const)
        .catch(() => null),
      page
        .getByTestId('route-map-unsupported')
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => 'notice' as const)
        .catch(() => null),
    ]);
    expect(drew, 'the map neither drew nor explained itself').not.toBeNull();

    // The legend that stops the dashed line reading as a road.
    await expect(page.locator('main')).toContainText('It is not the road');

    expect(errors, 'console errors on the map page').toEqual([]);
  });

  test('a campsite beside a stage links to its own page', async ({ page }) => {
    await page.goto('/routes/tuscany-hill-towns');
    const link = page.locator('main a[href^="/camping/"]').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href, 'the campsite link has no href').toBeTruthy();
    await link.click();
    await expect(page).toHaveURL(new RegExp(escapeRe(href!)));
    // 🔴 It must be a real campsite page, not the 404. The accented
    // region slugs are the thing that breaks here — "Šibensko-Kninska"
    // has to become "sibensko-kninska", and a second implementation of
    // that rule in the web layer would 404 silently.
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText(
      /not found/i,
    );
  });
});

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
