#!/usr/bin/env node
// CAMP-190: the campsite page prints a radius the API owns.
//
//   node scripts/ci/check-webcam-radius.mjs [--self-test]
//
// 🔴 WHY THIS GUARD EXISTS, AND IT IS A MEASURED FAILURE, NOT A WORRY.
//
// `WEBCAM_RADIUS_M = 25_000` is declared TWICE — in `apps/api/src/webcams/
// nearby.ts`, where the SQL uses it, and in `apps/web/src/lib/webcams.ts`,
// where the empty-state sentence prints it. Nothing tied them. Review set
// the API's to 10 000 and every one of the 756 web unit tests stayed
// green while the page went on telling readers "No public webcam within
// 25 km of this campsite" — a false statement about coverage, produced
// by a search that had stopped at ten.
//
// The web test that was supposed to catch it built its expected string
// from the SAME constant the component renders, so it could only ever
// agree with itself.
//
// A shared module is not available: `apps/web` is a static export and
// `apps/api` is a Nest service; neither imports the other, by design.
// So the two literals are compared here, where a mismatch is red.

import { readFileSync } from 'node:fs';

const SOURCES = [
  { file: 'apps/api/src/webcams/nearby.ts', role: 'the radius the SQL searches' },
  { file: 'apps/web/src/lib/webcams.ts', role: 'the radius the page prints' },
];

/** `export const WEBCAM_RADIUS_M = 25_000;` → 25000. */
export function radiusIn(source, file = '<string>') {
  const m = /export\s+const\s+WEBCAM_RADIUS_M\s*(?::\s*number\s*)?=\s*([0-9_]+)\s*;/.exec(source);
  if (!m) throw new Error(`${file}: no \`export const WEBCAM_RADIUS_M = …\` found`);
  const n = Number(m[1].replace(/_/g, ''));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${file}: WEBCAM_RADIUS_M is ${m[1]}`);
  return n;
}

function selfTest() {
  let failures = 0;
  const ok = (name, fn) => {
    try {
      fn();
      console.log(`✓ ${name}`);
    } catch (err) {
      failures++;
      console.log(`✗ ${name}: ${err.message}`);
    }
  };
  const eq = (a, b) => {
    if (a !== b) throw new Error(`got ${a}, want ${b}`);
  };
  const throws = (fn) => {
    try {
      fn();
    } catch {
      return;
    }
    throw new Error('did not throw');
  };

  ok('plain declaration', () => eq(radiusIn('export const WEBCAM_RADIUS_M = 25000;'), 25000));
  ok('numeric separators', () => eq(radiusIn('export const WEBCAM_RADIUS_M = 25_000;'), 25000));
  ok('an explicit type annotation', () =>
    eq(radiusIn('export const WEBCAM_RADIUS_M: number = 12_500;'), 12500));
  ok('a different value is READ, not assumed', () =>
    eq(radiusIn('export const WEBCAM_RADIUS_M = 10_000;'), 10000));
  ok('a missing declaration is an error, not a default', () =>
    throws(() => radiusIn('const WEBCAM_RADIUS_M = 25_000;')));
  ok('zero is refused', () => throws(() => radiusIn('export const WEBCAM_RADIUS_M = 0;')));
  // 🔴 The rehearsal that matters: the exact edit review made.
  ok('two files that disagree are caught', () => {
    const a = radiusIn('export const WEBCAM_RADIUS_M = 25_000;');
    const b = radiusIn('export const WEBCAM_RADIUS_M = 10_000;');
    if (a === b) throw new Error('the comparison cannot tell 25 000 from 10 000');
  });

  console.log(failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed');
  return failures;
}

if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

const found = SOURCES.map((s) => ({ ...s, m: radiusIn(readFileSync(s.file, 'utf8'), s.file) }));
const distinct = new Set(found.map((f) => f.m));
if (distinct.size !== 1) {
  console.error('✗ the webcam radius is declared twice and the two do not agree:\n');
  for (const f of found) console.error(`   ${String(f.m).padStart(7)} m  ${f.file}  (${f.role})`);
  console.error(
    '\n  The page prints the second and the database searches the first, so a\n' +
      '  mismatch publishes a false sentence about coverage on every campsite\n' +
      '  that has no camera. Change both, or neither.',
  );
  process.exit(1);
}
console.log(`✓ the webcam radius agrees in ${found.length} files: ${[...distinct][0]} m`);
