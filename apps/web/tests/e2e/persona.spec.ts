import { expect, test, type Page } from './api-request';

/**
 * CAMP-501 — «маю кемпер» / «орендую»: один сайт, один перемикач.
 *
 * 🔴 ЩО ДОВОДИТЬ ЦЕЙ ФАЙЛ, І ЧОГО ВІН НЕ ДОВОДИТЬ.
 * Читається ВІДДАНА сторінка в справжньому браузері, а не константа:
 *   · вибір переживає перезавантаження І перехід на іншу сторінку (ключ
 *     `camptribe.persona` у `localStorage`, атрибут на `<html>` до першого
 *     малювання);
 *   · на головній перша картка інша для кожного вибору — міряється
 *     ПОЛОЖЕННЯМ на екрані, а не порядком у розмітці;
 *   · на маршруті блок оренди видимий для «орендую» і відсутній для «маю
 *     кемпер» (`display:none` прибирає його і з доступного дерева);
 *   · на картці кемпінгу порядок блоків міняється; блок «служби» (злив,
 *     газ) у цій фікстурі не малюється — немає точок поруч, — тож його
 *     порядок звіряється за обгорткою, яка в розмітці є завжди.
 * Підписи кнопок беруться з CMS, тому тест шукає кнопки за `data-testid`,
 * а не за текстом.
 */

const KEY = 'camptribe.persona';

async function stored(page: Page) {
  return page.evaluate((k) => window.localStorage.getItem(k), KEY);
}
const attr = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.persona ?? null);

/** Позиція блока на екрані: зверху вниз, а за рівної висоти — зліва направо. */
async function slot(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`«${selector}» не має прямокутника на екрані`);
  return box.y * 10_000 + box.x;
}

let routePath: string;
let campPath: string;

test.beforeAll(async ({ request }) => {
  const res = await request.get(
    `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/routes/content`,
  );
  const body = (await res.json()) as unknown;
  const list = (Array.isArray(body) ? body : (body as { routes: unknown[] }).routes) as Array<{
    slug: string;
    countries: string[];
  }>;
  const rentals = (await (
    await request.get(
      `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/rental/countries`,
    )
  ).json()) as { countries: Array<{ code: string }> };
  const have = new Set(rentals.countries.map((c) => c.code));
  const pick = list.find((r) => r.countries.some((c) => have.has(c)));
  if (!pick) throw new Error('жоден маршрут не йде країною, де є сторінка оренди');
  routePath = `/routes/${pick.slug}`;
});

test.beforeAll(async ({ browser, baseURL }) => {
  // Картка кемпінгу береться з посилань на головній: так само, як її
  // знайшов би читач.
  const page = await browser.newPage();
  await page.goto(baseURL ?? 'http://localhost:3000/');
  const href = await page
    .locator('a[href^="/camping/"]')
    .evaluateAll((as) =>
      (as as HTMLAnchorElement[])
        .map((a) => a.getAttribute('href') ?? '')
        .find((h) => h.split('/').filter(Boolean).length === 4),
    );
  await page.close();
  if (!href) throw new Error('на головній немає жодної картки кемпінгу');
  campPath = href;
});

test.describe('🔴 CAMP-501 — перемикач «маю кемпер / орендую»', () => {
  test('🔴 вибір переживає перезавантаження й перехід між сторінками', async ({
    page,
  }) => {
    await page.goto('/');
    expect(await attr(page), 'на старті вже стоїть вибір').toBeNull();
    expect(await stored(page), 'на старті вже є запис').toBeNull();

    await page.getByTestId('persona-renter').click();
    expect(await attr(page)).toBe('renter');
    expect(await stored(page), 'вибір не записано').toBe('renter');

    await page.reload();
    expect(await attr(page), 'після перезавантаження вибір зник').toBe('renter');

    // Перехід на ІНШУ сторінку — повне завантаження, а не клієнтська
    // навігація: атрибут мусить стояти до першого малювання.
    await page.goto(routePath);
    expect(await attr(page), 'на сторінці маршруту вибір зник').toBe('renter');
    await expect(page.getByTestId('persona-renter')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByTestId('persona-owner').click();
    await page.goto(campPath);
    expect(await attr(page), 'на картці кемпінгу вибір зник').toBe('owner');
    expect(await stored(page)).toBe('owner');
  });

  test('повторне натискання знімає вибір і видаляє ключ', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('persona-owner').click();
    expect(await stored(page)).toBe('owner');
    await page.getByTestId('persona-owner').click();
    expect(await attr(page)).toBeNull();
    expect(await stored(page), 'ключ лишився після зняття вибору').toBeNull();
  });

  test('сміття в сховищі нічого не вмикає', async ({ page }) => {
    await page.addInitScript(
      (k) => window.localStorage.setItem(k, 'admin'),
      KEY,
    );
    await page.goto('/');
    expect(await attr(page)).toBeNull();
  });

  test('🔴 головна: першою стоїть картка того, хто обрав', async ({ page }) => {
    const stay = '[data-persona-first="owner"]';
    const drive = '[data-persona-first="renter"]';
    await page.goto('/');
    // Без вибору — як було: «де зупинитись» перше.
    expect(await slot(page, stay)).toBeLessThan(await slot(page, drive));

    await page.getByTestId('persona-renter').click();
    expect(
      await slot(page, drive),
      'орендар: картка «що возити» не стала першою',
    ).toBeLessThan(await slot(page, stay));

    await page.getByTestId('persona-owner').click();
    expect(
      await slot(page, stay),
      'власник кемпера: картка «де зупинитись» не перша',
    ).toBeLessThan(await slot(page, drive));
  });

  test('🔴 маршрут: блок оренди є в «орендую» і немає в «маю кемпер»', async ({
    page,
  }) => {
    await page.goto(routePath);
    const block = page.getByTestId('route-rental');
    await expect(block, 'у розмітці блоку оренди немає').toHaveCount(1);
    await expect(block, 'без вибору блок мусить бути видимий').toBeVisible();

    await page.getByTestId('persona-renter').click();
    await expect(block).toBeVisible();
    await expect(block.getByRole('link').first()).toHaveAttribute(
      'href',
      /^\/camper-rental\/[a-z]{2}$/,
    );

    await page.getByTestId('persona-owner').click();
    await expect(block, 'власнику кемпера блок оренди видно').toBeHidden();
    // Не лише невидимий: і поза доступним деревом.
    await expect(page.getByRole('heading', { name: /Renting a camper/ })).toHaveCount(0);
  });

  test('🔴 картка кемпінгу: порядок блоків міняється за вибором', async ({
    page,
  }) => {
    await page.goto(campPath);
    const order = (sel: string) =>
      page
        .locator(sel)
        .first()
        .evaluate((el) => getComputedStyle(el).order);
    const there = 'section[data-persona-first="renter"]';
    const services = 'div[data-persona-first="owner"]';
    const header = 'main[data-persona-zone] > header';

    // Без вибору нічого не міняється.
    expect(await order(there)).toBe('0');

    await page.getByTestId('persona-renter').click();
    expect(await order(there), 'орендарю «Getting there» не піднято').toBe('-1');
    expect(await order(services)).toBe('0');
    expect(await order(header), 'заголовок мусить лишитись першим').toBe('-2');
    // Положення на екрані: піднятий блок вище за блок, що стояв перед ним.
    expect(await slot(page, there)).toBeLessThan(
      await slot(page, 'section:has(> h2:text-is("Facilities"))'),
    );

    await page.getByTestId('persona-owner').click();
    expect(await order(services), 'власнику «служби» не підняті').toBe('-1');
    expect(await order(there)).toBe('0');
    expect(await slot(page, header)).toBeLessThan(await slot(page, there));
  });
});
