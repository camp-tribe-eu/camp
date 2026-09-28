import { expect, test } from './api-request';
import { CURATED_ROUTES } from '../../src/data/routes';
import { SERVICE_KINDS } from '../../src/lib/route-services';

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

      // 🔴 CAMP-113 — the services block, on every stage, with every
      // kind. Counted rather than sampled: a kind that stopped
      // rendering would otherwise be invisible, because the page would
      // still look complete.
      //
      // 🔴 This must NOT require any service to EXIST, for the reason
      // the campsite assertion below already learned the hard way: CI's
      // fixture is not the production database, and a test coupled to
      // how much data happens to be loaded fails on the honest path
      // working correctly. What is invariant is that every stage asks
      // about every kind and answers in words either way.
      const blocks = page.getByTestId('stage-services');
      await expect(blocks).toHaveCount(route.stages.length);
      for (let i = 0; i < route.stages.length; i++) {
        const block = blocks.nth(i);
        // 🔴 THREE states, not two, and the third is why this assertion
        // had to change. When the API could not be reached the page must
        // say so once — NOT render seven "our database holds none within
        // 25 km" lines, which is a statement about the ground made from
        // a failed fetch. The old form asserted
        // `found + absent === 1` per kind, which all-absent satisfies
        // perfectly, so it was green on exactly that bug.
        const unavailable = await block
          .getByTestId('stage-services-unavailable')
          .count();
        if (unavailable > 0) {
          for (const kind of SERVICE_KINDS) {
            expect(
              await block.getByTestId(`service-${kind}-absent`).count(),
              `stage ${i + 1} of ${route.slug} claims ${kind} is absent on a stage it could not look at`,
            ).toBe(0);
          }
          continue;
        }
        for (const kind of SERVICE_KINDS) {
          const found = block.getByTestId(`service-${kind}`);
          const absent = block.getByTestId(`service-${kind}-absent`);
          expect(
            (await found.count()) + (await absent.count()),
            `stage ${i + 1} of ${route.slug} says nothing about ${kind}`,
          ).toBe(1);
        }
      }

      expect(errors, `console errors on /routes/${route.slug}`).toEqual([]);
    });
  }

  // 🔴 CAMP-113's own acceptance, read off the rendered page rather than
  // asserted about the code: a missing field says "unknown", and nothing
  // on the page is a rating or somebody else's photograph.
  test('a missing field says unknown, and no rating or photo appears', async ({
    page,
  }) => {
    await page.goto('/routes/france-atlantic-coast');

    const services = page.getByTestId('stage-services').first();
    // The fixture's La Rochelle rows are chosen so that at least one of
    // each of these is true; see ci-seed-route-poi.sql.
    await expect(services).toContainText('unknown');
    await expect(services).toContainText('straight line');
    // 🔴 A typographic apostrophe, because that is what the page
    // renders (&rsquo;). Asserting the ASCII one passes nowhere and
    // looks like a missing paragraph rather than a missing character.
    await expect(services).toContainText(
      'OpenStreetMap’s own syntax, unchanged',
    );

    // 🔴 No invented rating. Nothing in this block may look like one —
    // no stars, no "4.5", no "out of 5".
    const text = (await services.textContent()) ?? '';
    expect(text, 'a star crept into the services block').not.toMatch(/[★☆]/);
    expect(text, 'a rating crept into the services block').not.toMatch(
      /\b\d(\.\d)?\s*\/\s*5\b|\bout of 5\b|\bstars?\b/i,
    );
    // 🔴 No third-party photograph. There is no <img> in this block and
    // there is not supposed to be one until CAMP-52.
    await expect(services.locator('img')).toHaveCount(0);

    // 🔴 And the fuel price is a national weekly average, said so.
    const fuel = page.getByTestId('route-fuel-prices');
    await expect(fuel).toBeVisible();
    await expect(fuel).toContainText('European Commission');
    await expect(fuel).toContainText('not for any station');
  });

  // 🔴 The narrowing, stated on the page. CAMP-113 depends on CAMP-111
  // and CAMP-111 is not done, so this ships OSM alone — and a reader has
  // to be able to tell that from the page, or an absent charging point
  // reads as "there is no charging point".
  test('the page says the services come from OpenStreetMap alone', async ({
    page,
  }) => {
    await page.goto('/routes/france-atlantic-coast');
    await expect(page.getByTestId('route-sources')).toContainText(
      'come from OpenStreetMap alone',
    );
    await expect(page.getByTestId('route-sources')).toContainText(
      'no ratings and no photographs',
    );
  });

  // 🔴 That explanation used to be gated on `serviceCount > 0`, so it
  // disappeared exactly when the block was all-absent — the one moment a
  // reader most needs to be told that the only source is OpenStreetMap
  // and that a gap in it is not a gap in the world. Asserted on every
  // route, because the fixture makes most of them all-absent in CI.
  test('…on every route, including the ones where we found nothing', async ({
    page,
  }) => {
    for (const route of CURATED_ROUTES) {
      await page.goto(`/routes/${route.slug}`);
      await expect(
        page.getByTestId('route-sources'),
        `${route.slug} drops the source note`,
      ).toContainText('come from OpenStreetMap alone');
    }
  });

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

        // 🔴 Assert what must be PRESENT, never sanitise what must be
        // absent — and CodeQL was right to fail the first version.
        //
        // That one pulled the <h1> out with a regex and stripped its
        // tags with a single `.replace(/<[^>]+>/g, '')` to read the
        // text. CodeQL flagged it high as
        // js/incomplete-multi-character-sanitization: a one-pass strip
        // is defeated by nesting, because removing the inner match of
        // `<scr<script>ipt>` reassembles the outer one. Nothing is
        // exploitable in a test that reads our own output — but this is
        // precisely the snippet somebody copies somewhere it matters,
        // and a sanitiser is the wrong tool for the job either way.
        //
        // A 200 alone is not enough: Next answers an unknown campsite
        // with the PRERENDERED 404 page, which is a 200 to a fetch. So
        // the question is "is this a campsite page", and a campsite page
        // has one unambiguous positive marker that the 404 page does not
        // — the Campground node its JSON-LD always carries (jsonld.ts
        // emits it unconditionally). Looking for something that must be
        // there needs no parsing and cannot be evaded.
        const html = await res.text();
        expect(html, `${href} is not a campsite page`).toContain(
          '"@type":"Campground"',
        );
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
