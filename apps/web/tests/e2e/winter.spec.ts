import { expect, test } from './api-request';
import { axeViolations } from './axe';

// CAMP-525 — /camping/winter, in a browser, over the CI fixture.
//
// 🔴 EVERY EXPECTED NUMBER IS A HAND COUNT OF `ci-seed-winter.sql` (read its
// header): two campsites recorded open in winter (Adria in Zadarska, HR; the
// only campsite of Borovnica, SI), one recorded CLOSED (in Primorsko-Goranska,
// HR), four service points. Over the fixture's 72 visible campsites:
//
//   Croatia  : 1 open · recorded for 2 of 37
//   Slovenia : 1 open · recorded for 1 of 35
//   all      : 2 open · recorded for 3 of 72
//
// The assertions read what the page SAYS (`innerText`), and the links it
// carries — not a class, not a data attribute.

const CLOSED_REGION = 'Primorsko-Goranska';

test.describe('🔴 CAMP-525 — /camping/winter', () => {
  test('says what the fixture records, with its denominators', async ({ page }) => {
    const res = await page.goto('/camping/winter');
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(/Winter camping in Europe/);

    const text = await page.locator('main').innerText();
    expect(text).toContain('2 campsites in 2 countries are recorded as open in winter.');
    expect(text).toContain('Winter opening is recorded for 3 of 72 campsites');
    expect(text).toContain('1 open in winter, recorded for 2 of 37 campsites');
    expect(text).toContain('1 open in winter, recorded for 1 of 35 campsites');
    expect(text).not.toContain('{{');
  });

  test('every service figure is a count of the winter-open campsites, with its total', async ({ page }) => {
    await page.goto('/camping/winter');
    // Per service card, the row of each country.
    const figure = async (service: string, country: string) =>
      (
        await page
          .locator(`[data-service="${service}"] li[data-country="${country}"]`)
          .innerText()
      ).replace(/\s+/g, ' ');

    expect(await figure('water', 'hr')).toContain('1 of 1 winter-open campsites have one within 10 km');
    expect(await figure('water', 'si')).toContain('0 of 1 winter-open campsites have one within 10 km');
    expect(await figure('dump', 'hr')).toContain('1 of 1 winter-open campsites have one within 10 km');
    expect(await figure('dump', 'si')).toContain('1 of 1 winter-open campsites have one within 10 km');
    // The gas point of Adria is 10 100 m away: out.
    expect(await figure('gas', 'hr')).toContain('0 of 1 winter-open campsites have one within 10 km');
    expect(await figure('gas', 'si')).toContain('0 of 1 winter-open campsites have one within 10 km');
  });

  test('🔴 links open the filtered hub, which lists exactly the confirmed campsite — and nothing recorded closed or blank', async ({ page }) => {
    await page.goto('/camping/winter');
    const link = page.locator('main a[href="/camping/hr/zadarska/filter?styles=winter"]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('rel', /nofollow/);

    await Promise.all([page.waitForURL(/\/filter\?styles=winter/), link.click()]);
    const hub = await page.locator('main').innerText();
    expect(hub).toMatch(/\b1 (site|campsite)s? match/i);
    expect(hub).toContain('Adria');
    // 29 other campsites of the region carry no winter record and are not listed.
    expect(hub).not.toContain('Adria Sol Camping');

    await page.goto('/camping/winter');
    await page.locator('main a[href="/camping/si/borovnica/filter?styles=winter"]').click();
    await expect(page).toHaveURL(/\/camping\/si\/borovnica\/filter\?styles=winter/);
  });

  test('🔴 nothing unconfirmed reaches the page: the closed campsite\'s region is not named, no card has a zero', async ({ page }) => {
    await page.goto('/camping/winter');
    const text = await page.locator('main').innerText();
    expect(text).not.toContain(CLOSED_REGION);
    await expect(page.locator(`a[href*="primorsko-goranska"]`)).toHaveCount(0);
    expect(text).not.toMatch(/\b0 open in winter\b/);
    // Exactly the two countries with a yes are cards.
    await expect(page.locator('[data-testid="winter-countries"] > ul > li')).toHaveCount(2);
  });

  test('is in the sitemap, with the import day as lastmod', async ({ request }) => {
    const xml = await (await request.get('/sitemaps/hubs.xml')).text();
    const entry = /<url>\s*<loc>[^<]*\/camping\/winter<\/loc>([\s\S]*?)<\/url>/.exec(xml);
    expect(entry, 'no /camping/winter in the hubs sitemap').not.toBeNull();
    expect(entry?.[1]).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  test('has a title, a description, a canonical and no console error; passes axe', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

    await page.goto('/camping/winter');
    await expect(page).toHaveTitle(/Winter camping in Europe/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /open in winter/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/camping\/winter$/);
    expect(await axeViolations(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('does not take a country code for itself: /camping/xx is still the prerendered 404', async ({ request }) => {
    expect((await request.get('/camping/xx')).status()).toBe(404);
  });
});
