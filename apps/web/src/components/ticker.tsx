import type { CSSProperties, ReactNode } from "react";

/**
 * Біжучий рядок (тікер) — CAMP-449, перша частина.
 *
 * 🔴 СТРУКТУРА З ТЕМИ, НЕ З ГОЛОВИ. Власник сказав прямо: «стилі і
 * темплейти ми беремо із теми». Розмітка й правила нижче повторюють
 * `ticker.build.css` демо-стору Fuse (25 правил, 2 599 байт; читано
 * 08.11.2026 командою `curl … | grep -o '{' | wc -l`), перейменовані
 * з `ticker__*` на `ct-ticker__*`, щоб у збірці не було чужих класів.
 * Файли теми в git не кладемо — це закритий код власника.
 *
 * Що взято дослівно:
 *
 *   .ticker{overflow:hidden;display:flex;width:100%;
 *           font-size:var(--text-size-mobile);--animateEnd:-50%}
 *   .ticker .ticker__items{display:inline-flex;align-items:center;
 *           will-change:transform;animation-name:animate;
 *           animation-direction:var(--direction);
 *           animation-duration:var(--mobile-movement-speed);
 *           animation-timing-function:linear;
 *           animation-delay:var(--timing-base);
 *           animation-iteration-count:infinite}
 *   .ticker .ticker__item{… gap:24px;padding:0 12px;font-weight:700;
 *           color:var(--text-color, #343D50);white-space:nowrap}
 *   @media(min-width:768px){ font-size:var(--text-size-desktop);
 *           animation-duration:var(--desktop-movement-speed);
 *           gap:60px;padding:0 30px }
 *   @keyframes animate{0%{transform:translate(0)}
 *                      to{transform:translate(var(--animateEnd))}}
 *   body.rtl .ticker{--animateEnd: 50%}
 *
 * Тобто швидкість і напрямок тема задає ТРЬОМА ЗМІННИМИ на корені
 * секції — `--desktop-movement-speed`, `--mobile-movement-speed`,
 * `--direction` — і CSS читає їх як `animation-duration` (перемикаючись
 * на 768px) та `animation-direction`. Тут так само: пропси лягають у
 * `style` кореня під тими ж іменами.
 *
 * 🔴 ЧОМУ ЕЛЕМЕНТИ ВІДДАЮТЬСЯ ДВІЧІ. Кадр їде до `-50%`, тобто рівно на
 * половину доріжки: щоб петля була безшовною, доріжка мусить містити
 * вміст двічі. У теми другу копію клонує скрипт (`ticker-*.js`) після
 * завантаження; у нас її віддає сервер, бо сторінки статичні й рядок
 * має їхати без жодного JS. Копія позначена `aria-hidden`, щоб читач
 * з екранним диктором не чув усе двічі.
 *
 * 🔴 `prefers-reduced-motion` ЗУПИНЯЄ РУХ. Це доступність, не прикраса:
 * людині, яка про це попросила, рядок просто стоїть. У теми цього
 * правила немає — це єдине, що тут додано понад її CSS.
 *
 * 🔴 ОДИН ЗІПСОВАНИЙ ЕЛЕМЕНТ КОШТУЄ ОДНОГО ЕЛЕМЕНТА. `null`, `undefined`,
 * `false` і порожній рядок пропускаються поодинці; тікер без жодного
 * живого елемента не рендериться зовсім — порожнє не малюємо.
 *
 * 🔴 CSS ЇДЕ В HTML, А НЕ В globals.css. React 19 піднімає
 * `<style href precedence>` у `<head>` і віддає його один раз на
 * сторінку, скільки б тікерів на ній не стояло (заміряно зондом через
 * `renderToStaticMarkup` 08.11.2026: два однакові `href` → один
 * `<style>`). Так правило `prefers-reduced-motion` стоїть у відданому
 * HTML, і тест читає саме його, а не константу.
 */

export interface TickerProps {
  /**
   * Елементи рядка — будь-що: текст, текст із картинкою (`TickerImage`),
   * прапор + назва + число. Порожні й `null` пропускаються поодинці.
   */
  items: ReadonlyArray<ReactNode>;
  /** Підпис для допоміжних технологій. */
  label?: string;
  /** `--direction` теми: `normal` їде вліво, `reverse` — вправо. */
  direction?: "normal" | "reverse";
  /**
   * `--desktop-movement-speed` / `--mobile-movement-speed` теми — час
   * одного проходу. Типові значення — її ж демо-стору: 60s / 30s.
   */
  speed?: { desktop: string; mobile: string };
  /** `--text-size-desktop` / `--text-size-mobile`. Демо-стор: 180px / 48px. */
  textSize?: { desktop: string; mobile: string };
  /** `--image-width-desktop` / `--image-width-mobile`. Демо-стор: 204px / 80px. */
  imageWidth?: { desktop: string; mobile: string };
  /** `ticker--pause-on-hover` теми: наведення й фокус зупиняють рух. */
  pauseOnHover?: boolean;
  className?: string;
}

/** Картинка в елементі рядка — `ticker__image-wrapper` + `ticker__image`. */
export function TickerImage({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="ct-ticker__image-wrapper">
      {/* eslint-disable-next-line @next/next/no-img-element --
          `images.unoptimized: true` у next.config: next/image дав би той
          самий <img> плюс обгортку, а розмір тут задає CSS теми. */}
      <img className="ct-ticker__image" src={src} alt={alt} loading="lazy" />
    </span>
  );
}

/** Живий елемент — усе, крім `null`, `undefined`, `false` і порожнього рядка. */
function isLive(item: ReactNode): boolean {
  if (item === null || item === undefined || item === false) return false;
  if (typeof item === "string") return item.trim() !== "";
  return true;
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const TICKER_CSS = `
.ct-ticker{overflow:hidden;display:flex;width:100%;font-size:var(--text-size-mobile);--animateEnd:-50%}
.ct-ticker__items{display:inline-flex;align-items:center;will-change:transform;animation-name:ct-ticker-run;animation-direction:var(--direction);animation-duration:var(--mobile-movement-speed);animation-timing-function:linear;animation-delay:var(--timing-base,.4s);animation-iteration-count:infinite}
.ct-ticker__item{position:relative;display:flex;align-items:center;gap:24px;padding:0 12px;font-weight:700;color:var(--text-color,var(--heading,#343d50));white-space:nowrap}
.ct-ticker__item a{color:inherit}
.ct-ticker__item-link{display:flex}
.ct-ticker__image-wrapper{display:block;aspect-ratio:1;width:var(--image-width-mobile);position:relative;border-radius:calc(var(--r,16px) * .75);overflow:hidden}
.ct-ticker__image{position:absolute;top:0;right:0;bottom:0;left:0;height:100%;width:100%;object-fit:cover;transition:transform var(--timing-base,.4s)}
.ct-ticker--pause-on-hover:focus-within .ct-ticker__items{animation-play-state:paused}
@media(hover:hover),(pointer:fine){.ct-ticker--pause-on-hover:hover .ct-ticker__items{animation-play-state:paused}.ct-ticker__item-link:hover .ct-ticker__image{transform:scale(1.15)}}
@media(min-width:768px){.ct-ticker{font-size:var(--text-size-desktop)}.ct-ticker__items{animation-duration:var(--desktop-movement-speed)}.ct-ticker__item{gap:60px;padding:0 30px}.ct-ticker__image-wrapper{width:var(--image-width-desktop);border-radius:calc(var(--r,16px) * 1.5)}}
[dir=rtl] .ct-ticker{--animateEnd:50%}
@keyframes ct-ticker-run{0%{transform:translate(0)}to{transform:translate(var(--animateEnd))}}
@media(prefers-reduced-motion:reduce){.ct-ticker__items{animation:none}}
`;

export function Ticker({
  items,
  label,
  direction = "normal",
  speed = { desktop: "60s", mobile: "30s" },
  textSize = { desktop: "180px", mobile: "48px" },
  imageWidth = { desktop: "204px", mobile: "80px" },
  pauseOnHover = true,
  className,
}: TickerProps) {
  const live = items.filter(isLive);
  if (live.length === 0) return null;

  const vars = {
    "--desktop-movement-speed": speed.desktop,
    "--mobile-movement-speed": speed.mobile,
    "--direction": direction,
    "--text-size-desktop": textSize.desktop,
    "--text-size-mobile": textSize.mobile,
    "--image-width-desktop": imageWidth.desktop,
    "--image-width-mobile": imageWidth.mobile,
  } as CSSProperties;

  const classes = [
    "ct-ticker",
    pauseOnHover && "ct-ticker--pause-on-hover",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} role="marquee" aria-label={label} style={vars}>
      <style href="ct-ticker" precedence="ct-components">
        {TICKER_CSS}
      </style>
      <div className="ct-ticker__items">
        {live.map((item, i) => (
          <div className="ct-ticker__item" key={`a${i}`}>
            {item}
          </div>
        ))}
        {live.map((item, i) => (
          <div className="ct-ticker__item" aria-hidden="true" key={`b${i}`}>
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}
