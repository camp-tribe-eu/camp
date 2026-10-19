import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './api-request';
import { visibleText } from '../unit/rendered-text';
import type { Page } from '@playwright/test';

// CAMP-205 — /plan, як її зустрічає читач.
//
// 🔴 Планувальник ще не рахує маршрути, і ці тести про те, що сторінка
// ЧЕСНА про це в кожному стані: до відправки, після помилки, після
// відповіді. Вони не перевіряють жодного маршруту — маршрутів немає.
//
// Частина читає HTML через `request`, а не через браузер, і це навмисно:
// речення про те, чого немає, мусить бути в виданому документі, а не
// зʼявлятись після виконання бандла. Його бачать і краулер, і асистент,
// і читач із повільним зʼєднанням.
//
// Правила розмітки (підписи, aria-*, порядок помилок) перевіряє
// tests/unit/plan-view.spec.ts на виданому HTML; тут — те, чого розмітка
// без браузера не показує: фокус, клавіатура, мережа, сховища, ширина.

const VERDICT = 'This planner does not calculate routes yet.';

const place = (page: Page) => ({
  from: page.getByLabel('Starting point'),
  to: page.getByLabel('Destination'),
  days: page.getByLabel('Number of days'),
  vehicle: page.getByLabel('Vehicle', { exact: true }),
  submit: page.getByRole('button', { name: 'Check my trip' }),
  errors: page.getByTestId('plan-errors'),
  result: page.getByTestId('plan-result'),
});

/** Відкрити сторінку й дочекатись, поки форма оживе: до того поля вимкнені. */
async function open(page: Page) {
  await page.goto('/plan');
  await expect(place(page).from).toBeEnabled();
  return place(page);
}

async function fillValid(f: ReturnType<typeof place>, over: Partial<Record<'from' | 'to' | 'days', string>> = {}) {
  await f.from.fill(over.from ?? 'Ljubljana');
  await f.to.fill(over.to ?? 'Split');
  await f.days.fill(over.days ?? '7');
  await f.vehicle.selectOption('motorhome');
}

test.describe('the page', () => {
  test('🔴 says in the served HTML, before the form, that it does not calculate routes', async ({ request }) => {
    const res = await request.get('/plan');
    expect(res.status()).toBe(200);
    const html = await res.text();
    const said = visibleText(html);
    expect(said).toContain(VERDICT);
    expect(said.indexOf('Your trip')).toBeGreaterThan(said.indexOf(VERDICT));
    // И що саме зʼявиться, коли запрацює.
    expect(said).toContain('route drawn on a map');
    expect(said).toContain('the stops along it');
  });

  test('is noindex but followable, like /search', async ({ request }) => {
    const html = await (await request.get('/plan')).text();
    const robots = /<meta name="robots" content="([^"]+)"/i.exec(html)?.[1] ?? '';
    expect(robots).toContain('noindex');
    expect(robots).not.toContain('nofollow');
  });

  for (const from of ['/contact', '/tools']) {
    test(`🔴 the header on ${from} leads here`, async ({ page }) => {
      // Шапка одна на весь сайт, тож «вхід із /map» — це вхід із будь-якої
      // сторінки. Стартові сторінки тут ті, що не потребують API.
      await page.goto(from);
      // 🔴 CAMP-350: нижче 1200 px шапка веде через бургер, а не
      // горизонтальне меню — тож «вхід із шапки» на телефоні означає
      // відкрити шухляду. Без цього рядка тест червонів би на
      // `mobile-chrome` (Pixel 7, 412 px): landmark `Main` там
      // `display: none`, і `getByRole` його не бачить.
      const burger = page.getByTestId('burger-open');
      if (await burger.isVisible()) await burger.click();
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Plan a trip' }).click();
      await expect(page).toHaveURL(/\/plan$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trip planner');
    });
  }
});

test.describe('the form', () => {
  test('every field can be found by its label and starts empty', async ({ page }) => {
    const f = await open(page);
    for (const field of [f.from, f.to, f.days, f.vehicle]) await expect(field).toBeVisible();
    await expect(f.from).toHaveValue('');
    await expect(f.to).toHaveValue('');
    await expect(f.days).toHaveValue('');
    await expect(f.vehicle).toHaveValue('');
    await expect(f.result).toContainText('Nothing asked yet');
  });

  test('🔴 an empty submit explains itself, takes focus, and lists every problem', async ({ page }) => {
    const f = await open(page);
    await f.submit.click();

    await expect(f.errors).toBeVisible();
    await expect(f.errors).toHaveAttribute('role', 'alert');
    await expect(f.errors).toBeFocused();
    await expect(f.errors.getByRole('link')).toHaveText([
      'Enter where the trip starts.',
      'Enter where the trip ends.',
      'Enter how many days the trip lasts.',
      'Choose your vehicle.',
    ]);
    for (const field of [f.from, f.to, f.days, f.vehicle]) {
      await expect(field).toHaveAttribute('aria-invalid', 'true');
    }
    // Нічого не «відповіло»: панель досі порожня.
    await expect(f.result).toContainText('Nothing asked yet');
    await expect(f.result).not.toContainText('No route to show');
  });

  test('🔴 an error link moves focus to its field, and fixing it removes that error only', async ({ page }) => {
    const f = await open(page);
    await f.submit.click();
    await f.errors.getByRole('link', { name: 'Enter how many days the trip lasts.' }).click();
    await expect(f.days).toBeFocused();

    await page.keyboard.type('7');
    await expect(f.errors.getByRole('link')).toHaveCount(3);
    await expect(f.days).not.toHaveAttribute('aria-invalid', 'true');
    await expect(f.from).toHaveAttribute('aria-invalid', 'true');
  });

  test('each kind of bad number says what is wrong with it', async ({ page }) => {
    const f = await open(page);
    await fillValid(f);
    for (const [typed, message] of [
      ['7.5', 'Use a whole number of days, for example 7.'],
      ['0', 'Days must be between 1 and 60.'],
      ['61', 'Days must be between 1 and 60.'],
      ['', 'Enter how many days the trip lasts.'],
    ] as const) {
      await f.days.fill(typed);
      await f.submit.click();
      await expect(f.errors.getByRole('link')).toHaveText([message]);
      await expect(page.locator('#plan-days-error')).toContainText(message);
    }
  });

  test('🔴 a valid request gets the honest answer, with the request repeated back in words', async ({ page }) => {
    const f = await open(page);
    await fillValid(f);
    await f.submit.click();

    await expect(f.result).toContainText('No route to show.');
    await expect(f.result).toContainText('The planner does not calculate routes yet');
    await expect(f.result).toContainText('Ljubljana');
    await expect(f.result).toContainText('Split');
    await expect(f.result).toContainText('Motorhome (6–7.5 m)');
    await expect(f.errors).toHaveCount(0);
    // Не намальовано нічого, що схоже на маршрут.
    await expect(page.locator('canvas, svg[role="img"], ol')).toHaveCount(0);
  });

  test('🔴 it works from the keyboard: type, Tab between the fields, Enter sends', async ({ page }) => {
    const f = await open(page);
    await f.vehicle.selectOption('campervan');
    await f.from.focus();
    await page.keyboard.type('Bled');
    await page.keyboard.press('Tab');
    await expect(f.to).toBeFocused();
    await page.keyboard.type('Zadar');
    await page.keyboard.press('Tab');
    await expect(f.days).toBeFocused();
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');

    await expect(f.result).toContainText('No route to show.');
    await expect(f.result).toContainText('Bled');
    await expect(f.result).toContainText('Zadar');
    await expect(f.result).toContainText('Campervan (up to ~6 m)');
  });

  test('🔴 the answer never describes a request other than the one in the form', async ({ page }) => {
    const f = await open(page);
    await fillValid(f);
    await f.submit.click();
    await expect(f.result).toContainText('Split');

    await f.to.fill('Zadar');
    await expect(f.result).toContainText('Nothing asked yet');
    await expect(f.result).not.toContainText('Split');

    await f.submit.click();
    await expect(f.result).toContainText('Zadar');
  });

  test('🔴 with no JavaScript the verdict is still served and the form says it is inert', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const res = await page.goto('/plan');
    expect(res?.status()).toBe(200);

    await expect(page.getByTestId('planner-status')).toContainText(VERDICT);
    await expect(page.getByLabel('Starting point')).toBeDisabled();
    await expect(page.getByLabel('Number of days')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Check my trip' })).toBeDisabled();
    await expect(page.getByTestId('plan-loading')).toBeVisible();
    await context.close();
  });
});

test.describe('what it does with what you type', () => {
  test('🔴 nothing you type is sent anywhere or saved', async ({ page }) => {
    // Панель каже «not saved, and not sent anywhere». Це твердження про
    // браузер, тож його перевіряє браузер: унікальний рядок, і після
    // відправки — жоден запит його не несе, жодне сховище його не має.
    const needle = 'Zzyzx-Testville-4817';
    const seen: string[] = [];
    const posts: string[] = [];
    page.on('request', (r) => {
      seen.push(`${r.url()} ${r.postData() ?? ''}`);
      if (r.method() !== 'GET') posts.push(`${r.method()} ${r.url()}`);
    });

    const f = await open(page);
    await fillValid(f, { from: needle, to: `${needle}-end` });
    await f.submit.click();
    await expect(f.result).toContainText('not sent anywhere');
    await expect(f.result).toContainText(needle);
    // Дати можливим запитам вийти, якщо вони є.
    await page.waitForLoadState('networkidle');

    expect(seen.filter((s) => s.includes(needle)), 'введений рядок потрапив у запит').toEqual([]);
    expect(posts, 'після відправки пішов не-GET запит').toEqual([]);

    const stored = await page.evaluate(() => {
      const dump = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`).join('\n');
      return [dump(localStorage), dump(sessionStorage), document.cookie].join('\n');
    });
    expect(stored.includes(needle), 'введений рядок потрапив у сховище чи cookie').toBe(false);
    // Адреса теж: те, що людина набрала, не стає посиланням.
    expect(page.url()).not.toContain(needle);
  });

  test('🔴 the longest place name fits a phone: no sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const f = await open(page);
    const long = 'W'.repeat(120);
    await fillValid(f, { from: long, to: long });
    await f.submit.click();
    await expect(f.result).toContainText('No route to show.');

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      view: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, 'сторінка ширша за екран').toBeLessThanOrEqual(overflow.view);
    const box = await page.locator('#plan-result-heading').locator('..').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(overflow.view);
  });
});

test.describe('accessibility', () => {
  const scan = async (page: Page) =>
    (
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    ).violations.map((v) => `${v.id}: ${v.description} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

  for (const scheme of ['light', 'dark'] as const) {
    test(`🔴 no violations in ${scheme} mode: empty, with errors, and answered`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const f = await open(page);
      expect(await scan(page), 'empty').toEqual([]);

      await f.submit.click();
      await expect(f.errors).toBeVisible();
      expect(await scan(page), 'with errors').toEqual([]);

      await fillValid(f);
      await f.submit.click();
      await expect(f.result).toContainText('No route to show.');
      expect(await scan(page), 'answered').toEqual([]);
    });
  }

  test('the console stays clean through the whole flow', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

    const f = await open(page);
    await f.submit.click();
    await fillValid(f);
    await f.submit.click();
    await expect(f.result).toContainText('No route to show.');
    await f.days.fill('9');
    await expect(f.result).toContainText('Nothing asked yet');
    expect(problems).toEqual([]);
  });
});
