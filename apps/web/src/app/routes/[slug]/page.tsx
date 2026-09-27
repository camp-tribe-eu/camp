import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  countryName,
  formatDistance,
  SPOT_TYPE_LABEL,
  type Spot,
} from '@/lib/api';
import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { routeTripGraph } from '@/lib/route-jsonld';
import {
  CAMPSITES_PER_STAGE,
  formatKm,
  formatMonths,
  getRoute,
  getRouteNeighbours,
  getRoutes,
  measureRoute,
  STAGE_RADIUS_M,
  STRAIGHT_LINE_LABEL,
  type RouteNeighbour,
} from '@/lib/routes';
import { TRAVELLER_LABEL } from '@/lib/route-types';
import type { SpotSource } from '@/lib/sources';
import RouteFigures from '@/components/route-figures';
import RouteMapEmbed from '@/components/route-map-embed';
import RouteSources from '@/components/route-sources';

// CAMP-3 / CAMP-45 — one curated route.
//
// 🔴 What is deliberately NOT on this page, and why it is not an
// oversight: road distance, driving time, fuel cost, or anything derived
// from them. All four need a routing engine we host (CAMP-42, blocked on
// CAMP-99), and the empty slots that say so are rendered by
// components/route-figures.tsx. See lib/route-geometry.ts for the single
// change that fills them.

type Params = { slug: string };

// 🔴 False, for the same reason the campsite pages set it: an unknown
// slug rendered on demand calls notFound() and Next answers with its
// client-side error shell, which is real HTML to nobody who does not run
// JavaScript. With `false` it falls through to the prerendered 404. We
// know every route at build time — they are a file in this repository —
// so nothing is lost.
export const dynamicParams = false;

/**
 * 🔴 Build cost, measured rather than asserted.
 *
 * Twelve routes, so twelve pages, against the 65 435 the site already
 * generates — an increase of about 0.02%. Each page makes exactly ONE
 * API call (`/routes/near` takes every stage's coordinates at once), so
 * the section adds twelve requests to a build that already makes tens of
 * thousands. The query behind that call is an index walk measured at
 * 27 ms for a whole seven-stage route.
 *
 * This is bounded by a file in the repository, not by the database, so
 * it cannot grow without somebody writing a route by hand.
 */
export function generateStaticParams(): Params[] {
  return getRoutes().map((r) => ({ slug: r.slug }));
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const route = getRoute(slug);
  if (!route) return { title: 'Route not found' };

  return {
    title: `${route.name} — ${route.days}-day camping route`,
    // The route's own summary, which is written per route and shares no
    // sentence with any other. A description assembled from the template
    // would be the same line twelve times with the place swapped, which
    // is what the near-duplicate guard exists to catch.
    description: route.summary,
    alternates: alternatesFor(`/routes/${slug}`),
  };
}

/** One campsite in the list beside a stage. */
function SpotLink({ spot }: { spot: RouteNeighbour }) {
  const label = SPOT_TYPE_LABEL[spot.type as Spot['type']] ?? 'Campsite';
  // 🔴 26% of campsites in OpenStreetMap carry no name at all. Saying so
  // is the honest rendering; inventing one is not, and dropping them
  // would remove a quarter of the map.
  const name = spot.name ?? `Unnamed ${label.toLowerCase()}`;

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm leading-6">
      {/* 🔴 A campsite with no region has no page (canonicalPath returns
          null). It is still shown — it is a real place near this stop —
          but it is NOT linked, because a link that promises a page and
          lands on a 404 is worse than no link. */}
      {spot.path ? (
        <Link href={spot.path} className="font-semibold text-heading underline">
          {name}
        </Link>
      ) : (
        <span className="font-semibold text-heading">{name}</span>
      )}
      <span className="text-ink-2">
        {label} ·{' '}
        <span>
          {formatDistance(spot.metres)} away {STRAIGHT_LINE_LABEL}
        </span>
      </span>
    </li>
  );
}

export default async function RoutePage(props: { params: Promise<Params> }) {
  const { slug } = await props.params;
  const route = getRoute(slug);
  if (!route) notFound();

  const [neighbours, measured] = await Promise.all([
    getRouteNeighbours(route),
    measureRoute(route),
  ]);

  const path = `/routes/${slug}`;
  const allSpots = neighbours.flatMap((g) => g.spots);
  const allSources: SpotSource[] = allSpots.flatMap((s) => s.sources ?? []);

  const crumbs = [
    { name: 'CampTribe', path: '/' },
    { name: 'Routes', path: '/routes' },
    { name: route.name, path },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      {/* Two blocks rather than one @graph: a breakage in one does not
          take the other down with it. */}
      <script {...jsonLdProps(routeTripGraph(route, path))} />
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link href="/routes" className="underline">
          Routes
        </Link>
        <span aria-hidden="true"> / </span>
        <span>{route.region}</span>
      </nav>

      <header className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
          {route.countries.map((c) => countryName(c)).join(' · ')}
        </p>
        <h1 className="mt-2 text-3xl font-bold leading-tight md:text-[42px]">
          {route.name}
        </h1>
        <p className="mt-3 max-w-prose text-lg leading-7 text-ink-2">
          {route.summary}
        </p>
      </header>

      <RouteFigures
        days={route.days}
        nights={measured.nights}
        stages={route.stages.length}
        straightLineTotal={measured.straightLineTotal}
        road={measured.road}
      />

      <section aria-labelledby="map-heading" className="mt-10">
        <h2 id="map-heading" className="text-xl font-bold md:text-[25px]">
          The route
        </h2>
        <RouteMapEmbed
          stages={route.stages.map((s) => ({
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            nights: s.nights,
          }))}
          spots={allSpots.map((s) => ({
            name: s.name,
            href: s.path ?? '',
            lat: s.lat,
            lon: s.lon,
            typeLabel: SPOT_TYPE_LABEL[s.type as Spot['type']] ?? 'Campsite',
            metres: s.metres,
          }))}
          // 🔴 Undefined until a routing engine exists. This is the prop
          // that carries the road line; see lib/route-geometry.ts.
          road={
            measured.road.available ? measured.road.geometry.line : undefined
          }
        />
      </section>

      <section aria-labelledby="about-heading" className="mt-10">
        <h2 id="about-heading" className="text-xl font-bold md:text-[25px]">
          What this route is for
        </h2>
        <div className="mt-4 max-w-prose space-y-4 leading-7 text-ink-2">
          {route.intro.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <dl className="mt-6 max-w-prose space-y-4 text-sm leading-6">
          <div>
            <dt className="font-semibold text-heading">Best months</dt>
            <dd className="text-ink-2">
              {formatMonths(route.months)}. {route.seasonNote}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-heading">The driving</dt>
            <dd className="text-ink-2">{route.roads}</dd>
          </div>
          <div>
            <dt className="font-semibold text-heading">Who it suits</dt>
            <dd className="text-ink-2">
              {route.suits.map((t) => TRAVELLER_LABEL[t]).join(', ')}.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="stages-heading" className="mt-12">
        <h2 id="stages-heading" className="text-xl font-bold md:text-[25px]">
          The stages
        </h2>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          {/* 🔴 The selection rule, on the page. It is the ODbL Produced
              Work boundary and it is also simply useful: a reader should
              know this is a sample and not a listing. */}
          Each stop shows up to {CAMPSITES_PER_STAGE} campsites from our
          database within {formatKm(STAGE_RADIUS_M)} of it, nearest first. That
          is a selection, not a list of everything in the area — and the
          distances below are straight-line, like everything else on this page.
        </p>

        <ol className="mt-6 space-y-8">
          {route.stages.map((stage, i) => {
            const group = neighbours[i];
            const spots = group?.spots ?? [];
            const legFrom = i > 0 ? measured.legs[i - 1] : null;

            return (
              <li key={stage.name} className="relative">
                <div className="flex items-baseline gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-btn text-sm font-bold text-btn-ink"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-heading">
                      {stage.name}
                    </h3>
                    <p className="text-xs text-ink-2">
                      {stage.nights} {stage.nights === 1 ? 'night' : 'nights'}
                      {legFrom !== null && (
                        <>
                          {' · '}
                          {formatKm(legFrom)} from the previous stop{' '}
                          {STRAIGHT_LINE_LABEL}
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-3 pl-11">
                  <p className="max-w-prose leading-7 text-ink-2">{stage.why}</p>

                  {stage.pois && stage.pois.length > 0 && (
                    <ul className="mt-3 max-w-prose space-y-1 text-sm text-ink-2">
                      {stage.pois.map((poi) => (
                        <li key={poi.name}>
                          <span className="font-semibold text-heading">
                            {poi.name}
                          </span>{' '}
                          — {poi.what}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
                      Campsites near this stop
                    </h4>
                    {spots.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {spots.map((s) => (
                          <SpotLink key={s.slug} spot={s} />
                        ))}
                      </ul>
                    ) : (
                      // 🔴 An empty stage is stated, never hidden. "We
                      // have nothing within 25 km" is a real and useful
                      // fact — and it is a different statement from
                      // "there is nothing here", which we cannot make.
                      <p
                        className="mt-2 max-w-prose text-sm text-ink-2"
                        data-testid="stage-no-campsites"
                      >
                        Our database holds no campsite within{' '}
                        {formatKm(STAGE_RADIUS_M)} of this stop. That is a gap
                        in what has been recorded, not a statement that nothing
                        is there.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <RouteSources
        sources={allSources}
        campsiteCount={allSpots.length}
        note={route.attribution}
      />

      <p className="mt-6 text-xs text-ink-2">
        Route last reviewed by a person on{' '}
        <time dateTime={route.curatedAt}>
          {new Date(route.curatedAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </time>
        .
      </p>
    </main>
  );
}
