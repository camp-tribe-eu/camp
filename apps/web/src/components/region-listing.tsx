import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AMENITY_KEYS,
  AMENITY_LABEL_SHORT,
  countryName,
  getRegions,
  getRegionSpots,
  REGION_PER_PAGE,
  SPOT_TYPE_LABEL,
  SPOT_TYPE_LABEL_SHORT,
  SPOT_TYPES,
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
  REGION_SORTS,
  relFor,
  SORT_LABEL,
  withAmenity,
  without,
  withPage,
  withSort,
  withType,
  withUnknown,
  type HubQuery,
  type SearchParams,
} from '@/lib/hub-filters';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { ButtonLink } from '@/components/button';

// CAMP-71, level 2: the region hub. Shared by /camping/{c}/{r},
// /camping/{c}/{r}/page/{n} and /camping/{c}/{r}/filter?… so the first
// page, the rest and the filtered view cannot drift.

export async function regionMeta(country: string, region: string) {
  const all = await getRegions(country);
  return all.find((r) => r.slug === region) ?? null;
}

export default async function RegionListing({
  country,
  region,
  page,
  searchParams,
}: {
  country: string;
  region: string;
  page: number;
  /**
   * The filter route's query string, as Next hands it over. The static
   * routes pass nothing; the page number always comes from `page`.
   */
  searchParams?: SearchParams;
}) {
  const q: HubQuery = { ...parseHubQuery(searchParams ?? {}), page };
  const meta = await regionMeta(country, region);
  const data = await getRegionSpots(country, region, page, apiSearch(q));
  if (!meta || !data.region) notFound();

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

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: `Campsites in ${data.region}`,
            description: `${data.total} campsites in ${data.region}, ${cName}.`,
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
            { name: data.region as string, path: base },
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
          <li aria-current="page">{data.region}</li>
        </ol>
      </nav>

      <h1 className="mt-4 text-3xl font-bold md:text-[42px]">
        Campsites in {data.region}
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        {data.total} {data.total === 1 ? 'site' : 'sites'} in {data.region},{' '}
        {cName}
        {pages > 1 && ` — page ${page} of ${pages}`}.
      </p>

      <HubFilters base={base} q={q} data={data} />

      {empty ? (
        <EmptyResult
          base={base}
          q={q}
          data={data}
          region={data.region as string}
          country={country}
          cName={cName}
        />
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((s) => (
            <SpotListCard
              key={s.slug}
              spot={s}
              href={`/camping/${country}/${region}/${s.slug}`}
            />
          ))}
        </ul>
      )}

      {pages > 1 &&
        (hasState(q) ? (
          <FilteredPagination base={base} q={q} pages={pages} />
        ) : (
          <Pagination base={base} page={page} pages={pages} />
        ))}

      <RegionNeighbours
        country={country}
        current={region}
        cName={cName}
      />

    </main>
  );
}

/**
 * Screen 2 of the hubs mock-up: Type, Facilities, "N sites match · clear
 * filters", sort. Every control is a link (see hub-filters.ts).
 *
 * 🔴 NOT a `<ul>`. The crawl test walks `main ul li a` to the first
 * campsite; a list of filter links above the cards would be the first
 * thing it clicked. The pills sit in a `<nav>` of plain anchors.
 *
 * Counts are the API's facets — how many a reader would see after
 * choosing that chip — and are drawn only when the API sent them.
 *
 * 🔴 Every link INTO `/filter?…` carries `rel="nofollow"` — see `relFor`
 * in hub-filters.ts for why that, and not robots.txt. Links back to the
 * static region stay plain.
 */
function HubFilters({
  base,
  q,
  data,
}: {
  base: string;
  q: HubQuery;
  data: RegionListingData;
}) {
  const matched = data.matched;
  const unknown = data.unknownExcluded ?? 0;
  const facets = data.facets;

  return (
    <nav
      aria-label="Filter campsites"
      className="mt-6 grid gap-3.5 rounded-card border border-line-2 bg-surface p-4"
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.1em] text-ink-3">
          Type
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {SPOT_TYPES.map((t) => {
            const on = q.types.includes(t);
            return (
              <Chip
                key={t}
                href={hubHref(base, withType(q, t))}
                on={on}
                count={facets?.types[t]}
              >
                {SPOT_TYPE_LABEL_SHORT[t]}
              </Chip>
            );
          })}
        </div>
      </div>
      <hr className="border-line-2" />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.1em] text-ink-3">
          Facilities
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {AMENITY_KEYS.map((k) => {
            const on = q.amenities.includes(k);
            return (
              <Chip
                key={k}
                href={hubHref(base, withAmenity(q, k))}
                on={on}
                count={facets?.amenities[k]}
              >
                {AMENITY_LABEL_SHORT[k]}
              </Chip>
            );
          })}
        </div>
      </div>
      <hr className="border-line-2" />
      <div className="flex flex-wrap items-center justify-between gap-2.5 text-sm text-ink-2">
        {isFiltering(q) && matched !== undefined ? (
          <p data-hub-match>
            <b className="text-heading tabular-nums">{matched}</b>{' '}
            {matched === 1 ? 'site matches' : 'sites match'}
            {unknown > 0 && !q.includeUnknown && (
              <>
                {' · '}
                {unknown} more where nobody recorded {amenityList(q)} —{' '}
                <Link
                  href={hubHref(base, withUnknown(q, true))}
                  rel="nofollow"
                  className="text-line-blue underline"
                >
                  include them
                </Link>
              </>
            )}
            {q.includeUnknown && (
              <>
                {' · '}
                <Link
                  href={hubHref(base, withUnknown(q, false))}
                  rel="nofollow"
                  className="text-line-blue underline"
                >
                  only recorded
                </Link>
              </>
            )}
            {' · '}
            <Link href={base} className="text-line-blue underline">
              clear filters
            </Link>
          </p>
        ) : (
          <p>Every site in the region</p>
        )}
        <p>
          Sort:{' '}
          {REGION_SORTS.map((s, i) => (
            <span key={s}>
              {i > 0 && ' · '}
              {s === q.sort ? (
                <b aria-current="true" className="text-heading">
                  {SORT_LABEL[s]}
                </b>
              ) : (
                <Link
                  href={hubHref(base, withSort(q, s))}
                  rel="nofollow"
                  className="underline hover:text-heading"
                >
                  {SORT_LABEL[s]}
                </Link>
              )}
            </span>
          ))}
        </p>
      </div>
    </nav>
  );
}

function Chip({
  href,
  on,
  count,
  children,
}: {
  href: string;
  on: boolean;
  count: number | undefined;
  children: React.ReactNode;
}) {
  return (
    <ButtonLink
      href={href}
      rel={relFor(href)}
      variant={on ? 'accent' : 'chip'}
      size="sm"
      aria-current={on ? 'true' : undefined}
    >
      {children}
      {count !== undefined && (
        <>
          {' '}
          <span className="font-mono text-xs text-ink-2 tabular-nums">
            {count}
          </span>
        </>
      )}
    </ButtonLink>
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
      <h2 id="no-match" className="text-xl font-bold">
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
              rel="nofollow"
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

function SpotListCard({ spot, href }: { spot: SpotCard; href: string }) {
  // Only what is actually recorded. A card that prints five grey icons for
  // five unknown amenities says "we know nothing" five times; one honest
  // line says it once and leaves room for what we do know.
  const known = AMENITY_KEYS.map(
    (k) => [k, AMENITY_LABEL_SHORT[k]] as const,
  ).filter(([k]) => spot.amenities?.[k] === 'yes');

  return (
    <li className="rounded-card border border-line-2 bg-surface p-4 shadow-card">
      <Link href={href} className="font-semibold text-heading hover:underline">
        {spot.name ?? SPOT_TYPE_LABEL[spot.type]}
      </Link>
      <p className="mt-1 text-sm text-ink-2">{SPOT_TYPE_LABEL[spot.type]}</p>
      {known.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {known.map(([k, label]) => (
            <li
              key={k}
              className="rounded-xs border border-ok/50 bg-ok/10 px-2 py-0.5 text-xs text-heading"
            >
              {label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-2">Facilities not recorded</p>
      )}
    </li>
  );
}

/**
 * Plain links, no JavaScript — the card's criterion is an unaided crawl,
 * and a paginator built on a click handler is invisible to it.
 */
function Pagination({
  base,
  page,
  pages,
}: {
  base: string;
  page: number;
  pages: number;
}) {
  const href = (n: number) => (n === 1 ? base : `${base}/page/${n}`);
  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap gap-x-2 gap-y-3">
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <ButtonLink
          key={n}
          href={href(n)}
          aria-current={n === page ? 'page' : undefined} variant={n === page ? 'accent' : 'chip'} size="sm" className="min-w-12 tabular-nums">
          {n}
        </ButtonLink>
      ))}
    </nav>
  );
}

/**
 * The same paginator for a filtered or sorted set, whose pages live in
 * the query string rather than in `/page/N` — those addresses are the
 * unfiltered set's, made by the build. Same markup, same plain links.
 */
function FilteredPagination({
  base,
  q,
  pages,
}: {
  base: string;
  q: HubQuery;
  pages: number;
}) {
  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap gap-x-2 gap-y-3">
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <ButtonLink
          key={n}
          href={hubHref(base, withPage(q, n))}
          rel={relFor(hubHref(base, withPage(q, n)))}
          aria-current={n === q.page ? 'page' : undefined}
          variant={n === q.page ? 'accent' : 'chip'}
          size="sm"
          className="min-w-12 tabular-nums"
        >
          {n}
        </ButtonLink>
      ))}
    </nav>
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
      <h2 className="text-xl font-bold md:text-[25px]">
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
