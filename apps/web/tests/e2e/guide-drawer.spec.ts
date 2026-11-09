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

/**
 * 🔴 КАРТКИ ГІДІВ ЖИВУТЬ НЕ НА `/guides`. Перша редакція цього тесту
 * брала перше посилання `main a[href^="/guides/"]` на індексі — і це
 * була ТЕМА або КРАЇНА (`/guides/topic/water`, `/guides/country/at`).
 * Перехоплення на них не поширюється й не мусить: шухляда призначена
 * для гіда, а не для переліку.
 *
 * Заміряно на проді 09.11.2026: односегментних посилань на `/guides` —
 * НУЛЬ, а на `/guides/topic/water` — 463. Тому тест іде через тему.
 */
async function firstGuide(page: import('@playwright/test').Page) {
  await page.goto('/guides');
  const topic = page.locator('main a[href^="/guides/topic/"]').first();
  await expect(topic, 'на /guides немає жодної теми').toBeVisible();
  await topic.click();
  // Рівно один сегмент після /guides — це гід, а не черговий перелік.
  const guide = page
    .locator(
      'main a[href^="/guides/"]:not([href*="/topic/"]):not([href*="/country/"])',
    )
    .first();
  await expect(guide, 'на сторінці теми немає жодного гіда').toBeVisible();
  const href = await guide.getAttribute('href');
  expect(href, 'посилання без href').toBeTruthy();
  return { href: href!, link: guide };
}

test.describe('CAMP-460: шухляда гіда', () => {
  test('🔴 клік відкриває шухляду і міняє адресу', async ({ page }) => {
    const { href, link } = await firstGuide(page);
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
    const { href } = await firstGuide(page);
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
    const { link } = await firstGuide(page);
    await link.click();
    await expect(page.getByTestId('guide-drawer')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('guide-drawer')).toHaveCount(0);
    await expect(page).toHaveURL(/\/guides\/topic\//);
  });

  test('Escape теж закриває', async ({ page }) => {
    const { link } = await firstGuide(page);
    await link.click();
    await expect(page.getByTestId('guide-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('guide-drawer')).toHaveCount(0);
  });
});
