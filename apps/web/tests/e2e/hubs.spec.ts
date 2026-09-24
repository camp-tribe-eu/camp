import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_BASE, REGION_PER_PAGE } from '@/lib/api';

/**
 * Regions are resolved from the database, never named in the test.
 * A fixture pinned to "zelezniki" tests today's import, not the rule —
 * and the campsite specs already broke twice that way.
 */
interface Region {
  region: string;
  slug: string;
  spots: number;
  indexable: boolean;
  /** Which country hub it hangs off — needed to build any URL. */
  country: string;
}

/**
 * Regions are resolved from the database, never named in the test.
 * A fixture pinned to "zelezniki" tests today's import, not the rule —
 * and the campsite specs already broke twice that way.
 *
 * 🔴 Across every country, not just Slovenia. These tests asked
 * `/spots/si/regions` and built `/camping/si/…` URLs, which was harmless
 * while Slovenia was the only country — and then silently wrong: the
 * pagination tests kept skipping with "nothing paginates at the current
 * data volume" after Croatia arrived with eight paginated counties,
 * because Slovenia's admin-1 units are municipalities and no Slovenian
 * region will ever reach a page. A test that names a country is a test
 * about that country.
 */
async function regions(request: APIRequestContext) {
  const countries: { country: string }[] = await (
    await request.get(`${API_BASE}/spots/countries`)
  ).json();

  const all: Region[] = [];
  for (const { country } of countries) {
    const rs: Omit<Region, 'country'>[] = await (
      await request.get(`${API_BASE}/spots/${country}/regions`)
    ).json();
    all.push(...rs.map((r) => ({ ...r, country })));
  }

  const thin = all.find((r) => !r.indexable);
  const fat = all.find((r) => r.indexable);
  if (!thin || !fat) {
    throw new Error('Need at least one indexable and one thin region in the data');
  }
  return { all, thin, fat };
}

/** The hub URL of a region, whichever country it belongs to. */
const hub = (r: Region) => `/camping/${r.country}/${r.slug}`;

// CAMP-71. The card's criterion is one sentence: "from the home page you
// can reach any campsite card in at most 4 clicks, without using the map
// and without JavaScript."
//
// So the test turns JavaScript off and actually walks it. Anything that
// depends on hydration — the map, a click-handler paginator, a filter that
// rewrites the list — is invisible here, which is exactly the point: it is
// also invisible to a crawler that does not run our scripts.

test.describe('hub crawl path', () => {
  test.use({ javaScriptEnabled: false });

  test('🔴 home → campsite in 4 clicks with no JavaScript', async ({
    page,
  }) => {
    let clicks = 0;

    await page.goto('/');
    // By destination, not by wording: the home page's copy is CAMP-41's
    // to change, and a test pinned to a phrase breaks on a rewrite while
    // the path it is actually asserting still works.
    await page.locator('main a[href="/camping"]').first().click();
    clicks++;
    await expect(page).toHaveURL(/\/camping$/);

    await page.getByRole('link', { name: /Slovenia/i }).first().click();
    clicks++;
    await expect(page).toHaveURL(/\/camping\/si$/);

    // Whichever region the country page lists first — the claim is about
    // the path, not about a particular place.
    const firstRegion = page.locator('main ul li a').first();
    const regionHref = await firstRegion.getAttribute('href');
    await firstRegion.click();
    clicks++;
    await expect(page).toHaveURL(new RegExp(`${regionHref}$`));

    await page.locator('main ul li a').first().click();
    clicks++;

    await expect(page).toHaveURL(new RegExp(`${regionHref}/[a-z0-9-]+$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(clicks).toBeLessThanOrEqual(4);
  });

  test('a thin region is still reachable from its country', async ({
    page,
    request,
  }) => {
    // Thin regions are noindex, but they must stay linked — otherwise
    // their campsites hang off the sitemap alone and the four-click claim
    // holds only for the big regions.
    const { thin } = await regions(request);
    await page.goto(`/camping/${thin.country}`);
    await expect(page.locator(`a[href="${hub(thin)}"]`)).toBeVisible();
  });

  test('pagination works as plain links', async ({ page, request }) => {
    // Data-driven on purpose. Before deduplication Bovec held 33 sites and
    // paginated; after it holds 20, and no Slovenian region reaches the
    // page size. Hard-coding a region here would make this test a claim
    // about a dataset rather than about the paginator, and it would break
    // again on the next import.
    const { all } = await regions(request);
    const paged = all.find((r) => r.spots > REGION_PER_PAGE);
    test.skip(
      !paged,
      `No region currently exceeds ${REGION_PER_PAGE} campsites, so nothing paginates.`,
    );

    await page.goto(hub(paged!));
    await page
      .getByRole('navigation', { name: 'Pagination' })
      // 🔴 `exact`, because a region with twelve pages makes "2" match
      // "12" as well. It passed for a year on regions that never had
      // more than nine pages, and broke the day France arrived — a test
      // that was right about behaviour and wrong about scale.
      .getByRole('link', { name: '2', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${hub(paged!)}/page/2$`));
    await expect(page.locator('main ul li a').first()).toBeVisible();
  });

  test('a region that fits on one page shows no paginator', async ({
    page,
    request,
  }) => {
    const { all } = await regions(request);
    const small = all.find((r) => r.spots <= REGION_PER_PAGE)!;
    await page.goto(hub(small));
    await expect(
      page.getByRole('navigation', { name: 'Pagination' }),
    ).toHaveCount(0);
  });
});

test.describe('hub indexing rules', () => {
  test('🔴 a thin region is noindex, but still followed', async ({
    request,
  }) => {
    // Below the threshold there is nothing for a reader to choose
    // between, so the hub adds nothing over the campsite's own page.
    const { thin } = await regions(request);
    const html = await (await request.get(hub(thin))).text();
    expect(html).toMatch(/<meta name="robots" content="noindex[,\s]*follow/i);
  });

  test('a region above the threshold is indexable', async ({ request }) => {
    // 🔴 Only observable in a public build: when the whole site is closed
    // (CAMP-90) every page is noindex and the threshold makes no visible
    // difference. Skipped rather than weakened — the rule is asserted in
    // CI's public-build job by check-indexing.mjs --expect public.
    test.skip(
      process.env.NEXT_PUBLIC_SITE_MODE !== 'public',
      'The indexing threshold is invisible while the whole site is closed.',
    );
    const { fat } = await regions(request);
    const html = await (await request.get(hub(fat))).text();
    expect(html).not.toMatch(/content="noindex/i);
  });

  test('page 2 never competes with the region itself', async ({ request }) => {
    const { all } = await regions(request);
    const paged = all.find((r) => r.spots > REGION_PER_PAGE);
    test.skip(!paged, 'Nothing paginates at the current data volume.');

    // Asserting on a 404 would pass for the wrong reason — Next's
    // not-found page is noindex too.
    const res = await request.get(`${hub(paged!)}/page/2`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(
      /<meta name="robots" content="noindex/i,
    );
  });

  test('every hub declares a canonical', async ({ request }) => {
    const { fat } = await regions(request);
    for (const url of ['/camping', `/camping/${fat.country}`, hub(fat)]) {
      const html = await (await request.get(url)).text();
      expect(html, url).toMatch(/<link rel="canonical"/i);
    }
  });
});
