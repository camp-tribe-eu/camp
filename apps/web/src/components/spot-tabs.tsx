'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  nextTab,
  spotPanelId,
  spotTabButtonId,
  type SpotTab,
  type SpotTabId,
} from '@/lib/spot-tabs';

// CAMP-453 — таби сторінки кемпінгу: мапа / погода / камери / тривоги.
//
// 🔴 ДВА СТАНИ, І ПЕРШИЙ — ТОЙ, ЯКИЙ ВІДДАЄ СЕРВЕР.
//
// Сторінка статична, і читач без JavaScript (а також краулер) має
// отримати ВСЕ: тому у відданому HTML кожна панель стоїть відкрита,
// одна під одною, а «таби» — звичайні посилання-якорі на них. Це та сама
// відповідь, що й раніше, коли панелі були окремими секціями.
//
// Після гідратації (`live`) компонент стає справжніми табами за ARIA:
// `tablist`, `tab`, `tabpanel`, стрілки / Home / End, неактивні панелі
// ховає атрибут `hidden`. Панелі НЕ розмонтовуються: мапа тримає
// положення, а вебкамери не питають кадри вдруге.
//
// 🔴 ПЕРШИЙ РЕНДЕР НА КЛІЄНТІ ЗБІГАЄТЬСЯ З СЕРВЕРНИМ. Режим перемикає
// `useEffect`, а не `typeof window`: інакше React побачив би іншу
// розмітку, ніж віддав сервер, і гідратація впала б із попередженням.
//
// 🔴 ЧОМУ НЕ ЧИСТИЙ CSS (радіо-кнопки). Він теж працює без JS, але
// диктор читає це як групу перемикачів, а не як таби, і стрілки там
// ходять по радіо, а не по вкладках. Власник просив таби.

export default function SpotTabs({
  tabs,
  panels,
  label,
}: {
  tabs: readonly SpotTab[];
  /** Вміст кожної панелі. Ключ без таба — не малюється. */
  panels: Partial<Record<SpotTabId, ReactNode>>;
  /** Назва групи для диктора: про що ці таби. */
  label: string;
}) {
  const [live, setLive] = useState(false);
  const [active, setActive] = useState<SpotTabId>(tabs[0]?.id ?? 'map');
  const buttons = useRef<Partial<Record<SpotTabId, HTMLButtonElement | null>>>({});

  useEffect(() => setLive(true), []);

  // Таб зник (дані змінились) — не лишаємось на панелі, якої вже немає.
  const current = tabs.some((t) => t.id === active) ? active : tabs[0]?.id;

  const select = (id: SpotTabId, focus = false) => {
    setActive(id);
    if (focus) buttons.current[id]?.focus();
  };

  // Один таб — це не таби: рядка з єдиною кнопкою не малюємо.
  const showBar = tabs.length > 1;

  return (
    <div data-testid="spot-tabs" data-mode={live ? 'tabs' : 'static'}>
      {showBar &&
        (live ? (
          <div
            role="tablist"
            aria-label={label}
            data-testid="spot-tablist"
            className="flex gap-1 overflow-x-auto pb-3"
            onKeyDown={(e) => {
              const to = current ? nextTab(tabs, current, e.key) : null;
              if (to) {
                e.preventDefault();
                select(to, true);
              }
            }}
          >
            {tabs.map((t) => {
              const on = t.id === current;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    buttons.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={spotTabButtonId(t.id)}
                  aria-selected={on}
                  aria-controls={spotPanelId(t.id)}
                  tabIndex={on ? 0 : -1}
                  data-tab={t.id}
                  onClick={() => select(t.id)}
                  className={
                    'inline-flex min-h-12 items-center rounded-card border px-4 text-sm font-semibold ' +
                    (on
                      ? 'border-heading bg-heading text-surface'
                      : 'border-line-2 bg-surface text-heading hover:border-line-blue')
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : (
          <nav aria-label={label} data-testid="spot-tablist" className="pb-3">
            <ul className="flex flex-wrap gap-1">
              {tabs.map((t) => (
                <li key={t.id}>
                  <a
                    href={`#${spotPanelId(t.id)}`}
                    data-tab={t.id}
                    className="inline-flex min-h-12 items-center rounded-card border border-line-2 bg-surface px-4 text-sm font-semibold text-heading"
                  >
                    {t.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}

      {tabs.map((t, i) => {
        const on = t.id === current;
        return (
          <div
            key={t.id}
            id={spotPanelId(t.id)}
            data-panel={t.id}
            // Атрибути ARIA-табів — лише в живому режимі: без табів роль
            // `tabpanel` брехала б, що поруч є `tablist`.
            role={live && showBar ? 'tabpanel' : undefined}
            aria-labelledby={live && showBar ? spotTabButtonId(t.id) : undefined}
            hidden={live && showBar && !on ? true : undefined}
            className={
              'min-w-0 scroll-mt-24 [&>section]:mt-0! ' +
              // Без JS панелі стоять стопкою — між ними потрібен проміжок.
              (!(live && showBar) && i > 0 ? 'mt-6' : '')
            }
          >
            {panels[t.id]}
          </div>
        );
      })}
    </div>
  );
}
