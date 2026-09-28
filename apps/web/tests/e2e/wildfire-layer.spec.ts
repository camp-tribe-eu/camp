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
  // The limit refills over a minute, so the waits add up to more than one.
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.goto('/map');
    if ((await page.locator('[data-testid="map"]').count()) > 0) return;
    const broke = await page.getByText('This page did not load properly').count();
    if (broke === 0) return; // something else is wrong — let the test say so
    await page.waitForTimeout(3000 * (attempt + 1));
  }
  throw new Error('/map never rendered: the API kept refusing the region index');
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
 * 🔴 Deliberately large. At the opening zoom of 6.2 the world is 18 816 px
 * wide, so 0.8° of longitude is about 42 px — a perimeter that size is
 * something a click can miss, and a missed click reports "no popup",
 * which reads as a broken feature. 1.6° across is ~84 px and the click
 * goes to the map's exact centre.
 */
const freshFeed = (over: Record<string, unknown> = {}) => ({
  ...FEED,
  meta: { ...FEED.meta, fetchedAt: daysAgo(0.02), ...over },
});

const inViewFeed = (
  meta: Record<string, unknown> = { ...FEED.meta, fetchedAt: daysAgo(0.02) },
  half = 0.8,
  place = 'Velebit',
) => ({
  type: 'FeatureCollection',
  meta,
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [INITIAL_VIEW.lng - half, INITIAL_VIEW.lat - half],
            [INITIAL_VIEW.lng + half, INITIAL_VIEW.lat - half],
            [INITIAL_VIEW.lng + half, INITIAL_VIEW.lat + half],
            [INITIAL_VIEW.lng - half, INITIAL_VIEW.lat + half],
            [INITIAL_VIEW.lng - half, INITIAL_VIEW.lat - half],
          ],
        ],
      },
      properties: {
        id: 'test-1',
        date: '2026-09-20',
        country: 'HR',
        place,
        hectares: 4200,
      },
    },
  ],
});

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
    const map = page.locator('[data-testid="map"]');
    const on = await map.screenshot();

    await page.locator('[data-layer="wildfire"]').click();
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'off');
    await page.waitForTimeout(1500);
    const off = await map.screenshot();

    expect(
      Buffer.compare(on, off) === 0,
      'the map looked identical with the wildfire layer on and off — nothing was drawn',
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

  test('🔴 a reader can click a perimeter the size the data actually holds', async ({
    page,
  }) => {
    // 🔴 THE DEFECT THIS REPLACES. Click and cursor were bound to the
    // FILL, and measured over the shipped 278 perimeters the median is
    // 0.31 px wide at the zoom /map opens at, with 276 of 278 under 3 px.
    // The old test hid that behind an 84 px fixture clicked dead centre —
    // the fixture was sized around the defect.
    //
    // This one is the real median: 0.006° across, about a third of a
    // pixel. If the invisible hit line is removed, nothing is clickable
    // and this test is the only thing that says so.
    await serveFeed(page, inViewFeed(undefined, 0.003));
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-in-view', '1');

    const map = page.locator('[data-testid="map"]');
    const box = await map.boundingBox();
    if (!box) throw new Error('the map has no box to click in');
    // The map's own centre, where the fixture sits.
    await map.hover({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCSS('cursor', 'pointer');
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } });

    const card = page.locator('.ct-popup');
    await expect(card).toBeVisible();
    expect(await card.innerText()).toContain('Fire recorded');
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
  });

  test('an HTML error page served in place of the feed does the same', async ({ page }) => {
    // A CDN or a proxy answering 200 with a holding page is the version
    // of this failure that a status-code check would wave through.
    await serveFeed(page, null, 200);
    await openMap(page);
    await settle(page);
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'missing');
    expect(await page.locator(NOTE).innerText()).toContain('No fresh wildfire data');
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
    // against the same page with the layer switched off by hand — if a
    // stale feed still painted perimeters, these two would differ.
    await serveFeed(page, inViewFeed({ ...FEED.meta, fetchedAt: daysAgo(9) }));
    await openMap(page);
    await settle(page);
    const map = page.locator('[data-testid="map"]');
    const stale = await map.screenshot();

    await page.locator('[data-layer="wildfire"]').click();
    await expect(page.locator(NOTE)).toHaveAttribute('data-state', 'off');
    await page.waitForTimeout(1500);
    const off = await map.screenshot();

    expect(
      Buffer.compare(stale, off),
      'a stale feed still drew something on the map',
    ).toBe(0);
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
