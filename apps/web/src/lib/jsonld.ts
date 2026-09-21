// CAMP-37: schema.org markup, for search engines and for assistants.
//
// 🔴 Two audiences, one graph. Google turns this into rich results;
// ChatGPT, Perplexity and Gemini use it to understand what the page *is*
// rather than guessing from prose. The owner named assistants a primary
// channel alongside search, so a page without this is only half built.
//
// 🔴 The card asked for `CampingPitch`. That is the wrong type, and the
// vocabulary says so itself: CampingPitch is "an individual place for
// overnight stay in the outdoors, typically being part of a larger
// camping site, or Campground" and descends from Accommodation. Marking
// a whole campsite as a CampingPitch would tell every consumer we are
// describing one pitch. The correct type is `Campground` — "a place used
// for overnight stay in the outdoors, typically containing individual
// CampingPitch locations" — which descends from CivicStructure and
// LodgingBusiness, and it is the LodgingBusiness side that makes
// `amenityFeature` legal on it.
//
// Everything here is validated in CI against the real vocabulary by
// scripts/seo/check-structured-data.mjs, so an invented property fails
// the build rather than quietly doing nothing.

import {
  Amenities,
  countryName,
  formatDistance,
  NearbySpot,
  Spot,
  SPOT_TYPE_LABEL,
  WATER_LABEL,
} from './api';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://camptribe.eu';

export const abs = (path: string) => `${SITE}${path}`;

export interface Crumb {
  name: string;
  path: string;
}

/**
 * Breadcrumbs as a graph, mirroring the ones on screen.
 *
 * `position` must start at 1 and increase without gaps — Google drops the
 * whole list otherwise, silently. The CI validator checks it because the
 * failure mode is invisible on the page itself.
 */
export function breadcrumbList(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.path),
    })),
  };
}

/**
 * Amenities as LocationFeatureSpecification.
 *
 * 🔴 An unknown amenity is OMITTED, never emitted as `value: false`. The
 * tri-state from CAMP-27 exists precisely because "nobody recorded a
 * shower" is not "there is no shower", and publishing the second as
 * machine-readable fact would put a false claim about a real business
 * into Google's index and into every assistant that reads it. Silence is
 * the honest encoding of not knowing.
 */
function amenityFeatures(amenities: Amenities) {
  const labels: [keyof Amenities, string][] = [
    ['electricity', 'Electricity'],
    ['water', 'Drinking water'],
    ['shower', 'Showers'],
    ['dogFriendly', 'Dogs allowed'],
    ['wifi', 'Wi-Fi'],
  ];
  return labels
    .filter(([key]) => amenities?.[key] === 'yes' || amenities?.[key] === 'no')
    .map(([key, name]) => ({
      '@type': 'LocationFeatureSpecification',
      name,
      value: amenities[key] === 'yes',
    }));
}

/** The prose sentence, reused so the graph and the page cannot disagree. */
function contextSentence(spot: Spot): string | undefined {
  const c = spot.context ?? {};
  const bits: string[] = [];
  if (c.elevation !== undefined) bits.push(`${c.elevation} m above sea level`);
  if (c.water) {
    bits.push(
      `${formatDistance(c.water.m)} from ${
        c.water.name ?? WATER_LABEL[c.water.kind].toLowerCase()
      }`,
    );
  }
  if (c.town) {
    bits.push(`${formatDistance(c.town.m)} from ${c.town.name ?? 'the nearest town'}`);
  }
  if (c.station) {
    bits.push(
      `${formatDistance(c.station.m)} from ${
        c.station.name ? `${c.station.name} station` : 'a railway station'
      }`,
    );
  }
  return bits.length ? `${SPOT_TYPE_LABEL[spot.type]}, ${bits.join(', ')}.` : undefined;
}

export function campgroundGraph(
  spot: Spot,
  path: string,
  nearby: NearbySpot[],
) {
  const c = spot.context ?? {};
  const name = spot.name ?? `${SPOT_TYPE_LABEL[spot.type]} near ${spot.region}`;

  const geo: Record<string, unknown> = {
    '@type': 'GeoCoordinates',
    latitude: spot.lat,
    longitude: spot.lon,
  };
  // `elevation` is a GeoCoordinates property, not a Place one — putting it
  // on the Campground would be rejected by the validator.
  if (c.elevation !== undefined) geo.elevation = `${c.elevation} m`;

  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Campground',
    '@id': `${abs(path)}#campground`,
    name,
    url: abs(path),
    geo,
    address: {
      '@type': 'PostalAddress',
      addressCountry: spot.country.toUpperCase(),
      ...(spot.region ? { addressRegion: spot.region } : {}),
    },
    // Both are true of every site in this dataset: they are public
    // campsites in OpenStreetMap, not private land.
    publicAccess: true,
  };

  const description = contextSentence(spot);
  if (description) node.description = description;

  const features = amenityFeatures(spot.amenities);
  if (features.length) node.amenityFeature = features;

  // Only claimed where the data actually says so. `free` and `wild` are
  // the two types that carry no fee; for the rest we do not know the
  // price, so we say nothing rather than implying one.
  if (spot.type === 'free' || spot.type === 'wild') {
    node.isAccessibleForFree = true;
  }

  // 🔴 No `aggregateRating` and no `review`. We have no reviews at all
  // (CAMP-53), and inventing rating markup is the single fastest way to
  // earn a manual action from Google — quite apart from being a lie.

  if (nearby.length) {
    node.containedInPlace = {
      '@type': 'Place',
      name: `${spot.region}, ${countryName(spot.country)}`,
    };
  }

  return node;
}

/** A hub: the page itself, plus the list of things it links to. */
export function collectionGraph(opts: {
  name: string;
  description: string;
  path: string;
  items: { name: string; path: string }[];
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
      numberOfItems: opts.items.length,
      itemListElement: opts.items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        url: abs(it.path),
      })),
    },
  };
}

/** One <script> tag's worth of JSON, escaped for embedding in HTML. */
export function jsonLdProps(doc: unknown) {
  return {
    type: 'application/ld+json',
    // `</script>` inside a string would end the tag early. React escapes
    // nothing inside dangerouslySetInnerHTML, so this is ours to do.
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(doc).replace(/</g, '\\u003c'),
    },
  } as const;
}
