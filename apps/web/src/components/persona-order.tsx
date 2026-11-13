"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { PERSONA_EVENT } from "./persona-toggle";

/**
 * CAMP-501 — порядок блоків У РОЗМІТЦІ, а не лише на екрані (WCAG 2.4.3).
 *
 * 🔴 CSS `order` міняє те, що видно, і не міняє порядку фокуса: Tab ішов би
 * по блоках у тому порядку, в якому їх віддав сервер. Сервер не знає вибору
 * читача (сторінка статична), тож DOM переставляється ТУТ, після
 * гідратації, і CSS лишається страховкою до цього моменту: візуально
 * нічого не стрибає, бо порядок на екрані той самий до й після.
 *
 * 🔴 ПЕРЕСТАВЛЯЮТЬСЯ ЛИШЕ ДІТИ В МЕЖАХ ОДНОГО БАТЬКА (`insertBefore` у той
 * самий контейнер). Саме тому React і далі може їх прибирати: його
 * `removeChild` шукає вузол у тому самому батькові, і він там.
 *
 * Початковий індекс запамʼятовується в `data-persona-idx` при першому
 * проході; повернення до «без вибору» відновлює серверний порядок.
 */
function rankOf(child: Element, persona: string | null, pinned: boolean): number {
  if (pinned && (child.tagName === "NAV" || child.tagName === "HEADER")) return -2;
  if (persona && child.getAttribute("data-persona-first") === persona) return -1;
  return 0;
}

export function applyPersonaOrder(root: ParentNode, persona: string | null) {
  for (const box of root.querySelectorAll<HTMLElement>(
    "[data-persona-zone],[data-persona-group]",
  )) {
    const pinned = box.hasAttribute("data-persona-zone");
    const kids = Array.from(box.children) as HTMLElement[];
    kids.forEach((k, i) => {
      if (k.dataset.personaIdx === undefined) k.dataset.personaIdx = String(i);
    });
    const sorted = [...kids].sort(
      (a, b) =>
        rankOf(a, persona, pinned) - rankOf(b, persona, pinned) ||
        Number(a.dataset.personaIdx) - Number(b.dataset.personaIdx),
    );
    if (sorted.every((k, i) => k === kids[i])) continue;
    for (const k of sorted) box.appendChild(k);
  }
}

export default function PersonaOrder() {
  const pathname = usePathname();
  useEffect(() => {
    const run = () =>
      applyPersonaOrder(document, document.documentElement.dataset.persona ?? null);
    run();
    window.addEventListener(PERSONA_EVENT, run);
    return () => window.removeEventListener(PERSONA_EVENT, run);
  }, [pathname]);
  return null;
}
