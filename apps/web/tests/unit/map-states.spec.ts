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
    const kinds = [...union.matchAll(/kind:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(kinds.length, "у джерелі не знайдено жодного стану").toBeGreaterThan(
      0,
    );
    expect([...MAP_STATES].sort()).toEqual([...new Set(kinds)].sort());
  });

  test("«намальовано» це підмножина станів, і без loading та failed", () => {
    for (const s of MAP_DRAWN) expect(MAP_STATES).toContain(s);
    expect(MAP_DRAWN).not.toContain("loading");
    expect(MAP_DRAWN).not.toContain("failed");
  });
});
