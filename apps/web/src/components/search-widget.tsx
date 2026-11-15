import { buttonClasses } from "./button";
import type { SearchView } from "@/lib/slides";

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
@media(min-width:768px){
.ct-find{padding:24px 32px}
.ct-slider+.ct-find{margin:-48px 24px 0}
.ct-find__row{flex-direction:row;align-items:stretch}
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
    </section>
  );
}
