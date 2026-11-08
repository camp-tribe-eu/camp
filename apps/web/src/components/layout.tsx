/**
 * ШИРИНА СТОРІНКИ — ОДНЕ МІСЦЕ, ТРИ НАЗВАНІ ВАРІАНТИ.
 *
 * 🔴 Чому це зʼявилось. Ширина була розсипана по 54 файлах, і в 149 місцях нею
 * служив `max-w-prose` — колонка для ЧИТАННЯ ТЕКСТУ (61ch ≈ 560px), а не
 * ширина сторінки. Проти 40 місць із `max-w-wrap`. Тобто 79% усіх обмежень
 * ширини в застосунку були читальною колонкою. Саме звідси «текст не на всю
 * ширину» й порожня права половина на знімках ревю власника (CAMP-441…445):
 * 441/42, 441/54, 441/62, 441/72.
 *
 * 🔴 І дефект ріс сам: `page-sections.tsx` видавав `max-w-prose` КОЖНІЙ секції
 * за замовчуванням, тож кожна нова секція успадковувала його, не питаючи.
 * Замір у коментарі `globals.css` від 01.10.2026 — 105 вживань; 08.11.2026 —
 * вже 149. Плюс 44 за пʼять тижнів.
 *
 * ⚠️ 149, а не 153: перший мій `grep` заглядав ще й у `globals.css`, де цей
 * клас оголошено й задокументовано, тобто рахував власний коментар як дефект.
 * Авторитетне число дає сторож `scripts/ci/check-prose-width.mjs` — лише .tsx.
 *
 * Варіанти названі так, щоб вибір доводилось робити свідомо:
 *   wide   — сітки, мапи, фільтри, картки, таби. Уся ширина контейнера.
 *   read   — суцільний текст. 61ch, бо довгий рядок справді не читається.
 *   narrow — вузьке на широкій сторінці (таблиця, форма): ставиться ПО ЦЕНТРУ.
 *            Слова власника: «якщо контенту не на всю ширину то просто
 *            табличку вузьку ставимо по центру і воно класно і гармонійно».
 *
 * Ширина контейнера — не з ока: `--global-container-width: 1704px`, читано з
 * `:root` демо-стору теми `theme7-store1.myshopify.com` 08.11.2026.
 */
import type { ReactNode } from "react";

/** Ширини, між якими можна обирати. Інших немає навмисно. */
export type Measure = "wide" | "read" | "narrow";

const MEASURE: Record<Measure, string> = {
  wide: "w-full",
  read: "max-w-read",
  // 🔴 `mx-auto` саме тут, а не в `wide`: вузьке на широкій сторінці мусить
  // стояти по центру, інакше воно липне до лівого краю — це й був дефект.
  narrow: "mx-auto max-w-narrow",
};

/** Вертикальний ритм сторінки. Був переписаний руками 33 рази: py-8/10/12. */
export type Rhythm = "tight" | "normal" | "loose";

const RHYTHM: Record<Rhythm, string> = {
  tight: "py-8",
  normal: "py-10",
  loose: "py-12 md:py-16",
};

const SHELL = "mx-auto max-w-wrap px-4 xl:px-6";

function classes(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface PageShellProps {
  children: ReactNode;
  /** Вертикальні відступи сторінки. */
  rhythm?: Rhythm;
  className?: string;
  /** `main` на сторінці, `div` усередині іншої обгортки. */
  as?: "main" | "div" | "section";
}

/**
 * Обгортка сторінки: контейнер, бічні поля, вертикальний ритм.
 * Замінює рядок `mx-auto max-w-wrap px-4 py-N xl:px-6`, повторений руками.
 */
export function PageShell({
  children,
  rhythm = "normal",
  className,
  as: Tag = "main",
}: PageShellProps) {
  return (
    <Tag className={classes(SHELL, RHYTHM[rhythm], className)}>{children}</Tag>
  );
}

export interface BlockProps {
  children: ReactNode;
  /**
   * Яку ширину займає цей блок. Обовʼязково: саме мовчазне замовчування
   * і розповзлося на 153 місця.
   */
  measure: Measure;
  className?: string;
  as?: "div" | "section" | "article" | "aside" | "p";
}

/** Блок усередині сторінки з явно названою шириною. */
export function Block({
  children,
  measure,
  className,
  as: Tag = "div",
}: BlockProps) {
  return (
    <Tag className={classes(MEASURE[measure], className)}>{children}</Tag>
  );
}
