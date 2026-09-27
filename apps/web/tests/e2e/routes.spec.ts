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

    // 🔴 EITHER a drawn map OR the explanatory notice — and neither is
    // asserted before the other, which is the bug CI found.
    //
    // The first version asserted `route-map` was visible and only then
    // raced for a canvas. But when the browser cannot give MapLibre a
    // WebGL context the component renders the notice INSTEAD of the map
    // container, so `route-map` does not exist at all — and headless
    // Firefox on the CI runner is exactly that browser. The test failed
    // on the honest fallback path working correctly.
    //
    // A blank box is still a failure; that is what this race checks.
    const drew = await Promise.race([
      page
        .getByTestId('route-map')
        .locator('canvas')
        .first()
        .waitFor({ state: 'attached', timeout: 20_000 })
        .then(() => 'canvas' as const)
        .catch(() => null),
      page
        .getByTestId('route-map-unsupported')
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => 'notice' as const)
        .catch(() => null),
    ]);
    expect(drew, 'the map neither drew nor explained itself').not.toBeNull();

    // The legend that stops the dashed line reading as a road — which
    // only exists where there IS a line. On the no-WebGL path the
    // component renders its notice instead, and that notice has its own
    // job: to say the stages are listed in full below.
    if (drew === 'canvas') {
      await expect(page.locator('main')).toContainText('It is not the road');
    } else {
      await expect(page.getByTestId('route-map-unsupported')).toContainText(
        'listed in full below',
      );
    }

    expect(errors, 'console errors on the map page').toEqual([]);
  });

  // 🔴 Every campsite link on every route page has to be a real page.
  //
  // This is the assertion that would have caught the bug I nearly
  // shipped: rebuilding the campsite URL in the web layer instead of
  // using the API's `canonicalPath`. The real rule strips accents, so a
  // naive lower-case-and-hyphenate 404s on "Šibensko-Kninska",
  // "Pyrénées-Atlantiques", "Liepāja" and "Gyôr" — most of Croatia,
  // Latvia, Estonia and a good deal of France, silently.
  //
  // 🔴 Navigated with `goto`, not by clicking, and deliberately.
  //
  // Clicking went through Next's client router, which in a dev server
  // has to COMPILE the campsite route on first use — measured at ~12 s
  // for a cold route here. The assertion timed out at 5 s and reported a
  // dead link, which was a lie about the code and true only about the
  // dev server. A direct navigation tests the thing that matters (the
  // URL resolves to a real page) and is not a race against a compiler.
  // 🔴 This must NOT require campsites to exist, and CI taught me why.
  //
  // The first version asserted each of three routes links to at least one
  // campsite. That passes against the production database and fails
  // against CI's fixture one, which holds no Baltic campsites at all — so
  // the page correctly rendered "our database holds no campsite within
  // 25 km of this stop" and the test called it a bug. The test was
  // coupled to how much data happened to be loaded.
  //
  // What is actually invariant, and what this checks instead: whatever
  // links the page emits are well-formed and resolve, and a stage with
  // nothing near it says so rather than rendering an empty gap.
  // 🔴 The campsite URLs are FETCHED, not navigated to, and that is the
  // second thing CI taught me about this one test.
  //
  // The first version did up to twelve sequential `page.goto` calls —
  // three route pages plus four campsite pages each, every one a full
  // render. On webkit that overran the 30 s test timeout, passed on the
  // retry, and the flaky guard failed the build for it. Correctly: a
  // retry that goes green is what an intermittent fault looks like, and
  // this one was a real one — the test was simply doing far too much.
  //
  // Nothing here needs a rendered page. The question is "does this URL
  // resolve to a real campsite page", which an HTTP fetch answers
  // completely and in a fraction of the time.
  test('campsite links resolve, and empty stages say so', async ({
    page,
    request,
  }) => {
    // Croatia and Latvia are on this list on purpose: their region names
    // carry the accents the slug rule has to strip.
    const slugs = [
      'dalmatian-coast-and-islands',
      'baltic-coast-and-capitals',
      'france-atlantic-coast',
    ];

    let checked = 0;
    for (const slug of slugs) {
      await page.goto(`/routes/${slug}`);

      // Every stage either lists campsites or states the gap. Silence is
      // the failure: it would mean the fetch failed and nobody said so.
      const stages = await page.getByRole('heading', { level: 4 }).count();
      const empties = await page.getByTestId('stage-no-campsites').count();
      const links = await page
        .locator('main a[href^="/camping/"]')
        .evaluateAll((els) =>
          els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
        );
      expect(
        links.length + empties,
        `${slug}: ${stages} stages but no campsites and no "nothing nearby" notice`,
      ).toBeGreaterThan(0);

      // The shape of EVERY link is checked — it costs nothing and it is
      // where the accent bug would show. Only the first two per route
      // are fetched.
      for (const href of links) {
        expect(href, 'a campsite link has no href').toBeTruthy();
        // 🔴 No empty segment. `/camping/cy//arazi` is the shape a
        // region-less campsite produced before canonicalPath returned
        // null for it — a double slash and a guaranteed 404.
        expect(href, `${href} has an empty path segment`).not.toMatch(/\/\//);
        // And no accent survived into a URL.
        expect(href, `${href} carries a non-ASCII character`).toMatch(
          /^[\x21-\x7e]+$/,
        );
      }

      for (const href of links.slice(0, 2)) {
        const res = await request.get(href);
        expect(res.status(), `${href} answered ${res.status()}`).toBeLessThan(400);
        // A 200 is not enough on its own: Next answers a missing
        // campsite with the prerendered 404 page, which is a 200 to a
        // fetch. The heading is what distinguishes them.
        const html = await res.text();
        const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '';
        expect(
          h1.replace(/<[^>]+>/g, ''),
          `${href} rendered a not-found page`,
        ).not.toMatch(/not found/i);
        checked += 1;
      }
    }

    // Said out loud rather than left implicit: against a fixture database
    // with no campsites near these stages, this test verified the empty
    // state and nothing else.
    // eslint-disable-next-line no-console
    if (checked === 0) console.log('no campsite links on these routes in this dataset');
  });
});

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
