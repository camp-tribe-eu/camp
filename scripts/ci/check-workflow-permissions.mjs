#!/usr/bin/env node
// CAMP-275: every workflow says what its token may do.
//
//   node scripts/ci/check-workflow-permissions.mjs [--self-test]
//
// 🔴 WHY, AND IT IS NOT TIDINESS.
//
// Three Dependabot alerts sit open with no patch and none coming:
// `extract-zip` twice (high) and `sprintf-js` (medium). Measured
// 13.10.2026, all three `development` scope, `first_patched_version`
// empty on all three. The chain is our own CI toolchain: `@lhci/cli` →
// `lighthouse` → `puppeteer-core` → `@puppeteer/browsers` → `extract-zip`.
//
// `extract-zip`'s flaw is arbitrary file write through a symlink in an
// archive. What decides its WORTH to an attacker is not the package
// version — there is no fixed one — but what the runner's token can do.
//
// Measured the same day: six of seven workflows declared `permissions`.
// The seventh was `ci.yml`, the largest, which inherited the repository
// default — a setting outside this file that nobody reviewing a pull
// request can see.
//
// 🔴 PARSED, NOT GREPPED, AND REVIEW IS WHY.
//
// The first version matched `/^permissions:\s*write-all\s*$/m`. Review
// built three ordinary workflows it let through while the success line
// still said "none grants everything":
//
//     permissions: write-all # release needs to push tags
//     permissions: "write-all"
//     jobs: { publish: { permissions: write-all } }
//
// A regex pinned to column zero and to end-of-line cannot see a trailing
// comment, a quoted scalar, or a job that granted itself everything.
// `js-yaml` is already how `check-node-versions.mjs` reads these files,
// and it answers all three for free — along with a BOM, `permissions :`
// and `"permissions":`, which the regex reported as MISSING.

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 🔴 Іменований імпорт, бо js-yaml 5 ПРИБРАВ default-експорт. На 4-й
// `import yaml from 'js-yaml'` працював; на 5-й той самий рядок дає
// `SyntaxError: does not provide an export named 'default'` — і падає
// не тест, а завантаження модуля, тобто сторож мовчить про те, що
// стеріг. Заміряно 14.10.2026 на 5.4.3: default === undefined.
import { load as loadYaml } from 'js-yaml';
import { chooseAction } from '../lib/entrypoint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.join(here, '..', '..', '.github', 'workflows');

/** A blanket grant is the one value worse than silence. */
const isBlanket = (v) => typeof v === 'string' && v.trim() === 'write-all';

/**
 * What is wrong with these workflows, named one by one.
 *
 * `files` is `{ name: text }` so the self-test can hand it strings and
 * the real run can hand it a directory.
 */
export function problems(files) {
  const out = [];
  const names = Object.keys(files).sort();

  // 🔴 An empty corpus is a failure, not a pass. A walk that found no
  // workflows prints "0 problems" and reads exactly like a clean repo.
  if (names.length === 0) {
    return ['no workflow files were read at all — the walk found nothing'];
  }

  for (const name of names) {
    let doc;
    try {
      doc = loadYaml(files[name]);
    } catch (err) {
      // Unreadable is not clean. A parser that gave up must say so, or
      // its silence counts as approval.
      out.push(`${name}: could not be parsed as YAML — ${(err && err.message) || err}`);
      continue;
    }
    if (doc === null || typeof doc !== 'object') {
      out.push(`${name}: is not a YAML mapping, so it declares nothing`);
      continue;
    }

    if (doc.permissions === undefined) {
      out.push(
        `${name}: no top-level \`permissions:\` — its token takes the ` +
          'repository default, which is not visible in review',
      );
    } else if (isBlanket(doc.permissions)) {
      out.push(`${name}: \`permissions: write-all\` grants everything`);
    }

    // 🔴 A job may grant itself more than the workflow did. Review found
    // this one: the top-level block is present and minimal, one job says
    // `write-all`, and a check that only read the top level called the
    // file clean.
    const jobs = doc.jobs;
    if (jobs && typeof jobs === 'object') {
      for (const jobName of Object.keys(jobs).sort()) {
        const job = jobs[jobName];
        if (job && typeof job === 'object' && isBlanket(job.permissions)) {
          out.push(`${name}: job "${jobName}" grants itself \`write-all\``);
        }
      }
    }
  }
  return out;
}

/**
 * The verdict, and it takes its input so it can be rehearsed.
 *
 * 🔴 THE FIRST VERSION READ THE DIRECTORY ITSELF AND HAD NO CASE.
 * Review ran ten mutations and SIX survived both CI steps, among them
 * `if (found.length)` → `if (found.length > 1)` and `return 1` →
 * `return 0` in the failing branch. The self-test only ever called
 * `problems()`; the verdict was green by construction, because the
 * repository is clean and a clean repository cannot make a verdict
 * fail. This is CAMP-299's defect, committed in the guard written to
 * close CAMP-299's cousin.
 */
export function run(files, log = console) {
  const found = problems(files);
  const n = Object.keys(files).length;
  if (found.length > 0) {
    log.error(`✗ ${found.length} of ${n} workflow(s) leave the token unexplained:`);
    for (const f of found) log.error(`   ${f}`);
    return 1;
  }
  log.log(`✓ all ${n} workflows declare what their token may do, and none grants everything`);
  return 0;
}

function readWorkflows() {
  const files = {};
  for (const e of readdirSync(WORKFLOWS, { withFileTypes: true })) {
    if (e.isFile() && /\.ya?ml$/.test(e.name)) {
      files[e.name] = readFileSync(path.join(WORKFLOWS, e.name), 'utf8');
    }
  }
  return files;
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
  const quiet = { log: () => {}, error: () => {} };
  const said = (files) => {
    const lines = [];
    const code = run(files, { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) });
    return { code, text: lines.join('\n') };
  };

  const GOOD = 'name: X\npermissions:\n  contents: read\njobs:\n  a:\n    steps: []\n';
  check(problems({ 'good.yml': GOOD }).length === 0, 'a declared permissions block was reported');

  const NONE = 'name: X\njobs:\n  a:\n    steps: []\n';
  const none = problems({ 'none.yml': NONE });
  check(none.length === 1, 'a workflow with no permissions was not reported');
  check(/none\.yml/.test(none[0] ?? ''), 'the problem did not name the file');

  // 🔴 THE CASE A GREP WOULD PASS: the word is present, every other job
  // still runs on the repository default.
  const JOB_ONLY =
    'name: X\njobs:\n  a:\n    permissions:\n      contents: read\n    steps: []\n  b:\n    steps: []\n';
  check(
    problems({ 'job-only.yml': JOB_ONLY }).length === 1,
    'a permissions block inside one job was accepted as the workflow\u2019s',
  );

  // 🔴 THE THREE FORMS REVIEW LET THROUGH. Each is ordinary YAML and
  // each defeated the regex this file used to carry.
  for (const [label, text] of [
    ['a trailing comment', 'name: X\npermissions: write-all # release needs tags\njobs: {}\n'],
    ['quotes', 'name: X\npermissions: "write-all"\njobs: {}\n'],
    ['a job granting itself', 'name: X\npermissions:\n  contents: read\njobs:\n  publish:\n    permissions: write-all\n'],
  ]) {
    const got = problems({ 'blanket.yml': text });
    check(got.length === 1, `write-all with ${label} was not reported`);
    check(/write-all/.test(got[0] ?? ''), `the problem for ${label} did not say what was wrong`);
  }

  // Forms the regex called MISSING while they declare a real key.
  for (const [label, text] of [
    ['a quoted key', 'name: X\n"permissions":\n  contents: read\njobs: {}\n'],
    ['a space before the colon', 'name: X\npermissions :\n  contents: read\njobs: {}\n'],
    ['a byte-order mark', '\uFEFFpermissions:\n  contents: read\njobs: {}\n'],
    ['an empty mapping, the strictest form', 'name: X\npermissions: {}\njobs: {}\n'],
  ]) {
    check(problems({ 'ok.yml': text }).length === 0, `${label} was reported as missing`);
  }

  check(
    problems({}).length === 1 && /found nothing/.test(problems({})[0]),
    'an empty corpus passed instead of failing',
  );
  check(problems({ 'a.yml': NONE, 'b.yml': NONE }).length === 2, 'only one of two broken files was reported');
  check(
    problems({ 'bad.yml': 'name: [X\n' }).some((p) => /could not be parsed/.test(p)),
    'a file that is not YAML was treated as clean',
  );

  // 🔴 THE VERDICT, WHICH HAD NO CASE AT ALL UNTIL REVIEW SAID SO.
  // Code AND reason together: a branch can be left talkative and return
  // 0, and a code alone does not say which branch produced it.
  const bad = said({ 'none.yml': NONE });
  check(bad.code === 1, 'a broken workflow did not fail the run');
  check(/none\.yml/.test(bad.text), 'the failing run did not name the file');
  const good = said({ 'good.yml': GOOD });
  check(good.code === 0, 'a clean set did not pass');
  check(/all 1 workflows/.test(good.text), 'the passing line did not count what it read');
  check(said({}).code === 1, 'a run over nothing reported success');
  // One broken among two is still a failure: `found.length > 1` was one
  // of the six mutations that survived.
  check(said({ 'none.yml': NONE, 'good.yml': GOOD }).code === 1, 'one broken file among two passed');

  // 🔴 A literal, never `cases.length`.
  // 🔴 Літерал, і він щойно зловив мене: я написав 24, виконалось 23.
  // Порахувати можна так — 4 окремі + 3 форми write-all × 2 + 4 форми,
  // що мусять проходити + 3 про корпус і розбір + 6 про вирок = 23.
  const EXPECTED_CASES = 23;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ REHEARSAL FAILED: ${cases.length} cases ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  console.log(
    rc === 0
      ? `✓ check-workflow-permissions self-test: ${cases.length} cases over the token's reach`
      : `✗ check-workflow-permissions self-test: ${cases.length} cases, at least one failed`,
  );
  void quiet;
  return rc;
}

// 🔴 BEHIND THE ENTRY POINT. `problems()` and `run()` are exported so
// the self-test can hand them fixtures; a module that parsed argv and
// called `exit` on import would take the importer with it.
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
  process.exit(action.has('--self-test') ? selfTest() : run(readWorkflows()));
}
