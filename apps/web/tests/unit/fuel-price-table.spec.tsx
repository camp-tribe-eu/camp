import { expect, test } from "@playwright/test";
import FuelPriceTable from "@/components/fuel-price-table";
import { ranked } from "@/lib/fuel";
import { flagSrc, hasFlag } from "@/lib/eu-countries";
import { renderComponent } from "./render-component";

// 🔴 CAMP-458 (ревʼю 443/8): у таблиці цін — прапор ліворуч від кожної
// країни, як у плитках. Знаменник — кожен рядок, а не «хоч один прапор».
test("every country row carries its own flag, before the name", () => {
  const html = renderComponent(FuelPriceTable, {});
  const rows = [...html.matchAll(/<tr data-country="([A-Z]{2})"[^>]*>([\s\S]*?)<\/tr>/g)];
  const codes = ranked("diesel").map((c) => c.code);
  expect(rows.map((r) => r[1])).toEqual(codes);
  for (const [, code, body] of rows) {
    const cell = body.slice(0, body.indexOf("</th>"));
    if (hasFlag(code)) {
      expect(cell, `${code}: no flag`).toContain(`src="${flagSrc(code)}"`);
      // ліворуч від назви: картинка раніше за посилання
      expect(cell.indexOf("<img"), `${code}: flag after the name`).toBeLessThan(
        cell.indexOf("<a"),
      );
      expect(cell).toContain('alt=""');
    }
  }
  expect(rows.length).toBeGreaterThanOrEqual(26);
});
