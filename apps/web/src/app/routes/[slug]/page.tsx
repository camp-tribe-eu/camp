import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { countryName, SPOT_TYPE_LABEL, type Spot } from '@/lib/api';
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
} from '@/lib/routes';
import { TRAVELLER_LABEL } from '@/lib/route-types';
import {
  getRouteServices,
  routeFuelPrices,
  SERVICE_KINDS,
} from '@/lib/route-services';
import RouteCampsites from '@/components/route-campsites';
import RouteFigures from '@/components/route-figures';
import RouteMapEmbed from '@/components/route-map-embed';
import RouteSources, { type RouteSourceEntry } from '@/components/route-sources';
import RouteStageServices, {
  RouteFuelPrices,
} from '@/components/route-services';
import { Block } from '@/components/layout';

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
 * 🔴 CAMP-479: МЕЖА БІЛЬШЕ НЕ У ФАЙЛІ, А В ТАБЛИЦІ. Раніше тут стояло
 * «обмежено файлом у репозиторії, тож без правки руками не виросте».
 * Тепер маршрути в базі, і зростання обмежує лише те, скільки їх завів
 * редактор. Це свідомий обмін: власник отримав можливість додати
 * маршрут без розробника, а ми втратили стелю, яку давав код.
 */
export async function generateStaticParams(): Promise<Params[]> {
  return (await getRoutes()).map((r) => ({ slug: r.slug }));
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const route = await getRoute(slug);
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

export default async function RoutePage(props: { params: Promise<Params> }) {
  const { slug } = await props.params;
  const route = await getRoute(slug);
  if (!route) notFound();

  // CAMP-113: the services block is fetched ALONGSIDE the campsites, not
  // after them. Both are one request for the whole page and neither
  // needs the other, so a serial await would add the slower one's
  // latency to every page in the build for nothing.
  const [neighbours, measured, services] = await Promise.all([
    getRouteNeighbours(route),
    measureRoute(route),
    getRouteServices(route),
  ]);

  const path = `/routes/${slug}`;
  const allSpots = neighbours.groups.flatMap((g) => g.spots);
  // 🔴 CAMP-463: кожен запис джерела несе назву кемпінгу, якого він
  // стосується, — читач бачить «Camping X — 17 November 2024», а не URL.
  const allSources: RouteSourceEntry[] = allSpots.flatMap((s) =>
    (s.sources ?? []).map((src) => ({ ...src, spotName: s.name ?? null })),
  );
  const serviceCount = services.groups.reduce(
    (n, g) => n + g.services.length,
    0,
  );
  const fuelPrices = routeFuelPrices(route);

  // CAMP-154: the moment every station price on this page is dated
  // against. 🔴 Read ONCE, here, and passed down — not called inside the
  // components. The site is a static export, so this is the build's
  // clock, and a component that read it for itself would date two
  // stages of the same page against two different instants. It is also
  // what makes `route-fuel.spec.tsx` able to test the staleness wording
  // at all.
  const builtAt = new Date();

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

      {/* 🔴 CAMP-459: шапка — читальна колонка. Заголовок на 42px,
          розтягнутий на 1652, і підводка на 840 під ним починали рядок
          у різних місцях; тепер обидва в одній колонці. Широкі блоки
          нижче (цифри, мапа, етапи) лишаються на всю ширину — рішення
          приймається ПО СЕКЦІЯХ, а не одним класом на сторінку. */}
      <header className="mx-auto mt-4 max-w-read">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
          {route.countries.map((c) => countryName(c)).join(' · ')}
        </p>
        <h1 className="mt-2 text-3xl leading-tight md:text-[42px]">
          {route.name}
        </h1>
        <Block as="p" measure="read" className="mt-3 text-lg leading-7 text-ink-2">
          {route.summary}
        </Block>
      </header>

      <RouteFigures
        days={route.days}
        nights={measured.nights}
        stages={route.stages.length}
        straightLineTotal={measured.straightLineTotal}
        road={measured.road}
      />

      <section aria-labelledby="map-heading" className="mt-10">
        <h2 id="map-heading" className="text-xl md:text-[25px]">
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

      {/* 🔴 CAMP-459: уся секція — читальна колонка, бо весь її вміст
          читальний: заголовок, два абзаци і словник «кому підходить».
          Заміряно на проді (вікно 1700): `h2` займав 1652, а тіло й
          `dl` — по 840 і притиснуті вліво. Тепер вони рухаються разом,
          як `.shopify-policy__container` у темі. */}
      <section aria-labelledby="about-heading" className="mx-auto mt-10 max-w-read">
        <h2 id="about-heading" className="text-xl md:text-[25px]">
          What this route is for
        </h2>
        <Block measure="read" className="mt-4 space-y-4 leading-7 text-ink-2">
          {route.intro.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </Block>

        <Block as="dl" measure="read" className="mt-6 space-y-4 text-sm leading-6">
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
        </Block>
      </section>

      <section aria-labelledby="stages-heading" className="mt-12">
        <h2 id="stages-heading" className="text-xl md:text-[25px]">
          The stages
        </h2>
        <Block as="p" measure="read" className="mt-2 text-sm text-ink-2">
          {/* 🔴 The selection rule, on the page. It is the ODbL Produced
              Work boundary and it is also simply useful: a reader should
              know this is a sample and not a listing. */}
          Each stop shows up to {CAMPSITES_PER_STAGE} campsites from our
          database within {formatKm(STAGE_RADIUS_M)} of it, nearest first, and
          the nearest single example of each of {SERVICE_KINDS.length} kinds of
          service. That is a selection, not a list of everything in the area —
          and the distances below are straight-line, like everything else on
          this page.
        </Block>

        {/* CAMP-113. Route level, not station level — the Commission
            publishes one price per country per week, and putting it
            beside a named pump would be a claim about that pump. */}
        <RouteFuelPrices prices={fuelPrices} />

        <ol className="mt-6 space-y-8">
          {route.stages.map((stage, i) => {
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
                    <h3 className="text-lg text-heading">
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
                  <Block as="p" measure="read" className="leading-7 text-ink-2">{stage.why}</Block>

                  {stage.pois && stage.pois.length > 0 && (
                    <Block as="ul" measure="read" className="mt-3 space-y-1 text-sm text-ink-2">
                      {stage.pois.map((poi) => (
                        <li key={poi.name}>
                          <span className="font-semibold text-heading">
                            {poi.name}
                          </span>{' '}
                          — {poi.what}
                        </li>
                      ))}
                    </Block>
                  )}

                  {/* CAMP-160: three states — the list, "we looked and hold
                      none", and "we could not look". The last two are
                      different statements and must never share a
                      sentence. See components/route-campsites.tsx. */}
                  <RouteCampsites
                    group={neighbours.groups[i]}
                    looked={neighbours.looked}
                  />

                  {/* CAMP-113 — fuel, charging, water, a disposal point,
                      a shop, a meal and a roof. Every kind is listed at
                      every stage, including the ones we hold nothing
                      for. */}
                  <RouteStageServices
                    group={services.groups[i]}
                    looked={services.looked}
                    now={builtAt}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <RouteSources
        sources={allSources}
        campsiteCount={allSpots.length}
        serviceCount={serviceCount}
        note={route.attribution}
      />

      {/* Під тією ж колонкою, що й секція джерел над ним: інакше
          підпис зʼїжджає з-під рамки, до якої належить. */}
      <p className="mx-auto mt-6 max-w-read text-xs text-ink-2">
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
