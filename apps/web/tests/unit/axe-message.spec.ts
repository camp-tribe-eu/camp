import { expect, test } from "@playwright/test";
import { WCAG_TAGS, assertWcagTags, describeViolations } from "../e2e/axe";

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

// 🔴 D4 З РЕЦЕНЗІЇ #310: ПЕРЕЛІК ТЕГІВ — ЄДИНИЙ РЯДОК БЕЗ СТОРОЖА.
//
// Заміряно: `withTags(['wcag2aa1'])` — одна зайва літера — дає НУЛЬ
// порушень і жодної помилки на сторінці, де їх два. А `withTags([])`
// кидає гучно. Тобто порожній перелік безпечний, а друкарська помилка
// в назві тега мовчки осліплює ВСІ пʼять перевірок доступності
// одразу, бо тепер вони читають одне означення.
test.describe("🔴 перелік тегів WCAG", () => {
  test("рівно ті чотири, що вимагає CI", () => {
    expect([...WCAG_TAGS].sort()).toEqual([
      "wcag21a",
      "wcag21aa",
      "wcag2a",
      "wcag2aa",
    ]);
  });

  test("кожен тег має форму, яку axe розуміє", () => {
    expect(() => assertWcagTags(WCAG_TAGS)).not.toThrow();
  });

  // Сторож стоїть у ФУНКЦІЇ, бо виклик має обхід: drought-layer передає
  // свій перелік `['wcag2a','wcag2aa']`, і тест над константою його не
  // побачив би.
  test("друкарська помилка в тезі падає гучно, а не мовчки", () => {
    expect(() => assertWcagTags(["wcag2aa1"])).toThrow(/не є правилами WCAG/);
    expect(() => assertWcagTags(["wcag2a", "wcag2aa"])).not.toThrow();
  });

  test("порожній перелік теж падає", () => {
    expect(() => assertWcagTags([])).toThrow(/нічого не перевіряє/);
  });
});

// 🔴 D5: ВИЖИЛА МУТАЦІЯ. Прибрати `${v.help}` з повідомлення — і всі
// три випадки лишались зелені. А цей PR саме й замінив `v.description`
// на `v.help` у двох місцях: тобто змінив те, чого ніхто не тримає.
test.describe("🔴 повідомлення несе й ПОЯСНЕННЯ правила", () => {
  test("текст help присутній, а не лише id і вузол", () => {
    const [line] = describeViolations([
      {
        id: "color-contrast",
        help: "Elements must meet minimum color contrast ratio thresholds",
        nodes: [{ target: [".x"] }],
      },
    ]);
    expect(line, "пояснення правила зникло з повідомлення").toContain(
      "minimum color contrast ratio",
    );
  });
});
