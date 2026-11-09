import Link from "next/link";

import { Flag } from "./flag";

/**
 * Картки регіонів на сторінці країни — CAMP-451.
 *
 * Замість голих чіпів «назва · число»: картка із зображенням зверху,
 * назвою, кількістю кемпінгів і посиланням. Зразок — плитки країн
 * (`country-tiles.tsx`, CAMP-450), тобто `collection-card` теми Fuse
 * (`collection-card.build.css`, читано з архіву `fuse 1.0.1.zip`
 * 08.11.2026): рамка `padding:4px` (≥992: 8px), радіус `--r`, тло
 * `--color-background-secondary`, картинка в рамці з радіусом `r*.75`,
 * назва `12px 12px 24px; font-weight:600; line-height:1.5`. Кількість і
 * посилання — з `small-collection-card` тієї ж теми (`products-count`
 * кольором `--color-text-secondary`, `link` 0.875em вагою 600).
 *
 * 🔴 ФОТОГРАФІЙ РЕГІОНІВ У НАС НЕМАЄ — у репозиторії нуль зображень.
 * Зображенням картки стоїть прапор країни, як у плиток країн; заглушки
 * не вигадуємо.
 *
 * 🔴 ТРИ-ЧОТИРИ В РЯД, А НЕ ШІСТЬ. Тема дає `16.666%` від 992px для
 * переліку колекцій; тут регіонів у країні буває до 100 (Франція), і
 * плитка на шість колонок зробила б назви на зразок «Provence-Alpes-
 * Côte d'Azur» нечитабельними. Колонки: 2 → 3 (992) → 4 (1200); дві на
 * телефоні — як у теми (`list-collections__col{width:50%}` до 991.98px) і
 * як у плиток країн: заміряно на знімку 375px 09.11.2026 — одна колонка
 * давала дев'ять прапорів на всю ширину й 5 700px прокручування. Пороги —
 * драбина теми (`docs/design-system-from-theme.md`).
 *
 * 🔴 ОДНАКОВА ВИСОТА, РЯДКИ НЕ ПЛАВАЮТЬ: колонка — `display:flex`, картка
 * `height:100%` із `flex-direction:column`, посилання притиснуте донизу
 * через `margin-top:auto`.
 *
 * 🔴 ЧИСЛО В КАРТЦІ — ЧИСЛО З API, ЯК Є. `spots` друкується з рядка
 * `/spots/{country}/regions` у форматі en-GB, без жодної арифметики.
 *
 * 🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО ЗАПИСУ. Рядок без назви або без
 * slug не може стати карткою (немає куди вести) — він пропускається.
 * Рядок із назвою і slug, але без цілого невід'ємного числа — картка
 * стоїть, веде на сторінку регіону і каже «Campsite count not
 * recorded» замість числа: порожнє не малюємо, а чого немає — не
 * вигадуємо.
 */

export interface RegionCard {
  region: string;
  slug: string;
  /** Ціле невід'ємне число з API, або `null` — число не дійшло. */
  spots: number | null;
}

const en = (n: number): string => n.toLocaleString("en-GB");

const nonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";

/** Один рядок відповіді API → картка, або `null`, коли рядок не веде нікуди. */
export function readRegionCard(raw: unknown): RegionCard | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!nonEmpty(r.region) || !nonEmpty(r.slug)) return null;
  // Slug із «/» або «..» зробив би адресу, якої збірка не знає.
  if (/[/\\]|\.\./.test(r.slug)) return null;
  const spots =
    typeof r.spots === "number" && Number.isInteger(r.spots) && r.spots >= 0
      ? r.spots
      : null;
  return { region: r.region.trim(), slug: r.slug.trim(), spots };
}

/** Усі картки, у порядку API; зіпсовані рядки випадають поодинці. */
export function readRegionCards(rows: readonly unknown[]): RegionCard[] {
  const out: RegionCard[] = [];
  for (const row of rows) {
    const c = readRegionCard(row);
    if (c) out.push(c);
  }
  return out;
}

/** Підпис кількості — або чесне «не записано». */
export function regionCountLabel(spots: number | null): string {
  if (spots === null) return "Campsite count not recorded";
  return `${en(spots)} ${spots === 1 ? "campsite" : "campsites"}`;
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const REGION_TILES_CSS = `
.ct-rtiles{margin:0 -4px}
.ct-rtiles__row{display:flex;flex-wrap:wrap;row-gap:8px;list-style:none;margin:0;padding:0}
.ct-rtiles__col{display:flex;width:50%;padding:0 4px}
.ct-rtile{position:relative;display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;padding:4px;padding-bottom:0;border-radius:var(--r,16px);background-color:var(--color-surface-2);color:inherit;text-decoration:none}
.ct-rtile__image-wrapper{position:relative;display:block;overflow:hidden;padding-top:56.4%;border-radius:calc(var(--r,16px) * .75);background-color:var(--color-surface)}
.ct-rtile__image-wrapper .ct-flag{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;transition:transform .4s ease-out}
.ct-rtile__image-wrapper .ct-flag--none{display:flex;align-items:center;justify-content:center;font-weight:700;letter-spacing:.1em;color:var(--color-ink-2)}
.ct-rtile__header{display:flex;flex:1 1 auto;flex-direction:column;padding:12px 12px 16px;word-wrap:break-word}
.ct-rtile__title{font-weight:600;line-height:1.5;color:var(--color-heading)}
.ct-rtile__count{font-size:.875rem;line-height:1.6;color:var(--color-ink-2)}
.ct-rtile__link{margin-top:auto;padding-top:8px;align-self:flex-start;font-size:.875rem;font-weight:600;color:var(--color-heading);text-decoration:underline;text-decoration-color:transparent;transition:text-decoration-color .4s}
a.ct-rtile:focus-visible{outline:2px solid var(--color-heading);outline-offset:2px}
@media(hover:hover),(pointer:fine){a.ct-rtile:hover .ct-flag{transform:scale(1.04)}a.ct-rtile:hover .ct-rtile__link{text-decoration-color:currentColor}}
@media(min-width:992px){.ct-rtiles__row{row-gap:12px}.ct-rtiles__col{width:33.333%}.ct-rtile{padding:8px;padding-bottom:0}}
@media(min-width:1200px){.ct-rtiles__col{width:25%}}
@media(prefers-reduced-motion:reduce){.ct-rtile__image-wrapper .ct-flag,.ct-rtile__link{transition:none}}
`;

export function RegionTiles({
  country,
  regions,
  className,
}: {
  /** Код країни: його прапор стоїть зображенням кожної картки. */
  country: string;
  regions: readonly RegionCard[];
  className?: string;
}) {
  if (regions.length === 0) return null;
  return (
    <div className={["ct-rtiles", className].filter(Boolean).join(" ")}>
      <style href="ct-rtiles" precedence="ct-components">
        {REGION_TILES_CSS}
      </style>
      <ul className="ct-rtiles__row">
        {regions.map((r) => (
          <li className="ct-rtiles__col" key={r.slug}>
            <Link href={`/camping/${country}/${r.slug}`} className="ct-rtile">
              <span className="ct-rtile__image-wrapper">
                <Flag code={country} />
              </span>
              <span className="ct-rtile__header">
                <span className="ct-rtile__title">{r.region}</span>
                <span className="ct-rtile__count">{regionCountLabel(r.spots)}</span>
                <span className="ct-rtile__link">See campsites</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
