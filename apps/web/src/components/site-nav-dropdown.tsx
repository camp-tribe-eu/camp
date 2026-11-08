"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { NavItem } from "@/lib/navigation";

/**
 * Пункт шапки з підпунктами — розкривач (CAMP-448, частина 1).
 *
 * 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Ієрархія меню була підтримана наскрізь — у
 * схемі є `parent_id`, API віддає `children`, тип його має — а шапка в
 * `site-chrome.tsx` робила `nav.map((item) => <Link>)` і дітей не
 * читала. Підпункт, заведений у базі, не зʼявився б ніде й без помилки.
 * Саме так три готові сторінки (`/tools/camper-trip-cost`,
 * `/tools/camper-packing-list`, `/camper-rental/providers`) прожили
 * невидимими.
 *
 * 🔴 РОЗМІТКА — ЗА ТЕМОЮ FUSE, числа читано з її `assets/main.build.css`
 * (архів `fuse 1.0.1.zip`, 08.11.2026), не вигадано:
 *
 *   .header-menu__list--nested   position:absolute; min-width:220px;
 *                                max-width:320px; max-height:min(60vh,400px);
 *                                overflow:auto; border:1px solid;
 *                                border-radius:var(--global-border-radius)
 *                                (16px); transition opacity,visibility
 *                                var(--timing-base)
 *   .header-menu__list-item      border-bottom:1px solid; last-child none
 *   .header-menu__item-second-lvl padding:15px 20px;
 *                                font-size:calc(var(--body-font-size)*1.125);
 *                                font-weight:600; line-height:1.44
 *   .header-menu__item-toggle-icon margin-inline-start:6px; .icon 16×16;
 *                                is-active → rotate(-180deg),
 *                                transition var(--timing-base)
 *
 * Перша рівень у теми — `padding:8px 16px`, радіус 12px і підсвітка
 * активного пункту. Його тут НЕ чіпаємо: вигляд самої шапки (острів,
 * бургер нижче 1199px) — друга частина картки, а ця — лише про те, щоб
 * діти доїхали до читача.
 *
 * 🔴 ПОВЕДІНКА — ТЕЖ ЇЇ, з `assets/section-header.build.js`:
 *   відкриття   `mouseenter` (налаштування `open_menu_type`, за
 *               замовчуванням `hover`) і клік по тригеру;
 *   закриття    `mouseleave` з витримкою 500 мс (`timeout = 500`),
 *               клік поза меню, Escape (`EscEvent:on`);
 *   стан        `aria-expanded` на тригері, `aria-controls` на список.
 *
 * 🔴 ТРИГЕР — ОКРЕМА КНОПКА ПОРУЧ ІЗ ПОСИЛАННЯМ, а не посилання з
 * `aria-expanded`. У теми другий рівень із власною адресою зроблено саме
 * так (`<a href>` + `<button class="js-accordion-control">`), і причина
 * в нас та сама: `/tools` — справжня сторінка, і клік по слову має вести
 * на неї, а не лише розгортати. Кнопка ж дає клавіатурі окремий крок:
 * Enter на посиланні переходить, Enter на кнопці розкриває.
 *
 * 🔴 ПАНЕЛЬ ЛИШАЄТЬСЯ В DOM І ХОВАЄТЬСЯ `visibility:hidden` + `opacity:0`
 * — як у теми, а не умовним рендером. Три причини: (1) перехід на
 * відкриття можливий лише тоді, коли є від чого переходити; (2) сховане
 * через `visibility` не отримує фокус і не читається читачем екрана —
 * тобто рівно те, чого треба від закритого меню; (3) без JS посилання
 * дітей уже в HTML, і `<noscript>` у шапці повертає їх на екран, як
 * повертає саме меню.
 */

/** Витримка закриття після відходу миші. Число теми: `timeout = 500`. */
const CLOSE_DELAY_MS = 500;

export function NavDropdown({ item }: { item: NavItem }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLLIElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = `nav-sub-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  const cancelClose = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  // Таймер не має пережити компонент.
  useEffect(() => cancelClose, [cancelClose]);

  // Клік поза пунктом закриває — як `on("click", document, …)` у теми.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  return (
    <li
      ref={root}
      data-nav-parent={item.href}
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        close();
        trigger.current?.focus();
      }}
      // Фокус пішов з пункту цілком (Tab далі по шапці) — меню закривається,
      // інакше відкрита панель лишилась би висіти без жодного шляху закрити
      // її клавіатурою, крім повернення назад.
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <div className="flex items-center">
        <Link href={item.href} className="hover:text-heading">
          {item.label}
        </Link>
        {/* 🔴 `touch-target`: іконка 16px, а зона натискання мусить бути
            48px (CAMP-345). Утиліта розсуває зону псевдоелементом і
            вимагає `relative` на самій кнопці. */}
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${item.label} submenu`}
          onClick={() => (open ? close() : setOpen(true))}
          className="touch-target relative ms-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-2 ct-button-motion hover:text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            className={
              "transition-transform [transition-duration:var(--timing-base)] [transition-timing-function:var(--ease)] motion-reduce:transition-none" +
              (open ? " -rotate-180" : "")
            }
          >
            <path
              d="M3.5 6l4.5 4.5L12.5 6"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* 🔴 `pt-2` — МІСТОК для миші між словом і панеллю, а не відступ
          заради вигляду. Панель лежить усередині того самого `<li>`, тож
          курсор, що йде вниз через ці 8px, не викликає `mouseleave`. У
          теми ту саму роль грає `.is-active::before` на тригері. */}
      <div
        id={panelId}
        data-nav-sub
        className={
          "absolute left-0 top-full z-10 pt-2 transition-[opacity,visibility] [transition-duration:var(--timing-base)] [transition-timing-function:var(--ease)] motion-reduce:transition-none" +
          (open ? " visible opacity-100" : " invisible opacity-0")
        }
      >
        <ul className="flex max-h-[min(60vh,400px)] min-w-[220px] max-w-[320px] flex-col divide-y divide-line-2 overflow-auto rounded-card border border-line-2 bg-surface shadow-[var(--shadow-pop)]">
          {item.children.map((child) => (
            <li key={child.href}>
              <Link
                href={child.href}
                onClick={close}
                className="flex items-center px-5 py-[15px] text-base font-semibold leading-[1.44] text-heading ct-button-motion hover:bg-surface-2"
              >
                {child.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
