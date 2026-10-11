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
// one: `season` is required on the view and in the API's SQL.
//
// 🔴 What actually stops a page printing "null bathing season", stated
// as what is checked rather than what is hoped:
//
//   - the column is `int NOT NULL` with a CHECK on the range — pinned by
//     api/src/bathing/migration.spec.ts, which runs the real migration
//     against a recording query runner;
//   - the served payload carries a four-digit season on every bathing
//     water in the fixture, and it is BATHING_SEASON — asserted in
//     tests/e2e/bathing-water.spec.ts against the constant below, NOT
//     against the field the page was built from. An earlier version
//     built every expected string from the payload, so a payload with
//     `season: null` rendered "null bathing season" and the assertions
//     agreed with it;
//   - the same spec reads the HEADING, the classification <dt>, both
//     sentences and the attribution out of the served HTML.
//
// The `row.bathing_water as BathingWaterView` cast in the API is still
// unchecked at runtime. That is what the two bullets above stand in for.

import { FORBIDDEN_WORDS } from './wording';
import { BATHING_SOURCE_ID, shouldFlagStale } from './sources';

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

/**
 * The published season. Exported so the copy and the tests share one year.
 *
 * 🔴 This is what the end-to-end spec pins the rendered year to. It is
 * deliberately NOT read from the payload the page was built from: a test
 * whose expected year comes from the field it is checking agrees with any
 * value at all, including `null`. A unit test asserts it equals the
 * constant the importer writes (api/src/bathing/source.ts), so the two
 * cannot be bumped apart — and when the 2026 season arrives, the fixture
 * rows in ci-seed.sql say 2025 and the spec goes red until they are
 * regenerated, which is the coupling wanted.
 */
export const BATHING_SEASON = 2025;

// Declared in `sources.ts`, where it is the key of `SOURCES`, and
// re-exported here so every existing importer is unaffected. See the
// comment beside the declaration for the cycle this avoids.
export { BATHING_SOURCE_ID };

/**
 * 🔴 The attribution the EEA asks for, VERBATIM — including the capital B
 * in "Bathing" and the lower-case s in "Member states".
 *
 * It is the map service's own `copyrightText`, read 29.09.2026:
 *
 *   curl -s 'https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM_2025/MapServer?f=json' | jq -r .copyrightText
 *   EEA, Bathing waters data and coordinates: Member states authorities.
 *
 * The EEA legal notice makes acknowledgement a condition of reuse, so
 * this is a licence condition rather than a style choice. An earlier
 * version of this section hard-coded a retyped "…bathing waters … Member
 * States authorities." under a comment that said "verbatim", while this
 * exact constant existed in the API and was never used by the web — and
 * the spec asserted the retyped spelling, so it agreed with the copy.
 *
 * The component RENDERS this constant and the spec asserts against it;
 * a unit test asserts it equals the API's copy and the literal above.
 */
export const BATHING_ATTRIBUTION =
  'EEA, Bathing waters data and coordinates: Member states authorities.';

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
export function seasonContextSentence(season: number, today = new Date()): string {
  const opening =
    'These classifications describe a whole bathing season rather than a ' +
    'particular day. ';

  // 🔴 CAMP-198: THE OLD SENTENCE WAS AN ASSERTION, NOT A CHECK.
  //
  // It said "The 2025 season is the most recent one published" — about
  // OUR newest record, with nothing anywhere verifying that it is also
  // the EEA's newest. An import two editions behind therefore printed a
  // false statement on every campsite with a designated bathing water,
  // and printed it confidently. `shouldFlagStale` had the rule for
  // exactly this since CAMP-166 and nothing called it.
  //
  // So the claim is now made only when the rule says we may still make
  // it, and the other branch says what we actually know: this is the
  // newest WE hold.
  if (!editionMayBeBehind(season, today)) {
    return (
      `${opening}The ${season} season is the most recent one published; ` +
      `the next is published ${BATHING_FRESHNESS.publishedAbout}.`
    );
  }
  // 🔴 NOT `publishedAbout` HERE. That string reads "usually in June of
  // the following year", which is correct beside the season it belongs
  // to and wrong in this branch: the edition that is overdue is the one
  // AFTER the season named, so "the following year" would point a reader
  // at the wrong June. The year is named outright instead.
  return (
    `${opening}The ${season} season is the most recent one we hold, and the ` +
    `${season + 1} season was due in June ${season + 2}. There may be an ` +
    `edition we have not imported yet.`
  );
}

/**
 * The day the edition for `season` was itself published.
 *
 * 🔴 MEASURED, NOT ASSUMED, and this is the only honest anchor available:
 * a `BathingWater` carries a season YEAR and no date at all, so any
 * freshness rule that wants days has to be given one. `BATHING_FRESHNESS`
 * records the two publications we have observed — the 2025 season on
 * 02.06.2026 and the 2024 season on 19.06.2025 — so the edition for
 * season N appears in June of N+1. The EEA promises no date; its
 * catalogue's `maintenanceAndUpdateFrequency` is null. We use the first
 * of June because it is the earliest either observation fell on, which
 * makes the rule flag no sooner than the evidence allows.
 */
export const editionPublishedAt = (season: number): string =>
  `${season + 1}-06-01T00:00:00.000Z`;

/**
 * Whether a newer edition than `season` has probably been published.
 *
 * 🔴 ONE RULE, NOT A SECOND ONE WRITTEN HERE. This hands the measured
 * date to `shouldFlagStale`, which CAMP-166 built and proved with five
 * mutations; writing a season-shaped rule beside it would be two rules
 * that agree until the day they do not.
 *
 * 🔴 AND IT HAS A KNOWN GAP — MEASURED, not reasoned about, because the
 * first version of this comment reasoned about it and got it backwards.
 *
 * Brute-forced over seasons 2022–2025 and every month of the five years
 * after each, against the truth "the newest published edition on day T
 * is (year of T) − 1 from June onwards, else (year of T) − 2":
 *
 *     24 disagreements, ALL of them "exactly one edition behind"
 *      0 disagreements where two or more editions are behind
 *      0 false alarms
 *
 * So the blind window is ONE missed edition, not two: from June of N+2,
 * when the superseding edition appears, until the 730-day branch catches
 * it in June of N+3 — about 181 days per cycle. Two editions behind is
 * past 730 in every month and is always flagged. The earlier comment
 * here said the opposite ("a holding exactly two editions behind …
 * reads healthy again"), which would have been the harmless direction
 * and was simply untrue.
 *
 * Closing it means changing `shouldFlagStale` itself, which is a
 * decision about every annual source and not one to take inside a
 * bathing-water helper.
 */
export const editionMayBeBehind = (season: number, today = new Date()): boolean =>
  shouldFlagStale(BATHING_FRESHNESS, editionPublishedAt(season), today);

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
    // 🔴 BOTH FORMS. `seasonContextSentence` gained a second branch in
    // CAMP-198 and this listed only the one the default clock happens to
    // produce — so the "we hold" wording passed through neither
    // `findForbiddenWords` nor the end-to-end gate. Review put
    // "so the water may be unsafe" into it and 862 tests stayed green;
    // `unsafe` is in `FORBIDDEN_WORDS`. Everything this module can print
    // means every branch of it, not every function of it.
    seasonContextSentence(bw.season, new Date(`${bw.season + 1}-07-01T00:00:00Z`)),
    seasonContextSentence(bw.season, new Date(`${bw.season + 3}-09-01T00:00:00Z`)),
    noBathingWaterSentence(BATHING_RADIUS_M),
    seasonLabel(bw.season),
    categoryLabel(bw.category),
    ...Object.values(BATHING_STATUS_LABEL),
  ];
}

export { FORBIDDEN_WORDS };
