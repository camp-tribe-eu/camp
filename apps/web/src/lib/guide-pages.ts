import { countryName } from "@/lib/api";
import { byTopic, type Topic } from "@/lib/guide-facets";

// CAMP-443/5, 443/6 — тематична сторінка гайдів, поділена на сторінки.
//
// 🔴 ЧОМУ ПАГІНАЦІЯ З ВЛАСНИМИ АДРЕСАМИ, А НЕ «LOAD MORE». «Load more»
// ховає гайди з 25-го за скриптом: пошуковик і читач без JS їх не
// побачать, а саме ці посилання тримають гайди досяжними з каталогу.
// Адреси `/guides/topic/water/page/2…` віддають посилання в HTML, як
// `/blog/page/[n]`. Заміряно 16.11.2026: «water» — 463 гайди, 30 364 px
// однієї сторінки; по 24 на сторінку це 20 сторінок.
//
// Сторінки 2+ у карту сайту НЕ йдуть: кожен гайд там уже є власним
// рядком (`lib/sitemap.ts`), а сторінка 12 переліку — не те, що має
// ранжуватись.

export const GUIDES_PER_PAGE = 24;

export const topicPagePath = (topic: Topic, n: number): string =>
  n <= 1 ? `/guides/topic/${topic}` : `/guides/topic/${topic}/page/${n}`;

export function guidePageCount(total: number): number {
  return Math.max(1, Math.ceil(total / GUIDES_PER_PAGE));
}

/** Номер сторінки з адреси: ціле від 2 (перша живе без суфікса). */
export function parseGuidePage(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 2 ? n : null;
}

/**
 * Гайди теми в порядку показу: країни за кількістю гайдів, далі за
 * абеткою, усередині країни — за назвою. Порядок повний, тож сторінки
 * не перетасовуються між збірками.
 */
export function orderedTopicGuides<
  T extends { slug: string; title: string; facets: { country: string } },
>(guides: readonly T[]): T[] {
  const size = new Map<string, number>();
  for (const g of guides)
    size.set(g.facets.country, (size.get(g.facets.country) ?? 0) + 1);
  return [...guides].sort(
    (a, b) =>
      (size.get(b.facets.country) ?? 0) - (size.get(a.facets.country) ?? 0) ||
      countryName(a.facets.country).localeCompare(
        countryName(b.facets.country),
      ) ||
      a.title.localeCompare(b.title) ||
      a.slug.localeCompare(b.slug),
  );
}

export function topicEntry<T extends { slug: string }>(
  guides: readonly T[],
  topic: Topic,
) {
  return byTopic(guides).find((t) => t.topic === topic);
}
