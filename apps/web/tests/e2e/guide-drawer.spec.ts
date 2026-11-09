import { expect, test } from '@playwright/test';

/**
 * CAMP-460 — шухляда для того, хто клікнув; сторінка для того, хто
 * прийшов із пошуку.
 *
 * 🔴 ЦЕ ТРИ ТВЕРДЖЕННЯ, І ЖОДНЕ З НИХ НЕ ДОВОДИТЬ РЕШТУ:
 *  1. клік відкриває шухляду Й МІНЯЄ АДРЕСУ — інакше поділитись
 *     побаченим неможливо;
 *  2. та сама адреса напряму віддає ПОВНУ СТОРІНКУ з 200 — інакше ми
 *     міняємо 1 287 індексованих адрес на нуль, а органіка наш єдиний
 *     канал;
 *  3. «назад» ЗАКРИВАЄ шухляду, а не викидає з розділу.
 *
 * Перевірка (1) без (2) зелена й на реалізації, яка стерла сторінки.
 */

async function firstGuideHref(page: import('@playwright/test').Page) {
  await page.goto('/guides');
  const link = page.locator('main a[href^="/guides/"]:not([href$="/guides"])').first();
  await expect(link, 'на /guides немає жодного посилання на гід').toBeVisible();
  const href = await link.getAttribute('href');
  expect(href, 'посилання без href').toBeTruthy();
  return { href: href!, link };
}

test.describe('CAMP-460: шухляда гіда', () => {
  test('🔴 клік відкриває шухляду і міняє адресу', async ({ page }) => {
    const { href, link } = await firstGuideHref(page);
    await link.click();
    const drawer = page.getByTestId('guide-drawer');
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    // Шухляда — діалог, а не просто панель: читач екрана мусить знати.
    await expect(drawer.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  test('🔴 та сама адреса напряму віддає повну сторінку, а не шухляду', async ({
    page,
    request,
  }) => {
    const { href } = await firstGuideHref(page);
    const res = await request.get(href);
    expect(res.status(), `${href} віддала ${res.status()}`).toBe(200);
    const html = await res.text();
    expect(html, 'пряме відкриття показує шухляду — сторінки більше немає').not.toContain(
      'data-testid="guide-drawer"',
    );
    // Та сама обовʼязкова частина змісту, що й у шухляді.
    expect(html, 'на сторінці немає позначки походження').toContain(
      'data-testid="provenance"',
    );
  });

  test('«назад» закриває шухляду, а не викидає з розділу', async ({ page }) => {
    const { link } = await firstGuideHref(page);
    await link.click();
    await expect(page.getByTestId('guide-drawer')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('guide-drawer')).toHaveCount(0);
    await expect(page).toHaveURL(/\/guides$/);
  });

  test('Escape теж закриває', async ({ page }) => {
    const { link } = await firstGuideHref(page);
    await link.click();
    await expect(page.getByTestId('guide-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('guide-drawer')).toHaveCount(0);
  });
});
