#!/usr/bin/env node
// CAMP-285: the one rule about command-line flags that 39 CI steps share.
//
//   node scripts/lib/entrypoint.mjs --self-test
//
// 🔴 WHY THIS EXISTS.
//
// 39 steps in ci.yml invoke a script with `--self-test`. 38 of them pass
// when the self-test never runs at all, because "did not start" and
// "every case passed" print the same thing: nothing, and exit 0.
//
// Three ways to get there were reproduced on files in this repository on
// 12.10.2026. The first needs no mutation and no symlink, only a typo:
//
//   node scripts/security/check-secrets.mjs --selftest   → exit 0
//
// One letter. The flag is not recognised, so the script fell through to
// its default action, scanned the tree, found nothing, and the step
// named "the secret scanner still bites" went green without the scanner
// ever having been bitten. The same letter does the same thing to
// check-dependencies, check-eu-scope and check-branch-drift.
//
// The other two routes are the entry guard: inverted (`===` → `!==`),
// and a symlink — which needs no mutation at all, because Node resolves
// `import.meta.url` through the real path and leaves `process.argv[1]`
// exactly as it was written.
//
// This module holds the rule those 38 will share: a flag the script does
// not know is an error, not a shrug. It is a pure function so it can be
// rehearsed, and it throws rather than returning a verdict somebody has
// to remember to read.
//
// 🔴 WHAT IS DELIBERATELY NOT HERE: the entry guard itself.
//
// It stays written out in every file, as the literal comparison
//
//   import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
//
// because check-script-entrypoints.mjs recognises a guard by READING
// that comparison — `isGuardExpression` wants a binary expression with
// `import.meta.url` on one side. Behind a helper call it is not a guard
// any more, and check-eu-scope.mjs, which two pipeline scripts import,
// would be reported as a file that does work when imported. Measured on
// this repository, not assumed.
//
// 🔴 AND WHY THIS FILE DOES NOT THROW WHEN IT IS MERELY IMPORTED.
//
// The card asks for a second lock: a script that sees `--self-test` in
// argv while it is NOT the entry point should throw rather than fall
// silent. Measured, that rule breaks a real CI step.
// `scripts/osm-pipeline/import-release.mjs --self-test` (ci.yml:246)
// imports `EU` and `GEOFABRIK` from check-eu-scope.mjs at module level,
// so check-eu-scope would see a `--self-test` it is not the subject of
// and kill a passing step. `--self-test` is a house-wide convention, not
// one script's private flag, so an imported module cannot tell whose it
// is. The route that rule was aimed at — the symlink — is closed by
// resolving the real path on BOTH sides instead.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * A command-line token meant as a flag, as opposed to a value.
 *
 * `-` and `--` are the conventional separators and name nothing, so they
 * are not flags — and `chooseAction` then refuses them as stray, because
 * a script that takes no argument has no use for a separator either.
 * Everything else that starts with a dash is a flag, single dash
 * included: `-self-test` is a typo for an action, not a filename, and
 * reading it as a positional value is how the typo stayed quiet.
 */
export function isFlag(token) {
  return token.startsWith('-') && token !== '-' && token !== '--';
}

/** A flag's name, with any `=value` cut off. */
export function flagName(token) {
  const at = token.indexOf('=');
  return at === -1 ? token : token.slice(0, at);
}

/**
 * Which of the actions this script knows were asked for — and a refusal
 * for anything else.
 *
 * 🔴 A STRAY WORD IS REFUSED TOO, and that was a review finding. The
 * first version filtered argv down to the things that look like flags
 * and said nothing about the rest, so `self-test`, `selftest`, a
 * `—self-test` written with an em dash, and `' --self-test'` with a
 * leading space all came back as an EMPTY set — the script ran its
 * default action and exited 0, which is the same green nothing this card
 * is about, reached by four more routes. A script that takes no
 * positional argument has no use for a word it was not expecting.
 *
 * @param {string[]} argv   usually `process.argv.slice(2)`
 * @param {string[]} known  every flag this script acts on
 * @param {string} who      the script's own name, for the message
 * @param {object} [shape]
 * @param {string[]} [shape.takesValue]  flags followed by a value, e.g. --predict
 * @param {number} [shape.positional]    how many bare words this script takes
 * @param {Object<string,string[]>} [shape.values]  the only values a flag
 *   may carry, by flag name
 * @returns {Set<string>} the known flags actually present
 * @throws when anything in argv is not a known flag, its value, or an
 *   expected positional
 */
export function chooseAction(argv, known, who, shape = {}) {
  const { takesValue = [], positional = 0, values = {} } = shape;
  const seen = [];
  const stray = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!isFlag(token)) {
      stray.push(token);
      continue;
    }
    const name = flagName(token);
    seen.push(name);
    // `--predict out.json` — the next token belongs to the flag, not to
    // this list. `--predict=out.json` carries its own value already.
    if (takesValue.includes(name)) {
      const inline = token.includes('=');
      const given = inline ? token.slice(token.indexOf('=') + 1) : argv[i + 1];
      if (!inline) i++;
      // 🔴 THE VALUE, NOT ONLY THE NAME. Review found the whole point of
      // this card alive one layer down: `check-legal-review --expect
      // publi` — one letter — passed the flag check, fell through to the
      // `closed` branch, and printed a ✓ for a gate it had not applied.
      // A flag whose value decides which gate runs must have that value
      // checked, or the typo simply moves house.
      const allowed = values[name];
      if (allowed && !allowed.includes(given)) {
        throw new Error(
          `${who}: ${name} does not take ${JSON.stringify(given ?? null)}. ` +
            `It takes ${allowed.join(' or ')}. A value nobody recognises used ` +
            'to pick the default branch in silence (CAMP-286).',
        );
      }
    }
  }
  const unknown = seen.filter((flag) => !known.includes(flag));
  if (unknown.length > 0) {
    throw new Error(
      `${who}: unknown flag ${unknown.join(', ')}. ` +
        `This script knows ${known.join(', ') || '(no flags)'}. ` +
        'An unrecognised flag used to mean "quietly do the default thing", ' +
        'which is how `--selftest` kept a CI step green while the ' +
        'self-test never ran (CAMP-285).',
    );
  }
  if (stray.length > positional) {
    throw new Error(
      `${who}: unexpected argument ${stray.map((t) => JSON.stringify(t)).join(', ')}. ` +
        `This script knows ${known.join(', ') || '(no flags)'} and takes ` +
        `${positional === 0 ? 'nothing else' : `${positional} other argument(s)`}. ` +
        'A dash lost to a copy-paste, or an em dash, reads as a word and ' +
        'used to be ignored in silence (CAMP-285).',
    );
  }
  return new Set(seen);
}

// 🔴 Each case says what it is for, and the message cases read the
// message rather than only counting a throw. A guard whose wording stops
// naming the offending flag is still "a guard that throws", and the
// person reading a red CI log is the one who pays for that.
const CASES = [
  ['no arguments is not an error', () => chooseAction([], ['--self-test'], 'x').size === 0],
  ['a known flag comes back', () => chooseAction(['--self-test'], ['--self-test'], 'x').has('--self-test')],
  ['two known flags both come back', () => {
    const got = chooseAction(['--update', '--self-test'], ['--self-test', '--update'], 'x');
    return got.size === 2 && got.has('--update') && got.has('--self-test');
  }],
  ['🔴 the renamed flag throws — the case this card is named after', () => {
    try { chooseAction(['--selftest'], ['--self-test'], 'x'); return false; } catch { return true; }
  }],
  ['🔴 a single-dash typo throws too', () => {
    try { chooseAction(['-self-test'], ['--self-test'], 'x'); return false; } catch { return true; }
  }],
  ['the message names the flag it refused', () => {
    try { chooseAction(['--selftest'], ['--self-test'], 'x'); return false; }
    catch (e) { return e.message.includes('--selftest'); }
  }],
  ['the message names what the script does know', () => {
    try { chooseAction(['--nope'], ['--self-test', '--update'], 'x'); return false; }
    catch (e) { return e.message.includes('--self-test') && e.message.includes('--update'); }
  }],
  ['the message names the script', () => {
    try { chooseAction(['--nope'], [], 'check-secrets.mjs'); return false; }
    catch (e) { return e.message.startsWith('check-secrets.mjs:'); }
  }],
  ['`--flag=value` is recognised by its name', () => chooseAction(['--predict=f.json'], ['--predict'], 'x').has('--predict')],
  ['an unknown `--flag=value` still throws', () => {
    try { chooseAction(['--predic=f.json'], ['--predict'], 'x'); return false; } catch { return true; }
  }],
  ['a declared flag swallows its value', () => {
    const got = chooseAction(['--predict', 'f.json'], ['--predict'], 'x', { takesValue: ['--predict'] });
    return got.size === 1 && got.has('--predict');
  }],
  ['a declared positional is allowed', () =>
    chooseAction(['report.json', '--max', '3'], ['--max'], 'x',
      { takesValue: ['--max'], positional: 1 }).has('--max')],
  ['🔴 an unrecognised value for a flag is refused', () => {
    try {
      chooseAction(['--expect', 'publi'], ['--expect'], 'x',
        { takesValue: ['--expect'], values: { '--expect': ['public', 'closed'] } });
      return false;
    } catch (e) { return e.message.includes('does not take "publi"'); }
  }],
  ['…and a recognised one is not', () =>
    chooseAction(['--expect', 'public'], ['--expect'], 'x',
      { takesValue: ['--expect'], values: { '--expect': ['public', 'closed'] } }).has('--expect')],
  ['the `--flag=value` spelling is checked the same way', () => {
    try {
      chooseAction(['--expect=Public'], ['--expect'], 'x',
        { takesValue: ['--expect'], values: { '--expect': ['public', 'closed'] } });
      return false;
    } catch { return true; }
  }],
  ['🔴 a flag that takes a value and is given none is refused', () => {
    try {
      chooseAction(['--expect'], ['--expect'], 'x',
        { takesValue: ['--expect'], values: { '--expect': ['public', 'closed'] } });
      return false;
    } catch { return true; }
  }],
  ['a flag with no declared values takes anything', () =>
    chooseAction(['--predict', 'f.json'], ['--predict'], 'x',
      { takesValue: ['--predict'] }).has('--predict')],
  ['🔴 one more positional than declared is refused', () => {
    try {
      chooseAction(['a.json', 'b.json'], [], 'x', { positional: 1 });
      return false;
    } catch (e) { return e.message.includes('unexpected argument'); }
  }],
  ['🔴 a bare word is refused — the script takes none', () => {
    try { chooseAction(['--predict', 'f.json'], ['--predict'], 'x'); return false; }
    catch (e) { return e.message.includes('unexpected argument'); }
  }],
  ['🔴 `self-test` without dashes is refused', () => {
    try { chooseAction(['self-test'], ['--self-test'], 'x'); return false; } catch { return true; }
  }],
  ['🔴 an em dash is not a dash', () => {
    try { chooseAction(['\u2014self-test'], ['--self-test'], 'x'); return false; } catch { return true; }
  }],
  ['🔴 a leading space is refused', () => {
    try { chooseAction([' --self-test'], ['--self-test'], 'x'); return false; } catch { return true; }
  }],
  ['a bare `--` names no action, so it is refused', () => {
    try { chooseAction(['--'], [], 'x'); return false; } catch { return true; }
  }],
  ['a bare `-` likewise', () => {
    try { chooseAction(['-'], [], 'x'); return false; } catch { return true; }
  }],
  ['isFlag says what it means', () => isFlag('--a') && isFlag('-a') && !isFlag('a') && !isFlag('--') && !isFlag('-')],
  ['flagName cuts at the first `=` only', () => flagName('--a=b=c') === '--a' && flagName('--a') === '--a'],
];

// 🔴 The count is asserted, because a case that stops being reached
// looks exactly like a case that passed.
const EXPECTED_CASES = 26;

function selfTest() {
  let failed = 0;
  for (const [what, run] of CASES) {
    let ok;
    try { ok = run() === true; } catch (err) { ok = false; console.log(`    threw: ${err.message}`); }
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what}`);
  }
  if (CASES.length !== EXPECTED_CASES) {
    failed++;
    console.log(`✗ ${CASES.length} cases, expected ${EXPECTED_CASES}`);
  }
  console.log(
    failed
      ? `\n::error::entrypoint self-test failed on ${failed} case(s)`
      : `\n✓ entrypoint self-test: ${CASES.length} cases, flags refused by name`,
  );
  process.exit(failed ? 1 : 0);
}

// 🔴 The house form. `realpathSync` on the argv side because Node leaves
// argv[1] as written; inside an IIFE with try/catch because calling
// realpathSync in the `if` condition runs on every import and throws
// ENOENT when argv[1] is not a file; and `import.meta.url` standing in
// the comparison because check-script-entrypoints.mjs reads it there.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  chooseAction(process.argv.slice(2), ['--self-test'], 'entrypoint.mjs');
  if (process.argv.includes('--self-test')) selfTest();
  else throw new Error('entrypoint.mjs is a library; it does nothing but --self-test.');
}
