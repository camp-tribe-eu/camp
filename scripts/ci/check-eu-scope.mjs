#!/usr/bin/env node
// CAMP-118: the project serves the European Union, and that is checked.
//
//   node scripts/ci/check-eu-scope.mjs
//   node scripts/ci/check-eu-scope.mjs --self-test
//
// 🔴 WHY THIS FILE EXISTS.
//
// "We build for the EU only" was written in CLAUDE.md, in the
// architecture, and in every decision for months. Measured 24.09.2026 on
// the live database:
//
//   ba  13 campsites   NOT in the EU
//   rs   2 campsites   NOT in the EU
//
// Nobody added them. The OSM import took what fell inside the Slovenian
// and Croatian extracts, and those extracts cross borders. The rule was
// true on paper and false in the data, which is the state in which rules
// quietly stop existing.
//
// The weekly import list had the same shape of problem from the other
// side: nine countries of twenty-seven, one of which (Switzerland) is not
// a member state at all.
//
// 🔴 WHY IT MATTERS MORE THAN TIDINESS.
//
// Every source this project relies on for safety is an EU instrument:
// MeteoAlarm, Copernicus EFFIS and EFAS, the national access points
// required by the ITS Directive. A campsite page outside the Union gets
// no hazard data behind it — and a hazard layer that is silent in some
// countries is worse than one that is absent everywhere, because people
// learn to trust it.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { chooseAction } from '../lib/entrypoint.mjs';

/**
 * The Union and its extracts, from the one machine-readable file.
 *
 * 🔴 This used to run a regex over eu.ts. Review demonstrated what
 * that costs: rewrite a single entry with double quotes — which prettier
 * does by default, and this repository has no .prettierrc — and the regex
 * returns a SHORTER list, silently. drop-non-eu.mjs then reads the missing
 * country as "outside the Union" and deletes it. Reproduced: two French
 * rows gone, exit 0, and the script's own post-delete verification passed,
 * because it re-read the same wrong list.
 *
 * JSON cannot be misparsed by accident, so the list moved there and the
 * regex is gone. An unreadable file throws, which is the only acceptable
 * failure mode for something that decides what to delete.
 */
const DATA = JSON.parse(
  readFileSync(
    new URL('../../apps/api/src/osm/eu-member-states.json', import.meta.url),
    'utf8',
  ),
);

if (!DATA.members || typeof DATA.members !== 'object') {
  throw new Error('eu-member-states.json has no "members" map');
}

/** ISO 3166-1 alpha-2 → the Geofabrik extract that covers it. */
export const GEOFABRIK = DATA.members;

/** The member states, sorted, from the same map. */
export const EU = Object.keys(GEOFABRIK).sort();

export const isEu = (code) => EU.includes(String(code ?? '').toLowerCase());

/** The regions the weekly import will fetch, read from the workflow. */
export function regionsInWorkflow(yaml) {
  const m = /DEFAULT_REGIONS:\s*>-\s*\n([\s\S]*?)\n\s*\n/.exec(yaml);
  if (!m) throw new Error('DEFAULT_REGIONS not found in the workflow');
  const regions = m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (regions.length === 0) throw new Error('DEFAULT_REGIONS is empty');
  return regions;
}

/**
 * Compare the workflow's list with the Union.
 *
 * 🔴 Both directions. A missing country means its campsites stop being
 * refreshed and nothing looks wrong; an extra one means we publish pages
 * with no hazard data behind them. Neither is a warning.
 */
export function compare(regions) {
  const want = new Set(Object.values(GEOFABRIK));
  const have = new Set(regions);
  const problems = [];

  for (const r of [...want].sort()) {
    if (!have.has(r)) problems.push(`missing: ${r}`);
  }
  for (const r of [...have].sort()) {
    if (!want.has(r)) {
      const known = Object.entries(GEOFABRIK).find(([, p]) => p === r);
      problems.push(
        `not an EU member state: ${r}${known ? '' : ' (and not a path we recognise)'}`,
      );
    }
  }
  if (regions.length !== new Set(regions).size) {
    problems.push('the list repeats a region');
  }
  return problems;
}

function selfTest() {
  const checks = [];
  const ok = (name, cond, detail = '') =>
    checks.push({ name, pass: Boolean(cond), detail });

  ok('the Union has 27 members', EU.length === 27, String(EU.length));
  ok('every code is two lower-case letters', EU.every((c) => /^[a-z]{2}$/.test(c)));
  ok('every member has an extract path',
    EU.every((c) => typeof GEOFABRIK[c] === 'string' && GEOFABRIK[c].startsWith('europe/')));
  ok('no two states share an extract',
    new Set(Object.values(GEOFABRIK)).size === EU.length);
  // \u{1F534} The countries a well-meaning hand is most likely to add.
  ok('no non-member has crept into the file',
    !['ch', 'no', 'gb', 'ba', 'rs', 'me', 'al', 'mk', 'ua', 'tr'].some((c) => c in GEOFABRIK));

  ok('Switzerland is not a member', !isEu('ch'));
  ok('Bosnia is not a member', !isEu('ba'));
  ok('Serbia is not a member', !isEu('rs'));
  ok('the United Kingdom is not a member', !isEu('gb'));
  ok('Norway is not a member', !isEu('no'));
  ok('Croatia is', isEu('hr'));
  ok('case does not matter', isEu('FR') && isEu('fr'));
  ok('nonsense is not a member', !isEu('') && !isEu(null) && !isEu('zz'));

  const full = Object.values(GEOFABRIK);
  ok('the full list has no problems', compare(full).length === 0);

  const short = full.filter((r) => r !== 'europe/malta');
  ok('a missing country is reported', compare(short).some((p) => /missing: europe\/malta/.test(p)));

  const extra = [...full, 'europe/switzerland'];
  ok('a non-member is reported', compare(extra).some((p) => /not an EU member state: europe\/switzerland/.test(p)));

  ok('a repeated region is reported', compare([...full, 'europe/malta']).some((p) => /repeats/.test(p)));

  const yaml = 'env:\n  DEFAULT_REGIONS: >-\n    europe/malta\n    europe/cyprus\n\njobs:\n';
  ok('regions are read from the workflow', regionsInWorkflow(yaml).join(',') === 'europe/malta,europe/cyprus');
  ok('an absent list is refused', (() => {
    try {
      regionsInWorkflow('env:\n  OTHER: x\n');
      return false;
    } catch {
      return true;
    }
  })());

  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  // 🔴 The count is asserted, and the line names this file. "20/20
  // passed" is a sentence several scripts could print, and a CI step
  // that greps for it could be satisfied by somebody else's self-test.
  const EXPECTED_CASES = 19;
  if (checks.length !== EXPECTED_CASES) {
    console.log(`FAIL ${checks.length} cases ran, expected ${EXPECTED_CASES}`);
    return false;
  }
  console.log(
    failed
      ? `\n✗ check-eu-scope self-test: ${failed} of ${checks.length} cases failed`
      : `\n✓ check-eu-scope self-test: ${checks.length} cases over the member-state list`,
  );
  return failed === 0;
}

// 🔴 Nothing below runs on import. The GEOFABRIK map is the repository's
// only country→extract table, and import-release.sh reads it from here;
// without this guard, importing it would run the whole check and exit.
// Same mistake as the fuel script and the restore gate, avoided in
// advance this time.
//
// 🔴 CAMP-285 ADDED `realpathSync`, AND IT WAS NOT DECORATION. Node
// resolves `import.meta.url` through the real path and leaves
// `process.argv[1]` exactly as written, so running this file through a
// symlink made the two sides never match: the self-test silently did not
// run, the step printed nothing, and it was green. Reproduced on
// 12.10.2026 — no mutation needed, just a link.
//
// Inside an IIFE with try/catch because realpathSync in the condition
// itself runs on every import and throws ENOENT when argv[1] is not a
// file — and this module IS imported, by import-release.mjs and
// drop-non-eu.mjs.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  // 🔴 `--selftest` used to fall through to the real check and print
  // "✓ all 27 member states, and nothing else". Green step, self-test
  // never run.
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test'],
    'check-eu-scope.mjs',
  );
  if (action.has('--self-test')) process.exit(selfTest() ? 0 : 1);
  else runCheck();
}

function runCheck() {
const yaml = readFileSync('.github/workflows/osm-weekly.yml', 'utf8');
const regions = regionsInWorkflow(yaml);
const problems = compare(regions);

console.log(`weekly import covers ${regions.length} regions`);

if (problems.length > 0) {
  console.error('\n✗ the import list and the European Union disagree:\n');
  for (const p of problems) console.error(`   ${p}`);
  console.error(
    '\nThe project serves the EU (CAMP-118). A member state missing from\n' +
      'this list stops being refreshed and nothing looks wrong; a country\n' +
      'that is not a member gets pages with no hazard data behind them.\n',
  );
  process.exit(1);
}

console.log(`✓ all ${EU.length} member states, and nothing else`);
}
