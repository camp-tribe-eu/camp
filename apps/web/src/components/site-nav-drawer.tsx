'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

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
 * 🔴 Вкладеності тут НЕМАЄ, і це не спрощення з ліні. `NavItem` у
 * `site-chrome.tsx` оголошений як `{ href, label }` — поля для дітей не
 * існує, усі шість пунктів плоскі. Зібрати другий рівень і мега-меню
 * для навігації без жодного вкладеного пункту означало б написати код,
 * жодна гілка якого не виконається й жоден тест не доведе. Коли діти
 * зʼявляться (найраніше CAMP-45 і CAMP-54), розміри вже зняті в
 * коментарі до картки.
 */

type Item = { href: string; label: string };

/** Висота рядка меню. 56 px — те саме число, що кнопка закриття в темі. */
const ITEM = 'flex min-h-14 items-center text-[2rem] font-bold leading-tight text-heading';

export function SiteNavDrawer({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // 🔴 Escape, повернення фокуса і замок прокрутки — разом, бо поодинці
  // кожне з них лишає шухляду наполовину модальною. Відкрита панель, під
  // якою сторінка їде від коліщатка, це не панель, а накладка.
  useEffect(() => {
    if (!open) return;
    // 🔴 Знімок ref ВСЕРЕДИНІ ефекту, не в прибиранні. Кнопка-відкривач
    // живе поза умовним блоком, тож на практиці вона та сама — але
    // правило існує саме для випадку, коли це не так, і покладатись на
    // «у нас воно не станеться» означає лишити пастку наступному.
    const toFocus = opener.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    // Фокус усередину: без цього той, хто ходить клавіатурою, лишається
    // на кнопці позаду панелі й табає крізь сторінку, якої не бачить.
    panel.current?.querySelector<HTMLElement>('a,button')?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      toFocus?.focus();
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={opener}
        type="button"
        data-testid="burger-open"
        aria-expanded={open}
        aria-controls="site-nav-drawer"
        aria-label="Open the menu"
        onClick={() => setOpen(true)}
        className="ml-auto grid h-14 w-14 shrink-0 place-items-center rounded-sm text-heading transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue xl:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
          <path d="M2 5h16M2 10h16M2 15h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* 🔴 Панель у DOM тільки коли відкрита. Схована через `hidden`
          вона лишалась би в послідовності читання для частини читачів
          екрана, і шість посилань зачитувались би двічі. */}
      {open && (
        <div
          id="site-nav-drawer"
          className="fixed inset-0 xl:hidden"
          style={{ zIndex: 'var(--layer-pop-out-overlay)' }}
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
            className="absolute inset-y-0 left-0 flex w-[min(100%,22rem)] flex-col bg-surface pb-3 shadow-[var(--shadow-pop)]"
          >
            <div className="flex p-3">
              <button
                type="button"
                data-testid="burger-close"
                onClick={close}
                aria-label="Close the menu"
                className="grid h-14 w-14 place-items-center rounded-sm text-heading transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
                  <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-9">
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} onClick={close} className={ITEM}>
                      {item.label}
                    </Link>
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
