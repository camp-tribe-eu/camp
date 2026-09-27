// CAMP-66 / CAMP-130: guides assembled from what we measured, not from
// what we think.
//
// 🔴 CAMP-130 measured the thing CAMP-66 never did: how similar these
// pages are to EACH OTHER. Word 5-gram Jaccard, which is what
// near-duplicate detectors use, on 27.09.2026 against the live database:
// within a theme the median pair shared 0.59–0.61 of its five-word
// sequences, and in the two largest themes three quarters of all pairs
// were above 0.60. Of ~120 words on a page, 44–71 appeared on EVERY page
// of that theme.
//
// That is not a threshold problem. Raising the bar from 5 campsites to
// 30 cut the page count from 1359 to 466 and moved the similarity by
// nothing at all, because the duplication was never in the data — it was
// in this file. The old `compose()` emitted a fixed skeleton with a
// region name and three integers dropped into it, so "publish fewer of
// them, slower" would have been a slower way to publish the same page
// 1359 times. That is exactly what Google's scaled content abuse policy
// (March 2024) describes.
//
// 🔴 So the lever is the text, and the material for it already exists:
// every one of the 61 557 live campsites now carries a computed
// `context` — the named town it sits near and how far, the named river,
// lake, sea or reservoir, the named railway station, the nearest
// supermarket, and for some of them terrain and elevation. A guide to
// Savona and a guide to Västra Götaland have no reason to read alike,
// because their rivers and their towns are not the same. This file now
// says those names and those distances.
//
// 🔴 The rule that did not change, and must not: every sentence a guide
// contains is a count, a name we hold, or a plain statement of what is
// missing. There is no prose that is not one of those three. No sentence
// is ever reworded for variety's sake — variation here comes from the
// data or it does not happen, because rewording the same claim five ways
// is the spinning the policy is aimed at, not the cure for it.

/** Below this a theme has nothing to say about a region. */
export const MIN_SUBJECTS = 5;

/**
 * Below this a region has nothing of its OWN to say.
 *
 * 🔴 The gate CAMP-130 added, and the one that matters. A named fact is
 * a town, a body of water or a station we hold a name for, or a recorded
 * terrain or elevation. A page built from fewer than this is a page
 * carried by its skeleton, and two such pages read alike however many
 * campsites are behind them. Counting campsites answers "is there
 * anything here"; counting named facts answers "is this page its own",
 * which is the question a duplicate detector asks.
 */
export const MIN_NAMED_FACTS = 6;

/**
 * Text that is SUPPOSED to be identical on every page.
 *
 * 🔴 A safety statement is not content. "Nobody has visited these" must
 * read the same everywhere precisely because a reader who has learnt
 * what it means on one page must recognise it on the next. It is
 * excluded from the similarity measurement for that reason, and this
 * array is what the measurement excludes — so the exclusion is a list
 * anyone can read, not a claim in a pull request.
 */
export const DISCLAIMERS: string[] = [
  'Nobody from CampTribe has visited these campsites. Check with the ' +
    'campsite before you rely on any of it.',
];

/** A facet of the subjects that a single column can answer. */
export type Facet = { label: string; predicate: string };

export type Theme = {
  id: string;
  /** Appears in the slug: /guides/{country}-{region}-{id}. */
  title: (region: string) => string;
  /** The question a reader came with. */
  question: string;
  /** SQL predicate over `camping_spots` that selects the subjects. */
  predicate: string;
  /**
   * SQL predicate: this question HAS a recorded answer for this row.
   *
   * 🔴 CAMP-130 found we had been printing "nobody has recorded anything
   * about this for N of them" where N was simply everything the
   * predicate did not select. For `classified` that turned a campsite
   * recorded as three stars into a campsite with no rating; for `water`
   * it turned a measured 3 km into a missing measurement. A gap and a
   * recorded "no" are different facts and a page that confuses them is
   * not showing gaps as gaps, it is inventing them.
   */
  recorded: string;
  /** What the recorded-but-not-matching rows are, as a plain phrase. */
  otherwise: string;
  /** What the count means, for the summary line. */
  noun: string;
  /**
   * Extra counted facets, each answerable from a column.
   *
   * 🔴 These are counts, not claims. "31 record electricity" means 31
   * rows say yes — it does not mean the other 11 have none, and the
   * honesty paragraph at the foot of every page says so.
   */
  facets: Facet[];
};

/**
 * The themes we can support with data we hold.
 *
 * 🔴 Each one is a question somebody actually asks, and each one is
 * answerable from a column. A theme we cannot answer from a column does
 * not belong here however good an article it would make — that is what
 * the human-written guides are for, and they need a human.
 */
export const THEMES: Theme[] = [
  {
    id: 'motorhome',
    title: (r) => `Motorhome stopovers in ${r}`,
    question:
      'Which places here are set up for a motorhome rather than a tent?',
    predicate: `type IN ('rv_park', 'camper_stop')`,
    // Every live row carries a type, so this question is never
    // unanswered — only answered no.
    recorded: `TRUE`,
    otherwise: 'are not tagged as caravan sites or motorhome stopovers',
    noun: 'motorhome stopovers and RV parks',
    facets: [
      { label: 'RV parks', predicate: `type = 'rv_park'` },
      { label: 'roadside stopovers', predicate: `type = 'camper_stop'` },
      {
        label: 'with a recorded grey-water point',
        predicate: `amenities ->> 'greyWater' = 'yes'`,
      },
      {
        label: 'with a recorded electrical hook-up',
        predicate: `amenities ->> 'electricity' = 'yes'`,
      },
      {
        label: 'with recorded drinking water',
        predicate: `amenities ->> 'water' = 'yes'`,
      },
    ],
  },
  {
    id: 'dogs',
    title: (r) => `Campsites in ${r} that take dogs`,
    question:
      'Which campsites here have actually recorded that dogs are welcome?',
    predicate: `amenities ->> 'dogFriendly' = 'yes'`,
    recorded: `amenities ->> 'dogFriendly' IN ('yes', 'no')`,
    otherwise: 'are recorded as not taking dogs',
    noun: 'recorded as taking dogs',
    facets: [
      {
        label: 'with recorded showers',
        predicate: `amenities ->> 'shower' = 'yes'`,
      },
      {
        label: 'with recorded drinking water',
        predicate: `amenities ->> 'water' = 'yes'`,
      },
      {
        label: 'with an official star rating',
        predicate: `stars IS NOT NULL`,
      },
      { label: 'with a website we hold', predicate: `website IS NOT NULL` },
    ],
  },
  {
    id: 'classified',
    title: (r) => `Four- and five-star campsites in ${r}`,
    question: 'Which campsites here carry a high official classification?',
    predicate: `stars >= 4`,
    recorded: `stars IS NOT NULL`,
    otherwise: 'carry an official rating below four stars',
    noun: 'rated four or five official stars',
    facets: [
      { label: 'with five stars', predicate: `stars = 5` },
      { label: 'with four', predicate: `stars = 4` },
      {
        label: 'with recorded wheelchair access',
        predicate: `amenities ->> 'wheelchair' = 'yes'`,
      },
      {
        label: 'with dogs recorded as welcome',
        predicate: `amenities ->> 'dogFriendly' = 'yes'`,
      },
      { label: 'with a website we hold', predicate: `website IS NOT NULL` },
    ],
  },
  {
    id: 'accessible',
    title: (r) => `Step-free campsites in ${r}`,
    question: 'Which campsites here have recorded wheelchair access?',
    predicate: `amenities ->> 'wheelchair' = 'yes'`,
    recorded: `amenities ->> 'wheelchair' IN ('yes', 'no')`,
    otherwise: 'are recorded as not step-free',
    noun: 'recorded as wheelchair-accessible',
    facets: [
      {
        label: 'with step-free facilities recorded throughout, not only access',
        predicate: `amenities ->> 'wheelchairFull' = 'yes'`,
      },
      {
        label: 'with recorded showers',
        predicate: `amenities ->> 'shower' = 'yes'`,
      },
      {
        label: 'with recorded toilets',
        predicate: `amenities ->> 'toilets' = 'yes'`,
      },
      {
        label: 'with an official star rating',
        predicate: `stars IS NOT NULL`,
      },
    ],
  },
  {
    id: 'water',
    title: (r) => `Campsites by the water in ${r}`,
    question: 'Which campsites here are within walking distance of water?',
    predicate: `(context -> 'water' ->> 'm')::int < 500`,
    // The distance to the nearest water is computed for every live row,
    // so this question is never unanswered either.
    recorded: `context -> 'water' ->> 'm' IS NOT NULL`,
    otherwise: 'have their nearest water further than 500 m away',
    noun: 'within 500 m of a lake, river or the sea',
    facets: [
      {
        label: 'with dogs recorded as welcome',
        predicate: `amenities ->> 'dogFriendly' = 'yes'`,
      },
      {
        label: 'with recorded showers',
        predicate: `amenities ->> 'shower' = 'yes'`,
      },
      {
        label: 'with an official star rating',
        predicate: `stars IS NOT NULL`,
      },
      { label: 'with a website we hold', predicate: `website IS NOT NULL` },
    ],
  },
];

/**
 * Where "near" and "far" sit, in metres.
 *
 * 🔴 Named constants rather than numbers buried in a sentence, because
 * the sentence is generated and the reader is entitled to the same
 * threshold on every page. 2 km to a station is a twenty-minute walk
 * with luggage; 1 km to a shop is a walk without a car; 500 m to water
 * is the same threshold the `water` theme itself uses.
 */
export const NEAR = { town: 3000, water: 500, station: 2000, shop: 1000 };
export const FAR = { town: 25000, water: 5000, station: 30000, shop: 15000 };

/** A place we hold a name for, and how the subjects sit around it. */
export type NamedPlace = {
  name: string;
  /** Subjects whose nearest one of these is this. */
  n: number;
  /** Metres from the closest of them. */
  nearest: number;
  /** For water: river, lake, sea or reservoir. */
  kind?: string | null;
  /** For water: how many of `n` are within NEAR.water. */
  walk?: number;
};

/**
 * The spread of a distance across the subjects.
 *
 * 🔴 A spread, not an average. "Half of them within 1.4 km" and "9 of
 * them have none within 30 km" are two different facts about the same
 * region and a reader planning a trip needs both; a mean would hide the
 * second one behind the first.
 */
export type Distances = {
  /** Subjects with this distance recorded at all. */
  known: number;
  /** Of `known`, how many are within the NEAR threshold. */
  within: number;
  /** Metres, median over `known`. */
  median: number;
  /** Of `known`, how many have nothing of this kind within FAR. */
  beyond: number;
};

export type Surroundings = {
  /** Named towns, most subjects first. */
  towns: NamedPlace[];
  /** How many distinct named towns the subjects sit near. */
  townsNamed: number;
  townDist: Distances;

  /** Named waters, most subjects first. */
  waters: NamedPlace[];
  /** Subjects whose nearest water carries a name. */
  waterNamed: number;
  /** river / lake / sea / reservoir, counted over the subjects. */
  waterKinds: { kind: string; n: number }[];
  waterDist: Distances;

  /** Named stations within NEAR.station, most subjects first. */
  stations: NamedPlace[];
  /** How many distinct named stations are within NEAR.station. */
  stationsNamed: number;
  stationDist: Distances;

  shopDist: Distances;

  /** Recorded terrain types, most common first. */
  terrain: { type: string; n: number }[];
  terrainKnown: number;

  /** Metres above sea level, where recorded. */
  elevation: { low: number; median: number; high: number } | null;
  elevationKnown: number;

  /** The theme's own facets, counted over the subjects. */
  facets: { label: string; n: number }[];

  /**
   * Where the campsites with NO answer sit.
   *
   * 🔴 This is the gap, located. "140 have nothing recorded" is true on
   * every page; "41 of them are around Gmunden" is true on one.
   */
  gapTowns: NamedPlace[];

  /** Where the campsites with a recorded "no" sit. */
  otherTowns: NamedPlace[];
};

export type RegionFacts = {
  country: string;
  region: string;
  theme: Theme;
  /** Campsites matching the theme. */
  subjects: number;
  /** Campsites in the region at all. */
  total: number;
  /** Of `total`, how many have nothing recorded for this theme. */
  unknown: number;
  /** A few named examples, longest-recorded first. */
  examples: { name: string; slug: string; detail: string | null }[];
  /** What the computed context says about the subjects. Null in tests. */
  surroundings: Surroundings | null;
};

export function slugFor(facts: RegionFacts, regionSlug: string): string {
  return `${facts.country.toLowerCase()}-${regionSlug}-${facts.theme.id}`;
}

/** Metres, said the way a person says them. */
export function dist(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Agreement, because "1 have none within 5 km" reads like a bug. */
const isAre = (n: number) => (n === 1 ? 'is' : 'are');
const hasHave = (n: number) => (n === 1 ? 'has' : 'have');

/** "a, b and c" — an Oxford-free list, because these are names. */
function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * How many facts on this page are this region's own.
 *
 * 🔴 The number `worthPublishing` gates on. A name is a fact no other
 * region has; a count is a fact every region has a version of. Only the
 * first kind makes a page distinguishable, so only the first kind is
 * counted here.
 */
export function namedFactCount(facts: RegionFacts): number {
  const s = facts.surroundings;
  if (!s) return 0;
  return (
    s.towns.length +
    s.waters.length +
    s.stations.length +
    (s.terrainKnown > 0 ? s.terrain.length : 0) +
    (s.elevationKnown > 0 ? 1 : 0)
  );
}

function townLines(facts: RegionFacts, s: Surroundings): string[] {
  const out: string[] = [];
  const d = s.townDist;
  if (s.townsNamed === 0) return out;

  out.push(
    `The ${facts.subjects} sit near ${s.townsNamed} ${plural(
      s.townsNamed,
      'named town',
      'different named towns',
    )}. ${d.within} of them ${isAre(d.within)} within ${dist(NEAR.town)} of theirs and the ` +
      `middle one is ${dist(d.median)} out` +
      (d.beyond > 0
        ? `, while ${d.beyond} ${hasHave(d.beyond)} no town of any size within ${dist(FAR.town)}.`
        : '.'),
  );
  if (s.towns.length > 0) {
    out.push('');
    out.push(
      `${plural(s.towns.length, 'The town', 'The towns')} with the most of them:`,
    );
    // 🔴 A blank line before the bullets: the reader's page renders a
    // block that STARTS with "- " as a list, and a lead-in glued to the
    // first item turns the whole thing back into a paragraph of dashes.
    out.push('');
    for (const t of s.towns) {
      out.push(
        `- ${t.name} — ${t.n} ${plural(t.n, 'campsite', 'campsites')}, the closest ${dist(t.nearest)} out`,
      );
    }
  }
  return out;
}

function waterLines(facts: RegionFacts, s: Surroundings): string[] {
  const out: string[] = [];
  const unnamed = facts.subjects - s.waterNamed;
  const kinds = list(
    s.waterKinds
      .slice(0, 4)
      .map((k) => `${k.kind === 'sea' ? 'the sea' : `a ${k.kind}`} for ${k.n}`),
  );

  if (s.waterNamed > 0) {
    out.push(
      `${s.waterNamed} of the ${facts.subjects} ${hasHave(s.waterNamed)} a named body of water as ` +
        `their nearest` +
        (kinds ? `, and the nearest water is ${kinds}.` : '.') +
        (unnamed > 0
          ? ` The other ${unnamed} ${hasHave(unnamed)} water nearby that nobody has named.`
          : ''),
    );
    out.push('');
    out.push(
      `${plural(s.waters.length, 'The water', 'The waters')} with the most of them:`,
    );
    out.push('');
    for (const w of s.waters) {
      // 🔴 The "how many are within walking distance" clause is dropped
      // when it says nothing — one campsite's distance is already on the
      // line, and "0 of them within 500 m" is noise, not a fact.
      const walk =
        w.walk === undefined || w.n === 1 || w.walk === 0
          ? ''
          : w.walk === w.n
            ? `all of them within ${dist(NEAR.water)}, `
            : `${w.walk} of them within ${dist(NEAR.water)}, `;
      out.push(
        `- ${w.name}${w.kind ? ` (${w.kind})` : ''} — ${w.n} ${plural(
          w.n,
          'campsite',
          'campsites',
        )}, ${walk}the closest ${dist(w.nearest)} away`,
      );
    }
  } else if (facts.subjects > 0) {
    out.push(
      `Not one of the ${facts.subjects} has a named body of water recorded as ` +
        `its nearest` +
        (kinds ? `, though by kind the nearest water is ${kinds}.` : '.'),
    );
  }

  const d = s.waterDist;
  if (d.known > 0) {
    out.push('');
    out.push(
      (d.within === d.known
        ? `Every one of them is within ${dist(NEAR.water)} of water and the ` +
          `middle one is ${dist(d.median)} from it`
        : `${d.within} ${isAre(d.within)} within ${dist(NEAR.water)} of water, the middle ` +
          `one ${dist(d.median)} from it`) +
        (d.beyond > 0
          ? `, and ${d.beyond} ${hasHave(d.beyond)} none within ${dist(FAR.water)}.`
          : '.'),
    );
  }
  return out;
}

function stationLines(facts: RegionFacts, s: Surroundings): string[] {
  const out: string[] = [];
  const d = s.stationDist;
  if (d.known === 0) return out;

  if (s.stationsNamed > 0) {
    out.push(
      `${d.within} of the ${facts.subjects} ${isAre(d.within)} within ${dist(NEAR.station)} of ` +
        `a railway station we hold a name for — ${s.stationsNamed} ${plural(
          s.stationsNamed,
          'station in all',
          'different stations in all',
        )}. The middle campsite is ${dist(d.median)} from its nearest` +
        (d.beyond > 0
          ? `, and ${d.beyond} ${hasHave(d.beyond)} no station within ${dist(FAR.station)}.`
          : '.'),
    );
    out.push('');
    out.push(`${plural(s.stations.length, 'That station', 'Those stations')}:`);
    out.push('');
    for (const st of s.stations) {
      out.push(
        `- ${st.name} — ${st.n} ${plural(st.n, 'campsite', 'campsites')}, the closest ${dist(st.nearest)} away`,
      );
    }
  } else {
    out.push(
      `None of the ${facts.subjects} is within ${dist(NEAR.station)} of a ` +
        `railway station. The middle one is ${dist(d.median)} from its nearest` +
        (d.beyond > 0
          ? `, and ${d.beyond} ${hasHave(d.beyond)} none within ${dist(FAR.station)}.`
          : '.'),
    );
  }
  return out;
}

function groundLines(facts: RegionFacts, s: Surroundings): string[] {
  const out: string[] = [];
  const d = s.shopDist;
  if (d.known > 0) {
    out.push(
      `${d.within} ${hasHave(d.within)} a supermarket within ${dist(NEAR.shop)} and the middle ` +
        `one is ${dist(d.median)} from the nearest shop` +
        (d.beyond > 0
          ? `, with ${d.beyond} further than ${dist(FAR.shop)} from one.`
          : '.'),
    );
  }

  if (s.terrainKnown > 0) {
    const kinds = s.terrain.map((t) => `${t.n} ${t.type}`);
    out.push(
      `The ground is recorded for ${s.terrainKnown} of the ${facts.subjects}: ` +
        `${list(kinds)}. Nobody has recorded it for the other ` +
        `${facts.subjects - s.terrainKnown}.`,
    );
  } else {
    out.push(
      `Nobody has recorded the terrain at any of the ${facts.subjects}.`,
    );
  }

  if (s.elevation && s.elevationKnown > 0) {
    out.push(
      `Height above sea level is recorded for ${s.elevationKnown} of them: ` +
        `${s.elevation.low} m to ${s.elevation.high} m, the middle one at ` +
        `${s.elevation.median} m.`,
    );
  }
  return out;
}

function facetLines(facts: RegionFacts, s: Surroundings): string[] {
  if (s.facets.length === 0) return [];
  const parts = s.facets.map((f) =>
    f.n === 0 ? `none ${f.label}` : `${f.n} ${f.label}`,
  );
  return [`Of the ${facts.subjects} on this list: ${list(parts)}.`];
}

/**
 * The guide's own words.
 *
 * 🔴 Deliberately plain. It is not trying to read like an article a
 * person wrote, because it is not one — the label says so, and writing
 * it in a chatty voice to disguise that would be the dishonesty the
 * label exists to prevent. What it is trying to be is THIS region's
 * page: the names in it are names nowhere else has.
 *
 * The one thing it does that no competitor does is state the gap: how
 * many campsites in this region have NOTHING recorded for this question,
 * and since CAMP-130, where those campsites are. That number is usually
 * the largest on the page, and printing it is the whole argument for
 * trusting the rest.
 */
export function compose(facts: RegionFacts): {
  title: string;
  summary: string;
  body: string;
} {
  const { region, theme, subjects, total, unknown, examples } = facts;
  const s = facts.surroundings;
  const title = theme.title(region);

  const biggest = s?.towns[0];
  const summary =
    `${subjects} of ${total} campsites in ${region} are ${theme.noun}. ` +
    (biggest
      ? `The largest group, ${biggest.n} of them, sits around ${biggest.name}. `
      : '') +
    (unknown > 0
      ? `Nobody has recorded anything about this for ${unknown} of them, so the real number is at least ${subjects}.`
      : `Every campsite in ${region} has this recorded.`);

  const lines: string[] = [];
  const para = (block: string[]) => {
    if (block.length === 0) return;
    if (lines.length > 0) lines.push('');
    lines.push(...block);
  };

  lines.push(theme.question);
  para([summary]);

  if (s) {
    para(townLines(facts, s));
    para(waterLines(facts, s));
    para(stationLines(facts, s));
    para(groundLines(facts, s));
    para(facetLines(facts, s));
  }

  if (examples.length > 0) {
    para([
      'Some of them:',
      '',
      ...examples.map((e) => `- ${e.name}${e.detail ? ` — ${e.detail}` : ''}`),
    ]);
  }

  // 🔴 The paragraph that makes this honest rather than merely accurate.
  // Its substance has not changed since CAMP-66. Its wording now carries
  // this region's own numbers and place names, because a promise
  // repeated word for word on 1359 pages is a template, and a template
  // is what a duplicate detector sees first.
  const gap = s?.gapTowns ?? [];
  const other = s?.otherTowns ?? [];
  const otherN = Math.max(0, total - subjects - unknown);
  const where = (places: NamedPlace[]) =>
    places.length > 0
      ? ` They are not spread evenly: ${list(
          places.map((g) => `${g.n} around ${g.name}`),
        )}.`
      : '';

  para([
    unknown > 0
      ? `${unknown} of the ${total} campsites we hold in ${region} carry no ` +
        `answer to this question at all.` +
        where(gap) +
        (otherN > 0 ? ` A further ${otherN} ${theme.otherwise}.` : '') +
        ` Any of the ${unknown} may belong on this list. We show gaps as ` +
        `gaps rather than guessing, so an absence here means nobody wrote ` +
        `it down — never that the answer is no.`
      : `Nothing is missing here: all ${total} campsites we hold in ` +
        `${region} carry an answer to this question, and the other ` +
        `${otherN} ${theme.otherwise}.` +
        where(other) +
        ` We show gaps as gaps rather than guessing, so where a page of ` +
        `ours is silent it is because nobody wrote it down — never ` +
        `because the answer is no.`,
  ]);

  para([DISCLAIMERS[0]]);

  return { title, summary, body: lines.join('\n') };
}

/**
 * Is this pair worth a page?
 *
 * 🔴 Two gates, and the second is the one CAMP-130 added. Enough
 * campsites to have something to say, AND enough named facts for the
 * page to be this region's rather than the template's. A region that
 * passes the first and fails the second is a region we hold counts for
 * and nothing else — and a page of counts alone is the page we just
 * measured at 0.59 similarity to its neighbours.
 */
export function worthPublishing(
  facts: RegionFacts,
  min = MIN_SUBJECTS,
  minNamed = MIN_NAMED_FACTS,
): boolean {
  if (facts.subjects < min) return false;
  return namedFactCount(facts) >= minNamed;
}
