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

/**
 * The Union, read from the API's own source of truth.
 *
 * 🔴 Not a second copy. Two lists of member states in one repository is
 * two lists that will disagree, and the disagreement will be discovered
 * the way the original problem was — by finding Bosnian campsites in a
 * database whose scope is the EU.
 *
 * `apps/api/src/osm/eu.ts` is the list; the import filter uses it at
 * runtime and this check parses it. Precedent in the repo:
 * throttle.spec.ts reads spots.controller.ts to assert a decorator is
 * present, for the same reason — the assertion has to be about the real
 * thing, not about a restatement of it.
 */
export function readEu(source) {
  const block = /EU_MEMBER_STATES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source);
  if (!block) throw new Error('EU_MEMBER_STATES not found in apps/api/src/osm/eu.ts');
  const codes = [...block[1].matchAll(/'([a-z]{2})'/g)].map((m) => m[1]);
  if (codes.length === 0) throw new Error('EU_MEMBER_STATES is empty');
  return codes;
}

export const EU = readEu(
  readFileSync(new URL('../../apps/api/src/osm/eu.ts', import.meta.url), 'utf8'),
);

/**
 * Geofabrik's path for each member state.
 *
 * 🔴 Written out, not derived. Geofabrik names regions its own way, and
 * two of them are not the country name: Czechia is `czech-republic`, and
 * Ireland only exists as `ireland-and-northern-ireland` — an extract that
 * includes part of the United Kingdom. That is the shape of the source,
 * and the country filter at import is what keeps non-EU rows out.
 */
export const GEOFABRIK = {
  at: 'europe/austria',
  be: 'europe/belgium',
  bg: 'europe/bulgaria',
  hr: 'europe/croatia',
  cy: 'europe/cyprus',
  cz: 'europe/czech-republic',
  dk: 'europe/denmark',
  ee: 'europe/estonia',
  fi: 'europe/finland',
  fr: 'europe/france',
  de: 'europe/germany',
  gr: 'europe/greece',
  hu: 'europe/hungary',
  ie: 'europe/ireland-and-northern-ireland',
  it: 'europe/italy',
  lv: 'europe/latvia',
  lt: 'europe/lithuania',
  lu: 'europe/luxembourg',
  mt: 'europe/malta',
  nl: 'europe/netherlands',
  pl: 'europe/poland',
  pt: 'europe/portugal',
  ro: 'europe/romania',
  sk: 'europe/slovakia',
  si: 'europe/slovenia',
  es: 'europe/spain',
  se: 'europe/sweden',
};

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
  ok('the list really is read from eu.ts, not restated here', (() => {
    const fake = "export const EU_MEMBER_STATES = [\n  'aa', // A\n  'bb', // B\n] as const;";
    return readEu(fake).join(',') === 'aa,bb';
  })());
  ok('a missing list in eu.ts is refused, not defaulted', (() => {
    try {
      readEu('export const SOMETHING_ELSE = [];');
      return false;
    } catch {
      return true;
    }
  })());
  ok('every member has a Geofabrik path', Object.keys(GEOFABRIK).length === 27);
  ok('the two lists agree', EU.every((c) => GEOFABRIK[c]));
  ok('no duplicate paths', new Set(Object.values(GEOFABRIK)).size === 27);

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
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed === 0;
}

// 🔴 Nothing below runs on import. The GEOFABRIK map is the repository's
// only country→extract table, and import-release.sh reads it from here;
// without this guard, importing it would run the whole check and exit.
// Same mistake as the fuel script and the restore gate, avoided in
// advance this time.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (!invokedDirectly) {
  // Imported for EU / GEOFABRIK.
} else if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
} else {
  runCheck();
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
