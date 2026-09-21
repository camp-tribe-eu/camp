import { expect, test } from '@playwright/test';

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
    await page.getByRole('link', { name: /browse campsites/i }).click();
    clicks++;
    await expect(page).toHaveURL(/\/camping$/);

    await page.getByRole('link', { name: /Slovenia/i }).first().click();
    clicks++;
    await expect(page).toHaveURL(/\/camping\/si$/);

    await page.getByRole('link', { name: /^Bled/ }).first().click();
    clicks++;
    await expect(page).toHaveURL(/\/camping\/si\/bled$/);

    const first = page.locator('main ul li a').first();
    await first.click();
    clicks++;

    await expect(page).toHaveURL(/\/camping\/si\/bled\/[a-z0-9-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(clicks).toBeLessThanOrEqual(4);
  });

  test('a one-campsite region is still reachable from its country', async ({
    page,
  }) => {
    // The thin regions are noindex, but they must stay linked — otherwise
    // their campsites hang off the sitemap alone and the claim above holds
    // only for the big regions.
    await page.goto('/camping/si');
    await expect(
      page.getByRole('link', { name: /^Železniki/ }),
    ).toBeVisible();
  });

  test('pagination works as plain links', async ({ page }) => {
    // Bovec has 33 sites, so it is the one region that paginates today.
    await page.goto('/camping/si/bovec');
    await page.getByRole('navigation', { name: 'Pagination' })
      .getByRole('link', { name: '2' })
      .click();
    await expect(page).toHaveURL(/\/camping\/si\/bovec\/page\/2$/);
    await expect(page.locator('main ul li a').first()).toBeVisible();
  });
});

test.describe('hub indexing rules', () => {
  test('🔴 a thin region is noindex, but still followed', async ({
    request,
  }) => {
    // Železniki holds 1 campsite: nothing a reader could choose between.
    const html = await (await request.get('/camping/si/zelezniki')).text();
    expect(html).toMatch(/<meta name="robots" content="noindex[,\s]*follow/i);
  });

  test('a region above the threshold is indexable', async ({ request }) => {
    // Bled holds 8.
    const html = await (await request.get('/camping/si/bled')).text();
    expect(html).not.toMatch(/content="noindex/i);
  });

  test('page 2 never competes with the region itself', async ({ request }) => {
    const html = await (await request.get('/camping/si/bovec/page/2')).text();
    expect(html).toMatch(/<meta name="robots" content="noindex/i);
  });

  test('every hub declares a canonical', async ({ request }) => {
    for (const url of ['/camping', '/camping/si', '/camping/si/bled']) {
      const html = await (await request.get(url)).text();
      expect(html, url).toMatch(/<link rel="canonical"/i);
    }
  });
});
