'use client';

import { useEffect, useState } from 'react';

import type { ThemeChoice } from '@/lib/theme-bootstrap';

/**
 * 🔴 КЛЮЧ ОГОЛОШЕНИЙ ТУТ ЛІТЕРАЛОМ, А НЕ ІМПОРТОВАНИЙ, І ЦЕ ВИМОГА
 * СТОРОЖА, А НЕ СМАК. `legal-claims.ts` читає кожен `.setItem(` у
 * `apps/web/src` і мусить НАЗВАТИ ключ, щоб звірити його зі сторінками
 * «Cookies» і «Privacy». Він розкриває лише сталу, оголошену в ТОМУ
 * САМОМУ файлі: `.setItem(THEME_KEY)` з імпортом він назвати не вміє й
 * чесно падає — «сторож не вміє його назвати, а сторінка кукі мусить».
 *
 * Друга копія того самого рядка живе в `lib/theme-bootstrap.ts` (скрипт
 * у `<head>` не може імпортувати з клієнтського модуля). Розійтись їм
 * не дає `theme-key.spec.ts`: він звіряє цей літерал зі скриптом.
 */
export const THEME_KEY = 'camptribe.theme';

/**
 * Перемикач день/ніч — CAMP-448, пункт 3.
 *
 * 🔴 ТЕМНА ТЕМА В НАС БУЛА ЗАВЖДИ — І ЧИТАЧ НЕ МАВ ДО НЕЇ ДОСТУПУ.
 * Усі токени описані двічі: `@media (prefers-color-scheme: dark)` і
 * `:root[data-theme="dark"]` (globals.css). Тобто людина з системною
 * темною темою бачила темний сайт, а людина зі світлою системою не
 * могла обрати темний НІКОЛИ, хоч код для цього стояв готовий.
 *
 * 🔴 ТРИ СТАНИ, А НЕ ДВА, І ЦЕ НЕ ПРИКРАСА. Атрибута немає → сайт іде
 * за системою (саме так описані правила: `:root:not([data-theme="light"])`
 * усередині медіазапиту). Атрибут є → він головніший. Якби перемикач
 * мав лише «світло/темрява», перший же клік назавжди відвʼязував би
 * читача від його системного налаштування, і повернути звʼязок було б
 * нічим.
 *
 * 🔴 ВИБІР ЗБЕРІГАЄТЬСЯ НА ПРИСТРОЇ, А НЕ В НАШІЙ БАЗІ. Це налаштування
 * ока, не акаунта: ні рядка в базі, ні куки. `localStorage` може кинути
 * (приватне вікно, заблоковані дані сайту), тож кожне читання й запис
 * загорнуті.
 *
 * 🔴 АЛЕ НАЗВАТИ ЙОГО НА СТОРІНЦІ ВСЕ ОДНО ТРЕБА, і ключ зветься
 * `camptribe.theme` саме тому. Сторож `legal-storage-surfaces.spec.tsx`
 * читає КОЖЕН `.setItem(` у `apps/web/src` і вимагає, щоб той самий
 * перелік стояв на сторінках «Cookies» і «Privacy». Він і впіймав цю
 * зміну: перша редакція писала ключ `ct-theme`, якого не називала жодна
 * сторінка. Запис описаний міграціями ThemeChoiceCookies і ThemeChoicePrivacy.
 */

function readChoice(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Приватне вікно або заблоковані дані сайту: вибір діє до
    // перезавантаження, і це краще, ніж не діяти зовсім.
  }
}

/** Що буде після наступного кліку: система → світло → темрява → система. */
const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const LABEL: Record<ThemeChoice, string> = {
  system: 'Theme: follows your system. Switch to light',
  light: 'Theme: light. Switch to dark',
  dark: 'Theme: dark. Follow your system again',
};

export default function ThemeToggle() {
  /**
   * 🔴 ПЕРШИЙ РЕНДЕР МУСИТЬ ЗБІГТИСЬ ІЗ СЕРВЕРНИМ. Сервер не знає, що
   * лежить у `localStorage`, тож стан починається з `system` і
   * уточнюється в ефекті. Інакше це гідраційна розбіжність — а їх у
   * продакшні діагностують лише знімками.
   */
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChoice(readChoice());
    setReady(true);
  }, []);

  const click = () => {
    const next = NEXT[choice];
    apply(next);
    setChoice(next);
  };

  return (
    <button
      type="button"
      onClick={click}
      data-testid="theme-toggle"
      data-theme-choice={ready ? choice : undefined}
      aria-label={LABEL[choice]}
      title={LABEL[choice]}
      className="flex size-12 items-center justify-center rounded-full text-heading"
    >
      {choice === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
