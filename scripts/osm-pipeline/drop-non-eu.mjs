#!/usr/bin/env node
// CAMP-118: remove campsites outside the European Union.
//
//   node scripts/osm-pipeline/drop-non-eu.mjs            # show, change nothing
//   node scripts/osm-pipeline/drop-non-eu.mjs --apply    # delete them
//   node scripts/osm-pipeline/drop-non-eu.mjs --self-test
//
// 🔴 Why a script and not one DELETE typed at a prompt.
//
// It is repeatable, it is reviewable in a diff, and it defaults to
// changing nothing — which matters because the one thing this project
// cannot afford is losing data it cannot rebuild.
//
// 🔴 And it REFUSES to delete a row that carries anything we computed.
//
// Campsite geometry and tags come from OpenStreetMap and the weekly
// import rebuilds them. Computed surroundings do not: elevation is
// rationed by Open-Meteo at about 1,100 campsites a day, and owner
// corrections have no source at all. So a row outside the Union that
// somehow holds either of those is reported and left alone, for a human
// to decide about. Measured 24.09.2026: all 15 such rows held neither,
// which is why this is a safeguard rather than an obstacle.

import { execFileSync } from 'node:child_process';
import { EU, GEOFABRIK } from '../ci/check-eu-scope.mjs';

const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';
const APPLY = process.argv.includes('--apply');

/**
 * 🔴 REFUSE TO RUN ON A LIST THAT LOOKS WRONG.
 *
 * This script deletes rows. It used to carry its OWN copy of a regex that
 * recovered the member states by parsing eu.ts, and it checked nothing
 * about the result. Review demonstrated the consequence: rewrite one entry
 * in eu.ts with double quotes — which prettier does by default, and this
 * repository has no .prettierrc — and the regex returns a shorter list.
 * Every campsite in the missing country then reads as "outside the Union".
 *
 *   two French rows deleted, exit 0, and the post-delete verification
 *   PASSED, because it re-read the same wrong list
 *
 * On the live database that country is 23,652 rows.
 *
 * The list now comes from eu-member-states.json through the same module
 * the CI check uses, so there is one list. And before deleting anything,
 * that list is sanity-checked here too — because a script whose failure is
 * irreversible does not get to assume its inputs.
 */
export function listProblems(eu, geofabrik) {
  const problems = [];
  const paths = Object.keys(geofabrik);
  if (eu.length !== paths.length) {
    problems.push(`${eu.length} member states but ${paths.length} extract paths`);
  }
  if (eu.length < 20) {
    problems.push(`only ${eu.length} member states — the Union has not shrunk that far`);
  }
  for (const c of eu) {
    if (!/^[a-z]{2}$/.test(c)) problems.push(`"${c}" is not an ISO 3166-1 alpha-2 code`);
    if (typeof geofabrik[c] !== 'string') problems.push(`${c} has no extract path`);
  }
  // The four largest holdings. If any of them is missing from the list,
  // something has gone very wrong and this script is about to delete a
  // country's worth of campsites.
  for (const c of ['fr', 'de', 'it', 'es']) {
    if (!eu.includes(c)) problems.push(`${c} is missing from the list`);
  }
  return problems;
}

/** The same check, as the caller needs it: stop before touching anything. */
function assertPlausible(eu, geofabrik) {
  const problems = listProblems(eu, geofabrik);
  if (problems.length === 0) return;
  console.error('✗ refusing to touch the database — the member-state list looks wrong:\n');
  for (const p of problems) console.error(`   ${p}`);
  console.error('\nNothing was deleted. Fix apps/api/src/osm/eu-member-states.json first.\n');
  process.exit(2);
}

/**
 * Which rows may go, and which must not.
 *
 * Pure, so the rule that protects computed data can be tested without a
 * database — it is the only part here whose failure is irreversible.
 */
export function classify(rows, eu) {
  const member = new Set(eu);
  const removable = [];
  const keep = [];
  for (const r of rows) {
    if (member.has(String(r.country ?? '').toLowerCase())) continue;
    const precious =
      (r.has_context === true || r.has_context === 't') ||
      (r.has_overrides === true || r.has_overrides === 't');
    (precious ? keep : removable).push(r);
  }
  return { removable, keep };
}

const psql = (sql) =>
  execFileSync('psql', [DB, '-tAX', '-F', '|', '-c', sql], { encoding: 'utf8' }).trim();

function selfTest() {
  const checks = [];
  const ok = (n, c, d = '') => checks.push({ name: n, pass: Boolean(c), detail: d });
  const eu = ['fr', 'hr', 'si'];

  const rows = [
    { slug: 'a', country: 'fr', has_context: false, has_overrides: false },
    { slug: 'b', country: 'ba', has_context: false, has_overrides: false },
    { slug: 'c', country: 'rs', has_context: true, has_overrides: false },
    { slug: 'd', country: 'ch', has_context: false, has_overrides: true },
    { slug: 'e', country: 'BA', has_context: false, has_overrides: false },
  ];
  const { removable, keep } = classify(rows, eu);

  ok('a member state is never touched', !removable.concat(keep).some((r) => r.slug === 'a'));
  ok('a plain non-member row is removable', removable.some((r) => r.slug === 'b'));
  ok('case does not save a non-member', removable.some((r) => r.slug === 'e'));
  ok('a row with computed context is KEPT', keep.some((r) => r.slug === 'c'));
  ok('a row with owner corrections is KEPT', keep.some((r) => r.slug === 'd'));
  ok('nothing is both removed and kept',
    removable.every((r) => !keep.includes(r)));

  ok('psql booleans are understood too', (() => {
    const r = classify([{ slug: 'x', country: 'ba', has_context: 't', has_overrides: 'f' }], eu);
    return r.keep.length === 1 && r.removable.length === 0;
  })());

  ok('an empty database is not an error', (() => {
    const r = classify([], eu);
    return r.removable.length === 0 && r.keep.length === 0;
  })());

  // \u{1F534} The guard that stands between a mis-read list and a deleted
  // country. It exits the process, so it is driven as data here.
  ok('the real list passes', listProblems(EU, GEOFABRIK).length === 0);

  // \u{1F534} Exactly the mis-parse review used to delete France: one
  // country silently absent from the list.
  const withoutFrance = EU.filter((c) => c !== 'fr');
  ok('a list missing France is refused',
    listProblems(withoutFrance, GEOFABRIK).some((p) => /fr is missing/.test(p)));
  ok('a truncated list is refused',
    listProblems(['fr', 'de'], { fr: 'europe/france', de: 'europe/germany' })
      .some((p) => /has not shrunk/.test(p)));
  ok('a code that is not ISO 3166-1 alpha-2 is refused',
    listProblems([...EU, 'bel'], { ...GEOFABRIK, bel: 'europe/belgium' })
      .some((p) => /alpha-2/.test(p)));
  ok('a member with no extract is refused',
    listProblems([...EU, 'zz'], GEOFABRIK).some((p) => /zz has no extract/.test(p)));
  ok('the real list is the whole Union', EU.length === 27 && EU.includes('fr'));
  ok('every member has an extract', EU.every((c) => typeof GEOFABRIK[c] === 'string'));

  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed === 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

const eu = EU;
assertPlausible(eu, GEOFABRIK);

const raw = psql(`
  SELECT slug, lower(country) AS country,
         (context <> '{}'::jsonb) AS has_context,
         (owner_overrides <> '{}'::jsonb) AS has_overrides
    FROM camping_spots
   WHERE lower(country) <> ALL (ARRAY[${eu.map((c) => `'${c}'`).join(',')}])
   ORDER BY country, slug`);

const rows = raw
  ? raw.split('\n').map((line) => {
      const [slug, country, has_context, has_overrides] = line.split('|');
      return { slug, country, has_context, has_overrides };
    })
  : [];

const { removable, keep } = classify(rows, eu);

console.log(`outside the European Union: ${rows.length} campsites`);
for (const r of rows) {
  const why = keep.includes(r) ? '  KEPT — carries computed data' : '';
  console.log(`  ${r.country}  ${r.slug}${why}`);
}

if (keep.length > 0) {
  console.log(
    `\n⚠️ ${keep.length} row(s) hold computed surroundings or owner corrections.\n` +
      '   Those are not rebuildable from OpenStreetMap, so this script will not\n' +
      '   remove them. Decide about them by hand.',
  );
}

if (removable.length === 0) {
  console.log('\n✓ nothing to remove');
  process.exit(0);
}

if (!APPLY) {
  console.log(`\n${removable.length} row(s) would be removed. Re-run with --apply to do it.`);
  process.exit(0);
}

const slugs = removable.map((r) => `'${r.slug.replace(/'/g, "''")}'`).join(',');
psql(`DELETE FROM camping_spots WHERE slug IN (${slugs})`);
const left = Number(
  psql(`SELECT count(*) FROM camping_spots
         WHERE lower(country) <> ALL (ARRAY[${eu.map((c) => `'${c}'`).join(',')}])`),
);
console.log(`\n✓ removed ${removable.length}; ${left} non-EU rows remain (kept or new)`);
if (left !== keep.length) {
  console.error('✗ the count after deleting does not match what was kept');
  process.exit(1);
}
