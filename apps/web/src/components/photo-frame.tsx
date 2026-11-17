import { SIZES, srcSetFor } from "@/lib/responsive-image";
import { AI_LABEL } from "@/lib/page-photos";
import type { CSSProperties } from "react";

/**
 * Місце під фото власника — рішення 16.11.2026.
 *
 * Порожнє місце тема Fuse не лишає порожнім: обгортка тієї ж пропорції й
 * того ж радіуса, тло `--color-img-placeholder-bg` (колір фону, темніший на
 * 7 %), усередині лінійна ілюстрація-силует
 * (`snippets/theme-image.liquid` → `placeholder_svg_tag`, обгортка
 * `.svg-placeholder-wrapper`; читано з архіву `fuse 07:09:2026.zip`
 * 16.11.2026). Тут те саме, але СИЛУЕТ СВІЙ — малюнок із теми не копіюємо.
 *
 * 🔴 ЗАГЛУШКА — НЕ ЗМІСТ. `aria-hidden`, порожнього `alt` немає, бо немає й
 * `<img>`; жодного тексту «photo coming soon» (порожнє не малюємо словами);
 * вона не потрапляє в `og:image` (метадані сторінок її не читають) і не
 * дає пошуковику жодного зображення.
 *
 * 🔴 `<img>` ЛИШЕ КОЛИ Є ЩО ПОКАЗАТИ. Порожній `src` — заглушка, а не
 * `<img src="">`. Усе, що не пройшло перевірку у `lib/photo-slot.ts` (чужий
 * хост, зламаний запис, недоступний файл), сюди приходить як `null`.
 *
 * 🔴 ЦЕЙ ФАЙЛ НЕ ІМПОРТУЄ НІЧОГО, ЩО ТРИМАЄ ТОКЕН CMS: `PhotoFrame`
 * синхронна й бере вже вирішене зображення (картки, тести). Серверна
 * `PhotoSlot`, що читає слот за ключем, лежить у `photo-slot.tsx`.
 */

/** Зображення, вирішене до рендера: адреса вже перевірена. */
export interface PhotoImage {
  src: string;
  alt: string;
  /** Generated: the frame prints «AI illustration» on it. */
  ai?: boolean;
}

export const PHOTO_RATIOS = {
  /** Широкий герой угорі сторінки. */
  hero: "21 / 9",
  /** Фото в картці допису: `padding-top:82%` у `post-cards.tsx`. */
  card: "100 / 82",
} as const;

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const PHOTO_CSS = `
.ct-photo{position:relative;display:block;overflow:hidden;width:100%;aspect-ratio:var(--ct-photo-ratio,21 / 9);border-radius:var(--r,16px);background-color:var(--color-img-placeholder-bg,color-mix(in srgb,var(--color-surface-2) 93%,#000))}
.ct-photo__image{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center}
.ct-photo__ai{position:absolute;right:12px;bottom:10px;padding:2px 8px;border-radius:999px;background:rgb(0 0 0 / .55);color:#fff;font-size:12px;line-height:1.5;letter-spacing:.02em}
.ct-photo__glyph{position:absolute;top:50%;left:50%;width:min(28%,96px);height:auto;transform:translate(-50%,-50%);color:var(--color-ink-2);opacity:.45}
@media(min-width:768px){.ct-photo--hero{max-height:440px}}
@media(max-width:767px){.ct-photo--hero{aspect-ratio:16 / 9}}
`;

/** Силует: гори під сонцем, лінійний, без заливки. Власний малюнок. */
function Glyph() {
  return (
    <svg
      className="ct-photo__glyph"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="34" cy="14" r="4" />
      <path d="M4 40 17 20l8 11 5-6 14 15z" />
    </svg>
  );
}

export function PhotoFrame({
  image,
  ratio = PHOTO_RATIOS.hero,
  slot,
  hero = false,
  className,
  loading = "lazy",
}: {
  /** Вирішене зображення або `null` — тоді заглушка. */
  image: PhotoImage | null;
  ratio?: string;
  /** Ключ слота — лише для `data-photo-slot` (знімки, тести). */
  slot?: string;
  /** Герой сторінки: на телефоні 16:9 замість 21:9. */
  hero?: boolean;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const src = image?.src.trim() ?? "";
  const classes = ["ct-photo", hero ? "ct-photo--hero" : null, className]
    .filter(Boolean)
    .join(" ");
  const style = { "--ct-photo-ratio": ratio } as CSSProperties;

  if (src === "") {
    return (
      <div
        className={classes}
        style={style}
        aria-hidden="true"
        data-photo-slot={slot}
        data-testid="photo-placeholder"
      >
        <style href="ct-photo" precedence="ct-components">
          {PHOTO_CSS}
        </style>
        <Glyph />
      </div>
    );
  }
  return (
    <div className={classes} style={style} data-photo-slot={slot}>
      <style href="ct-photo" precedence="ct-components">
        {PHOTO_CSS}
      </style>
      {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
      <img
        className="ct-photo__image"
        src={src}
        srcSet={srcSetFor(src)}
        sizes={srcSetFor(src) ? SIZES.full : undefined}
        alt={image?.alt ?? ""}
        loading={loading}
        data-testid="photo-image"
      />
      {image?.ai && (
        <span className="ct-photo__ai" data-testid="ai-label">
          {AI_LABEL}
        </span>
      )}
    </div>
  );
}

