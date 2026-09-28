// CAMP-118: who we serve, in one place.
//
// 🔴 THE LIST ITSELF LIVES IN eu-member-states.json, NOT HERE.
//
// It used to be a TypeScript array, and the shell-side tools recovered it
// by running a regex over this file. Review demonstrated what that costs:
// rewrite one entry with double quotes — which `prettier` does by default,
// and this repository has no .prettierrc — and the regex silently returns
// a SHORTER list. `drop-non-eu.mjs` then treats the missing country as
// "outside the Union" and deletes it.
//
// Reproduced against a scratch database: two French campsites removed,
// exit 0, and the script's own post-delete verification passed, because it
// re-read the same wrong list. On the live database that is 23,652 rows.
//
// JSON cannot be misparsed by accident. Every consumer now reads the same
// file: this module, scripts/ci/check-eu-scope.mjs and
// scripts/osm-pipeline/drop-non-eu.mjs.
//
// 🔴 Why the scope matters at all: every source this project relies on for
// safety is an EU instrument — MeteoAlarm, Copernicus EFFIS and EFAS, the
// national access points required by the ITS Directive. A campsite page
// outside the Union gets no hazard data behind it, and a hazard layer that
// is silent in some countries is worse than one that is absent
// everywhere, because people learn to trust it.

// 🔴 `import * as`, not a default import. The API compiles to CommonJS
// without esModuleInterop, so `import data from './x.json'` resolves to
// `undefined` under ts-jest and takes the whole suite down with
// "Cannot read properties of undefined (reading 'members')".
import * as data from './eu-member-states.json';

/** ISO 3166-1 alpha-2 → the Geofabrik extract that covers it. */
export const EU_GEOFABRIK: Readonly<Record<string, string>> = data.members;

/** The European Union as of 2026, lower case, sorted for stable output. */
export const EU_MEMBER_STATES: readonly string[] =
  Object.keys(EU_GEOFABRIK).sort();

/**
 * 🔴 SUBDIVISION CODES THAT ARE STILL A MEMBER STATE.
 *
 * `AX` is Åland: an autonomous region OF FINLAND, inside the Union, and
 * ISO 3166-1 gives it a code of its own. The member list above is a list
 * of STATES, so `ax` is not in it and never should be — what was missing
 * is the knowledge that `ax` resolves to `fi`.
 *
 * 🔴 The root cause, because it will happen again otherwise: TWO
 * DIFFERENT SOURCES FEED ONE MEMBERSHIP LIST.
 *
 * `import-spots.ts` takes a campsite's country from the Geofabrik
 * extract, which reads Åland as `FI` — measured on the live table, all 8
 * Åland campsites present and coded `FI`, Finland 985 in total. The
 * route-POI import (CAMP-113) takes its country from Natural Earth,
 * which emits SUBDIVISION codes, so the same islands arrive as `AX` and
 * were deleted: 218 points, 104 of them places to eat. Nothing in either
 * file was wrong on its own; the two disagreed about what a country is.
 * A third source will disagree again, and this is the comment that
 * should stop it costing a country.
 *
 * Measured 28.09.2026 across every `ne_admin1.iso_a2` whose centroid
 * falls in the European window (lat 34–72, lon −32–35) and is absent
 * from the member list — GB, MK, TR, MD, DZ, XK, CH, RS, ME, UA, NO, TN,
 * BA, RU, AL, LI, AX, SM, IS, BY, AD, −1, MA, VA, GI, JE, IM, MC, GG,
 * FO. **`AX` is the only one that lies inside a member state.** Every
 * other code there is genuinely outside the Union and stays refused,
 * Monaco and Gibraltar included; `-1` is the British Sovereign Base
 * Areas on Cyprus, which are the owner's territory under CAMP-125.
 *
 * So this is one alias, not a category, and it is written out rather
 * than derived — a rule that guesses which codes are "really" a member
 * is a rule that will one day admit Liechtenstein.
 */
export const ISO_SUBDIVISION_OF: Readonly<Record<string, string>> = {
  ax: 'fi',
};

/**
 * 🔴 CODES FROM A DIFFERENT CODE SYSTEM THAT NAME A MEMBER STATE.
 *
 * `EL` is Greece in the Eurostat/NUTS system. ISO 3166-1 leaves `EL`
 * unassigned and calls the country `GR`, which is what
 * eu-member-states.json holds — so `isEuMemberState('EL')` is a
 * confident, silent **no**.
 *
 * 🔴 CAMP-168 measured what that costs. The EEA bathing water layer
 * labels its countries the Eurostat way, and on 28.09.2026 **1 734 of
 * its 22 010 EU-27 sites are Greek**. Without this entry every one of
 * them is refused as "outside the Union", the importer exits 0, and the
 * coverage report reads 26 of 27 countries — a shape that looks like
 * Greece simply having no bathing waters rather than like a bug.
 *
 * 🔴 Kept SEPARATE from `ISO_SUBDIVISION_OF` above, and not merged with
 * it. Åland is a subdivision of a member state; Greece is a member
 * state under another spelling. Folding the two together would make the
 * map's name a lie about half its contents, and the next person adding
 * an entry would have no rule to follow.
 *
 * Written out, never derived — the same discipline as `ax`. A rule that
 * guesses which foreign codes "really mean" a member state is a rule
 * that will one day admit `UK`.
 */
export const NON_ISO_COUNTRY_CODE: Readonly<Record<string, string>> = {
  el: 'gr',
};

/**
 * A country code as the member list spells it, or the code unchanged.
 *
 * 🔴 Call this BEFORE testing membership on anything sourced from
 * Natural Earth. `isEuMemberState` applies it too, so the two cannot
 * disagree — the previous version of this module was bitten precisely by
 * a guard that consulted a different list from the thing it guarded.
 */
export function normaliseCountry(code: string | null | undefined): string {
  if (typeof code !== 'string') return '';
  const c = code.trim().toLowerCase();
  return ISO_SUBDIVISION_OF[c] ?? NON_ISO_COUNTRY_CODE[c] ?? c;
}

/**
 * Is this a country we serve?
 *
 * Tolerant of case and of nothing at all, because it guards an import loop
 * where the country may be missing entirely — and a missing country is
 * emphatically not a member state.
 */
export function isEuMemberState(code: string | null | undefined): boolean {
  if (typeof code !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(
    EU_GEOFABRIK,
    normaliseCountry(code),
  );
}

/**
 * The member states plus every subdivision code that resolves to one.
 *
 * 🔴 For SQL, which cannot call `normaliseCountry`. A query that tests
 * membership against `EU_MEMBER_STATES` alone deletes Åland; one that
 * tests against this list keeps it. The loader stores the NORMALISED
 * code, so nothing downstream ever sees `ax`.
 */
export const EU_MEMBER_STATES_AND_SUBDIVISIONS: readonly string[] = [
  ...EU_MEMBER_STATES,
  ...Object.keys(ISO_SUBDIVISION_OF),
].sort();
