import { expect, test } from "./api-request";

/**
 * CAMP-522 — `/internal/data-quality` на живій парі «сайт + API».
 *
 * 🔴 ЩО ЦЕ ДОВОДИТЬ ПОНАД ЮНІТ. Юніт рендерить звіт, написаний рукою.
 * Тут звіт віддає справжній API зі справжньої бази, а тест читає ДВА
 * незалежні свідчення — відповідь `/ops/data-quality` і HTML сторінки —
 * і звіряє їх рядок у рядок: число, знаменник і запит. Якщо сторінка
 * загубить рядок, переставить числа або покаже не той запит, вони
 * розійдуться.
 *
 * 🔴 ОБИДВІ ГІЛКИ ЩОСЬ СТВЕРДЖУЮТЬ. API відповідає лише на токен збірки.
 * Де токена немає, сторінка МУСИТЬ сказати «No measurement to show» і не
 * намалювати жодного числа — це не пропуск тесту, а друга половина
 * договору: порожнє не малюємо.
 */

const API = process.env.API_BASE_URL ?? "http://localhost:3001";

type Line = { key: string; label: string | null; n: number; of: number; sql: string };

const en = (n: number) => n.toLocaleString("en-GB");

test.describe("🔴 CAMP-522 — звіт про якість даних", () => {
  test("кожне число на сторінці — те, що віддав API, і поруч стоїть його запит", async ({
    page,
    request,
  }) => {
    const api = await request.get(`${API}/ops/data-quality`);
    const response = await page.goto("/internal/data-quality");
    expect(response?.status(), "сторінка не віддалась").toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Data quality");

    if (api.status() !== 200) {
      // Токена немає або API відмовив: причина словами, чисел нуль.
      await expect(page.getByTestId("data-quality-unavailable")).toContainText(
        "No measurement to show.",
      );
      await expect(page.locator("[data-part='line']")).toHaveCount(0);
      await expect(page.locator("[data-part='query']")).toHaveCount(0);
      return;
    }

    const report = (await api.json()) as { lines: Line[]; failures: unknown[] };
    expect(report.lines.length, "API віддав звіт без жодного рядка").toBeGreaterThan(0);
    expect(report.failures, "на цій базі якась міра впала").toEqual([]);

    // 🔴 РЯДКІВ РІВНО СТІЛЬКИ Ж. Перевірка «кожен рядок API є на
    // сторінці» сама не бачить зайвого рядка; лічильник бачить.
    await expect(page.locator("tr[data-part='line']")).toHaveCount(report.lines.length);

    const keys = [...new Set(report.lines.map((l) => l.key))];
    await expect(page.locator("article[data-measure]")).toHaveCount(keys.length);

    for (const key of keys) {
      const block = page.locator(`article[data-measure='${key}']`);
      const lines = report.lines.filter((l) => l.key === key);
      // запит — дослівно той, що виконав API, і один на блок
      await expect(block.locator("[data-part='query']")).toHaveCount(1);
      await expect(block.locator("[data-part='query']")).toHaveText(lines[0].sql);
      const rows = block.locator("tr[data-part='line']");
      await expect(rows).toHaveCount(lines.length);
      for (const [i, line] of lines.entries()) {
        const row = rows.nth(i);
        await expect(row.locator("[data-part='n']")).toHaveText(en(line.n));
        await expect(row.locator("[data-part='of']")).toHaveText(`of ${en(line.of)}`);
        if (line.label !== null) {
          await expect(row.locator("[data-part='label']")).toHaveText(line.label);
        }
        const share = row.locator("[data-part='share']");
        if (line.of === 0) await expect(share).toHaveText("nothing to divide by");
        else await expect(share).toHaveText(/^\d{1,3}\.\d%$/);
      }
    }
  });

  test("🔴 без токена збірки API звіту не віддає", async ({ playwright }) => {
    // Власний контекст БЕЗ заголовка: фікстура `request` його додає.
    const anonymous = await playwright.request.newContext();
    try {
      const res = await anonymous.get(`${API}/ops/data-quality`);
      expect(res.status()).toBe(404);
    } finally {
      await anonymous.dispose();
    }
  });

  test("сторінки немає в карті сайту", async ({ request }) => {
    const index = await request.get("/sitemap.xml");
    expect(index.status()).toBe(200);
    expect(await index.text()).not.toContain("/internal/");
  });
});
