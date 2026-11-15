import Link from 'next/link';
import type { ReactNode } from 'react';

import { countryName, formatDistance } from '@/lib/api';
import type { SearchHit } from '@/lib/search';
import {
  regionTitle,
  type CountryEntry,
  type RegionEntry,
} from '@/lib/search-groups';
import { Flag } from './flag';

// CAMP-455 — результати пошуку КАРТКАМИ, не рядками.
//
// 🔴 СІТКА Й КАРТКА З ТЕМИ, НЕ З ГОЛОВИ. Те саме, що плитки країн на
// /camping (`country-tiles.tsx`), бо власник у ревʼю назвав саме це:
// «виводь як на сторінці всіх країн, де вартка виглядає як картка».
//
//   .list-collections__row{display:flex;flex-wrap:wrap;row-gap:8px}
//   .list-collections__col{padding:0 4px}
//   ≥992:  row-gap:12px
//   картка — фон `--color-background-secondary`, радіус
//   `--global-border-radius` (16px), назва 600/1.5, лічильник
//   `color-text-secondary`, посилання 14px/600
//
// Колонок 1 → 2 (від 576) → 3 (від 992) → 4 (від 1200): пороги теми,
// «3–4 в ряд» з ревʼю. Це `grid`, а не `flex` з відсотками теми, бо
// картки в рядку мусять бути однакової висоти, а лічильник колонок
// живе в одному місці.
//
// 🔴 ЩО У КАРТЦІ Є І ЧОГО НЕМАЄ. Є: країна з прапором, назва, регіон,
// місце поруч і відстань — усе, що індекс пошуку несе про кемпінг.
// Немає: зручностей («душ, електрика»), які власник просив у ревʼю
// 442/3. Їх немає в індексі, і додати їх — це зміна формату, який
// качає кожен відвідувач. Заміряно 15.11.2026 на 52 499 кемпінгах:
// тип і маска зручностей одним числом на рядок — 261 674 байти
// (4,98 на рядок), 51 654 байти після gzip -6. Це окреме рішення
// про вагу індексу, не те, що проходить тихо в картці про верстку.

const CARDS_CSS = `
.ct-sr{display:grid;grid-template-columns:1fr;gap:8px;list-style:none;margin:0;padding:0;text-align:left}
@media(min-width:576px){.ct-sr{grid-template-columns:repeat(2,1fr)}}
@media(min-width:992px){.ct-sr{grid-template-columns:repeat(3,1fr);gap:12px}}
@media(min-width:1200px){.ct-sr{grid-template-columns:repeat(4,1fr)}}
.ct-sr-card{position:relative;display:flex;flex-direction:column;gap:4px;height:100%;padding:16px;border-radius:var(--r,16px);background-color:var(--color-surface-2);color:inherit;text-decoration:none;word-wrap:break-word;overflow-wrap:anywhere}
.ct-sr-card__top{display:flex;align-items:center;gap:.5em;font-size:.875rem;color:var(--color-ink-2)}
.ct-sr-card .ct-flag{width:1.5em;height:auto;border-radius:.12em;flex:none}
.ct-sr-card .ct-flag--none{display:inline-block;width:auto;font-weight:700;letter-spacing:.1em}
.ct-sr-card__title{margin-top:8px;font-weight:600;line-height:1.5;color:var(--color-heading)}
.ct-sr-card__line{font-size:.875rem;line-height:1.6;color:var(--color-ink-2)}
.ct-sr-card__link{margin-top:auto;padding-top:12px;align-self:flex-start;font-size:.875rem;font-weight:600;color:var(--color-heading);text-decoration:underline;text-decoration-color:transparent;transition:text-decoration-color .4s}
a.ct-sr-card:focus-visible{outline:2px solid var(--color-heading);outline-offset:2px}
@media(hover:hover),(pointer:fine){a.ct-sr-card:hover .ct-sr-card__link{text-decoration-color:currentColor}}
@media(prefers-reduced-motion:reduce){.ct-sr-card__link{transition:none}}
`;

/** Стилі карток. Вмикається там, де вони є, один раз на сторінку. */
export function SearchCardsStyle() {
  return (
    <style href="ct-search-cards" precedence="ct-components">
      {CARDS_CSS}
    </style>
  );
}

/**
 * Рядок «де це»: відстань до місця, яке назвав запит.
 *
 * 🔴 CAMP-140: НАЗВА береться з найкраще названого збігу, ЧИСЛО — лише
 * від найближчого. `search()` впорядковує за відстанню до найближчого
 * місця, чию назву запит зачепив, і це часто не те місце, яке мав на
 * увазі читач: магазин за 489 м від Kamp Siber зветься «Kmetijska
 * zadruga Tolmin», тож `camping tolmin` відповідав «489 m from
 * Kmetijska zadruga Tolmin» — правда й марність. Підпис тепер каже
 * Tolmin.
 *
 * 🔴 Коли це різні місця — відстань ВІДКИДАЄТЬСЯ, а не підміняється.
 * Виміряно на живому індексі за 500 міських запитів: друкувати
 * відстань до підписаного місця додало б 531 нову пару рядків, де
 * менше число стоїть нижче за більше (з 3 637 до 4 168), за 268 чисел
 * на 4 724 рядках. Правило сторінки: відстань друкується лише тоді,
 * коли за нею цей рядок і впорядкований. Інакше читач отримує місце
 * без числа — на що він і питав — а точне число лежить за одним кліком.
 *
 * «near» — те, що каже сам запис: `doc.near` це «місця, біля яких цей
 * кемпінг». Він найширший там, де навколо порожньо: медіана 4,5 км на
 * рядках, що розійшлись, 42 км на краю.
 *
 * 🔴 Місце друкується ЛИШЕ коли запит його назвав. «1.2 km» для
 * запиту «shower» було б числом, що відповідає на питання, якого ніхто
 * не ставив.
 */
export function nearLine(label: SearchHit['label']): string | null {
  if (label === undefined) return null;
  return label.isNearest
    ? `${formatDistance(label.m)} from ${label.name}`
    : `near ${label.name}`;
}

interface CardProps {
  href: string;
  /** Код країни для прапора. */
  flag: string;
  /** Підпис біля прапора. Немає — лише прапор. */
  kicker?: string;
  title: ReactNode;
  lines: (string | null | false | undefined)[];
  cta: string;
  testId: string;
}

function Card({ href, flag, kicker, title, lines, cta, testId }: CardProps) {
  return (
    <li>
      <Link href={href} className="ct-sr-card" data-testid={testId}>
        <span className="ct-sr-card__top">
          <Flag code={flag} />
          {kicker ? <span>{kicker}</span> : null}
        </span>
        <span className="ct-sr-card__title">{title}</span>
        {lines.filter(Boolean).map((line) => (
          <span key={line as string} className="ct-sr-card__line">
            {line}
          </span>
        ))}
        <span className="ct-sr-card__link">{cta}</span>
      </Link>
    </li>
  );
}

const en = (n: number): string => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many: string): string =>
  `${en(n)} ${n === 1 ? one : many}`;

export function CampsiteCards({ hits }: { hits: readonly SearchHit[] }) {
  return (
    <ul data-testid="search-results" className="ct-sr">
      {hits.map((hit) => (
        <Card
          key={hit.doc.path}
          href={hit.doc.path}
          flag={hit.doc.country}
          kicker={countryName(hit.doc.country)}
          // Кемпінг без назви так і називається: не порожній рядок і не
          // слаг, видаваний за назву.
          title={hit.doc.name || 'Unnamed campsite'}
          lines={[regionTitle(hit.doc.region), nearLine(hit.label)]}
          cta="View campsite"
          testId="search-card-campsite"
        />
      ))}
    </ul>
  );
}

export function RegionCards({
  regions,
  /** Лічильник кемпінгів чесний лише коли весь індекс на місці. */
  showCounts,
}: {
  regions: readonly RegionEntry[];
  showCounts: boolean;
}) {
  return (
    <ul data-testid="search-results-regions" className="ct-sr">
      {regions.map((r) => (
        <Card
          key={`${r.country}/${r.region}`}
          href={`/camping/${r.country}/${r.region}`}
          flag={r.country}
          kicker={countryName(r.country)}
          title={r.name}
          lines={[showCounts ? plural(r.count, 'campsite', 'campsites') : null]}
          cta="See campsites"
          testId="search-card-region"
        />
      ))}
    </ul>
  );
}

export function CountryCards({ countries }: { countries: readonly CountryEntry[] }) {
  return (
    <ul data-testid="search-results-countries" className="ct-sr">
      {countries.map((c) => (
        <Card
          key={c.country}
          href={`/camping/${c.country}`}
          flag={c.country}
          title={c.name}
          lines={[
            `${plural(c.spots, 'campsite', 'campsites')} · ${plural(c.regions, 'region', 'regions')}`,
          ]}
          cta="See regions"
          testId="search-card-country"
        />
      ))}
    </ul>
  );
}
