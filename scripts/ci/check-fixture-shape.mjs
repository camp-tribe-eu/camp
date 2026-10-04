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
// 🔴 RUN IT ON BOTH SIDES. In CI it guards the committed fixture;
// `regenerate.sh` runs it on the file it has just written, so a
// regeneration that loses Slovenia is refused rather than committed.
// The same check at the two moments where it means something.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, '..', '..', 'apps', 'api', 'test', 'fixtures', 'ci-seed.sql');

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
  const re =
    /INSERT INTO camping_spots\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\);\s*$/gm;
  for (const m of sql.matchAll(re)) {
    const cols = m[1].split(',').map((c) => c.trim());
    const vals = splitTuple(m[2]);
    if (cols.length !== vals.length) continue; // the computed twin
    const row = {};
    cols.forEach((c, i) => (row[c] = literal(vals[i])));
    rows.push(row);
  }
  return rows;
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
export function shapeProblems(rows) {
  const problems = [];
  const live = rows.filter((r) => r.region && r.missing_since === null);

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

  if (!sizes.some((n) => n >= 24)) {
    problems.push('no region holds 24+ campsites — nothing paginates, so the paginator tests have no subject');
  }
  if (!sizes.some((n) => n === 1)) {
    problems.push('no region holds exactly 1 campsite — the "reachable but not indexed" case (CAMP-71) has no subject');
  }

  for (const want of ['yes', 'no']) {
    if (!live.some((r) => toilets(r) === want)) {
      problems.push(`no campsite answers toilets="${want}" — the three-state amenity model has no ${want === 'no' ? 'honest negative' : 'positive'}`);
    }
  }

  // The gone block picks the highest slug among rows with a region, no
  // explicit toilets answer and no computed context. Zero candidates is
  // the load error the card quotes: "marked 0".
  const goneCandidates = live.filter(
    (r) => toilets(r) === 'unknown' && (r.context ?? '{}') === '{}',
  );
  if (goneCandidates.length === 0) {
    problems.push('nothing is eligible for the gone block — loading will die with "expected to mark exactly one campsite gone, marked 0"');
  }

  return problems;
}

function run(file, log = console) {
  const rows = readSpots(readFileSync(file, 'utf8'));
  if (rows.length === 0) {
    log.error(`✗ ${file} holds no camping_spots rows at all`);
    return 1;
  }
  const problems = shapeProblems(rows);
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
  log.log(`✓ fixture shape: ${rows.length} campsites, every subject the tests stand on is present`);
  return 0;
}

// Prove each assertion can fail. Nothing here reads the real fixture.
function selfTest() {
  let rc = 0;
  const bad = (m) => {
    console.error(`✗ REHEARSAL FAILED: ${m}`);
    rc = 1;
  };

  const spot = (slug, country, region, toiletsValue = 'unknown', context = '{}') => ({
    slug,
    country,
    region,
    missing_since: null,
    amenities: `{"toilets": "${toiletsValue}"}`,
    context,
  });

  /** A fixture that satisfies every shape, as the baseline to break. */
  const whole = () => [
    ...Array.from({ length: 24 }, (_x, i) => spot(`big-${i}`, 'SI', 'Bovec')),
    ...Array.from({ length: 4 }, (_x, i) => spot(`mid-${i}`, 'HR', 'Zagreb')),
    spot('thin-1', 'HR', 'Lonely'),
    spot('yes-1', 'SI', 'Bovec', 'yes'),
    spot('no-1', 'HR', 'Zagreb', 'no'),
  ];

  if (shapeProblems(whole()).length !== 0) {
    bad(`a complete fixture was reported broken: ${shapeProblems(whole()).join('; ')}`);
  }

  const breaks = [
    ['Slovenia gone', (r) => r.filter((x) => x.country !== 'SI'), /no SI campsites/],
    // 🔴 Present but DEAD is the same as absent, and only the live
    // filter can tell. Without it a fixture whose Slovenia is entirely
    // marked `missing_since` passes the country check while every
    // /camping/si/ page answers 410.
    [
      'Slovenia present but all marked gone',
      (r) =>
        r.map((x) =>
          x.country === 'SI' ? { ...x, missing_since: '2026-01-01' } : x,
        ),
      /no SI campsites/,
    ],
    // Same idea on the other field: a row with no region is not a page.
    [
      'Slovenia present but region-less',
      (r) => r.map((x) => (x.country === 'SI' ? { ...x, region: null } : x)),
      /no SI campsites/,
    ],
    [
      'nothing paginates',
      (r) => r.filter((x) => !x.slug.startsWith('big-') || Number(x.slug.slice(4)) < 20),
      /24\+/,
    ],
    ['no region of one', (r) => r.filter((x) => x.slug !== 'thin-1'), /exactly 1/],
    ['no explicit "no"', (r) => r.filter((x) => x.slug !== 'no-1'), /toilets="no"/],
    ['no explicit "yes"', (r) => r.filter((x) => x.slug !== 'yes-1'), /toilets="yes"/],
    [
      'nothing eligible for the gone block',
      (r) => r.map((x) => ({ ...x, amenities: '{"toilets": "yes"}' })),
      /marked 0/,
    ],
  ];

  for (const [name, breakIt, expected] of breaks) {
    const found = shapeProblems(breakIt(whole()));
    if (!found.some((p) => expected.test(p))) {
      bad(`"${name}" was not reported (got: ${found.join('; ') || 'nothing'})`);
    }
  }

  if (rc === 0) {
    console.log(
      '✓ rehearsal: a complete fixture passes, and each of the six subjects\n' +
        '  the tests stand on is reported by name when it goes missing.',
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
  const argFile = process.argv.find((a) => a.endsWith('.sql'));
  process.exit(run(argFile ?? SEED));
}
