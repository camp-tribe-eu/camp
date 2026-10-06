#!/usr/bin/env node
// A file that runs itself cannot be imported, and a spec importing it
// does not know that it just ran a data migration.
//
//   node scripts/ci/check-script-entrypoints.mjs
//   node scripts/ci/check-script-entrypoints.mjs --self-test
//
// 🔴 WHY THIS EXISTS (CAMP-202).
//
// The `api` job went red with this in the same log:
//
//   Test Suites: 47 passed, 47 total
//   Tests:       1007 passed, 1007 total
//
//   TypeError: pgPass is not a function
//     at Client._getPassword (node_modules/pg/lib/client.js:300:9)
//   ReferenceError: You are trying to `require` a file after the Jest
//   environment has been torn down. From osm/backfill-contact.spec.ts.
//
// The cause was one line at the bottom of `osm/backfill-contact.ts`:
//
//   main().catch((e) => { … });     // ← no require.main guard
//
// `backfill-contact.spec.ts` imports exactly one thing from that file,
// `BACKFILL_SQL`, to assert the shape of a query string. That import ran
// the module, and running the module ran `main()`: a Postgres client, a
// 14 954-row SELECT, 14 954 UPDATEs, and a COMMIT — against whatever
// DATABASE_URL pointed at. Reproduced on 06.10.2026:
//
//   npm test -- src/osm/backfill-contact.spec.ts
//   → "matched 14954 staging rows, 10577 carried a contact"  (exit 1)
//
// It changed no rows only because the backfill is idempotent, and the
// line that makes it idempotent is there for an unrelated reason (not
// restamping <lastmod>). On a database that did not already agree with
// the staging table — a fresh CI database — the same `npm test` writes.
//
// The red job is the smaller half. `--dry-run` is read from
// `process.argv`, and under Jest argv belongs to Jest, so DRY is false
// and the transaction COMMITs. A unit test must not be able to decide
// that.
//
// 🔴 The convention already existed: 15 of the 20 scripts that open a
// connection were wrapped in `if (require.main === module)`. Five were
// not, and nothing anywhere said so. A convention nobody checks is a
// convention that holds until the next file.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { join, relative } from 'node:path';

const ROOTS = ['apps/api/src', 'scripts/osm-pipeline'];

/**
 * Strip strings, template literals, regex literals and comments, keeping
 * line structure intact.
 *
 * 🔴 Not cosmetic. Without it `console.log('main()')` is a top-level
 * call, `// main()` in a comment is a top-level call, and a `{` inside a
 * string throws the brace depth off for the rest of the file — which
 * would make the scanner miss real findings rather than merely invent
 * false ones.
 */
export function blank(source) {
  let out = '';
  let i = 0;
  // What we are inside of: null, or one of ' " ` // /* /
  let mode = null;
  // The last token that was not whitespace, used to tell a regex literal
  // from a division: `a / b` versus `split(/x/)`.
  let prev = '';

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (mode === null) {
      if (c === '/' && next === '/') { mode = '//'; out += '  '; i += 2; continue; }
      if (c === '/' && next === '*') { mode = '/*'; out += '  '; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { mode = c; out += ' '; i++; continue; }
      // A regex can only start where a value can start.
      if (c === '/' && /[=(,:;[!&|?{}+\-*%~^]|^$|return|typeof|case/.test(prev)) {
        mode = '/'; out += ' '; i++; continue;
      }
      out += c;
      if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? prev.replace(/[^\w$]*$/, '') + c : c;
      i++;
      continue;
    }

    // Inside something. Newlines are always kept so line numbers hold.
    if (c === '\n') {
      out += '\n';
      if (mode === '//') mode = null;
      // An unterminated regex or quote cannot span a line; treat the
      // newline as the end rather than swallowing the rest of the file.
      else if (mode === "'" || mode === '"' || mode === '/') mode = null;
      i++;
      continue;
    }
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (mode === '/*' && c === '*' && next === '/') { mode = null; out += '  '; i += 2; continue; }
    if (mode === '//' || mode === '/*') { out += ' '; i++; continue; }
    if (c === mode) { mode = null; out += ' '; i++; continue; }
    out += ' ';
    i++;
  }
  return out;
}

/** Names this file declares as a function or an arrow const. */
export function declaredFunctions(blanked) {
  const names = new Set();
  const patterns = [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm,
  ];
  for (const re of patterns) {
    for (const m of blanked.matchAll(re)) names.add(m[1]);
  }
  return names;
}

/**
 * Top-level statements that call a function this file declares.
 *
 * Depth is counted on braces only. `if (require.main === module) { … }`
 * puts its body at depth 1, which is exactly how a guarded script is
 * told apart from an unguarded one — without relying on indentation,
 * which `scripts/` has no formatter to guarantee.
 *
 * 🔴 A call is a STATEMENT only when the previous meaningful character
 * was `;` or `}`, or there was none. Matching per line instead found
 * three calls that are nothing of the sort — the body of a one-line
 * arrow const wrapped onto the next line:
 *
 *   export const mergedStarsSql = (alias: string): string =>
 *     mergedFieldSql(alias, 'stars');          // ← not a statement
 *
 * A guard that cries wolf on `spots/links.ts` gets switched off, and
 * then it is not guarding the thing it was written for either.
 */
export function unguardedCalls(source) {
  const blanked = blank(source);
  const names = declaredFunctions(blanked);
  const found = [];
  let depth = 0;
  let line = 1;
  let last = ''; // previous non-whitespace character
  let i = 0;

  while (i < blanked.length) {
    const c = blanked[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }

    if (c === '{') { depth++; last = c; i++; continue; }
    if (c === '}') { depth--; last = c; i++; continue; }

    // A new statement can only begin after the previous one ended.
    const atStatementStart = depth === 0 && (last === '' || last === ';' || last === '}');
    if (atStatementStart && /[A-Za-z_$]/.test(c)) {
      const rest = blanked.slice(i);
      const m = rest.match(/^(?:(?:void|await)\s+)?([A-Za-z_$][\w$]*)\s*\(/);
      if (m && names.has(m[1])) found.push({ line, name: m[1] });
    }

    last = c;
    i++;
  }
  return found;
}

/**
 * The one file whose entire job is to be the process entry point.
 *
 * 🔴 Exempt, but CONDITIONALLY. `require.main === module` is not
 * reliably true for a Nest entry point — it depends on how the process
 * was started (`nest start`, `node dist/main`, a wrapper) — and a guard
 * that is false at runtime does not make the API safer, it stops it
 * booting. So this file keeps its bare call.
 *
 * The exemption rests on one fact: nothing imports it. The moment
 * something does, the fact is gone and the exemption with it — which is
 * why `importers()` below checks it on every run rather than trusting
 * the comment. An exemption nobody rechecks is how CAMP-202 happened in
 * the first place.
 */
const ENTRY_POINTS = new Set(['apps/api/src/main.ts']);

/**
 * Files that import `target`, by its module path without the extension.
 *
 * 🔴 All four specifier forms, because the first version matched only
 * `from '…'` and the rehearsal walked straight through it: adding
 * `import './main';` to app.module.ts left this check green. A bare
 * side-effect import is exactly the form that would run an entry point,
 * so missing it defeated the whole exemption.
 */
export function importers(files, target, read = (f) => readFileSync(f, 'utf8')) {
  const base = target.replace(/\.ts$/, '').split('/').pop();
  const SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g;
  const found = [];
  for (const file of files) {
    if (file === target) continue;
    for (const [, spec] of read(file).matchAll(SPECIFIER)) {
      if (spec.replace(/\.(ts|js|mjs)$/, '').split('/').pop() === base) {
        found.push(file);
        break;
      }
    }
  }
  return found;
}

/** The forms a module can be pulled in by, as cases rather than a claim. */
const IMPORT_FORMS = [
  ['a named import is seen', "import { x } from './main';", true],
  ['a bare side-effect import is seen', "import './main';", true],
  ['a default import is seen', "import main from '../src/main';", true],
  ['require is seen', "const m = require('./main');", true],
  ['a dynamic import is seen', "await import('./main');", true],
  ['an explicit extension is seen', "import './main.ts';", true],
  ['a different module is not', "import { x } from './domain';", false],
  ['a longer name ending in it is not', "import './remain';", false],
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|mts)$/.test(entry) && !/\.(spec|test|d)\.ts$/.test(entry)) out.push(path);
  }
  return out;
}

const SELF_TEST = [
  ['a guarded script passes', `
import { Client } from 'pg';
async function main() { const db = new Client(); await db.end(); }
if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
`, 0],
  ['an unguarded main() is caught', `
async function main() {}
main().catch((e) => { process.exit(1); });
`, 1],
  ['void main() is caught too', `
async function main() {}
void main();
`, 1],
  ['the RUN_DIRECTLY form passes', `
const RUN_DIRECTLY = require.main === module;
async function main() {}
if (RUN_DIRECTLY) { main().catch(() => {}); }
`, 0],
  ['a call inside a nested function is not top level', `
async function main() {}
export function later() { main(); }
`, 0],
  ['a call inside a string is not a call', `
async function main() {}
export const USAGE = 'run main() by hand';
`, 0],
  ['a call inside a comment is not a call', `
async function main() {}
// main();
/* main(); */
`, 0],
  ['a brace inside a string does not break the depth count', `
async function main() {}
export const SQL = 'SELECT {';
if (require.main === module) { main(); }
`, 0],
  ['a brace inside a template literal does not break it either', `
async function main() {}
const q = \`a \${1} {\`;
if (require.main === module) { main(); }
`, 0],
  ['an arrow const entry point is caught', `
const main = async () => {};
main();
`, 1],
  ['calling an imported function is not our business', `
import { bootstrap } from './nest';
bootstrap();
`, 0],
  ['a brace inside a regex literal does not break it', `
async function main() {}
const re = /[{]/;
if (require.main === module) { main(); }
`, 0],
  // 🔴 The three false positives the line-based first version produced,
  // kept as cases so the next rewrite cannot reintroduce them. All three
  // are real code in apps/api: spots/links.ts and fuel/stations.ts.
  ['an arrow body wrapped onto the next line is not a statement', `
function mergedFieldSql(a, b) { return a + b; }
export const mergedStarsSql = (alias) =>
  mergedFieldSql(alias, 'stars');
`, 0],
  ['a wrapped arrow body with a TypeScript return type is not either', `
function priceAgeDays(a, b) { return 1; }
export const isPriceStale = (measuredAt: Date, now: Date): boolean =>
  priceAgeDays(measuredAt, now) > 30;
`, 0],
  ['an argument wrapped onto its own line is not a statement', `
function helper() {}
register(
  helper(),
);
`, 0],
  ['a call after a closing brace IS a statement', `
async function main() {}
main();
`, 1],
];

if (argv.includes('--self-test')) {
  let failed = 0;
  for (const [what, text, expected] of IMPORT_FORMS) {
    const got = importers(['a.ts'], 'apps/api/src/main.ts', () => text).length === 1;
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what} (expected ${expected}, got ${got})`);
  }
  for (const [what, source, expected] of SELF_TEST) {
    const got = unguardedCalls(source).length;
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what} (expected ${expected}, got ${got})`);
  }
  console.log(
    failed
      ? `\n::error::self-test failed on ${failed} of ${SELF_TEST.length + IMPORT_FORMS.length} cases`
      : `\n✓ self-test passed: ${SELF_TEST.length + IMPORT_FORMS.length} cases, guarded and unguarded both recognised`,
  );
  exit(failed ? 1 : 0);
}

let bad = 0;
let scanned = 0;
for (const root of ROOTS) {
  let files;
  try {
    files = walk(root);
  } catch {
    continue; // a root that does not exist in this checkout is not a failure
  }
  for (const file of files) {
    scanned++;
    const hits = unguardedCalls(readFileSync(file, 'utf8'));
    if (hits.length && ENTRY_POINTS.has(file)) {
      const who = importers(files, file);
      if (who.length === 0) continue; // the exemption still holds
      console.error(
        `::error file=${file}::this file is exempt only while nothing ` +
          `imports it, and ${who.length} file${who.length === 1 ? '' : 's'} ` +
          `now do${who.length === 1 ? 'es' : ''}: ${who.join(', ')}. ` +
          'Either drop the import or guard the call.',
      );
      bad += hits.length;
      continue;
    }
    for (const hit of hits) {
      bad++;
      console.error(
        `::error file=${relative('.', file)},line=${hit.line}::` +
          `${hit.name}() runs when this file is imported. ` +
          'Wrap it in `if (require.main === module) { … }` — a spec that ' +
          'imports anything from here would otherwise run it, and in ' +
          'CAMP-202 that meant a COMMITted 14 954-row migration and a red ' +
          'job with 1007 tests green.',
      );
    }
  }
}

console.log(
  bad
    ? `\n✗ ${bad} top-level call${bad === 1 ? '' : 's'} in ${scanned} files run on import`
    : `✓ ${scanned} files: nothing runs itself when imported`,
);
exit(bad ? 1 : 0);
