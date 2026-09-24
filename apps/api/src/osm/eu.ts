// CAMP-118: who we serve, in one place.
//
// 🔴 THE SINGLE SOURCE OF TRUTH FOR THE PROJECT'S SCOPE.
//
// "We build for the EU only" was written in CLAUDE.md, in the
// architecture notes and in every decision for months. Measured on the
// live database 24.09.2026:
//
//   ba  13 campsites   not a member state
//   rs   2 campsites   not a member state
//
// Nobody added them. import-spots.ts takes the country from the polygon
// the point falls in — which is right — and then imported it anyway,
// merely COUNTING the ones outside the extract's country. Geofabrik's
// extracts are cut to bounding boxes, so Slovenia's includes a strip of
// Bosnia, and Croatia's a strip of Serbia.
//
// A rule that nothing enforces is a rule that has already stopped
// applying. This file is the enforcement, and scripts/ci/check-eu-scope.mjs
// reads it so that the weekly import list cannot drift from it either.
//
// 🔴 Why it matters more than tidiness: every source this project relies
// on for safety is an EU instrument — MeteoAlarm, Copernicus EFFIS and
// EFAS, the national access points required by the ITS Directive. A
// campsite page outside the Union gets no hazard data behind it, and a
// hazard layer that is silent in some countries is worse than one that
// is absent everywhere, because people learn to trust it.

/**
 * The European Union as of 2026, ISO 3166-1 alpha-2, lower case.
 *
 * ⚠️ Twenty-seven is a fact about this year, not a constant of the
 * universe. The day it changes, this array changes and every check that
 * reads it tells you what else has to.
 */
export const EU_MEMBER_STATES = [
  'at', // Austria
  'be', // Belgium
  'bg', // Bulgaria
  'hr', // Croatia
  'cy', // Cyprus
  'cz', // Czechia
  'dk', // Denmark
  'ee', // Estonia
  'fi', // Finland
  'fr', // France
  'de', // Germany
  'gr', // Greece
  'hu', // Hungary
  'ie', // Ireland
  'it', // Italy
  'lv', // Latvia
  'lt', // Lithuania
  'lu', // Luxembourg
  'mt', // Malta
  'nl', // Netherlands
  'pl', // Poland
  'pt', // Portugal
  'ro', // Romania
  'sk', // Slovakia
  'si', // Slovenia
  'es', // Spain
  'se', // Sweden
] as const;

export type EuCountry = (typeof EU_MEMBER_STATES)[number];

/**
 * Is this a country we serve?
 *
 * Tolerant of case and of nothing at all, because it guards an import
 * loop where the country may be missing entirely — and a missing country
 * is emphatically not a member state.
 */
export function isEuMemberState(code: string | null | undefined): boolean {
  if (typeof code !== 'string') return false;
  return (EU_MEMBER_STATES as readonly string[]).includes(code.toLowerCase());
}
