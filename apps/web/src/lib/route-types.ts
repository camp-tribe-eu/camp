// CAMP-3 / CAMP-45: the shape of a curated route, and the rules a route
// has to satisfy before it may be published.
//
// 🔴 Routes are DATA, not prose inside a component.
//
// The reason is CAMP-130's reason, applied here. That card refuses a
// thin guide template repeated across regions, because a few hundred
// pages differing only in a place name is the textbook scaled-content
// pattern and the cost of shipping it is not a page, it is the domain.
// A route page is the same risk with better scenery: fifty "N days in
// <place>" pages assembled from one paragraph and a coordinate list
// would be exactly that.
//
// Keeping the routes as typed data is what makes the risk visible.
// Every field below that carries an editorial judgement — `why`,
// `summary`, `intro`, `roads`, `seasonNote` — is required, per route and
// per stage, so the template cannot be filled in without somebody having
// something to say. `validateRoute` refuses the ones that were not, and
// a test runs it over every route we ship.

/**
 * Who a route is for. A closed list, because "suits everyone" is the
 * answer that makes the filter on /routes useless.
 */
export const TRAVELLER_TAGS = [
  'first-trip',
  'families',
  'van-conversion',
  'large-motorhome',
  'cyclists',
  'hikers',
  'surfers',
  'history',
  'wild-swimming',
  'off-season',
  'slow',
] as const;

export type TravellerTag = (typeof TRAVELLER_TAGS)[number];

export const TRAVELLER_LABEL: Record<TravellerTag, string> = {
  'first-trip': 'A first trip',
  families: 'Families',
  'van-conversion': 'Van conversions',
  'large-motorhome': 'Large motorhomes',
  cyclists: 'Cyclists',
  hikers: 'Walkers',
  surfers: 'Surfers',
  history: 'History and ruins',
  'wild-swimming': 'Swimming',
  'off-season': 'Out of season',
  slow: 'Staying put',
};

/** Something worth stopping for, named. */
export interface RoutePoi {
  /** The name it is signposted by, in the local language where that is what is on the sign. */
  name: string;
  /** What it is, in a few words. Never opening hours, never a price. */
  what: string;
}

export interface RouteStage {
  /** The place, as a reader would look it up. */
  name: string;
  /**
   * 🔴 Where the stage actually is. Every coordinate in this repository
   * was checked against our own campsite table before it was written
   * down — see the note at the head of data/routes/index.ts. The failure
   * this guards against has already happened once on this project:
   * distances anchored to the wrong town, plausible on the page and
   * wrong on the ground.
   */
  lat: number;
  lon: number;
  /** Nights the curated itinerary spends here. */
  nights: number;
  /** One sentence: why this stop and not the next town along. */
  why: string;
  /** Named things to see from here. */
  pois?: RoutePoi[];
}

export interface CuratedRoute {
  /** Stable id, never reused. */
  id: string;
  /** URL segment. `/routes/<slug>`. */
  slug: string;
  name: string;
  /** ISO 3166-1 alpha-2, lower case, in the order the route enters them. */
  countries: string[];
  /** The area in words — what a person would call it. */
  region: string;
  /** Curated length in days. See `validateRoute` for its relation to nights. */
  days: number;
  /** Months (1–12) the route is genuinely worth doing. */
  months: number[];
  /** Why those months and not the others. */
  seasonNote: string;
  suits: TravellerTag[];
  /** One sentence. Used on the index card and as the meta description. */
  summary: string;
  /** The route page's opening paragraphs. */
  intro: string[];
  /** What the driving is actually like. No numbers — we have none. */
  roads: string;
  stages: RouteStage[];
  /** Where the campsite data beside this route comes from. */
  attribution: string;
  /** When a person last went through this route. ISO date. */
  curatedAt: string;
}

/**
 * Everything wrong with a route, as sentences.
 *
 * 🔴 Returns a list rather than throwing, and is exported, because the
 * caller is a TEST that checks every published route — the same shape
 * `publishable()` uses for guides. A build guard that stops at the first
 * problem makes fixing twelve routes take twelve runs.
 */
export function validateRoute(r: CuratedRoute): string[] {
  const problems: string[] = [];
  const id = r.slug || r.id || '(unnamed route)';

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug ?? '')) {
    problems.push(`${id}: slug is not a clean URL segment`);
  }
  if (!r.name?.trim()) problems.push(`${id}: no name`);
  if (!r.summary?.trim()) problems.push(`${id}: no summary`);
  if (!r.region?.trim()) problems.push(`${id}: no region`);
  if (!r.roads?.trim()) problems.push(`${id}: nothing said about the roads`);
  if (!r.seasonNote?.trim()) problems.push(`${id}: no reason given for the season`);
  if (!r.attribution?.trim()) problems.push(`${id}: no attribution note`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.curatedAt ?? '')) {
    problems.push(`${id}: curatedAt is not an ISO date`);
  }

  if (!r.countries?.length) problems.push(`${id}: no countries`);
  for (const c of r.countries ?? []) {
    if (!/^[a-z]{2}$/.test(c)) {
      problems.push(`${id}: "${c}" is not a lower-case alpha-2 country code`);
    }
  }

  if (!r.months?.length) problems.push(`${id}: no months`);
  for (const m of r.months ?? []) {
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      problems.push(`${id}: "${m}" is not a month`);
    }
  }

  if (!r.suits?.length) problems.push(`${id}: says nobody in particular it suits`);
  for (const t of r.suits ?? []) {
    if (!(TRAVELLER_TAGS as readonly string[]).includes(t)) {
      problems.push(`${id}: "${t}" is not a traveller tag`);
    }
  }

  // 🔴 At least three paragraphs of the route's own words.
  //
  // This is the anti-template rule, and it is a count because a count is
  // the only part a machine can check. A route nobody could write three
  // paragraphs about is a route we do not know well enough to publish.
  if ((r.intro ?? []).filter((p) => p.trim().length > 80).length < 3) {
    problems.push(`${id}: fewer than three substantial paragraphs of its own`);
  }

  const stages = r.stages ?? [];
  if (stages.length < 4) {
    problems.push(`${id}: ${stages.length} stages — too few to be a route`);
  }
  stages.forEach((s, i) => {
    const at = `${id} stage ${i + 1}`;
    if (!s.name?.trim()) problems.push(`${at}: no name`);
    if (!s.why?.trim()) problems.push(`${at}: no reason for stopping here`);
    // A sentence, not a label. "Nice town" passes a truthiness check and
    // says nothing, so the bar is length as well as presence.
    else if (s.why.trim().length < 40) {
      problems.push(`${at}: the reason for stopping is a label, not a sentence`);
    }
    if (!Number.isFinite(s.lat) || s.lat < -90 || s.lat > 90) {
      problems.push(`${at}: latitude is not a latitude`);
    }
    if (!Number.isFinite(s.lon) || s.lon < -180 || s.lon > 180) {
      problems.push(`${at}: longitude is not a longitude`);
    }
    // 🔴 (0, 0) is a real place in the Gulf of Guinea and the value a
    // missing coordinate defaults to. It is never a stage of ours.
    if (s.lat === 0 && s.lon === 0) problems.push(`${at}: coordinates are (0, 0)`);
    if (!Number.isInteger(s.nights) || s.nights < 1) {
      problems.push(`${at}: nights is not a positive whole number`);
    }
  });

  // 🔴 The itinerary has to add up.
  //
  // A ten-day trip has nine nights: you arrive on day one and leave on
  // day ten. If the stages say otherwise, one of the two numbers on the
  // page is wrong, and a reader planning leave from it would find out
  // the expensive way.
  const nights = stages.reduce((a, s) => a + (s.nights || 0), 0);
  if (Number.isInteger(r.days) && nights !== r.days - 1) {
    problems.push(
      `${id}: ${r.days} days but ${nights} nights across the stages — should be ${r.days - 1}`,
    );
  }

  // Two stages with the same name read as an editing accident, because
  // that is what they are.
  const names = stages.map((s) => s.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    problems.push(`${id}: the same stage name appears twice`);
  }

  return problems;
}
