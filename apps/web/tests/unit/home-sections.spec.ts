import { expect, test } from "@playwright/test";
import { HOME_SECTIONS, findSection, missingHomeSections } from "@/lib/home-sections";
import type { SectionView } from "@/lib/page-content";

// CAMP-365 п.3 — «порожнє поле в CMS не має ламати сторінку».
//
// 🔴 До цього `sectionOf` кидав виняток на нулі секцій: власник видаляв
// блок у Студії — і головна переставала збиратись. А з увімкненим ISR
// це було б ще й МОВЧКИ: Next лишає попередню справну сторінку, тож
// читач нічого не бачить, власник вважає, що зберіг, і не каже ніхто.

const s = (type: string): SectionView => ({
  type, variant: null, heading: null, subheading: null, body: null,
  imageUrl: null, imageAlt: null, ctaHref: null, ctaLabel: null, items: null,
});

test.describe("секції головної", () => {
  test("знаходить секцію, коли вона рівно одна", () => {
    expect(findSection([s("hero"), s("steps")], "hero")?.type).toBe("hero");
  });

  test("немає секції — `null`, а не виняток", () => {
    expect(() => findSection([s("steps")], "hero")).not.toThrow();
    expect(findSection([s("steps")], "hero")).toBeNull();
  });

  // 🔴 ДВІ СЕКЦІЇ ОДНОГО ТИПУ — ТЕЖ `null`, І ЦЕ НАВМИСНО. Малювати
  // першу-ліпшу означало б тихо обрати за власника; нехай краще блок
  // зникне й сторож про це скаже.
  test("дві секції одного типу — теж `null`", () => {
    expect(findSection([s("hero"), s("hero")], "hero")).toBeNull();
  });

  test("порожній перелік — усі очікувані названі як відсутні", () => {
    expect(missingHomeSections([])).toEqual([...HOME_SECTIONS]);
  });

  test("усі на місці — скаржитись нема на що", () => {
    expect(missingHomeSections([s("hero"), s("steps")])).toEqual([]);
  });

  test("бракує однієї — названо саме її", () => {
    expect(missingHomeSections([s("steps")])).toEqual(["hero"]);
  });
});
