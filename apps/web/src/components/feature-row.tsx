import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Рядок «іконка + тайтл + текст» — секція каталогу CAMP-449, пункт 5
 * (знімок 441/19), до чотирьох у ряд.
 *
 * 🔴 РОЗМІРИ З ТЕМИ, ЧИТАНО З `assets/benefits.build.css` 09.11.2026:
 *
 *   .benefits__list{display:flex;flex-direction:column;gap:4px}
 *        ≥768: flex-direction:row;gap:12px
 *   .benefits__item{padding:24px;border-radius:calc(var(--global-border-radius)*.75);
 *        display:flex;flex-direction:column;gap:12px;border:1px solid …}
 *        ≥768: aspect-ratio:379/258;padding:32px;justify-content:center
 *   .benefits__item-title{font-weight:700;font-size:calc(var(--body-font-size)*3);
 *        line-height:1}
 *   .benefits__item-text{font-weight:600;line-height:1.5}
 *
 * Радіус 12px — це наш `--r`/0.75 при 16px, той самий поділ, що в теми.
 *
 * 🔴 `aspect-ratio` З ТЕМИ НЕ ВЗЯТО, і це свідомо. У теми в заголовку
 * картки стоїть ЧИСЛО («500+»), тож висота передбачувана. У нас там
 * речення, і фіксована пропорція або ріже текст, або лишає порожнечу
 * під коротким. Замість неї — рівна висота рядка засобами `flex`, що
 * дає те саме вирівнювання без обрізання.
 *
 * 🔴 ПОРОЖНІЙ ПЕРЕЛІК НЕ МАЛЮЄ НІЧОГО — правило каталогу. Секція, яка
 * на порожніх даних показує порожню рамку, гірша за її відсутність.
 */

export interface FeatureItem {
  key: string;
  /** Значок: наш `<svg>`. Необовʼязковий — буває картка без нього. */
  icon?: ReactNode;
  title: string;
  text: ReactNode;
  /**
   * 🔴 Те, що МУСИТЬ ПОЧУТИ читач екрана, якщо значок несе зміст.
   *
   * Значок стоїть під `aria-hidden`, бо зазвичай він лише картинка. Але
   * номер кроку — це не картинка: до CAMP-449 у розмітці стояло «Step
   * 1» звичайним текстом, і саме його вимовляв читач екрана. Перша
   * редакція цієї секції замінила той текст кружечком із цифрою під
   * `aria-hidden` — тобто номер кроку зник для нього зовсім. Упіймав
   * `home.spec.ts`, не я.
   */
  srLabel?: string;
  /**
   * 🔴 Адреса робить КАРТКУ посиланням, а не лише її назву.
   *
   * CAMP-458: на сторінці пального по країні два важливі переходи стояли
   * підкресленими словами в абзаці, і власник сказав прямо — «посилання
   * майже не видно». Ціль у 16 px тексту й ціль у картці 300×100 — це
   * різні речі для пальця й для ока.
   */
  href?: string;
}

const FEATURE_CSS = `
.ct-feat{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.ct-feat__item{display:flex;flex-direction:column;gap:12px;padding:24px;border:1px solid var(--color-line-2);border-radius:calc(var(--r,16px) * .75);background-color:var(--color-surface)}
.ct-feat__icon{display:flex;align-items:center;justify-content:center;width:40px;height:40px;flex:0 0 auto;color:var(--color-heading)}
.ct-feat__icon svg{width:28px;height:28px}
.ct-feat__step{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:1px solid var(--color-control-line);font-weight:700;line-height:1}
.ct-feat__title{font-weight:700;line-height:1.2;color:var(--color-heading)}
.ct-feat__text{font-weight:600;line-height:1.5;color:var(--color-ink-2)}
.ct-feat__item--link{display:flex;padding:0}
.ct-feat__link{display:flex;flex:1 1 auto;flex-direction:column;gap:12px;padding:24px;border-radius:inherit;color:inherit;text-decoration:none}
.ct-feat__link:focus-visible{outline:2px solid var(--color-heading);outline-offset:-2px;border-radius:inherit}
/* 🔴 ЗНАЧОК ЛІВОРУЧ — СІТКОЮ, А НЕ НОВОЮ ОБГОРТКОЮ. Обгортка навколо
   назви й тексту змінила б розмітку й там, де значок лишається зверху
   (кроки на головній), а з нею й базу знімків. Сітка міняє лише
   розкладку: значок займає обидва рядки першої колонки. */
.ct-feat--icon-left .ct-feat__item:not(.ct-feat__item--link),.ct-feat--icon-left .ct-feat__link{display:grid;grid-template-columns:40px minmax(0,1fr);column-gap:16px;row-gap:8px;align-content:start}
.ct-feat--icon-left .ct-feat__icon{grid-row:1 / span 2;grid-column:1}
.ct-feat--icon-left .ct-feat__title,.ct-feat--icon-left .ct-feat__text{grid-column:2}
@media(hover:hover),(pointer:fine){.ct-feat__link:hover .ct-feat__title{text-decoration:underline}}
@media(min-width:768px){
.ct-feat{flex-direction:row;gap:12px}
.ct-feat__item{flex:1 1 0;padding:32px;justify-content:center}
.ct-feat__item--link{padding:0}
.ct-feat__link{padding:32px;justify-content:center}
.ct-feat--icon-left .ct-feat__link{padding:24px}
}
`;

export default function FeatureRow({
  items,
  testId,
  ordered = false,
  titleAs: TitleTag = 'span',
  iconSide = 'top',
}: {
  items: readonly FeatureItem[];
  testId?: string;
  /**
   * 🔴 `<ol>`, КОЛИ ПОРЯДОК Є ЗМІСТОМ. Кроки «How this works» були
   * впорядкованим списком до цієї секції, і перша її редакція зробила
   * їх `<ul>` — для читача екрана це вже не «крок 1 з 3», а просто
   * перелік. Порядок там не оформлення, а сама суть.
   */
  ordered?: boolean;
  /**
   * 🔴 Заголовок картки буває ЗАГОЛОВКОМ. Кроки мали `<h3>` і стояли в
   * обрисі сторінки; `span` викинув їх звідти мовчки.
   */
  titleAs?: 'span' | 'h3';
  /**
   * 🔴 `left` вимагає значка в КОЖНІЙ картці: сітка тримає першу
   * колонку під нього, і картка без значка лишила б діру. Тому варіант
   * названий, а не виведений із даних — щоб забути було важче.
   */
  iconSide?: 'top' | 'left';
}) {
  if (items.length === 0) return null;
  const List = ordered ? 'ol' : 'ul';
  const listClass = `ct-feat${iconSide === 'left' ? ' ct-feat--icon-left' : ''}`;
  return (
    <>
      <style href="ct-feat" precedence="ct-components">
        {FEATURE_CSS}
      </style>
      <List className={listClass} data-testid={testId}>
        {items.map((f) => {
          const inside = (
            <>
              {f.srLabel && <span className="sr-only">{f.srLabel}</span>}
              {f.icon && (
                <span className="ct-feat__icon" aria-hidden="true">
                  {f.icon}
                </span>
              )}
              <TitleTag className="ct-feat__title">{f.title}</TitleTag>
              <span className="ct-feat__text">{f.text}</span>
            </>
          );
          return (
            <li
              key={f.key}
              className={`ct-feat__item${f.href ? ' ct-feat__item--link' : ''}`}
            >
              {f.href ? (
                <Link className="ct-feat__link" href={f.href}>
                  {inside}
                </Link>
              ) : (
                inside
              )}
            </li>
          );
        })}
      </List>
    </>
  );
}
