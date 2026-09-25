import { expect, test, type Page } from './api-request';
import {
  ACCESSIBILITY_KEYS,
  GENERAL_AMENITY_KEYS,
  SPOT_TYPES,
} from '@/lib/api';

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

/** Wait for the collection to arrive; before that everything is zero. */
async function loaded(page: Page) {
  await expect
    .poll(async () => Number(await map(page).getAttribute('data-total')), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
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
    const strict = await shown(page);
    const hidden = await excluded(page);
    expect(hidden).toBeGreaterThan(0);

    await expect(page.getByTestId('filter-include-unknown')).toContainText(
      String(hidden),
    );

    await page.getByTestId('filter-include-unknown').locator('input').check();
    // Exactly the number it promised — not "more", which would leave the
    // sentence technically true and useless.
    await expect.poll(() => shown(page)).toBe(strict + hidden);
    // And it stops claiming to hide what it is now drawing.
    expect(await excluded(page)).toBe(0);
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

    const before = await clustered();
    expect(before).toBeLessThanOrEqual(await shown(page));

    await page.getByTestId('filter-amenity-toilets').click();
    const after = await shown(page);
    await expect.poll(() => shown(page)).toBeLessThan(before);

    await expect.poll(clustered).toBeLessThanOrEqual(after);
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

    const before = await shown(page);
    await page.reload();
    await loaded(page);
    await expect(page.getByTestId('filter-amenity-toilets')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(() => shown(page)).toBe(before);
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
      await loaded(page);

      // What the map has drawn inside its own viewport, and the viewport
      // itself — read together so they cannot describe two moments.
      const drawn = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="map"]');
        return {
          inView: Number(el?.getAttribute('data-in-view') ?? -1),
          box: el?.getAttribute('data-bounds') ?? '',
        };
      });
      expect(drawn.box, 'the map did not publish its bounds').not.toBe('');

      const res = await request.get(
        `${API}/spots/map/points?bbox=${drawn.box}&limit=20000&${query}`,
      );
      expect(res.ok(), `API refused ${query}`).toBe(true);
      const { markers, truncated } = (await res.json()) as {
        markers: unknown[];
        truncated: boolean;
      };
      // One viewport of markers must never hit the cap; if it does, the
      // two sides are comparing truncated answers and calling them equal.
      expect(truncated, `the viewport query was truncated for ${query}`).toBe(
        false,
      );

      expect(
        drawn.inView,
        `the map and the API disagree for ${query}`,
      ).toBe(markers.length);
    }
  });
});
