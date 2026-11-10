import type { ReactNode } from "react";

import type { AmenityKey, AmenityValue } from "@/lib/api";

/**
 * Зручності кемпінгу значками — CAMP-453, пункт 3 (знімок ревю 441/66).
 *
 * Було: сітка з одинадцяти прямокутників «Electricity — NOT RECORDED»,
 * де стан кричав великими літерами, а на типовому кемпінгу дев'ять
 * рядків із одинадцяти кажуть «не записано». Власник: «зручності з
 * іконками замість сітки YES / NO / NOT RECORDED».
 *
 * 🔴 ТРИ СТАНИ ЛИШАЮТЬСЯ ТРЬОМА, І ЦЕ НЕ ОБГОВОРЮЄТЬСЯ. «Не записано» —
 * це не «немає»: так сказано в наших же умовах («Where our data does not
 * say whether a campsite has something, we show that it is unknown
 * rather than guessing»), і саме на це спирається кожен фільтр, що
 * друкує, скільки кемпінгів він відкинув за браком даних. Тому жоден
 * рядок не ховається й жоден не зводиться до «ні».
 *
 * 🔴 І СТАН НЕ ПЕРЕДАЄТЬСЯ САМИМ КОЛЬОРОМ (WCAG 1.4.1). У кожного стану
 * свій значок І своє слово; колір лише підсилює те, що вже сказано.
 *
 * СТРУКТУРА З ТЕМИ: секція `specifications` Fuse у варіанті списку
 * (`assets/specifications.build.css`; читано з архіву `fuse.zip`
 * 10.11.2026). Дослівно:
 *
 *   .specifications__block{flex:1 0 0%;padding:24px 20px;
 *       border-radius:var(--global-border-radius);
 *       background-color:var(--color-background-secondary)}
 *   .specifications__block-heading{margin-bottom:20px;font-weight:600;
 *       color:var(--color-text-primary)}
 *   .specifications__block-text ul{list-style-type:none}
 *   .specifications__block-text ul li{position:relative;
 *       padding-inline-start:20px}
 *   .specifications__block-text ul li::before{content:"";position:absolute;
 *       top:8px;width:8px;height:8px;border:1px solid var(--color-accent);
 *       border-radius:100%;inset-inline-start:0}
 *   .specifications__block-text ul li + li{margin-top:8px}
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ: кільце 8×8 як маркер замінено значком
 * самої зручності — рівно те, чого просить картка. Відступ зліва
 * виростає з 20px до 28px, бо значок більший за кільце; решта чисел
 * (падінги блока, вага заголовка, проміжок 8px між пунктами) — теми.
 */

export type AmenityIcons = Readonly<Record<AmenityKey, ReactNode>>;

const ICON = (d: string, extra?: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    {extra}
  </svg>
);

/**
 * 🔴 ЗНАЧОК НА КОЖЕН КЛЮЧ, І ПЕРЕЛІК ПОВНИЙ ЗА ТИПОМ. `Record<AmenityKey,…>`
 * означає, що новий ключ зручності не скомпілюється, доки йому не
 * намалюють значок, — замість того щоб тихо з'явитись без нього.
 */
export const AMENITY_ICONS: AmenityIcons = {
  electricity: ICON("M13 2.5 5 13.5h5.5L10 21.5l8-11h-5.5z"),
  water: ICON("M12 3.5c3.2 3.6 5.5 6.6 5.5 9.3a5.5 5.5 0 1 1-11 0c0-2.7 2.3-5.7 5.5-9.3Z"),
  shower: ICON("M7 11V7.5A3.5 3.5 0 0 1 14 7.5M4 11h16M8 15v1.5M12 15v3M16 15v1.5"),
  toilets: ICON("M6 3.5v6.5a2 2 0 0 0 2 2h1v8.5M9.5 3.5v4M15 3.5l-1.5 7h4L16.5 3.5zM15.5 12.5v8"),
  greyWater: ICON("M5 7.5h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8ZM9 7.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2.5M12 11v6"),
  laundry: ICON("M4.5 4.5h15v15h-15zM4.5 8.5h15", <circle cx="12" cy="14" r="3.6" />),
  dogFriendly: ICON("M8.5 13.5c1.2-1.4 1.9-2.2 3.5-2.2s2.3.8 3.5 2.2c1 1.2 2 2 2 3.4 0 1.6-1.3 2.6-3 2.6-1 0-1.7-.4-2.5-.4s-1.5.4-2.5.4c-1.7 0-3-1-3-2.6 0-1.4 1-2.2 2-3.4Z", <g><circle cx="7.2" cy="9" r="1.7" /><circle cx="16.8" cy="9" r="1.7" /></g>),
  wifi: ICON("M3.5 9.5a13 13 0 0 1 17 0M6.5 13a8.5 8.5 0 0 1 11 0M9.5 16.4a4 4 0 0 1 5 0M12 19.8h.01"),
  wheelchair: ICON("M9.5 7.5v5.5h5l2.5 6M6.5 12.5a5.5 5.5 0 1 0 7.5 7", <circle cx="12" cy="4" r="1.7" />),
  wheelchairFull: ICON("M4 19.5h16M7 19.5 13 8h4M13.5 12h3.5", <circle cx="9.5" cy="4.5" r="1.8" />),
};

const STATE_ICON: Record<AmenityValue, ReactNode> = {
  yes: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m3 8.4 3.2 3.2L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  no: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  ),
  // 🔴 НЕ ПЕРЕКРЕСЛЕНИЙ ЗНАЧОК І НЕ ПОРОЖНЕЧА: незаписана зручність не
  // сміє читатись як відсутня. Риска — це «питання лишилось без
  // відповіді», і поруч стоїть слово, яке каже те саме.
  unknown: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 8h8" strokeLinecap="round" />
    </svg>
  ),
};

const STATE_WORD: Record<AmenityValue, string> = {
  yes: "Yes",
  no: "No",
  unknown: "Not recorded",
};

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const AMENITY_CSS = `
.ct-amen{padding:24px 20px;border-radius:var(--r,16px);background-color:var(--color-surface-2)}
.ct-amen__list{list-style:none;margin:0;padding:0}
.ct-amen__item{position:relative;display:flex;align-items:center;gap:8px;padding-inline-start:28px;line-height:1.5;color:var(--color-heading)}
.ct-amen__item+.ct-amen__item{margin-top:8px}
.ct-amen__icon{position:absolute;inset-inline-start:0;top:50%;transform:translateY(-50%);width:20px;height:20px;color:var(--color-heading)}
.ct-amen__icon svg{width:100%;height:100%}
.ct-amen__label{flex:1 1 auto;min-width:0}
.ct-amen__state{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;font-size:.875rem}
.ct-amen__state svg{width:14px;height:14px;flex:none}
.ct-amen__item--unknown,.ct-amen__item--unknown .ct-amen__icon{color:var(--color-ink-2)}
.ct-amen__item--no .ct-amen__state{color:var(--color-ink-2)}
@media(min-width:768px){.ct-amen__list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px}.ct-amen__item+.ct-amen__item{margin-top:0}.ct-amen__item{padding-block:4px}}
`;

export default function AmenityList({
  keys,
  labels,
  values,
  testId,
}: {
  keys: readonly AmenityKey[];
  labels: Readonly<Record<AmenityKey, string>>;
  values: Readonly<Record<AmenityKey, AmenityValue>>;
  testId?: string;
}) {
  // 🔴 Порожній перелік не малює рамки — те саме правило, що в секціях
  // каталогу: порожня коробка читається як поломка.
  if (keys.length === 0) return null;

  return (
    <>
      <style href="ct-amen" precedence="ct-components">
        {AMENITY_CSS}
      </style>
      <div className="ct-amen">
        <ul className="ct-amen__list" data-testid={testId}>
          {keys.map((key) => {
            const value = values[key];
            return (
              <li
                key={key}
                data-amenity={key}
                data-state={value}
                className={`ct-amen__item ct-amen__item--${value}`}
              >
                <span className="ct-amen__icon">{AMENITY_ICONS[key]}</span>
                <span className="ct-amen__label">{labels[key]}</span>
                <span className="ct-amen__state">
                  {STATE_ICON[value]}
                  {STATE_WORD[value]}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
