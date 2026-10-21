import { apiFetch } from "./api";
import {
  PAGE_REVALIDATE_SECONDS,
  PAGE_TAG,
  applyValues,
  type PageView,
  type SectionView,
} from "./page-content";

// CAMP-364 — блог. Дописи живуть у тій самій таблиці, що й сторінки,
// і відрізняються лише `type`.
//
// 🔴 МІТКА РЕВАЛІДАЦІЇ ТА САМА, ЩО В СТОРІНОК, І ЦЕ НАВМИСНО. Власник
// редагує те й те в одній адмінці; окрема мітка означала б, що правка
// допису не скидає кеш, якщо вебхук надішле «pages», і навпаки. Одна
// мітка — один вебхук, який не можна налаштувати наполовину.

/**
 * 🔴 СЛАГИ, ЗАЙНЯТІ МАРШРУТАМИ, А НЕ ДОПИСАМИ.
 *
 * `/blog/page/2` це пагінація, і статичний сегмент `page` у Next має
 * пріоритет над динамічним `[slug]`. Допис зі слагом `page` не впав би
 * нікому на очі: каталог показав би на нього посилання, а за адресою
 * відкрилась би пагінація. Тому перелік падає гучно тут, у ЄДИНОМУ
 * місці, яке читають обидва маршрути.
 */
const RESERVED_POST_SLUGS = new Set(["page"]);

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
  const posts = body.posts as PostSummary[];
  const shadowed = posts.filter((p) => RESERVED_POST_SLUGS.has(p.slug));
  if (shadowed.length > 0) {
    throw new Error(
      `слаг(и) ${shadowed.map((p) => `«${p.slug}»`).join(", ")} зарезервовані ` +
        "маршрутом пагінації `/blog/page/[n]`. Статичний сегмент у Next " +
        "має пріоритет над динамічним, тож такий допис був би недосяжний " +
        "за власною адресою, а каталог вів би на сторінку пагінації.",
    );
  }
  return posts;
}

/**
 * Скільки дописів на сторінці каталогу.
 *
 * Десять — звичне для блогу число; важливе тут не воно, а те, що воно
 * ОДНЕ: і `/blog`, і `/blog/page/[n]`, і лічильник сторінок читають
 * саме цю константу.
 */
export const POSTS_PER_PAGE = 10;

/** Скільки сторінок каталогу дає цей перелік. Порожній блог — одна. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
}

/** Зріз переліку для сторінки `n` (нумерація з одиниці). */
export function pageSlice<T>(posts: readonly T[], n: number): T[] {
  return posts.slice((n - 1) * POSTS_PER_PAGE, n * POSTS_PER_PAGE) as T[];
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

// ── Час читання ──────────────────────────────────────────────────────
//
// 🔴 РАХУЄМО ТЕ, ЩО ЧИТАЧ БАЧИТЬ, А НЕ ТЕ, ЩО ЛЕЖИТЬ У ПОЛІ.
//
// Текст допису розкиданий по секціях у чотирьох місцях: `heading`,
// `subheading`, `body` і `items` (сирий `jsonb`). Рахувати лише `body`
// було б зручно й неправдиво: добірка з десяти пунктів живе рівно в
// `items`, і допис із неї виглядав би як «1 хв» при будь-якому обсязі.

/** Слів за хвилину. Загальновживане для прози значення. */
const WORDS_PER_MINUTE = 200;

/**
 * Ключі `items`, значення яких читач НЕ читає.
 *
 * Адреса посилання й назва іконки це розмітка, а не текст: вони
 * збільшили б лічильник, не додавши жодного слова на екрані.
 */
const NON_TEXT_KEYS = new Set(["href", "url", "icon", "image", "imageUrl"]);

/** Усі рядки з `items`, крім розміткових. */
function itemStrings(node: unknown, key?: string): string[] {
  if (typeof node === "string") {
    return key && NON_TEXT_KEYS.has(key) ? [] : [node];
  }
  // Окремої гілки на масив тут НЕМАЄ навмисно: `Object.entries`
  // віддає й індекси масиву, тож гілка `Array.isArray` була б рядком,
  // прибирання якого нічого не міняє — репетиція мутацій показала
  // рівно це (8 випадків лишались зелені).
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      itemStrings(v, k),
    );
  }
  return [];
}

/** Кількість слів, які читач справді бачить у секціях. */
export function visibleWords(sections: readonly SectionView[]): number {
  const text = sections
    .flatMap((s) => [
      s.heading ?? "",
      s.subheading ?? "",
      s.body ?? "",
      ...itemStrings(s.items),
    ])
    .join(" ");
  // 🔴 СЛОВО — ЦЕ ТЕ, ЩО МІСТИТЬ ЛІТЕРУ АБО ЦИФРУ, І ЦЬОГО ДОСИТЬ.
  //
  // Тут стояв ще й `stripMarkup()`, який знімав `**`, `[підпис](адреса)`
  // і маркери списку. Репетиція мутацій показала, що прибрати його
  // цілком — і всі 8 випадків лишаються ЗЕЛЕНІ. Причина не в тестах:
  // розбірник (`rich-text.ts:207`) не дозволяє пробілу в адресі
  // (`\(([^)\s]+)\)`), тож `[alpha beta](/a/b)` це ті самі дві лексеми
  // і до зняття розмітки, і після. А `-`, `>`, `#` і `*` поодинці не
  // мають ні літери, ні цифри, тож випадають ось тут.
  //
  // Перетворення, яке не може змінити результат для жодного входу,
  // гірше за відсутнє: воно каже «розмітку враховано», а насправді її
  // враховує рядок нижче.
  return text.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length;
}

/**
 * Час читання в хвилинах — ціле, не менше одиниці.
 *
 * 🔴 НИЖНЯ МЕЖА НЕ КОСМЕТИЧНА. Допис на два рядки дав би «0 хв», а це
 * читається як «порожньо», а не як «швидко».
 */
export function readingMinutes(sections: readonly SectionView[]): number {
  return Math.max(1, Math.ceil(visibleWords(sections) / WORDS_PER_MINUTE));
}

/**
 * Номер сторінки з адреси, або `null`.
 *
 * 🔴 ТІЛЬКИ ТОЧНИЙ ЗАПИС ЦІЛОГО ЧИСЛА ВІД ДВОХ. `Number('2abc')` це
 * `NaN`, але `parseInt('2abc')` це 2 — і тоді `/blog/page/2abc`
 * віддав би ту саму сторінку з власним canonical, тобто дублікат для
 * пошуковика. `01`, `2.0`, ` 2` і `+2` відкидаються тим самим рядком.
 * А «1» відкидається, бо перша сторінка це `/blog`.
 */
export function parsePageNumber(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 2 ? n : null;
}
