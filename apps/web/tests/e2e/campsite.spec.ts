import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// CAMP-34. Two fixtures on purpose: a campsite where OSM knows everything,
// and one where it knows almost nothing. The second is the page that
// actually needs testing — the card's criterion is that the empty state
// "looks finished, not broken".
const RICH = '/camping/si/bled/camping-bled';
const EMPTY = '/camping/si/kobarid/spot-n896349092';

test.describe('campsite page', () => {
  test('renders a named campsite with its facilities', async ({ page }) => {
    await page.goto(RICH);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Camping Bled',
    );
    await expect(page.getByRole('listitem').filter({ hasText: 'Electricity' }))
      .toContainText('Yes');
  });

  test('an unnamed campsite still gets a real heading', async ({ page }) => {
    await page.goto(EMPTY);
    // Never the bare type, and never empty: it must agree with <title>.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Campsite near Kobarid',
    );
    await expect(page).toHaveTitle(/Campsite near Kobarid/);
  });

  test('🔴 an unrecorded amenity never reads as absent', async ({ page }) => {
    await page.goto(EMPTY);
    const facilities = page.getByRole('listitem').filter({
      hasText: 'Drinking water',
    });
    await expect(facilities).toContainText('Not recorded');
    // The whole point of the tri-state: "no" is a claim about the campsite,
    // "not recorded" is a claim about our data. Printing the first when we
    // mean the second is a false statement about a real business.
    await expect(facilities).not.toContainText(/\bNo\b/);
  });

  test('🔴 no stock photography, and the owner is asked instead', async ({
    page,
  }) => {
    await page.goto(EMPTY);
    await expect(
      page.getByText(/don’t publish pictures we haven’t verified/i),
    ).toBeVisible();
    // If an <img> ever appears here without a verified source, this fails.
    await expect(page.locator('main img')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /add your photos/i })).toBeVisible();
  });

  test('ODbL attribution names the licence, not just the project', async ({
    page,
  }) => {
    await page.goto(RICH);
    const footer = page.locator('footer');
    await expect(footer).toContainText('OpenStreetMap contributors');
    await expect(
      footer.getByRole('link', { name: /Open Database License/i }),
    ).toBeVisible();
  });

  test('page fits the viewport with no horizontal scroll', async ({ page }) => {
    await page.goto(EMPTY);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto(EMPTY);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
