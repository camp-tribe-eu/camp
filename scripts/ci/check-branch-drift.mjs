#!/usr/bin/env node
// Refuse to let a feature branch quietly become a second main.
//
// 🔴 This exists because of a real failure, on 22.09.2026.
//
// One branch, `camp-27-89-data-core`, accumulated 28 commits over several
// days: the whole campsite dataset, the map, the error pages, a Next
// major upgrade, the security headers and every new guard. `main` never
// moved. Nothing warned, because every check was green — on the branch.
//
// What that cost, once it was noticed:
//
//   * CodeQL and Dependabot scan the DEFAULT branch. Both were switched
//     on, both reported on `main`, and neither had seen a line of the
//     work. The security tab was confidently describing a repository
//     that had not existed for days.
//   * SECURITY.md and dependabot.yml are read from the default branch,
//     so both were inert.
//   * Dependabot opened a pull request to bump Next to a version the
//     branch had already been on for hours.
//   * And the merge itself was luck: it happened to be a fast-forward.
//     Twenty-eight commits of divergence is exactly where a merge stops
//     being a formality.
//
// The owner's point, and he is right: you pull before you start, and you
// merge back before the branch grows teeth. A rule nobody checks is a
// rule that rots, so this checks it.
//
//   node scripts/ci/check-branch-drift.mjs
//   node scripts/ci/check-branch-drift.mjs --self-test

import { execFileSync } from 'node:child_process';

/**
 * A card's worth of work is a handful of commits. Past this, the branch
 * is not a feature any more — it is a fork of the project, and every
 * day it lives makes the merge worse.
 */
const MAX_AHEAD = 20;

const run = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Pure, so the thresholds can be tested without a repository. */
export function verdict({ branch, ahead, behind }) {
  if (branch === 'main' || branch === 'HEAD') {
    return { ok: true, message: `on ${branch} — nothing to compare` };
  }
  const lines = [`${branch}: ${ahead} ahead, ${behind} behind main`];
  let ok = true;

  if (behind > 0) {
    // Not a failure: a branch falls behind the moment anyone else
    // merges, and that is normal. It is worth saying out loud, because
    // the longer it goes unsaid the harder the eventual merge is.
    lines.push(
      `  ⚠ ${behind} commit(s) on main are missing here. Merge main in ` +
        `before the gap grows: git merge origin/main`,
    );
  }
  if (ahead > MAX_AHEAD) {
    ok = false;
    lines.push(
      `  🔴 ${ahead} commits ahead of main, over the limit of ${MAX_AHEAD}.`,
      '',
      '  This branch has stopped being a feature branch. While it lives,',
      '  CodeQL and Dependabot report on main and therefore on none of',
      '  this work, SECURITY.md and dependabot.yml are inert, and the',
      '  merge gets more dangerous every day.',
      '',
      '  Open a pull request and merge it. If the work genuinely is not',
      '  finished, split it: the finished part belongs on main.',
    );
  }
  return { ok, message: lines.join('\n') };
}

if (process.argv.includes('--self-test')) {
  // 🔴 A guard nobody has watched fail is not a guard.
  const cases = [
    [{ branch: 'main', ahead: 999, behind: 0 }, true, 'main is never the problem'],
    [{ branch: 'camp-32-map', ahead: 3, behind: 0 }, true, 'a normal branch'],
    [{ branch: 'camp-32-map', ahead: 3, behind: 7 }, true, 'behind is a warning, not a failure'],
    [{ branch: 'camp-32-map', ahead: MAX_AHEAD, behind: 0 }, true, 'exactly at the limit'],
    [{ branch: 'camp-32-map', ahead: MAX_AHEAD + 1, behind: 0 }, false, 'one over the limit'],
    [{ branch: 'camp-27-89-data-core', ahead: 28, behind: 0 }, false, 'the real case this was written for'],
  ];
  let failures = 0;
  for (const [input, expected, why] of cases) {
    const got = verdict(input).ok;
    const pass = got === expected;
    if (!pass) failures++;
    console.log(`${pass ? '✓' : '✗'} ${why} (${input.ahead} ahead) → ${got ? 'allowed' : 'blocked'}`);
  }
  console.log(
    failures
      ? `\n✗ ${failures} case(s) behaved wrongly`
      : '\n✓ self-test passed: the limit blocks what it should and allows what it should',
  );
  process.exit(failures ? 1 : 0);
}

let branch;
try {
  // In Actions the checkout is detached, so the ref comes from the
  // environment; locally it comes from git.
  branch =
    process.env.GITHUB_HEAD_REF ||
    (process.env.GITHUB_REF_NAME ?? '') ||
    run(['rev-parse', '--abbrev-ref', 'HEAD']);
} catch {
  console.log('not a git checkout — nothing to check');
  process.exit(0);
}

let ahead = 0;
let behind = 0;
try {
  run(['fetch', 'origin', 'main', '--depth=200']);
  const counts = run(['rev-list', '--left-right', '--count', `origin/main...HEAD`]);
  [behind, ahead] = counts.split(/\s+/).map(Number);
} catch (err) {
  // 🔴 Say so rather than pass. A check that cannot run has not run,
  // and reporting success would be the same lie as any other green
  // tick over an unexecuted test.
  console.error(`✗ could not compare against origin/main: ${err.message}`);
  process.exit(1);
}

const { ok, message } = verdict({ branch, ahead, behind });
console.log(message);
process.exit(ok ? 0 : 1);
