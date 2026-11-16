import type { ReactNode } from "react";

import { ButtonLink } from "./button";

// CAMP-461 — ЄДИНА КАРТКА «МЕДІА ЗЛІВА, ТЕКСТ СПРАВА, КНОПКА».
//
// Власник (CAMP-443/2): «Ці картки я раніше вже описував… зробити в одному
// стилі і форматі по всьому проєкту і просто перевикористовувати, а не
// малювати кожен раз нові. Зліва картинка, будь то прапор, чи зображення чи
// іконка, справа тайтл, текст, лінка чи кнопка».
//
// Тому картка не знає, що в ній лежить: `media` — це вузол (прапор, значок
// або фото), решта — заголовок, абзац, чипи й ОДНА кнопка. Сторінки оренди
// беруть її для компаній і країн; решту сторінок (гайди, пошук) переводить
// на неї окрема робота, а не копія розмітки.
//
// 🔴 ОДНА КНОПКА НА КАРТКУ, І ВОНА НЕСЕ НАЗВУ. Заголовок картки — не
// посилання: два посилання на одну адресу в одній картці читач екрана чує
// двічі. Тому підпис кнопки мусить називати предмет («View Roadsurfer»),
// а не «More» — це перевіряє тест на ВІДДАНІЙ розмітці.
//
// 🔴 ЧИПИ — ЛИШЕ ТЕКСТ, ЯКИЙ ДАЛА СТОРІНКА. Картка не вигадує мітки.

export interface MediaCardItem {
  key: string;
  media: ReactNode;
  title: string;
  text?: ReactNode;
  /** Короткі мітки під текстом: «3 depots», «fleet of 40». */
  chips?: readonly string[];
  /** Додаткові рядки під чипами (блок, а не абзац). */
  details?: ReactNode;
  /** `data-testid` самої картки; за замовчуванням `media-card`. */
  testId?: string;
  cta: { href: string; label: string; variant?: "primary" | "secondary" };
}

const CARD_CSS = `
.ct-mc{display:grid;gap:12px;margin:0;padding:0;list-style:none;grid-template-columns:minmax(0,1fr)}
.ct-mc__item{display:grid;grid-template-columns:56px minmax(0,1fr);column-gap:16px;row-gap:12px;align-items:start;padding:20px;border:1px solid var(--color-line-2);border-radius:calc(var(--r,16px) * .75);background-color:var(--color-surface)}
.ct-mc__media{display:flex;align-items:center;justify-content:center;width:56px;min-height:40px;color:var(--color-heading)}
.ct-mc__media .ct-flag{width:56px;height:auto;border-radius:6px;box-shadow:0 0 0 1px var(--color-line-2)}
.ct-mc__media svg{width:32px;height:32px}
.ct-mc__body{display:flex;min-width:0;flex-direction:column;gap:8px}
.ct-mc__title{font-weight:700;line-height:1.25;color:var(--color-heading);font-size:1.125rem}
.ct-mc__text{color:var(--color-ink-2);line-height:1.5}
.ct-mc__chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.ct-mc__chip{padding:2px 10px;border:1px solid var(--color-line-2);border-radius:999px;font-size:.8125rem;line-height:1.5;color:var(--color-ink-2);background-color:var(--color-surface-2)}
.ct-mc__details{display:flex;flex-direction:column;gap:4px;color:var(--color-ink-2);font-size:.875rem;line-height:1.5}
.ct-mc__cta{grid-column:1 / -1}
@media(min-width:768px){
.ct-mc--cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.ct-mc--cols-3{grid-template-columns:repeat(2,minmax(0,1fr))}
.ct-mc__item{padding:24px}
}
@media(min-width:1200px){.ct-mc--cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(min-width:768px){.ct-mc__cta{grid-column:2}}
`;

export default function MediaCards({
  items,
  testId,
  columns = 2,
  titleAs: Title = "h3",
}: {
  items: readonly MediaCardItem[];
  testId?: string;
  columns?: 1 | 2 | 3;
  titleAs?: "h2" | "h3";
}) {
  // Порожнє не малюємо: перелік без карток — не «порожня сітка».
  if (items.length === 0) return null;
  return (
    <>
      <style href="ct-media-card" precedence="ct-components">
        {CARD_CSS}
      </style>
      <ul
        className={`ct-mc${columns === 1 ? "" : ` ct-mc--cols-${columns}`}`}
        data-testid={testId}
      >
        {items.map((it) => (
          <li
            key={it.key}
            className="ct-mc__item"
            data-testid={it.testId ?? "media-card"}
          >
            <span className="ct-mc__media" aria-hidden="true">
              {it.media}
            </span>
            <div className="ct-mc__body">
              <Title className="ct-mc__title">{it.title}</Title>
              {it.text ? <p className="ct-mc__text">{it.text}</p> : null}
              {it.chips && it.chips.length > 0 ? (
                <ul className="ct-mc__chips">
                  {it.chips.map((c) => (
                    <li key={c} className="ct-mc__chip">
                      {c}
                    </li>
                  ))}
                </ul>
              ) : null}
              {it.details ? <div className="ct-mc__details">{it.details}</div> : null}
            </div>
            <div className="ct-mc__cta">
              <ButtonLink
                href={it.cta.href}
                variant={it.cta.variant ?? "secondary"}
                size="sm"
              >
                {it.cta.label}
                <span aria-hidden="true">→</span>
              </ButtonLink>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
