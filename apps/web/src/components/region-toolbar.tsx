import Link from 'next/link';
import {
  AMENITY_KEYS,
  AMENITY_LABEL_SHORT,
  SPOT_TYPE_LABEL_SHORT,
  SPOT_TYPES,
  type RegionListingData,
} from '@/lib/api';
import {
  activeFilters,
  amenityList,
  hubHref,
  isFiltering,
  REGION_SORTS,
  relFor,
  SORT_LABEL,
  withAmenity,
  without,
  withSort,
  withType,
  withUnknown,
  type HubQuery,
} from '@/lib/hub-filters';
import { ButtonLink } from '@/components/button';

/**
 * Керування переліком кемпінгів регіону — CAMP-452.
 *
 * Власник про власну ж пропозицію: «якщо ми зліва тут обираємо, то не
 * бачимо, що фільтрується внизу». Дірка не в тому, що фільтр зліва, а в
 * тому, що керування відірване від того, чим керує. Тому обидві частини
 * стоять ПРЯМО над картками:
 *
 *   RegionToolbar      липка смуга: «Filters», сортування, активні
 *                      фільтри-пігулки з хрестиком, «N sites match»
 *   RegionFilterPanel  усі значення фільтра — чекбокс-чіпи з лічильниками
 *
 * 🔴 ЧОМУ ЧІПИ НЕ В ЛИПКІЙ СМУЗІ, хоча ескіз картки малює їх там.
 * Пʼятнадцять чіпів по 50px (12+24+12 теми, див. нижче) — це три ряди
 * на 1180px і вісім на 375px: 170 і 450px липкої смуги відповідно, тобто
 * пʼята частина ноутбука й понад половину телефона — назавжди перекриті.
 * Тема вирішує те саме так: липка пігулка тримає лише «Filters | Sort by»,
 * а значення живуть у шухляді. Тут шухляди немає (вона на JavaScript, а
 * критерій CAMP-71 — обхід без нього), тож значення лежать у потоці
 * одразу під смугою; «Filters» у смузі — посилання на них (`#filters`),
 * і це єдине, що в ній робить кнопка теми.
 *
 * 🔴 УСЕ — ЗВИЧАЙНІ `<a href>` (lib/hub-filters.ts): жодного обробника
 * кліку. Сортування — `<details>`/`<summary>` з посиланнями всередині,
 * як FAQ-акордеон (hub-stats.tsx): відкривається без скрипту.
 *
 * 🔴 ЧЕКБОКС ВИГЛЯДАЄ ЧЕКБОКСОМ ДО КЛІКУ — наскрізне правило власника:
 * квадратик зліва, галочка після. Чіп — посилання, не `<input>` (стан
 * живе в адресі, не у формі), але малюється за `.checkbox-label__box`
 * теми: 24×24, рамка 1px, радіус r/2, і галочка з `opacity:0`, яка стає
 * 1 у вибраному стані (`aria-current="true"`).
 *
 * 🔴 НЕ `<ul>`: обхід `main ul li a` у tests/e2e/hubs.spec.ts має першим
 * клікнути кемпінг, а не чіп чи варіант сортування.
 *
 * 🔴 ЧИСЛА — З ТЕМИ FUSE, читано з архіву `fuse 1.0.1.zip` 09.11.2026:
 *
 *   assets/collection.build.css
 *   .collection__header-wrapper{display:flex;justify-content:space-between;
 *       align-items:center;gap:8px;padding:8px}
 *   .collection__header-wrapper::before{backdrop-filter:blur(8px);
 *       background-color:var(--panel-bg-color);border-radius:12px;z-index:-1}
 *   .collection__header-form-sort{display:flex;align-items:center;gap:8px}
 *   .collection__header-form-sort .custom-dropdown__trigger{padding:0;
 *       border-color:transparent;background-color:transparent;width:108px}
 *   .collection__header-form-label{display:flex;align-items:center;gap:8px;
 *       line-height:1.12;opacity:.6}
 *   .collection__item--big-card-* .product-card{position:sticky;
 *       top:calc(var(--header-height-sticky) + 24px)}
 *
 *   assets/main.build.css
 *   .custom-dropdown{position:relative}
 *   .custom-dropdown__trigger{display:flex;gap:12px;justify-content:space-between;
 *       align-items:center;line-height:1.5;font-weight:600}
 *   .custom-dropdown__trigger-icon{min-width:20px;transition-property:transform}
 *   .custom-dropdown__options{position:absolute;z-index:2;top:calc(100% + 2px);
 *       width:100%;background-color:var(--color-background);
 *       border:1px solid var(--color-border-thirdly);
 *       border-radius:var(--global-border-radius);padding:8px;display:flex;
 *       flex-direction:column;gap:4px;box-shadow:0 4px 20px 0 rgba(0,0,0,.08)}
 *   .custom-dropdown__option{padding:12px 16px;
 *       border-radius:calc(var(--global-border-radius)/2);font-weight:600;
 *       line-height:1.18}
 *   .checkbox-label{display:flex;gap:12px;align-items:center}
 *   .checkbox-label__box{width:24px;height:24px;flex-shrink:0;
 *       border:1px solid var(--color-border-primary);
 *       border-radius:calc(var(--global-border-radius)/2);
 *       background-color:var(--color-background)}
 *   .checkbox-label__box .icon{opacity:0}
 *   .checkbox:checked + .checkbox-label .checkbox-label__box{
 *       border-color:var(--color-accent);background-color:var(--color-accent)}
 *   .checkbox:checked + .checkbox-label .checkbox-label__box .icon{opacity:1}
 *
 *   assets/product-filters.build.css (шухляда фільтрів)
 *   .product-filters__form-label{display:flex;align-items:center;gap:12px;
 *       font-size:calc(var(--body-font-size)*.875);font-weight:500;line-height:1.333}
 *   .product-filters__form-selected-list{display:flex;flex-wrap:wrap;
 *       margin:0 -4px;row-gap:8px}   .product-filters__form-selected-item{padding:0 4px}
 *   .product-filters__form-selected-button{display:flex;justify-content:center;
 *       align-items:center;padding:8px 12px;background-color:var(--filter-card-bg-color);
 *       font-size:calc(var(--body-font-size)*.875);font-weight:500;line-height:1.28;
 *       border:1px solid transparent;border-radius:50px}
 *   .product-filters__form-selected-button .icon{width:12px;height:12px;
 *       margin-inline-start:8px}
 *   .filter-list{display:flex;flex-wrap:wrap;gap:8px}
 *   .filter-list__input-label{display:inline-flex;align-items:center;
 *       line-height:1.5;padding:12px 16px;border-radius:var(--global-border-radius);
 *       border:1px solid var(--filter-card-border-color)}
 *   .filter-list__checkbox:checked + .filter-list__input-label{
 *       border-color:var(--filter-value-active-border-color);
 *       box-shadow:0 0 0 1px var(--filter-value-active-border-color);
 *       background-color:var(--filter-value-active-bg-color)}
 *   .filter-list__input-label-count{margin-inline-start:8px}
 *
 *   Кольори шухляди за замовчуванням (snippets, `settings.filter_*`):
 *   картка #FFFFFF → --color-surface; рамка #CACACA → --color-line;
 *   активна рамка #7C92B7 → --color-line-blue; активне тло #DFE9F9 →
 *   --color-accent-surface; пігулка панелі #000000CC — у нас світле скло
 *   шапки (`.ct-glass`, globals.css: той самий blur(8px)).
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо:
 *   - смуга липне ВГОРІ під шапкою, а не внизу екрана: вона має стояти над
 *     картками (ескіз власника); зсув — її ж `+ 24px` для липкого під
 *     липкою шапкою. Висоту шапки пише сама шапка у `--ct-header-h`
 *     (site-header-frame.tsx: 63px від `sm`, 73px нижче); 63px — запасне
 *     значення без JavaScript;
 *   - пігулка активного фільтра в теми 34px заввишки; зона натискання в нас
 *     48 (CAMP-345, число самої теми) — її дає `touch-target`, а відстань
 *     між рядами 14px замість 8, бо 48 − 34 = 14 (правило з globals.css:
 *     інакше зони сусідніх рядів перекриваються);
 *   - тригер сортування в теми — рядок тексту; тут 48px заввишки з тієї ж
 *     причини;
 *   - «Clear all» у теми зʼявляється від двох фільтрів; тут «clear filters»
 *     стоїть у реченні з лічильником завжди, бо саме його натискають тести
 *     обходу (hubs, hub-filters) і читачі з одним фільтром.
 */

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const TOOLBAR_CSS = `
.ct-toolbar{position:sticky;top:calc(var(--ct-header-h,63px) + 24px);z-index:var(--layer-sticky-btn,7);margin-top:24px}
.ct-toolbar__row{position:relative;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:8px}
.ct-toolbar__row::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:12px;border:1px solid var(--color-line-2);background-color:color-mix(in srgb,var(--color-surface) var(--glass-tint,90%),transparent);backdrop-filter:blur(8px) saturate(180%)}
@supports not (backdrop-filter:blur(1px)){.ct-toolbar__row::before{background-color:var(--color-surface)}}
.ct-toolbar__controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ct-toolbar__count{margin:0;font-size:.875rem;line-height:1.5;color:var(--color-ink-2)}
.ct-toolbar__count a{color:var(--color-line-blue);text-decoration:underline}
.ct-sort{position:relative}
.ct-sort__trigger{display:flex;gap:12px;justify-content:space-between;align-items:center;min-width:108px;min-height:48px;padding:0 8px;cursor:pointer;list-style:none;line-height:1.5;font-weight:600;color:var(--color-heading)}
.ct-sort__trigger::-webkit-details-marker{display:none}
.ct-sort__trigger::marker{content:""}
.ct-sort__trigger:focus-visible{outline:2px solid var(--color-heading);outline-offset:2px;border-radius:12px}
.ct-sort__label{display:flex;align-items:center;gap:8px;line-height:1.12;font-weight:400;opacity:.6}
.ct-sort__icon{min-width:20px;width:20px;height:20px;transition:transform .4s}
.ct-sort[open] .ct-sort__icon{transform:rotate(180deg)}
.ct-sort__options{position:absolute;z-index:2;top:calc(100% + 2px);left:0;min-width:240px;display:flex;flex-direction:column;gap:4px;padding:8px;background-color:var(--color-surface);color:var(--color-heading);border:1px solid var(--color-line-2);border-radius:var(--r,16px);box-shadow:0 4px 20px 0 rgba(0,0,0,.08)}
.ct-sort__option{display:block;padding:12px 16px;border-radius:calc(var(--r,16px) / 2);font-weight:600;line-height:1.18;text-decoration:none;color:inherit;word-break:break-word}
.ct-sort__option[aria-current="true"]{background-color:var(--color-accent-surface)}
.ct-toolbar__selected{display:flex;flex-wrap:wrap;gap:14px 8px}
.ct-pill{position:relative;display:flex;justify-content:center;align-items:center;padding:8px 12px;background-color:var(--color-surface-2);font-size:.875rem;font-weight:500;line-height:1.28;text-decoration:none;color:var(--color-heading);border:1px solid transparent;border-radius:50px;word-break:break-word;transition:border-color .4s,box-shadow .4s}
.ct-pill svg{min-width:12px;width:12px;height:12px;margin-inline-start:8px}
.ct-filters{margin-top:12px;scroll-margin-top:calc(var(--ct-header-h,63px) + 24px + 64px + 12px);padding:16px;border:1px solid var(--color-line-2);border-radius:var(--r,16px);background-color:var(--color-surface-2)}
.ct-filters__group + .ct-filters__group{margin-top:16px}
.ct-filters__label{display:flex;align-items:center;gap:12px;margin:0 0 8px;font-size:.875rem;font-weight:500;line-height:1.333;color:var(--color-ink-2)}
.ct-chips{display:flex;flex-wrap:wrap;gap:8px}
.ct-check{display:inline-flex;align-items:center;gap:12px;padding:12px 16px;line-height:1.5;border-radius:var(--r,16px);border:1px solid var(--color-line);background-color:var(--color-surface);color:var(--color-heading);text-decoration:none;transition:border-color .4s,background-color .4s,color .4s,box-shadow .4s}
.ct-check__box{position:relative;display:inline-flex;justify-content:center;align-items:center;flex-shrink:0;width:24px;height:24px;border:1px solid var(--color-line);border-radius:calc(var(--r,16px) / 2);background-color:var(--color-surface)}
.ct-check__box svg{width:14px;height:14px;opacity:0;color:var(--color-surface);transition:opacity .2s}
.ct-check__count{margin-inline-start:8px;color:var(--color-ink-2);font-variant-numeric:tabular-nums}
.ct-check[aria-current="true"]{border-color:var(--color-line-blue);box-shadow:0 0 0 1px var(--color-line-blue);background-color:var(--color-accent-surface)}
.ct-check[aria-current="true"] .ct-check__box{border-color:var(--color-line-blue);background-color:var(--color-line-blue)}
.ct-check[aria-current="true"] .ct-check__box svg{opacity:1}
.ct-check:focus-visible{outline:2px solid var(--color-heading);outline-offset:2px}
@media(hover:hover),(pointer:fine){.ct-check:hover{border-color:var(--color-line-blue);box-shadow:0 0 0 1px var(--color-line-blue)}.ct-pill:hover{border-color:var(--color-line-blue);box-shadow:0 0 0 1px var(--color-line-blue)}.ct-sort__option:hover{background-color:var(--color-surface-2)}}
@media(min-width:768px){.ct-filters{padding:16px 20px}}
@media(prefers-reduced-motion:reduce){.ct-sort__icon,.ct-pill,.ct-check,.ct-check__box svg{transition:none}}
`;

function ToolbarStyle() {
  return (
    <style href="ct-toolbar" precedence="ct-components">
      {TOOLBAR_CSS}
    </style>
  );
}

/**
 * Липка смуга над картками: «Filters» → панель, сортування, активні
 * фільтри з хрестиком, лічильник збігів із «clear filters».
 */
export function RegionToolbar({
  base,
  q,
  data,
  pages,
}: {
  base: string;
  q: HubQuery;
  data: RegionListingData;
  pages: number;
}) {
  const matched = data.matched;
  const unknown = data.unknownExcluded ?? 0;
  const active = activeFilters(q);
  const filtering = isFiltering(q);

  return (
    <nav aria-label="Sort and current filters" className="ct-toolbar" data-testid="region-toolbar">
      <ToolbarStyle />
      <div className="ct-toolbar__row">
        <div className="ct-toolbar__controls">
          {/* Кнопка теми «Filters (N)» — тут посилання на панель значень. */}
          <ButtonLink href="#filters" variant="primary" size="sm">
            Filters{active.length > 0 && ` (${active.length})`}
          </ButtonLink>

          <details className="ct-sort">
            <summary className="ct-sort__trigger" data-testid="region-sort">
              <span className="ct-sort__label">Sort by</span>{' '}
              <b>{SORT_LABEL[q.sort]}</b>
              <svg
                className="ct-sort__icon"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M4 7.5l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <div className="ct-sort__options" data-testid="region-sort-options">
              {/* A space between options: the flex column ignores it,
                  a text reading (and a screen reader) gets a word break. */}
              {REGION_SORTS.map((s, i) => (
                <span key={s} className="contents">
                  {i > 0 && ' '}
                  {s === q.sort ? (
                    <b aria-current="true" className="ct-sort__option">
                      {SORT_LABEL[s]}
                    </b>
                  ) : (
                    <Link
                      href={hubHref(base, withSort(q, s))}
                      // relFor, not a bare "nofollow": with only a sort set,
                      // "Name" IS the static region page — and the one link
                      // back to it from here that a crawler may follow.
                      rel={relFor(hubHref(base, withSort(q, s)))}
                      className="ct-sort__option"
                    >
                      {SORT_LABEL[s]}
                    </Link>
                  )}
                </span>
              ))}
            </div>
          </details>

          {active.length > 0 && (
            <div className="ct-toolbar__selected" aria-label="Applied filters">
              {active.map((f) => {
                const href = hubHref(base, without(q, f.kind, f.key));
                return (
                  <Link
                    key={`${f.kind}:${f.key}`}
                    href={href}
                    rel={relFor(href)}
                    className="ct-pill touch-target"
                    aria-label={`Remove ${f.label}`}
                  >
                    {f.label}
                    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
                      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* 🔴 The number is the API's count over the whole filtered set,
            never the length of the page (region-listing.tsx). */}
        {filtering && matched !== undefined ? (
          <p data-hub-match className="ct-toolbar__count">
            <b className="text-heading tabular-nums">{matched}</b>{' '}
            {matched === 1 ? 'site matches' : 'sites match'}
            {pages > 1 && ` · page ${q.page} of ${pages}`}
            {unknown > 0 && !q.includeUnknown && (
              <>
                {' · '}
                {unknown} more where nobody recorded {amenityList(q)} —{' '}
                <Link
                  href={hubHref(base, withUnknown(q, true))}
                  rel={relFor(hubHref(base, withUnknown(q, true)))}
                >
                  include them
                </Link>
              </>
            )}
            {q.includeUnknown && (
              <>
                {' · '}
                <Link
                  href={hubHref(base, withUnknown(q, false))}
                  rel={relFor(hubHref(base, withUnknown(q, false)))}
                >
                  only recorded
                </Link>
              </>
            )}
            {' · '}
            <Link href={base}>clear filters</Link>
          </p>
        ) : (
          <p className="ct-toolbar__count">
            Every site in the region
            {pages > 1 && ` · page ${q.page} of ${pages}`}
          </p>
        )}
      </div>
    </nav>
  );
}

/**
 * Усі значення фільтра — чекбокс-чіпи з лічильниками, як у шухляді теми.
 * Лічильник — фасет API: скільки читач побачить після кліку по цьому
 * чіпу; малюється лише коли API його надіслав.
 *
 * 🔴 Every link INTO `/filter?…` carries `rel="nofollow"` — see `relFor`
 * in hub-filters.ts for why that, and not robots.txt.
 */
export function RegionFilterPanel({
  base,
  q,
  data,
}: {
  base: string;
  q: HubQuery;
  data: RegionListingData;
}) {
  const facets = data.facets;
  return (
    <nav aria-label="Filter campsites" id="filters" className="ct-filters">
      <ToolbarStyle />
      <div className="ct-filters__group">
        <p className="ct-filters__label">Type</p>
        <div className="ct-chips">
          {SPOT_TYPES.map((t) => (
            <CheckChip
              key={t}
              href={hubHref(base, withType(q, t))}
              on={q.types.includes(t)}
              count={facets?.types[t]}
            >
              {SPOT_TYPE_LABEL_SHORT[t]}
            </CheckChip>
          ))}
        </div>
      </div>
      <div className="ct-filters__group">
        <p className="ct-filters__label">Facilities</p>
        <div className="ct-chips">
          {AMENITY_KEYS.map((k) => (
            <CheckChip
              key={k}
              href={hubHref(base, withAmenity(q, k))}
              on={q.amenities.includes(k)}
              count={facets?.amenities[k]}
            >
              {AMENITY_LABEL_SHORT[k]}
            </CheckChip>
          ))}
        </div>
      </div>
    </nav>
  );
}

/**
 * Чіп-чекбокс: квадратик зліва завжди, галочка — коли вибрано.
 * `aria-current="true"` — стан посилання, як було до цієї картки; CSS
 * малює вибраний вигляд саме з нього, тож розмітка й вигляд не можуть
 * розійтись.
 */
function CheckChip({
  href,
  on,
  count,
  children,
}: {
  href: string;
  on: boolean;
  count: number | undefined;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      rel={relFor(href)}
      className="ct-check"
      aria-current={on ? 'true' : undefined}
    >
      <span className="ct-check__box" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" focusable="false">
          <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>
        {children}
        {count !== undefined && (
          <>
            {' '}
            <span className="ct-check__count">{count}</span>
          </>
        )}
      </span>
    </Link>
  );
}
