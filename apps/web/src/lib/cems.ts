// CAMP-162 — what the Copernicus Emergency Management Service terms bind
// EVERY layer built on a CEMS product to, in one file with no React in it.
//
// 🔴 These were `wildfires.ts`'s own until the second CEMS layer was
// about to arrive. EDO drought (CAMP-163) and GFM floods (CAMP-161) are
// under the same terms as EFFIS — the terms name EFAS, GloFAS, GFM, EDO,
// GDO, EFFIS and GWIS in one sentence — so the two constants below are
// the licence's, not the wildfire layer's. A second copy in each new
// layer's lib is how one of them ends up with a word list that is one
// word short. `wildfires.ts` still exports both under the same names, so
// nothing that imported them there had to change.
//
// The rule they express is bound to the SOURCE, not to a file. The words
// "warning", "danger", "risk" and "alert" are forbidden in text rendered
// beside data from a CEMS product, and perfectly fine everywhere else:
// `map-layers.ts` says "Official severe-weather warnings" about the
// planned MeteoAlarm layer, which is the name of what a meteorological
// service publishes and which no CEMS licence touches. That is why the
// check that enforces this (`tests/unit/cems-panels.spec.ts`) reads the
// RENDERED panel of each CEMS layer and never greps the repository.

/**
 * The credit the CEMS terms dictate for data that has been changed, with
 * a four-digit year in the place they write "[Year]".
 *
 * Read 28.09.2026 at `https://drought.emergency.copernicus.eu/terms&conditions`:
 * "Where the data of the CEMS early warning and monitoring systems has
 * been adapted or modified, the user shall provide the following or
 * similar notice: 'Contains modified Copernicus Emergency Management
 * Service information [Year]'".
 *
 * 🔴 The year is matched, not merely the phrase. A notice frozen at 2026
 * is the same stale attribution the licence exists to prevent, and a
 * pattern that accepted "[Year]" verbatim would wave it through.
 *
 * 🔴 This is the notice for MODIFIED data. Data passed on untouched takes
 * "Generated using Copernicus Emergency Management Service information
 * [Year]" instead, and the two are not interchangeable
 * (docs/emergency-sources.md §3). Every layer we have filtered to the
 * EU-27, cut to a window or rounded is the first kind.
 */
export const CEMS_NOTICE =
  /Contains modified Copernicus Emergency Management Service information \d{4}\b/;

/**
 * 🔴 Words the CEMS terms reserve for national and regional services.
 *
 * The same terms say "the data does not constitute in any way an early
 * warning for which only national/regional institutions are authorized
 * within their region of responsibility". Using one of these against the
 * data is claiming an authority the licence explicitly denies us.
 *
 * 🔴 THIS IS THE CANONICAL LIST, one of three copies of it.
 *
 * `scripts/effis/fetch-wildfires.mjs` refuses to WRITE them and cannot
 * import TypeScript, so it keeps a literal; this side refuses to let them
 * be RENDERED; and `tests/unit/cems-panel.ts` keeps a third, which is what
 * the rendered panels are MEASURED against — written out separately so
 * that a gate weakened here cannot also blind the thing that would notice.
 * `tests/unit/cems-panels.spec.ts` asserts that all three have the same
 * `source`, so they can only change together, in view, and it drives each
 * word below through the gate and through the check.
 *
 * Whole words, with the inflections written out: "brisk", "Warwickshire"
 * and "Alerta" (a commune) are not the words, and a list that refused
 * them would be the false alarm that teaches people to switch it off.
 * Before CAMP-162 the three had drifted apart — "evacuation" was refused
 * here and was not caught on the rendered page.
 */
export const RESERVED_WORDS =
  /\b(warning(?:s)?|danger(?:s|ous|ously)?|risk(?:s|y|ier|iest|ed|ing)?|alert(?:s|ed|ing)?|evacuat(?:e|es|ed|ing|ion|ions))\b/i;
