import { expect, test, type APIRequestContext, type Page } from './api-request';
import { AMENITY_KEYS } from '@/lib/api';

// CAMP-73 — 404, 410, 500 and the empty states.
//
// 🔴 The card's criterion is explicit: every state opens at a real URL
// and returns the right HTTP code, "перевірено curl-ом, а не тільки
// очима". So the status code is asserted on a raw request — a page that
// looks like a 404 and answers 200 is the single most common way this
// goes wrong, and it is invisible to a human looking at the screen.
//
// `page.request` is that raw request: it does not run JavaScript and it
// does not follow the browser's rendering, only HTTP.

interface Gone {
  path: string;
  name: string | null;
  nearest: { path: string; metres: number } | null;
}

/**
 * The first campsite the build says is gone.
 *
 * 🔴 Read from the site's own data, never a slug written here. Slugs move
 * when the dedup rule changes (CAMP-39), and a test pinned to one checks
 * the dataset rather than the behaviour — that has already broken this
 * suite twice.
 */
async function firstGone(request: APIRequestContext): Promise<Gone | null> {
  const res = await request.get('/data/gone.json');
  if (!res.ok()) return null;
  const list = (await res.json()) as Gone[];
  return list[0] ?? null;
}

test.describe('404', () => {
  test('a page that never existed answers 404, not 200', async ({ page }) => {
    const res = await page.request.get('/definitely-not-a-page');
    expect(res.status()).toBe(404);
  });

  test('a campsite we do not hold answers 404', async ({ page }) => {
    const res = await page.request.get('/camping/si/bovec/no-such-campsite');
    expect(res.status()).toBe(404);
  });

  test('an unknown country answers 404 rather than an empty hub', async ({
    page,
  }) => {
    const res = await page.request.get('/camping/zz/nowhere/nothing');
    expect(res.status()).toBe(404);
  });

  test('the 404 page offers the way back in', async ({ page }) => {
    await page.goto('/camping/si/bovec/no-such-campsite');

    await expect(
      page.getByRole('heading', { name: 'That page is not here' }),
    ).toBeVisible();

    // 🔴 The recovery the card asks for: the URL still says which region
    // the reader wanted, and that is worth more than an apology. Dead
    // URLs are guaranteed here — the OSM import rebuilds slugs weekly —
    // and the traffic arriving at them is organic, already paid for.
    await expect(
      page.getByRole('heading', { name: /You were probably looking for/ }),
    ).toBeVisible();

    const links = page.getByRole('link');
    expect(await links.count()).toBeGreaterThan(2);
  });

  // 🔴 Every shape of dead URL, because they used to behave differently.
  //
  // Next renders a param that is not in the build on demand; notFound()
  // then produces its client-side error shell, where the 404 content
  // travels inside the RSC payload rather than as markup. Status 404,
  // perfect in a browser, and completely blank without JavaScript — on
  // the one page where that matters most, since dead campsite URLs are
  // guaranteed by the weekly import. Each of these four was broken that
  // way until `dynamicParams = false`.
  const DEAD_URLS = [
    '/nope',
    '/camping/zz',
    '/camping/si/nowhere',
    '/camping/si/bovec/no-such-campsite',
  ];

  for (const url of DEAD_URLS) {
    test(`${url} is a real page without JavaScript`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      const res = await page.goto(url);
      expect(res!.status()).toBe(404);
      await expect(
        page.getByRole('heading', { name: 'That page is not here' }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Browse by country' }),
      ).toBeVisible();
      await context.close();
    });
  }
});

test.describe('410 for campsites OSM has dropped', () => {
  test('answers 410, not 404', async ({ page }) => {
    const gone = await firstGone(page.request);
    test.skip(!gone, 'this build holds no gone campsites');

    const res = await page.request.get(gone!.path);
    // 🔴 The whole point of the card's 410 line. A 404 tells Google the
    // URL might come back and it keeps recrawling for months; a 410 says
    // gone on purpose. With a weekly import we produce these steadily.
    expect(res.status()).toBe(410);
    expect(res.headers()['content-type']).toContain('text/html');
  });

  test('names the campsite and offers the nearest one', async ({ page }) => {
    const gone = await firstGone(page.request);
    test.skip(!gone, 'this build holds no gone campsites');

    await page.goto(gone!.path);
    await expect(
      page.getByRole('heading', { name: 'This campsite is no longer listed' }),
    ).toBeVisible();

    // The browser is still at the campsite's own URL — middleware
    // returned the body there rather than redirecting — so the page can
    // say which campsite it was.
    if (gone!.name) {
      await expect(page.getByText(gone!.name, { exact: false })).toBeVisible();
    }

    // 🔴 A link, never a redirect: "the nearest campsite to one that
    // closed" is a guess, and a 301 would tell Google they are the same
    // place.
    if (gone!.nearest) {
      await expect(
        page.getByText(/The closest one we still hold is/),
      ).toBeVisible();
      const link = page.getByRole('link', { name: /.+/ }).filter({ hasText: /./ });
      expect(await link.count()).toBeGreaterThan(0);
      expect((await page.request.get(gone!.nearest.path)).status()).toBe(200);
    }
  });

  test('is never cached under the campsite URL', async ({ page }) => {
    const gone = await firstGone(page.request);
    test.skip(!gone, 'this build holds no gone campsites');
    const res = await page.request.get(gone!.path);
    // Objects deleted from OSM by mistake do come back. A cached 410
    // would keep answering long after the campsite returned.
    expect(res.headers()['cache-control']).toContain('no-store');
  });

  test('a gone campsite is absent from the sitemap', async ({ page }) => {
    const gone = await firstGone(page.request);
    test.skip(!gone, 'this build holds no gone campsites');
    const sitemap = await (
      await page.request.get('/sitemaps/campsites-0.xml')
    ).text();
    // Listing a URL that answers 410 would be asking Google to crawl
    // something we are telling it to forget.
    expect(sitemap).not.toContain(gone!.path);
  });
});

test.describe('the error boundary', () => {
  test('a broken client component does not blank the page', async ({ page }) => {
    // 🔴 This is the failure the boundary exists for, reproduced rather
    // than imagined: the map threw in a browser with no WebGL and Next
    // replaced the entire document with "Application error", taking the
    // country list with it. Here the whole page bundle is broken on
    // purpose.
    await page.route('**/_next/static/chunks/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'throw new Error("deliberately broken chunk");',
      }),
    );

    const res = await page.goto('/camping');
    // The document itself is fine — it was prerendered and served before
    // any script ran. That is exactly why a "500 page" is not the
    // artefact this needs.
    expect(res!.status()).toBe(200);

    // And the server-rendered content is still readable, which is the
    // thing that matters to a reader whose JavaScript failed.
    await expect(
      page.getByRole('heading', { name: /Campsites/ }).first(),
    ).toBeVisible();
  });
});

test.describe('empty states', () => {
  // 🔴 Most of the card's list cannot exist yet, and inventing screens
  // for them would be worse than leaving them out: there is no search,
  // no routes, no saved lists and no accounts. Each is its own card.
  // What follows is every empty state that is actually reachable today.

  test('a campsite with no facilities recorded still reads as finished', async ({
    page,
  }) => {
    const { features } = await (
      await page.request.get('/data/spots/index.json')
    ).json();
    const bare = features.find(
      (f: { properties: Record<string, string> }) =>
        AMENITY_KEYS.every((k) => f.properties[k] === 'unknown'),
    );
    test.skip(!bare, 'the fixture holds no campsite without facilities');

    await page.goto(bare.properties.href);
    await expect(page.getByRole('heading').first()).toBeVisible();
    // An absence is never rendered as a denial.
    await expect(page.getByText('No electricity')).toHaveCount(0);
  });

  test('the /gone page stands on its own', async ({ page }: { page: Page }) => {
    // It is served as the body of a 410 elsewhere, but it is also an
    // ordinary URL so it can be looked at and styled like any page.
    const res = await page.request.get('/gone');
    expect(res.status()).toBe(200);
    await page.goto('/gone');
    await expect(
      page.getByRole('heading', { name: 'This campsite is no longer listed' }),
    ).toBeVisible();
    // Without a campsite in the URL there is nothing specific to say,
    // and it says the general thing instead of an empty box.
    await expect(
      page.getByRole('heading', { name: 'Keep looking' }),
    ).toBeVisible();
  });
});
