"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { buttonClasses } from "./button";
import { isInternalHref } from "@/lib/rich-text";
import type { SlideView } from "@/lib/slides";

/**
 * Слайдер першого екрана — CAMP-488.
 *
 * 🔴 СТРУКТУРА З ТЕМИ, НЕ З ГОЛОВИ. Взято з `interactive-slides` Fuse
 * (`interactive-slides.build.css`; числа прочитано з `ct-banner` у
 * `layered-banner.tsx`, де той самий файл уже розібрано 08.11.2026):
 *
 *   .interactive-slides__slide{position:relative;overflow:hidden;
 *       display:flex;justify-content:flex-end;flex-direction:column;
 *       border-radius:var(--global-border-radius)}
 *   .interactive-slides__slide-background{position:absolute;inset:0;
 *       width:100%;height:100%;object-fit:cover}
 *   .interactive-slides__slide-overlay{position:absolute;inset:0;z-index:3}
 *   .interactive-slides__slide-box{padding:16px 16px 85px;z-index:4}
 *                                   ≥992: 104px 32px 48px 48px
 *   .interactive-slides__slide-content ≥992: max-width:420px
 *   .interactive-slides__slide-heading{padding-bottom:16px;
 *       font-size:calc(var(--heading-font-size) * 2)}
 *   .interactive-slides__slide-button-wrapper{padding-top:16px} ≥992: 24px
 *
 * Знизу праворуч у темі стоять мініатюри слайдів із кнопками «назад»
 * (знімок `fuse/full/f-home-1440-top.png`); те саме тут: мініатюри — це
 * кнопки переходу, а не прикраса.
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо:
 *   - У теми перемикання на JS. Тут усі слайди ЛЕЖАТЬ У РОЗМІТЦІ й
 *     гортаються нативним `scroll-snap`: без скриптів слайдер свайпається,
 *     а пошук і читач екрана бачать усі три заголовки й кнопки.
 *   - Автопрокрутки немає. Рух, який читач не просив, ламає WCAG 2.2.2, а
 *     три слайди з трьома кнопками — це воронка, а не стрічка новин.
 *   - Тут немає біжучого тексту й вирізаної фігури: це шари іншого
 *     банера теми (`layered-banner.tsx`); власник просив слайдер із фото й
 *     кнопкою.
 *
 * 🔴 `<img>`, А НЕ `next/image`: у `next.config` `images.unoptimized`, тож
 * оптимізатора немає. Перший слайд вантажиться першим (`fetchPriority`),
 * решта — ліниво: вони за межею першого екрана по горизонталі.
 *
 * 🔴 CSS ЇДЕ В HTML (`<style href precedence>`), як у `layered-banner.tsx`:
 * тест читає правило з відданої сторінки, а не з константи.
 */

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const SLIDER_CSS = `
.ct-slider{position:relative}
.ct-slider__track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;border-radius:var(--r,16px);gap:0}
.ct-slider__track::-webkit-scrollbar{display:none}
.ct-slider__track:focus-visible{outline:2px solid var(--color-line-blue);outline-offset:2px}
.ct-slide{position:relative;flex:0 0 100%;scroll-snap-align:start;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;min-height:420px;color:#fff;background:#1d2433}
.ct-slide__image{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.ct-slide__overlay{position:absolute;top:0;left:0;z-index:1;width:100%;height:100%;background:linear-gradient(to top,rgba(14,18,28,.78) 0,rgba(14,18,28,.45) 45%,rgba(14,18,28,.1) 100%)}
.ct-slide__box{position:relative;z-index:2;padding:16px 16px 85px}
.ct-slide__content{max-width:420px}
.ct-slide__eyebrow{display:block;margin-bottom:8px;font-size:.875rem;font-weight:600;line-height:1.4}
.ct-slide__heading{padding-bottom:16px;font-size:calc(var(--body-font-size,16px) * 1.75);font-weight:700;line-height:1.15;color:#fff}
.ct-slide__text{font-size:1rem;line-height:1.5;color:#fff}
.ct-slide__button{padding-top:16px}
.ct-slider__controls{position:absolute;left:16px;right:16px;bottom:16px;z-index:3;display:flex;align-items:center;justify-content:center;gap:8px}
.ct-slider__arrow{display:inline-flex;align-items:center;justify-content:center;flex:0 0 48px;width:48px;height:48px;border-radius:var(--r,16px);border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.92);color:#1d2433;cursor:pointer}
.ct-slider__arrow:hover{background:#fff}
.ct-slider__arrow:focus-visible,.ct-slider__thumb:focus-visible{outline:2px solid #fff;outline-offset:2px}
.ct-slider__arrow svg{width:20px;height:20px}
.ct-slider__thumbs{display:flex;gap:8px;padding:4px;border-radius:calc(var(--r,16px) * 1.25);background:rgba(14,18,28,.45);backdrop-filter:blur(12px)}
.ct-slider__thumb{position:relative;display:block;width:56px;height:40px;padding:0;overflow:hidden;border-radius:calc(var(--r,16px) * .75);border:2px solid transparent;opacity:.75;cursor:pointer;background:#1d2433}
.ct-slider__thumb img{display:block;width:100%;height:100%;object-fit:cover}
.ct-slider__thumb[aria-current="true"]{border-color:#fff;opacity:1}
@media(min-width:768px){.ct-slide{min-height:clamp(440px,calc(100svh - 63px - 230px),600px)}.ct-slide__heading{font-size:calc(var(--body-font-size,16px) * 2.25)}.ct-slider__thumb{width:88px;height:56px}.ct-slider__controls{left:auto;right:24px;bottom:72px;justify-content:flex-end}.ct-slide__box{padding-bottom:96px}}
@media(min-width:992px){
.ct-slide{min-height:clamp(480px,calc(100svh - 63px - 230px),600px)}
.ct-slide__box{padding:104px 32px 96px 48px}
.ct-slide__heading{font-size:calc(var(--body-font-size,16px) * 2.75)}
.ct-slide__text{font-size:1.125rem}
.ct-slide__button{padding-top:24px}
}
@media(prefers-reduced-motion:reduce){.ct-slider__track{scroll-behavior:auto}}
`;

function Arrow({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path
        d={dir === "prev" ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SlideCta({ href, label }: { href: string; label: string }) {
  const testId = `slide-cta-${href.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`;
  // Кнопка слайда — «secondary» (біла, з рамкою): залита темна `primary`
  // зливається з темною накладкою фото.
  if (isInternalHref(href)) {
    return (
      <Link
        href={href}
        data-testid={testId}
        data-ct-button="secondary"
        className={buttonClasses("secondary")}
      >
        {label}
      </Link>
    );
  }
  return (
    <a
      href={href}
      data-testid={testId}
      data-ct-button="secondary"
      className={buttonClasses("secondary")}
    >
      {label}
    </a>
  );
}

export function HeroSlider({
  slides,
  label,
}: {
  slides: readonly SlideView[];
  /** Доступна назва ділянки; видимого заголовка в неї немає. */
  label: string;
}) {
  /**
   * 🔴 ПОРОЖНЄ НЕ МАЛЮЄМО. Слайдер без слайдів — це порожня рамка з двома
   * стрілками; секція каталогу, яка на порожніх даних показує рамку, гірша
   * за її відсутність.
   */
  if (slides.length === 0) return null;

  return <Slider slides={slides} label={label} />;
}

function Slider({
  slides,
  label,
}: {
  slides: readonly SlideView[];
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const many = slides.length > 1;

  const go = useCallback(
    (i: number) => {
      const el = track.current;
      if (!el) return;
      const n = (i + slides.length) % slides.length;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ left: n * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
      setActive(n);
    },
    [slides.length],
  );

  // Активний слайд читаємо з положення прокрутки: читач міг гортнути
  // пальцем, а не кнопкою.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const i = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
        setActive(Math.min(Math.max(i, 0), slides.length - 1));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [slides.length]);

  return (
    <section
      className="ct-slider"
      aria-roledescription="carousel"
      aria-label={label}
      data-testid="home-slider"
    >
      <style href="ct-slider" precedence="ct-components">
        {SLIDER_CSS}
      </style>
      <div
        ref={track}
        className="ct-slider__track"
        // Фокус на доріжці дозволяє гортати стрілками клавіатури.
        tabIndex={0}
        role="group"
        aria-label={`${label}, slides`}
        data-testid="home-slider-track"
      >
        {slides.map((s, i) => (
          <article
            key={s.key}
            className="ct-slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}`}
            data-testid="home-slide"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
            <img
              className="ct-slide__image"
              src={s.image.src}
              alt={s.image.alt}
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : undefined}
              draggable={false}
            />
            <div className="ct-slide__overlay" aria-hidden="true" />
            <div className="ct-slide__box">
              <div className="ct-slide__content">
                {s.eyebrow ? (
                  <span className="ct-slide__eyebrow">{s.eyebrow}</span>
                ) : null}
                {/* 🔴 ОДИН h1 НА ГОЛОВНІЙ — ПЕРШИЙ СЛАЙД. Старий блок
                    «Every campsite, and what is around it» прибрано як дубль
                    заголовка; решта слайдів — h2, бо h1 у сторінки один. */}
                {i === 0 ? (
                  <h1 className="ct-slide__heading">{s.heading}</h1>
                ) : (
                  <h2 className="ct-slide__heading">{s.heading}</h2>
                )}
                {s.body ? <p className="ct-slide__text">{s.body}</p> : null}
                {s.cta ? (
                  <div className="ct-slide__button">
                    <SlideCta href={s.cta.href} label={s.cta.label} />
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>

      {many ? (
        <div className="ct-slider__controls">
          <button
            type="button"
            className="ct-slider__arrow"
            aria-label="Previous slide"
            onClick={() => go(active - 1)}
          >
            <Arrow dir="prev" />
          </button>
          <div className="ct-slider__thumbs">
            {slides.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className="ct-slider__thumb"
                aria-label={`Show slide ${i + 1}: ${s.heading}`}
                aria-current={i === active ? "true" : undefined}
                onClick={() => go(i)}
                data-testid="home-slider-thumb"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
                <img src={s.image.src} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ct-slider__arrow"
            aria-label="Next slide"
            onClick={() => go(active + 1)}
          >
            <Arrow dir="next" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
