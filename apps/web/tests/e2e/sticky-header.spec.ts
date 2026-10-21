import { expect, test } from "@playwright/test";

// CAMP-374 — липка шапка, скло й кнопки за темою.
//
// 🔴 ЧОМУ ЦЕ НЕ «КОСМЕТИКА». Доки шапка була `static`, бургер їхав геть
// разом із нею: читач на телефоні, прокрутивши перелік кемпінгів, не мав
// доступу до меню взагалі, доки не прокрутить назад угору.
//
// Кожне твердження нижче — рядок зі «Способу перевірки» картки, і кожне
// міряє ЖИВУ сторінку, а не токен: значення, що існує в CSS і не доїхало
// до розмітки, — рівно той клас дефекту, яким була CAMP-352.

// 🔴 СТОРІНКА, ЯКА ДОВГА ЗАВЖДИ — І ЧОМУ НЕ `/camping`.
//
// Перша редакція прокручувала `/camping` на 1200 px. На фікстурі CI там
// 72 кемпінги, тож сторінка коротка: заміряно в прогоні — `scrollY`
// вийшов 199 на десктопі й НУЛЬ на телефоні. Головне твердження
// («шапка лишилась на верхівці») було б при цьому ЗЕЛЕНИМ НІ ПРО ЩО.
//
// Спіймала це пара, яку я поставив поруч саме на такий випадок — і це
// єдина причина, чому я про це дізнався. Тепер беремо правову сторінку
// (суцільний текст, довгий за будь-яких даних) і рахуємо запас
// прокрутки З САМОЇ СТОРІНКИ, а не вгадуємо число.
const LONG = "/legal/terms";

async function scrollToEnd(page: import("@playwright/test").Page) {
  const max = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(
    max,
    `${LONG} не прокручується на цьому розмірі — твердження нижче безпредметні`,
  ).toBeGreaterThan(200);
  await page.evaluate((y) => window.scrollTo(0, y), max);
  expect(
    await page.evaluate(() => window.scrollY),
    "сторінка не прокрутилась",
  ).toBeGreaterThan(200);
}

// 🔴 ШАПКА САЙТУ НАЗИВАЄТЬСЯ `data-testid`, А НЕ ТЕГОМ `header`.
//
// Перша редакція брала `locator("header")` — і впала на `/legal/terms`
// зі «strict mode violation: resolved to 2 elements». Другий `<header>`
// там свій, у `legal/[slug]/page.tsx`: заголовок правового документа.
// Те саме чекало б на сторінці кемпінгу і маршруту — обидві мають
// власний `<header>`.
//
// Це не дрібниця розбору: якби Playwright мовчки брав перший, тест на
// «шапка лишилась на верхівці» міряв би заголовок СТАТТІ, тобто був би
// зеленим ні про що. Межа задана тим, ЩО міряємо, а не тим, що
// трапилось першим у DOM.
test.describe("🔴 CAMP-374 — шапка лишається з читачем", () => {
  for (const [name, width, height] of [
    ["телефон", 375, 812],
    ["десктоп", 1280, 800],
  ] as const) {
    test(`${name}: після прокручування шапка на місці`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(LONG);

      const top = async () =>
        page.getByTestId("site-header").evaluate((el) => el.getBoundingClientRect().top);

      expect(await top(), "шапка не на верхівці до прокручування").toBe(0);
      await scrollToEnd(page);
      expect(await top(), "шапка поїхала геть при прокручуванні").toBe(0);
    });
  }

  test("🔴 бургер досяжний саме ПІСЛЯ прокручування", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(LONG);
    await scrollToEnd(page);

    const burger = page.getByTestId("burger-open");
    await expect(burger, "бургера не видно після прокручування").toBeVisible();
    await burger.click();
    await expect(
      page.getByTestId("burger-panel"),
      "бургер не відкрив меню",
    ).toBeVisible();
  });

  // 🔴 ПАСТКА, ЯКУ НАЗИВАЄ САМА КАРТКА. Липка шапка не сміє накрити
  // перший елемент сторінки. `sticky` (на відміну від `fixed`) лишається
  // в потоці, тож місце резервується саме — але сказати це й перевірити
  // це різні речі, і перевіряємо на ТРЬОХ сторінках, не на одній.
  for (const path of ["/camping", "/guides", "/tools"]) {
    test(`${path}: перший елемент не під шапкою`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(path);
      const h = await page
        .getByTestId("site-header")
        .evaluate((el) => el.getBoundingClientRect().bottom);
      const first = await page
        .locator("main")
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(h, "шапка нульової висоти — міряємо не те").toBeGreaterThan(10);
      expect(
        first,
        `${path}: вміст починається під шапкою`,
      ).toBeGreaterThanOrEqual(h);
    });
  }
});

test.describe("🔴 CAMP-374 — скло й кнопки в РЕНДЕРІ, не в токені", () => {
  test("шапка справді розмиває те, що під нею", async ({ page }) => {
    await page.goto("/camping");
    const filter = await page
      .getByTestId("site-header")
      .evaluate((el) => getComputedStyle(el).backdropFilter);
    // 🔴 ЧИТАЄМО ОБИДВІ ФОРМИ, І ЦЕ НЕ ПЕРЕСТРАХОВКА. Саме цей тест
    // спіймав, що в зібраному CSS лишалась ТІЛЬКИ префіксна форма, якої
    // Chromium 152 уже не розуміє: `backdrop-filter` там рахувався
    // `none` — тобто скла не було в Chrome і Firefox, а в Safari було.
    // Знімки цього не побачили.
    const webkit = await page
      .getByTestId("site-header")
      .evaluate(
        (el) =>
          (getComputedStyle(el) as unknown as Record<string, string>)
            .webkitBackdropFilter ?? "none",
      );
    expect(
      `${filter} ${webkit}`,
      "скла немає: значення є в CSS, але не доїхало до розмітки",
    ).toMatch(/blur\(/);
  });

  test("велика кнопка має числа теми", async ({ page }) => {
    await page.goto("/camping");
    const btn = page.locator("[data-ct-button]").first();
    await expect(btn, "на сторінці немає жодної кнопки").toHaveCount(1);
    const got = await btn.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        radius: s.borderTopLeftRadius,
        size: s.fontSize,
        weight: s.fontWeight,
        duration: s.transitionDuration,
      };
    });
    expect(got.radius, "радіус не з теми").toBe("12px");
    expect(got.size, "шрифт не з теми").toBe("16px");
    expect(got.weight, "насиченість не з теми").toBe("600");
    expect(got.duration, "тривалість не з токена").toContain("0.2s");
  });
});
