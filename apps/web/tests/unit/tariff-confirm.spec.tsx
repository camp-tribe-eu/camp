import { expect, test } from "@playwright/test";
import TariffTable from "@/components/tariff-table";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";

// 🔴 Вимога власника 20.11.2026: «уточнюйте ціну в провайдера в день
// бронювання» — видимим текстом поруч із ціною, а не лише в спливному
// блоці; і дата джерела поруч.
test("the confirm-on-booking-day line is visible, outside the popover, with the source date", () => {
  const html = renderComponent(TariffTable, {
    tariffs: [
      {
        offer: null, mode: "Overnight", policy: null,
        minPrice: "25.00", maxPrice: null, currency: "EUR",
        validFrom: "2026-04-01", validUntil: "2026-10-31",
        label: null, labelLang: null,
        sourceUpdatedAt: "2026-11-12", sourceId: "datatourisme",
      },
    ],
    now: new Date("2026-06-01"),
  });
  const line = /<p\b[^>]*data-testid="tariffs-confirm"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  expect(line, "no visible confirm line").not.toBeNull();
  expect(visibleText(line![1])).toContain("Confirm the price with the campsite on the day you book");
  // не всередині popover
  const popover = /<div\b[^>]*popover="auto"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
  expect(popover).not.toContain("tariffs-confirm");
  expect(html).toContain('data-testid="tariffs-source-date"');
});
