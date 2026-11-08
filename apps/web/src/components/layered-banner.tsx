import type { CSSProperties, ReactNode } from "react";

import { ButtonLink } from "./button";

/**
 * Багатошаровий банер — CAMP-449, перша частина.
 *
 * Власник описав його словами: «підкладка фото бекграунд, опція розмити
 * чи ні цей бекграунд, далі шар тікер текст який біжить по колу і нагорі
 * фото ще одно». Шари знизу вгору:
 *
 *   1. фонове фото            `ct-banner__background`
 *   2. накладка (+ розмиття)  `ct-banner__overlay[--blur]`
 *   3. біжучий текст          `ct-banner__ticker`
 *   4. фото переднього плану  `ct-banner__media`
 *   5. заголовок, опис, кнопка `ct-banner__box > ct-banner__content`
 *
 * 🔴 СТРУКТУРА З ТЕМИ, НЕ З ГОЛОВИ — І НЕ З `grid-banner`. Бриф назвав
 * `grid-banner.build.css`, але в демо-сторі `grid-banner` — це два
 * фото-картки поруч (`grid-banner__item` × 2, `flex-direction:row` від
 * 1200px) без жодного біжучого тексту; у ньому з описаного власником є
 * лише розмита підкладка під текстом (`grid-banner__filter`,
 * `backdrop-filter:blur(60px)`). Описаний ним стек шарів один в один
 * дає `interactive-slides__slide` (`interactive-slides.build.css`,
 * 145 правил, 20 655 байт; читано 08.11.2026):
 *
 *   .interactive-slides__slide{position:relative;overflow:hidden;
 *       display:flex;justify-content:flex-end;flex-direction:column;
 *       min-height:var(--height-mobile, 100vh);
 *       border-radius:var(--global-border-radius)}
 *   .interactive-slides__slide-background{position:absolute;top:0;left:0;
 *       width:100%;height:100%;object-fit:cover}
 *   .interactive-slides__slide-overlay{position:absolute;top:0;left:0;
 *       z-index:3;width:100%;height:100%;background:var(--color-overlay)}
 *   .interactive-slides__slide:has(.interactive-slides__slide-overlay--blur)
 *       .interactive-slides__slide-background{filter:blur(100px);
 *       transform:scale(1.4)}
 *   .interactive-slides__main-content-wrapper{padding:88px 16px 0;
 *       margin:auto;width:100%}                       ≥992: 230px 32px 0
 *   .interactive-slides__main-content{position:relative;z-index:4;
 *       text-align:center;display:flex;flex-direction:column;
 *       align-items:center}                           ≥992: min-height:360px
 *   .interactive-slides__ticker{overflow:hidden;display:flex;
 *       width:calc(100% + 32px);--animateEnd:-50%}     ≥992: +64px
 *   .interactive-slides__ticker-items{display:inline-flex;…
 *       animation-name:animate;animation-direction:var(--direction);
 *       animation-duration:var(--mobile-movement-speed);…infinite}
 *                                   ≥992: var(--desktop-movement-speed)
 *   .interactive-slides__ticker-item{padding:0 12px;white-space:nowrap;
 *       color:var(--big-heading-color);font-size:var(--text-size-mobile)}
 *                                   ≥992: 0 30px; var(--text-size-desktop)
 *   .interactive-slides__main-content-media-wrapper{width:335px;
 *       height:223px;border-radius:calc(var(--global-border-radius) * 1.5);
 *       overflow:hidden;margin-top:-16px}
 *       ≥992: position:absolute;top:50%;left:50%;
 *             transform:translate(-50%,-50%);width:540px;height:360px;
 *             border-radius:calc(var(--global-border-radius) * 2)
 *   .interactive-slides__slide-box{padding:16px 16px 85px;z-index:4}
 *                                   ≥992: 104px 32px 48px 48px
 *   .interactive-slides__slide-content                 ≥992: max-width:420px
 *   .interactive-slides__slide-heading{padding-bottom:16px;
 *       font-size:calc(var(--heading-font-size) * 2)}
 *   .interactive-slides__slide-button-wrapper{padding-top:16px}  ≥992: 24px
 *
 * Поріг зміни швидкості тут 992px (у самостійного тікера — 768px): так
 * у теми, і так тут.
 *
 * 🔴 ДЕ МИ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо, не підігнано:
 *
 *   - Біжучий текст у теми — `<h2>`. Тут це `<span aria-hidden>`: він
 *     декоративний, повторюється двічі заради петлі, і другий `h2` поруч
 *     зі справжнім заголовком банера плутав би структуру сторінки.
 *   - Другу копію тексту в теми клонує скрипт; тут її віддає сервер —
 *     сторінки статичні, рядок має їхати без JS.
 *   - Висота: у теми `calc(95vh − висота шапки)` через змінні її ж
 *     шапки. У нашої шапки 62px + 1px рамки (`site-chrome.tsx`), тож
 *     типово `calc(95svh - 63px)`; `svh`, а не `vh`, щоб на телефоні
 *     банер не ховався під панель браузера. Перекривається пропсом.
 *   - Акцидентний шрифт Chivo для великого тексту в нас не підключено
 *     (`docs/design-system-from-theme.md`), тож текст іде основним
 *     шрифтом вагою 700.
 *   - `prefers-reduced-motion` зупиняє рух — у теми правила немає.
 *   - Переднє фото в теми має фіксовані 335px; тут ще `max-width:100%`,
 *     щоб на 320px не вилазило за край.
 *
 * 🔴 БЕЗ ПЕРЕДНЬОГО ФОТО — БЕЗ РАМКИ. Шар `ct-banner__media` не
 * віддається зовсім, а не стоїть порожнім прямокутником.
 *
 * 🔴 CSS ЇДЕ В HTML (`<style href precedence>`): React 19 піднімає його
 * в `<head>` один раз на сторінку. Так тест читає правило з відданого
 * HTML, а не з константи. Ця сама механіка — у `ticker.tsx`.
 */

export interface LayeredBannerProps {
  /** Шар 1: фонове фото. `alt` порожній, коли фото суто декоративне. */
  background: { src: string; alt?: string };
  /** Шар 2: розмити фон (`filter:blur(100px); transform:scale(1.4)`). */
  blur?: boolean;
  /** Шар 3: текст, що біжить по колу. */
  tickerText: string;
  /** Шар 4: фото переднього плану. Немає — шару немає. */
  foreground?: { src: string; alt: string };
  /** Шар 5: заголовок… */
  heading: string;
  /** …опис… */
  description?: ReactNode;
  /** …і кнопка. */
  cta?: { href: string; label: string };
  /** `h1` на сторінці, де банер — її головний заголовок; інакше `h2`. */
  headingLevel?: 1 | 2;
  /** `--direction` теми. */
  direction?: "normal" | "reverse";
  /** `--desktop-movement-speed` / `--mobile-movement-speed`. Демо: 60s / 30s. */
  speed?: { desktop: string; mobile: string };
  /** `--text-size-desktop` / `--text-size-mobile`. Демо: 190px / 56px. */
  textSize?: { desktop: string; mobile: string };
  /** Мінімальна висота. Тема: 95vh мінус шапка. */
  minHeight?: string;
  className?: string;
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const BANNER_CSS = `
.ct-banner{--heading-color:#fff;--description-color:#fff;--big-heading-color:#fff;--color-overlay:#2323230d}
.ct-banner__slide{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;min-height:var(--ct-banner-height);border-radius:var(--r,16px)}
.ct-banner__background{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.ct-banner__overlay{position:absolute;top:0;left:0;z-index:3;width:100%;height:100%;background:var(--color-overlay)}
.ct-banner__overlay--blur{backdrop-filter:none}
.ct-banner__slide:has(.ct-banner__overlay--blur) .ct-banner__background{filter:blur(100px);transform:scale(1.4)}
.ct-banner__main{position:relative;z-index:4;margin:auto;width:100%;padding:88px 16px 0;display:flex;flex-direction:column;align-items:center;text-align:center}
.ct-banner__ticker{overflow:hidden;display:flex;width:calc(100% + 32px);--animateEnd:-50%}
.ct-banner__ticker-items{display:inline-flex;align-items:center;will-change:transform;animation-name:ct-banner-run;animation-direction:var(--direction);animation-duration:var(--mobile-movement-speed);animation-timing-function:linear;animation-delay:var(--timing-base,.4s);animation-iteration-count:infinite}
.ct-banner__ticker-item{position:relative;padding:0 12px;white-space:nowrap;font-weight:700;line-height:1;color:var(--big-heading-color);font-size:var(--text-size-mobile)}
.ct-banner__media{position:relative;display:block;width:335px;max-width:100%;height:223px;border-radius:calc(var(--r,16px) * 1.5);overflow:hidden;margin-top:-16px}
.ct-banner__media-img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}
.ct-banner__box{position:relative;z-index:4;padding:16px 16px 85px}
.ct-banner__heading{padding-bottom:16px;font-size:calc(var(--heading-font-size,16px) * 2);font-weight:700;line-height:1.2;color:var(--heading-color);text-align:center}
.ct-banner__description{color:var(--description-color);word-break:break-word;text-align:center}
.ct-banner__description a{color:currentColor}
.ct-banner__button-wrapper{padding-top:16px;text-align:center}
.ct-banner__button{min-width:220px}
[dir=rtl] .ct-banner__ticker{--animateEnd:50%}
@media(min-width:992px){.ct-banner__main{padding:230px 32px 0;min-height:360px;justify-content:center}.ct-banner__ticker{width:calc(100% + 64px)}.ct-banner__ticker-items{animation-duration:var(--desktop-movement-speed)}.ct-banner__ticker-item{padding:0 30px;font-size:var(--text-size-desktop)}.ct-banner__media{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:540px;height:360px;border-radius:calc(var(--r,16px) * 2);margin:0}.ct-banner__box{padding:104px 32px 48px 48px}.ct-banner__content{max-width:420px}.ct-banner__heading,.ct-banner__description,.ct-banner__button-wrapper{text-align:start}.ct-banner__button-wrapper{padding-top:24px}}
@keyframes ct-banner-run{0%{transform:translate(0)}to{transform:translate(var(--animateEnd))}}
@media(prefers-reduced-motion:reduce){.ct-banner__ticker-items{animation:none}}
`;

export function LayeredBanner({
  background,
  blur = false,
  tickerText,
  foreground,
  heading,
  description,
  cta,
  headingLevel = 2,
  direction = "normal",
  speed = { desktop: "60s", mobile: "30s" },
  textSize = { desktop: "190px", mobile: "56px" },
  minHeight = "calc(95svh - 63px)",
  className,
}: LayeredBannerProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  const vars = {
    "--desktop-movement-speed": speed.desktop,
    "--mobile-movement-speed": speed.mobile,
    "--direction": direction,
    "--text-size-desktop": textSize.desktop,
    "--text-size-mobile": textSize.mobile,
    "--ct-banner-height": minHeight,
  } as CSSProperties;

  const overlayClass = blur
    ? "ct-banner__overlay ct-banner__overlay--blur"
    : "ct-banner__overlay";

  return (
    <section
      className={["ct-banner", className].filter(Boolean).join(" ")}
      data-blur={blur ? "on" : "off"}
      style={vars}
    >
      <style href="ct-banner" precedence="ct-components">
        {BANNER_CSS}
      </style>
      <div className="ct-banner__slide">
        {/* Шар 1 — фон. Сирий <img>, бо `images.unoptimized: true` у
            next.config: next/image дав би той самий <img> плюс обгортку. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ct-banner__background"
          src={background.src}
          alt={background.alt ?? ""}
          fetchPriority="high"
        />
        {/* Шар 2 — накладка, з розмиттям або без. */}
        <div className={overlayClass} aria-hidden="true" />
        {/* Шари 3 і 4 — біжучий текст і переднє фото. */}
        <div className="ct-banner__main">
          <div className="ct-banner__ticker" aria-hidden="true">
            <div className="ct-banner__ticker-items">
              <span className="ct-banner__ticker-item">{tickerText}</span>
              <span className="ct-banner__ticker-item">{tickerText}</span>
            </div>
          </div>
          {foreground ? (
            <div className="ct-banner__media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="ct-banner__media-img"
                src={foreground.src}
                alt={foreground.alt}
              />
            </div>
          ) : null}
        </div>
        {/* Шар 5 — текстовий блок. */}
        <div className="ct-banner__box">
          <div className="ct-banner__content">
            <Heading className="ct-banner__heading">{heading}</Heading>
            {description ? (
              <div className="ct-banner__description">{description}</div>
            ) : null}
            {cta ? (
              <div className="ct-banner__button-wrapper">
                <ButtonLink
                  href={cta.href}
                  variant="secondary"
                  className="ct-banner__button"
                >
                  {cta.label}
                </ButtonLink>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
