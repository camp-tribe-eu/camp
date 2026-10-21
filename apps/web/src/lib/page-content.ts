import { apiFetch } from "./api";
import { COMPANY, CONTACT_EMAIL } from "./legal";
import { substitute } from "./rich-text";

// CAMP-365 — сторінка, зібрана з універсальних секцій (модель CAMP-362).

export interface SectionView {
  type: string;
  variant: string | null;
  heading: string | null;
  subheading: string | null;
  body: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  ctaHref: string | null;
  ctaLabel: string | null;
  items: unknown[];
}

export interface PageView {
  slug: string;
  title: string;
  /** Заголовок для пошуковика; `null` → береться `title`. */
  metaTitle: string | null;
  metaDescription: string | null;
  noindex: boolean;
  sections: SectionView[];
}

export const PAGE_TAG = "pages";

/**
 * Доба як стеля плюс мітка — та сама пара, що й у меню, і з тієї самої
 * причини: цей запит живе на сторінці, а Next бере МІНІМУМ витримки по
 * дереву маршруту. Коротка витримка заради тексту опустила б її всьому
 * сайту. Мітку скидає `POST /api/revalidate`, а не годинник.
 */
export const PAGE_REVALIDATE_SECONDS = 86_400;

/**
 * 🔴 ПІДСТАНОВКИ, ДОЗВОЛЕНІ ТЕКСТОВІ З CMS — БІЛИЙ СПИСОК.
 *
 * Тут і тільки тут вирішується, до чого текст може дотягнутись. Усе,
 * чого немає в цьому обʼєкті, кидає при розборі (`lib/rich-text.ts`),
 * а не малює порожнечу.
 *
 * 🔴 І саме тому адреса компанії лишається ОДНИМ рядком у `lib/legal
 * .ts`: текст у базі тримає `{{company.city}}`, а не «2000 Antwerpen».
 * Заморозити значення означало б перекреслити рішення CAMP-188.
 */
export const PAGE_VALUES: Readonly<Record<string, string>> = {
  "company.name": COMPANY.name,
  "company.city": COMPANY.city,
  "contact.email": CONTACT_EMAIL,
};

/** Сторінка з CMS, або `null`, якщо її немає. */
export async function pageContent(slug: string): Promise<PageView | null> {
  const res = await apiFetch(`/pages/${encodeURIComponent(slug)}`, {
    next: { revalidate: PAGE_REVALIDATE_SECONDS, tags: [PAGE_TAG] },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `сторінка «${slug}» недосяжна: GET /pages/${slug} → ${res.status}. ` +
        "Текст сторінки живе в CMS, тож без відповіді її нема з чого зібрати.",
    );
  }
  return withValues((await res.json()) as PageView);
}

/**
 * 🔴 ПІДСТАНОВКИ РОЗГОРТАЮТЬСЯ В УСІХ ТЕКСТОВИХ ПОЛЯХ, А НЕ ЛИШЕ В ТІЛІ.
 *
 * Перша редакція покладалась на те, що `substitute` живе всередині
 * `RichText`, — тобто доходив тільки `body`. Рецензія заміряла наслідок:
 * `cta_href = "mailto:{{contact.email}}"` їхав у `href` ДОСЛІВНО, а
 * сторож «жодної {{ на сторінці» його не бачив, бо читає видимий текст,
 * а не атрибути. `title` і `meta_description` не були покриті нічим.
 *
 * Тобто коментар вище («усе, чого немає в цьому обʼєкті, кидає при
 * розборі») був неправдою для пʼяти полів із семи. Тепер він правда:
 * кожне текстове поле проходить через той самий білий список, і
 * невідомий ключ кидає, де б він не стояв.
 *
 * `body` лишається `RichText`-у: там підстановка має статись ДО розбору
 * розмітки, інакше `[текст]({{...}})` не склеїться в посилання.
 */
function withValues(page: PageView): PageView {
  const sub = (v: string | null) =>
    v === null ? null : substitute(v, PAGE_VALUES);
  return {
    ...page,
    title: substitute(page.title, PAGE_VALUES),
    metaTitle: sub(page.metaTitle),
    metaDescription: sub(page.metaDescription),
    sections: page.sections.map((s) => ({
      ...s,
      heading: sub(s.heading),
      subheading: sub(s.subheading),
      imageAlt: sub(s.imageAlt),
      imageUrl: sub(s.imageUrl),
      ctaHref: sub(s.ctaHref),
      ctaLabel: sub(s.ctaLabel),
    })),
  };
}
