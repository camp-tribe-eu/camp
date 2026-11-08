import Link from "next/link";

import type { CountrySummary } from "@/lib/api";
import { countryName } from "@/lib/api";
import { Flag } from "./flag";
import { Ticker } from "./ticker";

/**
 * Біжучий рядок країн на /camping — CAMP-450, перша частина.
 *
 * Елемент — прапор + назва + кількість кемпінгів, посилання на сторінку
 * країни. Рендерить `Ticker` із CAMP-449; тут лише вибір країн і вигляд
 * елемента.
 *
 * 🔴 «ВИПАДКОВІ» — АЛЕ ВІДТВОРЮВАНІ. Бриф каже «3–6 випадкових країн».
 * `Math.random()` під час збірки дав би інший рядок на кожному прогоні —
 * і знімок /camping у `tests/visual` червонів би сам собою, без жодної
 * зміни в коді. Тому перестановка — псевдовипадкова з насінням, яке
 * рахується З САМИХ ДАНИХ (коди й числа відповіді API): на фікстурі CI
 * вибір щоразу той самий, а на проді міняється разом із базою — тобто
 * раз на тиждень, з імпортом. Шість, коли є з чого; менше — коли країн
 * з даними менше шести; жодної — тікер не рендериться зовсім.
 *
 * 🔴 ЛИШЕ КРАЇНИ З КЕМПІНГАМИ, І ЛИШЕ З КОДОМ, СХОЖИМ НА КОД: елемент із
 * нулем або з ламаним кодом пропускається поодинці.
 *
 * 🔴 НЕ `TickerImage`: у теми картинка елемента квадратна й обрізається
 * (`object-fit: cover`), прапор так не можна (див. `flag.tsx`). Розмір
 * прапора тут — в `em`, щоб він ріс разом із текстом між 768px і вище.
 */

const TICKER_MAX = 6;

const en = (n: number): string => n.toLocaleString("en-GB");

/** FNV-1a, 32 біти — детерміноване насіння з рядка. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — маленький ГПВЧ, достатній для перестановки 27 елементів. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const usable = (c: CountrySummary): boolean =>
  typeof c?.country === "string" &&
  /^[a-z]{2}$/i.test(c.country.trim()) &&
  Number.isInteger(c.spots) &&
  c.spots > 0;

/** Країни для рядка: до шести, у порядку, що залежить лише від даних. */
export function pickTickerCountries(
  countries: readonly CountrySummary[],
): CountrySummary[] {
  // 🔴 Спершу впорядкувати за кодом: вибір має залежати від ДАНИХ, а не
  // від порядку, у якому API віддав рядки. Той самий набір у іншому
  // порядку → той самий рядок (тест це тримає).
  const live = countries
    .filter(usable)
    .sort((a, b) => a.country.localeCompare(b.country));
  if (live.length === 0) return [];
  const seed = fnv1a(
    live.map((c) => `${c.country.trim().toLowerCase()}:${c.spots}`).join("|"),
  );
  const rand = mulberry32(seed);
  const out = [...live];
  // Fisher–Yates, зверху вниз.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, TICKER_MAX);
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const COUNTRY_TICKER_CSS = `
.ct-country-ticker{color:var(--color-heading)}
.ct-country-ticker__item{display:inline-flex;align-items:center;gap:.4em;min-height:48px;color:inherit;text-decoration:none;white-space:nowrap}
.ct-country-ticker__item .ct-flag{width:1.5em;height:auto;border-radius:.12em;flex:none}
.ct-country-ticker__count{font-size:.55em;font-weight:500;color:var(--color-ink-2);line-height:1}
.ct-country-ticker__item:focus-visible{outline:2px solid var(--color-heading);outline-offset:4px;border-radius:.2em}
@media(hover:hover),(pointer:fine){.ct-country-ticker__item:hover .ct-country-ticker__name{text-decoration:underline}}
`;

export function CountryTicker({
  countries,
  className,
}: {
  countries: readonly CountrySummary[];
  className?: string;
}) {
  const picked = pickTickerCountries(countries);
  if (picked.length === 0) return null;
  const items = picked.map((c) => {
    const code = c.country.trim().toLowerCase();
    return (
      <Link
        key={code}
        href={`/camping/${code}`}
        className="ct-country-ticker__item"
      >
        <Flag code={code} loading="eager" />
        <span className="ct-country-ticker__name">{countryName(code)}</span>
        <span className="ct-country-ticker__count">
          {en(c.spots)} {c.spots === 1 ? "campsite" : "campsites"}
        </span>
      </Link>
    );
  });
  return (
    <>
      <style href="ct-country-ticker" precedence="ct-components">
        {COUNTRY_TICKER_CSS}
      </style>
      <Ticker
        items={items}
        label="Countries with campsites"
        textSize={{ desktop: "40px", mobile: "24px" }}
        speed={{ desktop: "45s", mobile: "25s" }}
        className={["ct-country-ticker", className].filter(Boolean).join(" ")}
      />
    </>
  );
}
