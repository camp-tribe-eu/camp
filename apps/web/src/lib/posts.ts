import { apiFetch } from "./api";
import {
  PAGE_REVALIDATE_SECONDS,
  PAGE_TAG,
  applyValues,
  type PageView,
} from "./page-content";

// CAMP-364 — блог. Дописи живуть у тій самій таблиці, що й сторінки,
// і відрізняються лише `type`.
//
// 🔴 МІТКА РЕВАЛІДАЦІЇ ТА САМА, ЩО В СТОРІНОК, І ЦЕ НАВМИСНО. Власник
// редагує те й те в одній адмінці; окрема мітка означала б, що правка
// допису не скидає кеш, якщо вебхук надішле «pages», і навпаки. Одна
// мітка — один вебхук, який не можна налаштувати наполовину.

/** Рядок переліку, як його віддає API. */
export interface PostSummary {
  slug: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  authorName: string | null;
}

/**
 * Перелік дописів, найсвіжіший першим.
 *
 * 🔴 ПОРОЖНІЙ ПЕРЕЛІК — ЦЕ НЕ ПОМИЛКА. Блог може не мати жодного
 * допису, і сторінка мусить це сказати, а не впасти. А от НЕДОСЯЖНИЙ
 * API — помилка: мовчки віддати «дописів немає» означало б сказати
 * читачеві неправду й віддати пошуковику порожню сторінку.
 */
export async function postList(): Promise<PostSummary[]> {
  const res = await apiFetch("/posts", {
    next: { revalidate: PAGE_REVALIDATE_SECONDS, tags: [PAGE_TAG] },
  });
  if (!res.ok) {
    throw new Error(
      `перелік дописів недосяжний: GET /posts → ${res.status}. ` +
        "Порожній блог і зламаний блог — не те саме.",
    );
  }
  const body = (await res.json()) as { posts?: unknown };
  if (!Array.isArray(body.posts)) {
    throw new Error(
      "перелік дописів: у відповіді немає масиву `posts`, а " +
        `${body.posts === null ? "null" : typeof body.posts}.`,
    );
  }
  return body.posts as PostSummary[];
}

/** Допис, або `null`, якщо його немає. */
export async function postContent(slug: string): Promise<PageView | null> {
  const res = await apiFetch(`/posts/${encodeURIComponent(slug)}`, {
    next: { revalidate: PAGE_REVALIDATE_SECONDS, tags: [PAGE_TAG] },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `допис «${slug}» недосяжний: GET /posts/${slug} → ${res.status}.`,
    );
  }
  return applyValues((await res.json()) as PageView);
}

/**
 * Дата допису словами — та сама, що в `<time dateTime>`.
 *
 * 🔴 ЛОКАЛЬ І ПОЯС — ОБИДВА НАЗВАНІ, І ДРУГОГО Я СПЕРШУ НЕ НАЗВАВ.
 *
 * Перша редакція фіксувала лише локаль, а коментар оголошував клас
 * дефекту закритим. Рецензія #308 заміряла, що закрито половину:
 * `2026-10-01T23:30:00.000Z` давало «1 October 2026» при `TZ=UTC` і
 * «2 October 2026» при `TZ=Europe/Brussels` — а це пояс машини
 * власника. При цьому `<time dateTime>` і `datePublished` у JSON-LD
 * кажуть UTC, і `lastmod` у карті сайту теж (`slice(0, 10)`).
 *
 * Тобто сторінка показувала б читачеві одну дату, а машинам — іншу,
 * і залежало б це від того, на чиєму ноуті зібрали сайт. Пояс названо.
 */
export function postDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
