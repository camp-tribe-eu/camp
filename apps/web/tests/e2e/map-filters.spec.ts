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
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await loaded(page);

    for (const query of [
      'amenities=toilets',
      'amenities=toilets,shower',
      'types=rv_park',
      'amenities=wheelchairFull',
      'amenities=toilets&unknown=1',
    ]) {
      await page.goto(`/map?${query}`);
      await loaded(page);

      // 🔴 The same limit the snapshot was built with, and the same
      // reason. The API's default is POINT_LIMIT (2 000), a safety valve
      // for ONE viewport; the map reads a whole-world file built with
      // the higher cap. Asking without it compared 2 000 against 3 131
      // and read like a filter bug — it was a question asked two
      // different ways.
      //
      // 🔴 20 000, and it must stay equal to WHOLE_WORLD_LIMIT in
      // app/data/spots.geojson/route.ts. It was 10 000 and CAMP-107 took
      // the dataset past it, at which point this test failed on its own
      // truncation guard below — correctly, and for a reason that had
      // nothing to do with filtering. The number is written twice
      // because a route file may not export it; the check below is what
      // makes the duplication safe.
      const res = await request.get(
        `${API}/spots/map/points?bbox=-180,-85,180,85&limit=20000&${query}`,
      );
      expect(res.ok(), `API refused ${query}`).toBe(true);
      const { markers, truncated } = (await res.json()) as {
        markers: unknown[];
        truncated: boolean;
      };

      // 🔴 And if THAT cap is ever reached, this must fail rather than
      // compare two truncated answers and call them equal. The build
      // refuses the snapshot at the same point, so the two guards agree.
      expect(
        truncated,
        'the whole-world query was truncated — the map can no longer be one file',
      ).toBe(false);

      expect(
        await shown(page),
        `the map and the API disagree for ${query}`,
      ).toBe(markers.length);
    }
  });
});
