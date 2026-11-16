import { expect, test } from "@playwright/test";
import {
  HOME_REPEATED,
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
    expect(findSection([s("search"), s("steps")], "steps")?.type).toBe("steps");
  });

  test("немає секції — `null`, а не виняток", () => {
    expect(() => findSection([s("steps")], "search")).not.toThrow();
    expect(findSection([s("steps")], "search")).toBeNull();
  });

  // 🔴 ДВІ СЕКЦІЇ ОДНОГО ТИПУ — ТЕЖ `null`, І ЦЕ НАВМИСНО. Малювати
  // першу-ліпшу означало б тихо обрати за власника; нехай краще блок
  // зникне й сторож про це скаже.
  test("дві секції одного типу — теж `null`", () => {
    expect(findSection([s("steps"), s("steps")], "steps")).toBeNull();
  });

  test("порожній перелік — названі і типи, і слоти", () => {
    expect(missingHomeSections([])).toEqual([
      ...HOME_SECTIONS,
      ...HOME_REPEATED,
      ...HOME_SLOTS.map((x) => `слот:${x}`),
    ]);
  });

  const full = () => [
    s("steps"), s("search"),
    s("slide"), s("slide"), s("slide"),
    s("image-text"), s("image-text"),
    s("prose", "stay"), s("prose", "drive"), s("cards", "drive-links"),
    s("prose", "notable"),
  ];

  test("усі на місці — скаржитись нема на що", () => {
    expect(missingHomeSections(full())).toEqual([]);
  });

  // 🔴 CAMP-488: слайди й рядки з фото — «один або більше», а не «рівно
  // один». Два слайди не роблять секцію «відсутньою» (на відміну від двох
  // `hero`), а нуль — роблять, і про нуль сторож каже поіменно.
  test("кілька слайдів — норма; жодного — названо", () => {
    expect(missingHomeSections(full())).toEqual([]);
    expect(missingHomeSections(full().filter((x) => x.type !== "slide")))
      .toEqual(["slide"]);
    expect(missingHomeSections(full().filter((x) => x.type !== "image-text")))
      .toEqual(["image-text"]);
  });

  test("пошуку немає — названо `search`", () => {
    expect(missingHomeSections(full().filter((x) => x.type !== "search")))
      .toEqual(["search"]);
  });

  test("слайди й рядки з фото не вважаються зайвими", () => {
    expect(() => assertHomeSectionsUsed(full())).not.toThrow();
  });

  test("бракує однієї — названо саме її", () => {
    expect(missingHomeSections(full().filter((x) => x.type !== "steps")))
      .toEqual(["steps"]);
  });

  // 🔴 Старий блок h1 + вступ прибрано з головної. База, яку ще не
  // мігрували, віддасть його й далі: сторінка не падає і не вважає його
  // відсутнім; перелік очікуваного його НЕ містить.
  test("🔴 `hero` не очікується, а якщо база його віддала — не валить сторінку", () => {
    expect([...HOME_SECTIONS]).not.toContain("hero");
    expect(missingHomeSections(full())).toEqual([]);
    expect(() => assertHomeSectionsUsed([...full(), s("hero")])).not.toThrow();
    // …а справді зайва секція й далі ловиться.
    expect(() => assertHomeSectionsUsed([...full(), s("faq")])).toThrow();
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
