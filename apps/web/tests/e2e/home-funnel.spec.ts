import { expect, test } from "./api-request";
import { axeViolations } from "./axe";
import { HomeSliderSearchFeatures1797700000000 as Seed } from "../../../api/src/migrations/1797700000000-HomeSliderSearchFeatures";

// CAMP-488 — перший екран головної: слайдер-воронка, пошукове поле, фічі.
//
// 🔴 ЕТАЛОН ТУТ — МІГРАЦІЯ, А НЕ ВІДПОВІДЬ API. Перша думка була звіряти
// сторінку з `GET /pages/home`: «скільки секцій у базі, стільки й на
// сайті». Але такий тест лишається зеленим, коли секції прибрано з бази:
// нуль у відповіді, нуль на сторінці, нуль слайдів збігається з нулем. Це
// той самий клас, що й «корпус ділить поле з тим, що міряє». Тому очікування
// беруться з міграції, що їх засіває, — окремого від сторінки джерела, — а
// міряється ВІДДАНА сторінка. Забрали рядок із бази (або з коду) — сторінка
// втратила слайд — тест червоніє.
//
// 🔴 ЧИТАЄТЬСЯ ДОМ, А НЕ КЛАСИ Й НЕ `sr-only`: заголовок слайда — елемент
// `h2` із текстом, кнопка — посилання з доступною назвою й адресою,
// картинка — `<img>`, який справді завантажився (`naturalWidth > 0`), а не
// просто з атрибутом `src`.

const ROWS = Seed.ROWS;
const SLIDES = ROWS.filter((r) => r.type === "slide");
const SEARCH = ROWS.find((r) => r.type === "search")!;
const FEATURES = ROWS.filter((r) => r.type === "image-text");

test.describe("🔴 CAMP-488 — слайдер головної", () => {
  test("слайдів рівно стільки, скільки засіяно, і кожен із текстом, фото й кнопкою", async ({
    page,
  }) => {
    // Захист від порожнього еталона: цикл над нулем рядків зеленіє.
    expect(SLIDES.length, "міграція не засіває слайдів").toBeGreaterThanOrEqual(3);

    await page.goto("/");
    const slides = page.getByTestId("home-slide");
    await expect(slides, "слайдер зник або слайдів не стільки").toHaveCount(
      SLIDES.length,
    );

    for (const [i, row] of SLIDES.entries()) {
      const slide = slides.nth(i);
      // Перший слайд — h1 сторінки, решта — h2.
      await expect(slide.locator(i === 0 ? "h1" : "h2"), `слайд ${i + 1}: заголовок`).toHaveText(
        row.heading,
      );
      await expect(slide, `слайд ${i + 1}: текст`).toContainText(row.body!);

      const cta = slide.getByRole("link", { name: row.ctaLabel, exact: true });
      await expect(cta, `слайд ${i + 1}: кнопки немає`).toHaveCount(1);
      await expect(cta, `слайд ${i + 1}: не та адреса`).toHaveAttribute(
        "href",
        row.ctaHref,
      );

      // Картинка не просто в розмітці — вона декодується.
      const img = slide.locator("img.ct-slide__image");
      await expect(img).toHaveAttribute("src", row.imageUrl!);
      await img.evaluate(async (el: HTMLImageElement) => {
        el.loading = "eager";
        await el.decode().catch(() => undefined);
      });
      expect(
        await img.evaluate((el: HTMLImageElement) => el.naturalWidth),
        `слайд ${i + 1}: картинка не завантажилась`,
      ).toBeGreaterThan(0);
    }
  });

  test("три входи воронки ведуть у кемпінги, планувальник і оренду", async ({
    page,
  }) => {
    await page.goto("/");
    const hrefs = await page
      .getByTestId("home-slide")
      .locator("a[data-ct-button]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    for (const want of ["/camping", "/plan", "/camper-rental"]) {
      expect(hrefs, `у слайдері немає кнопки на ${want}`).toContain(want);
    }
  });

  test("перший слайд видно на першому екрані, і сторінка не поширилась убік", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByTestId("home-slide").first().locator("h1"),
    ).toBeInViewport();
    // Доріжка слайдера гортається всередині себе; якщо вона розпирає
    // сторінку, на телефоні зʼявляється горизонтальна прокрутка.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "сторінка ширша за екран").toBeLessThanOrEqual(0);
  });

  test("мініатюра перемикає слайд: позначка й прокрутка", async ({ page }) => {
    await page.goto("/");
    const thumbs = page.getByTestId("home-slider-thumb");
    await expect(thumbs).toHaveCount(SLIDES.length);
    await expect(thumbs.first()).toHaveAttribute("aria-current", "true");

    await thumbs.nth(1).click();
    await expect(thumbs.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(thumbs.first()).not.toHaveAttribute("aria-current", "true");

    // Прокрутка справді доїхала до другого слайда (плавна, тож чекаємо).
    await expect
      .poll(
        async () =>
          page.getByTestId("home-slider-track").evaluate((el) => {
            return Math.round(el.scrollLeft / el.clientWidth);
          }),
        { timeout: 10_000, message: "доріжка не прокрутилась до слайда 2" },
      )
      .toBe(1);
  });
});

test.describe("🔴 CAMP-488 — пошукове поле головної", () => {
  test("поле на першому екрані, а форма веде в /search з запитом", async ({
    page,
  }) => {
    await page.goto("/");
    const widget = page.getByTestId("home-search");
    await expect(widget, "пошукового віджета немає").toHaveCount(1);

    const input = page.getByTestId("home-search-input");
    await expect(input, "поле пошуку не на першому екрані").toBeInViewport();
    await expect(input).toHaveAttribute("placeholder", SEARCH.subheading!);
    await expect(
      page.getByRole("search").getByRole("button", { name: SEARCH.ctaLabel }),
    ).toHaveCount(1);

    // Форма — звичайний GET, і вона працює до гідратації.
    const form = page.getByRole("search");
    await expect(form).toHaveAttribute("action", SEARCH.ctaHref);
    await expect(form).toHaveAttribute("method", "get");

    await input.fill("lake");
    await input.press("Enter");
    await page.waitForURL(/\/search\?q=lake$/);
    // 🔴 КІНЕЦЬ ЛАНЦЮГА: /search справді прочитала запит із адреси.
    await expect(page.locator("#q")).toHaveValue("lake");
  });
});

test.describe("🔴 CAMP-488 — доступність першого екрана", () => {
  // Слайдер — це `role=group`, мініатюри — кнопки, пошук — `role=search`.
  // Вигляд без жодного порушення WCAG доводить не мій погляд, а axe на
  // відданій сторінці (і з накладкою, і з білим текстом поверх фото).
  test("головна проходить axe без порушень", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-slide").first()).toBeVisible();
    expect(await axeViolations(page), "порушення на /").toEqual([]);
  });
});

test.describe("🔴 CAMP-488 — фічі секціями з фото", () => {
  test("кожен рядок «текст + фото» з бази на сторінці: заголовок, фото, кнопка", async ({
    page,
  }) => {
    expect(FEATURES.length, "міграція не засіває фіч").toBeGreaterThanOrEqual(4);

    await page.goto("/");
    const rows = page.getByTestId("image-text");
    await expect(rows, "рядків із фото не стільки").toHaveCount(FEATURES.length);

    for (const [i, row] of FEATURES.entries()) {
      const r = rows.nth(i);
      await expect(r.locator("h2"), `фіча ${i + 1}: заголовок`).toHaveText(
        row.heading,
      );
      await expect(r.locator("img.ct-iwt__image")).toHaveAttribute(
        "src",
        row.imageUrl!,
      );
      await expect(
        r.getByRole("link", { name: row.ctaLabel, exact: true }),
        `фіча ${i + 1}: кнопка`,
      ).toHaveAttribute("href", row.ctaHref);
    }
  });

  test("країни й «What to drive» лишились на місці", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Countries" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "What to drive" })).toHaveCount(1);
    await expect(
      page.locator('main a[href^="/camping/"]').first(),
    ).toBeVisible();
  });
});

// CAMP-441 (15, 17): the home selects lead to the map, already filtered.
// Paired: the type chosen on the home page is the one pressed on the map,
// and a type NOT chosen is not.
test("фільтри головної ведуть на мапу з тим самим фільтром", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("home-filter-type").selectOption("rv_park");
  await page.getByTestId("home-filters-submit").click();
  await page.waitForURL(/\/map\?/);
  expect(page.url()).toContain("types=rv_park");
  const { openSettings } = await import("./open-map");
  await openSettings(page);
  await expect(page.getByTestId("filter-type-rv_park")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("filter-type-free")).toHaveAttribute("aria-pressed", "false");
});
