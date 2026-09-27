// CAMP-3 / CAMP-45: structured data for a curated route.
//
// 🔴 This file is written against the vocabulary index, not against
// memory. `scripts/seo/schema-index.json` holds the real schema.org
// types and the domains of every property, and each decision below was
// checked against it before the line was written. Two of them came back
// negative and changed the design:
//
//   `provider`  is NOT valid on Trip. Its domains are Action,
//               CreativeWork, EducationalOccupationalProgram, Invoice
//               and a few others. This is the same property that was
//               already published as an unknown field on 2 390
//               Campground nodes on this site — the exact mistake,
//               attempted a second time on a different type, caught by
//               looking instead of assuming.
//
//   `duration`  is NOT valid on Trip either. Its domains are Audiobook,
//               Episode, Event, MediaObject, Movie and MusicRecording.
//               So the single most obvious field a route page would
//               want — "this takes ten days" — HAS NO HOME on this
//               type, and it is therefore simply absent from the graph.
//               It is on the page, in words, where it is true and
//               readable. An invented `duration: "P10D"` would validate
//               against nothing and mean nothing.
//
// Also deliberately absent: `arrivalTime` and `departureTime`, which
// are legal on Trip and which we have no values for; a curated route
// has no dates, and emitting today's would be inventing one.

import { abs } from './jsonld';
import type { CuratedRoute } from './route-types';
import { TRAVELLER_LABEL } from './route-types';

/**
 * A curated route as a TouristTrip.
 *
 * 🔴 `itinerary` as an ItemList rather than a bare list of Places,
 * because the order is the whole content of a route — schema.org's own
 * guidance on Trip says to use ItemList exactly when destination order
 * matters. Positions start at 1 and increase without gaps, the same
 * rule the BreadcrumbList validator enforces, because the failure is
 * equally silent.
 *
 * 🔴 NO Campground nodes for the campsites shown beside the stages, and
 * this is a decision rather than an omission.
 *
 * Our validator requires a Campground to carry name, geo, address AND
 * url. A large share of our campsites have no name at all — 26% in the
 * Slovenian sample this codebase measured — so emitting them here would
 * mean either inventing names or silently publishing a graph listing
 * three of the four campsites the page shows. The second is the quieter
 * failure and the worse one: markup that disagrees with the page is a
 * claim made only to machines. Each campsite links to its own page,
 * which carries its own complete Campground node with its own @id, and
 * that is where that entity belongs.
 */
export function routeTripGraph(route: CuratedRoute, path: string) {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    '@id': `${abs(path)}#trip`,
    name: route.name,
    url: abs(path),
    description: route.summary,
    itinerary: {
      '@type': 'ItemList',
      numberOfItems: route.stages.length,
      itemListElement: route.stages.map((stage, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: stage.name,
        item: {
          '@type': 'Place',
          name: stage.name,
          geo: {
            '@type': 'GeoCoordinates',
            latitude: stage.lat,
            longitude: stage.lon,
          },
        },
      })),
    },
  };

  // `touristType` IS valid on TouristTrip (checked: its domains are
  // TouristAttraction, TouristDestination and TouristTrip). Emitted as
  // the same words the page prints, and only when we have any.
  const who = route.suits.map((t) => TRAVELLER_LABEL[t]).filter(Boolean);
  if (who.length) node.touristType = who;

  return node;
}

/**
 * The library index as a CollectionPage.
 *
 * Kept here rather than reusing `collectionGraph` from jsonld.ts for one
 * reason: that helper links items by path, and this page's items are
 * trips rather than pages. The shape is otherwise the same and both are
 * validated by the same CI step.
 */
export function routeLibraryGraph(opts: {
  name: string;
  description: string;
  path: string;
  routes: { name: string; slug: string }[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${abs(opts.path)}#page`,
    name: opts.name,
    description: opts.description,
    url: abs(opts.path),
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.routes.length,
      itemListElement: opts.routes.map((r, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: r.name,
        url: abs(`/routes/${r.slug}`),
      })),
    },
  };
}
