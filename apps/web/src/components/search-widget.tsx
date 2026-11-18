import { buttonClasses } from "./button";
import type { SearchView } from "@/lib/slides";
import {
  AMENITY_KEYS,
  AMENITY_LABEL_SHORT,
  SPOT_TYPES,
  SPOT_TYPE_LABEL_SHORT,
} from "@/lib/api";
import { SELECT_CHEVRON_ROOM, SelectChevron } from "./select-chevron";

/**
 * Пошуковий віджет першого екрана — CAMP-488.
 *
 * 🔴 ЦЕ ЗВИЧАЙНА ФОРМА `GET`, І ЦЕ НЕ ЛІНЬ. `/search` читає `?q=` із адреси
 * (`search-embed.tsx`), тож форма без жодного скрипта веде туди, де вже
 * працює пошук по індексу. Вона діє з вимкненим JavaScript і до гідратації
 * — той, хто натиснув Enter за долю секунди після завантаження, не втрачає
 * запит. Предиктивні підказки й живий лічильник результатів з макета Figma
 * (441/15, 441/17) — окремі картки: поле, що ковтає введене, гірше за поле
 * без підказок.
 *
 * 🔴 ЧИСЛА З ТЕМИ (`docs/design-system-from-theme.md`, «Поля вводу»):
 * `min-height:56px; padding:15px 24px; radius:var(--global-border-radius);
 * font-weight:600; border:1px solid var(--color-border-primary);
 * background:var(--color-background-secondary)`. Кнопка — наша `md`
 * (48px), та сама, що на решті сайту.
 *
 * 🔴 ПІДПИС — ВИДИМИЙ І Є НАЗВОЮ ПОЛЯ. Підказка в самому полі (`placeholder`)
 * не назва: вона зникає при введенні, а читач екрана часто її не озвучує.
 *
 * 🔴 CSS ЇДЕ В HTML (`<style href precedence>`), як у `faq.tsx`.
 */

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const FIND_CSS = `
.ct-find{position:relative;z-index:4;margin-top:12px;padding:16px;border-radius:var(--r,16px);border:1px solid var(--color-line-2);background:var(--color-surface);box-shadow:var(--shadow-pop,0 8px 24px -12px rgba(0,0,0,.25))}
.ct-find__title{margin-bottom:12px;font-size:1.125rem;font-weight:700;line-height:1.3;color:var(--color-heading)}
.ct-find__row{display:flex;flex-direction:column;gap:8px}
.ct-find__input{display:block;width:100%;min-height:56px;padding:15px 24px;border:1px solid var(--color-line-2);border-radius:var(--r,16px);background-color:var(--color-surface-2);color:var(--color-heading);font:inherit;font-weight:600;line-height:1.5;-webkit-appearance:none;appearance:none}
.ct-find__input::placeholder{color:var(--color-ink-2);font-weight:400;opacity:1}
.ct-find__input:focus-visible{outline:2px solid var(--color-line-blue);outline-offset:2px}
.ct-find__button{height:56px;padding:0 32px;font-size:1rem}
.ct-find__filters{display:grid;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--color-line-2)}
.ct-find__sub{font-size:.9375rem;font-weight:600;color:var(--color-heading)}
.ct-find__field{position:relative;display:block}
.ct-find__select{display:block;width:100%;min-height:48px;padding:11px 16px;border:1px solid var(--color-line-2);border-radius:calc(var(--r,16px) * .75);background-color:var(--color-surface-2);color:var(--color-heading);font:inherit}
.ct-find__select:focus-visible{outline:2px solid var(--color-line-blue);outline-offset:2px}
@media(min-width:768px){
.ct-find{padding:24px 32px}
.ct-slider+.ct-find{margin:-48px 24px 0}
.ct-find__row{flex-direction:row;align-items:stretch}
.ct-find__filters{grid-template-columns:auto 1fr 1fr auto;align-items:center}
.ct-find__input{flex:1 1 auto}
.ct-find__button{flex:0 0 auto}}
`;

export function SearchWidget({ search }: { search: SearchView }) {
  const titleId = "home-search-title";
  return (
    <section className="ct-find" aria-labelledby={titleId} data-testid="home-search">
      <style href="ct-find" precedence="ct-components">
        {FIND_CSS}
      </style>
      {/* `role="search"` на самій формі: орієнтир «пошук» для читача екрана. */}
      <form role="search" action={search.action} method="get" aria-labelledby={titleId}>
        <h2 id={titleId} className="ct-find__title">
          {search.label}
        </h2>
        <div className="ct-find__row">
          <input
            className="ct-find__input"
            type="search"
            name="q"
            autoComplete="off"
            enterKeyHint="search"
            placeholder={search.placeholder ?? undefined}
            aria-labelledby={titleId}
            data-testid="home-search-input"
          />
          <button
            type="submit"
            data-ct-button="primary"
            className={`${buttonClasses("primary", "md")} ct-find__button`}
            data-testid="home-search-submit"
          >
            {search.button}
          </button>
        </div>
      </form>
      <MapFilterForm testId="home-filters" prefix="home" title="Or filter the map" />
    </section>
  );
}

/**
 * The type + facility selects that open the map already filtered. Used on
 * the home page (under the search field) and on /contact (CAMP-441/33).
 * Carries its own copy of the widget CSS: React drops the duplicate
 * `<style href>` when both are on one page.
 */
export function MapFilterForm({ testId, prefix, title }: { testId: string; prefix: string; title: string }) {
  return (
    <>
      <style href="ct-find" precedence="ct-components">
        {FIND_CSS}
      </style>
      {/* CAMP-441 (15, 17): selects that lead to a filtered result. A plain
          GET to /map — the map reads `types` and `amenities` from the
          address (lib/map-filter.ts), so this works without JavaScript and
          the reader lands on the map already filtered, with its count. */}
      <form action="/map" method="get" className="ct-find__filters" data-testid={testId}>
        <span className="ct-find__sub">{title}</span>
        <label className="ct-find__field">
          <span className="sr-only">Type of place</span>
          <select name="types" defaultValue="" className={`ct-find__select ${SELECT_CHEVRON_ROOM}`} data-testid={`${prefix}-filter-type`}>
            <option value="">Any type of place</option>
            {SPOT_TYPES.map((t) => (
              <option key={t} value={t}>
                {SPOT_TYPE_LABEL_SHORT[t]}
              </option>
            ))}
          </select>
          <SelectChevron />
        </label>
        <label className="ct-find__field">
          <span className="sr-only">Must have</span>
          <select name="amenities" defaultValue="" className={`ct-find__select ${SELECT_CHEVRON_ROOM}`} data-testid={`${prefix}-filter-amenity`}>
            <option value="">Any facilities</option>
            {AMENITY_KEYS.map((a) => (
              <option key={a} value={a}>
                {AMENITY_LABEL_SHORT[a]}
              </option>
            ))}
          </select>
          <SelectChevron />
        </label>
        <button
          type="submit"
          data-ct-button="secondary"
          className={`${buttonClasses("secondary", "md")} ct-find__button`}
          data-testid={`${prefix}-filters-submit`}
        >
          Show on the map
        </button>
      </form>
    </>
  );
}
