"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NavItem } from "@/lib/navigation";

/**
 * Бургер-меню нижче 1200 px (CAMP-350).
 *
 * 🔴 МЕЖА 1200 px — ЧИСЛО ТЕМИ, НЕ МОЄ. В архіві Fuse
 * (`assets/main.build.css`, 267 185 байт) перемикач стоїть рівно там:
 * вісім правил меню під `(min-width: 1200px)` і чотири під
 * `(max-width: 1199.98px)`. Зокрема `.header__burger-menu-button--desktop`
 * живе під максимумом, а `--mobile` під мінімумом — тобто кнопка має два
 * окремі втілення, що міняються саме на цій межі.
 *
 * У нас це вже існуючий `--breakpoint-xl: 75rem` = 1200 px, тож нового
 * брейкпоінта не знадобилось: нижче `xl` — шухляда, від `xl` —
 * горизонтальне меню.
 *
 * 🔴 ЧОМУ НЕ `.touch-target`, ЯК У КНОПОК. Утиліта з CAMP-345 розсуває
 * зону псевдоелементом, не чіпаючи вигляду. У шапці це не працювало:
 * на 375 px навігація переносилась на два рядки за 20 px один від
 * одного, тож зони 48 px перекрились би майже повністю, і в смузі
 * перекриття клік діставався б тому посиланню, що пізніше в DOM. Дрібна
 * ціль перетворилась би на ціль, яка ловить не те.
 *
 * Тут зона справжня: пункт має власну висоту.
 *
 * Розміри зняті з архіву, не придумані:
 *   кнопка закриття   56 × 56, іконка 20
 *   список            padding 0 36px
 *   текст пункту      подвійний розмір тіла, вага 700
 *   проміжок пункту   12px
 *   рух               --timing-base (0.4s), токен уже є з CAMP-345
 *
 * 🔴 Про рух: у першій редакції цей рядок був НЕПРАВДОЮ — коментар
 * обіцяв `--timing-base`, а переходу не було зовсім, бо панель
 * рендериться умовно (`{open && …}`), і звичайний `transition` на
 * монтуванні не спрацьовує. Тепер це `@keyframes` у globals.css, і
 * тривалість справді береться з токена.
 *
 * 🔴 Вкладеність (CAMP-448). Тут стояло: «вкладеності НЕМАЄ, бо
 * `NavItem` оголошений як `{ href, label }`». Це протухло: меню переїхало
 * в базу (CAMP-365), API віддає `children`, і три підпункти в ній
 * зʼявились. Шухляда малює дітей ВКЛАДЕНИМ списком під батьком, одразу
 * видимим — другого екрана, як у теми (`.header-burger__menu-list--nested`
 * виїжджає окремою панеллю), тут немає навмисно: це ЧАСТИНА 1 картки, про
 * те, щоб пункт доїхав до читача, а не про вигляд бургера нижче 1199px.
 *
 * Розмір дитини — 1.25 тіла, вага 600; висота рядка та сама 56px, бо
 * правило 48px не знає про рівні.
 */

/** Висота рядка меню. 56 px — те саме число, що кнопка закриття в темі. */
const ITEM =
  "flex min-h-14 items-center text-[2rem] font-bold leading-tight text-heading";

/** Підпункт: менший за батька, але не нижчий за зону натискання. */
const CHILD =
  "flex min-h-14 items-center text-xl font-semibold leading-tight text-ink-2";

export function SiteNavDrawer({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // 🔴 Escape, повернення фокуса і замок прокрутки — разом, бо поодинці
  // кожне з них лишає шухляду наполовину модальною. Відкрита панель, під
  // якою сторінка їде від коліщатка, це не панель, а накладка.
  // 🔴 ДЕФЕКТ, ЗНАЙДЕНИЙ РЕЦЕНЗІЄЮ: сторінка лишалась замкненою без
  // жодного видимого контролю. `xl:hidden` — це CSS: перетягни вікно
  // через 1200 px при відкритій шухляді, і панель зникає разом із
  // кнопкою закриття, а `body { overflow: hidden }` лишається, бо його
  // знімає тільки прибирання ефекту. Заміряно 412 → 1280:
  // `{ bodyOverflow: "hidden", overlayVisible: false, burgerVisible:
  // false }`, коліщатко не рухає сторінку. На планшеті це просто
  // поворот екрана — 1024 портрет → 1366 ландшафт, і там навіть Escape
  // немає.
  //
  // 🔴 CAMP-448 (2/2): УМОВА — «КОРІНЬ ПАНЕЛІ СПРАВДІ СХОВАНИЙ», А НЕ
  // «ВІКНО ≥ 1200». Доти тут стояло `if (wide.matches) close()`, і це
  // було те саме число другим способом. В острові шухляда — єдиний шлях
  // до меню й на десктопі (`group-data-[stacked=true]/header:block`
  // перебиває `xl:hidden`), і зі старою умовою вона закривалась у той
  // самий кадр, що й відкривалась: заміряно e2e, a11y-дерево без діалогу
  // «Main menu» на 1280 px після прокручування. Тепер питаємо CSS про
  // те, чого сторож насправді боїться: панелі не видно, а замок на
  // `body` лишився. Межа живе лише в класах; тут її більше немає.
  //
  // Слухаємо і зміну медіа-запиту (перехід через 1200 px), і
  // прокручування (повернення на верх розгортає смугу й повертає
  // `xl:hidden`). Замок `overflow: hidden` на `body` робить друге
  // майже неможливим, але «майже» — не причина лишати діру.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 1200px)");
    const closeIfHidden = () => {
      const el = root.current;
      if (!el || getComputedStyle(el).display === "none") close();
    };
    closeIfHidden();
    wide.addEventListener("change", closeIfHidden);
    window.addEventListener("scroll", closeIfHidden, { passive: true });
    return () => {
      wide.removeEventListener("change", closeIfHidden);
      window.removeEventListener("scroll", closeIfHidden);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    // 🔴 Знімок ref ВСЕРЕДИНІ ефекту, не в прибиранні. Кнопка-відкривач
    // живе поза умовним блоком, тож на практиці вона та сама — але
    // правило існує саме для випадку, коли це не так, і покладатись на
    // «у нас воно не станеться» означає лишити пастку наступному.
    const toFocus = opener.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      // 🔴 ПАСТКА ФОКУСА. Без неї Tab з останнього пункту йде у вміст
      // сторінки, який зараз накритий затемненням І не прокручується —
      // тобто фокус опиняється там, де його не видно й куди не
      // доїхати. Гірше за звичайну втрату фокуса: панель рендериться
      // всередині <header>, тобто ПЕРЕД <main>, тож «далі» означає всю
      // сторінку.
      //
      // Вісім рядків замість бібліотеки: цикл по тому, що справді є в
      // панелі, а не по припущенню про її вміст.
      if (e.key !== "Tab") return;
      const stops =
        panel.current?.querySelectorAll<HTMLElement>("a[href],button");
      if (!stops || stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    // Фокус усередину: без цього той, хто ходить клавіатурою, лишається
    // на кнопці позаду панелі й табає крізь сторінку, якої не бачить.
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      toFocus?.focus();
    };
  }, [open, close]);

  return (
    <>
      {/* 🔴 CAMP-374 — радіус 16px (`rounded-card` → `--r`), як у теми
          (заміряно: бургер демо-стора 48×48, radius 16px). Розмір у нас
          56px і лишається: тема має 48, а 48 це РІВНО межа правила про
          зону натискання, і звужувати до неї заради косметики означало б
          стати на край.

          Скла на самій кнопці немає навмисно: вона лежить НА скляній
          шапці, і скло поверх скла нічого не додає — лише другий шар
          розмиття там, де під ним уже розмито. */}
      {/* 🔴 CAMP-448 (2/2). В ОСТРОВІ БУРГЕР Є Й ВІД 1200 px, бо
          горизонтальне меню там сховане (site-chrome.tsx; тема:
          `.header__menu` видиме лише в `--top-position`). Стан читається
          з `data-stacked` на `<header>` (site-header-frame.tsx), а
          `group-data-[…]:grid` виграє в `xl:hidden` специфічністю, не
          порядком.

          Кольори острова — теми, header.liquid за замовчуванням:
            stacked_menu_btn_bg #fff, stacked_menu_btn_color #000,
            stacked_menu_btn_border transparent
          (`.header-section--stacked .header__icon` у main.build.css).
          Наведення в острові лишає біле: власного hover для stacked у
          теми немає, а `hover:bg-surface-2` на темному склі дав би сіру
          пляму замість кнопки. */}
      <button
        ref={opener}
        type="button"
        data-testid="burger-open"
        aria-expanded={open}
        aria-controls="site-nav-drawer"
        aria-label="Open the menu"
        onClick={() => setOpen(true)}
        className="ml-auto grid h-14 w-14 shrink-0 place-items-center rounded-card text-heading ct-button-motion hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue xl:hidden group-data-[stacked=true]/header:grid group-data-[stacked=true]/header:bg-[#fff] group-data-[stacked=true]/header:text-[#000] group-data-[stacked=true]/header:hover:bg-[#fff]"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
        >
          <path
            d="M2 5h16M2 10h16M2 15h16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {/* 🔴 Панель у DOM тільки коли відкрита. Схована через `hidden`
          вона лишалась би в послідовності читання для частини читачів
          екрана, і шість посилань зачитувались би двічі. */}
      {/* 🔴 `xl:hidden` на корені панелі — щоб перехід через 1200 px не
          лишив сторінку замкненою під нею (burger-menu.spec.ts). В
          острові ж шухляда — єдиний шлях до меню й на десктопі, тож
          `group-data-[stacked=true]/header:block` повертає її. */}
      {open && (
        <div
          id="site-nav-drawer"
          ref={root}
          className="fixed inset-0 xl:hidden group-data-[stacked=true]/header:block"
          style={{ zIndex: "var(--layer-pop-out-overlay)" }}
        >
          {/* Затемнення. Клік по ньому закриває — як у темі. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="burger-scrim"
            onClick={close}
            className="absolute inset-0 w-full cursor-default bg-ink/40"
          />

          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Main menu"
            data-testid="burger-panel"
            className="ct-drawer absolute inset-y-0 left-0 flex w-[min(100%,22rem)] flex-col bg-surface pb-3 shadow-[var(--shadow-pop)]"
          >
            <div className="flex p-3">
              <button
                type="button"
                data-testid="burger-close"
                onClick={close}
                aria-label="Close the menu"
                className="grid h-14 w-14 place-items-center rounded-card text-heading ct-button-motion hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  fill="none"
                >
                  <path
                    d="M4 4l12 12M16 4L4 16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <nav
              aria-label="Main"
              className="min-h-0 flex-1 overflow-y-auto px-9"
            >
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} onClick={close} className={ITEM}>
                      {item.label}
                    </Link>
                    {item.children.length > 0 && (
                      <ul
                        data-nav-children={item.href}
                        aria-label={`${item.label} pages`}
                        className="flex flex-col gap-1 ps-6"
                      >
                        {item.children.map((child) => (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              onClick={close}
                              className={CHILD}
                            >
                              {child.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
