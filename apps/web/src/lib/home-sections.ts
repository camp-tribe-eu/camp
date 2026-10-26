import type { SectionView } from "@/lib/page-content";

// CAMP-365 — ОДИН перелік секцій головної на весь код.
//
// 🔴 ЧОМУ НЕ ДВА. Його читає і сама сторінка (`app/page.tsx`), і мітка
// стану (`app/internal/content-stamp`), яка доповідає, чого бракує. Два
// переліки розійшлися б мовчки, і розійшовся б саме той, якого ніхто не
// читає: сторінка малювала б без блоку, а сторож казав би «все на місці».
export const HOME_SECTIONS = ["hero", "steps"] as const;
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
export function missingHomeSections(sections: SectionView[]): HomeSection[] {
  return HOME_SECTIONS.filter((t) => findSection(sections, t) === null);
}
