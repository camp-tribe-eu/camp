import { expect, test } from "@playwright/test";
import {
  BUDGET_FIXED_MS,
  BUDGET_PER_FACET_MS,
  facetBudgetMs,
} from "../e2e/guides-budget";

// CAMP-334 — сторож на ФОРМУЛУ бюджету.
//
// 🔴 Тут навмисно НЕ переказується означення. `expect(facetBudgetMs(31))
// .toBe(20000 + 900*31)` було б зеленим і тоді, коли формула стала
// константою з тим самим значенням у точці 31. Перевіряються
// властивості, яких константа задовольнити не може.

test.describe("бюджет обходу фасетів", () => {
  test("🔴 строго зростає — константа тут і була дефектом", () => {
    const n = [0, 1, 10, 31, 62, 300];
    for (let i = 1; i < n.length; i++) {
      expect(
        facetBudgetMs(n[i]),
        `бюджет на ${n[i]} фасетів не більший, ніж на ${n[i - 1]}`,
      ).toBeGreaterThan(facetBudgetMs(n[i - 1]));
    }
  });

  // 🔴 Головна властивість: подвоєння каталогу мусить подвоїти ЗМІННУ
  // частину бюджету. Формула, що додає сталий доважок (наприклад
  // `+1000` замість `*n`), пройшла б перевірку зростання вище.
  test("змінна частина росте разом із кількістю, а не поруч із нею", () => {
    const varPart = (n: number) => facetBudgetMs(n) - facetBudgetMs(0);
    expect(varPart(62)).toBe(2 * varPart(31));
    expect(varPart(93)).toBe(3 * varPart(31));
  });

  test("на нулі фасетів лишається сталий запас на старт", () => {
    expect(facetBudgetMs(0)).toBe(BUDGET_FIXED_MS);
  });

  // 🔴 Запас на фасет мусить бути в РАЗИ більшим за заміряну вартість.
  // Заміряно 21.10.2026 на зібраному сайті — число в описі PR; тут
  // стоїть нижня межа, нижче якої бюджет перестає бути запасом.
  test("на фасет закладено щонайменше 500 мс", () => {
    expect(BUDGET_PER_FACET_MS).toBeGreaterThanOrEqual(500);
  });

  test("нецілі й відʼємні значення падають гучно", () => {
    expect(() => facetBudgetMs(-1)).toThrow(/ціле ≥ 0/);
    expect(() => facetBudgetMs(1.5)).toThrow(/ціле ≥ 0/);
  });
});
