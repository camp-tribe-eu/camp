import { expect, test, type APIRequestContext } from './api-request';

// CAMP-448 (1/2) — розкривач у шапці: поведінка, яку статичний рендер
// довести не може. Юніт `site-nav-dropdown.spec.tsx` читає HTML: кнопка є,
// `aria-expanded="false"`, діти в панелі. Тут — те, що відбувається після
// гідрації: миша, клавіатура, Escape, клік поза меню.
//
// 🔴 ПОВЕДІНКА — ТЕМИ FUSE (`assets/section-header.build.js`): відкриття
// `mouseenter` і кліком, закриття `mouseleave` з витримкою 500 мс, Escape,
// клік поза меню. Числа й події звідти, а не вигадані.
//
// 🔴 ЛИШЕ ВІД 1200 px. Нижче розкривача немає за задумом — там шухляда,
// і діти в ній видимі одразу (це перевіряє `navigation.spec.ts` на
// mobile-chrome). Тому тут власний viewport, а не пропуск за шириною:
// пропуск на телефоні ховав би падіння на десктопі в проєкті, який
// випадково стартував вузьким.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

interface NavItem {
  href: string;
  label: string;
  children: NavItem[];
}

test.use({ viewport: { width: 1280, height: 800 } });

/** Перший кореневий пункт шапки, що має дітей. Немає — це падіння. */
async function parentWithChildren(request: APIRequestContext): Promise<NavItem> {
  const res = await request.get(`${API}/navigation`);
  expect(res.ok(), `GET ${API}/navigation → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { header?: NavItem[] };
  const parent = (body.header ?? []).find((i) => i.children.length > 0);
  // 🔴 Не skip: без жодного пункту з дітьми розкривач не перевірений, і
  // мовчазний пропуск означав би зелений прогін над нічим.
  expect(
    parent,
    'у базі немає жодного пункту шапки з дітьми — міграція NavigationChildren не накотилась?',
  ).toBeTruthy();
  return parent!;
}

test.describe('🔴 CAMP-448 — розкривач у шапці', () => {
  test('миша: наведення відкриває, відхід закриває; підпункт веде на сторінку', async ({
    page,
    request,
  }) => {
    const parent = await parentWithChildren(request);
    await page.goto('/');
    const li = page.locator(`header nav[aria-label="Main"] [data-nav-parent="${parent.href}"]`);
    const toggle = li.locator('button[aria-expanded]');
    const panel = li.locator('[data-nav-sub]');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    // 🔴 Наведення — ПІСЛЯ гідрації, інакше `mouseenter` падає в порожнечу
    // (той самий клас, що й клік по бургеру до гідрації, CAMP-334).
    await expect(async () => {
      await li.hover();
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Кожна дитина — видиме посилання з правильною адресою.
    for (const child of parent.children) {
      await expect(
        panel.getByRole('link', { name: child.label, exact: true }),
      ).toHaveAttribute('href', child.href);
    }

    // Відхід миші: панель закривається — не миттєво, а з витримкою теми
    // (500 мс), щоб курсор устигав дійти до панелі.
    await page.mouse.move(10, 700);
    await expect(panel).toBeHidden({ timeout: 3000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // І перехід: знову відкрити й клікнути першу дитину.
    await li.hover();
    const first = parent.children[0];
    await panel.getByRole('link', { name: first.label, exact: true }).click();
    // 🔴 Без регулярки: CodeQL назвав побудову з рядка «incomplete string
    // escaping» — екранувався лише `/`, решта метасимволів ні. Предикат
    // звіряє шлях як шлях, і екранувати в ньому нема чого.
    await expect(page).toHaveURL((url) => url.pathname === first.href);
  });

  test('клавіатура: Enter на кнопці відкриває, Tab іде в підпункти, Escape закриває й повертає фокус', async ({
    page,
    request,
  }) => {
    const parent = await parentWithChildren(request);
    await page.goto('/');
    const li = page.locator(`header nav[aria-label="Main"] [data-nav-parent="${parent.href}"]`);
    const toggle = li.locator('button[aria-expanded]');
    const panel = li.locator('[data-nav-sub]');

    // Фокус на кнопку й Enter — із повтором до гідрації, як і клік.
    await expect(async () => {
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Tab веде в першу дитину — панель справді в порядку фокуса, а не
    // лише намальована.
    await page.keyboard.press('Tab');
    await expect(
      panel.getByRole('link', { name: parent.children[0].label, exact: true }),
    ).toBeFocused();

    // Escape зсередини панелі: закриває й повертає фокус на кнопку, щоб
    // той, хто ходить клавіатурою, не лишився в нікуди.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    // Пробіл — друга клавіша кнопки.
    await page.keyboard.press('Space');
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('клік по кнопці перемикає, клік поза меню закриває', async ({ page, request }) => {
    const parent = await parentWithChildren(request);
    await page.goto('/');
    const li = page.locator(`header nav[aria-label="Main"] [data-nav-parent="${parent.href}"]`);
    const toggle = li.locator('button[aria-expanded]');
    const panel = li.locator('[data-nav-sub]');

    await expect(async () => {
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    // Миша лишається над пунктом (щойно клікнула), тож повторний клік має
    // закрити — це перемикач, а не «відкрити ще раз».
    await toggle.click();
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(panel).toBeVisible();
    // Клік поза шапкою — по вмісту сторінки.
    await page.mouse.click(640, 700);
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('батько сам лишається посиланням на свою сторінку', async ({ page, request }) => {
    const parent = await parentWithChildren(request);
    await page.goto('/');
    const li = page.locator(`header nav[aria-label="Main"] [data-nav-parent="${parent.href}"]`);
    await li.getByRole('link', { name: parent.label, exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === parent.href);
  });
});
