#!/usr/bin/env node
// CAMP-58: prove the backup can be restored — nightly, not once.
//
//   node scripts/backup/check-restore.mjs --manifest <dir>/manifest.json
//   node scripts/backup/check-restore.mjs --self-test
//
// 🔴 THE CARD'S OWN BAR, AND WHY IT IS THIS AND NOT "THE BACKUP RAN".
//
// "A backup you have not restored from is an assumption, not a backup."
// Everything up to and including a checksum proves that bytes survived.
// It does not prove that the bytes can become a working database again,
// and that is the only property anybody actually wants.
//
// So this runs against a database that was restored FROM the archive,
// and it checks four things the card asks for:
//
//   1. the rows arrived      — counted against the manifest, not guessed
//   2. PostGIS works on them — a real ST_DWithin over restored geometry,
//                              because a restore that loads rows into a
//                              table with no spatial index or a broken
//                              SRID still "succeeds" and then fails on
//                              the first map request
//   3. nothing is empty      — zero rows is the shape a silent failure
//                              takes, and it must never read as a pass
//   4. it finished in time   — a restore that takes six hours is not a
//                              restore, it is an outage with a happy
//                              ending
//
// 🔴 Written to be run by a schedule, so it says what it checked even
// when everything is fine. A green check that prints nothing teaches
// nobody what it was guarding.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * How long a restore of this size may take before it stops counting.
 *
 * 🔴 A budget in seconds, not a vibe. The archive is small today
 * (measured 24.09.2026: about 120 kB across five files), and the point
 * of the number is that it is checked at all — the day it starts taking
 * ten minutes, somebody should be told while it is still a curiosity
 * rather than after it is the recovery plan.
 */
export const BUDGET_SECONDS = Number(opt('budget', '300'));

/** Rows a restored database must have before we call it restored. */
export const MIN_ROWS = 1;

/**
 * What the manifest says each archive holds.
 *
 * Kept pure so the comparison can be tested without a database — the
 * comparison is where a wrong answer is dangerous, and the database is
 * the part that is hard to fake.
 */
export function parseManifest(json) {
  const m = typeof json === 'string' ? JSON.parse(json) : json;
  if (!m || typeof m !== 'object' || !m.files) {
    throw new Error('manifest has no "files"');
  }
  const out = {};
  for (const [name, v] of Object.entries(m.files)) {
    if (typeof v?.rows !== 'number') {
      throw new Error(`manifest entry ${name} has no row count`);
    }
    out[name.replace(/\.csv\.gz$/, '')] = v.rows;
  }
  if (Object.keys(out).length === 0) {
    throw new Error('manifest lists no files');
  }
  return out;
}

/**
 * Compare what the manifest promised with what the database holds.
 *
 * 🔴 Returns a list of problems rather than throwing on the first one.
 * A restore that lost two tables should say so once, not be discovered
 * one table per nightly run.
 *
 * 🔴 And a count of zero is ALWAYS a problem, even when the manifest
 * also said zero. An empty archive restoring to an empty database is
 * arithmetically consistent and proves nothing at all — it is exactly
 * what a broken backup pipeline produces, and the check that waves it
 * through is the check that lets it run for a year.
 */
export function compareCounts(expected, actual, { minRows = MIN_ROWS } = {}) {
  const problems = [];
  const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();

  for (const name of names) {
    const want = expected[name];
    const got = actual[name];
    if (want === undefined) {
      problems.push(`${name}: restored ${got} rows that the manifest never mentioned`);
      continue;
    }
    if (got === undefined) {
      problems.push(`${name}: in the manifest with ${want} rows, but not restored at all`);
      continue;
    }
    if (got !== want) {
      problems.push(`${name}: manifest says ${want} rows, database has ${got}`);
    }
  }

  const total = Object.values(actual).reduce((a, b) => a + b, 0);
  if (total < minRows) {
    problems.push(
      `nothing was restored (${total} rows across ${names.length} tables) — ` +
        'an empty restore is a failure however consistent it looks',
    );
  }
  return problems;
}

/** Did it finish inside the budget? */
export function withinBudget(seconds, budget = BUDGET_SECONDS) {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= budget;
}

const psql = (sql) =>
  execFileSync('psql', [DB, '-tAX', '-c', sql], { encoding: 'utf8' }).trim();

/**
 * 🔴 The check that a checksum cannot make.
 *
 * Rows in a table are not a working database. This asks PostGIS a
 * question of the same shape the map asks on every request — is anything
 * within N metres of this point — against the geometry that came back
 * from the archive. A restore that dropped the spatial index, lost the
 * SRID or wrote the coordinates as text passes every row count and fails
 * here, which is the whole reason this step exists.
 */
function postgisAnswers() {
  const version = psql('SELECT postgis_version()');
  if (!version) throw new Error('PostGIS is not installed in the restored database');

  // A generous radius around a point in the Alps: the fixture and the
  // real database both have campsites there. The assertion is not the
  // number — it is that the query plans, runs and returns a number.
  const n = Number(
    psql(`
      SELECT count(*) FROM camping_spots
       WHERE location IS NOT NULL
         AND ST_DWithin(location, ST_MakePoint(14.09, 46.36)::geography, 500000)
    `),
  );
  if (!Number.isFinite(n)) throw new Error('ST_DWithin did not return a number');
  return { version, within500km: n };
}

// ---------------------------------------------------------------------

function selfTest() {
  const checks = [];
  const ok = (name, cond, detail = '') =>
    checks.push({ name, pass: Boolean(cond), detail });
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  const manifest = {
    takenAt: '2026-09-24T18:00:00Z',
    files: {
      'camping_spots_context.csv.gz': { rows: 289, sha256: 'x' },
      'guides.csv.gz': { rows: 36, sha256: 'y' },
    },
  };
  const expected = parseManifest(manifest);
  ok('manifest names are stripped of .csv.gz', expected.guides === 36, JSON.stringify(expected));
  ok('manifest is read from a string too', parseManifest(JSON.stringify(manifest)).guides === 36);
  ok('a manifest with no files is refused', throws(() => parseManifest({ files: {} })));
  ok('a manifest entry with no count is refused', throws(() =>
    parseManifest({ files: { 'a.csv.gz': { sha256: 'z' } } }),
  ));

  ok('a matching restore has no problems',
    compareCounts(expected, { camping_spots_context: 289, guides: 36 }).length === 0);

  const short = compareCounts(expected, { camping_spots_context: 288, guides: 36 });
  ok('a short table is reported', short.length === 1 && /288/.test(short[0]), short[0]);

  const missing = compareCounts(expected, { guides: 36 });
  ok('a table that did not restore is reported',
    missing.some((p) => /not restored at all/.test(p)), missing.join(' | '));

  const extra = compareCounts(expected, { camping_spots_context: 289, guides: 36, stray: 4 });
  ok('an unexpected table is reported',
    extra.some((p) => /never mentioned/.test(p)), extra.join(' | '));

  // 🔴 The case worth having a test for.
  const empty = compareCounts({ guides: 0 }, { guides: 0 });
  ok('an empty restore fails even when it matches an empty manifest',
    empty.length === 1 && /nothing was restored/.test(empty[0]), empty[0]);

  const twoMissing = compareCounts({ a: 1, b: 2, c: 3 }, { a: 1 });
  ok('every missing table is reported, not just the first',
    twoMissing.filter((p) => /not restored at all/.test(p)).length === 2);

  ok('the budget accepts a quick restore', withinBudget(12, 300));
  ok('the budget refuses a slow one', !withinBudget(301, 300));
  ok('the budget refuses nonsense', !withinBudget(Number.NaN, 300) && !withinBudget(-1, 300));

  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed === 0;
}

if (args.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

const manifestPath = opt('manifest');
if (!manifestPath) {
  console.error('Usage: check-restore.mjs --manifest <dir>/manifest.json [--budget 300]');
  process.exit(2);
}

const started = Number(opt('started', '0'));
const elapsed = started > 0 ? (Date.now() - started * 1000) / 1000 : 0;

const expected = parseManifest(readFileSync(manifestPath, 'utf8'));

// Every table named in the manifest, counted in the restored database.
// `camping_spots_context` is a projection of camping_spots, so it is
// counted the way the backup selected it.
const actual = {};
for (const name of Object.keys(expected)) {
  const sql =
    name === 'camping_spots_context'
      ? `SELECT count(*) FROM camping_spots
          WHERE context <> '{}'::jsonb
             OR owner_overrides <> '{}'::jsonb
             OR missing_since IS NOT NULL`
      : `SELECT count(*) FROM ${name}`;
  try {
    actual[name] = Number(psql(sql));
  } catch {
    // A table the manifest names but the restored database does not have
    // is a problem compareCounts should report, not a crash here.
  }
}

const problems = compareCounts(expected, actual);

let postgis;
try {
  postgis = postgisAnswers();
} catch (err) {
  problems.push(`PostGIS: ${err.message}`);
}

console.log('restored from   ' + manifestPath);
for (const name of Object.keys(expected).sort()) {
  const got = actual[name];
  console.log(
    `  ${got === expected[name] ? '✓' : '✗'} ${name.padEnd(26)} ` +
      `${String(got ?? '—').padStart(6)} / ${expected[name]}`,
  );
}
if (postgis) {
  console.log(`  ✓ PostGIS ${postgis.version.split(' ')[0]} answered ST_DWithin (${postgis.within500km} spots within 500 km)`);
}
if (elapsed > 0) {
  const fits = withinBudget(elapsed);
  console.log(`  ${fits ? '✓' : '✗'} took ${elapsed.toFixed(1)}s of a ${BUDGET_SECONDS}s budget`);
  if (!fits) problems.push(`restore took ${elapsed.toFixed(1)}s, over the ${BUDGET_SECONDS}s budget`);
}

if (problems.length > 0) {
  console.error('\n✗ the restore did not hold up:');
  for (const p of problems) console.error(`   ${p}`);
  console.error(
    '\nA backup that cannot be restored is not a backup. Fix this before\n' +
      'anything else — every other safeguard assumes this one works.\n',
  );
  process.exit(1);
}

console.log('\n✓ restored, counted, and PostGIS answers on the restored data\n');
