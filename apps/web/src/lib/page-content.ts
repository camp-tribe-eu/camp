import { apiFetch } from "./api";
import { COMPANY, CONTACT_EMAIL } from "./legal";
import { isAllowedHref, substitute } from "./rich-text";

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
  return applyValues((await res.json()) as PageView);
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
// 🔴 ЕКСПОРТОВАНА НАВМИСНО: інакше перевірку адрес із CMS можна
// накрити лише піднявши API і базу, тобто ніколи. Рецензія #303
// показала, що мої сторожі не ловили жодного з трьох дефектів цього
// шляху — чиста функція робить їх дешевими.
export function applyValues(page: PageView): PageView {
  const sub = (v: string | null) =>
    v === null ? null : substitute(v, PAGE_VALUES);

  /**
   * 🔴 АДРЕСИ З CMS ПЕРЕВІРЯЮТЬСЯ ТУТ, А НЕ В РЕНДЕРІ.
   *
   * Рецензія #303 заміряла: `CtaButton` не відхиляв нічого — із десяти
   * входів рендерились усі десять, зокрема `javascript:alert(1)`. Поле
   * `cta_href` редагує людина в CMS, тож це шлях для виконання коду.
   *
   * Перевірка стоїть у ЦЬОМУ місці навмисно: рендерів буде більше
   * (`cards` уже на черзі), і кожен новий забув би про неї. Тут її не
   * обійде жоден — дані не доходять до розмітки неперевіреними.
   *
   * 🔴 Порожній рядок прирівнюється до відсутності. `meta_title=""`
   * давав порожній `<title>`, а «стерли в CMS» і «не заповнювали»
   * мусять означати одне: беремо запасне значення.
   */
  const empty = (v: string | null) =>
    v === null || v.trim() === "" ? null : v;

  const link = (v: string | null, where: string) => {
    const out = empty(sub(v));
    if (out !== null && !isAllowedHref(out)) {
      throw new Error(
        `page-content: адреса «${out}» у полі ${where} не дозволена. ` +
          "Можна внутрішній шлях (/…), https:// або mailto:. " +
          "Правило одне на весь застосунок — див. lib/rich-text.ts.",
      );
    }
    return out;
  };
  return {
    ...page,
    title: substitute(page.title, PAGE_VALUES),
    metaTitle: empty(sub(page.metaTitle)),
    metaDescription: empty(sub(page.metaDescription)),
    sections: page.sections.map((s) => ({
      ...s,
      heading: sub(s.heading),
      subheading: sub(s.subheading),
      imageAlt: sub(s.imageAlt),
      imageUrl: link(s.imageUrl, "image_url"),
      ctaHref: link(s.ctaHref, "cta_href"),
      ctaLabel: sub(s.ctaLabel),
    })),
  };
}
