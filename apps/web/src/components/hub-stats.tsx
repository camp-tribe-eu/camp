import type { CSSProperties } from 'react';
import type { HubFaqItem, HubTile } from '@/lib/hub-stats';
import { Block } from '@/components/layout';

// The stat tiles and the FAQ of the hub pages. What is printed is decided
// in lib/hub-stats.ts; this only lays it out. Both render NOTHING when
// handed nothing — no empty grid, no heading over no questions — so a
// region whose counts failed to arrive looks like today's page, not like
// a broken one.
//
// CAMP-451: both are drawn by the theme's rules now, not by bare borders.
//
// 🔴 TILES — the `collection-card` surface of Fuse (`collection-card.
// build.css`, read from the `fuse 1.0.1.zip` archive 09.11.2026): an
// outer frame `padding:4px` (≥992: 8px) with radius `--global-border-
// radius` on `--color-background-secondary`, and an inner panel with
// radius `calc(r * .75)`. The grid gap is the theme's `list-collections`
// row-gap: 8px, 12px from 992.
//
// 🔴 FAQ — the theme's FAQ accordion (`faq-simple.build.css`, 47 rules,
// 4 860 bytes, and `snippets/faq-accordion-item.liquid`), literally:
//
//   .faq__items-category-list{display:flex;flex-direction:column;gap:4px}
//                                                          ≥992: gap:12px
//   .faq__accordion-item{border-radius:calc(var(--global-border-radius)*.75);
//       background:var(--color-background-secondary)}     ≥992: radius r
//   .faq__accordion-item-control{gap:12px;padding:8px 16px}
//                                                ≥992: 16px 20px 16px 32px
//   .faq-simple__item-title-text{font-size:var(--body-font-size);
//       font-weight:600;line-height:1.5;text-align:start}
//                                        ≥992: 1.5 × body, line-height 1.333
//   .faq__accordion-item-icon{width:48px;height:40px;flex-shrink:0;
//       border-radius:calc(r*.75);border:1px solid var(--color-border-primary);
//       display:flex;align-items:center;justify-content:center}
//                                        ≥992: 80×64, radius calc(r*1.25)
//   .faq__accordion-item.is-active .faq__accordion-item-icon-plus{
//       transform:rotate(90deg)}
//   .faq__accordion-item-inner{padding:0 16px 8px;display:flex;
//       flex-direction:column;gap:12px}
//
// 🔴 WHERE WE KNOWINGLY DO NOT COPY THE THEME — named, not fudged: the
// theme opens and closes items with JavaScript (`<button aria-expanded>`
// + `section-faq.build.js`). Here the item stays a `<details>`/`<summary>`
// pair: it opens without any script, which is the crawl criterion of
// CAMP-71 and what hub-screens.spec.tsx counts. The theme's look — the
// rounded item, the control row, the plus in a bordered box that turns
// into a minus — is drawn on top of it; the native `▶` marker is hidden.
//
// 🔴 CSS TRAVELS IN THE HTML (`<style href precedence>`), as in
// ticker.tsx: a test reads the rule from the served markup, not from a
// constant.

// Not exported on purpose: a test must read the served HTML, not this.
const STATS_CSS = `
.ct-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:0}
.ct-stat{display:grid;gap:2px;align-content:start;padding:12px 16px;border:4px solid var(--color-surface-2);border-radius:var(--r,16px);background-color:var(--color-surface);background-clip:padding-box}
.ct-stat:last-child:nth-child(odd){grid-column:span 2}
.ct-stat__label{font-size:.75rem;color:var(--color-ink-2)}
.ct-stat__value{font-size:1.25rem;font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-heading)}
.ct-stat__note{margin-top:2px;font-size:.75rem;color:var(--color-ink-2)}
.ct-stats__as-of{margin-top:8px;font-size:.75rem;color:var(--color-ink-2)}
@media(min-width:768px){.ct-stats{grid-template-columns:repeat(var(--ct-stats-cols,3),1fr);gap:12px}.ct-stat:last-child:nth-child(odd){grid-column:auto}}
@media(min-width:992px){.ct-stat{border-width:8px}}
`;

export function HubStatTiles({
  tiles,
  asOf,
}: {
  tiles: readonly HubTile[];
  /** The "Counted from our listings as of …" line, or null without a day. */
  asOf: string | null;
}) {
  if (tiles.length === 0) return null;
  // As many columns as tiles, never an empty cell: the mock-up's four
  // are three on most pages today (lib/hub-stats.ts), and a fourth cell
  // with nothing in it reads as a figure that failed to load.
  const cols = Math.min(4, tiles.length);
  return (
    <section
      aria-label="Key figures"
      className="mt-6"
      style={{ '--ct-stats-cols': String(cols) } as CSSProperties}
    >
      <style href="ct-stats" precedence="ct-components">
        {STATS_CSS}
      </style>
      {/* 🔴 РІВНО ОДИН `div` МІЖ `dl` І `dt`/`dd` — більше не можна.
          Перша редакція мала два (`div.ct-stat > div.ct-stat__panel`), щоб
          повторити дві коробки теми: зовнішню рамку й внутрішню панель.
          Lighthouse на `/camping/hr/zadarska` впав на цьому: accessibility
          0.89 при стелі 0.9, аудити `definition-list` («dl element has
          direct children that are not allowed: div > div») і `dlitem`
          («does not have a <dl> parent element») — по 7 ваги кожен.
          Тобто для читача екрана підписи й значення переставали бути
          списком означень узагалі.

          Дві коробки лишились, але однією рамкою: смуга 4px кольору
          `--color-surface-2` як border, панель `--color-surface` під ним.
          Внутрішній радіус CSS рахує сам — 16−4 = 12 = `calc(r * .75)`,
          рівно число теми. Від 992px смуга 8px, і внутрішній радіус стає
          8 замість 12 теми: тема в цьому місці сама не концентрична
          (рамка 8, радіус 12 при зовнішніх 16), і я копіюю її числа, а не
          виправляю її геометрію. */}
      <dl className="ct-stats">
        {tiles.map((t) => (
          // On two columns an odd last tile takes the whole row, for
          // the same reason: no empty cell (`.ct-stat:last-child:nth-child(odd)`).
          <div key={t.key} className="ct-stat">
            <dt className="ct-stat__label">{t.label}</dt>
            <dd>
              <strong className="ct-stat__value">{t.value}</strong>
              {/* A block, not a span: the note is its own line for a reader
                  and its own token for a test that reads the HTML. */}
              {t.note && <p className="ct-stat__note">{t.note}</p>}
            </dd>
          </div>
        ))}
      </dl>
      {asOf && <p className="ct-stats__as-of">{asOf}</p>}
    </section>
  );
}

// Not exported on purpose: a test must read the served HTML, not this.
const FAQ_CSS = `
.ct-faq{display:flex;flex-direction:column;gap:4px;margin-top:12px}
.ct-faq__item{border-radius:calc(var(--r,16px) * .75);background-color:var(--color-surface-2)}
.ct-faq__control{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;cursor:pointer;list-style:none;font-weight:600;line-height:1.5;text-align:start;word-break:break-word;color:var(--color-heading)}
.ct-faq__control::-webkit-details-marker{display:none}
.ct-faq__control::marker{content:""}
.ct-faq__control:focus-visible{outline:1px solid var(--color-heading);outline-offset:-2px;border-radius:inherit}
.ct-faq__icon{display:flex;flex-shrink:0;align-items:center;justify-content:center;width:48px;height:40px;border-radius:calc(var(--r,16px) * .75);border:1px solid var(--color-line-2);color:var(--color-heading)}
.ct-faq__icon svg{width:16px;height:16px}
.ct-faq__plus-v{transform-origin:center;transition:transform .2s}
.ct-faq__item[open] .ct-faq__plus-v{transform:rotate(90deg)}
.ct-faq__inner{display:flex;flex-direction:column;gap:12px;padding:0 16px 8px;color:var(--color-ink-2)}
@media(min-width:992px){.ct-faq{gap:12px}.ct-faq__item{border-radius:var(--r,16px)}.ct-faq__control{padding:16px 20px 16px 32px;font-size:1.5rem;line-height:1.333}.ct-faq__icon{width:80px;height:64px;border-radius:calc(var(--r,16px) * 1.25)}.ct-faq__inner{padding:0 32px 16px}}
@media(prefers-reduced-motion:reduce){.ct-faq__plus-v{transition:none}}
`;

export function HubFaq({
  items,
  region,
}: {
  items: readonly HubFaqItem[];
  region: string;
}) {
  if (items.length === 0) return null;
  return (
    <Block as="section" measure="read" aria-labelledby="hub-faq-heading" className="mt-10">
      <style href="ct-faq" precedence="ct-components">
        {FAQ_CSS}
      </style>
      <h2 id="hub-faq-heading" className="text-xl md:text-[25px]">
        Questions about camping in {region}
      </h2>
      <div className="ct-faq">
        {items.map((f) => (
          <details key={f.key} className="ct-faq__item">
            <summary className="ct-faq__control">
              <span className="ct-faq__question">{f.question}</span>
              <span className="ct-faq__icon" aria-hidden="true">
                {/* The theme's `plus-minus` icon: two bars; the vertical one
                    turns 90° onto the horizontal when the item is open. */}
                <svg viewBox="0 0 16 16" fill="none" focusable="false">
                  <path d="M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path
                    className="ct-faq__plus-v"
                    d="M8 2v12"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </summary>
            <div className="ct-faq__inner">
              <p className="text-sm">{f.answer}</p>
            </div>
          </details>
        ))}
      </div>
    </Block>
  );
}
