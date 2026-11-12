"use client";

import { useEffect, useState } from "react";

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

  return (
    <div
      role="group"
      aria-label={labels.group}
      data-testid={variant === "drawer" ? "persona-toggle-drawer" : "persona-toggle"}
      data-persona-choice={ready ? (choice ?? "none") : undefined}
      className={
        variant === "drawer"
          ? "mb-6 flex flex-wrap items-center gap-2 border-b border-line-2 pb-6 text-lg"
          : "hidden shrink-0 items-center gap-1 text-sm xl:flex group-data-[stacked=true]/header:hidden"
      }
    >
      {(["owner", "renter"] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => click(p)}
          aria-pressed={choice === p}
          data-testid={variant === "drawer" ? `persona-drawer-${p}` : `persona-${p}`}
          className={`min-h-12 rounded-full px-3 text-heading ${
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
}
