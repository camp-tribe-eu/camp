#!/usr/bin/env node
// CAMP-333: nothing in a shell file may pipe into `grep -q`.
//
//   node scripts/ci/check-pipe-to-grep-q.mjs
//   node scripts/ci/check-pipe-to-grep-q.mjs --self-test
//
// 🔴 WHY.
//
// `grep -q` exits at the FIRST match and closes its end of the pipe. The
// writer, which has not finished, then takes SIGPIPE — and under
// `set -o pipefail` the pipeline reports the worst code in it, so a
// successful match reads as a failure. On 16.10.2026 one run in ~1500 of
// move-table.selftest.sh went red this way, with
// `printf: write error: Broken pipe` in the log above it.
//
// Reproduced deliberately on 18.10.2026 before this file was written,
// and the mechanism is sharper than "sometimes, under load". The race
// fires exactly when the writer has NOT FINISHED at the moment grep
// exits, and there are two ways to be unfinished.
//
// 1. BLOCKED ON A FULL PIPE. The buffer is 65 536 bytes on macOS and on
//    Linux. Measured here, 8 cores, match in the first line:
//
//        43 114 bytes → 0 false reds in 400, idle AND under 32 spinners
//        86 314 bytes → 400 of 400, idle AND under 32 spinners
//
//    A cliff, not a probability. Load does not move it: it only decides
//    whether a writer that is ALREADY blocked loses.
//
// 2. STILL PRODUCING. This one has no threshold at all:
//
//        { echo MATCH; sleep 0.05; echo more; } | grep -q MATCH
//        → 50 false reds of 50, on 20 bytes
//
//    …and the same writer read by `grep -c` → 0 of 50. So `curl | …`,
//    `psql | …`, `node x --self-test | …` are unsafe at any size.
//
// 🔴 AND THE INCIDENT ITSELF IS NOT EXPLAINED BY WHAT THIS REPOSITORY
// WRITES TODAY. Every one of the 226 pipelines removed in this commit
// had an instantaneous writer — `printf '%s' "$VAR"` or `echo "$VAR"` —
// and the largest $VAR the move-table suite produces, measured by
// instrumenting all 69 of its pipelines through one green run, is 2 654
// bytes. Hammered at exactly that size with the match in the first line:
// 0 false reds in 200 000 iterations under 32 spinners. So either that
// run's output crossed 65 536 bytes (a psql error dump under contention
// would), or the false red had another cause. The construct is gone
// either way, and the rule below does not depend on which it was.
//
// 🔴 WHY THE RULE IS UNCONDITIONAL, AND NOT "ONLY WHERE pipefail IS SET".
//
// Two reasons, both measured on this repository.
//
// First, reading for pipefail is how you get this wrong. Writing the
// obvious /set .*-o pipefail/ while auditing this card reported
// infra/deploy.selftest.sh as a file with NO pipefail and therefore 110
// harmless pipelines. It sets `set -uo pipefail` on line 27. `-uo` does
// not contain `-o `.
//
// Second, even a file that genuinely has no pipefail is one line away
// from arming every such pipeline at once, and that line is normally
// added by somebody tightening the file, who has no reason to re-read
// 110 greps. A rule that goes quiet on a neighbouring edit is half a
// rule (CAMP-285 again, one layer down).
//
// 🔴 WHAT TO WRITE INSTEAD.
//
//   grep -q 'x' <<<"$OUT"        herestring: no pipe exists at all
//   [[ "$OUT" == *x* ]]          for a plain substring
//   case "$OUT" in *x*) … esac   likewise, and POSIX
//   cmd | grep -c 'x' >/dev/null  when the reader must be a pipeline:
//                                 -c reads to the end, so nothing is
//                                 ever cut off mid-write
//
// 🔴 NOT `|| true`: that hides a grep that genuinely did not match,
// which is the whole assertion. And not `set +o pipefail` for the file:
// pipefail catches other things.
//
// 🔴 WHAT THIS READS AND WHAT IT DOES NOT.
//
// Shell files, and the `run:` blocks of workflows — not .mjs, because
// check-selftest-steps.mjs holds this very pattern inside string
// literals as the fixtures of its own self-test, and a guard that reads
// prose instead of code stops somebody else's correct PR. Full-line `#`
// comments are stripped for the same reason: extract-campsites.selftest.sh
// explains in a comment why it does NOT pipe into grep -q.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

const WHO = 'check-pipe-to-grep-q';

/**
 * A pipe (not `||`) feeding a `grep` that is asked to be quiet.
 *
 * `-q`, `--quiet` and `--silent` all mean the same thing to grep, and
 * the short flag can be bundled (`-qE`, `-qi`, `-qx`) or carry its
 * pattern after a `--`. The lookbehind is what keeps `cmd || grep -q 'x'
 * <<<"$v"` — a herestring on the right of an OR — out of the net.
 */
const PIPE_TO_QUIET_GREP = /(?<!\|)\|&?[ \t]*grep[ \t]+(?:-[a-zA-Z]*q|--quiet|--silent)/;

/** A line with its full-line comment removed, or '' if that is all it was. */
function code(line) {
  return /^[ \t]*#/.test(line) ? '' : line;
}

/**
 * Every offending line in a shell source, as {line, text}.
 *
 * Takes text rather than a path so the cases below can state a source in
 * one string instead of a fixture file nobody reads.
 */
export function offences(source) {
  const out = [];
  source.split('\n').forEach((line, i) => {
    if (PIPE_TO_QUIET_GREP.test(code(line))) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

/**
 * The `run:` blocks of a workflow, flattened into one scannable text
 * with the original line numbers kept.
 *
 * A workflow is YAML, so a `run: |` block is the only place a shell line
 * can live; everything else is keys, and `grep -q` in a key would be a
 * string, not a command.
 */
export function runBlocks(yaml) {
  const lines = yaml.split('\n');
  const out = [];
  let indent = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (indent === null) {
      const m = /^([ \t]*)(?:- )?run:[ \t]*[|>]/.exec(line);
      if (m) indent = m[1].length;
      continue;
    }
    const lead = /^[ \t]*/.exec(line)[0].length;
    if (line.trim() !== '' && lead <= indent) { indent = null; i--; continue; }
    if (line.trim() === '') continue;
    out.push({ line: i + 1, text: line });
  }
  return out;
}

/** Files this rule applies to, as git knows them. */
export function shellFiles(list) {
  return list.filter((f) => f.endsWith('.sh') || f.startsWith('infra/bin/'));
}

/** Workflows this rule applies to. */
export function workflowFiles(list) {
  return list.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f));
}

function tracked() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function main() {
  const all = tracked();
  const shells = shellFiles(all);
  const flows = workflowFiles(all);
  const found = [];

  for (const f of shells) {
    for (const o of offences(readFileSync(f, 'utf8'))) found.push({ file: f, ...o });
  }
  for (const f of flows) {
    const yaml = readFileSync(f, 'utf8');
    for (const { line, text } of runBlocks(yaml)) {
      if (PIPE_TO_QUIET_GREP.test(code(text))) found.push({ file: f, line, text: text.trim() });
    }
  }

  // 🔴 The inventory is reconciled, not assumed: a tree with no shell
  // files at all would otherwise print the same ✓ as a clean one.
  if (shells.length === 0) {
    console.log(`::error::${WHO}: found no shell files to read. The rule is not running.`);
    process.exit(1);
  }

  if (found.length > 0) {
    for (const { file, line, text } of found) {
      console.log(`::error file=${file},line=${line}::pipes into \`grep -q\`: ${text}`);
    }
    console.log(
      `\n::error::${WHO}: ${found.length} pipeline(s) feed \`grep -q\`. ` +
        'grep -q exits at the first match, the writer takes SIGPIPE, and ' +
        'pipefail turns a successful match into a failed step. Write ' +
        "`grep -q 'x' <<<\"$VAR\"` instead (CAMP-333).",
    );
    process.exit(1);
  }
  console.log(`✓ ${WHO}: ${shells.length} shell file(s), ${flows.length} workflow(s), no pipe into grep -q`);
}

const CASES = [
  ['a plain pipeline is caught', () => offences(`printf '%s' "$OUT" | grep -q 'x'`).length === 1],
  ['…and the line number is the real one', () =>
    offences(`a\nb\nprintf '%s' "$O" | grep -q 'x'`)[0].line === 3],
  ['a herestring is not a pipeline', () => offences(`grep -q 'x' <<<"$OUT"`).length === 0],
  ['🔴 `||` before grep -q is not a pipe', () =>
    offences(`[ -z "$h" ] || grep -qi 'noindex' <<<"$h"`).length === 0],
  ['no space before grep is still a pipe', () => offences(`echo "$O" |grep -q 'x'`).length === 1],
  ['a tab before grep is still a pipe', () => offences(`echo "$O" |\tgrep -q 'x'`).length === 1],
  ['bundled flags are caught: -qE', () => offences(`echo "$O" | grep -qE '^[0-9]+$'`).length === 1],
  ['🔴 the flags in the OTHER order: -Eq — three real ones hid there', () =>
    offences(`printf '%s' "$b" | grep -Eq '^x$'`).length === 1],
  ['bundled flags are caught: -qi', () => offences(`echo "$O" | grep -qi 'x'`).length === 1],
  ['bundled flags are caught: -qx', () => offences(`echo "$O" | grep -qx 'x'`).length === 1],
  ['a `--` separator does not hide it', () => offences(`echo "$O" | grep -q -- '--flag'`).length === 1],
  ['--quiet is the same flag spelled out', () => offences(`echo "$O" | grep --quiet 'x'`).length === 1],
  ['--silent likewise', () => offences(`echo "$O" | grep --silent 'x'`).length === 1],
  ['🔴 |& is a pipe too', () => offences(`cmd |& grep -q 'x'`).length === 1],
  ['🔴 the writer is not only printf', () =>
    offences(`readlink "$p" | grep -q 'x'`).length === 1 &&
    offences(`curl -s "$u" | grep -q 'x'`).length === 1 &&
    offences(`node a.mjs --self-test | grep -q 'a:'`).length === 1],
  ['grep -c reads to the end, so it is allowed', () =>
    offences(`node a.mjs | grep -c 'x' >/dev/null`).length === 0],
  ['grep -o, -v, -E alone are allowed', () =>
    offences(`echo "$O" | grep -o 'x'`).length === 0 &&
    offences(`echo "$O" | grep -v 'x'`).length === 0 &&
    offences(`echo "$O" | grep -E 'x'`).length === 0],
  ['🔴 a flag merely containing q is not -q', () =>
    offences(`echo "$O" | grep --regexp='q' 'x'`).length === 0],
  ['🔴 a full-line comment is prose, not code', () =>
    offences(`# not \`osmium … | grep -q\` — it exits on the first hit`).length === 0],
  ['…but an indented comment too', () =>
    offences(`    # echo "$O" | grep -q 'x'`).length === 0],
  ['🔴 a real line after a comment is still read', () =>
    offences(`# echo "$O" | grep -q 'x'\necho "$O" | grep -q 'y'`).length === 1],
  ['every offence on a multi-grep line is one report, by line', () =>
    offences(`a | grep -q 'x' && b | grep -q 'y'`).length === 1],
  ['two offending lines are two reports', () =>
    offences(`a | grep -q 'x'\nb | grep -q 'y'`).length === 2],
  ['the reported text is the line, trimmed', () =>
    offences(`   echo "$O" | grep -q 'x'   `)[0].text === `echo "$O" | grep -q 'x'`],
  ['a run: block is found', () =>
    runBlocks('jobs:\n  a:\n    steps:\n      - name: X\n        run: |\n          echo hi\n').length === 1],
  ['🔴 two run: blocks in a row: the second is not eaten by the first', () => {
    const got = runBlocks('      - run: |\n          a\n      - run: |\n          b\n');
    return got.length === 2 && got[1].text.trim() === 'b';
  }],
  ['🔴 a run: block ends where the indent returns', () => {
    const got = runBlocks('      - run: |\n          echo hi\n      - name: Y\n        run: echo no\n');
    return got.length === 1 && got[0].text.trim() === 'echo hi';
  }],
  ['🔴 a blank line inside a run: block does not end it', () => {
    const got = runBlocks('      - run: |\n          a\n\n          b\n');
    return got.filter((l) => l.text.trim()).length === 2;
  }],
  ['a `run: >` block is read the same way', () =>
    runBlocks('      - run: >\n          echo hi\n').length === 1],
  ['🔴 a single-line `run:` is not a block, so its text is not shell we read', () =>
    runBlocks('      - run: echo "$O" | grep -q \'x\'\n').length === 0],
  ['🔴 the file list is a glob over git, so a new sibling joins by itself', () =>
    shellFiles(['a.sh', 'b/c.sh', 'infra/bin/x', 'd.mjs', 'e.yml']).join(',') === 'a.sh,b/c.sh,infra/bin/x'],
  ['…and .mjs is deliberately outside it', () =>
    shellFiles(['scripts/ci/check-selftest-steps.mjs']).length === 0],
  ['workflows are picked by path, both spellings', () =>
    workflowFiles(['.github/workflows/ci.yml', '.github/workflows/a.yaml', '.github/actions/b.yml']).length === 2],
];

const EXPECTED_CASES = 33;

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
  // 🔴 Counted, not labelled: a case that stops being reached looks
  // exactly like a case that passed.
  if (ran !== EXPECTED_CASES) {
    failed++;
    console.log(`✗ ran ${ran} cases, expected ${EXPECTED_CASES}`);
  }
  console.log(
    failed
      ? `\n::error::${WHO} self-test failed on ${failed} case(s)`
      : `\n✓ ${WHO} self-test: ${ran} cases, pipes into grep -q refused`,
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
  chooseAction(process.argv.slice(2), ['--self-test'], `${WHO}.mjs`);
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
