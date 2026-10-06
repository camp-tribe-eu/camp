import { expect, test, type Page } from './api-request';
import {
  ACCESSIBILITY_KEYS,
  GENERAL_AMENITY_KEYS,
  SPOT_TYPES,
} from '@/lib/api';
import {
  DETAIL_ZOOM,
  VIEW_BUDGET_BYTES,
  chunkWeight,
  type RegionSummary,
} from '@/lib/map-chunks';
import { INITIAL_VIEW } from '@/lib/map-sources';

// CAMP-35 / CAMP-25 — the map filters, in every browser and at every width.
//
// 🔴 The first test is the card's own lesson from UST-466: a new block
// silently disappeared in one display mode and nobody noticed for weeks.
// Playwright runs this file at 1280, 768 and ~390 px and in three
// engines, so "every filter is present" is asserted six times rather
// than assumed once on a laptop.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

const map = (page: Page) => page.getByTestId('map');

/** What the map is currently drawing, published on the container. */
async function shown(page: Page): Promise<number> {
  return Number(await map(page).getAttribute('data-shown'));
}

async function excluded(page: Page): Promise<number> {
  return Number(await map(page).getAttribute('data-unknown-excluded'));
}

/**
 * The same two numbers, scoped to the visible area.
 *
 * 🔴 CAMP-133: these are what the PANEL prints. `data-shown` and
 * `data-unknown-excluded` are over everything fetched, which is the
 * map's bookkeeping and grows as the reader pans; the panel may only
 * talk about a set the reader can see.
 */
async function shownInView(page: Page): Promise<number> {
  return Number(await map(page).getAttribute('data-in-view'));
}

async function excludedInView(page: Page): Promise<number> {
  return Number(
    await map(page).getAttribute('data-in-view-unknown-excluded'),
  );
}

/**
 * What the map says about itself, read in ONE task.
 *
 * Three `getAttribute` calls are three round trips, and the map moves
 * between them; one `evaluate` reads three attributes of one instant.
 */
async function pulse(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="map"]');
    return {
      state: el?.getAttribute('data-map-state') ?? '',
      camera: el?.getAttribute('data-camera') ?? '',
      total: Number(el?.getAttribute('data-total') ?? 0),
    };
  });
}

/**
 * Wait until the map has decided what it is looking at, and is looking
 * at it.
 *
 * 🔴 CAMP-169. `data-map-state` answers "is anything being FETCHED", and
 * that is not the question a spec that reads counts needs answered. The
 * counts and the bounds describe the view at the last moment they were
 * computed, which is `moveend`; for the length of an ease — about 500 ms
 * after a click on the zoom control — they belong to the view the reader
 * has just left, and the state says `ready` throughout.
 *
 * Measured 29.09.2026, on webkit-desktop against a production build built
 * from the CI fixture, 60 runs of "says how many it is hiding" at four
 * workers with no retries: 17 failed on one pass and 7 on the next. The
 * failures read `Expected: 21..40, Received: 20`, and `Expected: 40,
 * Received: 20` — the number in the card — was three of the 17.
 *
 * On the second pass the spec asked the map, at the instant it read
 * `strict` and `hidden`, whether the camera was moving: 8 runs read a
 * moving camera and 7 of them failed; 52 read a still one and none did.
 * The opening view holds 40 with toilets ticked (13 recorded + 27 not),
 * the view one zoom level in holds 20, and 40 to 20 is what one level
 * does to a fixture piled around the centre. Nothing was lost and nothing
 * was dropped; the spec asked a moving map a question that has only one
 * answer at rest.
 *
 * `decided` is "not `loading`": the map begins in `loading` and leaves it
 * for `wide`, `ready` or `failed`. `still` is `data-camera`, written by
 * the map itself once the numbers for the resting view are in the DOM.
 */
async function atRest(page: Page, timeout = 20_000) {
  await expect
    .poll(
      async () => {
        const p = await pulse(page);
        return p.camera === 'still' && p.state !== 'loading'
          ? 'at rest'
          : `state=${p.state || '(none)'} camera=${p.camera || '(none)'}`;
      },
      { timeout, message: 'the map never came to rest' },
    )
    .toBe('at rest');
}

/**
 * Wait until the map is drawing individual campsites, has finished, and
 * has stopped moving.
 *
 * 🔴 This used to be `data-total > 0`, and both halves of that were
 * wrong once CAMP-127 landed.
 *
 * It is not a barrier: `data-total > 0` is the FIRST chunk, not the
 * last. A baseline captured there photographs a half-loaded map —
 * "clearing puts every campsite back" recorded 35 and then honestly
 * found 69, because the rest arrived in between. It failed on four
 * browsers for a map that was right.
 *
 * And on the full dataset it is never reached at all: /map opens too
 * wide for markers, so no chunk is fetched and `data-total` stays 0.
 * CI's fixture is small enough that every chunk in view fits, so there
 * the map opens in detail and the same helper worked — which is why
 * this failed in only one of the two places at a time.
 *
 * So: zoom in until there are markers, then wait for the fetching to
 * stop. Clicking the real control rather than reaching into the map
 * object, for the same reason the counts are published as attributes.
 *
 * 🔴 CAMP-169. "Zoom in until there are markers" was decided by
 * `data-total === 0`, which cannot tell "too wide for markers" from "the
 * chunks have not arrived yet". On the fixture, which opens in detail,
 * a slow first fetch made the helper zoom a map that needed no zooming —
 * and that one click did two kinds of damage.
 *
 * It started an ease the spec then read through (see `atRest`). And it
 * changed WHAT was fetched: a chunk is requested when its region overlaps
 * the view at the moment of the refresh, so a camera that has already
 * moved in asks for fewer regions than one that has not. "Step-free
 * access is a strictly smaller answer than any access" failed in one of
 * 95 whole-file runs on webkit, `Expected: < 8, Received: 8`, because the
 * region holding the fixture's one `wheelchair=limited` campsite was never
 * fetched. Two tests, one cause, and the second was found only because the
 * first was measured properly.
 *
 * So it now waits for the map to decide (`atRest`) and clicks only when
 * the answer is `wide`. Each click is followed by another wait, because
 * the state read mid-ease is still the one from before the click.
 */
async function loaded(page: Page) {
  const zoomIn = page.locator('.maplibregl-ctrl-zoom-in');
  await expect(zoomIn).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await atRest(page);
    if ((await pulse(page)).state !== 'wide') break;
    await zoomIn.click();
  }
  // `ready` now means what it says — published only when no fetch is
  // outstanding. The camera needs no second look here: the last thing the
  // loop did was `atRest`, and nothing has touched the map since. One
  // reading of state and total, so neither is seen after the other moved.
  await expect
    .poll(
      async () => {
        const p = await pulse(page);
        return p.state === 'ready' && p.total > 0
          ? 'loaded'
          : `state=${p.state || '(none)'} camera=${p.camera || '(none)'} total=${p.total}`;
      },
      { timeout: 20_000, message: 'the map never finished loading' },
    )
    .toBe('loaded');
}

/**
 * Everything `loaded` does, plus the bounds the map publishes.
 *
 * 🔴 `publishCounts` runs on the map's `idle` event, which is a
 * different moment from "the data finished loading" — so the state can
 * say ready while `data-bounds` has never been written. A spec that
 * reads the bounds waits for them to BE something, never for a message
 * to be absent.
 */
async function zoomToDetail(page: Page) {
  await loaded(page);
  await expect
    .poll(async () => (await map(page).getAttribute('data-bounds')) ?? '', {
      timeout: 20_000,
    })
    .not.toBe('');
}


/**
 * Everything the map publishes about the view, read in one task, so the
 * numbers and the box they are numbers of belong to one moment.
 */
async function publishedView(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="map"]');
    const n = (a: string) => Number(el?.getAttribute(a));
    return {
      bounds: el?.getAttribute('data-bounds') ?? '',
      inView: n('data-in-view'),
      inViewTotal: n('data-in-view-total'),
      excluded: n('data-in-view-unknown-excluded'),
      shown: n('data-shown'),
      total: n('data-total'),
      state: el?.getAttribute('data-map-state') ?? '',
    };
  });
}

/**
 * Freeze the page's animation frames for `ms`, then let them run.
 *
 * 🔴 Removes the clock from a race instead of hoping the runner is slow.
 * MapLibre eases on animation frames, so while they are held a zoom that
 * has been started (`movestart` fires at once) cannot end: the camera says
 * `moving` and the state says whatever it said before, for exactly `ms`.
 * That is the stale reading a careless helper acts on, made to last as long
 * as the test wants rather than as long as the machine happens to take.
 *
 * Only the page's own `window` is wrapped. Playwright measures a click's
 * stability in its own world, which keeps the real function.
 */
async function holdFrames(page: Page, ms: number) {
  await page.evaluate((ms) => {
    const real = window.requestAnimationFrame.bind(window);
    const queued: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (cb) => {
      queued.push(cb);
      return -1;
    };
    setTimeout(() => {
      window.requestAnimationFrame = real;
      for (const cb of queued.splice(0)) real(cb);
    }, ms);
  }, ms);
}

/** What the map had published, and what the camera said, at one write. */
interface CameraStep {
  camera: string;
  view: Awaited<ReturnType<typeof publishedView>> | null;
}

/**
 * Every value `data-camera` takes, in order, from the moment the map
 * element exists — each with the numbers the map had published at that
 * moment.
 *
 * 🔴 Recorded, not sampled. The value that matters lasts about 500 ms, and
 * a poll can step straight over it — an assertion about a transient that
 * it may not see would pass or fail by the speed of the machine, which is
 * the very thing this file is being repaired for. A MutationObserver sees
 * every write, and `oldValue` keeps the ones a single batch would merge.
 *
 * 🔴 And the numbers are read INSIDE the observer, in the same task as the
 * write. `still` is a promise about them — "what is published now is what
 * you will see when nothing moves" — and a spec that reads them a moment
 * later cannot tell a `still` that was true from one that was written
 * ahead of them and got lucky.
 */
async function recordCamera(page: Page) {
  await page.addInitScript(() => {
    const log: unknown[] = [];
    (window as unknown as { __camera: unknown[] }).__camera = log;
    const view = () => {
      const el = document.querySelector('[data-testid="map"]');
      const n = (a: string) => Number(el?.getAttribute(a));
      return {
        bounds: el?.getAttribute('data-bounds') ?? '',
        inView: n('data-in-view'),
        inViewTotal: n('data-in-view-total'),
        excluded: n('data-in-view-unknown-excluded'),
        shown: n('data-shown'),
        total: n('data-total'),
        state: el?.getAttribute('data-map-state') ?? '',
      };
    };
    const watch = () => {
      const el = document.querySelector('[data-testid="map"]');
      if (!el) return false;
      log.push({ camera: el.getAttribute('data-camera') ?? '', view: view() });
      new MutationObserver((records) => {
        records.forEach((_, i) => {
          // A batch merges writes; the value each one left is the next
          // record's `oldValue`, and the last one's is the current value.
          // The numbers can only be read as they are NOW, so they are
          // recorded on the last write of a batch and left off the others.
          const last = i + 1 === records.length;
          log.push({
            camera:
              (last
                ? el.getAttribute('data-camera')
                : records[i + 1].oldValue) ?? '',
            view: last ? view() : null,
          });
        });
      }).observe(el, {
        attributes: true,
        attributeFilter: ['data-camera'],
        attributeOldValue: true,
      });
      return true;
    };
    if (!watch()) {
      const finder = new MutationObserver(() => {
        if (watch()) finder.disconnect();
      });
      finder.observe(document, { childList: true, subtree: true });
    }
  });
}

async function cameraSteps(page: Page): Promise<CameraStep[]> {
  return page.evaluate(
    () => (window as unknown as { __camera?: CameraStep[] }).__camera ?? [],
  );
}

/** Just the words, for a message and for "did it ever say moving". */
async function cameraLog(page: Page): Promise<string[]> {
  return (await cameraSteps(page)).map((s) => s.camera);
}

async function skipWithoutWebGL(page: Page) {
  const ok = await page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
  test.skip(!ok, 'no WebGL2 in this browser — the map, and so the filters, cannot render');
}

test.describe('/map filters', () => {
  // 🔴 90 s a test, not Playwright's default 30.
  //
  // Since CAMP-127 a map test is: open the page, zoom in until the map
  // switches from region circles to markers, and wait for one file per
  // region in view to arrive. Measured on this machine with the OSM
  // pipeline running alongside — which is what a CI runner with six
  // browser projects looks like — the suite took 1.5 minutes for 30
  // tests, and several individual tests crossed 30 s and failed on the
  // budget rather than on anything they assert.
  //
  // Same reasoning as the search suite's 20 s: a limit the machine can
  // cross while working correctly turns `check-flaky.mjs` into a red
  // `main`. This is above the worst honest measurement, and a genuinely
  // broken map still fails in seconds with a clear message.
  test.describe.configure({ timeout: 90_000 });

  test('every filter is present, at this browser and this width', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(page.getByTestId('map-filters')).toBeVisible();

    // 🔴 Each one individually, not a count. A count passes when one
    // control is missing and another was added twice, which is exactly
    // the kind of near-miss the UST-466 failure was.
    for (const t of SPOT_TYPES) {
      await expect(
        page.getByTestId(`filter-type-${t}`),
        `type filter "${t}" is missing at this width`,
      ).toBeVisible();
    }
    for (const a of [...GENERAL_AMENITY_KEYS, ...ACCESSIBILITY_KEYS]) {
      await expect(
        page.getByTestId(`filter-amenity-${a}`),
        `amenity filter "${a}" is missing at this width`,
      ).toBeVisible();
    }
  });

  // ── CAMP-122: bulk controls ─────────────────────────────────────────
  //
  // 🔴 In the document at every width, like every other control in this
  // panel. A bulk action behind a menu on a phone is a bulk action nobody
  // uses, which is the same failure UST-466 taught and CAMP-35 recorded.
  test('every group carries its own All and None, at this width', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    for (const group of ['type', 'amenity', 'access']) {
      await expect(
        page.getByTestId(`filter-${group}-all`),
        `"All" missing on ${group} at this width`,
      ).toBeVisible();
      await expect(
        page.getByTestId(`filter-${group}-none`),
        `"None" missing on ${group} at this width`,
      ).toBeVisible();
    }
  });

  test('All ticks a whole group and None clears only that group', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    // 🔴 ACCESSIBILITY FIRST, and that order is the test.
    //
    // The first version clicked Facilities-All first, when there was
    // nothing accessible to destroy — and so it passed while Facilities
    // "All" silently untucked both wheelchair filters. Review found it by
    // reversing these two lines.
    await page.getByTestId('filter-access-all').click();
    for (const a of ACCESSIBILITY_KEYS) {
      await expect(page.getByTestId(`filter-amenity-${a}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    await page.getByTestId('filter-amenity-all').click();
    for (const a of ACCESSIBILITY_KEYS) {
      await expect(
        page.getByTestId(`filter-amenity-${a}`),
        `${a} was cleared by the facilities group`,
      ).toHaveAttribute('aria-pressed', 'true');
    }
    for (const a of GENERAL_AMENITY_KEYS) {
      await expect(page.getByTestId(`filter-amenity-${a}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }

    // 🔴 "None" on one group must not empty another. Accessibility is a
    // separate question on purpose (CAMP-25), and a bulk control that
    // quietly reached across the divider would undo that.
    await page.getByTestId('filter-amenity-none').click();
    for (const a of GENERAL_AMENITY_KEYS) {
      await expect(page.getByTestId(`filter-amenity-${a}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    for (const a of ACCESSIBILITY_KEYS) {
      await expect(
        page.getByTestId(`filter-amenity-${a}`),
        `${a} was cleared by the facilities group`,
      ).toHaveAttribute('aria-pressed', 'true');
    }
  });

  // 🔴 The other direction, which no test clicked at all: Accessibility
  // "None" must not empty the facilities either.
  test('Accessibility None leaves the facilities alone', async ({ page }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await page.getByTestId('filter-amenity-all').click();
    await page.getByTestId('filter-access-all').click();
    await page.getByTestId('filter-access-none').click();
    for (const a of GENERAL_AMENITY_KEYS) {
      await expect(
        page.getByTestId(`filter-amenity-${a}`),
        `${a} was cleared by the accessibility group`,
      ).toHaveAttribute('aria-pressed', 'true');
    }
    for (const a of ACCESSIBILITY_KEYS) {
      await expect(page.getByTestId(`filter-amenity-${a}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });

  // 🔴 The chip, which is how people actually clear a filter.
  //
  // The first fix put the reset in the bulk "None" handler only, and the
  // test below drove that button — so it passed over a live bug reachable
  // in three clicks. Review walked it. This drives the chip.
  test('unticking the last amenity also clears "include unrecorded"', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await page.getByTestId('filter-amenity-toilets').click();
    await page.getByTestId('filter-include-unknown').locator('input').check();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('unknown'))
      .toBe('1');

    await page.getByTestId('filter-amenity-toilets').click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('unknown'))
      .toBeNull();
    // And it is not silently re-applied to the next thing ticked.
    await page.getByTestId('filter-amenity-shower').click();
    await expect(
      page.getByTestId('filter-include-unknown').locator('input'),
    ).not.toBeChecked();
  });

  // 🔴 The other direction: clearing one group while another still holds
  // a selection must NOT clear the flag — there is still something for
  // it to be unknown about. Nothing tested this, and a bare `false`
  // survived the suite.
  test('clearing one group keeps the flag while another still filters', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await page.getByTestId('filter-amenity-toilets').click();
    await page.getByTestId('filter-amenity-wheelchair').click();
    await page.getByTestId('filter-include-unknown').locator('input').check();

    await page.getByTestId('filter-amenity-none').click();
    await expect(
      page.getByTestId('filter-include-unknown').locator('input'),
    ).toBeChecked();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('unknown'))
      .toBe('1');
  });

  // 🔴 A flag with no control, carried in a shareable URL.
  test('clearing the last amenity also clears "include unrecorded"', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await page.getByTestId('filter-amenity-toilets').click();
    await page.getByTestId('filter-include-unknown').locator('input').check();
    // history.replaceState happens in an effect, so this is polled like
    // the assertion below it — read synchronously it races the render.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('unknown'))
      .toBe('1');

    await page.getByTestId('filter-amenity-none').click();
    // Otherwise the reader is left on /map?unknown=1 with the checkbox
    // gone (it renders only while an amenity is filtered) and "Clear
    // filters" hidden (nothing is being filtered) — and the choice is
    // silently re-applied to whatever they tick next.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('unknown'))
      .toBeNull();
    await page.getByTestId('filter-amenity-shower').click();
    await expect(
      page.getByTestId('filter-include-unknown').locator('input'),
    ).not.toBeChecked();
  });

  test('a bulk control that has nothing to do is disabled, not removed', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    // Nothing is ticked on arrival, so "None" has nothing to do.
    await expect(page.getByTestId('filter-amenity-none')).toBeDisabled();
    await expect(page.getByTestId('filter-amenity-all')).toBeEnabled();

    await page.getByTestId('filter-amenity-all').click();
    // 🔴 Still present, so the control under the reader's thumb does not
    // move between one tap and the next.
    await expect(page.getByTestId('filter-amenity-all')).toBeVisible();
    await expect(page.getByTestId('filter-amenity-all')).toBeDisabled();
    await expect(page.getByTestId('filter-amenity-none')).toBeEnabled();

    // 🔴 The fact, not the claim. toBeDisabled() is satisfied by
    // aria-disabled on its own, so removing the real attribute left this
    // test green while the button was still clickable — proved by
    // mutation in review. Both are asserted by name, and the behaviour
    // is driven: clicking a disabled "All" must change nothing.
    await expect(page.getByTestId('filter-amenity-all')).toHaveAttribute(
      'disabled',
      '',
    );
    await expect(page.getByTestId('filter-amenity-all')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // 🔴 Driven from a state where a working click WOULD change the URL.
    //
    // The first version forced a click on "All" when everything was
    // already ticked, so the URL was identical whether the click landed
    // or not — the assertion passed in both worlds and proved nothing.
    // Review caught it. "None" here has real work to do, so if `disabled`
    // ever stops being honoured the URL moves and this fails.
    await page.getByTestId('filter-amenity-none').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('amenities')).toBeNull();
    const before = page.url();
    await page.getByTestId('filter-amenity-none').click({ force: true });
    expect(page.url(), 'a disabled control still did something').toBe(before);
  });

  test('the bulk controls are reachable by keyboard', async ({ page }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    const all = page.getByTestId('filter-type-all');
    await all.focus();
    await expect(all).toBeFocused();
    await page.keyboard.press('Enter');
    for (const t of SPOT_TYPES) {
      await expect(page.getByTestId(`filter-type-${t}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
  });

  test('accessibility keeps its own heading, not buried in facilities', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    // CAMP-25 asks for a separate category. A reader who needs it should
    // not have to read eight other tick-boxes to find it.
    await expect(
      page.getByRole('group', { name: 'Accessibility' }),
    ).toBeVisible();
  });

  test('ticking a facility narrows what the map draws', async ({ page }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    const all = await shown(page);
    await page.getByTestId('filter-amenity-toilets').click();
    await expect.poll(() => shown(page)).toBeLessThan(all);
    expect(await shown(page)).toBeGreaterThan(0);
  });

  // 🔴 The heart of CAMP-35. A campsite whose toilets nobody recorded is
  // not a campsite without toilets, and the map must say so rather than
  // quietly dropping it.
  test('says how many it is hiding for want of data, and can show them', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    await page.getByTestId('filter-amenity-toilets').click();
    // 🔴 CAMP-133: the in-view numbers, because the panel's sentence is
    // about the visible area. Comparing the panel's text against the
    // fetched-scope attribute would be comparing two different sets —
    // the exact mistake the card is about, rebuilt in the test.
    await expect.poll(() => excludedInView(page)).toBeGreaterThan(0);
    const strict = await shownInView(page);
    const hidden = await excludedInView(page);

    // 🔴 The two scopes are nested, not independent: what is hidden on
    // screen is part of what is hidden across everything fetched. If
    // this ever inverts, one of them is counting the wrong set.
    expect(await excluded(page)).toBeGreaterThanOrEqual(hidden);

    await expect(page.getByTestId('filter-include-unknown')).toContainText(
      String(hidden),
    );

    await page.getByTestId('filter-include-unknown').locator('input').check();
    // Exactly the number it promised — not "more", which would leave the
    // sentence technically true and useless.
    await expect.poll(() => shownInView(page)).toBe(strict + hidden);
    // And it stops claiming to hide what it is now drawing.
    await expect.poll(() => excludedInView(page)).toBe(0);
    // And so does the fetched-scope one, which is the number this test
    // used to drive — kept so the change of scope did not quietly drop
    // an assertion.
    expect(await excluded(page)).toBe(0);
  });

  // 🔴 CAMP-169. The test above failed on webkit in about one run in four,
  // and the reason was in the helper it stands on, not in it: `ready` said
  // "nothing is being fetched" while the camera was still easing, and the
  // spec read the counts off the view the ease was leaving.
  //
  // This is that mistake made on purpose, so that it fails EVERY time
  // rather than one time in four. It clicks the zoom control and, before
  // the ease can have ended, ticks a filter — which re-tallies and commits,
  // which is the event a barrier built on "the state is ready" mistook for
  // rest. Then it asks the barrier for rest, and checks that nothing moves
  // afterwards.
  test('🔴 a map that is still easing does not say it is at rest, even when a filter is ticked mid-zoom', async ({
    page,
  }) => {
    await recordCamera(page);
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);
    const opening = await publishedView(page);

    // 🔴 Both clicks in ONE task, straight on the elements. Two Playwright
    // clicks are two round trips with actionability checks between them,
    // and on a fast engine the 500 ms ease was over before the second one
    // landed — the test then never had a moving camera to ask about, and
    // a barrier that ignored the camera passed it in two browsers of six.
    // Found by breaking the barrier and counting which browsers noticed.
    await page.evaluate(() => {
      const zoomIn = document.querySelector('.maplibregl-ctrl-zoom-in');
      const toilets = document.querySelector(
        '[data-testid="filter-amenity-toilets"]',
      );
      (zoomIn as HTMLElement).click();
      (toilets as HTMLElement).click();
    });

    await atRest(page);
    const resting = await publishedView(page);
    expect(
      resting.bounds,
      'the view did not change: the zoom never happened, or the map called ' +
        'itself at rest before it had moved',
    ).not.toBe(opening.bounds);

    // 🔴 A wait, and a deliberate one: this is the VERIFICATION of the
    // barrier, not the barrier. It is longer than any ease, and what it
    // asserts is that the map had nothing left to do when it said so.
    await page.waitForTimeout(1_200);
    expect(
      await publishedView(page),
      'the map said it was at rest, and then it moved',
    ).toEqual(resting);

    // Said out loud, in order: it began moving, and it ended still. A map
    // that never says `moving` cannot be told apart from a page that never
    // had a camera.
    const steps = await cameraSteps(page);
    const log = steps.map((s) => s.camera);
    expect(log, `data-camera went ${JSON.stringify(log)}`).toContain('moving');
    expect(log[log.length - 1]).toBe('still');

    // 🔴 And the `still` was written AFTER the numbers arrived. The
    // recorder read the published view in the same task as that write; if
    // `still` had been written at `moveend`, ahead of the commit that
    // carries the tally, the view read there would be the one the ease had
    // just left, and it would differ from the resting one.
    expect(
      steps[steps.length - 1].view,
      'the map said still before the numbers for the resting view were published',
    ).toEqual(resting);

    // And what the reader was promised is what they get, on the view they
    // are looking at.
    expect(
      resting.excluded,
      'nothing is hidden in this view, so there is nothing to promise',
    ).toBeGreaterThan(0);
    await expect(page.getByTestId('filter-include-unknown')).toContainText(
      String(resting.excluded),
    );
    await page.getByTestId('filter-include-unknown').locator('input').check();
    await expect
      .poll(() => shownInView(page))
      .toBe(resting.inView + resting.excluded);
  });

  // 🔴 CAMP-169. The same promise, held to it with no clock in the way.
  //
  // The ease in the test above lasts 500 ms, so it can only be caught
  // moving by a spec that is quick enough — and a mutant that ignores the
  // camera survived one run in thirty of them, on a phone profile, because
  // the runner stalled. A drag lasts as long as the mouse button is down.
  // Held for a second and a half, "is it moving" has the same answer on any
  // machine, and so does "does the barrier refuse".
  test('🔴 a map held mid-drag says it is moving for as long as it is held, and the barrier refuses to pass', async ({
    page,
  }) => {
    await recordCamera(page);
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    // 🔴 Scrolled into view BEFORE the coordinates are read. The map sits
    // below the filter panel, and on a 720 px desktop viewport its centre is
    // at y=738 — off the screen, where a mouse press reaches nothing. The
    // first version of this test dragged there and asserted, sincerely, that
    // the camera was moving; it was not, because nothing had been touched.
    await map(page).scrollIntoViewIfNeeded();
    const box = await map(page).boundingBox();
    if (!box) throw new Error('the map has no box to drag in');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Past MapLibre's 3 px drag threshold, so the drag has really begun.
    await page.mouse.move(cx + 40, cy, { steps: 8 });

    // MapLibre applies a drag on the next animation frame, so `movestart`
    // — and with it `moving` — comes a frame after the mouse does. Waited
    // for rather than assumed: the first version read the attribute at
    // once and found `still` in about half of the webkit runs, correctly,
    // because the map had not yet been told it was moving.
    await expect
      .poll(async () => (await pulse(page)).camera)
      .toBe('moving');

    // A filter ticked mid-drag re-tallies and commits. Straight on the
    // element: a Playwright click would move the mouse and end the drag.
    await page.evaluate(() => {
      (
        document.querySelector(
          '[data-testid="filter-amenity-toilets"]',
        ) as HTMLElement
      ).click();
    });

    await expect(
      atRest(page, 1_500),
      'the barrier let a map through while the reader was still dragging it',
    ).rejects.toThrow();
    expect((await pulse(page)).camera).toBe('moving');

    await page.mouse.up();
    await atRest(page);

    const resting = await publishedView(page);
    await page.waitForTimeout(1_200);
    expect(
      await publishedView(page),
      'the map said it was at rest, and then it moved',
    ).toEqual(resting);

    const steps = await cameraSteps(page);
    const log = steps.map((x) => x.camera);
    expect(log, `data-camera went ${JSON.stringify(log)}`).toContain('moving');
    expect(log[log.length - 1]).toBe('still');
    expect(
      steps[steps.length - 1].view,
      'the map said still before the numbers for the resting view were published',
    ).toEqual(resting);

    expect(
      resting.excluded,
      'nothing is hidden in this view, so there is nothing to promise',
    ).toBeGreaterThan(0);
    await expect(page.getByTestId('filter-include-unknown')).toContainText(
      String(resting.excluded),
    );
    await page.getByTestId('filter-include-unknown').locator('input').check();
    await expect
      .poll(() => shownInView(page))
      .toBe(resting.inView + resting.excluded);
  });

  // 🔴 CAMP-169, the other half. A helper that zooms a map which needed no
  // zooming has already decided what the test will see: the camera moves,
  // and fewer regions are fetched than at the opening view. That is how
  // "step-free access is a strictly smaller answer" failed once in 95
  // whole-file webkit runs — the region holding the fixture's only
  // `wheelchair=limited` campsite was never asked for.
  //
  // Every chunk here takes 1.5 s, longer than the 1.2 s the old helper
  // waited before concluding the map was too wide, so the old logic clicks
  // on every machine instead of only on the slow ones.
  test('🔴 the helper leaves the camera alone when the map opens in detail, however slowly its chunks arrive', async ({
    page,
  }) => {
    let delayed = 0;
    await page.route('**/data/spots/*/*.geojson', async (route) => {
      delayed += 1;
      await new Promise((r) => setTimeout(r, 1_500));
      await route.continue();
    });
    // 🔴 Whether this database opens in detail is decided from the INDEX,
    // before the page is opened — not by waiting for the map to say so.
    // The first version waited (`atRest`, then skip if `wide`), and in
    // doing so did the helper's job for it: by the time `loaded` ran the
    // chunks had arrived, it had nothing to decide, and the old blind-click
    // helper passed this test as happily as the new one. Found by putting
    // the old helper back and watching this stay green.
    //
    // If the whole index weighs less than one view may, no view can be too
    // heavy, and the map opens at a zoom that draws markers.
    const index = (await (
      await page.request.get('/data/spots/index.json')
    ).json()) as RegionSummary[];
    const wholeIndex = index.reduce((n, r) => n + chunkWeight(r.count), 0);
    test.skip(
      wholeIndex > VIEW_BUDGET_BYTES || INITIAL_VIEW.zoom < DETAIL_ZOOM,
      'this database is too big for the map to open in detail, so the camera has to move — the fixture is what this is about',
    );

    await recordCamera(page);
    await page.goto('/map');
    await skipWithoutWebGL(page);

    await loaded(page);
    expect(delayed, 'no chunk was slowed, so this proved nothing').toBeGreaterThan(0);
    const log = await cameraLog(page);
    expect(
      log,
      `the helper moved a map that needed no moving: data-camera went ${JSON.stringify(log)}`,
    ).not.toContain('moving');
  });

  // 🔴 CAMP-169. The branch of `loaded` that CI's fixture never takes.
  //
  // The fixture opens in detail, so every other test in this file walks
  // straight past the loop that zooms a map which is too wide for markers
  // — and that loop was rewritten by this card. On the full database it is
  // the only path there is. Untested, a mistake in it is found by the next
  // person to run the suite against real data.
  //
  // "Too wide" is made here by zooming OUT below DETAIL_ZOOM, not by
  // inflating the index: whether a view is too heavy depends on how large
  // the screen is, and this has to mean the same on a phone and on a
  // desktop. From the opening zoom one click out is 5.2, which is wide.
  test('🔴 the helper zooms a map that is too wide, once, and returns only when it is loaded', async ({
    page,
  }) => {
    await recordCamera(page);
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);
    const detail = await publishedView(page);

    // 🔴 Keep the map from idling after the zoom-out, so that the only thing
    // that can have published the wide view when `still` is written is the
    // wide branch itself. `idle` publishes the drawn numbers too, and it
    // fires in the same frame as `moveend` or a few after it — in WebKit and
    // Firefox, mostly before the effect writes `still` — so with the basemap
    // answering at its usual speed a wide branch that forgot to publish was
    // covered for by `idle` in 41 of 60 runs. Measured, the missing publish
    // failed this test in chromium 10 of 10, mobile-chrome 6, webkit 2,
    // firefox 1, mobile-safari 0 and tablet 0. A map is not idle while its
    // tiles are outstanding, so holding them for 3 s puts `idle` after
    // everything the recorder reads at `still`.
    //
    // 🔴 HELD BY A FLAG, NOT RELEASED BY `unroute`. This test spent five
    // rounds of CI being blamed on the component, and the failure was
    // never an assertion: it was
    //
    //     Error: route.continue: Route is already handled!
    //
    // thrown from THIS handler, caused by the `page.unroute(…)` below.
    // Playwright force-continues a parked route when its handler is
    // removed, and the sleeping handler's own `route.continue()` then
    // throws into whatever test is running.
    //
    // It only showed once something made the gate below fall faster
    // than three seconds, so the `unroute` started landing while
    // requests were still parked. That is a landmine under any future
    // change, not a property of the change that trod on it.
    //
    // A flag the handler reads has no such edge: the route is never
    // removed, so nothing can be force-continued underneath it.
    let holdTiles = true;
    await page.route('**/*.pbf', async (route) => {
      if (holdTiles) await new Promise((r) => setTimeout(r, 3_000));
      await route.continue();
    });

    await page.locator('.maplibregl-ctrl-zoom-out').click();
    await expect
      .poll(
        async () => {
          const p = await pulse(page);
          return `${p.state} (camera ${p.camera})`;
        },
        {
          // 20 s like every other wait on this map. The ease is 500 ms, and
          // the one failure this test showed (1 in 70, on mobile-chrome)
          // was the default 5 s poll expiring with `ready` still standing.
          timeout: 20_000,
          message: 'one zoom out did not make the map too wide for markers',
        },
      )
      .toMatch(/^wide/);
    await atRest(page);

    // 🔴 The wide branch says `still` too, so what it published has to be
    // true when it does. It used to return without publishing, and the
    // bounds and the in-view count stayed those of an earlier view until
    // the map next idled — after `still` had been written.
    //
    // The recorder read the published view in the same task as that write.
    // The view read after `idle` — which the held tiles kept until now, and
    // which shows itself by counting no markers on screen — is the
    // settled one.
    //
    // ⚠️ `idle` is NO LONGER the only writer of those counts. CAMP-175
    // added a second on `sourcedata`, because `idle` alone published
    // numbers from the frame before: the campsite source was empty and
    // `queryRenderedFeatures` still answered with markers. This
    // paragraph used to lean on that sole-writer property, and leaning
    // on it is what made `unroute` above look safe. They must be the same. (Not compared with the detail view's
    // bounds: mid-zoom refreshes had already moved them, so "different
    // from before" is true of a wide branch that published nothing.)
    expect((await pulse(page)).state).toBe('wide');
    const wideSteps = await cameraSteps(page);
    await expect
      .poll(
        async () =>
          // 🔴 The source's own count travels with the rendered one, so
          // a failure says WHICH of the two it is: `src=0` with points
          // on screen is a stale publish; `src=N` is a source that was
          // never emptied. Three runs were spent guessing between them.
          `${await map(page).getAttribute('data-visible-points')}/${await map(page).getAttribute('data-visible-clusters')}` +
            ` (src=${await map(page).getAttribute('data-source-features')})`,
        {
          timeout: 20_000,
          message:
            'the map never idled in the wide view: the markers it drew in ' +
            'detail are still counted as on screen',
        },
      )
      .toBe('0/0 (src=0)');
    const settled = await publishedView(page);
    expect(
      settled.bounds,
      'the wide view still carries the bounds of the detail view it replaced',
    ).not.toBe(detail.bounds);
    expect(
      wideSteps[wideSteps.length - 1].view,
      'the map said still before it had published the wide view',
    ).toEqual(settled);
    // Stop holding; the handler stays registered, so no route in flight
    // is ever force-continued out from under it. See the flag above.
    holdTiles = false;

    // Every WRITE of `moving`, not every change to it. Each `movestart`
    // writes it once, and a second click that lands in the middle of the
    // first ease restarts the movement without a `still` in between — so
    // counting only changes saw one movement where the helper had made two.
    // Found by making the helper do exactly that and watching this pass.
    const movements = async () =>
      (await cameraLog(page)).filter((c) => c === 'moving').length;
    const before = await movements();

    // 🔴 The helper's own click starts a zoom that cannot end for 2.5 s.
    // For that long the state reads `wide` — the state from BEFORE the
    // click — and a helper that trusted it would click again. With the
    // frames running normally that read is stale for about 500 ms and a
    // runner that stalls past it lets the careless helper through: the
    // mutant that decides on the stale read survived 4 runs in 30 this
    // way. Held, it is stale for as long as the test says, on any machine.
    await holdFrames(page, 2_500);
    await loaded(page);

    expect(
      (await movements()) - before,
      'a map one zoom level short of markers needs exactly one click',
    ).toBe(1);
    const now = await pulse(page);
    expect(now).toMatchObject({ state: 'ready', camera: 'still' });
    expect(now.total).toBeGreaterThan(0);
  });

  // 🔴 CAMP-25's whole argument, checked end to end. `wheelchair=limited`
  // is access with restrictions and NOT step-free; folding them together
  // would send a wheelchair user to a site they cannot use.
  test('step-free access is a strictly smaller answer than any access', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    await page.getByTestId('filter-amenity-wheelchair').click();
    await expect.poll(() => shown(page)).toBeGreaterThan(0);
    const any = await shown(page);

    await page.getByTestId('filter-amenity-wheelchair').click();
    await page.getByTestId('filter-amenity-wheelchairFull').click();
    await expect.poll(() => shown(page)).toBeGreaterThan(0);
    const stepFree = await shown(page);

    // The fixture is built to guarantee at least one `limited` campsite
    // (see test/fixtures/_select.sql), so this is a real difference and
    // not two equal numbers agreeing by accident.
    expect(stepFree).toBeLessThan(any);
  });

  // 🔴 The bug this design exists to avoid. MapLibre clusters when the
  // SOURCE loads, so filtering a LAYER would leave the bubbles counting
  // campsites that are no longer drawn — a cluster saying twelve that
  // opens to three. Re-setting the data makes it re-cluster.
  test('clusters are recounted when filtering, not just hidden', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    const clustered = async () =>
      Number(await map(page).getAttribute('data-clustered-total'));

    // 🔴 The assertion is "never more than", not "equal to". The bubbles
    // are counted with queryRenderedFeatures, which sees only what is on
    // screen, so at the opening zoom this sum is a subset of the whole
    // filtered set. That makes "equal" a flaky assertion about the
    // viewport rather than a true one about clustering.
    //
    // "Never more than" is the exact thing that breaks if clustering did
    // not recompute: the bubbles would still be counting campsites the
    // filter removed, and their sum would exceed the filtered total.
    // 🔴 Polled, not read once. This attribute is published on MapLibre's
    // `idle` event — after the tiles and the first render — while
    // `data-total` lands as soon as the collection is fetched. Reading it
    // immediately gets the zero it held before the map ever drew.
    await expect.poll(clustered, { timeout: 15_000 }).toBeGreaterThan(0);

    const clusteredBefore = await clustered();
    const shownBefore = await shown(page);
    expect(clusteredBefore).toBeLessThanOrEqual(shownBefore);

    await page.getByTestId('filter-amenity-toilets').click();

    // 🔴 Fewer campsites DRAWN than before — compared against the
    // earlier DRAWN count, not against the clustered one.
    //
    // This asserted `shown < clusteredBefore`, which compares two
    // different quantities: campsites drawn against campsites inside
    // bubbles currently on screen. It passed only while `loaded()`
    // returned after the first chunk and `shown` happened to be small.
    // Once `loaded()` became a real barrier the map drew more, and the
    // comparison failed on a map doing exactly the right thing —
    // measured on CI: clustered 2, drawn 22.
    await expect.poll(() => shown(page)).toBeLessThan(shownBefore);

    const shownAfter = await shown(page);
    await expect.poll(clustered).toBeLessThanOrEqual(shownAfter);
    // And it did not simply stop drawing: something is still clustered.
    expect(await clustered()).toBeGreaterThan(0);
  });

  test('filters survive a reload, so a filtered map is a link', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    await page.getByTestId('filter-amenity-toilets').click();
    await page.getByTestId('filter-type-rv_park').click();
    await expect.poll(() => shown(page)).toBeGreaterThanOrEqual(0);

    expect(page.url()).toContain('amenities=toilets');
    expect(page.url()).toContain('types=rv_park');

    await page.reload();
    await loaded(page);
    await expect(page.getByTestId('filter-amenity-toilets')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 🔴 That the filter is APPLIED, not that the number is identical.
    //
    // `shown` counts the filtered campsites among those LOADED, and
    // since CAMP-127 what is loaded depends on the viewport — which the
    // reload reaches through its own zoom sequence. Measured: 20 before,
    // 19 after, for a map that restored the filter perfectly. The test
    // was comparing two different viewports and calling it a bug.
    //
    // What the card actually claims is that a filtered map is a link:
    // the chips come back pressed, the URL still carries the filters,
    // and the filter is really in force — fewer campsites drawn than
    // loaded, rather than the page merely looking filtered.
    const after = await map(page).getAttribute('data-shown');
    const loadedAfter = await map(page).getAttribute('data-total');
    expect(Number(after), 'nothing is drawn after the reload').toBeGreaterThan(
      0,
    );
    expect(
      Number(after),
      'everything is drawn, so the filter was not re-applied',
    ).toBeLessThan(Number(loadedAfter));
  });

  test('clearing puts every campsite back', async ({ page }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    const all = await shown(page);
    await page.getByTestId('filter-amenity-toilets').click();
    await expect.poll(() => shown(page)).toBeLessThan(all);

    await page.getByTestId('filter-clear').click();
    await expect.poll(() => shown(page)).toBe(all);
    expect(page.url()).not.toContain('amenities=');
  });

  // 🔴 The duplication guard. The filtering rule exists twice — in SQL on
  // the API and in TypeScript in the browser — because they run in
  // different languages on different sides of a build. This is the test
  // that stops them drifting: same question, both answers, compared.
  test('the browser and the API agree on what matches', async ({
    page,
    request,
  }) => {
    // 🔴 Rewritten for CAMP-127, and the premise had to change with it.
    //
    // This compared the map against the API for the WHOLE WORLD, because
    // the map read one file that held the whole world. It no longer
    // does: the file had a cap of 20 000, the EU-27 import took the
    // database to 61 521, and the map now fetches the regions in view.
    //
    // So the comparison is scoped to the viewport, which is both honest
    // and exact — inside the view the map has fetched every chunk, so
    // the two sets must match in BOTH directions. A subset assertion
    // would have caught the map hiding something and missed it showing
    // something, and the drift this test exists to catch can go either
    // way.
    for (const query of [
      'amenities=toilets',
      'amenities=toilets,shower',
      'types=rv_park',
      'amenities=wheelchairFull',
      'amenities=toilets&unknown=1',
    ]) {
      await page.goto(`/map?${query}`);
      await skipWithoutWebGL(page);
      // Markers only exist below DETAIL_ZOOM. Without this the map is
      // drawing regions and there is nothing to compare.
      await zoomToDetail(page);

      // What the map has drawn inside its own viewport, and the viewport
      // itself — read together so they cannot describe two moments.
      const drawn = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="map"]');
        return {
          inView: Number(el?.getAttribute('data-in-view') ?? -1),
          shown: Number(el?.getAttribute('data-shown') ?? -1),
          total: Number(el?.getAttribute('data-total') ?? -1),
          box: el?.getAttribute('data-bounds') ?? '',
          slugs: (el?.getAttribute('data-in-view-slugs') ?? '')
            .split(',')
            .filter(Boolean),
        };
      });
      expect(drawn.box, 'the map did not publish its bounds').not.toBe('');

      const res = await request.get(
        `${API}/spots/map/points?bbox=${drawn.box}&limit=20000&${query}`,
      );
      expect(res.ok(), `API refused ${query}`).toBe(true);
      const { markers, truncated } = (await res.json()) as {
        markers: { slug: string; path: string | null }[];
        truncated: boolean;
      };
      // One viewport of markers must never hit the cap; if it does, the
      // two sides are comparing truncated answers and calling them equal.
      expect(truncated, `the viewport query was truncated for ${query}`).toBe(
        false,
      );

      // 🔴 Name the campsites, do not just count them.
      //
      // This said `Expected: 3, Received: 5` and left the next person to
      // work out which two \u2014 across 61 422 campsites and a viewport
      // nobody can reproduce from the message. A disagreement between
      // our client filter and our server filter is a data-correctness
      // bug, and the first question is always "which ones".
      // 🔴 `slug`, not something carved out of `path`.
      //
      // 135 campsites have no region and therefore no page, so their
      // `path` is null — but they all have a slug, and the map draws
      // them. Deriving the name from `path` turned every one of them
      // into "(no slug)" on this side while the map published the real
      // slug, so a correct map failed the comparison in any viewport
      // containing one (CY 36, FI 30, DK 22, SE 19, FR 7 …).
      const apiSlugs = markers.map((m) => m.slug).sort();
      const mapSlugs = [...drawn.slugs].sort();
      // 🔴 The map publishes at most 200 slugs and says so with a
      // sentinel. Comparing lists is the better assertion, but a capped
      // viewport still has to assert SOMETHING — and silently skipping
      // is how a test stops testing.
      const capped = drawn.slugs.length === 1 && drawn.slugs[0] === '(capped)';

      // 🔴 The whole sorted list, not a set difference.
      //
      // The first version compared sets, and a set difference cannot see
      // a DUPLICATE: the map drawing one campsite twice produced two
      // "identical" lists and a count that was one too high. Which is
      // exactly the defect that was hiding here.
      if (!capped) {
        expect(
          mapSlugs,
          `the map and the API disagree for ${query} in bbox ${drawn.box} ` +
            `(map ${mapSlugs.length}, API ${apiSlugs.length}, ` +
            `shown ${drawn.shown} of ${drawn.total} loaded, ` +
            `API said: ${apiSlugs.join(' ')})`,
        ).toEqual(apiSlugs);
      }

      // The count is asserted either way \u2014 it is the one number the map
      // always publishes, capped or not.
      expect(
        drawn.inView,
        `the map and the API disagree on the count for ${query} in bbox ` +
          `${drawn.box}${capped ? ' (too many in view to list)' : ''}`,
      ).toBe(markers.length);
    }
  });

  // \u{1F534} The sentence a reader meets first, on the real page.
  //
  // The unit tests prove filterCountLabel; this proves it is WIRED. The
  // defect it replaces was exactly a wiring one — a correct number
  // (`shown`, the campsites drawn) rendered into a sentence that claimed
  // something else. /map opens zoomed out, draws regions, loads no
  // markers, and printed a bold "0 campsites" directly above
  // "3,116 campsites in view". Both numbers were about the same map.
  test('a zoomed-out map never claims there are no campsites', async ({
    page,
  }) => {
    await page.goto('/map');
    await skipWithoutWebGL(page);

    const count = page.getByTestId('filter-count');
    await expect(count).toBeVisible();

    // 🔴 Never a bare zero, and never empty — the two ways this line
    // has already misled somebody. True at any zoom.
    await expect(count).not.toHaveText(/^\s*0\s+campsites/);
    await expect(count).not.toHaveText(/^\s*$/);

    // 🔴 Then branch on what the map says it is doing, rather than
    // assuming.
    //
    // The first version asserted «zoom in» unconditionally, because on
    // the full 61 422-campsite dataset /map opens too wide for markers.
    // CI's fixture is small enough that every chunk in view fits, so the
    // map opens in DETAIL and the panel correctly showed "36 campsites"
    // — and the test failed on six browsers for a map that was right.
    // `data-map-state` exists precisely so a test need not guess.
    //
    // 🔴 CAMP-169. But it has to have decided. The map begins in `loading`
    // and this read came straight after `goto`, so which branch ran was a
    // race between the page and the assertion — and the `wide` branch, the
    // one the full database takes, ran only when the race happened to be
    // lost the other way. `atRest` waits for `wide`, `ready` or `failed`.
    await atRest(page);
    const state = await page
      .getByTestId('map')
      .getAttribute('data-map-state');

    const assertWide = async () => {
      await expect(count).toHaveText(/zoom in/i);
      // And what the map says about itself must agree with it.
      //
      // 🔴 By test id, not `getByRole('status')`. CAMP-153 put a second
      // `role="status"` on this page (the wildfire note), so the role
      // resolves to two elements and this assertion — which nothing ran,
      // because the fixture never reaches the `wide` branch — would have
      // thrown a strict-mode violation the first time anyone did. It did,
      // on all six projects, the first time this branch was made to run.
      await expect(page.getByTestId('map-data-state')).toContainText(
        /campsites in the regions in view/i,
      );
    };

    if (state === 'wide') {
      await assertWide();
    } else {
      // Drawing individual campsites: a real number, and no advice to
      // zoom in, because that would not help.
      await expect(count).toHaveText(/\d[\d,]*\s+campsites/);
      await expect(count).not.toHaveText(/zoom in/i);

      // 🔴 CAMP-169. And the branch this fixture never takes, made to run:
      // the title of this test is about a map that is ZOOMED OUT, and on
      // the fixture that half was never exercised — it was an `if` nobody
      // reached. One click out is below DETAIL_ZOOM on every screen size.
      await page.locator('.maplibregl-ctrl-zoom-out').click();
      await atRest(page);
      await expect(page.getByTestId('map')).toHaveAttribute(
        'data-map-state',
        'wide',
      );
      await assertWide();
      await expect(count).not.toHaveText(/^\s*0\s+campsites/);
    }
  });

  // 🔴 CAMP-133. The defect: "306 of 1 308 campsites" (reviewed
  // 25.09.2026) where 1 308 was every campsite fetched since the page
  // opened. Chunks are never discarded, so the denominator only ever
  // grew, with where the reader had been rather than with what was on
  // screen. It matched neither the screen nor the database, and the
  // heading above it said 61 422.
  //
  // This asserts the sentence against the two numbers the map publishes
  // for the visible area, so "explainable" is checked rather than
  // claimed — and then PANS and asserts it again, because panning is
  // what used to break it.
  test('🔴 the panel counts the visible area, and panning does not inflate it', async ({
    page,
  }) => {
    await recordCamera(page);
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await zoomToDetail(page);

    const count = page.getByTestId('filter-count');
    const readPanel = async () => {
      const text = (await count.textContent()) ?? '';
      const numbers = [...text.matchAll(/[\d,]+/g)].map((m) =>
        Number(m[0].replace(/,/g, '')),
      );
      return { text, numbers };
    };

    // Filtering, so the sentence carries BOTH numbers.
    await page.getByTestId('filter-amenity-toilets').click();
    await expect(count).toHaveText(/of [\d,]+ campsites in view/);

    // 🔴 Polled, because `data-in-view` is published on the map's own
    // `idle` while the panel renders from React state — two moments, one
    // rule (`withinView`). What must be true is that they AGREE once the
    // map has settled, not that they are written in the same tick.
    const agrees = async () => {
      const { numbers } = await readPanel();
      const el = map(page);
      return (
        numbers.length === 2 &&
        numbers[0] === Number(await el.getAttribute('data-in-view')) &&
        numbers[1] === Number(await el.getAttribute('data-in-view-total'))
      );
    };
    await expect
      .poll(agrees, { timeout: 15_000 })
      .toBe(true);

    const first = await readPanel();
    expect(first.numbers[0]).toBeLessThanOrEqual(first.numbers[1]);

    // Now pan away and back. This is the move that used to inflate the
    // denominator, because the chunks from the detour stayed loaded.
    //
    // 🔴 CAMP-169. This drag panned NOTHING in five projects out of six.
    // The map sits below the filter panel, so at 1280×720 its centre is
    // at y=738 — off the screen — and on the two phones at 920 and 972.
    // A mouse press there reaches no element: measured, 0 `movestart`, the
    // bounds unchanged, `data-camera` still `still`. Every assertion after
    // it was then about a map nobody had touched, and it was green. Only
    // the tablet (centre at 893 of 1024) ever moved the map.
    //
    // The line that fixes it was already in the test at "a map held
    // mid-drag": scroll the map into view BEFORE reading where it is.
    await map(page).scrollIntoViewIfNeeded();
    const box = await map(page).boundingBox();
    if (!box) throw new Error('the map has no box to drag in');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const movestarts = async () =>
      (await cameraLog(page)).filter((c) => c === 'moving').length;
    const opening = await publishedView(page);
    let heldButUnseen = 0;
    for (const [dx, dy] of [
      [-box.width / 3, 0],
      [box.width / 3, 0],
    ] as const) {
      const before = await movestarts();
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
      await page.mouse.up();

      // 🔴 The drag has to have REACHED the map, and this is what says so:
      // the map's own `movestart`, which a press on nothing never fires.
      // Without it a drag that misses is indistinguishable from one that
      // hit — which is the whole of this defect. MapLibre applies a drag
      // on the next frame, so this is polled, not read.
      await expect
        .poll(movestarts, {
          message:
            'the drag never reached the map (no movestart) — the mouse ' +
            `pressed at y=${Math.round(cy)} in a ${page.viewportSize()?.height}px window`,
        })
        .toBeGreaterThan(before);

      // "at rest", not "ready": the view halfway out may be too heavy for
      // markers, and that is a legitimate state to pass through. This
      // also waits out the inertia that carries a fast drag on.
      await atRest(page);
      await expect.poll(agrees, { timeout: 15_000 }).toBe(true);

      const here = await readPanel();
      const fetched = Number(await map(page).getAttribute('data-total'));
      expect(
        here.numbers[0],
        'the shown count cannot exceed the count in view',
      ).toBeLessThanOrEqual(here.numbers[1]);
      expect(
        here.numbers[1],
        'the denominator is the visible area, so it cannot exceed what is loaded',
      ).toBeLessThanOrEqual(fetched);
      heldButUnseen = Math.max(heldButUnseen, fetched - here.numbers[1]);
    }

    // 🔴 The map really moved: its published box is not the opening one.
    // (`movestart` says a drag began; this says it went somewhere.)
    expect(
      (await publishedView(page)).bounds,
      'the map is where it started, so nothing was panned',
    ).not.toBe(opening.bounds);

    // 🔴 What the detour has to leave behind for this test to mean
    // anything: campsites the map HOLDS and the reader cannot SEE. Only
    // then does "the denominator is the visible count" differ from "the
    // denominator is everything fetched" — the CAMP-133 defect — and only
    // then can the sentence be told apart from the bug.
    //
    // This replaces `expect(loadedNow).toBeGreaterThan(0)` — "the detour
    // loaded nothing, so this proves nothing". `loaded()` had already
    // waited for `data-total > 0`, and `data-total` never falls, so it was
    // true before the drag and could not fail after one.
    expect(
      heldButUnseen,
      'the sentence\'s denominator was never smaller than everything fetched, ' +
        'though the detour leaves campsites held out of view: either the ' +
        'panel counts everything fetched (the CAMP-133 defect) or the ' +
        'fixture no longer leaves any out of view',
    ).toBeGreaterThan(0);

    await expect(map(page)).toHaveAttribute('data-map-state', 'ready', {
      timeout: 20_000,
    });
  });
});
