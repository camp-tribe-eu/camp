import type { ReactNode } from "react";

import { ButtonLink } from "./button";
import { Flag } from "./flag";

/**
 * Кнопка-країна з прапором — CAMP-455 і CAMP-458.
 *
 * 🔴 ОДИН КОМПОНЕНТ НА ДВА МІСЦЯ, І ЦЕ НЕ ПРИБИРАННЯ ЗАРАДИ ПРИБИРАННЯ.
 * Прапор біля країни попросили двічі: на /tools (CAMP-458, знімки
 * 442/20–442/30) і на /search (CAMP-455). Перша редакція тримала
 * правила в `page-sections.tsx` під назвою `.ct-fuel-country` — назва
 * про паливо, а вживань уже два. Два однакові рядки CSS під різними
 * іменами розходяться на першій же правці розміру, і ніхто цього не
 * помітить, бо обидві сторінки лишаться «нормальними».
 *
 * 🔴 ПРАПОР МОВЧИТЬ ДЛЯ ЧИТАЧА ЕКРАНА. `Flag` віддає порожній `alt`, бо
 * назва країни стоїть поруч словами: диктор, який прочитав би «Flag of
 * Croatia Croatia», сказав би одне й те саме двічі. А код без файлу
 * малює літери, не 404 — це теж вирішено в `Flag`.
 *
 * Розмір прапора — `1.5em` від тексту кнопки, як у тікера країн
 * (`country-ticker.tsx`), щоб вони не розʼїхались між сторінками.
 */

const CHIP_CSS = `
.ct-country-chip{display:inline-flex;align-items:center;gap:.5em}
.ct-country-chip .ct-flag{width:1.5em;height:auto;border-radius:.12em;flex:none}
`;

export function CountryChip({
  code,
  href,
  children,
}: {
  /** ISO-код країни; `Flag` сам вирішує, чи є для нього файл. */
  code: string;
  href: string;
  /** Напис: назва країни, і те, що сторінка хоче додати поруч. */
  children: ReactNode;
}) {
  return (
    <>
      <style href="ct-country-chip" precedence="ct-components">
        {CHIP_CSS}
      </style>
      <ButtonLink href={href} size="sm">
        <span className="ct-country-chip">
          <Flag code={code} />
          {children}
        </span>
      </ButtonLink>
    </>
  );
}
