#!/usr/bin/env node
// 🔴 Does the fixture still hold the SHAPES the tests stand on?
//
// CAMP-173. `check-fixture-not-shrunk.mjs` counts HOW MANY rows, and a
// regeneration from a newer database passed it — 73 → 90 campsites,
// 43 → 62 bathing waters — while producing a fixture nothing could use:
// 89 campsites across 9 countries with **no Slovenia at all**, one
// surviving id out of 72, and a load that died on the gone block with
// "expected to mark exactly one campsite gone, marked 0".
//
// The tool worked, the guard said "not smaller", and the result was
// rubbish. A count is not a shape.
//
// `_select.sql` builds this fixture out of deliberate pieces — a region
// big enough to paginate, a region of exactly one, a campsite that says
// it has toilets and one that says it has none — and every one of those
// is a test's subject. None of them is named anywhere that fails when it
// disappears. This file names them.
//
// 🔴 It guards the COMMITTED fixture, in CI. `regenerate.sh` only
// prints a reminder to run it — it does not run it, and an earlier
// draft of this header said it did. A file that describes a guard it
// does not have is the same failure as a guard that does not bite, so
// the sentence is corrected rather than the script quietly changed:
// wiring it into regenerate.sh is CAMP-173's follow-up, not a claim to
// make here.
//
// Run it by hand on a candidate:  node scripts/ci/check-fixture-shape.mjs <file>

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SEED = join(ROOT, 'apps', 'api', 'test', 'fixtures', 'ci-seed.sql');
const API_FILE = join(ROOT, 'apps', 'web', 'src', 'lib', 'api.ts');

/**
 * The paginator's own page size, read from the paginator.
 *
 * 🔴 Retyped as `24` and compared with `>=`, this guard certified "it
 * paginates" for a fixture whose biggest region holds exactly 24 — the
 * state in which `hubs.spec.ts` calls `test.skip('No region currently
 * exceeds 24 campsites, so nothing paginates')`. The guard's own error
 * text said the words the paginator was printing as it skipped.
 *
 * So the number is read, and the comparison below is `>`, which is the
 * predicate hubs.spec.ts uses: `all.find(r => r.spots > REGION_PER_PAGE)`.
 */
export function regionPerPage(src) {
  const m = /export const REGION_PER_PAGE\s*=\s*(\d+)/.exec(src);
  return m ? Number(m[1]) : null;
}

/**
 * Split one SQL tuple on its top-level commas.
 *
 * ⚠️ The same twenty lines live in check-fixture-counts.mjs. They are
 * duplicated on purpose for now, because the two arrived on separate
 * branches and sharing a module across both would have made each one
 * wait for the other. Fold them together once both have landed — and
 * until then, a change to one is a change to both.
 */
export function splitTuple(s) {
  const out = [];
  let buf = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === "'" && s[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      if (c === "'") quoted = false;
      buf += c;
      continue;
    }
    if (c === "'") {
      quoted = true;
      buf += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  out.push(buf.trim());
  return out;
}

/** `'paid'::enum` → `paid`; `NULL` → null. */
export function literal(v) {
  const bare = v.replace(/::[A-Za-z_][\w.]*$/, '').trim();
  if (/^NULL$/i.test(bare)) return null;
  const m = /^'([\s\S]*)'$/.exec(bare);
  return m ? m[1].replace(/''/g, "'") : bare;
}

/** The literal `INSERT INTO camping_spots` rows, as objects. */
export function readSpots(sql) {
  const rows = [];
  rows.skipped = [];
  const re =
    /INSERT INTO camping_spots\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\);\s*$/gm;
  for (const m of sql.matchAll(re)) {
    const cols = m[1].split(',').map((c) => c.trim());
    const vals = splitTuple(m[2]);
    if (cols.length !== vals.length) {
      // 🔴 Counted, never dropped quietly. `check-fixture-not-shrunk.mjs`
      // states the policy this file has to share: a row it cannot count
      // throws, because "cannot count" that reads as zero is how a guard
      // becomes a no-op. Today this skips exactly the one computed twin;
      // a parser that started skipping forty would otherwise report a
      // confident ✓ over a third of the fixture.
      rows.skipped.push(cols[0] ?? '?');
      continue;
    }
    const row = {};
    cols.forEach((c, i) => (row[c] = literal(vals[i])));
    rows.push(row);
  }
  return rows;
}

/**
 * The row `ci-seed.sql`'s final DO block will mark gone at load time.
 *
 * Mirrors it exactly: a region, no explicit toilets answer, no computed
 * context, `ORDER BY slug DESC LIMIT 1`. `undefined` means the block
 * will mark nothing and the load will raise.
 */
export function goneTarget(present) {
  return present
    .filter((r) => toilets(r) === 'unknown' && (r.context ?? '{}') === '{}')
    .sort((a, b) => String(b.slug).localeCompare(String(a.slug)))[0];
}

const toilets = (row) => {
  try {
    return JSON.parse(row.amenities ?? '{}').toilets ?? 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * Everything the fixture must still contain, each with the test that
 * stops meaning anything without it.
 *
 * 🔴 Named, not counted. "At least as many rows" is what let a fixture
 * with no Slovenia through.
 */
export function shapeProblems(rows, perPage = 24) {
  const problems = [];
  const present = rows.filter((r) => r.region && r.missing_since === null);

  // 🔴 The file is not the database. `ci-seed.sql` ends with a DO block
  // that marks ONE more row gone at load time — the highest slug among
  // rows with a region, no explicit toilets answer and no computed
  // context — so every count taken from the file is one row generous
  // for exactly that region.
  //
  // It matters at the edges, which is the only place this guard lives:
  // on the committed fixture the doomed row is `kamp-vinia`, the sole
  // member of Bjelovarsko-bilogorska. Read from the file that region
  // holds 1 and the "exactly one" subject is satisfied; after loading it
  // holds 0. A fixture can therefore pass this guard and still leave
  // `hubs.spec.ts` throwing "Need at least one indexable and one thin
  // region" — the CAMP-71 subject this guard exists to protect.
  const doomed = goneTarget(present);
  const live = present.filter((r) => r !== doomed);

  const byCountry = {};
  for (const r of live) {
    const c = String(r.country).toUpperCase();
    byCountry[c] = (byCountry[c] ?? 0) + 1;
  }
  // `/camping/si/…` is written into seven e2e assertions. A fixture
  // without Slovenia leaves them testing a 404.
  for (const c of ['SI', 'HR']) {
    if (!byCountry[c]) problems.push(`no ${c} campsites at all — e2e paths under /camping/${c.toLowerCase()}/ have no subject`);
  }

  const byRegion = {};
  for (const r of live) byRegion[r.region] = (byRegion[r.region] ?? 0) + 1;
  const sizes = Object.values(byRegion);

  if (!sizes.some((n) => n > perPage)) {
    problems.push(
      `no region holds more than ${perPage} campsites — nothing paginates, ` +
        'so the paginator tests have no subject (hubs.spec.ts skips itself)',
    );
  }
  if (!sizes.some((n) => n === 1)) {
    problems.push('no region holds exactly 1 campsite — the "reachable but not indexed" case (CAMP-71) has no subject');
  }

  for (const want of ['yes', 'no']) {
    if (!live.some((r) => toilets(r) === want)) {
      problems.push(`no campsite answers toilets="${want}" — the three-state amenity model has no ${want === 'no' ? 'honest negative' : 'positive'}`);
    }
  }

  // 🔴 CAMP-199. The fixture must carry the surroundings we compute,
  // because the pages that need them most are the ones it was missing
  // them on.
  //
  // Measured 04.10.2026: in production, 61 557 campsites of 61 557 have
  // a computed context. In this fixture, 37 of 73 rows had `'{}'` — and
  // all ten of the Zadarska campsites failing the duplicate-page guard
  // were among them. So the paragraph built from those figures rendered
  // EMPTY on exactly the pages it was written to rescue, the guard's
  // verdict did not move by a decimal, and the whole change looked
  // ineffective when it had simply never run.
  //
  // A fixture that lacks a field every real row has is not a smaller
  // sample. It is a different site.
  const withContext = live.filter((r) => (r.context ?? '{}') !== '{}').length;
  if (withContext * 2 < live.length) {
    problems.push(
      `only ${withContext} of ${live.length} campsites carry a computed context — ` +
        'in production every one does, so anything built from those figures is ' +
        'untested here (CAMP-199)',
    );
  }

  // Zero candidates is the load error the card quotes: "marked 0".
  if (doomed === undefined) {
    problems.push('nothing is eligible for the gone block — loading will die with "expected to mark exactly one campsite gone, marked 0"');
  }

  return problems;
}

function run(file, log = console, apiSrc = undefined) {
  let sql;
  try {
    sql = readFileSync(file, 'utf8');
  } catch (err) {
    log.error(`✗ cannot read ${file}: ${(err && err.message) || err}`);
    return 1;
  }
  const rows = readSpots(sql);
  if (rows.length === 0) {
    log.error(`✗ ${file} holds no camping_spots rows at all`);
    return 1;
  }
  // 🔴 A row the parser could not read is a row this guard did not
  // check. One is the known computed twin; more than one means the
  // parser has fallen behind the fixture's syntax, and a ✓ over the
  // remainder would be a smaller claim than it looks.
  if (rows.skipped.length > 1) {
    log.error(
      `✗ ${file}: ${rows.skipped.length} INSERT rows could not be parsed ` +
        '(column and value counts disagree), so they were not checked.\n' +
        '  One is the computed twin and expected. More than one means this\n' +
        '  parser no longer reads the fixture it is guarding.',
    );
    return 1;
  }

  const perPage = regionPerPage(apiSrc ?? readFileSync(API_FILE, 'utf8'));
  if (perPage === null) {
    log.error(
      '✗ REGION_PER_PAGE could not be read from apps/web/src/lib/api.ts —\n' +
        '  without it the pagination subject would be checked against a\n' +
        '  number retyped here, which is how this guard certified a fixture\n' +
        '  that made the paginator skip itself.',
    );
    return 1;
  }

  const problems = shapeProblems(rows, perPage);
  if (problems.length > 0) {
    log.error('✗ The fixture no longer holds what the tests stand on:\n');
    for (const p of problems) log.error(`  ${p}`);
    log.error(
      '\n  A regeneration can satisfy check-fixture-not-shrunk.mjs — which\n' +
        '  counts rows — and still produce this. Fix the selection in\n' +
        '  apps/api/test/fixtures/_select.sql rather than the expectation\n' +
        '  here: every line above names a test that would otherwise pass\n' +
        '  over missing data.',
    );
    return 1;
  }
  // 🔴 Names the FILE. The old line printed only the parser's own count,
  // so a run against the wrong file looked exactly like a run against
  // the right one.
  log.log(
    `✓ ${file}: ${rows.length} campsites parsed` +
      (rows.skipped.length ? ` (${rows.skipped.length} skipped)` : '') +
      `, paginator floor >${perPage}, every subject the tests stand on is present`,
  );
  return 0;
}

// Prove each assertion can fail. Nothing here reads the real fixture.
function selfTest() {
  let rc = 0;
  const bad = (m) => {
    console.error(`✗ REHEARSAL FAILED: ${m}`);
    rc = 1;
  };
  const quiet = { log: () => {}, error: () => {} };
  const PER_PAGE = 24;

  // 🔴 Context defaults to a real value now, not '{}': the new subject
  // below requires most rows to carry one, and a rehearsal whose own
  // baseline failed it would report the wrong thing everywhere.
  const spot = (slug, country, region, toiletsValue = 'unknown', context = '{"at":{"lat":1,"lon":1}}') => ({
    slug,
    country,
    region,
    missing_since: null,
    amenities: `{"toilets": "${toiletsValue}"}`,
    context,
  });

  /**
   * A fixture that satisfies every shape, as the baseline to break.
   *
   * 🔴 Laid out so that ONE break reports ONE problem. The earlier
   * version put the big region, the "yes" row and every gone candidate
   * in Slovenia, so "Slovenia gone" reported three problems at once and
   * the assertion `found.some(matches)` could not tell which rule had
   * actually fired. Each subject now lives in a third country that no
   * country break touches.
   *
   * 🔴 `zzz-doomed` is the row `ci-seed.sql` would mark gone at load,
   * and it is alone in its region ON PURPOSE: that is the shape that
   * used to slip through — a region of one in the file and of zero in
   * the database.
   */
  const whole = () => [
    ...Array.from({ length: PER_PAGE + 1 }, (_x, i) =>
      spot(`pag-${String(i).padStart(2, '0')}`, 'AT', 'Big')),
    // 🔴 Not in `Big`. Parked there, they padded it past the page size
    // and the "exactly a page" break below could not reach the boundary
    // it exists to test.
    spot('yes-at', 'AT', 'Side', 'yes'),
    spot('no-at', 'AT', 'Side', 'no'),
    spot('thin-at', 'AT', 'Lonely'),
    // The one the loader will mark gone: empty context by definition,
    // because that is what the DO block selects on.
    spot('zzz-doomed', 'AT', 'Doomed', 'unknown', '{}'),
    spot('si-a', 'SI', 'Bovec'),
    spot('si-b', 'SI', 'Bovec'),
    spot('hr-a', 'HR', 'Zagreb'),
    spot('hr-b', 'HR', 'Zagreb'),
  ];

  const first = shapeProblems(whole(), PER_PAGE);
  if (first.length !== 0) bad(`a complete fixture was reported broken: ${first.join('; ')}`);

  // 🔴 The load simulation, asserted rather than assumed: `zzz-doomed`
  // is the row the DO block picks, and `Doomed` must therefore not
  // count as the region of exactly one.
  const picked = goneTarget(whole().filter((r) => r.region && r.missing_since === null));
  if (picked?.slug !== 'zzz-doomed') bad(`gone target is ${picked?.slug}, not zzz-doomed`);
  const onlyDoomedIsThin = whole().filter((r) => r.slug !== 'thin-at');
  if (!shapeProblems(onlyDoomedIsThin, PER_PAGE).some((p) => /exactly 1/.test(p))) {
    bad('a region of one that the loader empties was accepted as the subject');
  }

  const breaks = [
    ['Slovenia gone', (r) => r.filter((x) => x.country !== 'SI'), /no SI campsites/],
    // 🔴 Croatia, which the earlier rehearsal never broke: setting the
    // country list to ['SI'] alone left all eight breaks green, so the
    // HR half was shipped unproven.
    ['Croatia gone', (r) => r.filter((x) => x.country !== 'HR'), /no HR campsites/],
    // 🔴 Present but DEAD is the same as absent, and only the live
    // filter can tell. Without it a fixture whose Slovenia is entirely
    // marked `missing_since` passes the country check while every
    // /camping/si/ page answers 410.
    [
      'Slovenia present but all marked gone',
      (r) => r.map((x) => (x.country === 'SI' ? { ...x, missing_since: '2026-01-01' } : x)),
      /no SI campsites/,
    ],
    // Same idea on the other field: a row with no region is not a page.
    [
      'Croatia present but region-less',
      (r) => r.map((x) => (x.country === 'HR' ? { ...x, region: null } : x)),
      /no HR campsites/,
    ],
    // 🔴 EXACTLY at the page size, which is the state the old `>= 24`
    // called healthy while hubs.spec.ts skipped itself over it.
    [
      'the biggest region holds exactly a page',
      (r) => r.filter((x) => x.slug !== `pag-${String(PER_PAGE).padStart(2, '0')}`),
      /more than 24/,
    ],
    ['no region of one', (r) => r.filter((x) => x.slug !== 'thin-at'), /exactly 1/],
    ['no explicit "no"', (r) => r.filter((x) => x.slug !== 'no-at'), /toilets="no"/],
    ['no explicit "yes"', (r) => r.filter((x) => x.slug !== 'yes-at'), /toilets="yes"/],
    // Every row already has computed context, so the DO block finds no
    // candidate. Nothing else moves: the countries, the big region and
    // both toilets answers are untouched.
    [
      'nothing eligible for the gone block',
      (r) => r.map((x) => ({ ...x, context: '{"at":{}}' })),
      /marked 0/,
    ],
    // 🔴 CAMP-199, and it isolates: the doomed row keeps its empty
    // context so the gone block still has its one candidate, while
    // everything else loses the surroundings. Only the context subject
    // may fire.
    [
      'the fixture lost its computed surroundings',
      (r) => r.map((x) => (x.slug === 'zzz-doomed' ? x : { ...x, context: '{}' })),
      /computed context/,
    ],
  ];

  for (const [name, breakIt, expected] of breaks) {
    const found = shapeProblems(breakIt(whole()), PER_PAGE);
    if (!found.some((p) => expected.test(p))) {
      bad(`"${name}" was not reported (got: ${found.join('; ') || 'nothing'})`);
    }
    // 🔴 One break, one problem. A break that knocks over three subjects
    // proves only that SOMETHING is checked.
    if (found.length !== 1) {
      bad(`"${name}" reported ${found.length} problems, not 1: ${found.join('; ')}`);
    }
  }

  // The page size is READ, not retyped: a guard that carries its own
  // copy of 24 drifts away from the paginator in silence.
  if (regionPerPage('export const REGION_PER_PAGE = 31;') !== 31) {
    bad('REGION_PER_PAGE was not read from source');
  }
  if (regionPerPage('const SOMETHING_ELSE = 24;') !== null) {
    bad('a missing REGION_PER_PAGE did not read as missing');
  }
  if (run(SEED, quiet, 'nothing here declares a page size') !== 1) {
    bad('an unreadable page size was treated as "no pagination rule"');
  }

  // A parser that has fallen behind the fixture must say so, not ✓ over
  // what it still manages to read.
  const twoBroken = 'INSERT INTO camping_spots (a, b) VALUES (1);\n'.repeat(2);
  const parsed = readSpots(twoBroken);
  if (parsed.skipped.length !== 2) bad(`skipped ${parsed.skipped.length} rows, expected 2`);

  if (rc === 0) {
    console.log(
      '✓ rehearsal: a complete fixture passes; each of the eight subjects\n' +
        '  is reported BY ITSELF when it goes missing — including Croatia,\n' +
        '  which nothing broke before — a region holding exactly one page\n' +
        '  fails rather than passing, the row the loader marks gone is not\n' +
        '  counted as the region of one, and the page size is read from the\n' +
        '  paginator instead of retyped here.',
    );
  }
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (!invokedDirectly) {
  // imported for its functions
} else if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
} else {
  // 🔴 The old form was `process.argv.find(a => a.endsWith('.sql'))`
  // with a fallback to the committed fixture. Hand it a path without a
  // `.sql` suffix and it checked the fixture instead and printed ✓ —
  // and `regenerate.sh` writes its candidate as
  // `.ci-seed.candidate.XXXXXX`, with no suffix, which is precisely the
  // one file anyone would want to hand it.
  //
  // So: any argument that is not a flag IS the file, suffix or no
  // suffix, and an unreadable one is an error rather than a fallback.
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (args.length > 1) {
    console.error(`✗ one file at a time, got ${args.length}: ${args.join(' ')}`);
    process.exit(1);
  }
  process.exit(run(args[0] ?? SEED));
}
