import type { ReactNode } from "react";

import { ButtonLink } from "./button";

/**
 * Два банери поруч — CAMP-450, перша частина.
 *
 * 🔴 СТРУКТУРА З ТЕМИ: секція `grid-banner` Fuse (`grid-banner.build.css`,
 * читано з архіву `fuse 1.0.1.zip` 08.11.2026) — саме «два фото-картки
 * поруч», як назвала їх CAMP-449, відхиливши для багатошарового банера.
 * Тут їй місце. Дослівно з теми:
 *
 *   .grid-banner__wrapper{position:relative;display:flex;
 *       flex-direction:column;overflow:hidden;
 *       border-radius:var(--global-border-radius)}
 *   .grid-banner--with-indent .grid-banner__wrapper{gap:5px 12px}
 *   .grid-banner--with-indent .grid-banner__item{overflow:hidden;
 *       border-radius:var(--global-border-radius)}
 *   .grid-banner__item{position:relative;display:grid}
 *   .grid-banner__item::before{content:"";grid-area:1/1;padding-top:103.54%}
 *   .grid-banner__picture{display:block;position:absolute;inset:0;
 *       width:100%;height:100%}
 *   .grid-banner__image{position:absolute;top:0;left:0;width:100%;
 *       height:100%;object-fit:cover}
 *   .grid-banner__content{position:relative;grid-area:1/1;align-self:end;
 *       min-width:0;z-index:1;text-align:center}
 *   .grid-banner__content-wrapper{position:relative;padding:24px 16px 16px}
 *   .grid-banner__filter{position:absolute;left:0;right:0;bottom:0;
 *       z-index:-1;display:block;height:100%;background:var(--content-bg);
 *       mask-image:linear-gradient(to bottom,transparent 0%,#000 100%);
 *       backdrop-filter:blur(60px);pointer-events:none}
 *   .grid-banner__heading{font-size:calc(var(--heading-font-size) * 1.625);
 *       line-height:1.38;color:var(--text-color)}
 *   .grid-banner__heading + .grid-banner__text{margin-top:12px}
 *   .grid-banner__text{line-height:1.07;color:var(--text-color)}
 *   .grid-banner__button{margin-top:12px}
 *   @media(min-width:1200px){
 *     .grid-banner__wrapper{flex-direction:row;justify-content:space-between}
 *     .grid-banner__item{flex:1 0 0%}
 *     .grid-banner__item::before{padding-top:87%}
 *     .grid-banner__content-wrapper{padding:40px 24px}
 *     .grid-banner__heading{font-size:calc(var(--heading-font-size) * 2.75);
 *         line-height:1.1}
 *     .grid-banner__heading + .grid-banner__text{margin-top:24px}
 *     .grid-banner__button{margin-top:24px}}
 *
 * Поріг «поруч» — 1200px, як у теми: нижче банери стоять один під одним.
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо:
 *   - анімації появи (`need-animate`, зсув на 48px) і «ховати текст до
 *     наведення» (`grid-banner__item--content-hover`) не беремо: текст
 *     банера — це його зміст, а не нагорода за наведення;
 *   - розширення картки під курсором (`flex-grow:1.21`) не беремо з тієї
 *     ж причини: два банери — два рівноцінні шляхи;
 *   - кнопка — наша `ButtonLink` (CAMP-345), не кнопка теми.
 *
 * 🔴 CSS ЇДЕ В HTML (`<style href precedence>`), як у ticker.tsx.
 */

export interface GridBannerItem {
  image: { src: string; alt?: string };
  heading: string;
  text?: ReactNode;
  cta: { href: string; label: string };
}

export interface GridBannerProps {
  /** Рівно два — так у теми (`grid-banner__item` × 2). */
  items: readonly [GridBannerItem, GridBannerItem];
  /** `h2` типово; `h3` під власним заголовком секції. */
  headingLevel?: 2 | 3;
  className?: string;
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const GRID_BANNER_CSS = `
.ct-grid-banner{--text-color:#fff;--content-bg:rgba(35,35,35,.6)}
.ct-grid-banner__wrapper{position:relative;display:flex;flex-direction:column;gap:5px 12px;overflow:hidden;border-radius:var(--r,16px)}
.ct-grid-banner__item{position:relative;display:grid;overflow:hidden;border-radius:var(--r,16px)}
.ct-grid-banner__item::before{content:"";grid-area:1/1;padding-top:103.54%}
.ct-grid-banner__picture{display:block;position:absolute;inset:0;width:100%;height:100%}
.ct-grid-banner__image{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.ct-grid-banner__content{position:relative;grid-area:1/1;align-self:end;min-width:0;z-index:1;text-align:center}
.ct-grid-banner__content-wrapper{position:relative;padding:24px 16px 16px}
.ct-grid-banner__filter{position:absolute;left:0;right:0;bottom:0;z-index:-1;display:block;height:100%;background:var(--content-bg);mask-image:linear-gradient(to bottom,transparent 0%,#000 100%);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 100%);backdrop-filter:blur(60px);-webkit-backdrop-filter:blur(60px);pointer-events:none}
.ct-grid-banner__heading{font-size:calc(var(--heading-font-size,16px) * 1.625);line-height:1.38;font-weight:700;color:var(--text-color)}
.ct-grid-banner__heading+.ct-grid-banner__text{margin-top:12px}
.ct-grid-banner__text{line-height:1.3;color:var(--text-color)}
.ct-grid-banner__button{margin-top:12px}
@media(min-width:1200px){.ct-grid-banner__wrapper{flex-direction:row;justify-content:space-between}.ct-grid-banner__item{flex:1 0 0%}.ct-grid-banner__item::before{padding-top:87%}.ct-grid-banner__content-wrapper{padding:40px 24px}.ct-grid-banner__heading{font-size:calc(var(--heading-font-size,16px) * 2.75);line-height:1.1}.ct-grid-banner__heading+.ct-grid-banner__text{margin-top:24px}.ct-grid-banner__button{margin-top:24px}}
`;

export function GridBanner({
  items,
  headingLevel = 2,
  className,
}: GridBannerProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      className={["ct-grid-banner", className].filter(Boolean).join(" ")}
    >
      <style href="ct-grid-banner" precedence="ct-components">
        {GRID_BANNER_CSS}
      </style>
      <div className="ct-grid-banner__wrapper">
        {items.map((item) => (
          <div className="ct-grid-banner__item" key={item.cta.href}>
            <span className="ct-grid-banner__picture">
              {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
              <img
                className="ct-grid-banner__image"
                src={item.image.src}
                alt={item.image.alt ?? ""}
                loading="lazy"
              />
            </span>
            <div className="ct-grid-banner__content">
              <div className="ct-grid-banner__content-wrapper">
                <span className="ct-grid-banner__filter" aria-hidden="true" />
                <Heading className="ct-grid-banner__heading">
                  {item.heading}
                </Heading>
                {item.text ? (
                  <p className="ct-grid-banner__text">{item.text}</p>
                ) : null}
                <div className="ct-grid-banner__button">
                  <ButtonLink href={item.cta.href} variant="primary">
                    {item.cta.label}
                  </ButtonLink>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
