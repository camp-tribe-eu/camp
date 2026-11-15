import type { SectionView } from "@/lib/page-content";
import { substitute } from "@/lib/rich-text";

// CAMP-488 — слайди головної беруться з `page_sections`, а не з коду.
//
// 🔴 ОДИН СЛАЙД — ОДИН РЯДОК `page_sections` типу `slide`, і це не
// зручність, а наслідок правила власника: усе, що бачить читач, правиться
// в адмінці. Заголовок, текст, напис і адреса кнопки, картинка та її опис
// — це ЗВИЧАЙНІ поля секції (`heading`, `body`, `cta_label`, `cta_href`,
// `image_url`, `image_alt`). Альтернатива — `items` з масивом слайдів у
// jsonb — давала б редакторові поле з кодом: одна зайва кома, і секція
// зникає (див. примітку до `items` у `apps/cms/configure.mjs`). Рядок на
// слайд дає форму, а число слайдів міняється додаванням і видаленням рядка.
//
// 🔴 ЧОМУ ТУТ, А НЕ В `home-slider.tsx`. Той файл — клієнтський
// (`'use client'`), а експорт клієнтського модуля, викликаний із серверного
// компонента, перетворюється на посилання, яке не можна викликати. Чиста
// функція, яку треба викликати на сервері й перевіряти юнітом, живе тут.

export interface SlideView {
  /** Ключ у переліку: порядок у базі, а не текст (текст редактор міняє). */
  key: string;
  heading: string;
  /** Дрібний рядок над заголовком (`subheading`). */
  eyebrow: string | null;
  body: string | null;
  image: { src: string; alt: string };
  cta: { href: string; label: string } | null;
}

/** Тип секції, з якої складається слайдер. Названий один раз. */
export const SLIDE_TYPE = "slide";

type Values = Readonly<Record<string, string>>;

const filled = (v: string | null | undefined): v is string =>
  typeof v === "string" && v.trim() !== "";

/**
 * Слайди сторінки в порядку `sort`, як їх віддав API.
 *
 * 🔴 ЗІПСОВАНИЙ СЛАЙД КИДАЄ, А НЕ ЗНИКАЄ. Слайд без заголовка — картинка
 * без причини; без картинки — це не фото-слайд, а коробка з текстом, тобто
 * не той блок, який просив власник. Мовчки пропустити його означало б
 * дати власникові побачити слайд в адмінці й не побачити на сайті — рівно
 * ту тишу, яку `assertAllSectionsUsed` існує, щоб не пускати.
 *
 * 🔴 Так само половина кнопки (напис без адреси чи навпаки): кнопка, що
 * нікуди не веде, виглядає працездатною.
 *
 * Адреси кнопки й картинки вже перевірені в `applyValues` (`isAllowedHref`):
 * `javascript:` сюди не доходить.
 */
export function slidesOf(
  sections: readonly SectionView[],
  values: Values,
  where = "слайдер головної",
): SlideView[] {
  return sections
    .filter((s) => s.type === SLIDE_TYPE)
    .map((s, i) => {
      const at = `${where}, слайд ${i + 1}`;
      if (!filled(s.heading)) {
        throw new Error(`slides: ${at} — немає заголовка.`);
      }
      if (!filled(s.imageUrl)) {
        throw new Error(
          `slides: ${at} («${s.heading}») — немає картинки. ` +
            "Слайд без фото — не той блок, який просили.",
        );
      }
      const href = filled(s.ctaHref) ? s.ctaHref : null;
      const label = filled(s.ctaLabel) ? s.ctaLabel : null;
      if ((href === null) !== (label === null)) {
        throw new Error(
          `slides: ${at} («${s.heading}») — кнопка наполовину: ` +
            `адреса ${href === null ? "порожня" : "є"}, напис ` +
            `${label === null ? "порожній" : "є"}.`,
        );
      }
      return {
        key: `${i}`,
        heading: substitute(s.heading, values),
        eyebrow: filled(s.subheading) ? substitute(s.subheading, values) : null,
        body: filled(s.body) ? substitute(s.body, values) : null,
        image: { src: s.imageUrl, alt: s.imageAlt ?? "" },
        cta: href !== null && label !== null ? { href, label } : null,
      };
    });
}

export interface SearchView {
  label: string;
  placeholder: string | null;
  button: string;
  action: string;
}

/**
 * Пошуковий віджет із секції типу `search`.
 *
 * `heading` — видимий підпис над полем і його доступна назва; `subheading`
 * — підказка в самому полі; `cta_label` — напис кнопки; `cta_href` — сторінка
 * пошуку, куди йде форма. Без підпису поле не має назви для читача екрана,
 * без напису кнопка порожня, без адреси форма нікуди не йде — тож усі три
 * обовʼязкові, а підказка в полі — ні.
 */
export function searchOf(section: SectionView, values: Values): SearchView {
  const need = (v: string | null, field: string) => {
    if (!filled(v)) {
      throw new Error(`search: у секції пошуку порожнє поле «${field}».`);
    }
    return substitute(v, values);
  };
  return {
    label: need(section.heading, "heading"),
    placeholder: filled(section.subheading)
      ? substitute(section.subheading, values)
      : null,
    button: need(section.ctaLabel, "cta_label"),
    action: need(section.ctaHref, "cta_href"),
  };
}
