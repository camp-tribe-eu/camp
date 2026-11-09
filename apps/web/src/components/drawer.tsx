'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Бічна шухляда — CAMP-460.
 *
 * Власник, про картки гідів: «при натисканні на картку навіщо переводити
 * на наступну іншу сторінку якщо ми на цій же можемо чи попап вивести чи
 * дровер боковий як в темі… чи це тобі так простіше із різними
 * сторінками?»
 *
 * 🔴 ВІДПОВІДЬ — ЧИСЛО, А НЕ СМАК. Органіка наш єдиний канал, а гідів у
 * збірці 1 287 сторінок (заміряно на проді 09.11.2026: `find
 * .next/server/app/guides -name '*.html' | wc -l`). Шухляда НАТОМІСТЬ
 * сторінок стерла б 1 287 адрес, які може знайти пошук і прочитати
 * ШІ-асистент. Тому робимо обидва: клік відкриває шухляду й МІНЯЄ
 * АДРЕСУ, а та сама адреса, відкрита напряму, віддає повноцінну
 * сторінку.
 *
 * Це не «простіше з різними сторінками» — це дорожче, ніж один із
 * варіантів, і робиться саме тому, що інакше ми платимо тим єдиним
 * каналом, який маємо.
 *
 * 🔴 ЗАКРИТТЯ — `router.back()`, А НЕ `router.push('/guides')`. Шухляду
 * відкрив перехід, тож закриває її крок НАЗАД по історії: інакше
 * кнопка «назад» у браузері повертала б у шухляду, з якої людина щойно
 * вийшла, і виходу з неї не було б зовсім.
 */
export default function Drawer({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Фокус у шухляду: інакше клавіатура лишається на сторінці під нею.
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        router.back();
        return;
      }
      // 🔴 Пастка фокуса. Без неї Tab виводить читача на посилання
      // СТОРІНКИ ПІД шухлядою — вони видимі, але недосяжні мишею, і
      // людина з клавіатурою опиняється ніде.
      if (e.key !== 'Tab' || !panel.current) return;
      const f = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [router]);

  return (
    <div className="ct-drawer" data-testid={testId ?? 'drawer'}>
      <style href="ct-drawer" precedence="ct-components">
        {DRAWER_CSS}
      </style>
      {/* Тло закриває, але це НЕ єдиний спосіб: є кнопка і Escape. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="ct-drawer__scrim"
        onClick={() => router.back()}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ct-drawer__panel"
      >
        <div className="ct-drawer__bar">
          <button
            ref={closeBtn}
            type="button"
            className="ct-drawer__close"
            onClick={() => router.back()}
          >
            Close
          </button>
        </div>
        <div className="ct-drawer__body">{children}</div>
      </div>
    </div>
  );
}

const DRAWER_CSS = `
.ct-drawer{position:fixed;inset:0;z-index:60}
.ct-drawer__scrim{position:absolute;inset:0;width:100%;height:100%;border:0;cursor:default;background:color-mix(in srgb, var(--ink) 45%, transparent)}
.ct-drawer__panel{position:absolute;inset-block:0;inset-inline-end:0;display:flex;flex-direction:column;width:min(100%,560px);background-color:var(--color-surface);box-shadow:var(--shadow)}
.ct-drawer__bar{display:flex;justify-content:flex-end;padding:12px 16px;border-bottom:1px solid var(--color-line-2)}
.ct-drawer__close{border:1px solid var(--color-control-line);border-radius:calc(var(--r,16px) / 2);padding:6px 14px;font-weight:600;color:var(--color-ink)}
.ct-drawer__close:focus-visible{outline:2px solid var(--color-heading);outline-offset:2px}
.ct-drawer__body{overflow-y:auto;padding:16px 24px 32px}
`;
