import { expect, test, type APIRequestContext, type Page } from "./api-request";
import { openHeaderNav, revealSubmenu } from "./header-nav";

// CAMP-448 (2/2) — шапка стискається в острів на прокручуванні.
//
// 🔴 КОЖНЕ ТВЕРДЖЕННЯ МІРЯЄ ЖИВУ ГЕОМЕТРІЮ, а не клас. Клас
// `max-w-[480px]` у HTML є й тоді, коли Tailwind його не зібрав, і тоді,
// коли його перебило інше правило; `getBoundingClientRect` цього не
// пробачає. Числа — теми Fuse, селектори названо в site-header-frame.tsx:
//
//   острів   max-width 480px, по центру
//   відступ  4px від країв і від верху; від 1200 px — 12px
//   радіус   16px (--global-border-radius)
//   скло     rgba(35,35,35,.8) + blur(8px) saturate(200%)
//   поріг    scrollY > 0
//
// 🔴 ДОВГА СТОРІНКА — та сама, що в sticky-header.spec.ts, і з тієї ж
// причини: /camping на фікстурі CI коротка, і «після прокручування»
// було б твердженням про нуль пікселів.
const LONG = "/legal/terms";

const API = process.env.API_BASE_URL ?? "http://localhost:3001";

interface NavItem {
  href: string;
  label: string;
  children: NavItem[];
}

/** Перший кореневий пункт шапки з дітьми — як у header-dropdown.spec.ts. */
async function parentWithChildren(request: APIRequestContext): Promise<NavItem> {
  const res = await request.get(`${API}/navigation`);
  expect(res.ok(), `GET ${API}/navigation → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { header?: NavItem[] };
  const parent = (body.header ?? []).find((i) => i.children.length > 0);
  expect(parent, "у базі немає пункту шапки з дітьми — острів без підпунктів не перевірений").toBeTruthy();
  return parent!;
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)!;
    const header = q("site-header");
    const bar = q("site-header-bar");
    const glass = q("site-glass");
    const h = header.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return {
      stacked: header.getAttribute("data-stacked"),
      headerTop: h.top,
      headerHeight: h.height,
      barLeft: b.left,
      barRight: b.right,
      barWidth: b.width,
      barTop: b.top,
      radius: getComputedStyle(bar).borderTopLeftRadius,
      glassBg: getComputedStyle(glass).backgroundColor,
      // Ширина вікна без смуги прокрутки — саме її займає смуга.
      vw: document.documentElement.clientWidth,
      scrollY: window.scrollY,
    };
  });
}

/**
 * Прокрутити донизу й дочекатись острова. Повтор, а не одна спроба:
 * до гідрації слухача прокручування ще немає (той самий клас, що й клік
 * по бургеру до гідрації, CAMP-334), і перше прокручування падає в
 * порожнечу. Запас прокрутки читається зі сторінки, не вгадується.
 */
async function scrollIntoIsland(page: Page) {
  const max = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(max, `${LONG} не прокручується — твердження нижче безпредметні`).toBeGreaterThan(200);
  await expect(async () => {
    await page.evaluate((y) => window.scrollTo(0, y), max);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    await expect(page.getByTestId("site-header")).toHaveAttribute("data-stacked", "true", {
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
}

async function scrollToTop(page: Page) {
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByTestId("site-header")).toHaveAttribute("data-stacked", "false", {
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
}

test.describe("🔴 CAMP-448 — смуга вгорі, острів після прокручування", () => {
  for (const [name, width, height, inset] of [
    ["телефон", 375, 812, 4],
    ["десктоп", 1280, 800, 12],
  ] as const) {
    test(`${name}: геометрія обох станів і повернення`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(LONG);

      // До прокручування — смуга на всю ширину, без радіуса, на верхівці.
      const top = await geometry(page);
      expect(top.stacked).toBe("false");
      expect(top.headerTop, "шапка не на верхівці").toBe(0);
      expect(Math.round(top.barWidth), "смуга не на всю ширину").toBe(top.vw);
      expect(Math.round(top.barLeft)).toBe(0);
      expect(top.radius).toBe("0px");
      expect(top.glassBg, "скло смуги вже темне").not.toBe("rgba(35, 35, 35, 0.8)");

      await scrollIntoIsland(page);
      const island = await geometry(page);

      // 🔴 Острів усередині sticky: сам <header> лишився на верхівці й
      // тієї ж висоти — вміст під ним не стрибнув.
      expect(island.headerTop, "шапка поїхала геть — sticky зламано").toBe(0);
      expect(
        Math.abs(island.headerHeight - top.headerHeight),
        `висота шапки змінилась ${top.headerHeight} → ${island.headerHeight}: зсув вмісту`,
      ).toBeLessThanOrEqual(1);

      // Пігулка: не ширша за 480, вужча за вікно, по центру, з радіусом.
      expect(island.barWidth, "острів ширший за 480 теми").toBeLessThanOrEqual(480 + 1);
      expect(island.barWidth, "острів не вужчий за смугу").toBeLessThan(island.vw);
      expect(Math.round(island.barWidth), "острів не відступив від країв").toBe(
        Math.min(480, island.vw - 2 * inset),
      );
      const leftGap = island.barLeft;
      const rightGap = island.vw - island.barRight;
      expect(Math.abs(leftGap - rightGap), `острів не по центру: ${leftGap} | ${rightGap}`).toBeLessThanOrEqual(1);
      expect(Math.round(island.barTop), "острів не відступив від верху").toBe(inset);
      expect(island.radius, "радіус не з теми").toBe("16px");
      // Тло скла ПЕРЕХОДИТЬ за `--timing-base` (0,4 с, число теми), тож
      // одразу після перемикання читається проміжний колір (заміряно в
      // chromium: `oklab(0.78 … / 0.87)`). Чекаємо кінцевого значення.
      await expect
        .poll(async () => (await geometry(page)).glassBg, {
          message: "скло острова не стало темним",
          timeout: 3000,
        })
        .toBe("rgba(35, 35, 35, 0.8)");

      // 🔴 І назад: повернення на верх розгортає смугу. Без цього сторож
      // був би зелений і над шапкою, що стиснулась назавжди.
      await scrollToTop(page);
      const back = await geometry(page);
      expect(Math.round(back.barWidth)).toBe(back.vw);
      expect(back.radius).toBe("0px");
    });
  }

  // 🔴 ВІД 1200 px В ОСТРОВІ МЕНЮ ЗГОРТАЄТЬСЯ В БУРГЕР — тема
  // (`.header__menu` видиме лише в `--top-position`). Тобто «дропдауни
  // працюють в обох станах» тут означає: вгорі — розкривач наведенням,
  // в острові — ті самі підпункти через шухляду. Обидва шляхи доводяться,
  // і кожен — до конкретного посилання дитини.
  test("десктоп: вгорі розкривач, в острові бургер і шухляда з тими самими підпунктами", async ({
    page,
    request,
  }) => {
    const parent = await parentWithChildren(request);
    const child = parent.children[0];
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(LONG);

    const nav = page.locator('header nav[aria-label="Main"]');
    const burger = page.getByTestId("burger-open");
    await expect(nav).toBeVisible();
    await expect(burger, "вгорі на десктопі бургера бути не має").toBeHidden();

    // Вгорі — розкривач, як у header-dropdown.spec.ts.
    const li = nav.locator(`[data-nav-parent="${parent.href}"]`);
    const toggle = li.locator("button[aria-expanded]");
    const panel = li.locator("[data-nav-sub]");
    await expect(async () => {
      await li.hover();
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(panel.getByRole("link", { name: child.label, exact: true })).toHaveAttribute(
      "href",
      child.href,
    );
    await page.mouse.move(640, 600);
    await expect(panel).toBeHidden({ timeout: 3000 });

    // В острові — меню сховане, бургер є й відкриває шухляду без
    // прокручування сторінки назад (інакше бургера на екрані не було).
    await scrollIntoIsland(page);
    await expect(nav, "в острові горизонтальне меню має бути сховане").toBeHidden();
    await expect(burger, "в острові немає бургера — меню недосяжне").toBeVisible();

    const box = (await burger.boundingBox())!;
    expect(box, "у бургера немає коробки").not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    const onTop = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="burger-open"]'),
      [box.x + box.width / 2, box.y + box.height / 2] as const,
    );
    expect(onTop, "у точці бургера лежить щось інше").toBe(true);
    // Кнопка острова — біла, як у теми (`stacked_menu_btn_bg #fff`).
    expect(await burger.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(255, 255, 255)",
    );

    const before = await page.evaluate(() => window.scrollY);
    const menu = await openHeaderNav(page);
    expect(await page.evaluate(() => window.scrollY), "клік прокрутив сторінку").toBe(before);
    await revealSubmenu(menu, parent.href);
    const link = menu.getByRole("link", { name: child.label, exact: true });
    await expect(link, "підпункта немає в шухляді острова").toBeVisible();
    await expect(link).toHaveAttribute("href", child.href);

    // Панель шухляди — на весь екран і на десктопі теж, бо `xl:hidden`
    // на її корені перебито станом острова.
    const drawer = (await page.getByTestId("burger-panel").boundingBox())!;
    expect(Math.round(drawer.height)).toBe(800);
  });

  test("телефон: в острові бургер відкриває шухляду з підпунктами", async ({ page, request }) => {
    const parent = await parentWithChildren(request);
    const child = parent.children[0];
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(LONG);
    await scrollIntoIsland(page);

    const burger = page.getByTestId("burger-open");
    await expect(burger).toBeVisible();
    const before = await page.evaluate(() => window.scrollY);
    const menu = await openHeaderNav(page);
    expect(await page.evaluate(() => window.scrollY), "клік прокрутив сторінку").toBe(before);
    await revealSubmenu(menu, parent.href);
    await expect(menu.getByRole("link", { name: child.label, exact: true })).toHaveAttribute(
      "href",
      child.href,
    );
  });
});
