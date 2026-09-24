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
import { readFileSync } from 'node:fs';

const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';
const APPLY = process.argv.includes('--apply');

/** The Union, from the same file the import filter uses. */
export function readEu(source) {
  const block = /EU_MEMBER_STATES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source);
  if (!block) throw new Error('EU_MEMBER_STATES not found in apps/api/src/osm/eu.ts');
  const codes = [...block[1].matchAll(/'([a-z]{2})'/g)].map((m) => m[1]);
  if (codes.length === 0) throw new Error('EU_MEMBER_STATES is empty');
  return codes;
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

  ok('the EU list is read, not restated', readEu(
    "export const EU_MEMBER_STATES = [\n  'aa',\n  'bb',\n] as const;",
  ).join(',') === 'aa,bb');

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

const eu = readEu(
  readFileSync(new URL('../../apps/api/src/osm/eu.ts', import.meta.url), 'utf8'),
);

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
