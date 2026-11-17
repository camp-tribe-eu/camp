import type { ReactNode } from 'react';

/**
 * CAMP-441 (50–53). The bottom panel of the country and region pages — the
 * theme's collection panel (`fuse 07.09.2026`, `collection.build.css`),
 * read from the archive on 16.11.2026:
 *
 *   .collection__header{position:fixed;bottom:4px;left:4px;right:4px;
 *       display:flex;gap:12px;max-width:780px;margin:0 auto;z-index:23}
 *                                            ≥992: bottom:32px
 *   .collection__header-wrapper{display:flex;justify-content:space-between;
 *       align-items:center;gap:8px;padding:8px}
 *   .collection__header-wrapper::before{backdrop-filter:blur(8px);
 *       background-color:var(--panel-bg-color);border-radius:12px;z-index:-1}
 *   .collection__grid-buttons{display:flex;gap:8px;padding:4px;
 *       border-radius:calc(var(--global-border-radius)/2);
 *       background-color:var(--grid-buttons-bg-color)}     ≥992: gap:12px
 *   .collection__grid-button{width:38px;height:34px;
 *       border-radius:calc(var(--global-border-radius)*.75)}
 *   .collection__grid-button.is-active{background-color:var(--grid-button-active-bg-color);
 *       border-radius:calc(var(--global-border-radius)/2)}
 *   .collection__back-to-top-button{width:42px;height:42px;padding:8px;border-radius:12px}
 *   defaults: --panel-bg-color #000000CC, --panel-fg-color #FFFFFF,
 *             --grid-buttons-bg-color #FFFFFF29, --grid-button-active-bg-color #00000070
 *   icons: three squares-per-row sets — 3/4/6 on a desktop, 1/2/3 on a phone.
 *
 * ⚠ Where this is not the theme, said once:
 *   - density is 3/4/5 on a desktop, not 3/4/6 (the owner's brief, and six
 *     columns of a campsite's name do not fit a 1180px page);
 *   - the panel sits ABOVE the cookie banner (`--consent-h`, globals.css),
 *     not under it: it is a working control, and the banner is answered
 *     once;
 *   - z-index is `--layer-overlay` (14), under the drawers (24) and the
 *     banner (16), above the sticky header (11) — the header and this panel
 *     are at opposite edges of the screen, so they cannot cover each other
 *     (16.11: the old top-sticky toolbar was covered by the header island).
 *
 * 🔴 NO JAVASCRIPT, because the criterion of the hubs is an unaided crawl
 * and because a control that needs hydration is a control that does
 * nothing for the first second. Density is a radio group; the grid answers
 * with `body:has(#ct-density-a:checked) …` (CSS below, and the grids' own
 * classes: `.ct-cards` and `.ct-rtiles__col`). "Back to top" is the
 * `#top` anchor the footer already uses (layout.tsx).
 *
 * 🔴 DOES NOT COVER CONTENT: the page ends with `padding-bottom` for the
 * panel's height, so the last card and the footer can be scrolled clear.
 */

// Not exported: tests read the served HTML.
const PANEL_CSS = `
:root{--ct-panel-h:88px}
body:has(.ct-panel){padding-bottom:calc(var(--consent-h,0px) + var(--ct-panel-h) + 12px)}
.ct-panel{position:fixed;left:4px;right:4px;bottom:calc(var(--consent-h,0px) + 4px);z-index:var(--layer-overlay,14);display:flex;flex-direction:column;gap:4px;max-width:780px;margin:0 auto}
.ct-panel__note{align-self:center;max-width:100%;margin:0;padding:2px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:999px;background-color:rgb(0 0 0/.8);color:#fff;font-size:12px;line-height:1.5;text-align:center}
.ct-panel__row{position:relative;display:flex;flex:1 1 auto;align-items:center;justify-content:space-between;gap:8px;min-width:0;padding:8px;color:#fff}
.ct-panel__row::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:12px;background-color:rgb(0 0 0/.8);backdrop-filter:blur(8px)}
.ct-panel__btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 14px;border:0;border-radius:12px;background-color:#fff;color:#000;font:inherit;font-weight:600;line-height:1.12;text-decoration:none;cursor:pointer;white-space:nowrap}
.ct-panel__btn svg{width:20px;height:20px;flex:none}
.ct-panel__top{padding:0;width:42px}
.ct-panel__btn:focus-visible,.ct-sort__trigger:focus-visible,.ct-dens__input:focus-visible + .ct-dens__btn{outline:2px solid #fff;outline-offset:2px}
.ct-dens{display:flex;gap:4px;min-width:0;margin:0;padding:4px;border:0;border-radius:calc(var(--r,16px) / 2);background-color:rgb(255 255 255/.16)}
.ct-dens__input{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ct-dens__btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:calc(var(--r,16px) * .75);color:#fff;cursor:pointer}
.ct-dens__btn svg{display:block;width:20px;height:20px}
.ct-dens__input:checked + .ct-dens__btn{background-color:rgb(0 0 0/.44);border-radius:calc(var(--r,16px) / 2);cursor:default}
.ct-dens__d{display:none}
.ct-dens__m{display:inline-flex}
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
@media(hover:hover),(pointer:fine){.ct-sort__option:hover{background-color:var(--color-surface-2)}}
.ct-sort__sorticon{width:20px;height:20px;flex:none}
.ct-panel .ct-sort__trigger{gap:8px;min-width:0}
.ct-panel .ct-sort{flex:0 1 auto;min-width:0}
.ct-panel .ct-sort__trigger{height:42px;min-height:42px;padding:0 10px;color:#fff}
.ct-panel .ct-sort__label{opacity:.7}
.ct-panel .ct-sort__options{top:auto;bottom:calc(100% + 10px);color:var(--color-heading)}
.ct-panel .ct-sort__text{display:inline-flex;gap:6px;align-items:center;position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media(min-width:480px){.ct-panel .ct-sort__text{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto}}
@media(min-width:768px){.ct-dens__d{display:inline-flex}.ct-dens__m{display:none}.ct-dens{gap:8px}}
@media(min-width:992px){.ct-panel{bottom:calc(var(--consent-h,0px) + 32px)}body:has(.ct-panel){padding-bottom:calc(var(--consent-h,0px) + var(--ct-panel-h) + 40px)}}
/* Density: a = fewest per row … c = most. Phone 1/2/3, from 768px 3/4/5. */
body:has(#ct-density-a:checked) .ct-cards{grid-template-columns:repeat(1,minmax(0,1fr))}
body:has(#ct-density-c:checked) .ct-cards{grid-template-columns:repeat(3,minmax(0,1fr))}
body:has(#ct-density-a:checked) .ct-rtiles__col{width:100%}
body:has(#ct-density-b:checked) .ct-rtiles__col{width:50%}
body:has(#ct-density-c:checked) .ct-rtiles__col{width:33.333%}
@media(min-width:768px){
body:has(#ct-density-a:checked) .ct-cards{grid-template-columns:repeat(3,minmax(0,1fr))}
body:has(#ct-density-b:checked) .ct-cards{grid-template-columns:repeat(4,minmax(0,1fr))}
body:has(#ct-density-c:checked) .ct-cards{grid-template-columns:repeat(5,minmax(0,1fr))}
body:has(#ct-density-a:checked) .ct-rtiles__col{width:33.333%}
body:has(#ct-density-b:checked) .ct-rtiles__col{width:25%}
body:has(#ct-density-c:checked) .ct-rtiles__col{width:20%}
}
@media(prefers-reduced-motion:reduce){.ct-panel__row{scroll-behavior:auto}}
`;

export function PanelStyle() {
  return (
    <style href="ct-panel" precedence="ct-components">
      {PANEL_CSS}
    </style>
  );
}

/**
 * The panel. `testId` is a hook for tests; `label` names the landmark.
 * Children are the panel's controls in reading order — the shared pieces
 * below, or a page's own (a sort menu).
 */
/** The note under the panel. One string, for the page and its test. */
export const PANEL_NOTE =
  // One line even on a 320px phone (12px type ≈ 290px): a second line made
  // the panel taller than --ct-panel-h and it covered the footer (CI, 17.11).
  'Details may be out of date — check with the campsite.';

export function ListingPanel({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <nav aria-label={label} className="ct-panel" data-testid={testId}>
      <PanelStyle />
      <div className="ct-panel__row">{children}</div>
      {/* CAMP-441 (50): the owner asked for the note under the filter that
          the data can differ from reality. One sentence, always visible,
          the same on the country and the region page. */}
      <p className="ct-panel__note" data-testid="panel-note">
        {PANEL_NOTE}
      </p>
    </nav>
  );
}

const FUNNEL = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
    <path d="M3 5h14M6 10h8M8.5 15h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** The panel's primary button: a link, so it works before hydration. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="ct-panel__btn touch-target">
      {FUNNEL}
      {children}
    </a>
  );
}

/** `n` columns side by side, on a 20 grid: "n cards per row". */
function Squares({ n }: { n: number }) {
  const gap = 2;
  const w = (20 - gap * (n - 1)) / n;
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={i * (w + gap)} y="3" width={w} height="14" rx="1.5" fill="currentColor" />
      ))}
    </svg>
  );
}

const DENSITIES = [
  { id: 'a', desktop: 3, phone: 1 },
  { id: 'b', desktop: 4, phone: 2 },
  { id: 'c', desktop: 5, phone: 3 },
] as const;

/** How many cards per row: 3/4/5 from 768px, 1/2/3 on a phone (the theme's). */
export function DensityPicker() {
  return (
    <fieldset className="ct-dens">
      <legend className="sr-only">Cards per row</legend>
      {DENSITIES.map((d) => (
        <span key={d.id} className="contents">
          <input
            type="radio"
            name="ct-density"
            id={`ct-density-${d.id}`}
            className="ct-dens__input"
            defaultChecked={d.id === 'b'}
          />
          <label htmlFor={`ct-density-${d.id}`} className="ct-dens__btn touch-target">
            <span className="ct-dens__d">
              <Squares n={d.desktop} />
              <span className="sr-only">{d.desktop} per row</span>
            </span>
            <span className="ct-dens__m">
              <Squares n={d.phone} />
              <span className="sr-only">{d.phone} per row</span>
            </span>
          </label>
        </span>
      ))}
    </fieldset>
  );
}

/** "Back to top": the `#top` anchor the footer uses, no script. */
export function BackToTop() {
  return (
    <a href="#top" className="ct-panel__btn ct-panel__top touch-target" aria-label="Back to top">
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
        <path d="M10 16V4M4.5 9.5L10 4l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
