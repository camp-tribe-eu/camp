import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { INITIAL_VIEW } from '@/lib/map-sources';

// CAMP-153, in a browser, because the two things that matter here are
// only true of the rendering.
//
// 🔴 A CHECK MUST NOT ASSERT A PROPERTY IT CANNOT SEE. The unit spec
// proves `wildfireNote` returns the right sentence; it cannot prove the
// page prints it, and it cannot prove a single perimeter reaches the
// canvas. Everything below reads the page: the text a reader would read,
// the href a reader would click, and — for "is anything actually drawn" —
// the pixels, by comparing the map with the layer on against the same map
// with it off. A test that asserted the feed's row count instead would
// have gone on passing over a layer that never reached the map at all.

const FEED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'src', 'data', 'wildfires.json'), 'utf8'),
) as { meta: Record<string, unknown>; features: unknown[] };

const NOTE = '[data-testid="wildfire-note"]';

/**
 * Open /map, and retry only when the page itself did not render.
 *
 * 🔴 This retries the NAVIGATION and never an assertion. `/map` is a
 * server component that asks the API for the region index, and the API
 * rate-limits: measured against a local instance, 883 of this suite's
 * renders came back 429 and the error boundary replaced the whole page.
 * A wildfire test that reported "the map is missing" in that case would
 * be reporting somebody else's throttle. Everything the tests actually
 * check is asserted once, on a page that rendered.
 */
async function openMap(page: Page) {
  await stubStyles(page);
  // The limit refills over a minute, so the waits add up to more than one.
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.goto('/map');
    await skipWithoutWebGL(page);
    if ((await page.locator('[data-testid="map"]').count()) > 0) return;
    const broke = await page.getByText('This page did not load properly').count();
    if (broke === 0) return; // something else is wrong — let the test say so
    await page.waitForTimeout(3000 * (attempt + 1));
  }
  throw new Error('/map never rendered: the API kept refusing the region index');
}

/**
 * 🔴 Skip, rather than fail, where the browser genuinely cannot draw a map.
 *
 * Headless Firefox on the CI runner has no WebGL2, and MapLibre cannot
 * draw anything without it — the page shows "This browser cannot display
 * the interactive map" instead, and the fire note (which lives inside the
 * map component) is not there to read. Every wildfire test failed in that
 * browser on the first CI run and on all three after it, waiting 30 s for
 * an element that cannot exist; the other two map specs already skip here
 * for exactly this reason, and this one had simply not been told.
 *
 * What that browser shows INSTEAD is asserted by map.spec.ts's fallback
 * test, which runs everywhere.
 */
async function skipWithoutWebGL(page: Page) {
  const ok = await page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
  test.skip(!ok, 'no WebGL2 in this browser — the map, and so the fire note, cannot render');
}

/**
 * 🔴 A flat, local basemap, so the pixels are ours.
 *
 * These tests used to draw the real OpenFreeMap tiles over the network.
 * Two of them compare screenshots — "on" against "off", "stale" against
 * "off" — and a comparison over tiles that arrive from a third party is
 * only as stable as that party. On the runner they failed in WebKit in
 * OPPOSITE directions: "a burnt area really reaches the canvas" saw two
 * identical images, "a stale feed leaves nothing on the canvas" saw two
 * different ones, and neither result was about fire. map.spec.ts answers
 * every style request locally for the same reason and says so at length;
 * this does what it does, so the only thing that can differ between the
 * two frames is the layer under test.
 */
async function stubStyles(page: Page) {
  await page.route('**/styles/*', async (route) => {
    await route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e8e8' } }],
      },
    });
  });
}

/**
 * A feed holding one perimeter big enough to be in the opening view.
 *
 * 🔴 Synthetic on purpose. The map opens over central Croatia
 * (INITIAL_VIEW), and today's real feed has no Croatian fire in the last
 * fortnight — so a canvas comparison against the live file would compare
 * two identical empty maps and pass for the wrong reason. A test that can
 * only pass when Italy happens to be burning is not a test of our code.
 *
 * 🔴 Deliberately large, in the tests that are not about size. MapLibre
 * draws 512 px tiles, so at the opening zoom of 6.2 the world is
 * 512 × 2^6.2 = 37 632 px wide and one degree of longitude is 104.5 px:
 * 0.8° is about 84 px each side of the centre, 1.6° about 167 px across.
 * (This comment used to say 42 and 84 — it had counted 256 px tiles.) The
 * tests about SIZE take theirs from the shipped file, below.
 */
const freshFeed = (over: Record<string, unknown> = {}) => ({
  ...FEED,
  meta: { ...FEED.meta, fetchedAt: daysAgo(0.02), ...over },
});

/** One square perimeter, `half` degrees each side of (lng, lat). */
const squareFire = (
  lng: number,
  lat: number,
  half: number,
  props: Record<string, unknown> = {},
) => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [lng - half, lat - half],
        [lng + half, lat - half],
        [lng + half, lat + half],
        [lng - half, lat + half],
        [lng - half, lat - half],
      ],
    ],
  },
  properties: {
    id: 'test-1',
    date: '2026-09-20',
    country: 'HR',
    place: 'Velebit',
    hectares: 4200,
    ...props,
  },
});

const inViewFeed = (
  meta: Record<string, unknown> = { ...FEED.meta, fetchedAt: daysAgo(0.02) },
  half = 0.8,
  place = 'Velebit',
) => ({
  type: 'FeatureCollection',
  meta,
  features: [squareFire(INITIAL_VIEW.lng, INITIAL_VIEW.lat, half, { place })],
});

/** A feed of exactly the features given, fresh, with the shipped credit. */
const feedOf = (features: unknown[], over: Record<string, unknown> = {}) => ({
  type: 'FeatureCollection',
  meta: { ...FEED.meta, fetchedAt: daysAgo(0.02), ...over },
  features,
});

/**
 * 🔴 THE SHAPES WE ACTUALLY SHIP, read from the file — not squares of a
 * size typed here.
 *
 * Two earlier versions of this got the size wrong in opposite directions.
 * The first was a 167 px square clicked dead centre, sized around the
 * defect it was meant to find. The second was a square "of the median
 * width", and a square of any width is the wrong shape: the map drops
 * polygons by AREA at the tile's zoom, and the thin real ones that go
 * missing (0.011° long, hairline wide) are not squares. So these are the
 * smallest, a quarter-of-the-way, the median and the largest of the
 * shipped perimeters BY AREA, with their own coordinates, moved to the
 * middle of the opening view and nothing else about them changed.
 */
type Geometry = { type: string; coordinates: unknown };
type RealFire = { geometry: Geometry; properties: Record<string, unknown> };

function extentOf(c: unknown): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (part: unknown): void => {
    if (!Array.isArray(part)) return;
    if (typeof part[0] === 'number' && typeof part[1] === 'number') {
      west = Math.min(west, part[0]);
      east = Math.max(east, part[0]);
      south = Math.min(south, part[1]);
      north = Math.max(north, part[1]);
      return;
    }
    part.forEach(walk);
  };
  walk(c);
  return [west, south, east, north];
}

/** Outer-ring area in degrees², by the shoelace formula. Ranking only. */
function areaOf(g: Geometry): number {
  const ring = (r: number[][]) => {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    return Math.abs(a) / 2;
  };
  if (g.type === 'Polygon') return ring((g.coordinates as number[][][])[0]);
  return (g.coordinates as number[][][][]).reduce((sum, poly) => sum + ring(poly[0]), 0);
}

const BY_AREA = [...(FEED.features as RealFire[])].sort(
  (a, b) => areaOf(a.geometry) - areaOf(b.geometry),
);
const REAL_SHAPES: [string, RealFire][] = [
  ['smallest', BY_AREA[0]],
  ['quarter-way', BY_AREA[Math.floor(BY_AREA.length / 4)]],
  ['median', BY_AREA[Math.floor(BY_AREA.length / 2)]],
  ['largest', BY_AREA[BY_AREA.length - 1]],
];

/** The same perimeter, moved so its middle is the middle of the opening view. */
function centred(f: RealFire) {
  const [w, s, e, n] = extentOf(f.geometry.coordinates);
  const dx = INITIAL_VIEW.lng - (w + e) / 2;
  const dy = INITIAL_VIEW.lat - (s + n) / 2;
  const move = (c: unknown): unknown =>
    Array.isArray(c)
      ? typeof c[0] === 'number'
        ? [(c[0] as number) + dx, (c[1] as number) + dy]
        : c.map(move)
      : c;
  return {
    type: 'Feature',
    geometry: { ...f.geometry, coordinates: move(f.geometry.coordinates) },
    properties: { ...f.properties },
  };
}

/** Pixels per degree of longitude at the zoom /map opens at. */
const PX_PER_DEGREE = (512 * 2 ** INITIAL_VIEW.zoom) / 360;

/** Wait until the map has stopped fetching and the layer has answered. */
async function settle(page: Page) {
  await page.waitForSelector('[data-testid="map"]');
  await expect(page.locator(NOTE)).toBeVisible();
  await expect(page.locator(NOTE)).not.toHaveAttribute('data-state', 'loading');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map"]')?.getAttribute('data-map-state') !== 'loading',
    undefined,
    { timeout: 30_000 },
  );
  // One more frame after the last data event, so the canvas has painted.
  await page.waitForTimeout(1500);
}

/** Serve a doctored feed in place of the real one. */
async function serveFeed(page: Page, body: unknown | null, status = 200) {
  await page.route('**/data/wildfires.json', async (route) => {
    if (body === null) {
      await route.fulfill({ status, contentType: 'text/html', body: '<html>502</html>' });
      return;
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

/**
 * The map, photographed on a page of its own that has seen only `feed`.
 *
 * 🔴 WHY EVERY COMPARISON HERE USES TWO PAGES INSTEAD OF ONE PAGE TWICE.
 *
 * The first version photographed the map, clicked the layer off, waited,
 * and photographed it again. On the CI runner's WebKit (Linux) the two
 * images came back byte-identical — while the trace of the same run shows,
 * frame by frame, the burnt area disappearing from the page the moment the
 * button was clicked, and the failure screenshot taken 1.5 s AFTER the
 * click still shows it. A WebGL canvas photographed a second time in that
 * engine is the first photograph again. So "on" and "off" are never two
 * shots of one canvas: each comes from a fresh page, and each is the
 * first and only picture that page's canvas is asked for.
 */
async function mapImageOf(page: Page, feed: unknown): Promise<Buffer> {
  const other = await page.context().newPage();
  try {
    await serveFeed(other, feed);
    await openMap(other);
    await settle(other);
    return await other.locator('[data-testid="map"]').screenshot();
  } finally {
    await other.close();
  }
}

test.describe('the wildfire layer', () => {
  test('says what Copernicus recorded, with the date and the licence, on the page', async ({
    page,
  }) => {
    // 🔴 The real perimeters, with our own clock moved forward.
    //
    // The committed file carries the moment we last ran the fetch, and
    // the page stops drawing it 72 hours later — by design. So a test
    // that asserted "fresh" against the file as committed would pass this
    // week and fail on Thursday, for no reason but the calendar, and the
    // first instinct would be to widen the budget. The CONTENT is the
    // shipped file; only `fetchedAt` is the test's.
    await serveFeed(page, freshFeed());
    await openMap(page);
    await settle(page);

    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'fresh');
    const said = (await note.innerText()).replace(/\s+/g, ' ');

    // The figure, and the fact that it is Copernicus's and not ours.
    expect(said).toContain('Copernicus EFFIS');
    // 🔴 Either sentence, because both are true statements of the same
    // figure and which one appears depends on where the map opens. What
    // must never vary is that the number, the source and the scope are
    // all in it.
    expect(said).toMatch(/[\d,]+ burnt areas? Copernicus EFFIS recorded across the EU-27|Copernicus EFFIS recorded [\d,]+ burnt areas? across the EU-27/);
    // 🔴 The date of the DATA is a licence condition, not decoration.
    expect(said).toMatch(/between \d+ \w+ \d{4} and \d+ \w+ \d{4}/);
    expect(said).toMatch(/Read from Copernicus on \d+ \w+ \d{4}/);
    // 🔴 The credit, rendered, with a link a reader can follow.
    expect(said).toContain('CC BY 4.0');
    expect(said).toContain('© European Union');
    await expect(note.getByRole('link', { name: /CC BY 4.0/ })).toHaveAttribute(
      'href',
      String(FEED.meta.licenceUrl),
    );
    await expect(note.getByRole('link', { name: /Copernicus/ })).toHaveAttribute(
      'href',
      String(FEED.meta.sourceUrl),
    );
    // 🔴 And it tells the reader whose decision this is.
    expect(said).toContain('your call');
    // 🔴 The credit the CEMS terms dictate for MODIFIED data, with the
    // year, rendered beside the shapes rather than held in a constant.
    expect(said).toMatch(
      /Contains modified Copernicus Emergency Management Service information \d{4}/,
    );
    await expect(note.getByRole('link', { name: /CEMS terms/ })).toHaveAttribute(
      'href',
      String(FEED.meta.termsUrl),
    );
  });

  test('a feed credited only under CC BY is refused', async ({ page }) => {
    // 🔴 Two licences meet on this layer and satisfying one is not
    // satisfying the other. The CEMS terms name the notice word for word
    // for data that has been "adapted or modified", and ours has been.
    await serveFeed(
      page,
      freshFeed({ attribution: 'Copernicus EFFIS/GWIS — © European Union, licensed CC BY 4.0' }),
    );
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'missing');
  });

  test('nothing the page says about fire is an instruction or a reserved word', async ({
    page,
  }) => {
    // 🔴 Read off the RENDERED page, not off the feed. The CEMS terms
    // bind EFFIS and GWIS by name and say the data "does not constitute
    // in any way an early warning for which only national/regional
    // institutions are authorized within their region of responsibility"
    // — so "warning", "danger", "risk" and "alert" are not ours to use
    // about it, and neither is any instruction. A check that read the
    // JSON instead would go on passing while a component printed one.
    await serveFeed(page, freshFeed());
    await openMap(page);
    await settle(page);
    const said = await page.locator(NOTE).innerText();
    expect(said).not.toMatch(
      /\b(do not|don't|never|avoid|evacuate|stay away|unsafe|dangerous|danger|warning|risk|alert)\b/i,
    );
    // And the other half of the clause: who DOES issue official notices.
    expect(said).toContain('national and regional services are authorised');
  });

  test('a burnt area really reaches the canvas', async ({ page }) => {
    // 🔴 The pixels, not the row count. Every other check here reads
    // text, and text would go on passing if the source were never given
    // its data — which is exactly the failure this project has recorded
    // before: green tests over a dead map. So: the same view, the same
    // campsites, photographed with the layer on and with it off. If the
    // perimeters are not drawn, the two images are byte-identical.
    await serveFeed(page, inViewFeed());
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-in-view', '1');
    // 🔴 The WORDS, not only the attribute. Both the unit spec and this
    // one asserted `data-in-view`, so the "N are in this view" clause was
    // deletable from the headline with everything green.
    expect((await page.locator(NOTE).innerText()).replace(/\s+/g, ' ')).toContain(
      '1 is in this view',
    );
    const on = await page.locator('[data-testid="map"]').screenshot();
    // The same view and the same campsites, from a page whose feed holds no
    // fire at all. Only the burnt area can differ between the two.
    const without = await mapImageOf(page, feedOf([]));

    expect(
      Buffer.compare(on, without) === 0,
      'the map looked identical with and without a burnt area in view — nothing was drawn',
    ).toBe(false);
  });

  test('switching the layer off takes the burnt area off the canvas', async ({
    page,
    browserName,
  }) => {
    // 🔴 SKIPPED where the picture cannot be trusted, and only there. In
    // WebKit on Linux a second photograph of a WebGL canvas returns the
    // first (see `mapImageOf`), so "on, then off" reads as "no change"
    // however well the layer switches. The page really does change there —
    // the run's trace shows it — it is the camera that cannot see. Chromium
    // and Firefox on the runner, and WebKit on a Mac, run this for real.
    test.skip(
      browserName === 'webkit' && process.platform === 'linux',
      'WebKit on Linux re-serves the first canvas photograph — see mapImageOf',
    );
    await serveFeed(page, inViewFeed());
    await openMap(page);
    await settle(page);
    const map = page.locator('[data-testid="map"]');
    const on = await map.screenshot();

    await page.locator('[data-layer="wildfire"]').click();
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'off');
    await page.waitForTimeout(1500);
    const off = await map.screenshot();

    expect(
      Buffer.compare(on, off) === 0,
      'the map looked identical with the layer switched on and off — the switch does nothing',
    ).toBe(false);
  });

  test('the card on a burnt area carries the credit and no reserved word', async ({
    page,
  }) => {
    // 🔴 Read off the popup itself, not off the feed. This is where a
    // reader is looking when they are deciding about one particular
    // place, so the CEMS notice has to be here too — and a check that
    // asserted `meta.attribution` instead would pass just as happily over
    // a card that printed nothing at all.
    await serveFeed(page, inViewFeed());
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-in-view', '1');

    const map = page.locator('[data-testid="map"]');
    // 🔴 `locator.click`, not `mouse.click` at a bounding box. The map
    // sits below the filters panel, so on a desktop viewport its box
    // starts past the fold — the first version of this aimed at
    // coordinates that were off-screen and reported "no popup", which
    // reads as a broken feature rather than a badly aimed test.
    // Playwright scrolls the element in and clicks the given offset.
    const box = await map.boundingBox();
    if (!box) throw new Error('the map has no box to click in');
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } });

    const card = page.locator('.ct-popup');
    await expect(card).toBeVisible();
    const said = (await card.innerText()).replace(/\s+/g, ' ');
    expect(said).toContain('Velebit');
    expect(said).toMatch(/Fire recorded \d+ \w+ \d{4}/);
    expect(said).toMatch(
      /Contains modified Copernicus Emergency Management Service information \d{4}/,
    );
    expect(said).not.toMatch(
      /\b(do not|don't|never|avoid|evacuate|unsafe|dangerous|danger|warning|risk|alert)\b/i,
    );
  });

  test('🔴 the loading sentence is on the page, not merely a state name', async ({ page }) => {
    // 🔴 THE DEFECT THIS REPLACES. `settle()` waited for
    // `data-state !== 'loading'` and nothing ever read the loading words,
    // so replacing that whole branch with the `missing` text left the
    // suite green. An empty map while a fetch is in flight and an empty
    // map because the fetch failed are the same picture; only the
    // sentence tells them apart, so the sentence has to be asserted.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/data/wildfires.json', async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(freshFeed()),
      });
    });

    await openMap(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'loading');
    const waiting = (await note.innerText()).replace(/\s+/g, ' ');
    expect(waiting).toContain('Loading the Copernicus EFFIS wildfire layer');
    expect(waiting).toContain('still fetching');
    // 🔴 And it does not borrow the failure's words while it is merely slow.
    expect(waiting).not.toContain('No fresh wildfire data');
    expect(waiting).not.toContain('could not load');

    release();
    await expect(note).toHaveAttribute('data-state', 'fresh');
  });

  // 🔴 THE DEFECT THESE REPLACE. Click and cursor were bound to the FILL,
  // and measured over the shipped 278 perimeters (512 px tiles, z6.2) the
  // median is 0.7 px across, 254 are under 3 px and the largest is 8. The
  // old test hid that behind a 167 px fixture clicked dead centre — the
  // fixture was sized around the defect.
  //
  // So the shapes below are READ FROM THE SHIPPED FILE (see REAL_SHAPES):
  // the smallest, a quarter-of-the-way, the median and the largest
  // perimeter it holds by area, each moved to the middle of the opening
  // view and clicked where a reader would — on it, a few pixels beside it,
  // and nowhere near it. A hit area that is the whole map would pass the
  // first two and fail the third; a hit area that is the fill would fail
  // the first; a source that drops the small polygons would fail both.
  for (const [which, fire] of REAL_SHAPES) {
    test(`🔴 the ${which} perimeter we ship can be clicked, a few pixels off can be clicked, and empty map cannot`, async ({
      page,
    }) => {
      await serveFeed(page, feedOf([centred(fire)]));
      await openMap(page);
      await settle(page);
      await expect(page.locator(NOTE)).toHaveAttribute('data-in-view', '1');

      const map = page.locator('[data-testid="map"]');
      const box = await map.boundingBox();
      if (!box) throw new Error('the map has no box to click in');
      const cx = box.width / 2;
      const cy = box.height / 2;
      const fireCard = page.locator('.ct-popup', { hasText: 'Fire recorded' });
      const canvas = page.locator('canvas.maplibregl-canvas');
      // 🔴 Empty map, chosen so nothing else is there: the card opens ABOVE
      // the point that was clicked and is 260 px wide, so a spot straight
      // above the fire is under the card — the first version clicked there
      // to "close" it and hit the card instead. This one is up and to the
      // left, and the nearest campsite in the CI fixture is 75 px from it.
      // It is used BEFORE any card is open, and cards are closed by their
      // own button.
      const empty = { x: cx - 120, y: cy - 100 };
      // dispatchEvent, not click(): on a phone the card sits under the zoom
      // control and the cookie banner, and a real pointer click on its close
      // button is intercepted by whatever is on top of it.
      const close = () => page.locator('.maplibregl-popup-close-button').dispatchEvent('click');

      // Empty map first: no pointer, no card.
      await map.hover({ position: empty });
      await expect(canvas).not.toHaveCSS('cursor', 'pointer');
      await map.click({ position: empty });
      await expect(fireCard).toHaveCount(0);

      // On it — and the pointer says so before the reader commits.
      await map.hover({ position: { x: cx, y: cy } });
      await expect(canvas).toHaveCSS('cursor', 'pointer');
      await map.click({ position: { x: cx, y: cy } });
      await expect(fireCard).toBeVisible();
      await close();
      await expect(fireCard).toHaveCount(0);

      // Beside it, the way a thumb lands: 5 px each way. The hit line is
      // 14.5 px wide at this zoom, so a reader within 7 px of the mark
      // is inside it.
      for (const [dx, dy] of [
        [5, 0],
        [-5, 0],
        [0, 5],
        [0, -5],
      ]) {
        await map.click({ position: { x: cx + dx, y: cy + dy } });
        await expect(fireCard, `nothing at (${dx}, ${dy}) from the ${which} perimeter`).toBeVisible();
        await close();
        await expect(fireCard).toHaveCount(0);
      }
    });
  }

  test('🔴 the inside of a big perimeter, and its outline, both open the card', async ({
    page,
  }) => {
    // 🔴 The first repair of the defect above bound the click to the wide
    // invisible LINE only, which fixed the small fires and broke the big
    // ones: a click in the middle of a 4 200 ha burnt area found nothing.
    // Both checks are needed, and this is the second.
    await serveFeed(page, inViewFeed(undefined, 0.8));
    await openMap(page);
    await settle(page);
    const map = page.locator('[data-testid="map"]');
    const box = await map.boundingBox();
    if (!box) throw new Error('the map has no box to click in');
    const fireCard = page.locator('.ct-popup', { hasText: 'Fire recorded' });
    const canvas = page.locator('canvas.maplibregl-canvas');

    // Inside, well away from the edge (0.8° is 84 px each side).
    await map.hover({ position: { x: box.width / 2 + 30, y: box.height / 2 + 20 } });
    await expect(canvas).toHaveCSS('cursor', 'pointer');
    await map.click({ position: { x: box.width / 2 + 30, y: box.height / 2 + 20 } });
    await expect(fireCard).toBeVisible();
    await page.locator('.maplibregl-popup-close-button').dispatchEvent('click');
    await expect(fireCard).toHaveCount(0);

    // On the western edge, where the line AND the fill are both under the
    // pointer. One click, one card.
    const edge = box.width / 2 - 0.8 * PX_PER_DEGREE;
    await map.click({ position: { x: edge, y: box.height / 2 } });
    await expect(fireCard).toHaveCount(1);
  });

  test('🔴 a place name we may not print is not on the card', async ({ page }) => {
    // 🔴 THE DEFECT THIS REPLACES. The old version asserted that the card
    // carried no reserved word while feeding it `place: 'Velebit'` — a
    // string the test itself wrote. The corpus and the claim shared a
    // field, which is the same defect the badge review found before this
    // one. Now the fixture carries exactly what the claim is about.
    await serveFeed(
      page,
      inViewFeed(undefined, 0.5, 'Danger Ridge, Alert Province'),
    );
    await openMap(page);
    await settle(page);

    const map = page.locator('[data-testid="map"]');
    const box = await map.boundingBox();
    if (!box) throw new Error('the map has no box to click in');
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } });

    const card = page.locator('.ct-popup');
    await expect(card).toBeVisible();
    const said = (await card.innerText()).replace(/\s+/g, ' ');
    // The fire is still there, named the honest way.
    expect(said).toContain('Burnt area in HR');
    expect(said).toContain('Fire recorded');
    expect(said).toMatch(
      /Contains modified Copernicus Emergency Management Service information \d{4}/,
    );
    // 🔴 And the words the CEMS terms reserve are nowhere on it.
    expect(said).not.toMatch(/\b(danger|alert|warning|risk)\b/i);
  });

  test('🔴 a feed that speaks with a national service’s authority is refused', async ({
    page,
  }) => {
    // The sentence comes out of the feed and is rendered verbatim, so a
    // pipeline writing this would have put it on the page under our
    // voice. Asserted on the RENDERING, because that is where it lands.
    await serveFeed(
      page,
      freshFeed({
        authorityNote:
          'This is an official fire danger warning: extreme risk, evacuate the area immediately.',
      }),
    );
    await openMap(page);
    await settle(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'missing');
    const said = await note.innerText();
    expect(said).toContain('No fresh wildfire data');
    expect(said).not.toMatch(/\b(danger|evacuate|risk|warning)\b/i);
  });

  test('🔴 one unusable record does not take the map down', async ({ page }) => {
    // `features: [null]` used to reach `fresh` and then throw
    // "Cannot read properties of null" out of a React effect — a blank
    // map instead of a sentence. The good record must survive alongside.
    const real = inViewFeed(undefined, 0.5);
    await serveFeed(page, {
      ...real,
      features: [null, { type: 'Feature', geometry: null, properties: {} }, ...real.features],
    });
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'fresh');
    await expect(page.locator(NOTE)).toHaveAttribute('data-in-view', '1');
    // The page is alive: the country list under the map still rendered.
    await expect(page.getByRole('heading', { name: 'Browse instead' })).toBeVisible();
  });

  test('switched off, the map still refuses to read as an all-clear', async ({ page }) => {
    await serveFeed(page, freshFeed());
    await openMap(page);
    await settle(page);
    await page.locator('[data-layer="wildfire"]').click();
    const said = await page.locator(NOTE).innerText();
    expect(said).toContain('switched off');
    expect(said).toContain('not an all-clear');
  });

  // ── the states a reader must never mistake for "nothing has burnt" ──

  test('a feed we last read four days ago is refused, and the page says so', async ({
    page,
  }) => {
    // 🔴 THE REALISTIC FAILURE. The fetch succeeds and returns an
    // archive: 200 OK, well-formed, four days old. A naive health check
    // calls that green, and the map would show a four-day-old fire
    // picture as though it were current.
    await serveFeed(page, freshFeed({ fetchedAt: daysAgo(4) }));
    await openMap(page);
    await settle(page);

    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'stale');
    const said = (await note.innerText()).replace(/\s+/g, ' ');
    expect(said).toContain('No fresh wildfire data');
    expect(said).toContain('not a statement that nothing has burnt');
    // 🔴 What ONLY the stale state says, which `missing` cannot: when we
    // last read Copernicus, how old that is, and the budget it broke.
    // These three were the whole of the difference between "we could not
    // load it" and "we loaded it and it is old", and a reader is owed to
    // be told which. `missing` says both of the first two sentences
    // above, so asserting only those left the state deletable.
    expect(said).toContain('We last read Copernicus EFFIS successfully');
    expect(said).toMatch(/was 9[67] hours ago, past our 72-hour budget/);
    expect(said).toMatch(/successfully on \d+ \w+ \d{4}/);
    // And it does not say the other failure's words.
    expect(said).not.toContain('could not load');
    // And the perimeters are off the map, not left sitting there.
    expect(said).not.toMatch(/recorded [\d,]+ burnt areas/);
  });

  test('a feed from an hour ago is drawn', async ({ page }) => {
    // The other side of the boundary, so "stale" is not simply always on.
    await serveFeed(page, freshFeed());
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'fresh');
  });

  test('a 500 from our own file says “no fresh data”, never nothing', async ({ page }) => {
    await serveFeed(page, {}, 500);
    await openMap(page);
    await settle(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'missing');
    const said = await note.innerText();
    expect(said).toContain('No fresh wildfire data');
    expect(said).toContain('not a statement that nothing has burnt');
    // 🔴 Its OWN words, and none of the stale state's — a failed load has
    // no "last read" to report.
    expect(said).toContain('could not load the Copernicus EFFIS layer');
    expect(said).not.toContain('We last read');
  });

  test('an HTML error page served in place of the feed does the same', async ({ page }) => {
    // A CDN or a proxy answering 200 with a holding page is the version
    // of this failure that a status-code check would wave through.
    await serveFeed(page, null, 200);
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'missing');
    const said = await page.locator(NOTE).innerText();
    expect(said).toContain('No fresh wildfire data');
    expect(said).toContain('could not load the Copernicus EFFIS layer');
  });

  test('a feed with the attribution stripped is not drawn', async ({ page }) => {
    // 🔴 Drawing somebody else's data with the credit removed is a
    // licence breach, and it is invisible until it is expensive. The page
    // refuses the feed instead, which is visible immediately.
    await serveFeed(page, freshFeed({ attribution: '' }));
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'missing');
  });

  test('a stale feed leaves nothing on the canvas', async ({ page }) => {
    // 🔴 The words say the layer is off; this proves it. Photographed
    // against a page whose feed holds no fire at all — if a stale feed still
    // painted perimeters, these two would differ.
    await serveFeed(page, inViewFeed({ ...FEED.meta, fetchedAt: daysAgo(9) }));
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'stale');
    const stale = await page.locator('[data-testid="map"]').screenshot();
    const off = await mapImageOf(page, feedOf([]));

    // 🔴 This one is only as good as its control: two blank frames are
    // equal too. The control is the test named "a burnt area really
    // reaches the canvas", which serves the SAME fixture geometry fresh
    // and requires the two frames to differ — so a map that draws nothing
    // at all fails that test, and a stale feed that draws fails this one.
    expect(
      Buffer.compare(stale, off),
      'a stale feed still drew something on the map',
    ).toBe(0);
  });

  // ── the six states, each asserted on the page, each dying on its own ──
  //
  // 🔴 THE DEFECT THIS BLOCK REPLACES. Replacing `wildfireNote`'s loading
  // branch with the `missing` text verbatim, or gutting `stale` of its
  // age, its "we last read Copernicus EFFIS successfully" and its 72-hour
  // budget, left 25 of 25 unit tests green — and the e2e as well, because
  // `settle()` waited only for `data-state !== 'loading'` and the stale
  // test asserted the two sentences `missing` ALSO says. Three of the six
  // states were one state that the tests could not tell apart.
  //
  // So: one test per state, each serving the feed that produces it, each
  // reading the RENDERED note, each requiring the state's own phrase to be
  // there AND the other five's phrases to be absent. A state that borrows
  // another's words fails on the borrowed phrase; a state that loses its
  // own fails on its own. The phrases are typed here, not imported from
  // the component — imported, they would move with the code they check.
  const SAYS = {
    loading: 'Loading the Copernicus EFFIS wildfire layer',
    missing: 'could not load the Copernicus EFFIS layer',
    stale: 'We last read Copernicus EFFIS successfully',
    none: 'recorded no burnt areas across the EU-27',
    'none in view': 'None of the',
    'some in view': '2 are in this view',
  } as const;
  type StateName = keyof typeof SAYS;

  const ARRANGE: Record<StateName, (page: Page) => Promise<() => void>> = {
    loading: async (page) => {
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/data/wildfires.json', async (route) => {
        await held;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(freshFeed()),
        });
      });
      return release;
    },
    missing: async (page) => {
      await serveFeed(page, {}, 500);
      return () => {};
    },
    stale: async (page) => {
      await serveFeed(page, freshFeed({ fetchedAt: daysAgo(4) }));
      return () => {};
    },
    none: async (page) => {
      await serveFeed(page, feedOf([]));
      return () => {};
    },
    'none in view': async (page) => {
      // Two fires, both in Portugal; the map opens over Croatia.
      await serveFeed(page, feedOf([squareFire(-8, 39, 0.05), squareFire(-7.5, 39.5, 0.05)]));
      return () => {};
    },
    'some in view': async (page) => {
      await serveFeed(
        page,
        feedOf([
          squareFire(INITIAL_VIEW.lng, INITIAL_VIEW.lat, 0.4),
          squareFire(INITIAL_VIEW.lng + 0.5, INITIAL_VIEW.lat + 0.3, 0.2, { id: 'test-2' }),
        ]),
      );
      return () => {};
    },
  };

  for (const state of Object.keys(SAYS) as StateName[]) {
    test(`🔴 the ${state} state says its own words on the page, and none of the other five’s`, async ({
      page,
    }) => {
      const release = await ARRANGE[state](page);
      await openMap(page);
      const note = page.locator(NOTE);
      if (state === 'loading') {
        await expect(note).toHaveAttribute('data-state', 'loading');
      } else {
        await settle(page);
      }
      const said = (await note.innerText()).replace(/\s+/g, ' ');
      release();

      expect(said, `${state} lost its own words`).toContain(SAYS[state]);
      for (const other of Object.keys(SAYS) as StateName[]) {
        if (other === state) continue;
        expect(said, `${state} borrowed ${other}’s words: "${SAYS[other]}"`).not.toContain(
          SAYS[other],
        );
      }
    });
  }

  test('🔴 the fresh headline says how many are in this view, in words', async ({ page }) => {
    // The "N are in this view" clause could be deleted from the headline
    // with unit and e2e green, because both asserted the `data-in-view`
    // attribute and neither the sentence. The matrix above pins the plural;
    // this pins the singular and the attribute to the sentence, so the two
    // cannot drift apart.
    await serveFeed(page, inViewFeed(undefined, 0.4));
    await openMap(page);
    await settle(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-in-view', '1');
    const said = (await note.innerText()).replace(/\s+/g, ' ');
    expect(said).toMatch(/recorded 1 burnt area across the EU-27 between .* 1 is in this view\./);
  });

  test('🔴 a string the note prints as a link is gated like the sentences are', async ({
    page,
  }) => {
    // `source` and `licence` are the visible text of two links. The gate
    // used to cover `authorityNote` and `attribution` only, so a feed
    // whose `source` read "Fire danger service" put a reserved word on
    // the page. Asserted on the rendering, because that is where it lands.
    await serveFeed(page, freshFeed({ source: 'Fire danger service' }));
    await openMap(page);
    await settle(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'missing');
    expect(await note.innerText()).not.toMatch(/danger/i);
  });

  test('🔴 a feed whose every record is unreadable says so, not “no burnt areas”', async ({
    page,
  }) => {
    // `features: [null]` used to reach `fresh` and, once records were
    // validated one by one, would have reached `fresh` with ZERO fires —
    // and "Copernicus EFFIS recorded no burnt areas across the EU-27" said
    // over a file that held records we could not read is the all-clear
    // this layer exists to refuse. Nothing readable means it is not the
    // file we wrote.
    await serveFeed(page, feedOf([null, { type: 'Feature', geometry: null, properties: {} }]));
    await openMap(page);
    await settle(page);
    const note = page.locator(NOTE);
    await expect(note).toHaveAttribute('data-state', 'missing');
    const said = (await note.innerText()).replace(/\s+/g, ' ');
    expect(said).toContain('No fresh wildfire data');
    expect(said).not.toContain('recorded no burnt areas');
  });

  test('🔴 a country we may not print costs the record, and is on no page', async ({ page }) => {
    // With no `place` the card prints `country`, so "Burnt area in DANGER"
    // was one field away from the place-name gate. The bad record sits
    // dead centre so a click there would open its card if it survived.
    await serveFeed(
      page,
      feedOf([
        squareFire(INITIAL_VIEW.lng, INITIAL_VIEW.lat, 0.5, { country: 'DANGER', place: '' }),
        squareFire(-8, 39, 0.05, { id: 'far', country: 'PT', place: 'Portel' }),
      ]),
    );
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'fresh');
    // One record survived, and it is not in this view.
    await expect(page.locator(NOTE)).toHaveAttribute('data-in-view', '0');
    const map = page.locator('[data-testid="map"]');
    const box = await map.boundingBox();
    if (!box) throw new Error('the map has no box to click in');
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator('.ct-popup', { hasText: 'Fire recorded' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('DANGER');
  });

  test('no fire is drawn outside the EU-27', async ({ page }) => {
    // 🔴 Scope is an owner decision, and EFFIS covers north Africa, the
    // Balkans and Ukraine — 4 875 Ukrainian fires this season alone. A
    // filter that quietly stopped working would put them on the map.
    await openMap(page);
    await settle(page);
    const countries: string[] = await page.evaluate(async () => {
      const res = await fetch('/data/wildfires.json');
      const feed = (await res.json()) as {
        features: { properties: { country: string } }[];
      };
      return [...new Set(feed.features.map((f) => f.properties.country))];
    });
    expect(countries.length).toBeGreaterThan(0);
    for (const c of countries) {
      expect(['UA', 'TR', 'RS', 'BA', 'AL', 'MK', 'ME', 'NO', 'CH', 'DZ', 'MA', 'TN', 'UK']).not.toContain(c);
    }
  });
});
