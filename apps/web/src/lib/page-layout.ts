import type { SectionView } from "./page-content";

/**
 * Розкладка секцій сторінки по назвах місць (`slot`) — CAMP-464.
 *
 * Сторінка «Контакти» у теми ділиться на дві колонки: вступ і картки
 * ліворуч, картка праворуч. Порядок секцій у базі (`sort`) цього не каже —
 * він лінійний. Місце секції каже `slot`, і сторінка вирішує, що з ним
 * робити.
 *
 * 🔴 СЕКЦІЯ З НЕВІДОМИМ МІСЦЕМ КИДАЄ, А НЕ ЗНИКАЄ. Та сама асиметрія, що
 * заміряна на головній (`assertAllSectionsUsed`): СХОВАТИ секцію —
 * сторінка падає, ДОДАТИ в місце, якого макет не знає, — тиша. Власник
 * додасть секцію в адмінці, не побачить її на сайті й вирішить, що
 * зламалась CMS.
 *
 * Секції БЕЗ місця (`null`) — це «решта»: вони йдуть під колонками на
 * всю ширину в порядку бази.
 */
export function sectionsBySlot<S extends string>(
  sections: readonly SectionView[],
  slots: readonly S[],
  where: string,
): { bySlot: Record<S, SectionView[]>; rest: SectionView[] } {
  const bySlot = Object.fromEntries(slots.map((s) => [s, []])) as unknown as Record<
    S,
    SectionView[]
  >;
  const rest: SectionView[] = [];
  for (const section of sections) {
    if (section.slot === null) {
      rest.push(section);
      continue;
    }
    if (!(slots as readonly string[]).includes(section.slot)) {
      throw new Error(
        `page-layout: ${where} — секція «${section.type}» стоїть у місці ` +
          `«${section.slot}», якого макет не має. Відомі: ${slots.join(", ")}. ` +
          "Мовчки вона не зникне: або виправте місце, або додайте його в макет.",
      );
    }
    bySlot[section.slot as S].push(section);
  }
  return { bySlot, rest };
}
