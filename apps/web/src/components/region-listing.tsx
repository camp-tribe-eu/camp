import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AMENITY_KEYS,
  AMENITY_LABEL_SHORT,
  countryName,
  getHubStats,
  getRegions,
  getRegionSpots,
  REGION_PER_PAGE,
  SPOT_TYPE_LABEL,
  type RegionListingData,
  type SpotCard,
} from '@/lib/api';
import {
  amenityList,
  apiSearch,
  emptyHeadline,
  filterLabel,
  hasState,
  hubHref,
  isFiltering,
  parseHubQuery,
  relFor,
  without,
  withPage,
  withUnknown,
  type HubQuery,
  type SearchParams,
} from '@/lib/hub-filters';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { ButtonLink, buttonClasses } from '@/components/button';
import { Pagination } from '@/components/pagination';
import RegionInsights from '@/components/region-insights';
import RegionDriving from '@/components/region-driving';
import RegionMap from '@/components/region-map';
import { RegionFilterPanel, RegionToolbar } from '@/components/region-toolbar';
import { countedAsOf, regionFaq, regionTiles } from '@/lib/hub-stats';
import { HubFaq, HubStatTiles } from '@/components/hub-stats';
import { LayeredBanner } from '@/components/layered-banner';
import { Block, PageShell } from '@/components/layout';

// CAMP-71, level 2: the region hub. Shared by /camping/{c}/{r},
// /camping/{c}/{r}/page/{n} and /camping/{c}/{r}/filter?… so the first
// page, the rest and the filtered view cannot drift.
//
// CAMP-452 — the layout the owner drew, top to bottom:
//
//   banner (the h1 and the lead, base page only)
//   ─────────────────────────────────────────────
//   left: the region's prose and figures │ right: the map, sticky
//   ─────────────────────────────────────────────
//   ▸ sticky toolbar: sort, active filters, "N sites match"
//   ▸ every filter value as a checkbox chip with its count
//   card  card  card  card
//
// 🔴 THE CONTROLS SIT DIRECTLY ABOVE WHAT THEY CONTROL. The owner named
// the defect in his own proposal: «якщо ми зліва тут обираємо то не
// бачимо що фільтується внизу». Nothing that filters or sorts lives in
// the left column; the left column is text and figures. The map on the
// right is a representation of the same set as the list — it receives
// the SAME `q` the list was fetched with and highlights what passes it
// (region-map.tsx) — not a picture beside it.
//
// 🔴 ONE QUERY, TWO CONSUMERS. `q` is parsed once and handed both to
// `getRegionSpots` (the cards, the counts) and to `RegionMap` (the
// highlight). A page that handed the map anything else would show one
// set and highlight another; tests/unit/hub-filters.spec.tsx reads both
// off one rendered page.

export async function regionMeta(country: string, region: string) {
  const all = await getRegions(country);
  return all.find((r) => r.slug === region) ?? null;
}

export default async function RegionListing({
  country,
  region,
  page,
  searchParams,
  live = false,
}: {
  country: string;
  region: string;
  page: number;
  /**
   * The filter route's query string, as Next hands it over. The static
   * routes pass nothing; the page number always comes from `page`.
   */
  searchParams?: SearchParams;
  /** Rendered per request (the filter route), not by the build. */
  live?: boolean;
}) {
  const q: HubQuery = { ...parseHubQuery(searchParams ?? {}), page };
  // Per request, an API that cannot be reached is answered like one that
  // said 5xx — no region, a 404 — instead of a 500. Never at build time:
  // see `getRegionSpots` for why a build must fail loudly here.
  // 🔴 The one address a region's own prose and figures may live at: its
  // base URL, page 1, built statically. Not page 2, not /filter?…
  // (rendered per request, `live`), not even /filter with every box
  // unticked. Decided before anything is fetched, so the filter route —
  // hundreds of thousands of addresses — never asks for the figures.
  const baseFirstPage = page === 1 && !live && !hasState(q);
  const [meta, data, stats] = await Promise.all([
    regionMeta(country, region).catch((e: unknown) => {
      if (!live) throw e;
      return null;
    }),
    getRegionSpots(country, region, page, apiSearch(q), { live }),
    baseFirstPage ? getHubStats(country) : Promise.resolve([]),
  ]);
  if (!meta || !data.region) notFound();

  // Design-audit §11, screen 2 and the FAQ: this region's own counts, or
  // nothing at all when its row did not arrive (lib/hub-stats.ts).
  const own = baseFirstPage ? (stats.find((r) => r.slug === region) ?? null) : null;
  const tiles = own ? regionTiles(own) : [];
  const faq = own ? regionFaq(own) : [];

  // 🔴 The number the page shows beside the filters is the API's count
  // over the whole filtered set, never the length of the page it holds —
  // page 1 holds 24 of 314. Absent (an API from before filters), the
  // page draws no count rather than a wrong one.
  const matched = data.matched;
  const filtering = isFiltering(q);
  // An empty filtered result on its first page is an answer, not a 404 —
  // the reader asked for something we have no record of, and the page
  // below says so and what to do. Every other empty page does not exist.
  const empty = filtering && page === 1 && data.items.length === 0;
  if (data.items.length === 0 && !empty) notFound();

  const inSet = filtering ? (matched ?? data.items.length) : data.total;
  const pages = Math.max(1, Math.ceil(inSet / REGION_PER_PAGE));
  const cName = countryName(country);
  const base = `/camping/${country}/${region}`;
  const here = hubHref(base, q);
  const regionName = data.region as string;

  const lead = (
    <>
      {data.total} {data.total === 1 ? 'site' : 'sites'} in {regionName}, {cName}
      {/* The pages of the WHOLE region. A filtered set's pages are
          counted from `matched` and said beside that number. */}
      {!filtering && pages > 1 && ` — page ${page} of ${pages}`}.
    </>
  );

  // The map's half of the one query: the filter, nothing about pages.
  const mapFilter = {
    types: q.types,
    amenities: q.amenities,
    includeUnknown: q.includeUnknown,
  };

  return (
    <PageShell rhythm="tight">
      <style href="ct-region" precedence="ct-components">
        {REGION_CSS}
      </style>
      <script
        {...jsonLdProps(
          collectionGraph({
            name: `Campsites in ${regionName}`,
            description: `${data.total} campsites in ${regionName}, ${cName}.`,
            path: here,
            items: data.items.map((s) => ({
              name: s.name ?? SPOT_TYPE_LABEL[s.type],
              path: `${base}/${s.slug}`,
            })),
          }),
        )}
      />
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'Camping', path: '/camping' },
            { name: cName, path: `/camping/${country}` },
            { name: regionName, path: base },
          ]),
        )}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link href="/camping" className="hover:text-heading">
              Camping
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={`/camping/${country}`} className="hover:text-heading">
              {cName}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{regionName}</li>
        </ol>
      </nav>

      {baseFirstPage ? (
        /* The banner carries the h1 and the lead — the same layered banner
           and the same drawing the country hub uses (CAMP-451): we hold
           no regional photography. Base page only: page 2 and every
           /filter?… address are working views, and a 480px banner above
           a filtered list would push the thing the reader just asked
           for below the fold. */
        <LayeredBanner
          className="mt-4"
          headingLevel={1}
          background={{ src: '/banners/lake.webp' }}
          tickerText={regionName.toUpperCase()}
          heading={`Campsites in ${regionName}`}
          description={lead}
          cta={{ href: '#results', label: 'See the campsites' }}
          minHeight="min(60svh, 480px)"
          textSize={{ desktop: '120px', mobile: '48px' }}
        />
      ) : (
        <>
          <h1 className="mt-4 text-3xl md:text-[42px]">Campsites in {regionName}</h1>
          <Block as="p" measure="read" className="mt-3 text-ink-2">
            {lead}
          </Block>
        </>
      )}

      {/* Prose and figures on the left, the map on the right. On pages
          without prose — page 2, a filtered view — the map takes the
          whole width at the theme's wide-map ratio (region-map.tsx). */}
      {baseFirstPage ? (
        <div className="ct-region">
          <div className="ct-region__text">
            <HubStatTiles tiles={tiles} asOf={countedAsOf(own?.readAt ?? null)} maxCols={2} />
            <RegionInsights country={country} region={region} />
            <RegionDriving country={country} region={region} />
          </div>
          <div className="ct-region__map">
            <RegionMap country={country} slug={region} region={regionName} filter={mapFilter} />
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <RegionMap
            country={country}
            slug={region}
            region={regionName}
            filter={mapFilter}
            wide
          />
        </div>
      )}

      {/* The banner's "See the campsites" lands here, under the sticky
          header and the toolbar's own offset (region-toolbar.tsx). */}
      <div id="results" className="ct-region__results" />

      <RegionToolbar base={base} q={q} data={data} pages={pages} />
      <RegionFilterPanel base={base} q={q} data={data} />

      {empty ? (
        <EmptyResult
          base={base}
          q={q}
          data={data}
          region={regionName}
          country={country}
          cName={cName}
        />
      ) : (
        /* 🔴 `grid` stays in the class list: tests/e2e/hub-filters.spec.ts
           counts the cards as `main ul.grid li a`. */
        <ul className="ct-cards mt-6 grid">
          {data.items.map((s) => (
            <SpotListCard
              key={s.slug}
              spot={s}
              href={`/camping/${country}/${region}/${s.slug}`}
            />
          ))}
        </ul>
      )}

      {/* CAMP-451: the theme's paginator (components/pagination.tsx).
          Plain links, no JavaScript — the card's criterion is an unaided
          crawl, and a paginator built on a click handler is invisible to
          it. A filtered or sorted set's pages live in the query string
          rather than in `/page/N` — those addresses are the unfiltered
          set's, made by the build — and carry `rel="nofollow"` (relFor). */}
      {pages > 1 &&
        (hasState(q) ? (
          <Pagination
            className="mt-8"
            page={q.page}
            pages={pages}
            href={(n) => hubHref(base, withPage(q, n))}
            rel={(n) => relFor(hubHref(base, withPage(q, n)))}
          />
        ) : (
          <Pagination
            className="mt-8"
            page={page}
            pages={pages}
            href={(n) => (n === 1 ? base : `${base}/page/${n}`)}
          />
        ))}

      {baseFirstPage && <HubFaq items={faq} region={regionName} />}

      <RegionNeighbours
        country={country}
        current={region}
        cName={cName}
      />

    </PageShell>
  );
}

/**
 * The two-column block and the card grid — CAMP-452.
 *
 * 🔴 NUMBERS FROM THE THEME (`fuse 1.0.1.zip`, read 09.11.2026):
 *
 *   assets/collection.build.css
 *   .collection__grid-wrapper{display:flex;flex-wrap:wrap;gap:4px}   ≥768: gap:12px
 *   .collection__item{width:calc(50% - 2px)}                        ≥768: calc(25% - 9px)
 *   .collection__grid-wrapper--custom{grid-template-columns:repeat(16,minmax(0,1fr))}
 *   .collection__item--big-card-*{grid-column:span 8}              (half the row)
 *   .collection__item--big-card-* .product-card{position:sticky;
 *       top:calc(var(--header-height-sticky) + 24px)}
 *
 *   assets/collection-card.build.css (frame) and product-card.build.css (body)
 *   .collection-card{padding:4px;border-radius:var(--global-border-radius);
 *       background-color:var(--color-background-secondary)}         ≥992: padding:8px
 *   .product-card{display:flex;min-height:100%;flex-direction:column;
 *       border-radius:calc(var(--global-border-radius)*.75)}
 *   .product-card__footer{display:flex;flex-direction:column;align-items:flex-start;
 *       flex-grow:1;height:100%;padding:16px 20px 20px 20px}
 *   .product-card__title{font-size:var(--body-font-size);line-height:1.5;font-weight:600}
 *   .product-card__vendor{margin-top:8px;line-height:1.5;font-weight:400}
 *   .product-card__price{padding-top:16px}
 *   .product-card__label{padding:2px 8px;border-radius:calc(var(--global-border-radius)/2);
 *       font-size:calc(var(--body-font-size)*.75);font-weight:600;line-height:1.33}
 *
 * Two columns on a phone and four from 768px, as the theme's collection
 * grid; the two-column text|map block from 992px, the theme's threshold
 * for a big card beside the grid. The header's height is the variable
 * the header writes (`--ct-header-h`, site-header-frame.tsx; 63px without
 * JavaScript), the theme's `+ 24px` below it.
 *
 * 🔴 EQUAL HEIGHT WITHOUT A PHOTO. Rows do not float: a grid stretches
 * its cells, the card is a column flex box at 100% height, and the
 * button is pinned to the bottom with `margin-top:auto` — the same
 * device as the region tiles (region-tiles.tsx). Photos are CAMP-469's.
 *
 * 🔴 ONE LINK PER CARD, the whole card: the crawl tests count
 * `main ul.grid li a` as cards, and the "View campsite" is a span drawn
 * as the theme's button, not a second link.
 *
 * 🔴 AND ITS NAME COMES FROM ITS CONTENT, not from `aria-labelledby`.
 * The first edition named the link by its title alone, so that a screen
 * reader would hear the campsite's name and not the button text twice.
 * That is a preference; WCAG 2.5.3 «Label in Name» is a criterion, and
 * it was broken: a voice-control user saying "View campsite" matched
 * nothing, because the accessible name did not contain the visible text.
 *
 * Measured on the deployed page (axe, 09.11.2026, `/camping/fr/vendee`),
 * three namings, same markup:
 *
 *   title only                    24 `label-content-name-mismatch` nodes
 *   title + "View campsite"       24  — a partial name does not satisfy it
 *   no `aria-labelledby`           0
 *
 * So the attribute goes. The name still BEGINS with the campsite's name,
 * because the title is the first thing in the card.
 */
const REGION_CSS = `
.ct-region{display:grid;gap:12px;margin-top:24px}
.ct-region__text > * + *{margin-top:24px}
.ct-region__results{scroll-margin-top:calc(var(--ct-header-h,63px) + 24px)}
.ct-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;list-style:none;margin:24px 0 0;padding:0}
.ct-card{display:flex}
.ct-card__link{display:flex;flex-direction:column;width:100%;height:100%;padding:4px;border-radius:var(--r,16px);background-color:var(--color-surface-2);color:inherit;text-decoration:none}
.ct-card__body{display:flex;flex:1 1 auto;flex-direction:column;align-items:flex-start;height:100%;padding:16px 20px 20px;border-radius:calc(var(--r,16px) * .75);background-color:var(--color-surface)}
.ct-card__title{font-weight:600;line-height:1.5;color:var(--color-heading);word-break:break-word}
.ct-card__type{margin-top:8px;font-size:.875rem;line-height:1.5;color:var(--color-ink-2)}
.ct-card__tags{display:flex;flex-wrap:wrap;gap:4px;padding-top:16px}
.ct-card__tag{padding:2px 8px;border-radius:calc(var(--r,16px) / 2);border:1px solid color-mix(in srgb,var(--color-ok) 50%,transparent);background-color:color-mix(in srgb,var(--color-ok) 10%,transparent);font-size:.75rem;font-weight:600;line-height:1.33;color:var(--color-heading)}
.ct-card__button{margin-top:auto;padding-top:16px;align-self:stretch}
.ct-card__button > span{width:100%}
a.ct-card__link:focus-visible{outline:2px solid var(--color-heading);outline-offset:2px}
@media(hover:hover),(pointer:fine){a.ct-card__link:hover .ct-card__title{text-decoration:underline}a.ct-card__link:hover .ct-card__button > span{border-color:var(--color-line-blue)}}
@media(min-width:768px){.ct-cards{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}}
@media(min-width:992px){.ct-region{grid-template-columns:repeat(2,minmax(0,1fr))}.ct-region__map{position:sticky;top:calc(var(--ct-header-h,63px) + 24px);align-self:start}.ct-card__link{padding:8px}}
`;

function SpotListCard({ spot, href }: { spot: SpotCard; href: string }) {
  // Only what is actually recorded. A card that prints five grey icons for
  // five unknown amenities says "we know nothing" five times; one honest
  // line says it once and leaves room for what we do know.
  const known = AMENITY_KEYS.map(
    (k) => [k, AMENITY_LABEL_SHORT[k]] as const,
  ).filter(([k]) => spot.amenities?.[k] === 'yes');
  return (
    <li className="ct-card">
      {/* Без `aria-labelledby` — див. 🔴 у заголовку файла: часткове імʼя
          ламає WCAG 2.5.3, і це заміряно, а не припущено. */}
      <Link href={href} className="ct-card__link">
        <span className="ct-card__body">
          <span className="ct-card__title">
            {spot.name ?? SPOT_TYPE_LABEL[spot.type]}
          </span>
          <span className="ct-card__type">{SPOT_TYPE_LABEL[spot.type]}</span>
          {known.length > 0 ? (
            <span className="ct-card__tags">
              {known.map(([k, label]) => (
                <span key={k} className="ct-card__tag">
                  {label}
                </span>
              ))}
            </span>
          ) : (
            <span className="ct-card__type">Facilities not recorded</span>
          )}
          <span className="ct-card__button">
            {/* The theme's secondary button (button.tsx), drawn on a span:
                the card is already the link. */}
            <span className={buttonClasses('secondary', 'md')}>View campsite</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Screen 3 of the mock-up: the reason, and three things to do about it.
 *
 * 🔴 The reason is a sentence about OUR RECORDS, not about the place —
 * "is recorded with", because an unrecorded laundry is not a missing
 * one — and "Remove X" names the filter whose removal brings the most
 * back, from the API's drop-one counts, not a guess.
 */
function EmptyResult({
  base,
  q,
  data,
  region,
  country,
  cName,
}: {
  base: string;
  q: HubQuery;
  data: RegionListingData;
  region: string;
  country: string;
  cName: string;
}) {
  const active = q.types.length + q.amenities.length;
  const unknown = data.unknownExcluded ?? 0;
  const best = (data.dropOne ?? []).reduce<
    { kind: 'type' | 'amenity'; key: string; matched: number } | null
  >((b, d) => (b === null || d.matched > b.matched ? d : b), null);

  return (
    <section
      aria-labelledby="no-match"
      className="mt-6 grid justify-items-start gap-3 rounded-card border border-dashed border-line bg-surface-2 p-7"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[.1em] text-warn">
        {active > 1 ? `Nothing matches all ${active} filters` : 'Nothing matches this filter'}
      </p>
      <h2 id="no-match" className="text-xl">
        {emptyHeadline(q, region)}
      </h2>
      <p className="max-w-[56ch] text-ink-2">
        {unknown > 0
          ? `${unknown} ${unknown === 1 ? 'site has' : 'sites have'} no record of ${amenityList(q)} — not a no, just nothing written down.`
          : q.amenities.length
            ? `Nobody has recorded that combination anywhere in ${region}.`
            : `There is no site of that type listed in ${region}.`}
        {best && best.matched > 0 && (
          <>
            {' '}
            Drop &ldquo;{filterLabel(best.kind, best.key)}&rdquo; and{' '}
            {best.matched} {best.matched === 1 ? 'site comes' : 'sites come'} back.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2" data-hub-empty-actions>
        {best ? (
          <ButtonLink
            variant="primary"
            size="sm"
            href={hubHref(base, without(q, best.kind, best.key))}
            rel={relFor(hubHref(base, without(q, best.kind, best.key)))}
          >
            Remove &ldquo;{filterLabel(best.kind, best.key)}&rdquo;
          </ButtonLink>
        ) : (
          unknown > 0 && (
            <ButtonLink
              variant="primary"
              size="sm"
              href={hubHref(base, withUnknown(q, true))}
              rel={relFor(hubHref(base, withUnknown(q, true)))}
            >
              Include the {unknown} unrecorded
            </ButtonLink>
          )
        )}
        <ButtonLink size="sm" href={base}>
          Clear all filters
        </ButtonLink>
        <ButtonLink size="sm" href={`/camping/${country}`}>
          Other regions in {cName}
        </ButtonLink>
      </div>
    </section>
  );
}

/**
 * Sideways links, as the card asks. Not "neighbours" geographically — that
 * would need adjacency we do not have — but the largest other regions of
 * the same country, which is what gives a reader somewhere to go and gives
 * the crawler a second route into each region.
 */
async function RegionNeighbours({
  country,
  current,
  cName,
}: {
  country: string;
  current: string;
  cName: string;
}) {
  const others = (await getRegions(country))
    .filter((r) => r.slug !== current)
    .slice(0, 12);
  if (others.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xl md:text-[25px]">
        Other regions in {cName}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-x-2 gap-y-3">
        {others.map((r) => (
          <li key={r.slug}>
            <ButtonLink
              href={`/camping/${country}/${r.slug}`} size="sm">
              {r.region}
              <span className="tabular-nums text-ink-2">{r.spots}</span>
            </ButtonLink>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <Link href={`/camping/${country}`} className="text-ink-2 underline">
          All regions in {cName}
        </Link>
      </p>
    </section>
  );
}
