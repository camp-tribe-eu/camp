#!/usr/bin/env node
// CAMP-275: every workflow says what its token may do.
//
//   node scripts/ci/check-workflow-permissions.mjs [--self-test]
//
// 🔴 WHY, AND IT IS NOT TIDINESS.
//
// Three Dependabot alerts have sat open on the default branch with no
// patch available and none coming: `extract-zip` twice (high) and
// `sprintf-js` (medium). Measured 13.10.2026, all three `development`
// scope, `first_patched_version` empty on all three. The chain is
// `@lhci/cli` → `lighthouse` → `puppeteer-core` → `@puppeteer/browsers`
// → `extract-zip`, i.e. our own CI toolchain.
//
// `extract-zip`'s flaw is arbitrary file write through a symlink in an
// archive. The thing that decides what that is WORTH to an attacker is
// not the package version — there is no fixed one — it is what the
// runner's `GITHUB_TOKEN` can do once they are on it.
//
// Measured the same day: six of seven workflows declared `permissions`.
// The seventh was `ci.yml`, the largest, 18 jobs, every one of which
// builds the site and runs our scripts. It inherited the repository
// default, which is a setting outside this file that nobody reviewing a
// pull request can see.
//
// So this guard is the blast radius, written down. It cannot patch
// `extract-zip` and does not pretend to; it makes the question "what
// could a compromised build step reach" answerable from the repository.
//
// 🔴 TOP-LEVEL, AND THAT IS THE WHOLE SUBTLETY. A `permissions:` block
// inside one job leaves every other job on the default, while a grep for
// the word is perfectly satisfied. The check therefore reads column
// zero, and the self-test has a case built from exactly that shape.

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.join(here, '..', '..', '.github', 'workflows');

/** A blanket grant is the one value that is worse than silence. */
const BLANKET = /^permissions:\s*write-all\s*$/m;

/** `permissions:` at column zero — a job's own block is indented. */
const TOP_LEVEL = /^permissions:/m;

/**
 * What is wrong with these workflows, named one by one.
 *
 * `files` is `{ name: text }` so the self-test can hand it strings and
 * the real run can hand it the directory. Counted, never summarised:
 * "some workflows are fine" is not a verdict anybody can act on.
 */
export function problems(files) {
  const out = [];
  const names = Object.keys(files).sort();

  // 🔴 An empty corpus is a failure, not a pass. A walk that found no
  // workflows prints "0 problems" and reads exactly like a clean repo —
  // the shape this project has been bitten by more than once.
  if (names.length === 0) {
    return ['no workflow files were read at all — the walk found nothing'];
  }

  for (const name of names) {
    const text = files[name];
    if (!TOP_LEVEL.test(text)) {
      out.push(
        `${name}: no top-level \`permissions:\` — its token takes the ` +
          'repository default, which is not visible in review',
      );
      continue;
    }
    if (BLANKET.test(text)) {
      out.push(`${name}: \`permissions: write-all\` grants everything`);
    }
  }
  return out;
}

function selfTest() {
  let rc = 0;
  const cases = [];
  const check = (cond, m) => {
    cases.push(m);
    if (!cond) {
      console.error(`✗ REHEARSAL FAILED: ${m}`);
      rc = 1;
    }
  };

  const GOOD = 'name: X\npermissions:\n  contents: read\n\njobs:\n  a:\n    steps: []\n';
  check(problems({ 'good.yml': GOOD }).length === 0, 'a declared permissions block was reported');

  const NONE = 'name: X\n\njobs:\n  a:\n    steps: []\n';
  const none = problems({ 'none.yml': NONE });
  check(none.length === 1, 'a workflow with no permissions was not reported');
  check(/none\.yml/.test(none[0] ?? ''), 'the problem did not name the file');

  // 🔴 THE CASE A GREP WOULD PASS. The word is present, and every job
  // but this one still runs on the repository default.
  const JOB_ONLY =
    'name: X\n\njobs:\n  a:\n    permissions:\n      contents: read\n    steps: []\n  b:\n    steps: []\n';
  check(
    problems({ 'job-only.yml': JOB_ONLY }).length === 1,
    'a permissions block inside one job was accepted as the workflow\u2019s',
  );

  const BLANKET_YML = 'name: X\npermissions: write-all\n\njobs: {}\n';
  const blanket = problems({ 'blanket.yml': BLANKET_YML });
  check(blanket.length === 1, '`write-all` was not reported');
  check(/write-all/.test(blanket[0] ?? ''), 'the problem did not say what was wrong');

  // A one-line read grant is explicit and visible; it is not the thing
  // this guard exists to catch.
  check(
    problems({ 'read.yml': 'name: X\npermissions: read-all\n\njobs: {}\n' }).length === 0,
    '`read-all` was reported, but it grants nothing',
  );

  check(
    problems({}).length === 1 && /found nothing/.test(problems({})[0]),
    'an empty corpus passed instead of failing',
  );

  // Two broken files are two problems: a verdict that stops at the first
  // one makes the second invisible until the first is fixed.
  check(problems({ 'a.yml': NONE, 'b.yml': NONE }).length === 2, 'only one of two broken files was reported');

  // 🔴 A literal, never `cases.length`.
  const EXPECTED_CASES = 9;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ REHEARSAL FAILED: ${cases.length} cases ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  console.log(
    rc === 0
      ? `✓ check-workflow-permissions self-test: ${cases.length} cases over the token's reach`
      : `✗ check-workflow-permissions self-test: ${cases.length} cases, at least one failed`,
  );
  return rc;
}

function run() {
  const files = {};
  for (const e of readdirSync(WORKFLOWS, { withFileTypes: true })) {
    if (e.isFile() && /\.ya?ml$/.test(e.name)) {
      files[e.name] = readFileSync(path.join(WORKFLOWS, e.name), 'utf8');
    }
  }
  const found = problems(files);
  const n = Object.keys(files).length;
  if (found.length) {
    console.error(`✗ ${found.length} of ${n} workflow(s) leave the token unexplained:`);
    for (const f of found) console.error(`   ${f}`);
    return 1;
  }
  console.log(`✓ all ${n} workflows declare what their token may do, and none grants everything`);
  return 0;
}

// 🔴 BEHIND THE ENTRY POINT. `problems()` is exported so the self-test
// can hand it strings; a module that parsed argv and called `exit` on
// import would take the importer with it. `realpathSync` because Node
// resolves `import.meta.url` through symlinks and `argv[1]` does not —
// without it a symlinked invocation looks like an import and runs
// nothing, which is the shape CAMP-286 was written about.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test'],
    'check-workflow-permissions.mjs',
  );
  process.exit(action.has('--self-test') ? selfTest() : run());
}
