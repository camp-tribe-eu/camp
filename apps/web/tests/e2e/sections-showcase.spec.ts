import { expect, test } from "./api-request";

/**
 * CAMP-449 — вітрина каталогу секцій, `/internal/sections`.
 *
 * 🔴 ЗНІМОК БЕЗ ЦЬОГО ТЕСТУ БУВ БИ СЛІПИЙ НА НАЙГІРШЕ. Якщо секція
 * перестане рендеритись зовсім, сторінка стане коротшою — і візуальний
 * тест почервоніє смугою пікселів, де з діфа не видно, ЯКА саме зникла.
 * Тут кожна полиця названа, тож падає рядок із її номером.
 *
 * 🔴 І ОКРЕМО — ЗАКРИТІСТЬ. Сторінка службова; якщо з неї колись знімуть
 * `noindex`, вона почне ранжуватись зі зразковими числами в тексті. Це
 * перевіряється тут, а не покладається на памʼять.
 */

const SHELVES = [
  { n: 1, name: "Layered banner" },
  { n: 2, name: "Ticker row" },
  { n: 3, name: "Two banners side by side" },
  { n: 4, name: "Image with text, alternating" },
  { n: 5, name: "Icon, title, text in a row" },
  { n: 8, name: "FAQ accordion" },
  { n: 11, name: "Box banner" },
];

test.describe("🔴 CAMP-449 — вітрина секцій", () => {
  test("кожна полиця на місці й підписана", async ({ page }) => {
    await page.goto("/internal/sections");

    // Щоб порожня сторінка не пройшла за «усі на місці».
    await expect(
      page.locator("[data-testid^='shelf-']"),
      "полиць не стільки, скільки секцій у каталозі",
    ).toHaveCount(SHELVES.length);

    for (const shelf of SHELVES) {
      const block = page.locator(`[data-testid='shelf-${shelf.n}']`);
      await expect(block, `полиця ${shelf.n} зникла`).toHaveCount(1);
      await expect(block.locator("h2")).toHaveText(
        `${shelf.n}. ${shelf.name}`,
      );
      // Полиця без секції всередині — це порожня рамка, тобто рівно те,
      // чого правило каталогу не дозволяє.
      await expect(
        block.locator("section, ul, ol, div").first(),
        `полиця ${shelf.n} порожня`,
      ).toBeVisible();
    }
  });

  test("🔴 чергування текст/фото показане обома боками", async ({ page }) => {
    await page.goto("/internal/sections");

    const rows = page.locator("[data-testid='shelf-4'] .ct-iwt");
    await expect(rows, "секції 4 немає або вона одна").toHaveCount(2);

    // Перша — фото ліворуч (класу перевороту немає), друга — праворуч.
    await expect(rows.nth(0)).not.toHaveClass(/ct-iwt--reverse/);
    await expect(rows.nth(1)).toHaveClass(/ct-iwt--reverse/);

    // І вони справді різної ширини — два варіанти теми, а не один двічі.
    await expect(rows.nth(0)).toHaveClass(/ct-iwt--w70/);
    await expect(rows.nth(1)).toHaveClass(/ct-iwt--w50/);
  });

  test("вітрина взагалі віддається", async ({ page }) => {
    const response = await page.goto("/internal/sections");
    expect(response?.status(), "вітрина не віддалась").toBe(200);
  });

  /**
   * 🔴 ЧОМУ `noindex` ПЕРЕВІРЯЄ НЕ ЦЕЙ ФАЙЛ, А ЮНІТ.
   *
   * Перша редакція читала `<meta name="robots">` просто тут. Воно було б
   * зеленим завжди й нічого не доводило: CI збирає ЗАКРИТУ збірку, де
   * `noindex` стоїть на кожній сторінці від кореневого layout. Тобто
   * тест пройшов би і тоді, коли сторінка не каже про себе нічого.
   * Декларацію самої сторінки звіряє `tests/unit/sections-showcase.spec.ts`.
   */
});
