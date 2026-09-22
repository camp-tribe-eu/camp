import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n';

// CAMP-40 — the language declarations, in the pages that are actually
// built rather than in the function that generates them.
//
// 🔴 The test that matters most is "no hreflang points at a 404". That is
// the failure mode this whole design guards against: Google discards an
// entire alternates cluster when one member is dead, so a language
// declared a week before its pages exist silently switches the feature
// off for the languages that do work — and nothing reports it.

/** One page of each shape the site builds. */
async function pageTypes(page: Page): Promise<string[]> {
  await page.goto('/camping');
  const country = await page
    .locator('a[href^="/camping/"]')
    .first()
    .getAttribute('href');
  expect(country, 'no country hub to test against').toBeTruthy();

  await page.goto(country!);
  const region = await page
    .locator(`a[href^="${country}/"]`)
    .first()
    .getAttribute('href');
  expect(region, 'no region hub to test against').toBeTruthy();

  await page.goto(region!);
  const spot = await page
    .locator(`a[href^="${region}/"]`)
    .first()
    .getAttribute('href');
  expect(spot, 'no campsite page to test against').toBeTruthy();

  return ['/', '/camping', '/map', country!, region!, spot!];
}

const alternates = (page: Page) =>
  page.locator('link[rel="alternate"][hreflang]');

test.describe('hreflang', () => {
  test('every page type declares itself and an x-default', async ({ page }) => {
    for (const path of await pageTypes(page)) {
      await page.goto(path);

      const codes = await alternates(page).evaluateAll((ls) =>
        ls.map((l) => l.getAttribute('hreflang')),
      );
      expect(codes, `${path} declares no alternates`).toContain(DEFAULT_LOCALE);
      expect(codes, `${path} has no x-default`).toContain('x-default');
    }
  });

  test('the hrefs are absolute, as the spec requires', async ({ page }) => {
    await page.goto('/camping');
    const hrefs = await alternates(page).evaluateAll((ls) =>
      ls.map((l) => l.getAttribute('href')),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, 'a relative hreflang is ignored by Google').toMatch(
        /^https?:\/\//,
      );
    }
  });

  // 🔴 The one that protects the others.
  test('no hreflang points at a page that does not exist', async ({
    page,
    request,
  }) => {
    for (const path of await pageTypes(page)) {
      await page.goto(path);
      const hrefs = await alternates(page).evaluateAll((ls) =>
        ls.map((l) => l.getAttribute('href')!),
      );

      for (const href of hrefs) {
        // Only the path matters here: the declared host is the production
        // domain, while the test server is localhost.
        const target = new URL(href).pathname;
        const res = await request.get(target);
        expect(
          res.status(),
          `${path} declares an alternate at ${target}, which answers ${res.status()}`,
        ).toBeLessThan(400);
      }
    }
  });

  test('x-default and the canonical describe the same page', async ({
    page,
  }) => {
    for (const path of await pageTypes(page)) {
      await page.goto(path);
      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute('href');
      const xDefault = await page
        .locator('link[rel="alternate"][hreflang="x-default"]')
        .getAttribute('href');
      expect(xDefault, `${path}: x-default and canonical disagree`).toBe(
        canonical,
      );
    }
  });

  // A language is declared only once its pages exist — the rule the
  // registry encodes. Checked here against the built site so a premature
  // `live: true` cannot reach production unnoticed.
  test('declares nothing for a language we do not serve yet', async ({
    page,
  }) => {
    await page.goto('/camping');
    const codes = await alternates(page).evaluateAll((ls) =>
      ls.map((l) => l.getAttribute('hreflang')),
    );
    for (const l of LOCALES.filter((x) => !x.live)) {
      expect(codes, `${l.code} is declared but has no pages`).not.toContain(
        l.code,
      );
    }
  });
});

test.describe('the document says what language it is in', () => {
  test('html lang matches the language we declare', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE);
  });
});

test.describe('the sitemap is ready for a second language', () => {
  test('declares the xhtml namespace before it needs it', async ({
    request,
  }) => {
    const res = await request.get('/sitemaps/hubs.xml');
    expect(res.ok()).toBe(true);
    const xml = await res.text();
    // Declared from the start, so the day a language goes live nothing
    // about the file's shape has to be re-validated.
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });
});
