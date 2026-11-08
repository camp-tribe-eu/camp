import type { CSSProperties, ReactNode } from "react";

import { ButtonLink } from "./button";

/**
 * Банер із текстовою коробкою — CAMP-450, перша частина («банер про нас»).
 *
 * 🔴 СТРУКТУРА З ТЕМИ: секція `banner` Fuse у варіанті `banner--box`
 * (`banner.build.css`, 10 741 байт; читано з архіву `fuse 1.0.1.zip`
 * 08.11.2026). Дослівно:
 *
 *   .banner__wrapper{position:relative;display:flex;
 *       min-height:var(--min-height-mobile)}
 *   .banner__media-wrapper{position:absolute;top:0;left:0;width:100%;
 *       height:100%;overflow:hidden;
 *       border-radius:calc(var(--global-border-radius) * .75)}
 *   .banner__media-wrapper.banner__wrapper--overlay::after{content:"";
 *       position:absolute;top:0;left:0;width:100%;height:100%;
 *       background:var(--overlay)}
 *   .banner__media{position:absolute;top:0;left:0;width:100%;height:100%;
 *       object-fit:cover}
 *   .banner__content-wrapper{position:relative;display:flex;
 *       justify-content:center;align-items:center;width:100%;margin:0 auto}
 *   .banner--box .banner__content-wrapper{padding:8px}      ≥992: 12px
 *   .banner__content{position:relative;width:100%;text-align:center}
 *   .banner--box .banner__content{padding:20px;
 *       border-radius:var(--global-border-radius);
 *       background-color:var(--text-box-background)}
 *                       ≥992: max-width:480px;height:100%;padding:32px
 *   .banner--box .banner__content.banner--text-box-blur{
 *       backdrop-filter:blur(75px)}
 *   .banner--standard .banner__text{margin-top:24px}        ≥992
 *   .banner--standard .banner__button-wrapper{margin-top:24px}
 *
 * Висоти — з переліку секції теми (200…550px кроком 50): тут 350px на
 * телефоні й 400px на десктопі. `--text-box-background` типово
 * `#3A3A3AA3` — те саме значення тут.
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо:
 *   - анімацію появи (`banner-reveal-ltr`, `banner-heading-up`) не беремо;
 *   - таймер зворотного відліку (`banner__timer`) не беремо — нам нічого
 *     відлічувати;
 *   - кнопка — наша `ButtonLink` (CAMP-345).
 */

export interface BoxBannerProps {
  image: { src: string; alt?: string };
  heading: string;
  text?: ReactNode;
  cta: { href: string; label: string };
  /** Розмити те, що під коробкою (`banner--text-box-blur`). */
  blur?: boolean;
  /** Де стоїть коробка на десктопі; на телефоні завжди по центру. */
  align?: "start" | "center" | "end";
  headingLevel?: 2 | 3;
  className?: string;
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const BOX_BANNER_CSS = `
.ct-box-banner{--min-height-mobile:350px;--min-height-desktop:400px;--text-box-background:#3a3a3aa3;--text-color:#fff}
.ct-box-banner__wrapper{position:relative;display:flex;min-height:var(--min-height-mobile)}
.ct-box-banner__media-wrapper{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;border-radius:calc(var(--r,16px) * .75)}
.ct-box-banner__media{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.ct-box-banner__content-wrapper{position:relative;display:flex;justify-content:center;align-items:center;width:100%;margin:0 auto;padding:8px}
.ct-box-banner__content{position:relative;z-index:1;width:100%;padding:20px;text-align:center;border-radius:var(--r,16px);background-color:var(--text-box-background);color:var(--text-color)}
.ct-box-banner__content--blur{backdrop-filter:blur(75px);-webkit-backdrop-filter:blur(75px)}
.ct-box-banner__heading{font-size:calc(var(--heading-font-size,16px) * 1.625);line-height:1.2;font-weight:700;color:var(--text-color)}
.ct-box-banner__text{margin-top:16px;line-height:1.5}
.ct-box-banner__button-wrapper{margin-top:16px}
@media(min-width:992px){.ct-box-banner__wrapper{min-height:var(--min-height-desktop)}.ct-box-banner__content-wrapper{padding:12px;justify-content:var(--ct-box-align,center)}.ct-box-banner__content{max-width:480px;height:100%;padding:32px;align-content:center}.ct-box-banner__heading{font-size:calc(var(--heading-font-size,16px) * 2)}.ct-box-banner__text{margin-top:24px}.ct-box-banner__button-wrapper{margin-top:24px}}
`;

const ALIGN = { start: "flex-start", center: "center", end: "flex-end" } as const;

export function BoxBanner({
  image,
  heading,
  text,
  cta,
  blur = true,
  align = "center",
  headingLevel = 2,
  className,
}: BoxBannerProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      className={["ct-box-banner", className].filter(Boolean).join(" ")}
      style={{ "--ct-box-align": ALIGN[align] } as CSSProperties}
    >
      <style href="ct-box-banner" precedence="ct-components">
        {BOX_BANNER_CSS}
      </style>
      <div className="ct-box-banner__wrapper">
        <div className="ct-box-banner__media-wrapper">
          {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
          <img
            className="ct-box-banner__media"
            src={image.src}
            alt={image.alt ?? ""}
            loading="lazy"
          />
        </div>
        <div className="ct-box-banner__content-wrapper">
          <div
            className={
              blur
                ? "ct-box-banner__content ct-box-banner__content--blur"
                : "ct-box-banner__content"
            }
          >
            <Heading className="ct-box-banner__heading">{heading}</Heading>
            {text ? <p className="ct-box-banner__text">{text}</p> : null}
            <div className="ct-box-banner__button-wrapper">
              <ButtonLink href={cta.href} variant="secondary">
                {cta.label}
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
