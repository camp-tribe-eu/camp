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
  Spot,
  SPOT_TYPE_LABEL,
  TERRAIN_LABEL,
  WATER_LABEL,
} from './api';
import { DEFAULT_LOCALE } from './i18n';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://camptribe.eu';

/** The brand, as the header, the footer and every <title> already say it. */
const SITE_NAME = 'CampTribe';

export const abs = (path: string) => `${SITE}${path}`;

/**
 * The site and the publisher, addressed by `@id` so that they are one
 * entity across every page that names them rather than a fresh copy per
 * page. Only the campsite pages carry them today; the `@id`s are stable
 * URLs so the hubs and the guides can join the same two nodes without
 * anything here changing.
 *
 * 🔴 `name`, `url`, and nothing else. The footer also carries the legal
 * entity behind the brand; putting it here would publish a corporate
 * relationship into the graph of every campsite page, which is an
 * owner's decision and not a markup one. The rule of this file cuts both
 * ways: we do not invent facts, and we do not volunteer them either.
 */
const WEBSITE_ID = `${SITE}/#website`;
const ORG_ID = `${SITE}/#organization`;

// 🔴 `abs('/')`, not `SITE`. The home page already publishes a WebSite
// under this very `@id` with `url: abs('/')` — a trailing slash. Two
// nodes sharing an `@id` and disagreeing about `url` is one entity with
// two addresses the moment a consumer merges them, which is what an
// `@id` is for.
const publisherNode = () => ({
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE_NAME,
  url: abs('/'),
});

const websiteNode = () => ({
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  name: SITE_NAME,
  url: abs('/'),
  publisher: { '@id': ORG_ID },
});

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
 *
 * `path` is optional and gives the list an `@id`. Only the campsite page
 * needs one — it is what lets the WebPage node point at this list rather
 * than restate it — and a page that does not pass one is unchanged.
 *
 * 🔴 `path !== undefined`, not a truthiness test. `webPageGraph` emits
 * the reference to `#breadcrumb` whenever it is given a path, so an
 * empty-string path made one side emit the reference and the other drop
 * the `@id` — a dangling pointer produced by two functions disagreeing
 * about what counts as "no path".
 */
export function breadcrumbList(crumbs: Crumb[], path?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    ...(path !== undefined ? { '@id': `${abs(path)}#breadcrumb` } : {}),
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
/**
 * 🔴 The three ways an optional value arrives as "nothing".
 *
 * `undefined` (the field is absent), `null` (the column is NULL and the
 * API passed it through) and `''` (a name nobody filled in). Review found
 * each of them producing a published claim: `null m above sea level`,
 * `undefined stars in the national classification`, and a PropertyValue
 * named `Distance to ` with nothing after it. The API normalises all
 * three today — so the web layer was relying on an invariant only the
 * API's SQL enforces, with nothing asserting it.
 */
const known = (v: unknown): boolean => v !== undefined && v !== null;
const text = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
};
/** A label for terrain we recognise; unknown values name nothing. */
const terrainWord = (t: unknown): string | undefined =>
  typeof t === 'string' && t in TERRAIN_LABEL
    ? TERRAIN_LABEL[t as keyof typeof TERRAIN_LABEL].toLowerCase()
    : undefined;

export function surroundingProperties(spot: Spot) {
  const c = spot.context ?? {};
  const out: Record<string, unknown>[] = [];
  const metres = (name: string, value: number) => ({
    '@type': 'PropertyValue',
    name,
    value,
    unitCode: 'MTR',
  });

  if (c.water && known(c.water.m)) {
    const what =
      text(c.water.name) ?? WATER_LABEL[c.water.kind]?.toLowerCase() ?? 'water';
    out.push(metres(`Distance to ${what}`, c.water.m));
  }
  if (c.town && known(c.town.m)) {
    out.push(metres(`Distance to ${text(c.town.name) ?? 'the nearest town'}`, c.town.m));
  }
  if (c.supermarket && known(c.supermarket.m)) {
    out.push(metres('Distance to the nearest supermarket', c.supermarket.m));
  }
  if (c.station && known(c.station.m)) {
    const name = text(c.station.name);
    out.push(
      metres(
        `Distance to ${name ? `${name} station` : 'the nearest railway station'}`,
        c.station.m,
      ),
    );
  }
  if (known(c.elevation)) {
    out.push(metres('Elevation above sea level', c.elevation as number));
  }
  if (c.terrain && known(c.terrain.relief)) {
    const word = terrainWord(c.terrain.type);
    out.push(
      metres(
        word ? `Relief within 1 km (${word})` : 'Relief within 1 km',
        c.terrain.relief,
      ),
    );
  }
  return out;
}

/**
 * The national classification, or nothing.
 *
 * 🔴 One reading, used by both the graph and the FAQ. They disagreed:
 * `campgroundGraph` checked null AND undefined, `campsiteFaq` checked
 * only null, so a payload without the field printed "undefined stars in
 * the national classification" on the page and in the markup while the
 * Campground node correctly carried no starRating at all — the page
 * contradicting its own graph.
 *
 * The range is checked because a value outside it is not a
 * classification: the database constrains stars to 1-5, and markup that
 * says 0 out of 5 would be a claim no authority ever made.
 */
export function officialStars(spot: Spot): number | undefined {
  const n = spot.stars;
  if (typeof n !== 'number' || !Number.isInteger(n)) return undefined;
  return n >= 1 && n <= 5 ? n : undefined;
}

/**
 * CAMP-114 / CAMP-101: the record this campsite IS, as a URL.
 *
 * 🔴 `sameAs` means "another page that unambiguously indicates this same
 * thing". It is an identity claim, and identity is not the same as
 * attribution — which is the distinction this function exists to keep.
 *
 * Since CAMP-144 a French campsite page can carry two source records:
 * its own, and one joined to it by a name-and-distance rule. The page
 * shows both, with licences and dates, because it reuses fields from
 * both. But `link-evidence.ts` says in its own words, about the very
 * measurement that justified those joins: "🔴 This does not prove the
 * links are right." Publishing a heuristic join as `sameAs` would take
 * an uncertainty we have written down and hand it to other systems as a
 * fact — the exact upgrade the rest of this file refuses.
 *
 * So only the source that contributed `location` is used. That is the
 * record this row was built from: its geometry, its slug and its URL
 * come from that one, and the other supplied borrowed fields such as
 * stars or a website. Measured on 25 linked campsites through the live
 * API on 28.09.2026: exactly one source per page lists `location`, never
 * two and never none. The joined record stays where it belongs, in the
 * attribution block a reader can weigh.
 *
 * DATAtourisme already stores a resolvable URI, so it is used verbatim
 * after the scheme is checked.
 *
 * OpenStreetMap is stored the way `osmium export -u type_id` writes it:
 * `n<id>` for a node, `w<id>` for a way, and `a<id>` for an AREA, which
 * is libosmium's own numbering rather than an OSM element id — an even
 * area id is `way_id * 2`.
 *
 * 🔴 That decoding is measured, not assumed. 37 of our `a…` refs were
 * decoded and fetched from the OpenStreetMap API on 28.09.2026: 37 of 37
 * resolved to a way carrying `tourism=camp_site` or `caravan_site` whose
 * `name` tag equals ours, character for character.
 *
 * 🔴 An ODD area id is NOT published, although libosmium would call it
 * `relation_id * 2 + 1`. `scripts/osm-pipeline/import.sh` filters `n/`
 * and `w/` only, so no relation can enter this data at all, and all
 * 32 413 of our area ids are in fact even. An odd one would therefore be
 * corrupt input, and answering corrupt input with a confident permalink
 * to an unrelated OSM object is precisely the failure this whole file is
 * built to avoid. A ref whose shape we do not recognise produces no link.
 */
export function sourceLinks(spot: Spot): string[] {
  const out: string[] = [];
  // 🔴 Not `spot.sources ?? []`. `getSpot` is res.json() with a day of
  // cache behind it, and a payload whose `sources` is an object rather
  // than an array would throw "is not iterable" and take the page down —
  // the same way a stale payload once did on `spot.contact.address`.
  const sources = Array.isArray(spot.sources) ? spot.sources : [];
  for (const s of sources) {
    const ref = text(s?.ref);
    // Identity, not attribution: see the note above.
    if (!ref || !(s.fields ?? []).includes('location')) continue;
    if (s.id === 'datatourisme') {
      if (/^https?:\/\//i.test(ref)) out.push(ref);
      continue;
    }
    if (s.id !== 'osm') continue;
    const m = /^([nw])(\d+)$/.exec(ref);
    if (m) {
      const id = BigInt(m[2]);
      if (id > 0n) {
        out.push(
          `https://www.openstreetmap.org/${m[1] === 'n' ? 'node' : 'way'}/${id}`,
        );
      }
      continue;
    }
    const area = /^a(\d+)$/.exec(ref);
    if (!area) continue;
    const id = BigInt(area[1]);
    // Even areas are ways. Odd ones cannot exist here — see above.
    if (id > 0n && id % 2n === 0n) {
      out.push(`https://www.openstreetmap.org/way/${id / 2n}`);
    }
  }
  return out;
}

/**
 * What to call a campsite, in ONE place.
 *
 * 🔴 There were two readings and they disagreed. The Campground used
 * `spot.name ??`, which accepts an empty string and publishes a node
 * with `name: ""`; the WebPage used `text(spot.name) ??` and fell back.
 * One page, two names for the same thing, and the emptier one on the
 * node that matters.
 *
 * The region is checked too, because `near ${null}` prints the word
 * "null" — the API will not serve a region-less campsite today
 * (`WHERE s.region IS NOT NULL`), which is exactly why the fallback has
 * to survive one, rather than rely on a guarantee made elsewhere.
 */
export function campsiteName(spot: Spot): string {
  const named = text(spot.name);
  if (named) return named;
  const where = text(spot.region);
  const kind = SPOT_TYPE_LABEL[spot.type] ?? 'Campsite';
  return where ? `${kind} near ${where}` : `${kind} in ${countryName(spot.country)}`;
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
  const name = text(spot.name) ?? `this ${SPOT_TYPE_LABEL[spot.type].toLowerCase()}`;
  const items: FaqItem[] = [];

  if (c.water && known(c.water.m)) {
    const what =
      text(c.water.name) ?? WATER_LABEL[c.water.kind]?.toLowerCase() ?? 'water';
    items.push({
      q: `How far is the nearest water from ${name}?`,
      a: `${formatDistance(c.water.m)} to ${what}, measured straight-line from the centre of the site. The walk or drive will be longer.`,
    });
  }
  if (c.town && known(c.town.m)) {
    items.push({
      q: `How far is the nearest town?`,
      a: `${text(c.town.name) ?? 'The nearest town'} is ${formatDistance(c.town.m)} away in a straight line.`,
    });
  }
  if (c.supermarket && known(c.supermarket.m)) {
    items.push({
      q: `How far is the nearest supermarket?`,
      a: `${formatDistance(c.supermarket.m)} away in a straight line. We do not know its opening hours.`,
    });
  }
  if (c.station && known(c.station.m)) {
    const station = text(c.station.name);
    items.push({
      q: `How far is the nearest railway station?`,
      a: `${station ? `${station} station` : 'The nearest railway station'} is ${formatDistance(c.station.m)} away in a straight line. We do not know whether a bus or a path connects the two.`,
    });
  }
  if (known(c.elevation) || (c.terrain && known(c.terrain.relief))) {
    const bits: string[] = [];
    if (known(c.elevation)) bits.push(`${c.elevation} m above sea level`);
    if (c.terrain && known(c.terrain.relief)) {
      const word = terrainWord(c.terrain.type);
      bits.push(
        `${word ? `${word} ground, ` : ''}${c.terrain.relief} m of relief within a kilometre`,
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

  // 🔴 Neutral wording here too, and it took review to see why.
  //
  // "Does it cost anything?" and "Is it officially classified?" are
  // yes/no questions — the very shape the rule above forbids — and the
  // second was answered "Yes — ${spot.stars} stars", which prints
  // "undefined stars" the moment the field is absent. The graph guarded
  // against that three functions away and this did not.
  if (spot.type === 'free' || spot.type === 'wild') {
    items.push({
      q: `What do we know about the price?`,
      a: `It is recorded as a ${SPOT_TYPE_LABEL[spot.type].toLowerCase()}, which carries no fee. Local rules can still forbid staying overnight — check before you rely on it.`,
    });
  }

  if (officialStars(spot) !== undefined) {
    items.push({
      q: `What official classification does it have?`,
      a: `${officialStars(spot)} stars in the national classification published by the authority of ${countryName(spot.country)}. That is somebody else's rating, not ours; we do not rate campsites.`,
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
    // 🔴 What this FAQ is ABOUT, said in the graph rather than implied by
    // the two blocks sharing a page. Without it an assistant reading the
    // FAQ alone has a list of distances attached to nothing — the
    // questions name the campsite, but a name is not an identifier.
    about: { '@id': `${abs(path)}#campground` },
    isPartOf: { '@id': `${abs(path)}#page` },
    // The language the answers are actually written in. English is the
    // only locale this site serves today (lib/i18n), so this is read
    // from there rather than typed here — the day a second language goes
    // live, a hard-coded 'en' would be a lie on every translated page.
    inLanguage: DEFAULT_LOCALE,
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/**
 * OSM opening hours to schema.org's, where that is exact.
 *
 * Returns the strings schema.org accepts and nothing else. `24/7` has an
 * unambiguous equivalent and is translated; anything with months,
 * `sunrise`, `PH`, `off`, or a comma-joined pair of time ranges does
 * not, and is dropped rather than approximated.
 */
export function schemaOpeningHours(raw: string | undefined): string[] {
  if (!raw) return [];
  const value = raw.trim();
  if (value === '') return [];
  if (/^24\/7$/.test(value)) return ['Mo-Su 00:00-23:59'];
  const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
  const RULE = new RegExp(`^${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)* \\d{2}:\\d{2}-\\d{2}:\\d{2}$`);
  // 🔴 All of it translates, or none of it does.
  //
  // The first version kept the parts it understood and dropped the
  // rest, which turns "Mo-Su 08:00-20:00; PH off" into "open every day"
  // — a campsite that is shut on public holidays, published as open on
  // them. Dropping a qualifier changes the meaning of what remains, so
  // a value with any part we cannot read is not published at all. The
  // page still shows the original, verbatim.
  const rules = value
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (rules.length === 0 || !rules.every((r) => RULE.test(r))) return [];

  // 🔴 A clock that reads 99:99 is not a time, and `24:00` is a time
  // schema.org does not use.
  //
  // The pattern above only checks the SHAPE — two digits, a colon, two
  // digits — so `Mo-Su 99:99-88:88` would have been published verbatim.
  // No campsite has one today; the guard is here because the repo's own
  // structured-data validator does not check value formats, so a bad
  // one would ship in silence. `24:00` is real and live on three sites,
  // and is the same fact as `24/7`, which this function rewrites to
  // 23:59 — so it is rewritten the same way rather than published in
  // two different forms.
  const out: string[] = [];
  for (const rule of rules) {
    let ok = true;
    const normalised = rule.replace(/(\d{2}):(\d{2})/g, (m, h: string, mi: string) => {
      const hours = Number(h);
      const minutes = Number(mi);
      if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) ok = false;
      return hours === 24 ? '23:59' : m;
    });
    if (!ok) return [];
    out.push(normalised);
  }
  return out;
}

/**
 * 🔴 No `nearby` parameter any more, and that is a correctness fix.
 *
 * It took the list of neighbouring campsites and used it to decide
 * whether to state the region — two facts with nothing to do with each
 * other. Nothing in this node describes a neighbour, so the list does
 * not belong in its signature.
 */
export function campgroundGraph(spot: Spot, path: string) {
  const c = spot.context ?? {};
  const name = campsiteName(spot);

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
      // 🔴 CAMP-141. A street and a town, where OpenStreetMap has them.
      //
      // This block used to be a country and a region slug, which is a
      // postal address the way a postcode alone is a postal address.
      // The reason was not the markup: we had no data. Measured on an
      // extract, `addr:city` exists for about half of campsites.
      ...(spot.contact?.address?.street
        ? { streetAddress: spot.contact!.address!.street }
        : {}),
      ...(spot.contact?.address?.city
        ? { addressLocality: spot.contact!.address!.city }
        : {}),
      ...(spot.contact?.address?.postcode
        ? { postalCode: spot.contact!.address!.postcode }
        : {}),
    },
    // Both are true of every site in this dataset: they are public
    // campsites in OpenStreetMap, not private land.
    publicAccess: true,
  };

  // 🔴 CAMP-141: emitted ONLY where the data exists.
  //
  // Every one of these is a field Google reads on a Campground, and
  // every one of them was absent because we were not importing the tag
  // — not because the graph lacked a place to put it. The rule is the
  // same as everywhere else in this file: a field we cannot back with a
  // source does not appear, rather than appearing empty or guessed.
  // (`c` is already the context above — this file reads top to bottom.)
  const reach = spot.contact ?? {};
  if (reach.phone) node.telephone = reach.phone;
  if (reach.email) node.email = reach.email;

  // 🔴 Opening hours, only where OSM's grammar and schema.org's agree.
  //
  // They are not the same language. OSM's is a superset: `24/7`,
  // `Apr-Oct 08:00-20:00`, `Mo-Fr 09:00-18:00; Sa 09:00-13:00`,
  // `sunrise-sunset`, `PH off`. schema.org wants a day or day-range and
  // one time range per value. The first version of this emitted the raw
  // OSM string and review measured the damage: 2 045 of 2 182 live
  // values — 93.7% — were not schema.org syntax, and the validator does
  // not check formats, so every one would have been ingested silently
  // as a wrong fact.
  //
  // So the value is translated where the translation is exact, and
  // omitted where it is not. The page still shows the original verbatim,
  // labelled as OSM syntax, which is the honest place for the rest.
  const hours = schemaOpeningHours(reach.openingHours);
  if (hours.length > 0) node.openingHours = hours;

  // 🔴 `maximumAttendeeCapacity` is NOT emitted, and it was.
  //
  // schema.org defines it as "the total number of individuals that may
  // attend an event or venue" — people. OSM's `capacity` on a campsite
  // is pitches, which this file's own mapping comment says. Publishing
  // 20 pitches as 20 people understates a site three- to fourfold and
  // is exactly the quiet invention the mapping refuses two lines above
  // when it rejects "approx 120". OSM has `capacity:persons` for the
  // other quantity and we do not import it.
  //
  // `provider` is not emitted either: Google's validator rejects it on
  // Campground (UNKNOWN_FIELD), because `provider` belongs to Action,
  // Service, Trip and their kin, not to a Place. 2 390 campsites would
  // have carried that warning. The operator is shown on the page, where
  // it needs no schema to be useful.

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
  const stars = officialStars(spot);
  if (stars !== undefined) {
    node.starRating = {
      '@type': 'Rating',
      ratingValue: stars,
      bestRating: 5,
      worstRating: 1,
    };
  }

  // The operator's own site, where a source gave us one. `sameAs` is the
  // property for "another page that is unambiguously this same thing" —
  // so it must be a page. 🔴 The scheme is checked here rather than
  // trusted from upstream: `sameAs: "javascript:…"` is not an XSS in a
  // JSON document, but it is a machine-readable claim that a script is
  // this campsite, and only http(s) can be true.
  //
  // 🔴 CAMP-141: two sources, and DATAtourisme wins.
  //
  // `spot.website` is the official tourism register; `contact.website`
  // is whatever a mapper typed in OpenStreetMap. Where both exist the
  // register is the better claim, and where only OSM has one it is far
  // better than nothing — measured, OSM carries a website for 61.6% of
  // the campsites in an extract against the 10.7% we had.
  //
  // 🔴 CAMP-114: and the source record itself, alongside it.
  //
  // `sameAs` takes a list, and the operator's own site is only one of
  // the pages that unambiguously identify this campsite. The others are
  // the records we built it from — see `sourceLinks`. Duplicates are
  // dropped rather than repeated, and the whole property is omitted when
  // nothing survives the checks, because `sameAs: []` claims a list of
  // identities and then has none.
  const site = text(spot.website) ?? text(spot.contact?.website);
  const identities = [
    ...(site && /^https?:\/\//i.test(site) ? [site] : []),
    ...sourceLinks(spot),
  ];
  const sameAs = [...new Set(identities)];
  if (sameAs.length) node.sameAs = sameAs;

  // Only claimed where the data actually says so. `free` and `wild` are
  // the two types that carry no fee; for the rest we do not know the
  // price, so we say nothing rather than implying one.
  if (spot.type === 'free' || spot.type === 'wild') {
    node.isAccessibleForFree = true;
  }

  // 🔴 No `aggregateRating` and no `review`. We have no reviews at all
  // (CAMP-53), and inventing rating markup is the single fastest way to
  // earn a manual action from Google — quite apart from being a lie.

  // 🔴 The region, and it used to depend on the wrong fact.
  //
  // This was gated on `nearby.length` — a campsite with no neighbours
  // within range lost the statement of which region it is in, although
  // the region is the one thing we always know and the thing the URL is
  // built from. It is gated on the region itself now (135 of 61 558 rows
  // have none) and carries the region hub's URL, so the containment is a
  // link between two pages we publish rather than a loose string.
  const region = text(spot.region);
  if (region) {
    // `/camping/<country>/<region>/<slug>` minus the slug — and only
    // when the path really has that shape.
    //
    // 🔴 Slicing at the last `/` is right for the URLs this route
    // serves and wrong for everything else, which is why the shape is
    // checked rather than assumed. A trailing slash made the campsite
    // its OWN containing place; a path with no leading slash built
    // `https://camptribe.euab`. Neither is reachable through the route
    // today. Both are links that resolve and are wrong, which is worse
    // than no link — so the segments are counted instead.
    const segments = path.split('/');
    const shaped = path.startsWith('/') && segments.length === 5 && segments[4] !== '';
    node.containedInPlace = {
      '@type': 'Place',
      name: `${region}, ${countryName(spot.country)}`,
      ...(shaped ? { url: abs(segments.slice(0, 4).join('/')) } : {}),
    };
  }

  return node;
}

/**
 * CAMP-114: the page itself, described for the machines that read it.
 *
 * 🔴 This is the card's "publisher, isAccessibleForFree, inLanguage —
 * small and free", and it is the only honest home for two of them.
 * `publisher` belongs to CreativeWork; putting it on `Campground` is the
 * mistake that shipped UNKNOWN_FIELD to 2 390 pages, and `inLanguage` is
 * a CreativeWork property too. A page is a CreativeWork. A campsite is
 * not.
 *
 * What it buys beyond tidiness: `mainEntity` says which of the several
 * things described here the page is actually ABOUT. Until now a reader
 * of the graph met a Campground, a BreadcrumbList and an FAQPage side by
 * side with nothing tying them together.
 *
 * 🔴 No `dateModified`. We hold `lastSeenAt` — the day our import last
 * still found the campsite in OpenStreetMap — and that is not the day
 * this page changed. The honest value is `content_changed_at`, and
 * `/spots/index` does serve it as `contentChangedAt`; the per-campsite
 * payload this page is built from does not. Carrying it through is a
 * card of its own, and until it is done the date stays absent rather
 * than approximated by the one we happen to have.
 */
export function webPageGraph(opts: {
  name: string;
  path: string;
  hasFaq: boolean;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${abs(opts.path)}#page`,
    url: abs(opts.path),
    name: opts.name,
    inLanguage: DEFAULT_LOCALE,
    isPartOf: websiteNode(),
    publisher: publisherNode(),
    breadcrumb: { '@id': `${abs(opts.path)}#breadcrumb` },
    mainEntity: { '@id': `${abs(opts.path)}#campground` },
    ...(opts.hasFaq ? { hasPart: { '@id': `${abs(opts.path)}#faq` } } : {}),
  };
}

/**
 * 🔴 Every `@type` this page is allowed to emit, and the fact that has
 * to be true of the campsite before it may appear.
 *
 * This table is the card's verification clause in executable form: "a
 * test fails if the type is present while the data is not". The test
 * walks the graph this file actually ships, and a type that is not a key
 * here fails it — so adding a type means declaring, here, what backs it.
 * A comment promising the same thing is what we had, and comments do not
 * fail builds.
 *
 * The unconditional entries are facts about every row in the database,
 * not conveniences: `lat`/`lon` are NOT NULL, the country is NOT NULL,
 * and the publisher is us.
 */
export const TYPE_EVIDENCE: Record<string, (spot: Spot) => boolean> = {
  // The page, the site and the publisher: true of every page we serve.
  WebPage: () => true,
  WebSite: () => true,
  Organization: () => true,
  BreadcrumbList: () => true,
  ListItem: () => true,
  // Every campsite has a name-or-heading, a country and a point.
  Campground: () => true,
  GeoCoordinates: () => true,
  PostalAddress: () => true,
  // The region, which 135 of 61 558 rows do not have.
  Place: (s) => Boolean(text(s.region)),
  // Somebody else's classification: 4 214 campsites.
  Rating: (s) => officialStars(s) !== undefined,
  // One per amenity anybody has answered, in either direction.
  LocationFeatureSpecification: (s) =>
    AMENITY_KEYS.some((k) => s.amenities?.[k] === 'yes' || s.amenities?.[k] === 'no'),
  // One per measurement we computed.
  PropertyValue: (s) => surroundingProperties(s).length > 0,
  // And the questions, which exist only where something answers them.
  FAQPage: (s) => campsiteFaq(s).length > 0,
  Question: (s) => campsiteFaq(s).length > 0,
  Answer: (s) => campsiteFaq(s).length > 0,
};

/**
 * Every JSON-LD block the campsite page emits, in one place.
 *
 * 🔴 One function rather than three `<script>` tags assembled in the
 * page, because the test that enforces TYPE_EVIDENCE has to see exactly
 * what ships. A block added straight into the JSX would be invisible to
 * it, which is the failure this card exists to stop.
 */
export function campsitePageGraph(opts: {
  spot: Spot;
  path: string;
  crumbs: Crumb[];
  faq: FaqItem[];
}): Record<string, unknown>[] {
  const { spot, path, crumbs, faq } = opts;
  const blocks: Record<string, unknown>[] = [
    webPageGraph({ name: campsiteName(spot), path, hasFaq: faq.length > 0 }),
    campgroundGraph(spot, path),
    breadcrumbList(crumbs, path),
  ];
  const questions = faqGraph(faq, path);
  if (questions) blocks.push(questions);
  return blocks;
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
