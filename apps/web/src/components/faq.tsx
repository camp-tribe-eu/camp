import type { ReactNode } from 'react';

/**
 * FAQ-акордеон — секція каталогу CAMP-449, пункт 8.
 *
 * Власник: «FAQ потрібен ширше по сайту: він працює і на людей, і на
 * SEO/AEO». До цієї картки акордеон жив усередині `hub-stats.tsx` і
 * діставався рівно одній сторінці, а на інших ті самі питання стояли
 * заголовками з абзацами (знімок 441/72).
 *
 * 🔴 ВИГЛЯД ТЕМИ, КОД НАШ — і різниця тут не формальна. Тема крутить
 * акордеон на JS (`.accordion__item.is-active .accordion__content
 * {display:block}`), тобто без скриптів відповіді НЕ ІСНУЄ. У нас
 * нативний `<details>`: він відкривається без жодного JS, його вміст
 * лежить у відданому HTML, і саме тому його бачать пошук і
 * ШІ-асистент — той канал, заради якого FAQ і просили.
 *
 * Від теми взято оформлення: рядок `flex` із простором між питанням і
 * значком, значок у рамці, вертикальна риска плюса повертається на 90°
 * у відкритому стані.
 *
 * 🔴 ПОРОЖНІЙ ПЕРЕЛІК НЕ МАЛЮЄ НІЧОГО — ні заголовка, ні рамки. Секція
 * каталогу, яка на порожніх даних показує порожню рамку, гірша за її
 * відсутність: читач бачить, що тут мало щось бути.
 */

export interface FaqItem {
  /** Стабільний ключ: формулювання питання може змінитись. */
  key: string;
  question: string;
  answer: ReactNode;
}

const FAQ_CSS = `
.ct-faq{display:flex;flex-direction:column;gap:4px;margin-top:12px}
.ct-faq__item{border-radius:calc(var(--r,16px) * .75);background-color:var(--color-surface-2)}
.ct-faq__control{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;cursor:pointer;list-style:none;font-weight:600;line-height:1.5;text-align:start;word-break:break-word;color:var(--color-heading)}
.ct-faq__control::-webkit-details-marker{display:none}
.ct-faq__control::marker{content:""}
.ct-faq__control:focus-visible{outline:1px solid var(--color-heading);outline-offset:-2px;border-radius:inherit}
.ct-faq__icon{display:flex;flex-shrink:0;align-items:center;justify-content:center;width:48px;height:40px;border-radius:calc(var(--r,16px) * .75);border:1px solid var(--color-line-2);color:var(--color-heading)}
.ct-faq__icon svg{width:16px;height:16px}
.ct-faq__plus-v{transform-origin:center;transition:transform .2s}
.ct-faq__item[open] .ct-faq__plus-v{transform:rotate(90deg)}
.ct-faq__inner{display:flex;flex-direction:column;gap:12px;padding:0 16px 8px;color:var(--color-ink-2)}
@media(min-width:992px){.ct-faq{gap:12px}.ct-faq__item{border-radius:var(--r,16px)}.ct-faq__control{padding:16px 20px 16px 32px;font-size:1.5rem;line-height:1.333}.ct-faq__icon{width:80px;height:64px;border-radius:calc(var(--r,16px) * 1.25)}.ct-faq__inner{padding:0 32px 16px}}
@media(prefers-reduced-motion:reduce){.ct-faq__plus-v{transition:none}}
`;
export default function Faq({
  items,
  testId,
}: {
  items: readonly FaqItem[];
  testId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <style href="ct-faq" precedence="ct-components">
        {FAQ_CSS}
      </style>
  <div className="ct-faq" data-testid={testId}>
    {items.map((f) => (
      <details key={f.key} className="ct-faq__item">
        <summary className="ct-faq__control">
          <span className="ct-faq__question">{f.question}</span>
          <span className="ct-faq__icon" aria-hidden="true">
            {/* The theme's `plus-minus` icon: two bars; the vertical one
                turns 90° onto the horizontal when the item is open. */}
            <svg viewBox="0 0 16 16" fill="none" focusable="false">
              <path d="M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path
                className="ct-faq__plus-v"
                d="M8 2v12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </summary>
        <div className="ct-faq__inner">
          <p className="text-sm">{f.answer}</p>
        </div>
      </details>
    ))}
  </div>
    </>
  );
}
