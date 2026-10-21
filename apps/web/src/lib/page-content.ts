import { apiFetch } from "./api";
import { COMPANY, CONTACT_EMAIL } from "./legal";

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
  return (await res.json()) as PageView;
}
