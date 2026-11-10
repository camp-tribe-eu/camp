import type { ReactNode } from "react";

/**
 * Картки-цитати — CAMP-449, секція 9 каталогу (знімок ревю 441/08).
 *
 * 🔴 СЕКЦІЯ ЖИВЕ В КАТАЛОЗІ Й НЕ СТОЇТЬ НА ЖОДНІЙ СТОРІНЦІ САЙТУ, і це
 * вимога картки дослівно: «Поки відгуків немає — секцію не вигадувати,
 * тримати в каталозі». Відгуків у нас немає жодного, тож усе, що вона
 * могла б показати читачеві сьогодні, було б вигадкою.
 *
 * 🔴 І ДЕНЬ, КОЛИ ВОНА ВИЙДЕ НА САЙТ, — ЦЕ НЕ ЛИШЕ ВЕРСТКА. Відгуки
 * роблять нас hosting service за DSA (контактна точка, механізм скарг,
 * прозорі умови), а ст. 7(6) UCPD вимагає сказати, ЧИ ми їх перевіряємо
 * і як. Скіл `camptribe-legal` тримає цей перелік. Тому компонент тут —
 * це заготовка вигляду, а не дозвіл увімкнути фічу.
 *
 * СТРУКТУРА З ТЕМИ: секція `reviews` Fuse (`assets/reviews.build.css`,
 * 8 401 байт; читано з архіву `fuse.zip` 10.11.2026). Дослівно взято:
 *
 *   .reviews__card{position:relative;overflow:hidden;
 *       border-radius:var(--global-border-radius)}
 *   .reviews__slide{display:flex;flex-direction:column;gap:12px;
 *       padding:20px}                                   ≥992: gap:16px
 *   .reviews__quote{margin:0;width:100%}
 *   .reviews__quote-text{font-size:calc(var(--body-font-size) * 1.25);
 *       font-weight:700;line-height:1.3}
 *   .reviews__navigation-author-wrapper{display:flex;align-items:center;
 *       column-gap:12px}                        ≥992: column-gap:16px
 *   .reviews__author-thumb{overflow:hidden;
 *       border-radius:calc(var(--global-border-radius) / 2)}  48×48
 *   .reviews__navigation-name{font-size:16px;font-weight:600;
 *       line-height:1.5}
 *   .reviews__navigation-role{font-size:14px;font-weight:400;
 *       line-height:1.2857;color:var(--reviews-role-color)}
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо:
 *   - слайдер (Swiper, стрілки, мініатюри авторів) не беремо: картка
 *     просить ТРИ КАРТКИ поруч, а не карусель, і карусель ховає дві
 *     цитати з трьох від пошуковика й від читача без JS;
 *   - розмитий фон секції (`filter:blur(50px)` на фото під картками) не
 *     беремо: він існує, щоб підкласти щось під один великий слайд;
 *   - розмір цитати 2.75× з ≥992 не беремо — він для ОДНОГО слайда на
 *     всю ширину. Три картки поруч лишаються на 1.25×.
 *
 * Зірки — за формою сніпета теми `product-rating.liquid`: самі зірки
 * під `aria-hidden`, а поруч прихований текст із числом і максимумом.
 */

export interface ReviewItem {
  /** Стабільний ключ: текст цитати може змінитись. */
  key: string;
  quote: ReactNode;
  author: string;
  role?: string;
  avatar?: { src: string; alt?: string };
  /**
   * 🔴 Необовʼязкова НАВМИСНО. Зірковий ряд без числа — це оформлення,
   * що вдає дані. Немає оцінки — немає зірок.
   */
  rating?: number;
  /** Шкала оцінки. Тема типово має 5. */
  ratingMax?: number;
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const REVIEWS_CSS = `
.ct-rev{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.ct-rev__card{position:relative;display:flex;flex-direction:column;gap:12px;overflow:hidden;padding:20px;border-radius:var(--r,16px);background-color:var(--color-surface-2)}
.ct-rev__stars{display:flex;gap:2px}
.ct-rev__star{width:16px;height:16px;flex:none;color:var(--color-line-2)}
.ct-rev__star--on{color:var(--color-heading)}
.ct-rev__quote{margin:0;width:100%}
.ct-rev__quote-text{font-size:calc(var(--body-font-size,16px) * 1.25);font-weight:700;line-height:1.3;color:var(--color-heading)}
.ct-rev__author{display:flex;align-items:center;column-gap:12px;margin-top:auto}
.ct-rev__thumb{flex:0 0 48px;width:48px;height:48px;overflow:hidden;border-radius:calc(var(--r,16px) / 2)}
.ct-rev__thumb-image{width:100%;height:100%;object-fit:cover}
.ct-rev__name{margin:0;font-size:16px;font-weight:600;line-height:1.5;color:var(--color-heading)}
.ct-rev__role{margin:0;font-size:14px;font-weight:400;line-height:1.2857;color:var(--color-ink-2)}
@media(min-width:992px){
.ct-rev{flex-direction:row;gap:16px}
.ct-rev__card{flex:1 1 0;gap:16px}
.ct-rev__author{column-gap:16px}}
`;

function Star({ on }: { on: boolean }) {
  return (
    <svg
      className={`ct-rev__star${on ? " ct-rev__star--on" : ""}`}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  );
}

/**
 * 🔴 ЗАТИСКАЄТЬСЯ ЧИСЛО, А НЕ РЯД — І ЦЕ РІЗНІ РЕЧІ.
 *
 * Ряд затиснутий сам собою: він завдовжки `max`, тож `rating: 9` при
 * шкалі 5 не намалює девʼяти зірок хоч би що. Мутація «прибрати
 * затискання з ряду» це й довела — усі тести лишились зеленими, бо
 * прибране було мертвим кодом.
 *
 * Збрехати може ЧИСЛО, яке читає читач екрана: «9 out of 5» або
 * «−3 out of 5». Коли відгуки зʼявляться, оцінка прийде ззовні — із
 * форми, з імпорту, з чужого API, — тож затискається саме воно, і на
 * ньому ж будується ряд.
 *
 * 🔴 ЗАТИСКАЄМО, АЛЕ НЕ ОКРУГЛЯЄМО: «4.5 out of 5» — правда, яку варто
 * вимовити. Округлення лишається ряду, бо пів зірки він малювати не вміє.
 */
function clampRating(rating: number, max: number) {
  return Math.min(Math.max(rating, 0), max);
}

function starRow(rating: number, max: number) {
  const whole = Math.round(rating);
  return Array.from({ length: max }, (_, i) => i < whole);
}

export default function ReviewCards({
  items,
  testId,
}: {
  items: readonly ReviewItem[];
  testId?: string;
}) {
  // 🔴 ПРАВИЛО КАТАЛОГУ: порожні дані → секції немає зовсім.
  if (items.length === 0) return null;

  return (
    <>
      <style href="ct-rev" precedence="ct-components">
        {REVIEWS_CSS}
      </style>
      <ul className="ct-rev" data-testid={testId}>
        {items.map((r) => {
          const max =
            Number.isFinite(r.ratingMax) && (r.ratingMax as number) > 0
              ? Math.round(r.ratingMax as number)
              : 5;
          const hasRating = typeof r.rating === "number" && Number.isFinite(r.rating);
          return (
            <li key={r.key} className="ct-rev__card">
              {hasRating && (
                <span className="ct-rev__stars">
                  {/* Форма сніпета теми: число читає читач екрана, зірки — око. */}
                  <span className="sr-only">
                    {`${clampRating(r.rating as number, max)} out of ${max}`}
                  </span>
                  {starRow(clampRating(r.rating as number, max), max).map(
                    (on, i) => (
                      <Star key={i} on={on} />
                    ),
                  )}
                </span>
              )}
              <blockquote className="ct-rev__quote">
                <p className="ct-rev__quote-text">{r.quote}</p>
              </blockquote>
              <div className="ct-rev__author">
                {r.avatar && (
                  <span className="ct-rev__thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
                    <img
                      className="ct-rev__thumb-image"
                      src={r.avatar.src}
                      alt={r.avatar.alt ?? ""}
                      loading="lazy"
                    />
                  </span>
                )}
                <span>
                  <p className="ct-rev__name">{r.author}</p>
                  {r.role && <p className="ct-rev__role">{r.role}</p>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
