// CAMP-101: is this DATAtourisme record the campsite we already have?
//
// 🔴 The expensive question of the whole card, and the one where a wrong
// answer is worse in both directions:
//
//   a false MERGE puts a French tourist office's description on somebody
//   else's campsite, under their name, with an official star rating that
//   is not theirs — we would be publishing a fabrication about a real
//   business;
//
//   a false SPLIT gives us two pages for one campsite, which is the
//   exact failure CAMP-71 measured in OSM (51% of Slovenian rows were
//   involved in a duplicate) and CAMP-36 now guards against.
//
// Between the two, the false merge is far worse: a duplicate is untidy,
// an invented fact about a named business is a liability. So every rule
// here is biased towards leaving records apart, and `decide` returns
// `review` rather than guessing when the evidence is mixed.

/** Metres between two coordinates. Flat-earth is fine at this scale. */
export function metresApart(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon =
    (b.lon - a.lon) *
    111_320 *
    Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/**
 * Words that say "this is a campsite" rather than which campsite.
 *
 * 🔴 Removing these is what lets "Camping Les Pins" match "Les Pins",
 * which is the commonest difference between the two sources. It is also
 * the riskiest step in the file: strip too much and "Camping Municipal"
 * in two neighbouring communes become the same empty string. That is why
 * `coreName` refuses to return an empty core — a name that is nothing
 * but generic words carries no evidence and must not be matched on.
 */
const GENERIC = new Set([
  'camping',
  'campings',
  'camp',
  'kamp',
  'campsite',
  'caravaning',
  'caravanning',
  'carava',
  'aire',
  'aires',
  'parc',
  'park',
  'residence',
  'domaine',
  'village',
  // 🔴 'municipal' belongs here and its absence was a real bug, caught
  // by the test below: two different "Camping Municipal" records 25 m
  // apart compared as identical and merged. It is the commonest campsite
  // name in France — it says who runs the place, never which place.
  'municipal',
  'municipale',
  'communal',
  'communale',
  'intercommunal',
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'l',
  'au',
  'aux',
  'a',
  'et',
  'sur',
  'sous',
  'en',
  'the',
  'of',
]);

/** Lowercase, unaccented, punctuation gone. */
export function fold(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // The letters NFD does not decompose. Same list as the web search,
      // and for the same reason: they are letters in their own right.
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/ß/g, 'ss')
      .replace(/[đð]/g, 'd')
      .replace(/ø/g, 'o')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/**
 * The distinguishing part of a name, or null when there is none.
 *
 * Returns null — not an empty string — for a name made entirely of
 * generic words, so a caller cannot accidentally compare "" to "" and
 * conclude the two are the same place.
 */
export function coreName(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = fold(name)
    .split(' ')
    .filter((w) => w && !GENERIC.has(w));
  if (words.length === 0) return null;
  return words.join(' ');
}

/** Levenshtein, capped — beyond the cap the exact number never matters. */
export function editDistance(a: string, b: string, cap = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * How alike two cores are, 0…1.
 *
 * Edit distance over the longer length. Not a token overlap: "Les Pins
 * du Lac" and "Pins Lac" share every token and are plausibly the same,
 * but so are "Lac Blanc" and "Blanc Lac" — and word order carries real
 * information in French campsite names.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 0;
  const d = editDistance(a, b, Math.ceil(longer / 2));
  return Math.max(0, 1 - d / longer);
}

export type Candidate = {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
};

export type Decision =
  | {
      verdict: 'same';
      id: string;
      metres: number;
      similarity: number;
      why: string;
    }
  | {
      verdict: 'review';
      id: string;
      metres: number;
      similarity: number;
      why: string;
    }
  | { verdict: 'new'; why: string };

/**
 * Thresholds.
 *
 * 🔴 Measured against real French pairs on 23.09.2026 — 2 068
 * DATAtourisme records against 25 793 OSM campsites — and the
 * measurement's answer was to LEAVE THEM ALONE. Run it yourself:
 * `verify-match.ts <osm.geojson> <region.csv…>`.
 *
 * For pairs whose names already agree (similarity >= 0.85), the distance
 * between the tourist office's point and the OSM centroid decays
 * smoothly and has no cliff anywhere:
 *
 *     p50  70 m    p75 122 m    p90 207 m    p95 316 m    p99 651 m
 *     <=150 m 82.2%   <=200 m 89.7%   <=300 m 94.4%   <=400 m 97.0%
 *
 * So no threshold here is "natural": every metre added buys a smaller
 * review pile at the price of a merge nobody checked. Since a false
 * merge publishes one business's description and star rating on
 * another's page, and a review costs a person a minute, 150 m stays.
 *
 * At these numbers the real run is 38.3% merged, 48.3% new, 13.4% left
 * for a human — and 143 of that 13.4% are "same name, 150–400 m apart",
 * which is the quickest kind of question to answer.
 *
 * 🔴 What would justify moving them: ground truth. Nobody has labelled
 * which French pairs are really the same campsite, so any tuning beyond
 * this is intuition with a decimal point.
 */
export const RULES = {
  /** Beyond this, two records are different places whatever they are called. */
  maxMetres: 400,
  /** A campsite's own footprint: the same place can be this far apart. */
  sameSpotMetres: 150,
  /** Names this alike, and close, are the same campsite. */
  confidentSimilarity: 0.85,
  /** Below this the names are simply different. */
  weakSimilarity: 0.6,
};

/**
 * Pick the best candidate for a record, or decide it is new.
 *
 * 🔴 An unnamed candidate is never merged automatically, however close.
 * 26% of Slovenian OSM campsites have no name (measured), and "there is
 * something unnamed 40 m away" is not evidence that it is THIS campsite
 * — it is evidence that somebody should look.
 */
export function decide(
  incoming: { name: string; lat: number; lon: number },
  candidates: Candidate[],
  rules = RULES,
): Decision {
  const core = coreName(incoming.name);
  const near = candidates
    .map((c) => ({ c, metres: metresApart(incoming, c) }))
    .filter((x) => x.metres <= rules.maxMetres)
    .sort((a, b) => a.metres - b.metres);

  if (near.length === 0) return { verdict: 'new', why: 'nothing within 400 m' };

  let best: { c: Candidate; metres: number; sim: number } | null = null;
  for (const { c, metres } of near) {
    const other = coreName(c.name);
    const sim = core && other ? similarity(core, other) : 0;
    if (!best || sim > best.sim || (sim === best.sim && metres < best.metres)) {
      best = { c, metres, sim };
    }
  }
  if (!best) return { verdict: 'new', why: 'nothing within 400 m' };

  const { c, metres, sim } = best;
  const shared = {
    id: c.id,
    metres: Math.round(metres),
    similarity: Number(sim.toFixed(2)),
  };

  if (!coreName(c.name)) {
    return {
      ...shared,
      verdict: 'review',
      why: 'the nearby record has no distinguishing name — a human must look',
    };
  }
  if (!core) {
    return {
      ...shared,
      verdict: 'review',
      why: 'the incoming name is only generic words',
    };
  }

  if (sim >= rules.confidentSimilarity && metres <= rules.sameSpotMetres) {
    return { ...shared, verdict: 'same', why: 'same name, same place' };
  }
  if (sim >= rules.confidentSimilarity) {
    return {
      ...shared,
      verdict: 'review',
      why: `same name but ${Math.round(metres)} m apart`,
    };
  }
  if (sim >= rules.weakSimilarity && metres <= rules.sameSpotMetres) {
    return {
      ...shared,
      verdict: 'review',
      why: 'close together, names only roughly alike',
    };
  }
  return {
    verdict: 'new',
    why: `nearest is ${Math.round(metres)} m away and named differently`,
  };
}
