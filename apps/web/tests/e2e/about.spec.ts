import { expect, test } from "@playwright/test";

// CAMP-365 — /about переїхала з коду в CMS.
//
// 🔴 ЦЕЙ ФАЙЛ Є ДОКАЗОМ ПОСИМВОЛЬНОСТІ, А НЕ ПЕРЕВІРКОЮ «СТОРІНКА
// ВІДКРИВАЄТЬСЯ».
//
// Абзаци нижче знято з попередньої версії `app/about/page.tsx` ПЕРЕД
// заміною — тобто це те, що сторінка казала читачеві, коли текст жив у
// коді. Якщо переїзд щось загубив чи переписав, різниця буде видна
// тут, а не через місяць в індексі пошуковика.
//
// 🔴 І ЧОМУ ТУТ ПОВНІ АБЗАЦИ, А НЕ КЛЮЧОВІ СЛОВА. Перевірка на
// «містить „OpenStreetMap“» зеленіла б і над половиною абзацу, і над
// переписаним реченням. Посимвольність доводить лише посимвольна
// цитата.

const PARAGRAPHS = [
  "CampTribe is a directory of campsites, motorhome parks and camper stops across the twenty-seven member states of the European Union. It is built from OpenStreetMap and from official open data published by national and European bodies, and every page says which source a fact came from.",
  "Open data is uneven: a campsite may have no recorded opening hours, no price and no answer to whether you may legally spend the night there. Where that is the case the page says so instead of guessing. An empty field is a fact about our data, not a fact about the place.",
  "Alongside the directory we show conditions that change by the hour — official weather warnings, wildfire reports, bathing-water quality and fuel prices — each from the body that issues it, with the time it was issued. Where a reading is older than its source allows, the page says that too rather than showing a stale number as current.",
];

test.describe("🔴 CAMP-365 — /about із CMS", () => {
  test("текст той самий, що був у коді — посимвольно", async ({ page }) => {
    await page.goto("/about");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "About CampTribe",
    );

    const body = await page.locator("main").innerText();
    for (const p of PARAGRAPHS) {
      expect(
        body.replace(/\s+/g, " "),
        `абзац загублено або переписано:\n${p.slice(0, 60)}…`,
      ).toContain(p.replace(/\s+/g, " "));
    }
  });

  test("виділене речення лишилось виділеним, а не стало текстом", async ({
    page,
  }) => {
    await page.goto("/about");
    // Коментар у старому файлі називав його «найважливішим абзацом
    // сторінки». Переїзд не сміє перетворити його на звичайний текст.
    await expect(
      page.locator("main strong", { hasText: "What we do not know, we say." }),
    ).toHaveCount(1);
  });

  test("посилання ВСЕРЕДИНІ речення веде на правову сторінку", async ({
    page,
  }) => {
    await page.goto("/about");
    const link = page.locator('main p a[href="/legal/notice"]');
    await expect(link, "посилання всередині абзацу зникло").toHaveCount(1);
    await expect(link).toHaveText("Legal notice");
  });

  test("підстановки підставились, а не лишились дужками", async ({ page }) => {
    await page.goto("/about");
    const body = await page.locator("main").innerText();
    // Позитивне: значення на місці.
    expect(body).toContain("CampTribe is operated by UTD BV, 2000 Antwerpen.");
    // 🔴 І негативне: жодної нерозгорнутої підстановки на сторінці.
    expect(body, "на сторінці лишилась нерозгорнута підстановка").not.toMatch(
      /\{\{/,
    );
  });

  test("обидві дії лишились: кнопка на мапу і лист", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator('main a[href="/map"]')).toHaveText(
      "Open the campsite map",
    );
    const mail = page.locator('main a[href^="mailto:"]');
    await expect(mail).toHaveCount(1);
    await expect(mail).toHaveText("Or write to us");
  });
});
