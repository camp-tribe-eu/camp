import type { Metadata } from 'next';
import { countryName } from '@/lib/api';
import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { routeLibraryGraph } from '@/lib/route-jsonld';
import { formatMonths, getRoutes } from '@/lib/routes';
import RouteLibrary, { type RouteCard } from '@/components/route-library';

// CAMP-3 / CAMP-45 — the route library index.
//
// 🔴 Why this page exists at all, in the owner's words: routes are what
// collects search traffic, more than the map. The map is the thing that
// demonstrates the database; a route is the thing somebody actually
// searches for. Until today the site had no /routes at all.

export const metadata: Metadata = {
  title: 'Camping routes across Europe',
  description:
    'Twelve curated camping routes through the EU — the stages, what each one is for, and the real campsites near every stop, from our own database of 61 422.',
  alternates: alternatesFor('/routes'),
};

export default function RoutesIndex() {
  const routes = getRoutes();

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
  }));

  const crumbs = [
    { name: 'CampTribe', path: '/' },
    { name: 'Routes', path: '/routes' },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          routeLibraryGraph({
            name: 'Camping routes across Europe',
            description:
              'Curated multi-day camping routes through the European Union, each with its stages and the campsites recorded near them.',
            path: '/routes',
            routes: routes.map((r) => ({ name: r.name, slug: r.slug })),
          }),
        )}
      />
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
        Camping routes
      </h1>

      <div className="mt-4 max-w-prose space-y-4 text-ink-2">
        <p>
          Twelve routes through the European Union, each one an ordered set of
          stops with the campsites our database actually holds near every stage.
          They are written to be argued with: each says what it is for, when it
          works, what the driving is like, and who it does not suit.
        </p>
        <p>
          {/* 🔴 The scaled-content position, stated to the reader rather
              than only to ourselves in a code comment. It is also the
              honest answer to "why only twelve". */}
          There are twelve rather than fifty on purpose. Fifty would mean one
          template with the place names swapped, which is the fastest way to
          make a site that nobody — and no search engine — has any reason to
          trust. Each of these has something of its own to say.
        </p>
        <p>
          {/* 🔴 The missing numbers, said on the hub as well as on each
              route, because this is where somebody comparing routes
              would look for them. */}
          <strong className="font-semibold text-heading">
            What is not here yet:
          </strong>{' '}
          road distances and driving times. Producing those honestly needs our
          own routing engine, which is not running. We would rather leave the
          figure out than publish one we cannot stand behind, so what you will
          find on each route is the straight-line distance between stops,
          labelled as exactly that.
        </p>
      </div>

      <RouteLibrary routes={cards} />
    </main>
  );
}
