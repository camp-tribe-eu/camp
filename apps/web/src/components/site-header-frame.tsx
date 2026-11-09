"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

/**
 * Каркас шапки: смуга на всю ширину вгорі сторінки, острів-пігулка по
 * центру — щойно читач прокрутив (CAMP-448, частина 2).
 *
 * 🔴 ОСТРІВ ЖИВЕ ВСЕРЕДИНІ `sticky`, А САМ `<header>` ЛИШАЄТЬСЯ В ПОТОЦІ.
 * Рішення CAMP-374 (`sticky`, а не `fixed`) не чіпаємо: стискається
 * внутрішній контейнер, а коробка `<header>` зберігає ту саму висоту в
 * обох станах — тож перший елемент кожної сторінки й далі починається
 * під шапкою, і компенсувати на `body` нема чого.
 *
 * І це НЕ відхилення від теми, а її ж структура. Заміряно 08.11.2026 в
 * архіві `fuse 1.0.1.zip`, `assets/main.build.css`:
 *
 *   .header-section { position: var(--header-position); top: 4px;
 *                     z-index: 13; width: calc(100% - 8px); margin: 0 auto;
 *                     transition-property: transform, top;
 *                     transition-duration: var(--timing-base) }
 *   sections/header.liquid: --header-position: sticky   (enable_sticky_header = true)
 *
 * тобто секція шапки теми сама `sticky`; `fixed` вона лише у варіанті
 * `.header-section--transparent` (головна й колекція поверх героя), і
 * саме той варіант заміряла CAMP-374 на демо-сторі.
 *
 * 🔴 ЧИСЛА ОСТРОВА — З ТОГО Ж ФАЙЛУ, не вигадані:
 *
 *   .header-section.header-section--stacked         max-width: 480px
 *   .header-section.header-section--stacked .header max-width: 480px
 *   .header-section                                 width: calc(100% - 8px); top: 4px
 *   @media (min-width:1200px) .header-section       width: calc(100% - 24px); padding-top: 12px
 *   .header .header__container                      padding: 16px 8px;
 *                                                   border-radius: var(--global-border-radius) (16px);
 *                                                   transition: background-color var(--timing-base)
 *   .header-section--stacked .header__container     background-color: var(--stacked-header-bg)
 *                                                   (header.liquid, stacked_bg, default #232323cc)
 *   .bg-glass-dark (ставиться на контейнер, коли    background: rgba(35,35,35,.8);
 *     stacked_enable_glass, default true)           backdrop-filter: blur(8px) saturate(200%);
 *                                                   box-shadow: <вісім inset + 0 1px 5px + 0 6px 16px>
 *   :has(.header--full-width):not(--stacked)        width: 100%; top: 0; padding-top: 0;
 *     .header__container                            border-radius: 0
 *
 * Останній рядок — наш випадок: до прокручування смуга на всю ширину без
 * радіуса, після — острів. Ширину тема НЕ анімує (перехід лише на
 * `background-color`, `transform` і `top`), тож і ми її не анімуємо.
 *
 * 🔴 ПОРІГ — ТЕЖ ЇЇ, з `assets/section-header.build.js`,
 * `headerTopPositionHandler`: `window.scrollY <= 0` → `--top-position`,
 * інакше `--stacked`. Нуль, а не «кілька пікселів»: будь-яке прокручування
 * стискає шапку, повернення на самий верх розгортає.
 *
 * 🔴 ДЕ МИ РОЗІЙШЛИСЬ ІЗ ТЕМОЮ, І ЧОМУ:
 *   • у теми `padding-top: 12px` на секції зʼявляється в стані stacked —
 *     тобто висота секції росте й вміст під нею стрибає. У нас зсув
 *     робить `position: relative; top`, який висоти не міняє: нуль CLS.
 *   • висоту ряду тримаємо свою (62px) в обох станах з тієї ж причини;
 *     у теми контейнер острова 16px 8px навколо кнопки 46px.
 *   • `transform` на острові не вживаємо навмисно: він зробив би острів
 *     контейнером для `fixed`-шухляди (та сама пастка, що й
 *     `backdrop-filter`, див. site-chrome.tsx).
 *
 * 🔴 СКЛО ОСТРОВА — НА ТОМУ Ж ОКРЕМОМУ ШАРІ, що й скло смуги, і з тієї ж
 * причини: `backdrop-filter` робить елемент контейнером для `fixed`.
 * Шухляда меню лежить у ряду, а не в шарі, тож вікно лишається вікном.
 */

/** Поріг прокручування, px. Число теми: `window.scrollY <= 0` → верх. */
export const STACK_AFTER_PX = 0;

/** Чи шапка в стані острова за поточним `scrollY`. */
export function isStacked(scrollY: number): boolean {
  return scrollY > STACK_AFTER_PX;
}

/**
 * Дослівно `.bg-glass-dark` теми (main.build.css:644). Тло — її ж
 * `stacked_bg` за замовчуванням, `#232323cc` = rgba(35,35,35,.8).
 * Інлайном, а не класом: вісім inset-тіней у довільному класі Tailwind
 * нечитабельні, а в globals.css цієї картки доступу немає.
 */
export const ISLAND_GLASS: CSSProperties = {
  backgroundColor: "rgba(35, 35, 35, 0.8)",
  backdropFilter: "blur(8px) saturate(200%)",
  WebkitBackdropFilter: "blur(8px) saturate(200%)",
  boxShadow: [
    "inset 1px 1px 0.3px -0.5px color-mix(in srgb, #fff 70%, transparent)",
    "inset 0.8px 3px 0px -2.5px color-mix(in srgb, #fff 42%, transparent)",
    "inset -0.5px 0px 1px 0px color-mix(in srgb, #fff 56%, transparent)",
    "inset -3px -6px 1px -6px color-mix(in srgb, #fff 42%, transparent)",
    "inset -0.3px -1px 4px 0px color-mix(in srgb, #fff 24%, transparent)",
    "inset -1.5px 2.5px 0px -2px color-mix(in srgb, #000 40%, transparent)",
    "inset 0px 3px 4px -2px color-mix(in srgb, #000 0%, transparent)",
    "inset 2px -1.5px 1px -4px color-mix(in srgb, #fff 20%, transparent)",
    "0px 1px 5px 0px color-mix(in srgb, #000 20%, transparent)",
    "0px 6px 16px 0px color-mix(in srgb, #fff 16%, transparent)",
  ].join(", "),
};

/** Смуга: на всю ширину, з нижньою лінією — як було до цієї картки. */
const BAR_TOP = "relative w-full border-b border-line-2";

/**
 * Острів: 480px, по центру, відступ від країв 4px (від 1200 — 12px),
 * зсув від верху 4px (від 1200 — 12px), радіус 16px. Лінія знизу стає
 * прозорою, а не зникає — інакше коробка шапки стала б на 1px нижчою й
 * сторінка під нею стрибнула б.
 */
const BAR_STACKED =
  "relative mx-auto w-[calc(100%-8px)] max-w-[480px] rounded-card border-b border-transparent top-1 xl:w-[calc(100%-24px)] xl:top-3";

/** Шар скла: у смузі — `.ct-glass`, в острові — скло теми поверх 1px лінії. */
const GLASS_TOP = "ct-glass pointer-events-none absolute inset-0";
const GLASS_STACKED =
  "pointer-events-none absolute inset-x-0 top-0 -bottom-px rounded-[inherit]";
const GLASS_MOTION =
  " transition-[background-color,box-shadow] [transition-duration:var(--timing-base)] [transition-timing-function:var(--ease)] motion-reduce:transition-none";

/** Ряд: у смузі — поля розкладки; в острові — 8px теми. */
const ROW =
  "relative flex min-h-[62px] flex-wrap items-center gap-x-6 gap-y-2 py-2 sm:h-[62px] sm:flex-nowrap sm:py-0";
const ROW_TOP = " mx-auto max-w-wrap px-4 xl:px-6";
const ROW_STACKED = " px-2";

/**
 * Чистий каркас без стану — те, що юніт рендерить у двох станах і читає як
 * HTML. `data-stacked` на `<header>` — єдине джерело стану для нащадків:
 * меню, лого й бургер у `site-chrome.tsx` і `site-nav-drawer.tsx` читають
 * його через `group-data-[stacked=true]/header:*`.
 */
export function HeaderFrame({
  stacked,
  children,
  ref,
}: {
  stacked: boolean;
  children: ReactNode;
  /** The `<header>` itself, for whoever has to measure it (SiteHeaderFrame). */
  ref?: Ref<HTMLElement>;
}) {
  return (
    <header
      ref={ref}
      data-testid="site-header"
      data-stacked={stacked ? "true" : "false"}
      className="group/header sticky top-0"
      style={{ zIndex: "var(--layer-sticky)" }}
    >
      <div
        data-testid="site-header-bar"
        className={stacked ? BAR_STACKED : BAR_TOP}
      >
        <div
          aria-hidden="true"
          data-testid="site-glass"
          className={(stacked ? GLASS_STACKED : GLASS_TOP) + GLASS_MOTION}
          style={stacked ? ISLAND_GLASS : undefined}
        />
        <div className={ROW + (stacked ? ROW_STACKED : ROW_TOP)}>{children}</div>
      </div>
    </header>
  );
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

function getSnapshot(): boolean {
  return isStacked(window.scrollY);
}

/** На сервері прокручування немає — віддається смуга. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Каркас зі станом: читає `scrollY` і перемикає `HeaderFrame`.
 * `useSyncExternalStore`, а не `useEffect`+`useState`: стан береться з
 * вікна одразу при монтуванні (сторінка, відкрита посеред тексту, одразу
 * має острів, як `headerTopPositionHandler()` в `init()` теми), і жодного
 * `setState` в ефекті.
 */
export function SiteHeaderFrame({ children }: { children: ReactNode }) {
  const stacked = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const header = useRef<HTMLElement>(null);

  // 🔴 CAMP-452: ВИСОТА ШАПКИ — ЗМІННА, ЯКУ ПИШЕ САМА ШАПКА, а не число,
  // переписане в інший файл. Усе липке під нею (смуга фільтрів і мапа
  // регіону) стоїть на `top: calc(var(--ct-header-h, 63px) + 24px)` —
  // «+ 24px» теми під її ж липкою шапкою. Заміряно 09.11.2026 у Chromium:
  // від `sm` ряд рівно 62px + 1px лінії = 63; нижче `sm` ряд має `py-2`
  // навколо бургера 56px — 72 + 1 = 73. Перша редакція тримала 63 у CSS
  // смуги, і e2e на 375px упав: смуга стояла на 87 замість 97 — під
  // шапкою не сховалась, але проміжок теми був 14, а не 24. Константа,
  // що копіює чужу висоту, розходиться з нею мовчки; ResizeObserver читає
  // її з коробки. Без JavaScript лишається запасне 63px.
  useEffect(() => {
    const el = header.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const write = () =>
      root.style.setProperty("--ct-header-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--ct-header-h");
    };
  }, []);

  return (
    <HeaderFrame ref={header} stacked={stacked}>
      {children}
    </HeaderFrame>
  );
}
