import Link from "next/link";

import type { RegionCard } from "./region-tiles";
import { regionCountLabel } from "./region-tiles";
import { Ticker } from "./ticker";

/**
 * Біжучий рядок топ-регіонів під банером країни — CAMP-451.
 *
 * Рендерить `Ticker` із CAMP-449; тут лише вибір регіонів і вигляд
 * елемента: назва + кількість, посилання на сторінку регіону.
 *
 * 🔴 «ТОП» — ЦЕ НАЙБІЛЬШІ ЗА ЧИСЛОМ КЕМПІНГІВ, і вибір детермінований:
 * сортування за `spots` униз, за рівності — за назвою. Та сама відповідь
 * API в будь-якому порядку → той самий рядок, інакше знімок у
 * `tests/visual` червонів би сам собою.
 *
 * 🔴 ЛИШЕ РЕГІОНИ З ЧИСЛОМ > 0. Регіон, чиє число не дійшло (`null`) або
 * нуль, у рядок не потрапляє поодинці; без жодного живого — тікер не
 * рендериться зовсім (порожнє не малюємо).
 *
 * Без прапора навмисно: усі регіони однієї країни мають один прапор, і
 * дванадцять його копій у рядку — шум, а не зміст.
 */

const TICKER_MAX = 6;

/** Регіони для рядка: до шести найбільших, у порядку, що залежить лише від даних. */
export function pickTickerRegions(regions: readonly RegionCard[]): RegionCard[] {
  return regions
    .filter((r) => r.spots !== null && r.spots > 0)
    .sort(
      (a, b) =>
        (b.spots as number) - (a.spots as number) ||
        a.region.localeCompare(b.region, "en"),
    )
    .slice(0, TICKER_MAX);
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const REGION_TICKER_CSS = `
.ct-region-ticker{color:var(--color-heading)}
.ct-region-ticker__item{display:inline-flex;align-items:baseline;gap:.4em;min-height:48px;color:inherit;text-decoration:none;white-space:nowrap}
.ct-region-ticker__count{font-size:.55em;font-weight:500;color:var(--color-ink-2);line-height:1}
.ct-region-ticker__item:focus-visible{outline:2px solid var(--color-heading);outline-offset:4px;border-radius:.2em}
@media(hover:hover),(pointer:fine){.ct-region-ticker__item:hover .ct-region-ticker__name{text-decoration:underline}}
`;

export function RegionTicker({
  country,
  countryName,
  regions,
  className,
}: {
  country: string;
  countryName: string;
  regions: readonly RegionCard[];
  className?: string;
}) {
  const picked = pickTickerRegions(regions);
  if (picked.length === 0) return null;
  const items = picked.map((r) => (
    <Link
      key={r.slug}
      href={`/camping/${country}/${r.slug}`}
      className="ct-region-ticker__item"
    >
      <span className="ct-region-ticker__name">{r.region}</span>
      <span className="ct-region-ticker__count">{regionCountLabel(r.spots)}</span>
    </Link>
  ));
  return (
    <>
      <style href="ct-region-ticker" precedence="ct-components">
        {REGION_TICKER_CSS}
      </style>
      <Ticker
        items={items}
        label={`Largest regions in ${countryName}`}
        textSize={{ desktop: "40px", mobile: "24px" }}
        speed={{ desktop: "45s", mobile: "25s" }}
        className={["ct-region-ticker", className].filter(Boolean).join(" ")}
      />
    </>
  );
}
