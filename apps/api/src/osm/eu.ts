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
    code.trim().toLowerCase(),
  );
}
