import { expect, test } from "@playwright/test";
import {
  HOME_SECTIONS,
  HOME_SLOTS,
  assertHomeSectionsUsed,
  findSection,
  missingHomeSections,
  sectionBySlot,
} from "@/lib/home-sections";
import type { SectionView } from "@/lib/page-content";

// CAMP-365 п.3 — «порожнє поле в CMS не має ламати сторінку».
//
// 🔴 До цього `sectionOf` кидав виняток на нулі секцій: власник видаляв
// блок у Студії — і головна переставала збиратись. А з увімкненим ISR
// це було б ще й МОВЧКИ: Next лишає попередню справну сторінку, тож
// читач нічого не бачить, власник вважає, що зберіг, і не каже ніхто.

const s = (type: string, slot: string | null = null): SectionView => ({
  type, variant: null, slot, heading: null, subheading: null, body: null,
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

  test("порожній перелік — названі і типи, і слоти", () => {
    expect(missingHomeSections([])).toEqual([
      ...HOME_SECTIONS,
      ...HOME_SLOTS.map((x) => `слот:${x}`),
    ]);
  });

  const full = () => [
    s("hero"), s("steps"),
    s("prose", "stay"), s("prose", "drive"), s("prose", "notable"),
  ];

  test("усі на місці — скаржитись нема на що", () => {
    expect(missingHomeSections(full())).toEqual([]);
  });

  test("бракує однієї — названо саме її", () => {
    expect(missingHomeSections(full().filter((x) => x.type !== "hero")))
      .toEqual(["hero"]);
  });

  // ── слоти ──────────────────────────────────────────────────────────
  //
  // 🔴 ТРИ СЕКЦІЇ ОДНОГО ТИПУ `prose` — САМЕ ТОМУ ПОТРІБЕН СЛОТ. Типом
  // вони не розрізняються взагалі, а `variant` уже зайнятий виглядом.
  test("слот знаходить потрібну з трьох однотипних", () => {
    expect(sectionBySlot(full(), "drive")?.slot).toBe("drive");
  });

  test("слота немає — `null`", () => {
    expect(sectionBySlot([s("prose", "stay")], "drive")).toBeNull();
  });

  test("два однакові слоти — теж `null`, а не перший-ліпший", () => {
    expect(sectionBySlot([s("prose", "stay"), s("prose", "stay")], "stay")).toBeNull();
  });

  test("бракує слота — названо «слот:назва»", () => {
    expect(missingHomeSections(full().filter((x) => x.slot !== "drive")))
      .toEqual(["слот:drive"]);
  });

  // 🔴 Сторож зайвих секцій мусить знати про слоти, інакше три `prose`
  // валили б сторінку з «нікуди не малюються».
  test("сторож зайвих не лається на слоти", () => {
    expect(() => assertHomeSectionsUsed(full())).not.toThrow();
  });

  test("…але справді зайву секцію й далі ловить", () => {
    expect(() => assertHomeSectionsUsed([...full(), s("cta")])).toThrow(/cta/);
  });
});
