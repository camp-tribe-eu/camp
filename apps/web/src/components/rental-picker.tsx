import { buttonClasses } from "./button";
import { CamperTypeIcon } from "@/components/camper-type-icon";
import { SelectChevron } from "./select-chevron";
import type { CamperType } from "@/lib/rental-providers";

// CAMP-461 — віджет вибору на першому екрані оренди.
//
// 🔴 ВІН НЕ ОБІЦЯЄ ПОШУКУ, ЯКОГО НЕМАЄ. Доступності й цін у нас немає, тож
// полів «дати» тут нема навмисно: поле, яке нічого не фільтрує, — це
// обіцянка, що її читач перевірить першим же кліком. Обидва поля ведуть на
// те, що справді працює: каталог компаній, звужений за країною видачі й
// за типом машини (`filtersFromQuery` у `lib/rental-providers.ts`).
//
// 🔴 ЗВИЧАЙНА ФОРМА `GET`, БЕЗ JAVASCRIPT. Каталог читає адресу сам, тож
// форма працює і до гідратації, і з вимкненим скриптом, і для краулера.
//
// 🔴 ПЕРЕЛІКИ — ЛИШЕ З ТОГО, ЩО Є В КАТАЛОЗІ. Країна, у якій жодна компанія
// не видає машин, дала б «0 із N» одразу після кліку; тип, якого жодна
// компанія не назвала, — теж. Тому сторінка передає лише наявне.

export interface PickerCountry {
  code: string;
  name: string;
}

const CSS = `
.ct-pick{position:relative;z-index:5;display:grid;gap:12px;padding:16px;border:1px solid var(--color-line-2);border-radius:var(--r,16px);background-color:var(--color-surface);box-shadow:0 12px 32px rgb(0 0 0 / .14)}
.ct-pick__head{display:flex;flex-direction:column;gap:2px;grid-column:1 / -1}
.ct-pick__title{font-weight:700;line-height:1.2;color:var(--color-heading);font-size:1.125rem}
.ct-pick__hint{color:var(--color-ink-2);font-size:.875rem;line-height:1.4}
.ct-pick__field{display:flex;min-width:0;flex-direction:column;gap:6px;font-size:.875rem;font-weight:600;color:var(--color-heading)}
.ct-pick__label{display:inline-flex;align-items:center;gap:8px}
.ct-pick__label svg{width:18px;height:18px;flex:none}
.ct-pick__select{width:100%;height:48px;padding:0 40px 0 12px;-webkit-appearance:none;appearance:none;border:1px solid var(--color-control-line);border-radius:calc(var(--r,16px) * .5);background-color:var(--color-surface);color:var(--color-ink);font-size:1rem;font-weight:400}
.ct-pick__select:focus-visible{outline:2px solid var(--color-heading);outline-offset:2px}
.ct-pick__submit{width:100%}
.ct-pick__legend{padding:0;font-size:.875rem;font-weight:600;color:var(--color-heading)}
.ct-pick__types{grid-column:1 / -1;min-width:0;margin:0;padding:0;border:0}
.ct-pick__tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:6px}
.ct-pick__tile{position:relative;display:block;cursor:pointer}
.ct-pick__tile input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.ct-pick__tile-box{display:flex;min-height:76px;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 6px;border:1px solid var(--color-control-line);border-radius:calc(var(--r,16px) * .5);background-color:var(--color-surface);color:var(--color-ink-2);font-size:.8125rem;font-weight:500;line-height:1.2;text-align:center}
.ct-pick__tile-box svg{width:44px;height:20px;flex:none}
.ct-pick__tile input:checked+.ct-pick__tile-box{border-color:var(--color-heading);box-shadow:inset 0 0 0 1px var(--color-heading);color:var(--color-heading);font-weight:700}
.ct-pick__tile input:focus-visible+.ct-pick__tile-box{outline:2px solid var(--color-heading);outline-offset:2px}
@media(hover:hover){.ct-pick__tile:hover .ct-pick__tile-box{border-color:var(--color-heading)}}
@media(min-width:992px){
.ct-pick{grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:16px;padding:20px 24px}
.ct-pick__tiles{grid-template-columns:repeat(6,minmax(0,1fr))}
.ct-pick__submit{width:auto;min-width:220px}
}
`;

const PIN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

const VAN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2.5 16.5V8A1.5 1.5 0 0 1 4 6.5h10.5a2 2 0 0 1 1.6.8l3.4 4.4a2 2 0 0 1 .4 1.2v3.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 16.5h2M9 16.5h6M20 16.5h1.5M14.5 6.5v5.5h5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6.8" cy="16.7" r="2" />
    <circle cx="17.2" cy="16.7" r="2" />
  </svg>
);

export default function RentalPicker({
  heading,
  hint,
  submitLabel,
  action,
  countries,
  types,
}: {
  heading: string;
  hint?: string | null;
  submitLabel: string;
  /** Куди веде форма — сторінка каталогу компаній. */
  action: string;
  countries: readonly PickerCountry[];
  types: readonly CamperType[];
}) {
  return (
    <form
      method="get"
      action={action}
      className="ct-pick"
      data-testid="rental-picker"
      aria-labelledby="rental-picker-title"
    >
      <style href="ct-rental-picker" precedence="ct-components">
        {CSS}
      </style>
      <div className="ct-pick__head">
        <h2 id="rental-picker-title" className="ct-pick__title">
          {heading}
        </h2>
        {hint ? <p className="ct-pick__hint">{hint}</p> : null}
      </div>

      {/* 🔴 CAMP-444 (ревʼю 444/9–10, рішення власника 20.11.2026): тип —
          плитками з НАШОЮ іконкою-силуетом, а не системним списком. Справжні
          радіокнопки під плитками: клавіатура, читач екрана й відправка
          форми працюють як у будь-якого `<input type="radio">`; імʼя поля
          те саме (`type`), тож каталог і посилання не змінюються. Фото
          машин компаній без договору не показуємо — тому силует. */}
      <fieldset className="ct-pick__types" data-testid="picker-type">
        <legend className="ct-pick__label ct-pick__legend">
          {VAN}
          Vehicle type
        </legend>
        <div className="ct-pick__tiles">
          <label className="ct-pick__tile">
            <input type="radio" name="type" value="" defaultChecked />
            <span className="ct-pick__tile-box">
              Any type
            </span>
          </label>
          {types.map((t) => (
            <label key={t.slug} className="ct-pick__tile">
              <input type="radio" name="type" value={t.slug} />
              <span className="ct-pick__tile-box" data-camper-type={t.slug}>
                <CamperTypeIcon slug={t.slug} />
                {t.name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="ct-pick__field">
        <span className="ct-pick__label">
          {PIN}
          Pick-up country
        </span>
        <span className="relative block">
          <select
            name="country"
            className="ct-pick__select"
            defaultValue=""
            data-testid="picker-country"
          >
            <option value="">Any country</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <SelectChevron />
        </span>
      </label>


      <button
        type="submit"
        data-ct-button="primary"
        data-testid="picker-submit"
        className={buttonClasses("primary", "md", "ct-pick__submit")}
      >
        {submitLabel}
      </button>
    </form>
  );
}
