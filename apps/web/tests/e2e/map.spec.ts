import { expect, test, type Page } from './api-request';
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
// CAMP-127: the snapshot these tests used to read no longer exists.
//
// 🔴 It was one file with every campsite and a cap of 20 000. The EU-27
// import took the database to 61 521, the cap fired, and the map served a
// 500 — so the map now reads an index and fetches the regions in view.
// These tests follow it: one real chunk is a better sample than a whole
// continent, and it is the same shape of document.
async function aChunk(page: import('@playwright/test').Page) {
  const index = await page.request.get('/data/spots/index.json');
  expect(index.status(), 'the map index is missing').toBe(200);
  const regions = (await index.json()) as {
    country: string;
    slug: string;
    count: number;
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  }[];
  expect(regions.length, 'an empty index is a broken build').toBeGreaterThan(0);
  // The biggest one, so the sample is worth taking.
  const biggest = regions.reduce((a, b) => (b.count > a.count ? b : a));
  const res = await page.request.get(
    `/data/spots/${biggest.country.toLowerCase()}/${biggest.slug}.geojson`,
  );
  expect(res.status(), `chunk ${biggest.country}/${biggest.slug} is missing`).toBe(200);
  return { body: await res.json(), region: biggest };
}

async function stubSpots(
  page: Page,
  points: { lng: number; lat: number; name?: string }[],
) {
  // 🔴 The index is a different shape from a chunk, and one route
  // pattern cannot answer both.
  //
  // CAMP-127 split the map into `/data/spots/index.json` (an ARRAY of
  // region summaries) plus `/data/spots/<cc>/<region>.geojson` (a
  // FeatureCollection). This stub matched `**/data/spots/**`, so it
  // answered the index with a FeatureCollection too — the component
  // checks `Array.isArray(regions)`, went straight to `failed`, and
  // never called `refresh()`. Nothing was ever drawn, and two specs
  // timed out at 20 s waiting for clusters that could not appear.
  //
  // One region, covering the whole world, so whatever the fixture
  // points are they fall inside it.
  await page.route('**/data/spots/index.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: [
        {
          country: 'HR',
          region: 'Fixture',
          slug: 'fixture',
          count: points.length,
          minLon: -180,
          minLat: -85,
          maxLon: 180,
          maxLat: 85,
          lon: 0,
          lat: 0,
        },
      ],
    }),
  );

  await page.route('**/data/spots/*/*.geojson', (route) =>
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
  // The same budget as the filter suite, and for the same measured
  // reason: a map test now includes zooming to detail and fetching one
  // file per region in view.
  test.describe.configure({ timeout: 90_000 });

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
    const { body } = await aChunk(page);
    expect(body.type).toBe('FeatureCollection');
    expect(body.features.length).toBeGreaterThan(0);

    // A handful is enough to catch a broken rule; all of them would make
    // this test scale with the dataset.
    for (const f of body.features.slice(0, 12)) {
      const href = f.properties.href as string | null;
      // 🔴 Null is a legitimate answer now, and the reason is CAMP-127:
      // 135 campsites carry no region, so they have no page — and the
      // href used to be `/camping/cy//arazi`, a 404 the map handed out.
      // The popup renders text instead. What must never appear is a
      // path with a hole in it.
      if (href === null) continue;
      expect(href).not.toContain('//');
      expect(href).toMatch(/^\/camping\/[a-z]{2}\/[^/]+\/[^/]+$/);
      const res = await page.request.get(href);
      expect(res.status(), `${href} is a dead marker link`).toBe(200);
    }
  });

  test('a marker carries the facilities we actually hold', async ({ page }) => {
    const { body } = await aChunk(page);

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
    const { body, region } = await aChunk(page);
    // 🔴 Ask the API for the SAME ground the chunk covers.
    //
    // This asked for 400 markers from the whole world and compared them
    // against one region's chunk, so almost nothing overlapped:
    // measured, 30 comparisons against a floor of 100, and the test
    // failed for want of subjects rather than for a defect. Since
    // CAMP-127 a chunk is one region, so the bbox to ask for is that
    // region's own.
    const bbox = [region.minLon, region.minLat, region.maxLon, region.maxLat]
      .map((n) => n.toFixed(6))
      .join(',');
    const { markers } = await (
      await request.get(`${api}/spots/map/points?bbox=${bbox}&limit=20000`)
    ).json();
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

    // 🔴 The card's criterion — checked where clustering happens.
    //
    // CAMP-32 says campsites must arrive as a handful of counted bubbles
    // rather than one circle each. That was asserted "at the opening
    // zoom", which stopped being true with CAMP-127: on the full dataset
    // /map opens too wide for markers and draws one circle per REGION,
    // so `data-visible-clusters` is correctly 0. The criterion is about
    // markers, so the test has to be where markers are.
    const zoomIn = page.locator('.maplibregl-ctrl-zoom-in');
    await expect(zoomIn).toBeVisible();
    for (let i = 0; i < 8; i++) {
      if (Number(await map(page).getAttribute('data-total')) > 0) break;
      await zoomIn.click();
      for (let w = 0; w < 8; w++) {
        if (Number(await map(page).getAttribute('data-total')) > 0) break;
        await page.waitForTimeout(150);
      }
    }

    await expect
      .poll(async () => Number(await map(page).getAttribute('data-visible-clusters')), {
        timeout: 20_000,
        message: 'nothing clustered once the map draws campsites',
      })
      .toBeGreaterThan(0);

    expect(mimeErrors, 'the worker failed to load').toEqual([]);
  });

  // 🔴 CAMP-175. Zooming OUT again, which is the half nothing asserted.
  //
  // `clearRegions` removes the circle layer the moment real markers go
  // on the map, and the zoom-out branch puts it back through
  // `whenDrawable(() => drawRegions(…))` — deferred until the style is
  // ready. Nothing proved the second half ever happens: the only test
  // that mentions the circles adds them to points and clusters and asks
  // for a sum above zero, so a region count of 0 passes on the strength
  // of the markers. The card saw exactly that 0 and could not tell
  // whether it meant "broken", "the fixture has no regions" or
  // "intended".
  //
  // This asserts the one reading that distinguishes them: after a zoom
  // in and back out, the circles are on the canvas AND counted. If it
  // goes red, the deferred redraw is being skipped and never retried —
  // which is the defect the card suspected.
  test('zooming back out brings the region circles back, counted', async ({
    page,
  }) => {
    await stubStyles(page);
    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();

    const attr = async (name: string) =>
      Number(await map(page).getAttribute(name));

    // 🔴 FIRST: prove the circles exist at all.
    //
    // Everything below asks whether they come BACK. If they are never
    // drawn — an empty region index, a `drawRegions` that threw into a
    // floating promise — then "0 after zooming out" is the only answer
    // this test could give, and it would read as the defect the card
    // suspected while actually meaning the subject does not exist.
    //
    // 🔴 And it cannot be asserted on the page as it opens. INITIAL_VIEW
    // is zoom 6.2 and DETAIL_ZOOM is 6, so /map opens in the DETAIL
    // branch: no circles, correctly. An earlier draft of this test
    // asserted them on the first view and went red on chromium and
    // webkit for exactly that reason — the premise was wrong, not the
    // map.
    //
    // 🔴 So the zoom is driven by what the map SAYS, not by a count of
    // clicks. `data-map-state` reads `wide` only when the wide branch
    // has run, which is the branch that draws the circles. Counting
    // clicks was the other half of the same mistake: this file's own
    // `zoomIn` helper waits 350 ms because "a click that lands
    // mid-animation is dropped", and the zoom-out loop below used to
    // fire ten clicks 150 ms apart and simply assume it had arrived.
    const zoomOut = page.locator('.maplibregl-ctrl-zoom-out');
    await expect(zoomOut).toBeVisible();
    const untilWide = async () => {
      for (let i = 0; i < 12; i++) {
        if ((await map(page).getAttribute('data-map-state')) === 'wide') return true;
        await zoomOut.click();
        await page.waitForTimeout(350);
      }
      return (await map(page).getAttribute('data-map-state')) === 'wide';
    };

    expect(await untilWide(), 'the map never reached a view too wide for markers').toBe(true);

    // 🔴 Which of the two failures is it? `data-region-layer` says
    // whether `drawRegions` ever ran; `data-visible-regions` says
    // whether anything was painted. A message that cannot tell them
    // apart sends the next person looking in the wrong half of the file.
    // 🔴 THE THROWN ERROR FIRST, because it is the cheaper diagnosis.
    //
    // `refresh` is async and floats, so an exception out of
    // `drawRegions` leaves no layer and no message. Asked AFTER the
    // layer poll, this line never runs on the failure it exists to
    // explain — the poll fails first and takes the run with it, which
    // is exactly what happened on the previous attempt.
    await expect
      .poll(async () => await map(page).getAttribute('data-region-error'), {
        timeout: 5_000,
        message: 'drawRegions threw and the exception was swallowed by a floating promise',
      })
      .toBeNull();

    // 🔴 EVERY PIECE OF THE DIAGNOSIS IN THE SAME OBJECT, because
    // `layer: "off"` on its own has three causes that look identical:
    //
    //   styleLoaded="no"                    the style never arrived
    //   styleLoaded="yes" awaiting="yes"    the retry was registered and
    //                                       never fired
    //   styleLoaded="yes" awaiting="no"     EITHER the draw ran and
    //                                       nothing published it, OR no
    //                                       draw was ever scheduled
    //
    // The last one is what CI actually reported, and the previous run
    // could not say so: `data-region-layer` was written only on `idle`,
    // and the deferred draw finishes on a map that has stopped moving.
    // 🔴 ONE STRING, NOT AN OBJECT, and that is not a style choice.
    //
    // The previous attempt returned `{layer, state, err, styleLoaded,
    // awaiting}` and asserted `toMatchObject({layer: 'on'})`. Playwright
    // diffs only the keys the matcher names, so CI printed
    //
    //     - "layer": "on"
    //     + "layer": "off"
    //
    // and silently dropped the four fields that exist to say WHICH
    // failure this is. A diagnostic the reporter does not print is a
    // diagnostic that was never written. Compared whole, every field is
    // in the diff.
    await expect
      .poll(
        async () => {
          const el = map(page);
          const read = async (n: string) => (await el.getAttribute(n)) ?? 'unset';
          return (
            `layer=${await read('data-region-layer')} ` +
            `style-loaded=${await read('data-style-loaded')} ` +
            `awaiting-style=${await read('data-awaiting-style')} ` +
            `state=${await read('data-map-state')} ` +
            `error=${await read('data-region-error')}`
          );
        },
        {
          timeout: 20_000,
          message:
            'the map reached the wide view and the region layer was never added. ' +
            'style-loaded=no  → the style never arrived; ' +
            'style-loaded=yes awaiting-style=yes → the retry was registered and never fired; ' +
            'style-loaded=yes awaiting-style=no  → ambiguous, and both halves ' +
            'are real: either the draw ran and nobody published it, or nothing ' +
            'was ever waiting. 🔴 Review measured the second half on this very ' +
            'branch — a lost wake-up left draws=0 listeners=0 awaiting=no, which ' +
            'reads IDENTICALLY to a publish that was skipped. Check ' +
            'retry-on-event.spec.ts before looking at publishRegionLayer.',
        },
      )
      .toMatch(/^layer=on /);

    await expect
      .poll(() => attr('data-visible-regions'), {
        timeout: 20_000,
        message:
          'the region layer exists but nothing is painted from it — the circles ' +
          'were drawn somewhere the reader is not looking',
      })
      .toBeGreaterThan(0);

    // 🔴 BACK IN, DRIVEN BY WHAT THE MAP SAYS — the same rule this test
    // already states for the way out, and did not follow on the way in.
    //
    // It was eight clicks with a break on `data-total > 0`. Two things
    // wrong with that, and together they are why this half had never
    // once run: `untilWide` above may spend TWELVE zoom-outs, and eight
    // clicks cannot undo twelve; and `data-total` is about chunks
    // having loaded, which in the wide branch never happens, so the
    // break never fires and the loop just runs out.
    //
    // `data-map-state` leaves `wide` exactly when the detail branch
    // runs, which is the branch that draws markers. That is the
    // question, so that is what is asked — with room to undo however
    // far out we went.
    const zoomIn = page.locator('.maplibregl-ctrl-zoom-in');
    await expect(zoomIn).toBeVisible();
    const untilDetail = async () => {
      for (let i = 0; i < 16; i++) {
        if ((await map(page).getAttribute('data-map-state')) !== 'wide') return true;
        await zoomIn.click();
        await page.waitForTimeout(350);
      }
      return (await map(page).getAttribute('data-map-state')) !== 'wide';
    };
    expect(
      await untilDetail(),
      'the map never came back to a view close enough for markers',
    ).toBe(true);

    await expect
      .poll(() => attr('data-visible-clusters'), {
        timeout: 20_000,
        message:
          'the map says it is in the detail branch, but nothing clustered — ' +
          'either no campsite is in this view or the markers were not drawn',
      })
      .toBeGreaterThan(0);

    // 🔴 And the circles really did go away, so the assertion below
    // cannot be satisfied by a layer that was simply never removed.
    await expect
      .poll(() => attr('data-visible-regions'), {
        timeout: 20_000,
        message: 'the region circles were still counted among the markers',
      })
      .toBe(0);

    // Back out, again driven by what the map says rather than by a
    // count of clicks.
    expect(await untilWide(), 'the map never returned to a view too wide for markers').toBe(true);

    await expect
      .poll(() => attr('data-visible-regions'), {
        timeout: 20_000,
        message:
          'zoomed back out and no region circle was counted — the deferred ' +
          'redraw was skipped and never retried',
      })
      .toBeGreaterThan(0);

    // 🔴 AND THEY STAY. `expect.poll` stops at the first satisfying
    // sample, so circles drawn and then taken away again pass it — and
    // that is precisely CAMP-175's own stated symptom: a stale detail
    // refresh waking up afterwards and calling `clearRegions`.
    // `data-visible-regions` is republished on every `idle`, so the drop
    // would land after the poll had already gone green, and the test
    // would report success over the defect it is named for.
    await page.waitForTimeout(1_200);
    expect(
      await attr('data-visible-regions'),
      'the circles appeared and were then taken away — a stale refresh cleared them',
    ).toBeGreaterThan(0);

    // 🔴 THIS CANNOT FAIL FOR THE REASON IT USED TO CLAIM, and review
    // said so. The paragraph here described catching "`loading` for
    // ever with the circles drawn behind it" — but `untilWide()` above
    // returns true only by READING `data-map-state === "wide"`, and its
    // own `expect(...).toBe(true)` has already run, so that failure
    // ends the test long before this line.
    //
    // What it does catch is a REVERT: the map settling, the circles
    // being counted, and the state then going back to busy — which is
    // what an overtaken refresh announcing on behalf of a view it no
    // longer owns looks like from outside. A narrower claim than the
    // one that stood here, and the true one.
    //
    // 🔴 `wide`, NOT `ready`, and the first version of this asserted
    // `ready` — a state the map correctly cannot be in here.
    //
    // `MapDataState` has four kinds (map-chunks.ts:335): `loading`,
    // `ready`, `wide` and `failed`. `ready` is the DETAIL branch's
    // terminal state; the wide branch's is `wide`, which is exactly the
    // view these last twelve clicks drove the map back into. CI said
    // `Expected "ready" / Received "wide"` and it was right: the map had
    // announced it finished, in the only word that is true of this view.
    //
    // What this test is actually for is the silence — `loading` for
    // ever behind drawn circles — so that is what it refuses, in both
    // words that mean "settled", and `failed` is refused too rather
    // than passing as not-loading.
    await expect
      .poll(async () => map(page).getAttribute('data-map-state'), {
        timeout: 20_000,
        message:
          'the map went back to calling itself busy after the circles were ' +
          'counted — a refresh announced for a view it no longer owns',
      })
      .toMatch(/^(wide|ready)$/);
  });

  // 🔴 CAMP-133. Found by opening /map on a production build and reading
  // the console: EVERY load threw
  //
  //   Uncaught (in promise) Error: Style is not done loading
  //     at iN._checkLoaded / iN.addSource / oD.addSource
  //
  // out of `drawRegions`. MapLibre's `addSource` and `addLayer` call
  // `_checkLoaded()` and throw when the style has not finished loading,
  // and the region index is a local static file while the style is a
  // remote document — so on a normal load the index wins the race and
  // `refresh()` touched the style first.
  //
  // It LOOKED harmless: the `styledata` handler re-runs `refresh()`, so
  // the circles appeared anyway. That is the map settling by luck.
  //
  // 🔴 So this test makes the race LOSE. The style is held back until
  // after the index has been served, which is the order that used to
  // throw, and which a slow connection produces by itself. Only the
  // delay can tell "the drawing waits for the style" apart from "the
  // style usually arrives first".
  //
  // 🔴 And it asserts the circles ARRIVE, not only that nothing threw.
  // The fix defers one call; a deferral that is never retried would
  // leave a blank map and a clean console, which is a worse bug than
  // the one being fixed.
  test('🔴 drawing the regions never touches a style that is still loading', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // The index is served normally; the style is held back until after
    // it has landed, which is the order that used to throw. Watched
    // through `response` rather than by routing the index, so nothing
    // about the index's own timing changes.
    let indexServed = false;
    page.on('response', (r) => {
      if (r.url().includes('/data/spots/index.json')) indexServed = true;
    });
    await page.route(STYLE_GLOB, async (route) => {
      for (let i = 0; i < 40 && !indexServed; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({ json: EMPTY_STYLE });
    });

    await page.goto('/map');
    await skipWithoutWebGL(page);
    await expect(map(page)).toBeVisible();
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

    // The map still does its job once the style lands: it says what it
    // is doing rather than sitting silent.
    await expect
      .poll(async () => map(page).getAttribute('data-map-state'), {
        timeout: 20_000,
      })
      .not.toBe('loading');

    // 🔴 And it DREW. Either the region circles came back after the
    // style loaded, or the map is drawing markers instead — one of the
    // two, because a map that deferred its only draw and forgot it
    // would satisfy every other assertion here.
    await expect
      .poll(
        async () => {
          const el = map(page);
          return (
            Number(await el.getAttribute('data-visible-regions')) +
            Number(await el.getAttribute('data-visible-points')) +
            Number(await el.getAttribute('data-visible-clusters'))
          );
        },
        { timeout: 20_000, message: 'the map drew nothing once the style landed' },
      )
      .toBeGreaterThan(0);

    expect(
      errors.filter((e) => /Style is not done loading/i.test(e)),
      'the drawing touched the style before it had loaded',
    ).toEqual([]);
    expect(errors, 'the map logged errors on a slow style').toEqual([]);
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
