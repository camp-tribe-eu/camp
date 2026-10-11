#!/usr/bin/env node
// Every job runs the Node in `.nvmrc`, or says out loud why it does not.
//
//   node scripts/ci/check-node-versions.mjs
//   node scripts/ci/check-node-versions.mjs --self-test
//
// 🔴 WHY THIS EXISTS (CAMP-178). After CAMP-159 the `api` job moved to
// Node 24 — Nest 12 is ESM-only and Jest 30 can `require()` an ES module
// only on 24.9 — while `.nvmrc` and eight other jobs stayed on 22. That
// divergence is fine. What is not fine is that it was SILENT: nothing in
// the repository could tell a reader whether a given `node-version:` was
// a decision or a copy-paste.
//
// And it had already spread. `warning-geography.yml` ran on 24 with no
// reason anywhere, running two plain scripts that use nothing newer than
// Node 18. Nobody chose that; it was inherited from the file it was
// copied from, which is exactly how a version skew becomes permanent.
//
// So the rule is not "one version everywhere" — that would be a lie we
// would have to break the first time Jest needed something. The rule is:
// every version that is NOT `.nvmrc` is listed here, with the reason, and
// an exception that no longer matches anything is itself an error. A
// reason that outlives its cause is worse than no reason, because the
// next person believes it.

import { readFileSync, readdirSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = join(ROOT, '.github/workflows');

/**
 * Jobs allowed to run something other than `.nvmrc`, and why.
 *
 * Keyed by `file:job`. The reason is read by a human, so it says what
 * breaks without it rather than what the version is.
 */
export const EXCEPTIONS = {
  'ci.yml:api': {
    version: '24',
    why:
      'Nest 12 is ESM-only and Jest 30 can require() an ES module only on ' +
      'Node >= 24.9 (CAMP-159). On 22 every spec importing @nestjs/* died ' +
      'with "Must use import to load ES Module". The API itself still runs ' +
      'on 22 in the jobs that start it.',
  },
};

/** `node-version: X` with the file and the job it sits in. */
export function readNodeVersions(files) {
  const found = [];
  for (const [name, text] of Object.entries(files)) {
    let job = '(top level)';
    let line = 0;
    for (const raw of text.split('\n')) {
      line++;
      // A job key is exactly two spaces in, under `jobs:`. Anything
      // deeper is a step or a `with:` block.
      const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(raw);
      if (m) job = m[1];
      const v = /^\s*node-version:\s*'?"?([0-9][0-9.x]*)'?"?\s*$/.exec(raw);
      if (v) found.push({ file: name, job, line, version: v[1] });
    }
  }
  return found;
}

export function problems(nvmrc, found, exceptions = EXCEPTIONS) {
  const out = [];
  const want = String(nvmrc).trim();
  if (!/^[0-9]+$/.test(want)) {
    out.push(`.nvmrc says "${nvmrc}", which is not a major version`);
    return out;
  }
  if (found.length === 0) {
    // 🔴 Finding nothing must be an error, not a pass. A parser that
    // stops matching after a formatting change would otherwise report
    // "every job agrees" about a set of zero jobs — the same shape as a
    // test run that never started.
    out.push('no node-version found in any workflow — the parser is broken, not the repo');
    return out;
  }

  const used = new Set();
  for (const f of found) {
    if (f.version === want) continue;
    const key = `${f.file}:${f.job}`;
    const allowed = exceptions[key];
    if (!allowed) {
      out.push(
        `${f.file}:${f.line} (job "${f.job}") runs Node ${f.version}, not ${want} ` +
          'from .nvmrc, and nothing says why — add it to EXCEPTIONS with a reason ' +
          'or set it to the default',
      );
      continue;
    }
    if (allowed.version !== f.version) {
      out.push(
        `${key} is allowed Node ${allowed.version} but runs ${f.version} — ` +
          'the exception and the workflow disagree',
      );
    }
    used.add(key);
  }

  // 🔴 A reason that outlives its cause is worse than no reason.
  for (const key of Object.keys(exceptions)) {
    if (!used.has(key)) {
      out.push(
        `EXCEPTIONS has "${key}", but no job by that name runs a non-default ` +
          'Node any more — delete it, or the next reader believes a stale reason',
      );
    }
  }
  return out;
}

const SELF_TEST = [
  [
    'every job on the default version passes',
    '22',
    [{ file: 'a.yml', job: 'x', line: 1, version: '22' }],
    {},
    0,
  ],
  [
    '🔴 an undeclared different version is refused',
    '22',
    [{ file: 'a.yml', job: 'x', line: 9, version: '24' }],
    {},
    1,
  ],
  [
    'a declared exception passes',
    '22',
    [{ file: 'a.yml', job: 'x', line: 9, version: '24' }],
    { 'a.yml:x': { version: '24', why: 'because' } },
    0,
  ],
  [
    '🔴 an exception that no longer matches anything is refused',
    '22',
    [{ file: 'a.yml', job: 'x', line: 1, version: '22' }],
    { 'a.yml:x': { version: '24', why: 'stale' } },
    1,
  ],
  [
    '🔴 an exception for the wrong version is refused',
    '22',
    [{ file: 'a.yml', job: 'x', line: 9, version: '25' }],
    { 'a.yml:x': { version: '24', why: 'drifted' } },
    1,
  ],
  [
    '🔴 finding nothing is a broken parser, not a pass',
    '22',
    [],
    {},
    1,
  ],
];

if (argv.includes('--self-test')) {
  let failed = 0;
  for (const [what, nvmrc, found, exc, expected] of SELF_TEST) {
    const got = problems(nvmrc, found, exc).length;
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what} (expected ${expected}, got ${got})`);
  }

  // 🔴 And the reader itself, on a shape exactly like a real workflow.
  // Without this the checks above prove only that the comparison works,
  // on data this file invented.
  const parsed = readNodeVersions({
    'x.yml': ['jobs:', '  build:', '    steps:', '      - uses: a', '        with:', '          node-version: 24', '  other:', '    steps:', '          node-version: 22'].join('\n'),
  });
  const shaped =
    parsed.length === 2 &&
    parsed[0].job === 'build' &&
    parsed[0].version === '24' &&
    parsed[1].job === 'other' &&
    parsed[1].version === '22';
  if (!shaped) {
    failed++;
    console.log(`✗ the reader mis-parsed a workflow: ${JSON.stringify(parsed)}`);
  } else console.log('✓ the reader finds both versions and the job each belongs to');

  console.log(
    failed
      ? `\n::error::self-test failed on ${failed} cases`
      : `\n✓ self-test passed: ${SELF_TEST.length + 1} cases`,
  );
  exit(failed ? 1 : 0);
}

const RUN_DIRECTLY = argv[1] && fileURLToPath(import.meta.url) === resolve(argv[1]);
if (RUN_DIRECTLY) {
  const nvmrc = readFileSync(join(ROOT, '.nvmrc'), 'utf8');
  const files = {};
  for (const name of readdirSync(WORKFLOWS)) {
    if (name.endsWith('.yml') || name.endsWith('.yaml')) {
      files[name] = readFileSync(join(WORKFLOWS, name), 'utf8');
    }
  }
  const found = readNodeVersions(files);
  const found_ = problems(nvmrc, found);

  const want = nvmrc.trim();
  const off = found.filter((f) => f.version !== want);
  console.log(`  .nvmrc says Node ${want}`);
  console.log(`  ${found.length} node-version entries across ${Object.keys(files).length} workflows`);
  for (const f of off) {
    const why = EXCEPTIONS[`${f.file}:${f.job}`]?.why;
    console.log(`  ${f.file} job "${f.job}" → Node ${f.version}${why ? ` — ${why.slice(0, 80)}…` : ''}`);
  }

  if (found_.length) {
    console.error('\n✗ Node versions are not accounted for:\n  ' + found_.join('\n  '));
    exit(1);
  }
  console.log(
    `\n✓ every job runs Node ${want}, or is one of the ${Object.keys(EXCEPTIONS).length} ` +
      'exception(s) listed with a reason',
  );
}
