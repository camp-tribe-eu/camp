// CAMP-168: the EEA bathing water dataset, described once.
//
// Everything in this file is a fact about the SOURCE, not about us, and
// every one of them was read on 28.09.2026 from the endpoint named here
// rather than recalled from the survey in docs/emergency-sources.md §8.
// The survey and this file agree; that agreement is the check.

/**
 * The year-suffixed map service.
 *
 * 🔴 The suffix is load-bearing. The un-suffixed twin,
 * `.../BathingWater/BathingWater_Dyna_WM/MapServer`, looks like the
 * current service and still describes itself as showing "the latest
 * (2022)" season — documented in docs/emergency-sources.md §8 as a trap,
 * and it is exactly the kind of trap that costs three years of accuracy
 * without ever erroring.
 *
 * Layer 3 is "Bathing water quality (point)": one point per bathing
 * water, with the season's class and the ten preceding ones.
 */
export const BATHING_LAYER_URL =
  'https://water.discomap.eea.europa.eu/arcgis/rest/services' +
  '/BathingWater/BathingWater_Dyna_WM_2025/MapServer/3';

/**
 * The dataset's page on the EEA Datahub — HTTP 200, checked 28.09.2026.
 *
 * 🔴 This is the PARENT record, and docs/emergency-sources.md §8 records
 * why that matters: the parent returns null for every licence field, and
 * the CC BY 4.0 grant lives only on the versioned children
 * (…/datahubitem-view/eb2db5fa… and siblings, one per season). So this
 * URL is where we send a READER, and it is deliberately not where the
 * licence claim in `SOURCES` comes from.
 */
export const BATHING_LANDING_URL =
  'https://www.eea.europa.eu/en/datahub/datahubitem-view/' +
  'c3858959-90da-4c1b-b9ca-492db0e514df';

/**
 * 🔴 The season these rows describe — a YEAR, never "now".
 *
 * The 2025 season was published 02.06.2026; the 2024 season 19.06.2025.
 * That June-to-June rhythm is measured, not declared: the catalogue's
 * `maintenanceAndUpdateFrequency` is null and the ISO XML inside the bulk
 * ZIP has no maintenance element at all. So we state the season we have
 * and never predict the next one.
 */
export const BATHING_SEASON = 2025;

/** Short stable publisher id, as `camping_spots.sources` spells them. */
export const BATHING_SOURCE_ID = 'eea-bathing-water';

/**
 * 🔴 Attribution text, from the service's own `copyrightText` field —
 * not composed by us.
 *
 *   curl -s '<BATHING_LAYER_URL>/../..?f=json' | jq -r .copyrightText
 *   EEA, Bathing waters data and coordinates: Member states authorities.
 *
 * The EEA legal notice makes acknowledgement a condition of reuse, and
 * adds one more that is easy to read past: the reuse must not distort
 * "the original meaning or message of the content". A seasonal
 * classification rendered without its season is exactly that distortion,
 * which is why the year travels with every one of these rows from the
 * import to the rendered HTML.
 */
export const BATHING_ATTRIBUTION =
  'EEA, Bathing waters data and coordinates: Member states authorities.';

/** The five values `qualityStatus` takes, as the source spells them. */
export const BATHING_STATUS_SOURCE_VALUES = [
  'Excellent',
  'Good',
  'Sufficient',
  'Poor',
  'Not classified',
] as const;

/** The same five, as our column spells them. */
export const BATHING_STATUSES = [
  'excellent',
  'good',
  'sufficient',
  'poor',
  'not_classified',
] as const;

export type BathingStatus = (typeof BATHING_STATUSES)[number];

/**
 * 🔴 "Not classified" IS a value, not an absence.
 *
 * 611 of the 22 010 EU-27 sites carry it for the 2025 season (measured
 * 28.09.2026 over the full layer). Storing those as NULL would make them
 * indistinguishable from a site we failed to import, and the page would
 * have no way to tell a reader which of the two it is looking at.
 */
export const NOT_CLASSIFIED: BathingStatus = 'not_classified';
