import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Console-error capture: fail fast and print the exact error, per CAMP-13
// ("виводити консольні еррори, а не просто мовчазний спостерігач").
test('home page has no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(400);

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors on /:\n${consoleErrors.join('\n')}`);
  }
});

// Accessibility floor, same bar UTD holds themes to (Shopify grades on Lighthouse,
// which requires WCAG AA) — but via axe-core's full ruleset, not just the subset
// Lighthouse checks.
test('home page has no serious/critical accessibility violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );

  if (blocking.length > 0) {
    const details = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join('\n');
    throw new Error(`Accessibility violations on /:\n${details}`);
  }
});

test('home page renders and is responsive at this viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  // No horizontal overflow at the current viewport - the most common
  // adaptivity bug (fixed-width element wider than the screen).
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
