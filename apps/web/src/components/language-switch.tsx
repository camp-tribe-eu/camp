"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Flag } from "./flag";
import { localePath, readLocale, type Locale } from "@/lib/i18n";

/**
 * Перемикач мови з прапорцем — CAMP-448.
 *
 * 🔴 ПЕРЕЛІК ПРИХОДИТЬ ПРОПОМ, І ЦЕ ЄДИНА ПРИЧИНА, ЧОМУ КОМПОНЕНТ НЕ ЧИТАЄ
 * `LOCALES` САМ. Макет передає `liveLocales()`, тож «нежива мова не
 * показується» тримається в одному місці (`i18n.ts`, правило hreflang:
 * мова зʼявляється там, де її сторінки Є), а компонент лише малює те, що
 * йому дали. Тест підміняє перелік і читає відданий HTML.
 *
 * 🔴 ЖИВА МОВА ПОКИ ОДНА. Перемикач із одним пунктом усе одно малюється:
 * власник просив мову з прапорцем у шапці й підвалі, і читач бачить, якою
 * мовою сайт. Другий пункт зʼявиться разом із `live: true`, без правки
 * цього файла.
 *
 * Посилання — звичайні `<a>`, не `next/link`: мова — це інший набір
 * сторінок, і повне завантаження чесніше за клієнтський перехід. `hreflang`
 * на кожному, `aria-current` на поточній.
 */

/** Знак ЄС: синє поле, дванадцять жовтих зірок по колу. Власний, не файл. */
function EuFlag({ className }: { className?: string }) {
  const stars = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return (
      <circle
        key={i}
        cx={(24 + 9 * Math.sin(a)).toFixed(2)}
        cy={(18 - 9 * Math.cos(a)).toFixed(2)}
        r="1.5"
      />
    );
  });
  return (
    <svg
      className={className}
      viewBox="0 0 48 36"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="48" height="36" fill="#003399" />
      <g fill="#FFCC00">{stars}</g>
    </svg>
  );
}

function LocaleFlag({ code }: { code: string }) {
  const cls = "h-3.5 w-[18px] shrink-0 rounded-[2px] object-cover";
  return code === "eu" ? (
    <EuFlag className={cls} />
  ) : (
    <Flag code={code} className={cls} />
  );
}

export function LanguageSwitch({
  locales,
  current,
  variant = "header",
}: {
  /** Лише ЖИВІ мови. Порожній перелік — перемикача немає. */
  locales: readonly Locale[];
  /** Код мови поточної сторінки; без нього береться з адреси. */
  current?: string;
  /** `footer` розкриває список угору: під ним немає місця. */
  variant?: "header" | "footer";
}) {
  const pathname = usePathname() ?? "/";
  const read = readLocale(pathname);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = `lang-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (locales.length === 0) return null;
  const code = current ?? read.locale;
  const active = locales.find((l) => l.code === code) ?? locales[0];

  return (
    <div
      ref={root}
      data-testid={`language-switch-${variant}`}
      className="relative"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 items-center gap-2 rounded-card px-2 text-sm font-medium text-heading ct-button-motion hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue group-data-[stacked=true]/header:text-[#fff] group-data-[stacked=true]/header:hover:bg-transparent"
      >
        <LocaleFlag code={active.flag} />
        {/* 🔴 ВИДИМИЙ ТЕКСТ — ПОЧАТОК ДОСТУПНОГО ІМЕНІ (WCAG 2.5.3).
            Перша редакція мала `aria-label="Language: English"` і
            `aria-hidden` на «EN»: axe червонів на `label-content-name-
            mismatch` у кнопок шапки й підвалу — те, що бачить читач, у
            імені не стояло. Тепер імʼя — «EN, language: English»: видиме
            слово перше, пояснення для диктора слідом. */}
        <span>{active.code.toUpperCase()}</span>
        <span className="sr-only">, language: {active.label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
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
      <ul
        id={listId}
        data-language-list
        className={
          "absolute z-20 min-w-[200px] overflow-hidden rounded-card border border-line-2 bg-surface text-heading shadow-[var(--shadow-pop)] " +
          (variant === "footer"
            ? "bottom-full left-0 mb-2 "
            : "right-0 top-full mt-2 ") +
          // 🔴 `hidden`, а НЕ `invisible opacity-0`, як у розкривачів меню:
          // сховане через `visibility` елемент і далі лежить у розкладці й
          // тягне за собою ширину прокручування. Закритий список підвалу
          // (`min-w-200`, `left-0`) виліз за правий край на 375 px —
          // сторінка стала 469 px завширшки, а мобільний Chrome розтягнув
          // вікно (затемнення шухляди 1016 px при 812). Заміряно 15.11.2026.
          (open ? "block" : "hidden")
        }
      >
        {locales.map((l) => (
          <li key={l.code}>
            <a
              href={localePath(read.rest, l.code)}
              hrefLang={l.code}
              lang={l.code}
              aria-current={l.code === active.code ? "true" : undefined}
              className="flex min-h-12 items-center gap-3 px-4 text-base font-semibold ct-button-motion hover:bg-surface-2"
            >
              <LocaleFlag code={l.flag} />
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
