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

/**
 * Кнопка вибору: у шапці від 1200 px, а на вужчому — у бургері (шапка
 * завжди один рядок, CAMP-448). Читач робить те саме, що й тест.
 */
async function choose(page: Page, p: "owner" | "renter") {
  const inHeader = page.getByTestId(`persona-${p}`);
  if (await inHeader.isVisible()) {
    await inHeader.click();
    return;
  }
  await page.getByTestId("burger-open").click();
  await page.getByTestId(`persona-drawer-${p}`).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("burger-scrim")).toHaveCount(0);
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

    await choose(page, 'renter');
    expect(await attr(page)).toBe('renter');
    expect(await stored(page), 'вибір не записано').toBe('renter');

    await page.reload();
    expect(await attr(page), 'після перезавантаження вибір зник').toBe('renter');

    // Перехід на ІНШУ сторінку — повне завантаження, а не клієнтська
    // навігація: атрибут мусить стояти до першого малювання.
    await page.goto(routePath);
    expect(await attr(page), 'на сторінці маршруту вибір зник').toBe('renter');

    await choose(page, 'owner');
    await page.goto(campPath);
    expect(await attr(page), 'на картці кемпінгу вибір зник').toBe('owner');
    expect(await stored(page)).toBe('owner');
  });

  test('повторне натискання знімає вибір і видаляє ключ', async ({ page }) => {
    await page.goto('/');
    await choose(page, 'owner');
    expect(await stored(page)).toBe('owner');
    await choose(page, 'owner');
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

    await choose(page, 'renter');
    expect(
      await slot(page, drive),
      'орендар: картка «що возити» не стала першою',
    ).toBeLessThan(await slot(page, stay));

    await choose(page, 'owner');
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

    await choose(page, 'renter');
    await expect(block).toBeVisible();
    await expect(block.getByRole('link').first()).toHaveAttribute(
      'href',
      /^\/camper-rental\/[a-z]{2}$/,
    );

    await choose(page, 'owner');
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

    await choose(page, 'renter');
    expect(await order(there), 'орендарю «Getting there» не піднято').toBe('-1');
    expect(await order(services)).toBe('0');
    expect(await order(header), 'заголовок мусить лишитись першим').toBe('-2');
    // Положення на екрані: піднятий блок вище за блок, що стояв перед ним.
    expect(await slot(page, there)).toBeLessThan(
      await slot(page, 'section:has(> h2:text-is("Facilities"))'),
    );

    await choose(page, 'owner');
    expect(await order(services), 'власнику «служби» не підняті').toBe('-1');
    expect(await order(there)).toBe('0');
    expect(await slot(page, header)).toBeLessThan(await slot(page, there));
  });

  test('🔴 шапка лишається ОДНИМ рядком на 320, 375, 768 і 1200 px, з вибором і без', async ({
    page,
  }) => {
    for (const width of [320, 375, 768, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      for (const persona of [null, 'renter'] as const) {
        await page.goto('/');
        if (persona) await choose(page, persona);
        const rows = await page.evaluate(() => {
          const logo = document.querySelector('header a[href="/"]')!.getBoundingClientRect();
          const tops = ['[data-testid="burger-open"]', '[data-testid="theme-toggle"]', '[data-testid="persona-toggle"]']
            .map((q) => document.querySelector(q))
            .filter((el): el is Element => !!el && el.getBoundingClientRect().width > 0)
            .map((el) => el.getBoundingClientRect());
          return {
            logoBottom: logo.bottom,
            tops: tops.map((r) => r.top),
            height: document.querySelector('header')!.getBoundingClientRect().height,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        const label = `${width}px, вибір ${persona ?? 'немає'}`;
        for (const top of rows.tops) {
          expect(top, `${label}: елемент шапки на другому рядку`).toBeLessThan(rows.logoBottom);
        }
        expect(rows.height, `${label}: шапка вища за один рядок`).toBeLessThan(90);
        expect(rows.overflow, `${label}: горизонтальна прокрутка`).toBeLessThanOrEqual(0);
      }
    }
  });

  test('🔴 порядок Tab збігається з видимим: головна, обидва режими', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const [persona, firstCard] of [
      ['renter', 'renter'],
      ['owner', 'owner'],
    ] as const) {
      await page.goto('/');
      await choose(page, persona);
      // Перезавантаження: порядок мусить відновитись із збереженого вибору,
      // а не лише після кліку.
      await page.reload();
      // PersonaOrder переставляє DOM після гідратації: чекаємо, доки він
      // відпрацює, а не вгадуємо паузу.
      await expect
        .poll(() =>
          page.evaluate(
            () => document.querySelector('[data-persona-group]')!.firstElementChild!.getAttribute('data-persona-first'),
          ),
        )
        .toBe(firstCard);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-persona-group]')!.scrollIntoView());
      await page.evaluate(() => {
        const first = document.querySelector('[data-persona-group] a')!;
        (first.previousElementSibling as HTMLElement | null)?.focus?.();
      });
      const seq: string[] = [];
      await page.locator('[data-persona-group] a').first().focus();
      // Рівно стільки Tab, скільки посилань у двох картках: далі йде решта сторінки.
      const stops = await page.locator('[data-persona-group] a').count();
      for (let i = 0; i < stops; i++) {
        const card = await page.evaluate(
          () => document.activeElement?.closest('[data-persona-first]')?.getAttribute('data-persona-first') ?? '-',
        );
        if (card !== '-' && seq[seq.length - 1] !== card) seq.push(card);
        await page.keyboard.press('Tab');
      }
      const visual = await page.evaluate(() =>
        [...document.querySelectorAll('[data-persona-group] > [data-persona-first]')]
          .map((el) => ({ k: el.getAttribute('data-persona-first')!, x: el.getBoundingClientRect().x }))
          .sort((a, b) => a.x - b.x)
          .map((e) => e.k),
      );
      expect(seq, `${persona}: Tab ходить блоками не так, як вони стоять`).toEqual(visual);
      expect(visual[0], `${persona}: перший блок не той`).toBe(firstCard);
    }
  });

  test('🔴 порядок Tab збігається з видимим: картка кемпінгу, обидва режими', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const persona of ['renter', 'owner'] as const) {
      await page.goto(campPath);
      await choose(page, persona);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const kids = [...document.querySelector('[data-persona-zone]')!.children];
            return kids.findIndex((k) => k.getAttribute('data-persona-first') === 'renter') <
              kids.findIndex((k) => k.getAttribute('data-persona-first') === 'owner');
          }),
        )
        .toBe(persona === 'renter');
      // Порядок у розмітці = порядок на екрані: кожна дитина, що має
      // прямокутник, стоїть не вище попередньої.
      const ys = await page.evaluate(() =>
        [...document.querySelector('[data-persona-zone]')!.children]
          .map((k) => k.getBoundingClientRect())
          .filter((r) => r.height > 0)
          .map((r) => Math.round(r.top + window.scrollY)),
      );
      expect(ys, `${persona}: розмітка йде не так, як екран`).toEqual([...ys].sort((a, b) => a - b));
    }
  });
});
