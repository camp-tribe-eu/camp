#!/usr/bin/env node
// CAMP-347: a workflow job that calls `gh` must be able to name the repository.
//
//   node scripts/ci/check-gh-needs-repo.mjs
//   node scripts/ci/check-gh-needs-repo.mjs --self-test
//
// 🔴 WHY.
//
// `gh` resolves the repository from the GIT REMOTE. Not from
// GITHUB_REPOSITORY, which Actions always sets. So a job that does no
// `actions/checkout`, sets no `GH_REPO` and passes no `--repo` fails
// every single call with
//
//     failed to run git: fatal: not a git repository
//
// and exits 1 before doing anything.
//
// 🔴 AND THE JOBS THAT DO THIS ARE ALARMS, which is what makes it
// expensive. An alarm job runs only when something is already broken,
// so the defect hides until the day it matters, and then the thing that
// was supposed to tell somebody is the thing that breaks.
//
// Measured, not supposed. osm-weekly.yml's `alert` job is gated on
// `contains(needs.*.result, 'failure')`, so it only runs when something
// else has already broken. Counting the workflow's runs: five finished
// green (23.09 twice, 24.09, 28.09, 16.10) and seven finished red
// (21–22.09, branch camp-27-89-data-core) — but every one of those
// seven reports ZERO jobs, because they failed at startup, before any
// job existed. So the alert had never executed, in green runs or red
// ones. On 19.10.2026 at 04:37 UTC it ran for the first time ever (run
// 39199081913: 23 of 27 regions timed out on Geofabrik) and died on its
// first `gh` call. The issue it exists to open was never opened, and
// `gh issue list` run by hand that morning returned `[]`.
//
// 🔴 The first version of this comment said "every earlier run had been
// green". Review counted seven red ones. The conclusion survived — zero
// jobs means the alert still never ran — but the reason given for it
// was wrong, and a reason nobody checked is how a true sentence ends up
// resting on a false one.
//
// 🔴 THE REPOSITORY ALREADY KNEW. backup-verify.yml:265 carries the fix
// AND the explanation, written during CAMP-58. watchdog.yml solves it a
// different way, with a checkout. Three workflows call `gh`, two were
// protected by two different mechanisms, one by nothing — and nothing
// compared them. That is the shape this file exists to close.
//
// 🔴 WHAT THIS DOES NOT CHECK, and why it is written down rather than
// guessed at: whether a `--label` passed to `gh issue create` exists.
// It does not — `ci` was passed by this same job and this repository
// has no such label, which would have killed the first-failure branch
// even after GH_REPO was set (measured 19.10.2026: 13 labels, none
// named `ci`). Answering that needs the network, which a CI guard
// should not; it is fixed in place and left out of the rule.
//
// 🔴 TWO MORE BLIND SPOTS, written down rather than discovered later.
// This rule reads the literal word `gh` in a `run:` body, so it cannot
// see a job whose script reaches the CLI itself — watchdog.yml's
// `dependabot-prs` runs check-dependabot-prs.mjs, which calls
// `execFile('gh', …)`, and this guard does not count it. That job is
// safe for its own reason: it builds `repos/{owner}/{repo}` paths from
// GITHUB_REPOSITORY rather than letting `gh` guess. Nor can the rule
// read a step with `shell: python`. Following a call graph through
// Node is a different guard, not a wider regex here.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 🔴 Named import: js-yaml 5 removed the default export. On 4 the line
// `import yaml from 'js-yaml'` worked; on 5 it throws at module load,
// so the guard would go silent about what it guards.
import { load as loadYaml } from 'js-yaml';
import { chooseAction, flagValue } from '../lib/entrypoint.mjs';
// 🔴 One definition, two users. A heredoc body inside a `run:` is DATA,
// and a line of it saying "if this breaks, run gh issue list by hand"
// is prose — review found this rule reading exactly that as a call.
// check-pipe-to-grep-q.mjs already had to learn where heredoc bodies
// start and end (CAMP-333); re-deriving it here would be the second
// list that goes stale.
import { heredocLines } from './check-pipe-to-grep-q.mjs';

const WHO = 'check-gh-needs-repo';
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');

// Commands that PRINT their arguments. A line mentioning `gh` inside
// an error message is prose, not an invocation.
const PRINTERS = new Set(['echo', 'printf', ':', 'cat']);

/**
 * The command segments of a shell line, with comments removed.
 *
 * Split on the separators that start a new command, so `timeout 60 gh`
 * and `x && gh` are seen for what they are.
 */
function segments(line) {
  return line
    .replace(/(^|\s)#.*$/, '')
    .split(/\|\||&&|[;|()]|\$\(/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether a shell segment runs the `gh` CLI.
 *
 * 🔴 BY COMMAND, NOT BY SPELLING — the lesson CAMP-333 cost three
 * rounds of review to learn. A regex anchored on "`gh` at the start of
 * a command" reads only the spelling this repository happens to use and
 * walks past `timeout 60 gh issue list`, `command gh`, `xargs gh` and
 * `/usr/bin/gh`. So: any token in the segment whose basename is exactly
 * `gh` counts — `ghost` and `ghcr.io/x` do not, because the comparison
 * is equality, not a substring.
 *
 * The one exception is a segment that merely PRINTS: `echo use gh
 * instead` names the tool, it does not run it.
 *
 * Known gap, written down rather than guessed at: `$GH issue list`,
 * where the command is a variable this file cannot resolve.
 */
function segmentRunsGh(seg) {
  const tokens = seg.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z_0-9]*=/.test(tokens[i])) i++;
  if (i < tokens.length && PRINTERS.has(tokens[i])) return false;
  return tokens.slice(i).some((t) => {
    const bare = t.replace(/\\/g, '').replace(/^['"]|['"]$/g, '');
    return bare.slice(bare.lastIndexOf('/') + 1) === 'gh';
  });
}

/** The lines of a `run:` body that are code rather than heredoc data. */
function codeLines(run) {
  const inside = heredocLines(run);
  return String(run)
    .split('\n')
    .filter((_, i) => !inside.has(i + 1));
}

/** A `run:` body that invokes the `gh` CLI. */
export function callsGh(run) {
  if (typeof run !== 'string') return false;
  return codeLines(run).some((l) => segments(l).some(segmentRunsGh));
}

/**
 * Every `gh` invocation in a `run:` body names the repository itself.
 *
 * 🔴 BOTH SPELLINGS. `-R` is `--repo`, and the first version of this
 * rule knew only the long one — so `gh issue list -R owner/name`, which
 * works perfectly from a bare runner, was reported as an offence. A
 * guard that refuses correct code is the harm this file keeps citing,
 * arriving from the other side. The trailing separator matters too:
 * `--repo` must end there, or `--repository-is-not-a-flag` would pass.
 */
export function everyCallNamesRepo(run) {
  const calls = codeLines(run).flatMap(segments).filter(segmentRunsGh);
  return calls.length > 0 && calls.every((s) => /(^|\s)(--repo[ =]|-R\s)/.test(s));
}

/**
 * Whether a job can name the repository, and how.
 *
 * Three mechanisms, because this repository already uses two of them
 * and a rule that recognised only one would have called watchdog.yml
 * broken. Env is read at workflow, job and step level, since Actions
 * merges all three.
 */
export function resolvesRepo(workflowEnv, job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  // 🔴 A checkout only helps if it RUNS and if it checks out THIS
  // repository. Review found both holes: `if: ${{ false }}` still
  // counted, and so did `with: {repository: some-other/repo}` — after
  // which `gh` resolves a remote that points somewhere else and the
  // alarm opens its issue in a stranger's repository. Only a literal
  // false is recognised here; a real expression is somebody's intent,
  // not something this file should evaluate.
  const literallyFalse = (v) =>
    v === false || (typeof v === 'string' && /^\$\{\{\s*false\s*\}\}$|^false$/.test(v.trim()));
  const ownRepo = (w) => {
    const r = w?.repository;
    if (r === undefined || r === null) return true;
    return typeof r === 'string' && /\$\{\{\s*github\.repository\s*\}\}/.test(r);
  };
  if (
    steps.some(
      (s) =>
        typeof s?.uses === 'string' &&
        s.uses.startsWith('actions/checkout') &&
        !literallyFalse(s.if) &&
        ownRepo(s.with),
    )
  ) {
    return 'checkout';
  }
  // 🔴 BY VALUE, NOT BY PRESENCE. `GH_REPO: ''` is declared and useless:
  // measured outside a git directory, `GH_REPO="" gh issue list` fails
  // with the very "not a git repository" this card is about, while
  // `GH_REPO=owner/name` exits 0. This file's own case about floors says
  // "pins the value, not its existence"; review found the rule itself
  // not following it.
  const envHas = (e) => {
    if (!e || typeof e !== 'object') return false;
    const v = e.GH_REPO;
    return typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null;
  };
  if (envHas(workflowEnv) || envHas(job?.env)) return 'GH_REPO';
  const ghSteps = steps.filter((s) => callsGh(s?.run));
  if (ghSteps.length > 0 && ghSteps.every((s) => envHas(s?.env) || everyCallNamesRepo(s.run))) {
    return 'per-step';
  }
  return null;
}

/**
 * Every job that calls `gh` without a way to resolve the repository.
 *
 * `files` is `{ name: text }` so the cases below can hand it strings
 * and the real run can hand it the workflow directory.
 */
export function offenders(files) {
  const out = [];
  for (const [name, text] of Object.entries(files)) {
    let doc;
    try {
      doc = loadYaml(text);
    } catch (err) {
      out.push({ file: name, job: '(whole file)', why: `does not parse: ${err.message}` });
      continue;
    }
    // A composite action is a flat list of steps, not a map of jobs.
    const jobs =
      doc && typeof doc === 'object' && doc.jobs && typeof doc.jobs === 'object'
        ? doc.jobs
        : doc?.runs?.steps
          ? { '(composite)': { steps: doc.runs.steps } }
          : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      if (!steps.some((s) => callsGh(s?.run))) continue;
      if (resolvesRepo(doc?.env, job) === null) {
        out.push({
          file: name,
          job: jobName,
          why: 'calls `gh` with no actions/checkout, no GH_REPO and no --repo',
        });
      }
    }
  }
  return out;
}

/** Which jobs call `gh`, and by which mechanism they are covered. */
export function inventory(files) {
  const rows = [];
  for (const [name, text] of Object.entries(files)) {
    let doc;
    try {
      doc = loadYaml(text);
    } catch {
      continue;
    }
    const jobs =
      doc?.jobs && typeof doc.jobs === 'object'
        ? doc.jobs
        : doc?.runs?.steps
          ? { '(composite)': { steps: doc.runs.steps } }
          : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      if (!steps.some((s) => callsGh(s?.run))) continue;
      rows.push({ file: name, job: jobName, by: resolvesRepo(doc?.env, job) });
    }
  }
  return rows;
}

function readYamlTree(root = ROOT) {
  const files = {};
  const dirs = [
    path.join(root, '.github', 'workflows'),
    path.join(root, '.github', 'actions'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!e.isFile() || !/\.ya?ml$/.test(e.name)) continue;
      const full = path.join(e.parentPath ?? e.path ?? dir, e.name);
      files[path.relative(root, full)] = readFileSync(full, 'utf8');
    }
  }
  return files;
}

// 🔴 A floor, equal to today's count. A run that reads two workflows
// instead of eight is not a clean run, and an inventory that does not
// reconcile with a raw count is a label (CAMP-333).
const MIN_YAML_FILES = 8;

export function readEnough(n) {
  return n >= MIN_YAML_FILES;
}

function main(root = ROOT) {
  const files = readYamlTree(root);
  if (!readEnough(Object.keys(files).length)) {
    console.log(
      `::error::${WHO}: read ${Object.keys(files).length} yaml file(s), expected at least ` +
        `${MIN_YAML_FILES}. The rule is not running over the tree.`,
    );
    process.exit(1);
  }
  const rows = inventory(files);
  const bad = offenders(files);
  for (const r of rows) {
    console.log(`  ${r.by ? '✓' : '✗'} ${r.file} → ${r.job}${r.by ? ` (${r.by})` : ''}`);
  }
  if (bad.length > 0) {
    for (const b of bad) console.log(`::error file=${b.file}::job \`${b.job}\` ${b.why}`);
    console.log(
      `\n::error::${WHO}: ${bad.length} job(s) call \`gh\` with no way to name the repository. ` +
        '`gh` reads the git remote, not GITHUB_REPOSITORY, so every call dies with ' +
        '"not a git repository" — and an alarm job fails exactly when it is needed. ' +
        'Add `GH_REPO: ${{ github.repository }}` to its env (CAMP-347).',
    );
    process.exit(1);
  }
  console.log(`✓ ${WHO}: ${Object.keys(files).length} yaml file(s), ${rows.length} job(s) call gh, all can name the repo`);
}

const wf = (jobYaml) => ({ 'w.yml': jobYaml });

const CASES = [
  ['a job with no gh call is not our business', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: echo hi\n')).length === 0],
  ['🔴 a gh call with nothing to resolve the repo is caught', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: gh issue create --title x\n')).length === 1],
  ['…and the report names the job', () =>
    offenders(wf('jobs:\n  alert:\n    steps:\n      - run: gh issue list\n'))[0].job === 'alert'],
  ['actions/checkout covers it — the way watchdog.yml does', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - run: gh issue list\n')).length === 0],
  ['…including a pinned SHA after the name', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - uses: actions/checkout@11bd719\n      - run: gh issue list\n')).length === 0],
  ['🔴 a DIFFERENT action is not a checkout', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n      - run: gh issue list\n')).length === 1],
  ['GH_REPO on the step covers it — the way backup-verify.yml does', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - env:\n          GH_REPO: x/y\n        run: gh issue list\n')).length === 0],
  ['GH_REPO on the job covers it', () =>
    offenders(wf('jobs:\n  a:\n    env:\n      GH_REPO: x/y\n    steps:\n      - run: gh issue list\n')).length === 0],
  ['GH_REPO at workflow level covers it', () =>
    offenders(wf('env:\n  GH_REPO: x/y\njobs:\n  a:\n    steps:\n      - run: gh issue list\n')).length === 0],
  ['🔴 GH_TOKEN alone does NOT — it authenticates, it does not name', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - env:\n          GH_TOKEN: t\n        run: gh issue list\n')).length === 1],
  ['--repo on every call covers it', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: gh issue list --repo x/y\n')).length === 0],
  ['🔴 --repo on only SOME calls does not', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: |\n          gh issue list --repo x/y\n          gh issue create --title t\n')).length === 1],
  ['🔴 GH_REPO on one step does not cover a sibling step without it', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - env:\n          GH_REPO: x/y\n        run: gh issue list\n      - run: gh issue create --title t\n')).length === 1],
  ['a gh call later in a pipeline is still a gh call', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: cat f | gh issue create --title t\n')).length === 1],
  ['…and one inside $( )', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: N=$(gh issue list --json number)\n')).length === 1],
  ['…and one after &&', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: true && gh issue list\n')).length === 1],
  ['🔴 `gh` inside a COMMENT is prose, not a call', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: |\n          # gh issue create would need GH_REPO\n          echo hi\n')).length === 0],
  ['🔴 a word merely starting with gh is not the CLI', () =>
    callsGh('ghost --help') === false && callsGh('  ghcr.io/x') === false],
  ['…but an indented gh is', () => callsGh('    gh issue list') === true],
  ['🔴 a wrapper does not hide it: timeout, command, xargs, a full path', () =>
    ['timeout 60 gh issue list', 'command gh issue list', 'cat f | xargs gh issue view',
     '/usr/bin/gh issue list'].every((l) => callsGh(l) === true)],
  ['🔴 …nor a VAR= in front', () => callsGh('GH_PAGER=cat gh issue list') === true],
  ['🔴 …and a VAR= in front of a PRINTER still prints', () =>
    callsGh('LC_ALL=C echo "run gh manually"') === false],
  ['🔴 the alias-dodging backslash and a quoted name are still gh', () =>
    callsGh('\\gh issue list') === true && callsGh("'gh' issue list") === true],
  ['🔴 but a segment that only PRINTS the word does not run it', () =>
    callsGh('echo use gh instead') === false && callsGh('printf "%s" "gh issue list"') === false],
  ['🔴 a gh inside a $( ) in a comment is still a comment', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: |\n          # N=$(gh issue list) would need GH_REPO\n          echo hi\n')).length === 0],
  ['a composite action is read as steps, not jobs', () =>
    offenders({ 'a/action.yml': 'runs:\n  using: composite\n  steps:\n    - run: gh issue list\n      shell: bash\n' }).length === 1],
  ['…and a covered composite action passes', () =>
    offenders({ 'a/action.yml': 'runs:\n  using: composite\n  steps:\n    - run: gh issue list --repo x/y\n      shell: bash\n' }).length === 0],
  ['🔴 yaml that does not parse is an error, not silence', () =>
    offenders({ 'bad.yml': 'jobs:\n  a:\n   - [unclosed\n' }).length === 1],
  ['the inventory says HOW each job is covered', () => {
    const rows = inventory({
      'c.yml': 'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - run: gh issue list\n',
      'e.yml': 'jobs:\n  b:\n    env:\n      GH_REPO: x/y\n    steps:\n      - run: gh issue list\n',
      'r.yml': 'jobs:\n  c:\n    steps:\n      - run: gh issue list --repo x/y\n',
    });
    return rows.map((r) => r.by).sort().join(',') === 'GH_REPO,checkout,per-step';
  }],
  ['…and a job with no gh call is not in it', () =>
    inventory(wf('jobs:\n  a:\n    steps:\n      - run: echo hi\n')).length === 0],
  ['🔴 the floor pins the value, not its existence', () =>
    readEnough(8) === true && readEnough(7) === false],
  ['🔴 GH_REPO must have a VALUE: an empty one is declared and useless', () =>
    offenders(wf("jobs:\n  a:\n    steps:\n      - env:\n          GH_REPO: ''\n        run: gh issue list\n")).length === 1],
  ['…and a non-empty one covers it', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - env:\n          GH_REPO: x/y\n        run: gh issue list\n')).length === 0],
  ['🔴 -R is --repo: refusing it would refuse correct code', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - run: gh issue list -R x/y\n')).length === 0],
  ['🔴 …but --repository-ish is not --repo', () =>
    everyCallNamesRepo('gh issue list --repose x/y') === false],
  ['🔴 a checkout that cannot run does not cover anything', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        if: ${{ false }}\n      - run: gh issue list\n')).length === 1],
  ['🔴 nor one that checks out SOMEBODY ELSE', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          repository: other/repo\n      - run: gh issue list\n')).length === 1],
  ['…but checking out this repository explicitly does', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          repository: ${{ github.repository }}\n      - run: gh issue list\n')).length === 0],
  ['🔴 an action merely named like a checkout is not actions/checkout', () =>
    offenders(wf('jobs:\n  a:\n    steps:\n      - uses: acme/checkout-helper@v1\n      - run: gh issue list\n')).length === 1],
  ['🔴 bash -c still runs gh', () => callsGh('bash -c "gh issue list"') === true],
  ['🔴 a heredoc BODY is data: prose about gh is not a call', () =>
    callsGh("cat <<'EOF' > note.txt\nIf this breaks, run gh issue list by hand.\nEOF\n") === false],
  ['…and the line after the heredoc is read again', () =>
    callsGh("cat <<'EOF' > note.txt\nrun gh issue list by hand\nEOF\ngh issue create --title t\n") === true],
];

const EXPECTED_CASES = 48;

/**
 * The script, run the way CI runs it, against a tree built here.
 *
 * Eight yaml files, because the real floor is eight and a rehearsal
 * that lowered it would be rehearsing a different program.
 */
function rehearseEnforcement() {
  const self = fileURLToPath(import.meta.url);
  const run = (offending, n = 7) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'gh-needs-repo-'));
    const wf = path.join(dir, '.github', 'workflows');
    mkdirSync(wf, { recursive: true });
    for (let i = 0; i < n; i++) {
      writeFileSync(path.join(wf, `ok${i}.yml`), 'jobs:\n  a:\n    steps:\n      - run: echo hi\n');
    }
    writeFileSync(
      path.join(wf, 'subject.yml'),
      offending
        ? 'jobs:\n  alert:\n    steps:\n      - run: gh issue create --title t\n'
        : 'jobs:\n  alert:\n    steps:\n      - env:\n          GH_REPO: x/y\n        run: gh issue create --title t\n',
    );
    return spawnSync(process.execPath, [self, '--dir', dir], { encoding: 'utf8' });
  };
  const bad = run(true);
  const good = run(false);
  // 🔴 And a tree too small to mean anything is a failure, not a ✓.
  // Without this the floor in main() survived every case, because the
  // rehearsal above always built exactly enough files for it to pass.
  const thin = run(false, 1);
  return [
    ['🔴 REHEARSAL: a tree of 3 yaml files exits 1 — the rule is not running', thin.status === 1],
    ['🔴 REHEARSAL: …and says so, rather than printing a ✓', /is not running over the tree/.test(thin.stdout)],
    ['🔴 REHEARSAL: a bare gh job makes the script EXIT 1, not just print', bad.status === 1],
    ['🔴 REHEARSAL: …and it names the file and the job', /subject\.yml/.test(bad.stdout) && /alert/.test(bad.stdout)],
    ['🔴 REHEARSAL: a covered tree exits 0', good.status === 0],
    ['🔴 REHEARSAL: --dir is read, not merely accepted (CAMP-286)', /8 yaml file/.test(good.stdout)],
  ];
}

function selfTest() {
  let failed = 0;
  let ran = 0;
  for (const [what, run] of CASES) {
    let ok;
    try { ok = run() === true; } catch (err) { ok = false; console.log(`    threw: ${err.message}`); }
    ran++;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what}`);
  }
  for (const [what, ok] of rehearseEnforcement()) {
    ran++;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what}`);
  }
  if (ran !== EXPECTED_CASES) {
    failed++;
    console.log(`✗ ran ${ran} cases, expected ${EXPECTED_CASES}`);
  }
  console.log(
    failed
      ? `\n::error::${WHO} self-test failed on ${failed} case(s)`
      : `\n✓ ${WHO} self-test: ${ran} cases, a gh call must be able to name its repo`,
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
  // 🔴 `--dir` exists so the REHEARSAL can run this file as CI runs it,
  // against a tree it built. Review found the enforcement path — the
  // `if (bad.length > 0) process.exit(1)` — surviving a mutation to
  // `if (false && …)` with all cases still green, because every case
  // called a pure function and nothing ever called the script. A guard
  // whose refusal nobody rehearses is a guard that prints.
  // `flagValue` reads both `--dir x` and `--dir=x`: a spelling the
  // parser accepts but the caller never reads is CAMP-286.
  chooseAction(process.argv.slice(2), ['--self-test', '--dir'], `${WHO}.mjs`, {
    takesValue: ['--dir'],
  });
  if (process.argv.includes('--self-test')) selfTest();
  else main(flagValue(process.argv.slice(2), '--dir') ?? ROOT);
}
