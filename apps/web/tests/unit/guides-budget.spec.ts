import { expect, test } from "@playwright/test";
import {
  BUDGET_PER_FACET_MS,
  MEASURED_MS_PER_FACET,
  facetBudgetExtraMs,
} from "../e2e/guides-budget";

// CAMP-334 — сторож на ФОРМУЛУ додатку до бюджету.
//
// 🔴 ЦЕЙ НАБІР ПЕРЕПИСАНО ПІСЛЯ РЕЦЕНЗІЇ #312, І ОСЬ ЧОМУ.
//
// Перша редакція перевіряла лише МАСШТАБО-ІНВАРІАНТНІ властивості:
// «строго зростає» і «varPart(62) === 2 * varPart(31)». Обидві
// виконуються для БУДЬ-ЯКОЇ лінійної функції, хоч із нахилом 1 мс на
// фасет. А єдине абсолютне твердження міряло КОНСТАНТУ
// `BUDGET_PER_FACET_MS`, а не те, що віддає функція.
//
// Заміряно рецензією: мутація `(BUDGET_PER_FACET_MS * n) / 250` лишала
// всі 5 випадків ЗЕЛЕНИМИ й давала на 31 фасеті 31 мс додатку — тобто
// рівно ту сталу межу, заради скасування якої цей PR існує.
//
// 🔴 І ще один урок: у попередньому звіті я назвав числа 3/3/4/4 як
// «спіймано», а це були PASSED. Спіймано було 2/2/1/1 із пʼяти, і один
// клас мутацій — «міняю тіло функції, констант не чіпаю» — не пробували
// взагалі. Тепер запас ведеться ЧЕРЕЗ функцію.

test.describe("додаток до бюджету за фасети", () => {
  test("на нулі фасетів додатку немає", () => {
    expect(facetBudgetExtraMs(0)).toBe(0);
  });

  test("строго зростає", () => {
    const n = [0, 1, 10, 31, 62, 300];
    for (let i = 1; i < n.length; i++) {
      expect(
        facetBudgetExtraMs(n[i]),
        `додаток на ${n[i]} не більший, ніж на ${n[i - 1]}`,
      ).toBeGreaterThan(facetBudgetExtraMs(n[i - 1]));
    }
  });

  // 🔴 ГОЛОВНЕ ТВЕРДЖЕННЯ: запас міряється ЧЕРЕЗ функцію, а не через
  // константу. Саме це ловить зміну нахилу всередині тіла.
  test("на кожному n додаток щонайменше вп'ятдесятеро більший за заміряне", () => {
    for (const n of [1, 5, 31, 62, 300]) {
      expect(
        facetBudgetExtraMs(n),
        `на ${n} фасетах додаток ${facetBudgetExtraMs(n)} мс — це менше за ` +
          `пʼятдесятикратний запас від заміряних ${MEASURED_MS_PER_FACET} мс/фасет`,
      ).toBeGreaterThanOrEqual(50 * MEASURED_MS_PER_FACET * n);
    }
  });

  // 🔴 І стеля теж: нескінченний запас це не запас, а відсутність межі.
  // Без неї мутація «помножити на 1000» пройшла б як «ще безпечніше».
  test("і не більший за тисячократний — інакше межі немає зовсім", () => {
    for (const n of [1, 31, 300]) {
      expect(facetBudgetExtraMs(n)).toBeLessThanOrEqual(
        1000 * MEASURED_MS_PER_FACET * n,
      );
    }
  });

  test("подвоєння каталогу подвоює додаток", () => {
    expect(facetBudgetExtraMs(62)).toBe(2 * facetBudgetExtraMs(31));
    expect(facetBudgetExtraMs(93)).toBe(3 * facetBudgetExtraMs(31));
  });

  test("константа на фасет лишається тим, чим її оголосили", () => {
    expect(facetBudgetExtraMs(1)).toBe(BUDGET_PER_FACET_MS);
  });

  test("нецілі й відʼємні значення падають гучно", () => {
    expect(() => facetBudgetExtraMs(-1)).toThrow(/ціле ≥ 0/);
    expect(() => facetBudgetExtraMs(1.5)).toThrow(/ціле ≥ 0/);
  });
});
