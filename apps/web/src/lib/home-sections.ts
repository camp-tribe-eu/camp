import type { SectionView } from "@/lib/page-content";
import { assertAllSectionsUsed } from "@/components/page-sections";

// CAMP-365 — ОДИН перелік секцій головної на весь код.
//
// 🔴 ЧОМУ НЕ ДВА. Його читає і сама сторінка (`app/page.tsx`), і мітка
// стану (`app/internal/content-stamp`), яка доповідає, чого бракує. Два
// переліки розійшлися б мовчки, і розійшовся б саме той, якого ніхто не
// читає: сторінка малювала б без блоку, а сторож казав би «все на місці».
export const HOME_SECTIONS = ["hero", "steps"] as const;

/**
 * Слоти головної: де блок стоїть, окремо від того, як виглядає.
 *
 * 🔴 ЧОМУ СЛОТ, А НЕ `variant`. `variant` уже вибирає СТИЛЬ прози
 * (`page-sections.tsx`), тож адресувати ним блоки означало б змішати
 * вигляд із призначенням — і наступна зміна стилю пересунула б блок.
 */
export const HOME_SLOTS = ["stay", "drive", "notable"] as const;
export type HomeSlot = (typeof HOME_SLOTS)[number];

/** Секція в названому слоті, або `null`. */
export function sectionBySlot(
  sections: SectionView[],
  slot: HomeSlot,
): SectionView | null {
  const found = sections.filter((s) => s.slot === slot);
  return found.length === 1 ? found[0] : null;
}

/** Яких слотів на сторінці немає. */
export function missingHomeSlots(sections: SectionView[]): HomeSlot[] {
  return HOME_SLOTS.filter((s) => sectionBySlot(sections, s) === null);
}
export type HomeSection = (typeof HOME_SECTIONS)[number];

/**
 * Секція даного типу, або `null`, якщо її немає.
 *
 * 🔴 `null`, А НЕ ВИНЯТОК, І ЦЕ ВИМОГА КАРТКИ. `sectionOf` кидає, коли
 * секцій не рівно одна, — тобто варто власникові видалити секцію в CMS,
 * і головна перестає збиратись. Картка каже прямо: «порожнє поле в CMS
 * не має ламати сторінку».
 *
 * 🔴 І найгірший бік того падіння — не воно саме, а тиша. З увімкненим
 * ISR Next при невдалій перегенерації лишає ПОПЕРЕДНЮ справну сторінку
 * (див. `lib/navigation.ts`): читач нічого не помітив би, власник зберіг
 * би зміну, сайт не оновився б, і не сказав би ніхто. Тому відсутність
 * тут не ковтається, а називається — див. `missingHomeSections`.
 */
export function findSection(
  sections: SectionView[],
  type: HomeSection,
): SectionView | null {
  const found = sections.filter((s) => s.type === type);
  return found.length === 1 ? found[0] : null;
}

/** Яких очікуваних секцій на сторінці немає. Порожньо — все на місці. */
export function missingHomeSections(sections: SectionView[]): string[] {
  return [
    ...HOME_SECTIONS.filter((t) => findSection(sections, t) === null),
    ...missingHomeSlots(sections).map((s) => `слот:${s}`),
  ];
}

/**
 * Те саме, що `assertAllSectionsUsed`, але зі знанням про слоти.
 *
 * 🔴 БЕЗ ЦЬОГО ТРИ НОВІ СЕКЦІЇ ВАЛИЛИ Б СТОРІНКУ. Вони всі типу `prose`,
 * а `assertAllSectionsUsed` звіряє САМЕ типи й кричить «секції «prose»
 * нікуди не малюються». Вони малюються — просто адресуються слотом.
 *
 * Секція зі слотом із `HOME_SLOTS` вважається вжитою; усе інше звіряється
 * типом, як і було. Тобто випадкова зайва секція й далі не зникає мовчки —
 * саме заради цього той сторож і стоїть.
 */
export function assertHomeSectionsUsed(sections: SectionView[]): void {
  const byType = sections.filter(
    (s) => !(s.slot !== null && (HOME_SLOTS as readonly string[]).includes(s.slot)),
  );
  assertAllSectionsUsed(byType, HOME_SECTIONS, "головна");
}
