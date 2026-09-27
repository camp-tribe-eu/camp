import { expect, test } from './api-request';
import { RENTAL_COUNTRIES } from '../../src/data/rental/countries';

// CAMP-4 / CAMP-54 — the rental section as a reader meets it.
//
// 🔴 Several cases read the served HTML through `request` rather than
// through the browser, on purpose. Every number on these pages is a count
// of our own records, and the whole argument of the section is that those
// numbers are real — a number that only appears after a bundle executes
// is a number a crawler, an assistant and a reader on a bad connection
// never see.
//
// 🔴 And two cases assert the ABSENCE of things: no invented price, and
// no outbound commission link while we have no affiliate account. Those
// are the failures that would cost the most and would look like nothing.

test.describe('the rental hub', () => {
  test('leads with what it is, and says it has no prices', async ({ page }) => {
    await page.goto('/camper-rental');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Renting a camper in the EU',
    );
    await expect(
      page.getByText('There are no prices and no vehicles here.'),
    ).toBeVisible();
    await expect(page.getByTestId('rental-thresholds')).toBeVisible();
    await expect(page.getByTestId('rental-checklist')).toBeVisible();
  });

  test('discloses how it is funded, above the fold rather than in the footer', async ({
    page,
  }) => {
    await page.goto('/camper-rental');
    const disclosure = page.getByTestId('rental-disclosure');
    await expect(disclosure).toBeVisible();
    // 🔴 Proximity, not existence. The disclosure has to sit above the
    // commercial slot it qualifies — a reader decides before they scroll.
    const disclosureBox = await disclosure.boundingBox();
    const slotBox = await page.getByTestId('rental-offer-slot').boundingBox();
    expect(disclosureBox!.y).toBeLessThan(slotBox!.y);
  });

  test('links to exactly the countries that have a page', async ({ page }) => {
    await page.goto('/camper-rental');
    const links = page
      .getByTestId('rental-country-index')
      .getByRole('link');
    await expect(links).toHaveCount(RENTAL_COUNTRIES.length);
    // Ten to fifteen, never two hundred. The number is the deliverable.
    expect(RENTAL_COUNTRIES.length).toBeGreaterThanOrEqual(10);
    expect(RENTAL_COUNTRIES.length).toBeLessThanOrEqual(15);
  });
});

test.describe('a country page', () => {
  test('carries three sourced facts and a measured claim, without JavaScript', async ({
    request,
  }) => {
    const html = await (await request.get('/camper-rental/de')).text();
    expect(html).toContain('Renting a camper in Germany');
    // The three authorities named on the German page, in the served HTML.
    expect(html).toContain('Toll Collect');
    expect(html).toContain('Umweltbundesamt');
    expect(html).toContain('gesetze-im-internet.de');
    // The measured lead, and the date it was measured on — a count without
    // its date is a claim about today that nobody checked.
    expect(html).toMatch(/Counted in our own database on/);
    expect(html).toMatch(/\d{1,2} \w+ \d{4}/);
  });

  test('every country page says something different about its own data', async ({
    request,
  }) => {
    const leads = new Set<string>();
    for (const c of RENTAL_COUNTRIES) {
      const html = await (await request.get(`/camper-rental/${c.code}`)).text();
      const m = /data-testid="lead-value"[^>]*>([^<]+)</.exec(html);
      expect(m, `${c.code} renders no measured lead`).not.toBeNull();
      leads.add(`${c.code}:${m![1]}`);
      expect(html).toContain(`Renting a camper in ${c.name}`);
    }
    expect(leads.size).toBe(RENTAL_COUNTRIES.length);
  });

  test('sends a reader on to the campsites and the fuel prices', async ({ page }) => {
    await page.goto('/camper-rental/hr');
    await expect(page.getByRole('link', { name: 'Browse them' })).toHaveAttribute(
      'href',
      '/camping/hr',
    );
    await expect(
      page.getByRole('link', { name: 'Price a trip in Croatia' }),
    ).toHaveAttribute('href', '/tools/camper-trip-cost/hr');
  });
});

test.describe('the commercial slot, while there is no partner', () => {
  test('is visible, empty and explained rather than hidden', async ({ page }) => {
    await page.goto('/camper-rental/fr');
    const slot = page.getByTestId('rental-offer-slot');
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('data-state', 'empty');
    await expect(
      slot.getByText('We have no rental partner for France'),
    ).toBeVisible();
  });

  test('contains no affiliate link anywhere in the section', async ({ request }) => {
    // 🔴 There are no affiliate accounts yet (CAMP-98), so a `sponsored`
    // link on any of these pages means a link was hard-coded past the
    // configuration layer — which is the one thing lib/affiliate.ts exists
    // to make impossible.
    for (const path of ['/camper-rental', ...RENTAL_COUNTRIES.map((c) => `/camper-rental/${c.code}`)]) {
      const html = await (await request.get(path)).text();
      expect(html, `${path} carries a commission link`).not.toContain('rel="sponsored');
      expect(html, `${path} carries an affiliate mark`).not.toContain(
        'data-testid="affiliate-link"',
      );
    }
  });

  test('invents no price, no rate and no availability', async ({ request }) => {
    // The exact shapes a made-up rental offer takes. None of them may
    // appear while we hold no prices — and we hold none.
    const forbidden = [
      /from\s*€/i,
      /€\s*\d+\s*(?:\/|per\s+)day/i,
      /per\s+night\s+from/i,
      /available\s+from\s+€/i,
    ];
    for (const path of ['/camper-rental', '/camper-rental/de', '/camper-rental/es']) {
      const html = await (await request.get(path)).text();
      for (const re of forbidden) {
        expect(html, `${path} matched ${re}`).not.toMatch(re);
      }
    }
  });
});

test('the section is in the sitemap, and only the pages that exist', async ({
  request,
}) => {
  const xml = await (await request.get('/sitemaps/hubs.xml')).text();
  expect(xml).toContain('/camper-rental</loc>');
  for (const c of RENTAL_COUNTRIES) {
    expect(xml, `${c.code} missing from the sitemap`).toContain(
      `/camper-rental/${c.code}</loc>`,
    );
  }
  // A country without a page must not be listed. Cyprus and Malta hold too
  // few records to say anything measured, which is why they have none.
  expect(xml).not.toContain('/camper-rental/cy<');
  expect(xml).not.toContain('/camper-rental/mt<');
});

test('a country without a page is a 404, not a thin page', async ({ request }) => {
  expect((await request.get('/camper-rental/cy')).status()).toBe(404);
});
