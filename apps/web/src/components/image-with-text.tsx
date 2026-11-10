import type { ReactNode } from "react";

import { ButtonLink } from "./button";

/**
 * Чергування текст/фото — CAMP-449, секція 4 каталогу (знімок ревю 441/22).
 *
 * Білий блок із заголовком, текстом і кнопкою СТОЇТЬ ПОРУЧ із фото на всю
 * висоту — не поверх нього. Цим вона відрізняється від `BoxBanner`, де
 * коробка лежить на знімку, і від `GridBanner`, де фото саме є карткою.
 *
 * 🔴 СТРУКТУРА З ТЕМИ: секція `image-with-text` Fuse
 * (`assets/image-with-text.build.css`, 3 330 байт; читано з архіву
 * `fuse 1.0.1.zip` 10.11.2026). Дослівно:
 *
 *   .image-with-text{display:flex;flex-direction:column;gap:4px}
 *   .image-with-text--image-width-70 .image-with-text__wrapper{
 *       padding-top:58.4%}
 *   .image-with-text--image-width-50 .image-with-text__wrapper{
 *       padding-top:100%}
 *   .image-with-text__media{position:relative;overflow:hidden;
 *       border-radius:var(--global-border-radius)}
 *   .image-with-text__image{position:absolute;top:0;left:0;width:100%;
 *       height:100%;object-fit:cover;object-position:var(--img-mob-pos)}
 *   .image-with-text__content{padding:24px 16px;
 *       border-radius:var(--global-border-radius);
 *       background-color:var(--color-background-secondary);
 *       text-align:var(--text-align)}
 *   .image-with-text__caption{display:block;
 *       font-family:var(--heading-font-family);
 *       font-size:calc(var(--body-font-size) * .75);font-weight:600;
 *       line-height:1.333;color:var(--color-heading)}
 *   .image-with-text__caption + .image-with-text__heading{margin-top:12px}
 *   .image-with-text__text{margin-top:12px}
 *   .image-with-text__button{max-width:max-content;margin-top:24px}
 *   @media(min-width:992px){
 *     .image-with-text{flex-direction:row;gap:12px}
 *     .image-with-text__grid--reverse .image-with-text__media{order:1}
 *     .image-with-text--image-width-70 .image-with-text__media{
 *         width:calc(70% - 6px)}
 *     .image-with-text--image-width-70 .image-with-text__wrapper{
 *         padding-top:58.12%}
 *     .image-with-text--image-width-70 .image-with-text__content{
 *         width:calc(30% - 6px)}
 *     .image-with-text--image-width-50 .image-with-text__media{
 *         width:calc(50% - 6px)}
 *     .image-with-text--image-width-50 .image-with-text__wrapper{
 *         padding-top:105.52%}
 *     .image-with-text--image-width-50 .image-with-text__content{
 *         width:calc(50% - 6px);padding:32px 64px}
 *     .image-with-text__content{display:flex;flex-direction:column;
 *         justify-content:center;align-items:var(--align-items);padding:32px}
 *     .image-with-text__caption + .image-with-text__heading{margin-top:24px}
 *     .image-with-text__text{margin-top:24px}
 *     .image-with-text__button{margin-top:48px}}
 *
 * Поріг «поруч» — 992px, як у теми для САМЕ цієї секції. У `GridBanner`
 * він 1200px, і це не різнобій: там дві картки з фото, тут картка й текст.
 * Число читане з CSS теми, а не підігнане оком.
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо:
 *   - анімації появи (`need-animate`, зсув на 100% і 20px) не беремо: текст
 *     секції — її зміст, а не нагорода за прокрутку;
 *   - `object-position` з налаштувань теми (`--img-mob-pos`,
 *     `--img-desktop-pos`) не беремо: наші банери — намальовані SVG із
 *     `preserveAspectRatio`, їм центр і потрібен;
 *   - кнопка — наша `ButtonLink` (CAMP-345) у `secondary`, а не
 *     `button-thirdly` теми.
 *
 * 🔴 CSS ЇДЕ В HTML (`<style href precedence>`), як у `grid-banner.tsx`.
 */

export interface ImageWithTextProps {
  image: { src: string; alt?: string };
  /** Надзаголовок (`caption` теми) — дрібний рядок над заголовком. */
  caption?: string;
  heading: string;
  text?: ReactNode;
  cta?: { href: string; label: string };
  /** Де стоїть фото на десктопі. Нижче 992px воно завжди зверху. */
  imagePosition?: "left" | "right";
  /** Частка ширини під фото на десктопі — два варіанти теми. */
  imageWidth?: 70 | 50;
  /** `h2` типово; `h3` під власним заголовком секції. */
  headingLevel?: 2 | 3;
  className?: string;
  /** Для тестів і e2e. */
  testId?: string;
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const IMAGE_WITH_TEXT_CSS = `
.ct-iwt{display:flex;flex-direction:column;gap:4px}
.ct-iwt__media{position:relative;overflow:hidden;border-radius:var(--r,16px)}
.ct-iwt__wrapper{display:block}
.ct-iwt--w70 .ct-iwt__wrapper{padding-top:58.4%}
.ct-iwt--w50 .ct-iwt__wrapper{padding-top:100%}
.ct-iwt__image{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.ct-iwt__content{padding:24px 16px;border-radius:var(--r,16px);background-color:var(--color-surface-2)}
.ct-iwt__caption{display:block;font-size:calc(var(--body-font-size,16px) * .75);font-weight:600;line-height:1.333;color:var(--color-heading)}
.ct-iwt__caption+.ct-iwt__heading{margin-top:12px}
.ct-iwt__heading{color:var(--color-heading)}
.ct-iwt__text{margin-top:12px;color:var(--color-ink-2)}
.ct-iwt__button{max-width:max-content;margin-top:24px}
@media(min-width:992px){
.ct-iwt{flex-direction:row;gap:12px}
.ct-iwt--reverse .ct-iwt__media{order:1}
.ct-iwt--w70 .ct-iwt__media{width:calc(70% - 6px)}
.ct-iwt--w70 .ct-iwt__wrapper{padding-top:58.12%}
.ct-iwt--w70 .ct-iwt__content{width:calc(30% - 6px)}
.ct-iwt--w50 .ct-iwt__media{width:calc(50% - 6px)}
.ct-iwt--w50 .ct-iwt__wrapper{padding-top:105.52%}
.ct-iwt--w50 .ct-iwt__content{width:calc(50% - 6px);padding:32px 64px}
.ct-iwt__content{display:flex;flex-direction:column;justify-content:center;padding:32px}
.ct-iwt__caption+.ct-iwt__heading{margin-top:24px}
.ct-iwt__text{margin-top:24px}
.ct-iwt__button{margin-top:48px}}
`;

export function ImageWithText({
  image,
  caption,
  heading,
  text,
  cta,
  imagePosition = "left",
  imageWidth = 70,
  headingLevel = 2,
  className,
  testId,
}: ImageWithTextProps) {
  /**
   * 🔴 ПОРОЖНЄ НЕ МАЛЮЄМО — І «ПОРОЖНЄ» ТУТ ОЗНАЧАЄ «НЕМА ЩО СКАЗАТИ».
   *
   * Картка вимагає: порожні дані → секція не рендериться, а не показує
   * порожню рамку. Для цієї секції порожнє — це відсутній заголовок або
   * відсутнє фото: без заголовка лишається фото без причини, без фото —
   * сіра коробка з текстом, тобто не ця секція, а абзац у рамці.
   */
  if (heading.trim() === "" || image.src.trim() === "") return null;

  const Heading = headingLevel === 2 ? "h2" : "h3";
  const classes = [
    "ct-iwt",
    imageWidth === 70 ? "ct-iwt--w70" : "ct-iwt--w50",
    imagePosition === "right" ? "ct-iwt--reverse" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} data-testid={testId}>
      <style href="ct-iwt" precedence="ct-components">
        {IMAGE_WITH_TEXT_CSS}
      </style>
      <div className="ct-iwt__media">
        <span className="ct-iwt__wrapper">
          {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
          <img
            className="ct-iwt__image"
            src={image.src}
            alt={image.alt ?? ""}
            loading="lazy"
          />
        </span>
      </div>
      <div className="ct-iwt__content">
        {caption ? <span className="ct-iwt__caption">{caption}</span> : null}
        <Heading className="ct-iwt__heading">{heading}</Heading>
        {text ? <p className="ct-iwt__text">{text}</p> : null}
        {cta ? (
          <div className="ct-iwt__button">
            <ButtonLink href={cta.href} variant="secondary">
              {cta.label}
            </ButtonLink>
          </div>
        ) : null}
      </div>
    </section>
  );
}
