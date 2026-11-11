import type { Metadata } from "next";
import Link from "next/link";
import { countryName } from "@/lib/api";
import {
  publishableCampsiteCount,
  routesDescription,
} from "@/lib/campsite-count";
import { alternatesFor } from "@/lib/i18n";
import { breadcrumbList, jsonLdProps } from "@/lib/jsonld";
import { routeLibraryGraph } from "@/lib/route-jsonld";
import { SERVICE_KINDS, SERVICE_LABEL } from "@/lib/route-services";
import {
  CAMPSITES_PER_STAGE,
  formatKm,
  formatMonths,
  getRoutes,
  STAGE_RADIUS_M,
  straightLineLabel,
  spelledCount,
} from "@/lib/routes";
import Breadcrumbs from "@/components/breadcrumbs";
import RouteLibrary, { type RouteCard } from "@/components/route-library";
import { Block } from "@/components/layout";
import { LayeredBanner } from "@/components/layered-banner";
import { PageSections } from "@/components/page-sections";
import { pageContent } from "@/lib/page-content";

// CAMP-3 / CAMP-45 — the route library index.
//
// 🔴 Why this page exists at all, in the owner's words: routes are what
// collects search traffic, more than the map. The map is the thing that
// demonstrates the database; a route is the thing somebody actually
// searches for. Until today the site had no /routes at all.

// 🔴 CAMP-308. A function, not a constant, and the difference is a
// number. This `description` said "from our own database of 61 422" —
// measured 27.09.2026, typed in, and read by Google as today's figure for
// every day after. The count is asked for when the page is built, from
// the endpoint the home page uses, and the sentence is made in
// lib/campsite-count.ts, where the choice among the three campsite
// counts is explained and where a test reads the result.
//
// When the API cannot say, the description says nothing about size
// rather than printing a zero — a search result with no number is a
// smaller claim; a search result with the wrong one is a false one.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Camping routes across Europe",
    description: routesDescription(await publishableCampsiteCount()),
    alternates: alternatesFor("/routes"),
  };
}

export default async function RoutesIndex() {
  const routes = await getRoutes();
  // 🔴 КАТАЛОГ МАРШРУТІВ — НАШІ ВЛАСНІ ЗАПИСИ, вступ — CMS. Відмова
  // бази прибирає лише вступ, а не сторінку.
  const page = await pageContent("routes").catch(() => null);

  const cards: RouteCard[] = routes.map((r) => ({
    slug: r.slug,
    name: r.name,
    summary: r.summary,
    region: r.region,
    countries: r.countries,
    countryNames: r.countries.map((c) => countryName(c)),
    days: r.days,
    nights: r.stages.reduce((a, s) => a + s.nights, 0),
    months: r.months,
    monthsLabel: formatMonths(r.months),
    suits: r.suits,
    // 🔴 CAMP-240. The number and its qualifier arrive as ONE string —
    // see `straightLineLabel` for why they are never handed over apart.
    distance: straightLineLabel(r),
  }));
  const stops = routes.reduce((n, r) => n + r.stages.length, 0);

  const crumbs = [
    { name: "CampTribe", path: "/" },
    { name: "Routes", path: "/routes" },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          routeLibraryGraph({
            name: "Camping routes across Europe",
            description:
              "Curated multi-day camping routes through the European Union, each with its stages and the campsites recorded near them.",
            path: "/routes",
            routes: routes.map((r) => ({ name: r.name, slug: r.slug })),
          }),
        )}
      />
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <Breadcrumbs crumbs={crumbs} />

      {/* 🔴 БАНЕР НЕСЕ `h1` (CAMP-459). Той самий хід, що на /tools,
          /about, /contact і /guides: заголовок усередині банера, а не
          продубльований під ним.

          🔴 ЧИСЛО «TWELVE» НЕ ПЕРЕЇХАЛО В БАНЕР. Воно стоїть у реченні
          нижче й рахується там же; переписати його сюди означало б
          завести другу копію числа, яке колись зміниться. Банер каже
          те, що правда завжди. */}
      <LayeredBanner
        headingLevel={1}
        background={{ src: "/banners/eu-dawn.svg" }}
        tickerText="ROUTES"
        heading={page?.title ?? "Camping routes"}
        description={page?.metaDescription ?? undefined}
        minHeight="min(42svh, 340px)"
        textSize={{ desktop: "140px", mobile: "48px" }}
        className="mt-4"
      />

      {/* 🔴 ВСТУП ІЗ CMS, А НЕ З КОДУ (вказівка власника 10.11.2026).
          Текст перенесено ДОСЛІВНО міграцією SeedGuidesRoutesPages —
          переїзд, який заразом «трохи покращує формулювання»,
          неможливо перевірити.

          🔴 ВІДМОВА БАЗИ НЕ КЛАДЕ СТОРІНКУ: каталог маршрутів — наші
          власні записи, і без CMS зникає лише вступ. */}
      {page && (
        <div className="mt-6">
          <PageSections sections={page.sections} />
        </div>
      )}

      <RouteLibrary routes={cards} />

      {/* 🔴 CAMP-240. The design's catalogue ends with a block called "How
          we compose the routes" (04-routes.html, screen 1), and it is
          what this section is for: it tells a reader, and a crawler, what
          stands behind a card. The mockup's version PROMISES things we
          cannot compute — passes checked against the vehicle's size, days
          held to two to four hours at the wheel, an estimated fuel bill —
          and none of those is here. This is the version that is true, and
          every number in it is read from the constant that drives the
          route page, so the two cannot disagree. The two paragraphs that
          used to sit above the list moved down into it: a reader choosing
          a route wants the routes first. */}
      <section aria-labelledby="how-heading" className="mt-12">
        <h2 id="how-heading" className="text-xl md:text-[25px]">
          How these routes are put together
        </h2>
        <Block measure="read" className="mt-4 space-y-4 text-ink-2">
          <p>
            {/* 🔴 The scaled-content position, stated to the reader rather
                than only to ourselves in a code comment. It is also the
                honest answer to "why only twelve".

                🔴 ЧИСЛО РАХУЄТЬСЯ, А НЕ НАБРАНЕ СЛОВОМ. Тут стояло
                «twelve», і збіг тримався лише тому, що маршрути лежали
                файлом. Після CAMP-479 їх додає редактор — і тринадцятий
                зробив би це речення неправдою, не зламавши нічого
                видимого. */}
            There are {spelledCount(routes.length)} rather than fifty on
            purpose. Fifty would mean one template with the place names
            swapped. Each of these has something of its own to say.
          </p>
          <p>
            Every route is written stop by stop: {stops} stops across the{" "}
            {routes.length} routes, and each stop carries the reason it is there
            rather than the next town along. Days and nights are checked to add
            up: a ten-day trip has nine nights.
          </p>
          <p>
            Under each stop on a route page there are up to{" "}
            {CAMPSITES_PER_STAGE} campsites from our database within{" "}
            {formatKm(STAGE_RADIUS_M)} of it, nearest first, and the nearest
            recorded example of each of {SERVICE_KINDS.length} kinds of service:{" "}
            {SERVICE_KINDS.map((k) => SERVICE_LABEL[k].toLowerCase()).join(
              ", ",
            )}
            . That is a selection, not a list of everything in the area. The
            services come from OpenStreetMap alone, so a gap in them is a gap in
            what volunteers have mapped, not necessarily one on the ground.
          </p>
          <p>
            {/* 🔴 The missing numbers, said on the hub as well as on each
                route, because this is where somebody comparing routes
                would look for them. */}
            <strong className="font-semibold text-heading">
              What this page does not show:
            </strong>{" "}
            road distances and driving times, a check of any route against the
            height, width or weight of your vehicle, and what the fuel will
            cost. We would rather leave a figure out than publish one we cannot
            stand behind — so the distance on each card is a straight-line distance:
            the sum of the straight lines between its stops, labelled as exactly
            that. The road is always longer, and on the mountain sections much
            longer. For the part of a budget that can be measured,{" "}
            <Link className="underline" href="/tools/camper-trip-cost">
              the trip cost calculator
            </Link>{" "}
            uses this week&rsquo;s published fuel prices and your own figures.
          </p>
        </Block>
      </section>
    </main>
  );
}
