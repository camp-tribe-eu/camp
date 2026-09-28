// CAMP-168: the official bathing water classification, as a reader meets it.
//
// 🔴 THE ONE THING THIS FILE EXISTS TO PREVENT.
//
// The data is ANNUAL. The 2025 season was published on 02.06.2026; the
// 2026 season closing now will not be published until roughly June 2027.
// A reader who arrives after a rainstorm and remembers a word like
// "clean" has been promised something we never measured — the directive
// asks for four samples in a whole season, which is a reputation, not a
// reading.
//
// So every sentence this file produces names the SEASON and the YEAR,
// and the type system does not offer a way to render a class without
// one: `season` is required on the view, required in the API's SQL and
// NOT NULL in the column. Dropping the year would take three deliberate
// edits and a test that reads the served HTML still fails.

import { FORBIDDEN_WORDS } from './wording';

/** One officially designated bathing water, as the API sends it. */
export interface BathingWater {
  ref: string;
  name: string;
  /** Coastal | Lake | River | Transitional, as the member state files it. */
  category: string;
  /** 🔴 Required. There is no bathing water in this codebase without one. */
  season: number;
  status: string;
  profileUrl: string | null;
  /** Straight-line metres from the campsite. Not a walking route. */
  metres: number;
  sourceId: string;
}

/**
 * 🔴 HOW OFTEN THIS SOURCE IS EXPECTED TO CHANGE — declared, not inferred.
 *
 * CAMP-166 will generalise freshness across every source we carry, so
 * this is written as data about the source rather than as a clever rule
 * inside a component. When that card arrives it should be able to lift
 * this object and delete nothing else.
 *
 * 🔴 `ageIsNormal` is the whole point. A year-old classification here is
 * a HEALTHY one. Our existing staleness flag (lib/sources.ts) prints
 * "nobody has updated this in over two years" after 730 days, which is
 * right for a campsite record a tourist office forgot and wrong for a
 * dataset that is published once a year on purpose. In June 2028 this
 * source will legitimately carry a 2027 season; a flag that scolds it
 * would be teaching readers to ignore the flag.
 *
 * The June rhythm is MEASURED, not declared by the publisher: 2025
 * season published 02.06.2026, 2024 season 19.06.2025. The EEA states no
 * cadence in machine-readable form — the catalogue's
 * `maintenanceAndUpdateFrequency` is null. So the copy says "usually in
 * June" and never promises a date.
 */
export const BATHING_FRESHNESS = {
  cadence: 'annual' as const,
  ageIsNormal: true,
  publishedAbout: 'usually in June of the following year',
};

/** The published season. Exported so the copy and the tests share one year. */
export const BATHING_SEASON = 2025;

export const BATHING_SOURCE_ID = 'eea-bathing-water';

/**
 * 🔴 The class names, as the Bathing Water Directive names them.
 *
 * Capitalised, and otherwise untouched. There is no editorialising layer
 * here — no "great", no "needs attention" — because the moment we
 * paraphrase an official class we are publishing our opinion of
 * somebody's beach under their authority's name.
 */
export const BATHING_STATUS_LABEL: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  sufficient: 'Sufficient',
  poor: 'Poor',
};

/** Coastal | Lake | River | Transitional → what a reader calls it. */
export const BATHING_CATEGORY_LABEL: Record<string, string> = {
  Coastal: 'coastal water',
  Lake: 'lake',
  River: 'river',
  Transitional: 'transitional water',
};

export function categoryLabel(category: string): string {
  return BATHING_CATEGORY_LABEL[category] ?? 'bathing water';
}

/**
 * 🔴 "2025 bathing season" — the phrase, in one place.
 *
 * Every sentence about this data goes through here, so there is exactly
 * one place where the year could be dropped, and it is covered by a test
 * that reads the served HTML rather than this function's return value.
 */
export function seasonLabel(season: number): string {
  return `${season} bathing season`;
}

/**
 * Whether the source published a class, or said it did not classify.
 *
 * 🔴 `not_classified` is a VALUE the EEA publishes, not an absence. 611
 * of the 22 010 EU-27 sites carry it for 2025. The page says so in
 * words; it does not fall back to silence, because silence on a page
 * about water reads as "fine".
 */
export function isClassified(bw: BathingWater): boolean {
  return bw.status in BATHING_STATUS_LABEL;
}

export function statusLabel(bw: BathingWater): string | null {
  return BATHING_STATUS_LABEL[bw.status] ?? null;
}

/**
 * The sentence under the class. Names the season, never the present day.
 *
 * 🔴 Takes no `now` and reads no clock, deliberately. Two reasons, and
 * the second is the one that would have bitten us: a sentence that
 * changes with the date rewrites 18 605 statically built pages every
 * midnight and tells crawlers the content moved when it did not — the
 * same lesson tariffsSql records. And a sentence computed from "how old
 * is this" is a sentence that will eventually call a healthy annual
 * dataset stale.
 */
export function seasonSentence(bw: BathingWater): string {
  return (
    `Classified by the national authorities for the ${seasonLabel(bw.season)}, ` +
    `as published by the European Environment Agency.`
  );
}

/** What the page says when the EEA has designated the water but not classed it. */
export function notClassifiedSentence(bw: BathingWater): string {
  return (
    `The authorities published no classification for this bathing water ` +
    `for the ${seasonLabel(bw.season)}.`
  );
}

/**
 * The sentence that keeps a season from reading as a day. Printed under
 * BOTH of the sentences above.
 *
 * 🔴 Separate from `seasonSentence`, and this is a correction rather than
 * a design. The first version printed "Classified by the national
 * authorities for the 2025 bathing season…" under EVERY record,
 * including the unclassified ones — so a page said "Not classified" and
 * then, two lines later, that it had been classified. Seen in a browser,
 * which is the only place it was visible: every test was green and every
 * string was individually true.
 *
 * 🔴 It carries the year too. Every sentence in this section names the
 * season, including the one whose subject is the calendar.
 */
export function seasonContextSentence(season: number): string {
  return (
    `These classifications describe a whole bathing season rather than a ` +
    `particular day. The ${season} season is the most recent one published; ` +
    `the next is published ${BATHING_FRESHNESS.publishedAbout}.`
  );
}

/**
 * What the page says when there is no designated bathing water in range.
 *
 * 🔴 IT SAYS SOMETHING. 42 953 of 61 558 campsites (69.8%, measured
 * 28.09.2026) are in this case, and rendering nothing on all of them
 * would let the absence read as reassurance — and would make a campsite
 * whose bathing water we failed to import look exactly like one that
 * genuinely has none.
 *
 * It states the radius, because a reader who knows there is a lake
 * 3 km away should be able to tell that we looked 2 km and stopped,
 * rather than conclude we do not know about the lake.
 */
export function noBathingWaterSentence(radiusM: number): string {
  return (
    `No bathing water officially designated under the EU Bathing Water ` +
    `Directive lies within ${(radiusM / 1000).toFixed(0)} km of this campsite. ` +
    `That is not a statement about the water nearby — only that no ` +
    `designated bathing water is monitored this close.`
  );
}

/**
 * The radius the API used, mirrored for the copy above.
 *
 * 🔴 Mirrored, not re-decided. api/src/bathing/nearby.ts owns the number
 * and the measurement behind it; this constant exists so the sentence a
 * reader sees states the same distance the query actually applied. A
 * test asserts they are equal, because two copies of a number is how a
 * page ends up describing a filter it does not have.
 */
export const BATHING_RADIUS_M = 2000;

/**
 * 🔴 The gate, applied to our own copy at build time.
 *
 * Everything this module can print is checked here against CAMP-162's
 * word list. It is exported so a unit test can assert the strings, and
 * an end-to-end test asserts the same thing against the SERVED HTML —
 * because a rule checked only against the function that generates the
 * text is a rule the next component to hard-code a sentence will escape.
 */
export function allCopy(bw: BathingWater): string[] {
  return [
    seasonSentence(bw),
    notClassifiedSentence(bw),
    seasonContextSentence(bw.season),
    noBathingWaterSentence(BATHING_RADIUS_M),
    seasonLabel(bw.season),
    categoryLabel(bw.category),
    ...Object.values(BATHING_STATUS_LABEL),
  ];
}

export { FORBIDDEN_WORDS };
