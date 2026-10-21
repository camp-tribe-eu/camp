import { expect, test } from "@playwright/test";
import { describeViolations } from "../e2e/axe";

// 🔴 CAMP-334 — повідомлення про порушення мусить називати ВУЗОЛ.
//
// 21.10.2026 axe на webkit дав порушення чотири рази за добу, і щоразу
// в звіті лишалось «color-contrast: Elements must meet minimum color
// contrast ratio» — правило назване, елемент ні. Відтворювати не було
// чого: чотири однакові рядки не кажуть, чи це той самий вузол.
//
// Пʼять місць будували огляд окремо, і чотири з них викидали `nodes`.
test.describe("🔴 повідомлення axe називає елемент", () => {
  const violation = {
    id: "color-contrast",
    help: "Elements must meet minimum color contrast ratio thresholds",
    nodes: [{ target: [".footer > a"] }, { target: ["#hint"] }],
  };

  test("рядок несе правило, пояснення і ЦІЛІ", () => {
    const [line] = describeViolations([violation]);
    expect(line).toContain("color-contrast");
    expect(line, "елемент не названий — відтворювати нема чого").toContain(
      ".footer > a",
    );
    expect(line, "другий вузол загубився").toContain("#hint");
  });

  // 🔴 Пара: без неї «містить селектор» було б істинним і для функції,
  // що завжди повертає один і той самий рядок.
  test("порожній перелік дає порожній результат", () => {
    expect(describeViolations([])).toEqual([]);
  });

  test("вузол зі складеною ціллю (iframe) не губить жодної частини", () => {
    const [line] = describeViolations([
      { ...violation, nodes: [{ target: ["#frame", "button.x"] }] },
    ]);
    expect(line).toContain("#frame button.x");
  });
});
