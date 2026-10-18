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
 * 🔴 EVERY PIECE OF THIS WAS A REVIEW FINDING. The first version read
 * `\|[ \t]*grep -q`, which is the ONE spelling this repository happened
 * to use. Measured against it, all of these walked past:
 *
 *     grep -E -q      grep -i -q      grep -e 'x' -q
 *     grep --color=never -q           command grep -q
 *     /usr/bin/grep -q                LC_ALL=C grep -q
 *     sudo grep -q                    env grep -q
 *     egrep -q        fgrep -q
 *
 * A rule that only recognises the spelling already in the tree stops
 * nothing — it is a list of forbidden words, not a property. So: after
 * the pipe, any number of VAR=value assignments and wrapper commands,
 * an optional path, any `*grep`, then any number of flags and quoted
 * patterns, then the quiet flag in any of its three spellings.
 *
 * The run of "other tokens" is deliberately limited to things that look
 * like flags or quoted literals. Widening it to any word made
 * `cmd | grep 'x' && y -q` a false positive.
 */
const QUIET_GREP_AFTER_PIPE = new RegExp(
  '(?<!\\|)\\|&?(?!\\|)[ \\t]*' +
    '(?:[A-Za-z_][A-Za-z_0-9]*=[^ \\t]*[ \\t]+)*' +
    '(?:(?:command|env|sudo|nice|ionice|stdbuf|xargs)[ \\t]+(?:-[^ \\t]+[ \\t]+)*)*' +
    '(?:[^ \\t|]*/)?[a-z]*grep[ \\t]+' +
    '(?:(?:-[^ \\t]+|\'[^\']*\'|"[^"]*")[ \\t]+)*?' +
    '(?:-[a-zA-Z]*q[a-zA-Z]*|--quiet|--silent)(?![a-zA-Z=-])',
);

/**
 * A line with its comment removed.
 *
 * 🔴 Only from the first `#` that starts a word and is not inside
 * quotes. Cutting at any `#` would blind the rule to
 * `echo "$O" | grep -q 'x'  # why`, and a mutation proved it: turning
 * this into /#/ left every case green.
 */
export function code(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '#' && (i === 0 || /[ \t;&|]/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/**
 * Physical lines joined into the commands they actually form.
 *
 * A pipeline may be written over several lines — `cmd | \` or a line
 * that simply ends in `|`. Scanning physical lines misses both, and the
 * review found both. The number reported is the line the command STARTS
 * on, which is where somebody reading the error has to look.
 */
export function logicalLines(source) {
  const raw = source.split('\n');
  const out = [];
  let buf = null;
  let at = 0;
  for (let i = 0; i < raw.length; i++) {
    const text = code(raw[i]);
    const piece = text.replace(/\\$/, '');
    if (buf === null) { at = i + 1; buf = piece; } else { buf += ' ' + piece.trim(); }
    if (/\\$/.test(text) || /\|&?[ \t]*$/.test(text)) continue;
    out.push({ line: at, text: buf });
    buf = null;
  }
  if (buf !== null) out.push({ line: at, text: buf });
  return out;
}

/** Every offending line in a shell source, as {line, text}. */
export function offences(source) {
  return logicalLines(source)
    .filter(({ text }) => QUIET_GREP_AFTER_PIPE.test(text))
    .map(({ line, text }) => ({ line, text: text.trim() }));
}

/**
 * The shell a YAML file runs, as {line, text}.
 *
 * 🔴 THE BODY INDENT COMES FROM THE BODY, not from the key. Reading it
 * from the `run:` key let `env:` and the YAML strings under it fall
 * inside the block — a step's `env: { FOO: "a | grep -q b" }` would
 * have been reported as shell. A block scalar ends at the first
 * non-blank line indented less than its own first line.
 *
 * 🔴 AND A ONE-LINE `run:` IS SHELL TOO. Skipping it was not a
 * simplification: `- run: echo "$O" | grep -q 'x'` is a real step that
 * the first version could not see, and the case asserting it was
 * skipped could not go red under any mutation — green by construction.
 */
export function runBlocks(yaml) {
  const lines = yaml.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const block = /^([ \t]*)(?:- )?run:[ \t]*[|>][-+0-9]*[ \t]*$/.exec(lines[i]);
    if (!block) {
      const inline = /^[ \t]*(?:- )?run:[ \t]*(\S.*)$/.exec(lines[i]);
      if (inline) out.push({ line: i + 1, text: inline[1] });
      continue;
    }
    let body = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      const lead = /^[ \t]*/.exec(lines[j])[0].length;
      if (body === null) {
        if (lead <= block[1].length) break;
        body = lead;
      } else if (lead < body) break;
      out.push({ line: j + 1, text: lines[j] });
      i = j;
    }
  }
  return out;
}

/** Files this rule applies to, as git knows them. */
export function shellFiles(list) {
  return list.filter((f) => f.endsWith('.sh') || f.startsWith('infra/bin/'));
}

/**
 * YAML this rule applies to.
 *
 * 🔴 Composite actions too. `.github/actions/build-site/action.yml`
 * holds 8 `shell: bash` steps and the first version never opened it.
 */
export function yamlFiles(list) {
  return list.filter((f) => /^\.github\/(?:workflows\/[^/]+|actions\/.+)\.ya?ml$/.test(f));
}

/** The repository root, so the inventory does not depend on the CWD. */
function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function tracked(root) {
  return execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

// 🔴 Floors, not a hand-written list. A tree that suddenly reads seven
// files instead of twenty-nine is not a clean tree, and `git ls-files`
// counts from the CWD, so running this from infra/ used to print a ✓
// over 22 unread shell files and every workflow. These numbers may be
// raised when the tree grows; they may not quietly fall.
const MIN_SHELL_FILES = 25;
const MIN_YAML_FILES = 7;

/**
 * Whether the run read enough of the tree to mean anything.
 *
 * A pure function because the review found the floor unreachable from
 * the self-test: `main()` held it inline, no case could touch it, and
 * deleting it left every case green — a lock nothing rehearses.
 */
export function inventoryOk(shells, yamls) {
  return shells >= MIN_SHELL_FILES && yamls >= MIN_YAML_FILES;
}

function main() {
  const root = repoRoot();
  const all = tracked(root);
  const shells = shellFiles(all);
  const yamls = yamlFiles(all);
  const found = [];

  for (const f of shells) {
    for (const o of offences(readFileSync(`${root}/${f}`, 'utf8'))) found.push({ file: f, ...o });
  }
  for (const f of yamls) {
    for (const { line, text } of runBlocks(readFileSync(`${root}/${f}`, 'utf8'))) {
      if (QUIET_GREP_AFTER_PIPE.test(code(text))) found.push({ file: f, line, text: text.trim() });
    }
  }

  if (!inventoryOk(shells.length, yamls.length)) {
    console.log(
      `::error::${WHO}: read ${shells.length} shell file(s) and ${yamls.length} yaml file(s), ` +
        `expected at least ${MIN_SHELL_FILES} and ${MIN_YAML_FILES}. The rule is not running over the tree.`,
    );
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
  console.log(`✓ ${WHO}: ${shells.length} shell file(s), ${yamls.length} yaml file(s), no pipe into grep -q`);
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
  ['🔴 …and SEPARATED: -E -q, -i -q, -F -q, -x -q', () =>
    [`-E -q`, `-i -q`, `-F -q`, `-x -q`].every((f) => offences(`echo "$O" | grep ${f} 'x'`).length === 1)],
  ['🔴 a long flag before the quiet one does not hide it', () =>
    offences(`echo "$O" | grep --color=never -q 'x'`).length === 1],
  ['🔴 a pattern given with -e, then -q', () =>
    offences(`echo "$O" | grep -e 'x' -q`).length === 1],
  ['a `--` separator does not hide it', () => offences(`echo "$O" | grep -q -- '--flag'`).length === 1],
  ['--quiet is the same flag spelled out', () => offences(`echo "$O" | grep --quiet 'x'`).length === 1],
  ['--silent likewise', () => offences(`echo "$O" | grep --silent 'x'`).length === 1],
  ['🔴 egrep and fgrep are grep', () =>
    offences(`echo "$O" | egrep -q 'x'`).length === 1 && offences(`echo "$O" | fgrep -q 'x'`).length === 1],
  ['🔴 a full path does not hide it', () => offences(`echo "$O" | /usr/bin/grep -q 'x'`).length === 1],
  ['🔴 nor a wrapper: command, env, sudo', () =>
    [`command`, `env`, `sudo`].every((w) => offences(`echo "$O" | ${w} grep -q 'x'`).length === 1)],
  ['🔴 nor a VAR=value in front', () => offences(`echo "$O" | LC_ALL=C grep -q 'x'`).length === 1],
  ['🔴 |& is a pipe too', () => offences(`cmd |& grep -q 'x'`).length === 1],
  ['🔴 a pipeline split over two lines, with a backslash', () =>
    offences(`echo "$O" | \\\n  grep -q 'x'`).length === 1],
  ['🔴 …and split after a bare trailing pipe', () => {
    const got = offences(`echo "$O" |\n  grep -q 'x'`);
    return got.length === 1 && got[0].line === 1;
  }],
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
  ['🔴 a long flag merely starting with q is not --quiet', () =>
    offences(`echo "$O" | grep --quiet-ish 'x'`).length === 0],
  ['🔴 a quoted pattern then an unrelated -q is not grep -q', () =>
    offences(`cmd | grep 'x' && other -q`).length === 0],
  ['🔴 a full-line comment is prose, not code', () =>
    offences('# not `osmium … | grep -q` — it exits on the first hit').length === 0],
  ['…and an indented comment too', () =>
    offences(`    # echo "$O" | grep -q 'x'`).length === 0],
  ['🔴 but a TRAILING comment does not blind the line before it', () =>
    offences(`echo "$O" | grep -q 'x'  # why`).length === 1],
  ['🔴 and a # inside quotes is not a comment', () =>
    offences(`echo "$O" | grep -q '#tag'`).length === 1],
  ['🔴 …even when a space precedes it inside the quotes', () =>
    offences(`echo "$O" | grep -q 'x #y'`).length === 1],
  ['🔴 a # inside an EARLIER quoted word must not swallow the pipe after it', () =>
    offences(`echo 'a # b' | grep -q 'x'`).length === 1],
  ['🔴 a # inside a WORD is not a comment either — a URL fragment is not prose', () =>
    offences(`curl -s https://x/y#frag | grep -q 'z'`).length === 1],
  ['🔴 a run: | with nothing indented under it has no body', () =>
    runBlocks('      - run: |\n      - name: Y\n          echo hi\n').length === 0],
  ['🔴 a real line after a comment is still read', () =>
    offences(`# echo "$O" | grep -q 'x'\necho "$O" | grep -q 'y'`).length === 1],
  ['every offence on a multi-grep line is one report, by line', () =>
    offences(`a | grep -q 'x' && b | grep -q 'y'`).length === 1],
  ['two offending lines are two reports', () =>
    offences(`a | grep -q 'x'\nb | grep -q 'y'`).length === 2],
  ['a run: block is found', () =>
    runBlocks('jobs:\n  a:\n    steps:\n      - name: X\n        run: |\n          echo hi\n').length === 1],
  ['🔴 two run: blocks in a row: the second is not eaten by the first', () => {
    const got = runBlocks('      - run: |\n          a\n      - run: |\n          b\n');
    return got.length === 2 && got[1].text.trim() === 'b';
  }],
  ['🔴 a run: block ends where the indent returns', () => {
    const got = runBlocks('      - run: |\n          echo hi\n      - name: Y\n');
    return got.length === 1 && got[0].text.trim() === 'echo hi';
  }],
  ['🔴 a sibling key under the SAME step ends the block', () => {
    const got = runBlocks('      - run: |\n          echo hi\n        env:\n          FOO: "a | grep -q b"\n');
    return got.length === 1 && got[0].text.trim() === 'echo hi';
  }],
  ['🔴 a blank line inside a run: block does not end it', () =>
    runBlocks('      - run: |\n          a\n\n          b\n').length === 2],
  ['a `run: >` block is read the same way', () =>
    runBlocks('      - run: >\n          echo hi\n').length === 1],
  ['a chomping indicator is still a block', () =>
    runBlocks('      - run: |-\n          echo hi\n').length === 1],
  ['🔴 a single-line `run:` is shell and IS read', () => {
    const got = runBlocks(`      - run: echo "$O" | grep -q 'x'\n`);
    return got.length === 1 && QUIET_GREP_AFTER_PIPE.test(got[0].text);
  }],
  ['🔴 the file list is a glob over git, so a new sibling joins by itself', () =>
    shellFiles(['a.sh', 'b/c.sh', 'infra/bin/x', 'd.mjs', 'e.yml']).join(',') === 'a.sh,b/c.sh,infra/bin/x'],
  ['…and .mjs is deliberately outside it', () =>
    shellFiles(['scripts/ci/check-selftest-steps.mjs']).length === 0],
  ['workflows are picked by path, both spellings', () =>
    yamlFiles(['.github/workflows/ci.yml', '.github/workflows/a.yaml']).length === 2],
  ['🔴 composite actions are read too, and nothing else under .github', () =>
    yamlFiles(['.github/actions/build-site/action.yml', '.github/dependabot.yml']).join(',') ===
      '.github/actions/build-site/action.yml'],
  ['🔴 the whole tree read is a pass', () => inventoryOk(29, 8) === true],
  ['🔴 …and a run that saw only infra/ is a FAILURE, not a ✓', () =>
    inventoryOk(7, 0) === false],
  ['🔴 shell files alone are not enough: the yaml floor stands on its own', () =>
    inventoryOk(29, 0) === false],
  ['…and the yaml alone likewise', () => inventoryOk(0, 8) === false],
];

const EXPECTED_CASES = 53;


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
