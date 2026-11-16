import { expect, test } from "./api-request";
import { LEGAL_PAGES, legalPath } from "@/lib/legal";

// CAMP-464 — розкладка /contact, /about, /blog, допису й правових сторінок.
//
// 🔴 ДВА РІЗНІ ДОКАЗИ, І КОЖЕН ТУТ ПОТРІБЕН. «Читач бачить» — це геометрія в
// браузері (колонки справді поруч, блок справді по центру). «Сторінка
// містить» — це відданий HTML, який читає пошук і ШІ-помічник: відповіді FAQ
// лежать у закритих `<details>`, тож `toBeVisible` про них збрехав би в
// обидва боки. Для них читаємо сирий HTML відповіді сервера.

const rawHtml = async (request: { get: (u: string) => Promise<{ text(): Promise<string> }> }, path: string) =>
  (await request.get(path)).text();

test.describe("🔴 CAMP-464 — /contact", () => {
  test("на широкому екрані вступ і картка стоять ПОРУЧ, на вузькому — одна під одною", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/contact");
    const intro = await page.getByTestId("contact-intro").boundingBox();
    const aside = await page.getByTestId("contact-aside").boundingBox();
    expect(intro && aside, "колонок немає").toBeTruthy();
    expect(aside!.x, "картка не праворуч від вступу").toBeGreaterThan(
      intro!.x + intro!.width - 1,
    );
    expect(Math.abs(aside!.y - intro!.y), "колонки починаються на різній висоті").toBeLessThan(40);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/contact");
    const i2 = await page.getByTestId("contact-intro").boundingBox();
    const a2 = await page.getByTestId("contact-aside").boundingBox();
    expect(a2!.y, "на телефоні картка не під вступом").toBeGreaterThan(i2!.y + i2!.height - 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, "горизонтальна прокрутка на 375").toBe(false);
  });

  test("форма одна (CAMP-441/31), а лист лишається запасним шляхом — одна кнопка-якір", async ({
    page,
    request,
  }) => {
    await page.goto("/contact");
    // Раніше тут було «форми немає» — тест, який саме це й тримав. Тепер
    // форма є, і тримається, що вона ОДНА й що лист нікуди не дівся.
    await expect(page.locator("main form")).toHaveCount(1);
    await expect(page.getByTestId("contact-form").locator("form")).toHaveCount(1);
    await expect(page.locator("main a[data-ct-button]")).toHaveCount(1);
    // Дві картки-адреси ведуть на ЛИСТ (звичайним якорем, не `next/link`).
    const cards = page.locator('main [data-testid="features"] a[href^="mailto:"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute("href", "mailto:hello@camptribe.eu");
    await expect(cards.nth(1)).toHaveAttribute("href", "mailto:privacy@camptribe.eu");
    expect(await rawHtml(request, "/contact")).not.toMatch(/\{\{/);
  });

  test("відповіді FAQ лежать у відданому HTML, а не лише в розгорнутому вигляді", async ({
    page,
    request,
  }) => {
    const html = await rawHtml(request, "/contact");
    expect(html).toContain("Report a problem");
    expect(html).toContain("privacy@camptribe.eu. What we store");
    await page.goto("/contact");
    await expect(page.locator('main [data-testid="faq"] details')).toHaveCount(3);
    // Відповідь ховається, доки питання не відкрили: це справжній акордеон.
    const first = page.locator('main [data-testid="faq"] details').first();
    await expect(first).not.toHaveAttribute("open", "");
    await first.locator("summary").click();
    await expect(first).toHaveAttribute("open", "");
  });
});

test.describe("🔴 CAMP-464 — /about", () => {
  test("секції каталогу: два «текст + фото» (фото з обох боків), три картки зі значками", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/about");
    const blocks = page.getByTestId("image-with-text");
    await expect(blocks).toHaveCount(2);
    const x = async (n: number) => {
      const img = await blocks.nth(n).locator("img").boundingBox();
      const txt = await blocks.nth(n).locator(".ct-iwt__content").boundingBox();
      return { img: img!, txt: txt! };
    };
    const first = await x(0);
    const second = await x(1);
    expect(first.img.x, "перше фото не ліворуч").toBeLessThan(first.txt.x);
    expect(second.img.x, "друге фото не праворуч").toBeGreaterThan(second.txt.x);

    const cards = page.locator('main [data-testid="features"] li');
    await expect(cards).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(cards.nth(i).locator("svg"), `картка ${i} без значка`).toHaveCount(1);
    }
    // Обидва фото справді завантажились, а не лишили порожню коробку.
    // Друге фото нижче першого екрана й ліниве: Firefox не тягне його, доки читач
    // не докрутить. Тому докручуємо, як читач, і чекаємо, а не міряємо миттєво.
    for (const n of [0, 1]) {
      const img = blocks.nth(n).locator("img");
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
          message: `фото ${n} не завантажилось`,
          timeout: 10_000,
        })
        .toBe(true);
    }
  });

  test("під одним заголовком першого рівня", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("main h1")).toHaveCount(1);
  });
});

test.describe("🔴 CAMP-464 — блог і допис", () => {
  test("кожна картка засіяного допису має ФОТО (не заглушку) і теги, що видно", async ({
    page,
    request,
  }) => {
    await page.goto("/blog");
    const cards = page.locator('[data-testid="blog-posts"] li');
    const total = await cards.count();
    expect(total, "у блозі менше п'яти карток").toBeGreaterThanOrEqual(5);

    const real = page.locator(
      '[data-testid="blog-posts"] img',
    );
    expect(await real.count(), "жодної справжньої обкладинки").toBeGreaterThanOrEqual(5);
    for (const img of await real.all()) {
      const ok = await img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      );
      expect(ok, `обкладинка не завантажилась: ${await img.getAttribute("src")}`).toBe(true);
    }
    // Допис із фікстури CI без обкладинки — заглушка теми, а не порожнеча.
    await expect(
      page.locator('[data-testid="blog-posts"] [data-testid="photo-placeholder"]').first(),
    ).toBeVisible();

    const tags = page.locator('[data-testid="blog-posts"] [data-testid="post-tags"] li');
    expect(await tags.count(), "тегів на картках немає").toBeGreaterThanOrEqual(5);
    await expect(tags.first()).toBeVisible();

    // І в ВІДДАНОМУ HTML: теги не лише намальовані CSS-ом.
    const html = await rawHtml(request, "/blog");
    expect(html).toContain("Licence");
  });

  test("сторінка допису: плашка з назвою, обкладинка, теги, один h1", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/blog/camper-over-3-5-tonnes");
    await expect(page.locator("main h1")).toHaveCount(1);
    const h1 = await page.locator("main h1").boundingBox();
    const cover = page.getByTestId("post-cover").locator("img");
    await expect(cover).toHaveAttribute("src", "/banners/camper.webp");
    const c = await cover.boundingBox();
    expect(c!.y, "обкладинка не під назвою").toBeGreaterThan(h1!.y + h1!.height);
    expect(c!.width, "обкладинка не на всю ширину").toBeGreaterThan(1200);
    expect(
      await cover.evaluate((el: HTMLImageElement) => el.naturalWidth > 0),
      "обкладинка не завантажилась",
    ).toBe(true);
    await expect(page.locator("main article").getByTestId("post-tags").locator("li")).toHaveText(["Driving", "Licence"]);
    // Примітка про ШІ лишилась (AI Act ст. 50).
    await expect(page.locator("main [data-provenance]")).toHaveCount(1);
  });
});

test.describe("🔴 CAMP-464 — правові сторінки", () => {
  test("великий заголовок і колонка текстом ПО ЦЕНТРУ", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/legal/notice");
    const h1 = page.locator("main h1");
    expect(await h1.evaluate((el) => getComputedStyle(el).textAlign)).toBe("center");
    expect(
      await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      "заголовок малий",
    ).toBeGreaterThanOrEqual(48);
    const art = await page.locator("main article").boundingBox();
    const left = art!.x;
    const right = 1440 - (art!.x + art!.width);
    expect(Math.abs(left - right), `колонка не по центру: ${left} проти ${right}`).toBeLessThan(
      4,
    );
    expect(art!.width, "колонка ширша за 840").toBeLessThanOrEqual(841);
  });

  test("перелік інших правових сторінок — ОДИН блок, а не два поспіль", async ({ page }) => {
    // Посилання на сусідній документ у ТЕКСТІ абзацу — це зміст, його не рахуємо.
    // Рахуємо блоки-переліки: «Also here» від верстки й розділ «The other pages»,
    // який «Legal notice» несе в самому тексті.
    for (const p of LEGAL_PAGES) {
      await page.goto(legalPath(p.slug));
      const fromLayout = await page.locator('main nav[aria-label="Other legal pages"]').count();
      const fromText = await page.locator("main h2", { hasText: /^The other pages$/ }).count();
      expect(
        fromLayout + fromText,
        `${p.slug}: переліків ${fromLayout} (верстка) + ${fromText} (текст), треба рівно один`,
      ).toBe(1);
    }
  });
});
