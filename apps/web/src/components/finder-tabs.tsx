"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * CAMP-441 (33): «таби кемпер / кемпінг із формами підбору» on /contact.
 *
 * WAI-ARIA tabs: one tab in the tab order, arrows/Home/End move between
 * them, each panel labelled by its tab. Both panels are in the HTML (the
 * hidden one with `hidden`), so the forms work before hydration and
 * without JavaScript the first panel is simply the one shown.
 */
export interface FinderTab {
  id: string;
  label: string;
  content: ReactNode;
}

export default function FinderTabs({ tabs, label }: { tabs: readonly FinderTab[]; label: string }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    setActive(n);
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(active + 1);
    else if (e.key === "ArrowLeft") go(active - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div data-testid="finder-tabs">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-controls={`${base}-panel-${t.id}`}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            data-testid={`finder-tab-${t.id}`}
            onClick={() => setActive(i)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${
              i === active
                ? "border-heading bg-heading text-surface"
                : "border-line-2 bg-surface text-heading hover:border-heading"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={i !== active}
          data-testid={`finder-panel-${t.id}`}
          className="mt-4"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
