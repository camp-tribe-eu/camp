import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { MAP_DRAWN, MAP_STATES } from "../map-ready";

// CAMP-382 — перелік станів мапи мусить дорівнювати тому, що в коді.
//
// 🔴 Інакше це «новий побратим не вступає в інвентар сторожа»: хтось
// додасть пʼятий стан у `MapDataState`, чекання його не знатиме, і тест
// або впаде на рівному місці, або — гірше — пропустить стан, у якому
// картинка ще не стала.

test.describe("стани мапи", () => {
  const source = () =>
    readFileSync(
      join(__dirname, "../../src/lib/map-chunks.ts"),
      "utf8",
    );

  test("перелік збігається з MapDataState у джерелі", () => {
    const src = source();
    const union = src.slice(
      src.indexOf("export type MapDataState"),
      src.indexOf("export function dataMessage"),
    );
    // 🔴 `[^']+`, А НЕ `[a-z]+`. Заміряно рецензією #313: при `[a-z]+`
    // пʼятий стан `tooWide` або `too-wide` входив у джерело й лишав цей
    // тест ЗЕЛЕНИМ (2 passed) — тобто сторож пропускав рівно те, заради
    // чого існує, якщо хтось назве стан не самими малими літерами.
    const kinds = [...union.matchAll(/kind:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(kinds.length, "у джерелі не знайдено жодного стану").toBeGreaterThan(
      0,
    );
    expect([...MAP_STATES].sort()).toEqual([...new Set(kinds)].sort());
  });

  // 🔴 ПОРОЖНІЙ ПЕРЕЛІК ПРОХОДИВ ОБИДВА ТВЕРДЖЕННЯ. Заміряно рецензією
  // #313: `MAP_DRAWN = []` давало 2 passed — цикл по порожньому не
  // виконується, і два `not.toContain` на порожньому істинні. А саме ця
  // мутація найгірша: `want.includes(v)` не істинне ніколи, тож КОЖЕН
  // тест мапи згорає до таймауту. Сторож був зелений за побудовою.
  test("«намальовано» не порожнє", () => {
    expect(MAP_DRAWN.length).toBeGreaterThan(0);
  });

  // 🔴 І кожен стан, який НЕ loading і НЕ failed, мусить бути тут.
  // Інакше пʼятий стан зʼявиться в коді, пройде сторож вище — і мовчки
  // випаде з очікування, тобто чекання на нього висітиме весь бюджет.
  test("«намальовано» це рівно ті стани, що не loading і не failed", () => {
    const expected = MAP_STATES.filter(
      (s) => s !== "loading" && s !== "failed",
    );
    expect([...MAP_DRAWN].sort()).toEqual([...expected].sort());
  });
});
