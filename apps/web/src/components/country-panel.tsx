import { BackToTop, DensityPicker, ListingPanel } from '@/components/listing-panel';

/**
 * CAMP-441 (50–53), the country page's half of the bottom panel.
 *
 * A country page lists REGIONS, which are static cards, so its "Filters"
 * and "Sort by" cannot be links to another address the way the region
 * page's are (there is no `/camping/fr?sort=name`, and 102 cards do not
 * need a round trip). They are two radio groups, and the cards answer with
 * CSS alone — the same device as the density picker:
 *
 *   sort    `order: var(--ct-count)` / `var(--ct-name)` on each card, set in
 *           the markup by `rankRegions` below — no script, so it works in
 *           the first second and for a reader without JavaScript;
 *   filter  "2+ campsites" hides the cards flagged `data-single`. They are
 *           hidden, not removed: the links stay in the document (CAMP-71:
 *           a region with one campsite is `noindex` but must stay linked).
 *
 * Both are a view over the list the page already holds, not a query: the
 * counts printed are the API's, unchanged.
 */

// Not exported: tests read the served HTML.
const COUNTRY_PANEL_CSS = `
.ct-menu{position:relative;min-width:0}
.ct-menu > summary{list-style:none}
.ct-menu > summary::-webkit-details-marker{display:none}
.ct-menu__list{position:absolute;z-index:2;bottom:calc(100% + 10px);left:0;min-width:240px;display:flex;flex-direction:column;gap:4px;margin:0;padding:8px;border:1px solid var(--color-line-2);border-radius:var(--r,16px);background-color:var(--color-surface);color:var(--color-heading);box-shadow:0 4px 20px 0 rgba(0,0,0,.08)}
.ct-menu__radio{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ct-menu__option{display:block;padding:12px 16px;border-radius:calc(var(--r,16px) / 2);font-weight:600;line-height:1.18;cursor:pointer}
.ct-menu__radio:checked + .ct-menu__option{background-color:var(--color-accent-surface)}
.ct-menu__radio:focus-visible + .ct-menu__option{outline:2px solid var(--color-heading);outline-offset:-2px}
.ct-menu__on,.ct-menu__val{display:none}
body:has(#ct-show-multi:checked) .ct-menu__on{display:inline}
body:has(#ct-sort-count:checked) .ct-menu__val--count,body:has(#ct-sort-name:checked) .ct-menu__val--name{display:inline}
body:has(#ct-sort-name:checked) .ct-rtiles__col{order:var(--ct-name,0)}
body:has(#ct-sort-count:checked) .ct-rtiles__col{order:var(--ct-count,0)}
body:has(#ct-show-multi:checked) .ct-rtiles__col[data-single]{display:none}
.ct-menu--sort > summary{height:42px;padding:0 10px;display:flex;align-items:center;gap:8px;color:#fff;font-weight:600;cursor:pointer}
.ct-menu--sort > summary svg{width:20px;height:20px;flex:none}
.ct-menu--sort .ct-sort__label{opacity:.7;font-weight:400}
.ct-menu__text{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media(min-width:480px){.ct-menu__text{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto}}
`;

export interface RegionRank {
  /** Position by name, A to Z (1-based). */
  name: number;
  /** Position by campsites, most first; ties by name; unknown counts last. */
  count: number;
}

/**
 * The two orders, computed once on the server and written into the cards.
 * `Intl.Collator('en')`: "Île-de-France" sorts under I, not after Z.
 */
export function rankRegions(
  regions: readonly { slug: string; region: string; spots: number | null }[],
): Map<string, RegionRank> {
  const coll = new Intl.Collator('en', { sensitivity: 'base' });
  const byName = [...regions].sort((a, b) => coll.compare(a.region, b.region));
  const byCount = [...regions].sort((a, b) => {
    const x = a.spots ?? -1;
    const y = b.spots ?? -1;
    return y - x || coll.compare(a.region, b.region);
  });
  const out = new Map<string, RegionRank>();
  byName.forEach((r, i) => out.set(r.slug, { name: i + 1, count: 0 }));
  byCount.forEach((r, i) => {
    const e = out.get(r.slug);
    if (e) e.count = i + 1;
  });
  return out;
}

function Radio({
  group,
  id,
  checked,
  children,
}: {
  group: string;
  id: string;
  checked?: boolean;
  children: string;
}) {
  return (
    <span className="contents">
      <input type="radio" name={group} id={id} className="ct-menu__radio" defaultChecked={checked} />
      <label htmlFor={id} className="ct-menu__option">
        {children}
      </label>
    </span>
  );
}

export function CountryPanel() {
  return (
    <ListingPanel label="Filter, sort and view the regions" testId="country-panel">
      <style href="ct-country-panel" precedence="ct-components">
        {COUNTRY_PANEL_CSS}
      </style>
      <details className="ct-menu">
        <summary className="ct-panel__btn touch-target" data-testid="region-filter">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
            <path d="M3 5h14M6 10h8M8.5 15h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Filters<span className="ct-menu__on"> (1)</span>
        </summary>
        <fieldset className="ct-menu__list m-0 border-0">
          <legend className="sr-only">Show regions</legend>
          <Radio group="ct-show" id="ct-show-all" checked>
            All regions
          </Radio>
          <Radio group="ct-show" id="ct-show-multi">
            Regions with 2+ campsites
          </Radio>
        </fieldset>
      </details>
      <details className="ct-menu ct-menu--sort">
        <summary className="touch-target" data-testid="region-sort">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
            <path d="M6 4v12M6 16l-2.5-2.5M6 16l2.5-2.5M14 16V4M14 4l-2.5 2.5M14 4l2.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="ct-menu__text">
            <span className="ct-sort__label">Sort by</span>{' '}
            <b className="ct-menu__val ct-menu__val--count">Most campsites</b>
            <b className="ct-menu__val ct-menu__val--name">Name</b>
          </span>
        </summary>
        <fieldset className="ct-menu__list m-0 border-0">
          <legend className="sr-only">Sort regions by</legend>
          <Radio group="ct-sort" id="ct-sort-count" checked>
            Most campsites
          </Radio>
          <Radio group="ct-sort" id="ct-sort-name">
            Name
          </Radio>
        </fieldset>
      </details>
      <DensityPicker />
      <BackToTop />
    </ListingPanel>
  );
}
