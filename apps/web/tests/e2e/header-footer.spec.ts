import { expect, test, type Page } from "./api-request";
import { openHeaderNav, revealSubmenu } from "./header-nav";
import { publishedCountries } from "../../src/lib/unpublished-countries";
import { liveLocales } from "../../src/lib/i18n";

/**
 * CAMP-448 — шапка й підвал за взірцем Fuse: мега-меню з країнами, лупа,
 * мова, вхід, соцкнопки, фото-смуга.
 *
 * 🔴 ВСЕ МІРЯЄТЬСЯ ПО ЖИВІЙ СТОРІНЦІ й порівнюється з тим самим API, з якого
 * її будує сервер (так само, як `site-settings.spec.ts`). Константа, клас
 * чи `data-testid` без видимої розмітки нічого б не довели.
 */

const API = process.env.API_BASE_URL ?? "http://localhost:3001";

async function liveCountries(
  request: import("@playwright/test").APIRequestContext,
): Promise<string[]> {
  const res = await request.get(`${API}/spots/countries`);
  expect(res.ok(), `GET ${API}/spots/countries → ${res.status()}`).toBe(true);
  const rows = (await res.json()) as {
    country: string;
    spots: number;
    regions: number;
  }[];
  return publishedCountries(rows).map((r) => r.country);
}

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1200;

test.describe("🔴 CAMP-448 — мега-меню: країни з даних", () => {
  test("кожна опублікована країна — посилання в меню Campsites, і воно відкривається", async ({
    page,
    request,
  }) => {
    const codes = await liveCountries(request);
    expect(
      codes.length,
      "в API немає жодної країни — нема що звіряти",
    ).toBeGreaterThan(0);

    await page.goto("/camping");
    const menu = await openHeaderNav(page);
    await revealSubmenu(menu, "/camping");

    if (!isDesktop(page)) {
      // Шухляда: довгий перелік складений у `<details>` — розкриваємо.
      const fold = menu.locator('details[data-nav-fold="/camping"]');
      if ((await fold.count()) > 0) await fold.locator("summary").click();
    }

    for (const code of codes) {
      const link = menu.locator(`a[href="/camping/${code}"]`).first();
      await expect(link, `країни ${code} немає в меню`).toBeVisible();
      const res = await request.get(`/camping/${code}`);
      expect(
        res.status(),
        `/camping/${code} з меню віддає ${res.status()}`,
      ).toBeLessThan(400);
    }
  });

  test("🔴 країна, якої немає в даних, у меню не зʼявляється", async ({
    page,
    request,
  }) => {
    const codes = new Set(await liveCountries(request));
    await page.goto("/camping");
    const menu = await openHeaderNav(page);
    const hrefs = await menu
      .locator('a[href^="/camping/"]')
      .evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
    for (const h of hrefs) {
      const m = /^\/camping\/([a-z]{2})$/.exec(h);
      if (!m) continue;
      expect(
        codes.has(m[1]),
        `меню веде на ${h}, а даних для країни немає`,
      ).toBe(true);
    }
  });

  test("десктоп: мега-панель відкривається під рядом і не виходить за вікно", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "горизонтальне меню є лише від 1200 px");
    await page.goto("/camping");
    const nav = page.locator('header nav[aria-label="Main"]');
    const li = nav.locator('[data-nav-parent="/camping"]');
    await expect(li).toHaveAttribute("data-nav-kind", "mega");
    await revealSubmenu(nav, "/camping");
    const panel = li.getByTestId("mega-panel");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x, "панель виходить за лівий край").toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      "панель виходить за правий край",
    ).toBeLessThanOrEqual(vw);
    const header = await page.getByTestId("site-header-bar").boundingBox();
    expect(
      box!.y,
      "панель не під рядом шапки",
    ).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
  });
});

test.describe("🔴 CAMP-448 — шапка: лупа, вхід, мова", () => {
  test("десктоп: лупа без слова, вхід, мова з прапорцем; усе в один ряд", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "іконки шапки в ряду є лише від 1200 px");
    await page.goto("/");

    const search = page.getByTestId("header-search");
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute("aria-label", "Search");
    expect((await search.innerText()).trim(), "слово «Search» видиме").toBe("");

    await expect(page.getByTestId("header-account")).toBeVisible();
    await expect(page.getByTestId("header-account")).toHaveAttribute(
      "href",
      "/account",
    );

    const sw = page.getByTestId("language-switch-header");
    await expect(sw).toBeVisible();
    await expect(
      sw.locator("svg, img").first(),
      "у перемикача немає прапорця",
    ).toBeVisible();

    // Ряд не переноситься: пункти, іконки й мова вміщаються. Саме це —
    // «бургер лише при переповненні»: нижче 1200 px меню йде в шухляду, а
    // від 1200 ряд мусить вміщатись, а не лізти на другий рядок. Міряється
    // на САМІЙ межі (1200 — найтісніше, заміряно: 1165 px потрібно з
    // запасом 35) і на двох ширших.
    for (const width of [1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const dims = await page.evaluate(() => {
        const ul = document.querySelector(
          'header nav[aria-label="Main"] ul',
        ) as HTMLElement;
        const row = document.querySelector(
          '[data-testid="site-header-bar"] > div:last-child',
        ) as HTMLElement;
        return {
          ulHeight: ul.getBoundingClientRect().height,
          rowScroll: row.scrollWidth,
          rowClient: row.clientWidth,
          headerHeight: document
            .querySelector("header")!
            .getBoundingClientRect().height,
        };
      });
      expect(
        dims.ulHeight,
        `${width}px: пункти меню перенеслись на другий рядок`,
      ).toBeLessThanOrEqual(52);
      expect(
        dims.rowScroll,
        `${width}px: ряд шапки ширший за вікно`,
      ).toBeLessThanOrEqual(dims.rowClient);
      expect(dims.headerHeight, `${width}px: шапка виросла`).toBeLessThanOrEqual(
        64,
      );
    }
  });

  test("мова: у перемикачі рівно живі мови з конфігурації", async ({ page }) => {
    test.skip(!isDesktop(page), "перемикач у ряду шапки є лише від 1200 px");
    await page.goto("/");
    const sw = page.getByTestId("language-switch-header");
    await sw.getByRole("button").click();
    const codes = await sw
      .locator("a[hreflang]")
      .evaluateAll((els) => els.map((a) => a.getAttribute("hreflang")));
    expect(codes).toEqual(liveLocales().map((l) => l.code));
  });

  test("вузька ширина: вхід і мова — у шухляді", async ({ page }) => {
    test.skip(isDesktop(page), "шухляда лише нижче 1200 px");
    await page.goto("/");
    await expect(page.getByTestId("header-account")).toBeHidden();
    await openHeaderNav(page);
    await expect(page.getByTestId("drawer-account")).toBeVisible();
    await expect(
      page.getByTestId("language-switch-footer").first(),
    ).toBeVisible();
  });
});

test.describe("🔴 CAMP-448 — підвал: соцкнопки, фото-смуга, мова", () => {
  test("соцкнопки в підвалі — рівно ті, що віддає API; жодної — блоку немає", async ({
    page,
    request,
  }) => {
    const res = await request.get(`${API}/site-settings`);
    expect(res.ok(), `GET ${API}/site-settings → ${res.status()}`).toBe(true);
    const body = (await res.json()) as {
      socialLinks?: { network: string; url: string }[];
    };
    expect(
      Array.isArray(body.socialLinks),
      "API не віддає socialLinks — підвал не має з чого малювати",
    ).toBe(true);

    await page.goto("/");
    const block = page.getByTestId("footer-social");
    if (body.socialLinks!.length === 0) {
      await expect(
        block,
        "у CMS соцмереж немає, а блок намальований",
      ).toHaveCount(0);
      return;
    }
    await expect(block).toBeVisible();
    const hrefs = await block
      .locator("a")
      .evaluateAll((els) => els.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(body.socialLinks!.map((l) => l.url));
  });

  test("фото-смуга справді видима й залита фотографією", async ({ page }) => {
    await page.goto("/");
    const strip = page.getByTestId("footer-wordmark");
    await strip.scrollIntoViewIfNeeded();
    await expect(strip).toBeVisible();
    const box = await strip.boundingBox();
    expect(box!.height, "фото-смуга без висоти").toBeGreaterThan(40);
    const style = await strip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        image: cs.backgroundImage,
        clip: cs.backgroundClip,
      };
    });
    expect(style.image, "фону-фотографії немає").toContain("/banners/");
    expect(style.clip).toContain("text");
    expect(style.color).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test("мова в підвалі: прапорець, і лише живі мови", async ({ page }) => {
    await page.goto("/");
    const sw = page.getByTestId("language-switch-footer").last();
    await sw.scrollIntoViewIfNeeded();
    await expect(sw).toBeVisible();
    await sw.getByRole("button").click();
    const codes = await sw
      .locator("a[hreflang]")
      .evaluateAll((els) => els.map((a) => a.getAttribute("hreflang")));
    expect(codes).toEqual(liveLocales().map((l) => l.code));
  });

  test("жодне посилання на правову сторінку не стоїть у підвалі двічі", async ({
    page,
  }) => {
    await page.goto("/");
    const legal = await page
      .locator('footer a[href^="/legal/"]')
      .evaluateAll((els) => els.map((a) => a.getAttribute("href")));
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.filter((h, i) => legal.indexOf(h) !== i)).toEqual([]);
  });
});
