"use client";

import { useEffect, useRef, useState } from "react";

import { isPersona, type Persona } from "@/lib/persona";

/**
 * 🔴 КЛЮЧ ТУТ ЛІТЕРАЛОМ, А НЕ ІМПОРТОВАНИЙ — ВИМОГА СТОРОЖА
 * `legal-claims.ts` (див. пояснення в `theme-toggle.tsx`). Копія в
 * `lib/persona.ts` звіряється тестом `persona-key.spec.ts`.
 */
export const PERSONA_KEY = "camptribe.persona";

export interface PersonaLabels {
  group: string;
  owner: string;
  renter: string;
}

function read(): Persona | null {
  try {
    const v = window.localStorage.getItem(PERSONA_KEY);
    return isPersona(v) ? v : null;
  } catch {
    return null;
  }
}

/** Подія, якою два екземпляри перемикача (шапка й шухляда) тримають один стан. */
export const PERSONA_EVENT = 'camptribe:persona';

function apply(next: Persona | null) {
  const root = document.documentElement;
  if (next === null) delete root.dataset.persona;
  else root.dataset.persona = next;
  try {
    if (next === null) window.localStorage.removeItem(PERSONA_KEY);
    else window.localStorage.setItem(PERSONA_KEY, next);
  } catch {
    // Приватне вікно: вибір діє до перезавантаження.
  }
  window.dispatchEvent(new Event(PERSONA_EVENT));
}

/**
 * Два кнопки-перемикачі: «маю кемпер» / «орендую». Повторний клік на
 * активній ЗНІМАЄ вибір (ключ видаляється, сайт — як був). Підписи
 * приходять із CMS; без них компонент не малюється (порожнє не малюємо).
 */
export default function PersonaToggle({
  labels,
  variant = 'header',
}: {
  labels: PersonaLabels;
  /**
   * 🔴 `header` — у ряду шапки лише від 1200 px (там, де меню теж у ряду) і
   * не в «острові»; на вужчому — `drawer`, у бургері. Заповіт CAMP-448:
   * шапка завжди ОДИН рядок, тож те, що не вміщається, іде в бургер.
   */
  variant?: 'header' | 'drawer';
}) {
  // Перший рендер збігається із серверним: вибору «ще не знаємо».
  const [choice, setChoice] = useState<Persona | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setChoice(read());
    sync();
    setReady(true);
    window.addEventListener(PERSONA_EVENT, sync);
    return () => window.removeEventListener(PERSONA_EVENT, sync);
  }, []);

  const click = (p: Persona) => {
    const next = choice === p ? null : p;
    apply(next);
    setChoice(next);
  };

  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const buttons = (
    <div
      role="group"
      aria-label={labels.group}
      data-testid={variant === "drawer" ? "persona-toggle-drawer" : "persona-panel"}
      data-persona-choice={ready ? (choice ?? "none") : undefined}
      className={
        variant === "drawer"
          ? "mb-6 flex flex-wrap items-center gap-2 border-b border-line-2 pb-6 text-lg"
          : "absolute right-0 top-full z-50 mt-2 flex w-max flex-col gap-1 rounded-card border border-line-2 bg-surface p-2 text-sm shadow-card"
      }
    >
      {(["owner", "renter"] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => {
            click(p);
            setOpen(false);
          }}
          aria-pressed={choice === p}
          data-testid={variant === "drawer" ? `persona-drawer-${p}` : `persona-${p}`}
          className={`min-h-12 rounded-full px-3 text-left text-heading ${
            choice === p
              ? "bg-btn text-btn-ink"
              : "underline-offset-4 hover:underline"
          }`}
        >
          {labels[p]}
        </button>
      ))}
    </div>
  );

  if (variant === "drawer") return buttons;

  /**
   * 🔴 У РЯДУ ШАПКИ — ОДНА КНОПКА-ІКОНКА (48 px, як перемикач теми), а вибір
   * у випадайці. Два підписані перемикачі поруч із меню не вміщались ні на
   * 1200, ні на 1280 px: меню переносило «About» на другий рядок (знімок
   * CI). Заповіт CAMP-448 — шапка завжди один рядок.
   */
  return (
    <div
      ref={box}
      data-testid="persona-toggle"
      className="relative hidden shrink-0 xl:block group-data-[stacked=true]/header:hidden"
    >
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={choice ? `${labels.group}: ${labels[choice]}` : labels.group}
        title={labels.group}
        data-testid="persona-trigger"
        data-persona-choice={ready ? (choice ?? "none") : undefined}
        className={`flex size-12 items-center justify-center rounded-full text-heading ${
          choice ? "bg-surface-2" : ""
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" strokeLinecap="round" />
        </svg>
      </button>
      {open && buttons}
    </div>
  );
}
