import { expect, test } from '@playwright/test';

// 🔴 CAMP-489. Блок «information service, not navigation» на сторінках, де
// читач вирішує за нашими числами, — ДОСЛІВНО абзац із /legal/disclaimer.
// Юридичний текст живе в базі під версією; тут доводиться, що екран його
// не переказує своїми словами. Прибрати абзац зі сторінки чи змінити його
// на екрані — червоне.

// /plan не тут: у нього власне застереження `plan-disclaimer` («CampTribe is
// not a navigation app… at your own discretion and risk») з CAMP-456, його
// тримає tests/unit/plan-view.spec.ts. Другий блок там був би дублем.
for (const path of ['/tools/camper-trip-cost']) {
  test(`${path}: the provider notice is the disclaimer's own paragraph`, async ({ page }) => {
    await page.goto(path);
    const shown = (await page.getByTestId('provider-notice-text').innerText()).trim();
    expect(shown.length, 'the notice is empty').toBeGreaterThan(80);
    expect(shown).toContain('not a navigation system');

    await page.goto('/legal/disclaimer');
    const article = (await page.locator('article').innerText()).replace(/\s+/g, ' ');
    expect(article, '/legal/disclaimer no longer carries the notice word for word').toContain(
      shown.replace(/\s+/g, ' '),
    );
    await expect(page.locator('#information')).toHaveCount(1);
  });
}
