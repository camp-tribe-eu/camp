// CAMP-210 — how 1 268 guides become reachable.
//
// 🔴 THE PROBLEM IS THE NUMBER, not the styling. `/guides` listed every
// guide in one flat list under one heading, because when it was written
// there were four. Measured on the real database on 06.10.2026:
//
//   1 268 guides, every one of them in the single category "region"
//
// A page of 1 268 links is not a catalogue, it is a dump. And the card's
// own bar is three clicks to any article, which a flat list technically
// meets and practically does not: nobody finds one row in 1 268.
//
// 🔴 THE FACETS ARE NOT IN THE DATA, so they are parsed from the slug —
// and that is a liability, stated here rather than buried. `guides` has
// `category` and nothing else to split on. The generator builds slugs as
// `<country>-<region>-<topic>`:
//
//   dk-nordjylland-motorhome     pt-braga-water
//   de-nordrhein-westfalen-water fr-vosges-water
//
// Measured over all 1 268: 26 countries, 5 topics —
//
//   water 466   motorhome 380   dogs 206   accessible 173   classified 43
//   fr 366   it 252   es 123   se 60   de 56   nl 46   pt 42   fi 39   …
//
// A parser that guesses would quietly file a new topic under the wrong
// heading, and the only symptom would be a catalogue that is subtly
// incomplete. So `parseGuideSlug` returns null for anything it does not
// recognise, `unparsed()` collects those, and the page refuses to
// pretend: a guide nobody can reach is reported, not dropped.

/**
 * The topics the generator produces, as a closed set.
 *
 * 🔴 CLOSED ON PURPOSE. An open "whatever is after the last hyphen"
 * reading would accept `fr-vosges-winter` the day someone adds it, file
 * it under a heading nobody wrote, and look like it worked. A new topic
 * must be a change here, beside its label.
 */
export const TOPICS = {
  water: 'Near water',
  motorhome: 'For motorhomes',
  dogs: 'Dogs welcome',
  accessible: 'Step-free and accessible',
  classified: 'Officially classified',
} as const;

export type Topic = keyof typeof TOPICS;

export const isTopic = (value: string): value is Topic =>
  Object.prototype.hasOwnProperty.call(TOPICS, value);

export interface GuideFacets {
  /** ISO 3166-1 alpha-2, lower case, as the slug carries it. */
  country: string;
  /** The administrative region, hyphens and all: `nordrhein-westfalen`. */
  region: string;
  topic: Topic;
}

/**
 * Split `fr-vosges-water` into its three parts, or say it cannot.
 *
 * The region is everything in the middle, because region names carry
 * hyphens of their own — 56 of the German guides are
 * `de-<something>-westfalen-…` shaped — so it is read from both ends in
 * rather than by counting segments.
 */
export function parseGuideSlug(slug: string): GuideFacets | null {
  const parts = slug.split('-');
  if (parts.length < 3) return null;

  const country = parts[0];
  // Two letters, and only letters: a country code, not a word.
  if (!/^[a-z]{2}$/.test(country)) return null;

  const topic = parts[parts.length - 1];
  if (!isTopic(topic)) return null;

  const region = parts.slice(1, -1).join('-');
  if (region === '') return null;

  return { country, region, topic };
}

/** Guides whose slug this parser does not understand. */
export function unparsed<T extends { slug: string }>(guides: readonly T[]): T[] {
  return guides.filter((g) => parseGuideSlug(g.slug) === null);
}

/** Guides that do parse, each carrying its facets. */
export function parsed<T extends { slug: string }>(
  guides: readonly T[]
): (T & { facets: GuideFacets })[] {
  const out: (T & { facets: GuideFacets })[] = [];
  for (const g of guides) {
    const facets = parseGuideSlug(g.slug);
    if (facets) out.push({ ...g, facets });
  }
  return out;
}

/** How many guides each country has, largest first. */
export function byCountry<T extends { slug: string }>(
  guides: readonly T[]
): { country: string; guides: (T & { facets: GuideFacets })[] }[] {
  const map = new Map<string, (T & { facets: GuideFacets })[]>();
  for (const g of parsed(guides)) {
    const list = map.get(g.facets.country) ?? [];
    list.push(g);
    map.set(g.facets.country, list);
  }
  return [...map.entries()]
    .map(([country, list]) => ({ country, guides: list }))
    // Largest first, then alphabetically, so the order is total and the
    // page does not reshuffle when two countries tie.
    .sort((a, b) => b.guides.length - a.guides.length || a.country.localeCompare(b.country));
}

/** How many guides each topic has, in the order TOPICS declares. */
export function byTopic<T extends { slug: string }>(
  guides: readonly T[]
): { topic: Topic; guides: (T & { facets: GuideFacets })[] }[] {
  const map = new Map<Topic, (T & { facets: GuideFacets })[]>();
  for (const g of parsed(guides)) {
    const list = map.get(g.facets.topic) ?? [];
    list.push(g);
    map.set(g.facets.topic, list);
  }
  return (Object.keys(TOPICS) as Topic[])
    .map((topic) => ({ topic, guides: map.get(topic) ?? [] }))
    .filter((t) => t.guides.length > 0);
}

/**
 * Every guide is reachable from the hub in at most this many clicks.
 *
 * 🔴 ASSERTED, NOT HOPED. `/guides` links 26 countries and 5 topics;
 * each of those pages links its guides directly. So the longest path is
 * hub → facet → article, which is two clicks, and the card asked for no
 * more than three. The spec measures this over the real slug corpus
 * rather than trusting the sentence.
 */
export const CLICKS_TO_ANY_GUIDE = 2;
