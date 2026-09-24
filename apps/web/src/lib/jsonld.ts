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
  AMENITY_KEYS,
  AMENITY_LABEL,
  countryName,
  formatDistance,
  NearbySpot,
  Spot,
  SPOT_TYPE_LABEL,
  TERRAIN_LABEL,
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
  return AMENITY_KEYS.map((key) => [key, AMENITY_LABEL[key]] as const)
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

/**
 * CAMP-114: the measured surroundings, as machine-readable values.
 *
 * 🔴 This is the one block a competitor cannot copy, because none of them
 * compute it. Measured 24.09.2026 (CAMP-109): Pitchup publishes 34 JSON-LD
 * blocks to our 1, but not one of them says how far the water is. Ours are
 * numbers we calculated from geometry, so they belong in the graph as
 * numbers — an assistant asked "campsites within 500 m of a lake" can
 * answer from this and cannot answer from prose.
 *
 * `additionalProperty` is legal here because Campground descends from
 * Place, which is where schema.org defines it — checked against the
 * vocabulary index, not assumed. `unitCode` is UN/CEFACT: MTR is metres.
 *
 * Every entry is omitted when the measurement is absent. There is no
 * "0 m to the sea" for a site nowhere near it: not knowing is not zero,
 * the same rule the amenities follow.
 */
export function surroundingProperties(spot: Spot) {
  const c = spot.context ?? {};
  const out: Record<string, unknown>[] = [];
  const metres = (name: string, value: number) => ({
    '@type': 'PropertyValue',
    name,
    value,
    unitCode: 'MTR',
  });

  if (c.water) {
    out.push(
      metres(
        `Distance to ${c.water.name ?? WATER_LABEL[c.water.kind].toLowerCase()}`,
        c.water.m,
      ),
    );
  }
  if (c.town) out.push(metres(`Distance to ${c.town.name ?? 'the nearest town'}`, c.town.m));
  if (c.supermarket) out.push(metres('Distance to the nearest supermarket', c.supermarket.m));
  if (c.station) {
    out.push(
      metres(
        `Distance to ${c.station.name ? `${c.station.name} station` : 'the nearest railway station'}`,
        c.station.m,
      ),
    );
  }
  if (c.elevation !== undefined) out.push(metres('Elevation above sea level', c.elevation));
  if (c.terrain) {
    out.push(metres(`Relief within 1 km (${TERRAIN_LABEL[c.terrain.type].toLowerCase()})`, c.terrain.relief));
  }
  return out;
}

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * CAMP-114: the questions our own data answers, and only those.
 *
 * 🔴 Exported so the page renders exactly this list. Google's FAQ policy
 * requires the answer to be visible on the page, and beyond the policy it
 * is the honest arrangement: markup that says something the page does not
 * is a claim made only to machines.
 *
 * ⚠️ Not for rich results. Google restricted FAQ rich snippets to
 * government and health sites in August 2023, so nothing here will draw a
 * dropdown in search. It is here for the assistants — the channel the
 * owner named alongside search — which read the graph directly.
 *
 * 🔴 The questions are NEUTRAL, never yes/no. "Is there water nearby?"
 * answered "Yes" is a lie at 8 km and the truth at 80 m, and the markup
 * cannot tell which it is. "How far is the nearest water?" is true at
 * every distance, because the answer carries the number.
 */
export function campsiteFaq(spot: Spot): FaqItem[] {
  const c = spot.context ?? {};
  const name = spot.name ?? `this ${SPOT_TYPE_LABEL[spot.type].toLowerCase()}`;
  const items: FaqItem[] = [];

  if (c.water) {
    const what = c.water.name ?? WATER_LABEL[c.water.kind].toLowerCase();
    items.push({
      q: `How far is the nearest water from ${name}?`,
      a: `${formatDistance(c.water.m)} to ${what}, measured straight-line from the centre of the site. The walk or drive will be longer.`,
    });
  }
  if (c.town) {
    items.push({
      q: `How far is the nearest town?`,
      a: `${c.town.name ?? 'The nearest town'} is ${formatDistance(c.town.m)} away in a straight line.`,
    });
  }
  if (c.supermarket) {
    items.push({
      q: `Where can you buy food nearby?`,
      a: `The nearest supermarket is ${formatDistance(c.supermarket.m)} away in a straight line.`,
    });
  }
  if (c.station) {
    items.push({
      q: `Can you reach it without a car?`,
      a: `${c.station.name ? `${c.station.name} station` : 'The nearest railway station'} is ${formatDistance(c.station.m)} away in a straight line. We do not know whether a bus or a path connects the two.`,
    });
  }
  if (c.elevation !== undefined || c.terrain) {
    const bits: string[] = [];
    if (c.elevation !== undefined) bits.push(`${c.elevation} m above sea level`);
    if (c.terrain) {
      bits.push(
        `${TERRAIN_LABEL[c.terrain.type].toLowerCase()} ground, ${c.terrain.relief} m of relief within a kilometre`,
      );
    }
    items.push({
      q: `How high is it, and what is the ground like?`,
      a: `${bits.join('; ')}.`,
    });
  }

  // Facilities, from the tri-state — and both halves of it. A recorded
  // "no" is as useful to a reader as a recorded "yes", and the gap
  // between them is the thing this site exists to show.
  const yes = AMENITY_KEYS.filter((k) => spot.amenities?.[k] === 'yes');
  const no = AMENITY_KEYS.filter((k) => spot.amenities?.[k] === 'no');
  if (yes.length || no.length) {
    const said: string[] = [];
    // The labels are used exactly as the page prints them. Lower-casing
    // them turned "Wi-Fi" into "wi-fi" — a small thing, but the answer is
    // quoted verbatim by assistants, and a name we mangled is a name we
    // got wrong.
    if (yes.length) said.push(`recorded as present: ${yes.map((k) => AMENITY_LABEL[k]).join(', ')}`);
    if (no.length) said.push(`recorded as absent: ${no.map((k) => AMENITY_LABEL[k]).join(', ')}`);
    const unknown = AMENITY_KEYS.length - yes.length - no.length;
    items.push({
      q: `What facilities are recorded?`,
      a: `${said.join('. ')}. ${
        unknown > 0
          ? `The remaining ${unknown} of ${AMENITY_KEYS.length} have not been recorded by anyone — that is a gap in the data, not a statement that they are missing.`
          : `All ${AMENITY_KEYS.length} we track have been recorded.`
      }`,
    });
  }

  if (spot.type === 'free' || spot.type === 'wild') {
    items.push({
      q: `Does it cost anything?`,
      a: `It is recorded as a ${SPOT_TYPE_LABEL[spot.type].toLowerCase()}, which carries no fee. Local rules can still forbid staying overnight — check before you rely on it.`,
    });
  }

  if (spot.stars !== null) {
    items.push({
      q: `Is it officially classified?`,
      a: `Yes — ${spot.stars} stars in the national classification published by the authority of ${countryName(spot.country)}. That is somebody else's rating, not ours; we do not rate campsites.`,
    });
  }

  return items;
}

/**
 * The FAQ as a graph, or null when we have nothing to ask.
 *
 * 🔴 Null, not an empty FAQPage. A FAQPage with no questions is a type
 * claiming content that is not there — the exact shape of thing the
 * validator and CAMP-114 both forbid.
 */
export function faqGraph(items: FaqItem[], path: string) {
  if (items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${abs(path)}#faq`,
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
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

  // CAMP-114: the surroundings as numbers, not only as a sentence.
  const measured = surroundingProperties(spot);
  if (measured.length) node.additionalProperty = measured;

  // 🔴 `petsAllowed` only where somebody recorded an answer.
  //
  // It is legal on Campground through LodgingBusiness, and it maps
  // exactly onto one amenity we already hold — so it costs nothing and
  // says something a traveller with a dog is actually searching for.
  // `unknown` emits nothing at all: the tri-state's whole point.
  if (spot.amenities?.dogFriendly === 'yes') node.petsAllowed = true;
  else if (spot.amenities?.dogFriendly === 'no') node.petsAllowed = false;

  // 🔴 Somebody else's classification, marked as a Rating rather than
  // implied by a number. France publishes a 1-5 classement; OpenStreetMap
  // carries none. `author` is deliberately absent — we know a national
  // authority issued it, but not which body, and naming the wrong one
  // would be worse than naming none. We have no opinion about any
  // campsite, and `aggregateRating` stays absent for exactly that reason.
  if (spot.stars !== null && spot.stars !== undefined) {
    node.starRating = {
      '@type': 'Rating',
      ratingValue: spot.stars,
      bestRating: 5,
      worstRating: 1,
    };
  }

  // The operator's own site, where a source gave us one. `sameAs` is the
  // property for "another page that is unambiguously this same thing".
  if (spot.website) node.sameAs = spot.website;

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

/**
 * CAMP-56: a legal page, described for machines.
 *
 * 🔴 It exists because our own guard demanded it — check-structured-data
 * failed the build with "5 page(s) carry no JSON-LD at all", which is
 * exactly what that guard is for. But it earns its place beyond passing:
 * `version` and `datePublished` put the answer to "which text was in
 * force on that date" into a machine-readable field, next to the human
 * one printed on the page.
 *
 * `WebPage` rather than something more specific, because schema.org has
 * no TermsOfService or PrivacyPolicy type — inventing one would fail
 * validation and describe nothing.
 */
export function legalPageGraph(opts: {
  name: string;
  description: string;
  path: string;
  version: string;
  effectiveFrom: string;
  publisher: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${abs(opts.path)}#page`,
    name: opts.name,
    description: opts.description,
    url: abs(opts.path),
    inLanguage: 'en',
    version: opts.version,
    datePublished: opts.effectiveFrom,
    publisher: {
      '@type': 'Organization',
      name: opts.publisher,
      url: SITE,
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
