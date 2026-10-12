#!/usr/bin/env node
// CAMP-285: a CI step that runs a self-test must READ what it printed.
//
//   node scripts/ci/check-selftest-steps.mjs
//   node scripts/ci/check-selftest-steps.mjs --self-test
//   node scripts/ci/check-selftest-steps.mjs --update
//
// 🔴 WHY.
//
// 43 steps across the workflows invoke a script with `--self-test`. On
// 12.10.2026, 42 of them passed when the self-test never ran, because
// "did not start" and "every case passed" print the same thing: nothing,
// exit 0. Three routes were reproduced on real files — a renamed flag
// (`--selftest`, one letter), an inverted entry guard, and a symlink,
// which needs no mutation at all.
//
// The locks are in scripts/lib/entrypoint.mjs and in each step. This
// file is the thing that makes them spread: a step converted by hand and
// a step nobody has got to yet look identical from the outside, and the
// rollout is 38 files long. The allow-list below is the list of steps
// still unlocked. It may shrink and never grow.
//
// 🔴 AND THE PATTERNS MUST DIFFER. A step grepping for
// "✓ self-test passed" — which four scripts printed before this card —
// can be satisfied by somebody else's self-test entirely. So the rule is
// that the grepped text names its own script, and the filesystem has
// already made basenames unique.

import { readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const ALLOWLIST = path.join(here, 'selftest-steps-unlocked.json');

/**
 * Every `- name:` / `run:` pair in a workflow, as text.
 *
 * 🔴 Hand-rolled rather than a YAML parser on purpose: this repository
 * has no yaml dependency in the root workspace, and the shape being read
 * is two keys at a known indentation. What it must NOT do is lose a
 * block scalar's body, which is where every `run: |` lives — so the body
 * is taken by indentation, exactly as YAML defines it.
 */
export function stepsIn(text) {
  const lines = text.split('\n');
  const steps = [];
  let name = null;
  for (let i = 0; i < lines.length; i++) {
    const nameAt = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(lines[i]);
    if (nameAt) {
      name = nameAt[1].replace(/^['"]|['"]$/g, '');
      continue;
    }
    const runAt = /^(\s*)-?\s*run:\s*(.*)$/.exec(lines[i]);
    if (!runAt) continue;
    const indent = runAt[1].length;
    let body = runAt[2].trim();
    if (body === '|' || body === '>' || body === '|-' || body === '>-') body = '';
    const collected = [body];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === '') {
        collected.push('');
        continue;
      }
      const lead = line.length - line.trimStart().length;
      if (lead <= indent) break;
      collected.push(line.trim());
      i = j;
    }
    steps.push({ name: name ?? '(unnamed)', run: collected.join('\n').trim() });
    name = null;
  }
  return steps;
}

/**
 * One shell command per entry, as a list of tokens.
 *
 * 🔴 TOKENS, NOT A REGEX, and review is the reason. The first version
 * matched `node <path> --self-test` as one piece of text, so writing the
 * SAME command over two lines —
 *
 *     node scripts/security/check-secrets.mjs \
 *       --self-test
 *
 * — made the step disappear from the survey entirely: 45 steps became
 * 44, the allow-list said nothing, and the check exited 0 while a locked
 * step had quietly become unlocked. `bash x.sh --self-test` and a quoted
 * path were missed for the same reason. A pattern that has to anticipate
 * every spelling of a command loses to the shell.
 */
export function commandsIn(run) {
  const joined = run.replace(/\\\n\s*/g, ' ');
  return joined
    .split(/\n|\|\||&&|[|;\n]/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0);
}

const SCRIPT_TOKEN = /^["']?([^"']*\.(?:mjs|cjs|js|ts|sh))["']?$/;

/** The scripts a step runs with `--self-test`, by path. */
export function selfTested(run) {
  const found = [];
  for (const tokens of commandsIn(run)) {
    if (!tokens.includes('--self-test')) continue;
    const script = tokens
      .map((t) => SCRIPT_TOKEN.exec(t)?.[1]?.replace(/^\.\//, ''))
      .find(Boolean);
    // 🔴 `null` rather than nothing: a `--self-test` this file cannot
    // attribute to a script is the hole, not an absence. survey() turns
    // it into an error instead of letting the step vanish.
    found.push(script ?? null);
  }
  return found;
}

/**
 * Every `--self-test` written in a workflow, however it is spelled.
 *
 * The tripwire for the parser above: if the two counts disagree, this
 * file has stopped reading something the workflow still runs. YAML
 * comment lines do not count, because they run nothing.
 */
export function selfTestMentions(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .split('--self-test').length - 1;
}

/**
 * Every literal a step greps its own output for.
 *
 * 🔴 ALL OF THEM, NOT THE FIRST. Review found the rule below could not
 * fail: it asked whether SOME script the step runs is named by the one
 * pattern it had read, and no step today runs two. A step that
 * self-tests two scripts and greps for one would have counted as locked
 * while half of it ran unwatched.
 */
export function grepPatterns(run) {
  return [...run.matchAll(/grep\s+-[a-zA-Z]*[qc][a-zA-Z]*\s+'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Does this step's lock stop reading as soon as it has matched?
 *
 * 🔴 `grep -q` AND `pipefail` TOGETHER ARE A TRAP, and it is mine: every
 * lock in CAMP-285 was written that way. `grep -q` exits at the first
 * match, the pipe closes, and whatever is still writing gets SIGPIPE —
 * so `pipefail` reports 141 and the step fails although nothing is
 * wrong. Measured on check-map-palette.mjs, which prints a long sentence
 * AFTER its named line: 5 runs out of 5 gave 141, direct and through a
 * symlink alike.
 *
 * The other locks survive only because their named line happens to be
 * the last thing printed — a property no one declared and the next
 * person to add a line would silently break. `grep -c … >/dev/null`
 * reads to EOF and still exits 1 when the count is zero.
 */
export function stopsReadingEarly(run) {
  return /grep\s+-[a-zA-Z]*q/.test(run);
}

/**
 * What is wrong with this step, as a pure decision.
 *
 * `null` means locked: it reads its own output, under pipefail, for a
 * line that names the script it ran.
 */
export function auditStep({ name, run, scripts }) {
  const patterns = grepPatterns(run);
  if (patterns.length === 0) {
    return { name, why: 'runs a self-test and never reads what it printed' };
  }
  if (stopsReadingEarly(run)) {
    return {
      name,
      why:
        '`grep -q` closes the pipe at the first match, so anything still ' +
        'writing takes SIGPIPE and `pipefail` turns a passing self-test ' +
        'into exit 141. Use `grep -c … >/dev/null`, which reads to EOF',
    };
  }
  if (!/set\s+-o\s+pipefail/.test(run)) {
    return {
      name,
      why:
        'greps its output but without `set -o pipefail`; Actions runs ' +
        '`bash -e {0}`, so a node that fails on the left of a pipe is invisible',
    };
  }
  const names = scripts.map((s) => path.basename(s).replace(/\.[^.]+$/, ''));
  // EVERY script the step self-tests must be named by SOME pattern it
  // greps for. One grep cannot vouch for two scripts.
  const unnamed = names.filter(
    (base) => !patterns.some((pattern) => namesScript(pattern, base)),
  );
  // 🔴 As a whole word, not a substring. The first version asked
  // `pattern.includes(base)`, and its own case for the generic line
  // "✓ self-test passed" passed the audit: the script was called `a.mjs`
  // and "passed" contains an "a". A substring test over a short name
  // accepts almost anything.
  if (unnamed.length > 0) {
    return {
      name,
      why:
        `greps for ${patterns.map((p) => `"${p}"`).join(', ')}, which does ` +
        `not name ${unnamed.join(' or ')}. A line another self-test can ` +
        'also print is a lock another key opens',
    };
  }
  return null;
}

/**
 * Does this grep pattern name this script?
 *
 * As a whole word, not a substring. The first version asked
 * `pattern.includes(base)`, and its own case for the generic line
 * "✓ self-test passed" passed the audit: the script was called `a.mjs`
 * and "passed" contains an "a".
 */
function namesScript(pattern, base) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(pattern);
}

/**
 * Grep patterns shared by steps that run DIFFERENT scripts.
 *
 * Pure, so the self-test drives this rule rather than a restatement of
 * it — the first version's two cases asserted what `new Set` does, which
 * is true whatever this function says.
 */
export function sharedPatterns(steps) {
  const byPattern = new Map();
  for (const step of steps) {
    for (const pattern of step.patterns ?? []) {
      byPattern.set(pattern, [...(byPattern.get(pattern) ?? []), step]);
    }
  }
  const out = [];
  for (const [pattern, group] of byPattern) {
    const sources = [...new Set(group.map((s) => s.scripts))].sort();
    if (sources.length <= 1) continue;
    out.push({ pattern, sources, steps: group.map((s) => s.key) });
  }
  return out;
}

function workflowFiles() {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => path.join(WORKFLOWS, f));
}

/** Every self-testing step in the workflows, with its verdict. */
function survey() {
  const all = [];
  for (const file of workflowFiles()) {
    const rel = path.relative(ROOT, file);
    for (const step of stepsIn(readFileSync(file, 'utf8'))) {
      const scripts = selfTested(step.run);
      if (scripts.length === 0) continue;
      all.push({
        file: rel,
        name: step.name,
        key: `${rel} :: ${step.name}`,
        patterns: grepPatterns(step.run),
        scripts: scripts.filter(Boolean).sort().join(','),
        unreadable: scripts.includes(null),
        problem: scripts.includes(null)
          ? { name: step.name, why: 'runs a --self-test this check cannot attribute to a script' }
          : auditStep({ ...step, scripts }),
      });
    }
  }
  return all;
}

/** Workflows whose `--self-test` count the survey does not account for. */
function unaccounted(all) {
  const out = [];
  for (const file of workflowFiles()) {
    const rel = path.relative(ROOT, file);
    const written = selfTestMentions(readFileSync(file, 'utf8'));
    const seen = all.filter((s) => s.file === rel).length;
    if (written !== seen) out.push({ file: rel, written, seen });
  }
  return out;
}

function run(action) {
  const all = survey();
  const unlocked = all.filter((s) => s.problem).map((s) => s.key).sort();

  if (action.has('--update')) {
    writeFileSync(
      ALLOWLIST,
      `${JSON.stringify({ _comment: COMMENT, unlocked }, null, 2)}\n`,
    );
    console.log(`${unlocked.length} steps recorded as still unlocked`);
    console.log('🔴 This list may shrink and never grow. CAMP-285.');
    return;
  }

  const allowed = new Set(JSON.parse(readFileSync(ALLOWLIST, 'utf8')).unlocked);
  let bad = 0;

  for (const step of all) {
    if (!step.problem) continue;
    if (allowed.has(step.key)) continue;
    bad++;
    console.error(`::error file=${step.file}::${step.name} — ${step.problem.why}`);
  }

  // 🔴 A step that was locked and came back unlocked is caught above. A
  // step that left the allow-list by being DELETED rather than fixed is
  // caught here, because the list would otherwise rot into permission
  // for steps nobody can find.
  const live = new Set(all.map((s) => s.key));
  for (const key of allowed) {
    if (live.has(key)) continue;
    bad++;
    console.error(`::error::the allow-list names a step that no longer exists: ${key}`);
  }

  // Two self-tests satisfied by one line would both be green while one
  // of them never ran.
  //
  // 🔴 THE SAME SCRIPT IN TWO WORKFLOWS IS NOT THAT, and this check said
  // it was. check-skips, check-schedule and resolve-areas each run in
  // ci.yml and in a second workflow; both steps grep the same line
  // because both run the same script, and each pipes only its OWN
  // process's output — one cannot stand in for the other. What the rule
  // is actually about is a pattern that a DIFFERENT script also prints.
  for (const clash of sharedPatterns(all)) {
    bad++;
    console.error(
      `::error::${clash.steps.length} steps grep for the same line ` +
        `"${clash.pattern}" while running different scripts ` +
        `(${clash.sources.join(' vs ')}): ${clash.steps.join(', ')}. ` +
        "Each would be satisfied by the other's output.",
    );
  }

  // 🔴 Counted, not subtracted. `all.length - allowed.size` was
  // arithmetic standing in for a count, and review proved it: adding one
  // unlocked step made it print "8 read their own output" when 7 did.
  const locked = all.filter((s) => s.problem === null).length;

  // 🔴 The parser's own tripwire. A step reformatted into a shape this
  // file cannot read used to vanish from the survey with no complaint.
  for (const gap of unaccounted(all)) {
    bad++;
    console.error(
      `::error file=${gap.file}::${gap.written} --self-test invocations are ` +
        `written here and this check could attribute ${gap.seen}. ` +
        'A step it cannot read is a step that left the survey in silence.',
    );
  }
  // Every number here is counted from what was read. `allowed.size` is
  // the list's own length and is printed beside the count it is meant to
  // match, not instead of it.
  console.log(
    `${all.length} steps run a self-test; ${locked} read their own output, ` +
      `${all.length - locked} do not; the list allows ${allowed.size}`,
  );
  if (bad) {
    console.error(`\n✗ ${bad} problem(s). CAMP-285: a run that did not start looks like a caught mutation.`);
    process.exit(1);
  }
  console.log('✓ every self-test step is locked, or on the shrinking list');
}

const COMMENT =
  'CAMP-285. Steps that run a --self-test without reading its output. ' +
  'A renamed flag, an inverted entry guard or a symlink makes each of ' +
  'these green while nothing runs. The list may shrink and never grow: ' +
  'regenerate with `node scripts/ci/check-selftest-steps.mjs --update` ' +
  'only after a step has been locked.';

const CASES = [
  ['a `run:` block scalar keeps its body', () => {
    const steps = stepsIn('jobs:\n  a:\n    steps:\n      - name: X\n        run: |\n          set -o pipefail\n          node a.mjs --self-test\n      - name: Y\n        run: echo hi\n');
    return steps.length === 2 && steps[0].run.includes('node a.mjs --self-test') && steps[1].run === 'echo hi';
  }],
  ['a one-line `run:` is read', () => stepsIn('      - name: X\n        run: node a.mjs --self-test\n')[0].run === 'node a.mjs --self-test'],
  ['node with a flag before the path is seen', () => selfTested('node --experimental-strip-types scripts/ci/x.mjs --self-test')[0] === 'scripts/ci/x.mjs'],
  ['npx ts-node is seen', () => selfTested('npx ts-node src/spots/x.ts --self-test')[0] === 'src/spots/x.ts'],
  ['a shell script is seen', () => selfTested('./scripts/ci/x.sh --self-test')[0] === 'scripts/ci/x.sh'],
  ['a self-test inside a pipeline is seen', () => selfTested("node a.mjs --self-test | tee /dev/stderr | grep -q 'a self-test:'")[0] === 'a.mjs'],
  ['two invocations on one line are both seen', () => selfTested('node a.mjs --self-test && node b.mjs --self-test').length === 2],
  ['a step that runs no self-test is not a subject', () => selfTested('node a.mjs --update').length === 0],
  ['🔴 every --self-test in the real ci.yml is attributed to a script', () => {
    // 🔴 An equality, after review found this case asserting `>= 35`
    // against a real value of 41: six steps of slack, so the defect it
    // was meant to catch could not move it.
    const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    const found = stepsIn(text).flatMap((st) => selfTested(st.run));
    return found.length === selfTestMentions(text) && !found.includes(null);
  }],
  ['🔴 a command split over two lines is still one command', () => {
    const got = selfTested('node scripts/a.mjs \\\n  --self-test');
    return got.length === 1 && got[0] === 'scripts/a.mjs';
  }],
  ['🔴 bash and sh are seen, and so is a quoted path', () =>
    selfTested('bash scripts/a.sh --self-test')[0] === 'scripts/a.sh' &&
    selfTested('node "scripts/a.mjs" --self-test')[0] === 'scripts/a.mjs'],
  ['🔴 a --self-test with no script is reported, not dropped', () =>
    selfTested('$RUNNER --self-test').length === 1 && selfTested('$RUNNER --self-test')[0] === null],
  ['a grep for a line containing the words is not a command of ours', () =>
    selfTested("grep -c 'a self-test:' >/dev/null").length === 0],
  ['grep is read whichever quiet-ish flag it uses', () =>
    grepPatterns("grep -q 'x self-test:'")[0] === 'x self-test:' &&
    grepPatterns("grep -c 'y'")[0] === 'y' &&
    grepPatterns("grep -qE 'z'")[0] === 'z'],
  ['no grep is no pattern', () => grepPatterns('node a.mjs --self-test').length === 0],
  ['🔴 every grep in the step is read, not only the first', () =>
    grepPatterns("grep -q 'a self-test:'\ngrep -q 'b self-test:'").join(',') ===
      'a self-test:,b self-test:'],
  ['🔴 a step self-testing two scripts with one grep is not locked', () =>
    auditStep({
      name: 'X',
      run: "set -o pipefail\nnode a.mjs --self-test && node b.mjs --self-test | grep -c 'a self-test:' >/dev/null",
      scripts: ['a.mjs', 'b.mjs'],
    }).why.includes('does not name b')],
  ['🔴 …and is, once both are grepped', () =>
    auditStep({
      name: 'X',
      run: "set -o pipefail\nnode a.mjs --self-test | grep -c 'a self-test:' >/dev/null\nnode b.mjs --self-test | grep -c 'b self-test:' >/dev/null",
      scripts: ['a.mjs', 'b.mjs'],
    }) === null],
  ['🔴 a step that never reads its output is a problem', () =>
    auditStep({ name: 'X', run: 'node a.mjs --self-test', scripts: ['a.mjs'] }).why.includes('never reads')],
  ['🔴 a grep without pipefail is a problem', () =>
    auditStep({ name: 'X', run: "node a.mjs --self-test | grep -c 'a self-test:' >/dev/null", scripts: ['a.mjs'] }).why.includes('pipefail')],
  ['🔴 `grep -q` is refused: it closes the pipe and pipefail reads 141', () =>
    auditStep({
      name: 'X',
      run: "set -o pipefail\nnode a.mjs --self-test | grep -q 'a self-test:'",
      scripts: ['a.mjs'],
    }).why.includes('SIGPIPE')],
  ['a `-c` lock that reads to EOF is accepted', () =>
    auditStep({
      name: 'X',
      run: "set -o pipefail\nnode a.mjs --self-test | tee /dev/stderr | grep -c 'a self-test:' >/dev/null",
      scripts: ['a.mjs'],
    }) === null],
  ['🔴 a grep for somebody else\u2019s line is a problem', () =>
    auditStep({ name: 'X', run: "set -o pipefail\nnode a.mjs --self-test | grep -c '✓ self-test passed' >/dev/null", scripts: ['a.mjs'] }).why.includes('does not name')],
  ['a locked step is no problem', () =>
    auditStep({ name: 'X', run: "set -o pipefail\nnode a.mjs --self-test | tee /dev/stderr | grep -c 'a self-test:' >/dev/null", scripts: ['a.mjs'] }) === null],
  ['🔴 one script run in two workflows may share its line', () =>
    sharedPatterns([
      { key: 'ci :: a', patterns: ['x self-test:'], scripts: 'scripts/x.mjs' },
      { key: 'other :: a', patterns: ['x self-test:'], scripts: 'scripts/x.mjs' },
    ]).length === 0],
  ['🔴 …but two different scripts sharing one line do not', () => {
    const clash = sharedPatterns([
      { key: 'ci :: a', patterns: ['self-test passed'], scripts: 'scripts/x.mjs' },
      { key: 'ci :: b', patterns: ['self-test passed'], scripts: 'scripts/y.mjs' },
    ]);
    return clash.length === 1 && clash[0].steps.length === 2;
  }],
  ['a step with no grep is not a clash', () =>
    sharedPatterns([
      { key: 'ci :: a', patterns: [], scripts: 'scripts/x.mjs' },
      { key: 'ci :: b', patterns: [], scripts: 'scripts/y.mjs' },
    ]).length === 0],
  ['the basename is matched without its extension', () =>
    auditStep({ name: 'X', run: "set -o pipefail\nnode dir/check-eu-scope.mjs --self-test | grep -c 'check-eu-scope self-test:' >/dev/null", scripts: ['dir/check-eu-scope.mjs'] }) === null],
];

const EXPECTED_CASES = 28;

function selfTest() {
  let failed = 0;
  for (const [what, go] of CASES) {
    let ok;
    try { ok = go() === true; } catch (err) { ok = false; console.log(`    threw: ${err.message}`); }
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what}`);
  }
  if (CASES.length !== EXPECTED_CASES) {
    failed++;
    console.log(`✗ ${CASES.length} cases, expected ${EXPECTED_CASES}`);
  }
  console.log(
    failed
      ? `\n::error::check-selftest-steps self-test failed on ${failed} case(s)`
      : `\n✓ check-selftest-steps self-test: ${CASES.length} cases over step parsing and the lock rules`,
  );
  process.exit(failed ? 1 : 0);
}

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
    ['--self-test', '--update'],
    'check-selftest-steps.mjs',
  );
  if (action.has('--self-test')) selfTest();
  else run(action);
}
