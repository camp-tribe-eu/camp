/**
 * 🔴 CAMP-447. Ширину СТОРІНКИ в 149 місцях задавала читальна колонка
 * (`max-w-prose`, 61ch ≈ 560px) — проти 40 вживань контейнера `max-w-wrap`.
 * Звідси «текст не на всю ширину» на знімках ревю власника CAMP-441…445.
 *
 * Тут перевіряється причина, а не наслідок: ширина мусить бути НАЗВАНА, а не
 * дістатись за замовчуванням. Саме мовчазне замовчування і розповзлося:
 * 105 вживань 01.10.2026 → 149 на 08.11.2026.
 *
 * Дивимось на класи, а не на пікселі: пікселі дає CSS-токен
 * `--container-wrap: 1704px`, і його значення взяте з теми
 * (`--global-container-width` демо-стору), а не вигадане тут.
 */
import { expect, test } from "@playwright/test";

import { Block, PageShell } from "@/components/layout";
import { renderComponent } from "./render-component";

test("PageShell дає контейнер, бічні поля і вертикальний ритм", () => {
  const html = renderComponent(PageShell, { children: "вміст" });
  for (const cls of ["mx-auto", "max-w-wrap", "px-4", "xl:px-6", "py-10"]) {
    expect(html, `бракує ${cls}`).toContain(cls);
  }
  expect(html).toContain("<main");
});

test("🔴 PageShell НЕ дає читальної колонки — саме це й було дефектом", () => {
  const html = renderComponent(PageShell, { children: "вміст" });
  expect(html).not.toContain("max-w-prose");
});

test("ритм перемикається, а не переписується руками в кожній сторінці", () => {
  // Рядок `mx-auto max-w-wrap px-4 py-N xl:px-6` був скопійований 33 рази,
  // і різнився в них лише вертикальний відступ.
  expect(renderComponent(PageShell, { children: "x", rhythm: "tight" }))
    .toContain("py-8");
  expect(renderComponent(PageShell, { children: "x", rhythm: "loose" }))
    .toContain("py-12");
});

test("Block: wide займає всю ширину і НЕ центрує", () => {
  const html = renderComponent(Block, { children: "x", measure: "wide" });
  expect(html).toContain("w-full");
  // Центрування — ознака вузького блока. Широкий, що центрується, лишив би
  // поля там, де мав бути контент.
  expect(html).not.toContain("mx-auto");
});

test("Block: read обмежує рядок, бо довгий рядок не читається", () => {
  const html = renderComponent(Block, { children: "x", measure: "read" });
  expect(html).toContain("max-w-read");
});

test("🔴 Block: read ЦЕНТРУЄТЬСЯ — текст не липне до лівого краю", () => {
  // Власник обводив червоним не вузький текст, а ПОРОЖНЕЧУ ПРАВОРУЧ від
  // нього: знімки 443/17, 443/18, 443/20, 441/72. Його правило: «якщо
  // контенту не на всю ширину то просто табличку вузьку ставимо по центру».
  //
  // Без цього тесту міграція 149 місць була б симетричною: сторож зеленіє на
  // нулі `max-w-prose`, а сторінка лишається рівно такою, як на знімках.
  const html = renderComponent(Block, { children: "x", measure: "read" });
  expect(html).toContain("mx-auto");
});

test("🔴 Block: narrow стоїть ПО ЦЕНТРУ, а не липне до лівого краю", () => {
  // Слова власника: «якщо контенту не на всю ширину то просто табличку вузьку
  // ставимо по центру і воно класно і гармонійно».
  const html = renderComponent(Block, { children: "x", measure: "narrow" });
  expect(html).toContain("max-w-narrow");
  expect(html).toContain("mx-auto");
});

test("жоден варіант Block не вживає max-w-prose", () => {
  for (const measure of ["wide", "read", "narrow"] as const) {
    const html = renderComponent(Block, { children: "x", measure });
    expect(html, `варіант ${measure}`).not.toContain("max-w-prose");
  }
});

test("три варіанти дають три РІЗНІ ширини, а не один клас під трьома іменами", () => {
  // Без цього можна було б звести всі три до одного й лишити тести зеленими.
  const of = (measure: "wide" | "read" | "narrow") =>
    renderComponent(Block, { children: "x", measure });
  const widths = new Set([of("wide"), of("read"), of("narrow")]);
  expect(widths.size).toBe(3);
});
