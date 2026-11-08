import Link from "next/link";

import type { CountrySummary } from "@/lib/api";
import { countryName } from "@/lib/api";
import { EU_MEMBER_STATES, isEuMemberState } from "@/lib/eu-countries";
import { Flag } from "./flag";

/**
 * Плитки країн на /camping — CAMP-450, перша частина.
 *
 * 🔴 СТРУКТУРА З ТЕМИ, НЕ З ГОЛОВИ. Сітка — шаблон «усі колекції» Fuse
 * (`list-collections.build.css`, читано з архіву `fuse 1.0.1.zip`
 * 08.11.2026):
 *
 *   .list-collections__wrapper{margin:0 -4px}
 *   .list-collections__row{display:flex;flex-wrap:wrap;row-gap:8px}
 *   .list-collections__col{width:100%;padding:0 4px}
 *   @media(max-width:991.98px){.list-collections__col{width:50%}}
 *   @media(min-width:992px){.list-collections__row{row-gap:12px}
 *       .list-collections__col{width:16.666%}}           ← default "6"
 *
 * Картка — `collection-card.build.css` («зображення зверху, назва знизу»):
 *
 *   .collection-card{position:relative;display:block;overflow:hidden;
 *       padding:4px;padding-bottom:0;border-radius:var(--global-border-radius);
 *       background-color:var(--color-background-secondary)}   ≥992: 8px
 *   .collection-card__image-wrapper{position:relative;overflow:hidden;
 *       display:block;border-radius:calc(var(--global-border-radius) * .75)}
 *   .collection-card__image{position:absolute;top:0;left:0;width:100%;
 *       height:100%;object-fit:cover}
 *   .collection-card__title{padding:12px 12px 24px;font-weight:600;
 *       line-height:1.5;word-wrap:break-word}
 *
 * Кількість і посилання — з картки шаблону колекції
 * (`small-collections.build.css`, «зображення зліва, назва + кількість +
 * посилання справа»):
 *
 *   .small-collection-card__products-count{color:var(--color-text-secondary);
 *       line-height:1.6}
 *   .small-collection-card__link{align-self:flex-start;
 *       font-size:calc(var(--body-font-size) * .875);font-weight:600;
 *       color:var(--color-accent)}
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо, не підігнано:
 *
 *   - Пропорція картинки. У теми три варіанти — square / portrait (128.51%)
 *     / landscape (56.4%), типово portrait. Прапор має пропорцію 4:3, тож
 *     рамка 75%, і картинка `object-fit: contain`, а не `cover`: обрізаний
 *     прапор — не прапор (див. `flag.tsx`).
 *   - Наведення. Тема збільшує картинку до 1.15 усередині рамки з
 *     `overflow:hidden` — для фото це «наїзд», для прапора це відрізані
 *     краї. Тут 1.04.
 *   - Картка без даних — НЕ посилання. У теми колекція без товарів усе
 *     одно веде на свою сторінку; у нас сторінки країни без кемпінгів не
 *     існує (`dynamicParams = false`), тож посилання вело б на 404. Плитка
 *     стоїть, каже «No campsites listed yet», і нікуди не веде.
 *
 * 🔴 УСІ 27, А НЕ ЛИШЕ КОДИ З API. Порядок — за англійською назвою, бо так
 * шукають країну в переліку. Коди з API, яких немає серед 27 (сьогодні
 * `ax`, Åland — має сторінку й 19 кемпінгів), ідуть після двадцяти семи:
 * вони не члени, але читач має до них дійти (thin-pages.spec.tsx це
 * тримає). Код API, що не схожий на код країни, пропускається поодинці —
 * один зіпсований запис коштує одного запису, не сторінки.
 *
 * 🔴 ЧИСЛО В ПЛИТЦІ — ЦЕ ЧИСЛО З API, ЯК Є. Жодної арифметики над ним:
 * `spots` і `regions` друкуються з рядка `/spots/countries`, лише у
 * форматі en-GB. Тест звіряє кожну плитку з тим рядком.
 */

export interface CountryTile {
  code: string;
  name: string;
  /** Рядок API, або `null` — країна є, даних немає. */
  data: CountrySummary | null;
}

const en = (n: number): string => n.toLocaleString("en-GB");

const plural = (n: number, one: string, many: string): string =>
  `${en(n)} ${n === 1 ? one : many}`;

/** Схоже на код країни: дві латинські літери. */
const looksLikeCode = (code: unknown): code is string =>
  typeof code === "string" && /^[a-z]{2}$/i.test(code.trim());

/** Усі плитки в порядку показу: 27 членів за назвою, потім решта кодів API. */
export function countryTiles(countries: readonly CountrySummary[]): CountryTile[] {
  const byCode = new Map<string, CountrySummary>();
  for (const c of countries) {
    if (!looksLikeCode(c?.country)) continue;
    byCode.set(c.country.trim().toLowerCase(), c);
  }
  const byName = (a: CountryTile, b: CountryTile) =>
    a.name.localeCompare(b.name, "en");

  const members: CountryTile[] = EU_MEMBER_STATES.map((code) => ({
    code,
    name: countryName(code),
    data: byCode.get(code) ?? null,
  })).sort(byName);

  const extras: CountryTile[] = [...byCode.entries()]
    .filter(([code]) => !isEuMemberState(code))
    .map(([code, data]) => ({ code, name: countryName(code), data }))
    .sort(byName);

  return [...members, ...extras];
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const TILES_CSS = `
.ct-tiles{margin:0 -4px}
.ct-tiles__row{display:flex;flex-wrap:wrap;row-gap:8px;list-style:none;margin:0;padding:0}
.ct-tiles__col{width:50%;padding:0 4px}
.ct-tile{position:relative;display:flex;flex-direction:column;height:100%;overflow:hidden;padding:4px;padding-bottom:0;border-radius:var(--r,16px);background-color:var(--color-surface-2);color:inherit;text-decoration:none}
.ct-tile--empty{opacity:.85}
.ct-tile__image-wrapper{position:relative;overflow:hidden;display:block;padding-top:75%;border-radius:calc(var(--r,16px) * .75);background-color:var(--color-surface)}
.ct-tile__image-wrapper .ct-flag{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;transition:transform .4s ease-out}
.ct-tile__image-wrapper .ct-flag--none{display:flex;align-items:center;justify-content:center;font-weight:700;letter-spacing:.1em;color:var(--color-ink-2)}
.ct-tile__header{display:flex;flex-direction:column;flex:1 1 auto;padding:12px 12px 16px;word-wrap:break-word}
.ct-tile__title{font-weight:600;line-height:1.5;color:var(--color-heading)}
.ct-tile__count{color:var(--color-ink-2);line-height:1.6;font-size:.875rem}
.ct-tile__link{margin-top:auto;padding-top:8px;align-self:flex-start;font-size:.875rem;font-weight:600;color:var(--color-heading);text-decoration:underline;text-decoration-color:transparent;transition:text-decoration-color .4s}
a.ct-tile:focus-visible{outline:2px solid var(--color-heading);outline-offset:2px}
@media(hover:hover),(pointer:fine){a.ct-tile:hover .ct-flag{transform:scale(1.04)}a.ct-tile:hover .ct-tile__link{text-decoration-color:currentColor}}
@media(min-width:992px){.ct-tiles__row{row-gap:12px}.ct-tiles__col{width:16.666%}.ct-tile{padding:8px;padding-bottom:0}}
@media(prefers-reduced-motion:reduce){.ct-tile__image-wrapper .ct-flag,.ct-tile__link{transition:none}}
`;

function TileBody({ tile }: { tile: CountryTile }) {
  const { data } = tile;
  return (
    <>
      <span className="ct-tile__image-wrapper">
        {/* 🔴 `eager`, а не замовчування `lazy`, і це замір, не смак.
            Усі 28 прапорів разом важать 45 КБ у gzip — менше за одну
            фотографію, — а на цій сторінці вони не прикраса, а власне
            зміст: список країн і є сторінка.

            Плюс лінивий прапор ламав спільний помічник e2e, який чекає
            `document.images.every(i => i.complete)`: картинка нижче
            екрана не стає `complete` ніколи, і очікування висіло 20 с
            до таймауту. Міняти помічник заради цього не можна — він
            обслуговує десятки тестів. */}
        <Flag code={tile.code} loading="eager" />
      </span>
      <span className="ct-tile__header">
        <span className="ct-tile__title">{tile.name}</span>
        {data ? (
          <>
            <span className="ct-tile__count">
              {plural(data.spots, "campsite", "campsites")} ·{" "}
              {plural(data.regions, "region", "regions")}
            </span>
            <span className="ct-tile__link">See regions</span>
          </>
        ) : (
          <span className="ct-tile__count">No campsites listed yet</span>
        )}
      </span>
    </>
  );
}

export function CountryTiles({
  countries,
  className,
}: {
  countries: readonly CountrySummary[];
  className?: string;
}) {
  const tiles = countryTiles(countries);
  return (
    <div className={["ct-tiles", className].filter(Boolean).join(" ")}>
      <style href="ct-tiles" precedence="ct-components">
        {TILES_CSS}
      </style>
      <ul className="ct-tiles__row">
        {tiles.map((tile) => (
          <li className="ct-tiles__col" key={tile.code}>
            {tile.data ? (
              <Link href={`/camping/${tile.code}`} className="ct-tile">
                <TileBody tile={tile} />
              </Link>
            ) : (
              <div className="ct-tile ct-tile--empty">
                <TileBody tile={tile} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
