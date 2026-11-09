import Link from "next/link";

/**
 * Пагінація за стилями теми — CAMP-451.
 *
 * До цього пагінація регіону була рядом голих кнопок-чіпів: 26 сторінок
 * Франції давали 26 кнопок у два ряди. Власник (знімки 441/52, 441/59):
 * «пагінація за стилями теми».
 *
 * 🔴 СТРУКТУРА З ТЕМИ, НЕ З ГОЛОВИ. Розмітка — `snippets/pagination.liquid`
 * Fuse, правила — `main.build.css` (1 897 правил, 268 797 байт; читано з
 * архіву `fuse 1.0.1.zip` 09.11.2026). Дослівно:
 *
 *   .pagination .pagination__list{display:flex;align-items:center;
 *       column-gap:8px}                                     ≥768: gap:12px
 *   .pagination .pagination__item-wrapper{
 *       background-color:var(--color-background-secondary);
 *       border-radius:var(--global-border-radius);padding:4px}  ≥768: 8px
 *   .pagination .pagination__item-wrapper .pagination__list     ≥768: gap:8px
 *   .pagination .pagination__item{position:relative;display:flex;
 *       justify-content:center}
 *   .pagination .pagination__item .icon{width:20px;height:20px}
 *   .pagination .pagination__item--prev .pagination__link,
 *   .pagination .pagination__item--next .pagination__link{
 *       width:46px;height:46px;
 *       background-color:var(--color-background-secondary)}
 *                                   ≥576: 56×56    ≥768: 64×72
 *   .pagination .pagination__link{position:relative;display:inline-flex;
 *       align-items:center;justify-content:center;width:36px;height:36px;
 *       border-radius:12px;border:1px solid var(--color-border-primary);
 *       font-weight:600;line-height:1.5;text-align:center;
 *       text-decoration:none;color:var(--color-text-primary);
 *       transition-property:border,background;
 *       transition-duration:var(--timing-base)}
 *                                   ≥576: 48×48, radius --global-border-radius
 *   .pagination .pagination__link.is-active{
 *       background-color:var(--color-background-accent);
 *       border-color:var(--color-border-secondary);font-weight:bold}
 *   .pagination .pagination__link--no-active{
 *       background-color:var(--color-background-secondary);
 *       color:var(--color-text-secondary);opacity:.6}
 *   .pagination .pagination__link--ellipsis{border-color:transparent}
 *                                   ≤575.98: 24×24
 *   @media(hover){.pagination__link:hover:not(.pagination__link--ellipsis){
 *       border-color:var(--color-border-secondary)}}
 *   @media(max-width:767.98px){.pagination__item--hidden-mobile{display:none}}
 *
 * Shopify віддає темі `paginate.parts` уже з «…»; тут ту саму форму дає
 * `paginationParts`: перша, остання, поточна з сусідами, і три крапки
 * там, де між ними прогалина більша за одну сторінку. Прогалина рівно в
 * одну сторінку друкується числом, а не крапками — крапки замість однієї
 * сторінки лише довші за неї.
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо:
 *   - на телефоні тема ховає всі внутрішні сторінки, крім поточної; тут
 *     лишаються також друга й передостання, бо з першої сторінки «2» —
 *     єдиний крок уперед, видимий без стрілки, і саме його натискає
 *     `tests/e2e/hubs.spec.ts` на мобільному проєкті;
 *   - `flex-wrap:wrap` на переліку: на 320px стрілки переносяться на
 *     новий рядок замість того, щоб вилізти за край екрана;
 *   - зона натискання. Посилання теми на телефоні 36px; наше правило —
 *     48px для пальця (`button.tsx`), тож на ньому стоїть `touch-target`
 *     (псевдоелемент із globals.css), а вигляд лишається 36px, як у теми;
 *   - поточна сторінка в теми — `<a role="link" aria-disabled>` без href;
 *     тут це справжнє посилання на саму себе з `aria-current="page"`:
 *     так було до цього і так її знаходять тести.
 *
 * 🔴 ПЛЯМА БЕЗ JAVASCRIPT. Усе — звичайні `<a href>`: критерій картки
 * CAMP-71 — обхід без JS, і пагінатор на обробнику кліку для нього
 * невидимий.
 *
 * 🔴 CSS ЇДЕ В HTML (`<style href precedence>`), як у ticker.tsx: тест
 * читає правило з відданої розмітки, а не з константи.
 */

export type PaginationPart = { kind: "page"; n: number } | { kind: "gap" };

/**
 * Частини пагінатора для сторінки `page` з `pages`: 1 … N у формі теми.
 *
 * `pages < 2` → порожньо: одна сторінка не пагінується. `page` поза
 * межами підтягується до них, щоб зіпсований номер не дав порожній ряд.
 */
export function paginationParts(page: number, pages: number): PaginationPart[] {
  if (!Number.isInteger(pages) || pages < 2) return [];
  const cur = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  const keep = new Set<number>([1, pages, cur - 1, cur, cur + 1]);
  const out: PaginationPart[] = [];
  let last = 0;
  for (let n = 1; n <= pages; n++) {
    if (!keep.has(n)) continue;
    if (n - last === 2) out.push({ kind: "page", n: n - 1 });
    else if (n - last > 2) out.push({ kind: "gap" });
    out.push({ kind: "page", n });
    last = n;
  }
  return out;
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const PAGINATION_CSS = `
.ct-pagination__list{display:flex;flex-wrap:wrap;align-items:center;gap:8px;list-style:none;margin:0;padding:0}
.ct-pagination__item-wrapper{background-color:var(--color-surface-2);border-radius:var(--r,16px);padding:4px}
.ct-pagination__item{position:relative;display:flex;justify-content:center}
.ct-pagination__item .ct-pagination__icon{width:20px;height:20px}
.ct-pagination__link{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:12px;border:1px solid var(--color-line-2);font-weight:600;line-height:1.5;text-align:center;text-decoration:none;color:var(--color-heading);font-variant-numeric:tabular-nums;transition-property:border-color,background-color;transition-duration:.2s;transition-timing-function:ease-in-out}
.ct-pagination__item--prev .ct-pagination__link,.ct-pagination__item--next .ct-pagination__link{width:46px;height:46px;background-color:var(--color-surface-2)}
.ct-pagination__link.is-active{background-color:var(--color-accent-surface);border-color:var(--color-line-blue);font-weight:700}
.ct-pagination__link--no-active{background-color:var(--color-surface-2);color:var(--color-ink-2);opacity:.6}
.ct-pagination__link--ellipsis{border-color:transparent}
.ct-pagination__link:focus-visible{outline:2px solid var(--color-line-blue);outline-offset:2px}
@media(hover:hover),(pointer:fine){a.ct-pagination__link:hover{border-color:var(--color-line-blue)}}
@media(max-width:575.98px){.ct-pagination__link--ellipsis{width:24px;height:24px}}
@media(max-width:767.98px){.ct-pagination__item--hidden-mobile{display:none}}
@media(min-width:576px){.ct-pagination__item--prev .ct-pagination__link,.ct-pagination__item--next .ct-pagination__link{width:56px;height:56px}.ct-pagination__link{width:48px;height:48px;border-radius:var(--r,16px)}}
@media(min-width:768px){.ct-pagination__list{gap:12px}.ct-pagination__item-wrapper{padding:8px}.ct-pagination__item-wrapper .ct-pagination__list{gap:8px}.ct-pagination__item--prev .ct-pagination__link,.ct-pagination__item--next .ct-pagination__link{width:64px;height:72px}}
@media(prefers-reduced-motion:reduce){.ct-pagination__link{transition:none}}
`;

function Arrow({ dir }: { dir: "left" | "right" }) {
  const d = dir === "left" ? "M12.5 4 6.5 10l6 6" : "M7.5 4l6 6-6 6";
  return (
    <svg
      className="ct-pagination__icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Пагінатор. `href(n)` віддає адресу сторінки `n`; `rel(n)` — її `rel`
 * (`nofollow` на адресах фільтра, див. hub-filters.ts), або `undefined`.
 */
export function Pagination({
  page,
  pages,
  href,
  rel,
  className,
}: {
  page: number;
  pages: number;
  href: (n: number) => string;
  rel?: (n: number) => string | undefined;
  className?: string;
}) {
  const parts = paginationParts(page, pages);
  if (parts.length === 0) return null;
  const relOf = (n: number) => rel?.(n);
  // На телефоні ховаються сусіди поточної, крім другої та передостанньої.
  const hiddenMobile = (n: number) =>
    n !== 1 && n !== pages && n !== page && n !== 2 && n !== pages - 1;

  // 🔴 Без `aria-label` на номерах: доступне ім'я посилання — його число,
  // і саме так його знаходить `getByRole('link', { name: '2' })` у
  // tests/e2e/hubs.spec.ts. Підпис теми «Page 2» зламав би цей пошук.
  const step = (dir: "prev" | "next") => {
    const n = dir === "prev" ? page - 1 : page + 1;
    const live = n >= 1 && n <= pages;
    const label = dir === "prev" ? "Previous page" : "Next page";
    return (
      <li className={`ct-pagination__item ct-pagination__item--${dir}`}>
        {live ? (
          <Link href={href(n)} rel={relOf(n)} className="ct-pagination__link touch-target" aria-label={label}>
            <Arrow dir={dir === "prev" ? "left" : "right"} />
          </Link>
        ) : (
          <span className="ct-pagination__link ct-pagination__link--no-active" aria-hidden="true">
            <Arrow dir={dir === "prev" ? "left" : "right"} />
          </span>
        )}
      </li>
    );
  };

  return (
    <nav
      aria-label="Pagination"
      className={["ct-pagination", className].filter(Boolean).join(" ")}
    >
      <style href="ct-pagination" precedence="ct-components">
        {PAGINATION_CSS}
      </style>
      <ul className="ct-pagination__list">
        {step("prev")}
        <li className="ct-pagination__item-wrapper">
          <ul className="ct-pagination__list">
            {parts.map((p, i) =>
              p.kind === "gap" ? (
                <li className="ct-pagination__item" key={`gap-${i}`}>
                  <span className="ct-pagination__link ct-pagination__link--ellipsis" aria-hidden="true">
                    …
                  </span>
                </li>
              ) : (
                <li
                  className={
                    hiddenMobile(p.n)
                      ? "ct-pagination__item ct-pagination__item--hidden-mobile"
                      : "ct-pagination__item"
                  }
                  key={p.n}
                >
                  <Link
                    href={href(p.n)}
                    rel={relOf(p.n)}
                    aria-current={p.n === page ? "page" : undefined}
                    className={
                      p.n === page
                        ? "ct-pagination__link is-active touch-target"
                        : "ct-pagination__link touch-target"
                    }
                  >
                    {p.n}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </li>
        {step("next")}
      </ul>
    </nav>
  );
}
