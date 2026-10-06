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

import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// 🔴 EVERY ROOT THAT HOLDS A SCRIPT, and both module systems.
//
// The first version listed `apps/api/src` and `scripts/osm-pipeline`, and
// review measured what the second one contributed: ZERO files. `walk()`
// matched `.ts`/`.mts`, and that directory holds two `.mjs` and seven
// `.sh`. The root was decoration, and the summary line ("128 files") hid
// it by reporting one total. One of the files it was not reading,
// `scripts/osm-pipeline/drop-non-eu.mjs`, runs an unguarded
// `DELETE FROM camping_spots` at module level and exports two functions
// that invite a spec to import them.
//
// Three specs in this repository already import from `scripts/`, so the
// path "a spec reaches a script" is not hypothetical here.
const ROOTS = ['apps/api/src', 'apps/web/src', 'apps/web/scripts', 'scripts'];

/** Files this root holds, before any entry-point question is asked. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (isReadable(entry)) out.push(path);
  }
  return out;
}

/** A test file: never an entry point, but very much an importER. */
const isSpec = (file) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(file);


/** Files whose contents this check can parse at all. */
export const isReadable = (f) => /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(f);

/** Names a module-level `const` can bind that mean "we were run, not imported". */
function guardNames(sf) {
  const names = new Set();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (d.initializer && bindsGuard(d.initializer, sf, names) === 'guard') {
        names.add(d.name.getText(sf));
      }
    }
  }
  return names;
}

/**
 * What a declaration's initializer binds, looking INSIDE it.
 *
 * 🔴 `scripts/windy/fetch-webcams.mjs:506` wraps the comparison in an
 * IIFE with a try/catch, so asking whether the initializer IS a guard
 * expression said no and the file's two real guards stopped counting.
 * Asking whether it CONTAINS one — and contains no inverted one — reads
 * that form correctly while still refusing the poisoning case, because
 * `fileURLToPath(import.meta.url)` contains no comparison at all.
 */
function bindsGuard(node, sf, names) {
  let guard = 0;
  let anti = 0;
  const walkNode = (n) => {
    const kind = ts.isBinaryExpression(n) ? isGuardExpression(n, sf, names) : 'other';
    if (kind === 'guard') guard++;
    else if (kind === 'anti') anti++;
    ts.forEachChild(n, walkNode);
  };
  walkNode(node);
  if (guard > 0 && anti === 0) return 'guard';
  if (anti > 0 && guard === 0) return 'anti';
  return 'other';
}

/**
 * Is this condition true only when run directly, only when imported, or
 * neither?
 *
 * 🔴 POLARITY, AND IT WAS MISSING. The first version asked whether the
 * text mentioned `require.main` or `import.meta` — so
 * `if (require.main !== module) { … }` read as a guard, when it is the
 * exact opposite: review measured it running ON IMPORT and NOT on a
 * direct run. The repository already carries the inverted form at
 * `scripts/osm-pipeline/import-release.mjs:678`, with an empty body
 * today; one line is the whole distance.
 *
 * 🔴 AND IT POISONED ON SUBSTRINGS. Any top-level name whose initializer
 * merely CONTAINED `import.meta` became a guard name, matched by regex
 * inside any `if`. So `const here = fileURLToPath(import.meta.url)` made
 * `if (here) { psql('DELETE FROM camping_spots') }` invisible. Seven
 * files in the scanned roots have exactly that premise. A guard name now
 * has to be bound to a guard EXPRESSION, and it is matched as an
 * identifier, not as text.
 */
function isGuardExpression(node, sf, names) {
  if (ts.isParenthesizedExpression(node)) return isGuardExpression(node.expression, sf, names);

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = isGuardExpression(node.operand, sf, names);
    return inner === 'guard' ? 'anti' : inner === 'anti' ? 'guard' : 'other';
  }

  if (ts.isIdentifier(node)) return names.has(node.text) ? 'guard' : 'other';

  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    const left = node.left.getText(sf);
    const right = node.right.getText(sf);
    const pair = `${left}|${right}`;
    const isCjs = /\brequire\.main\b/.test(pair) && /\bmodule\b/.test(pair);
    const isEsm = /\bimport\.meta\.url\b/.test(pair);
    if (isCjs || isEsm) {
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken)
        return 'guard';
      if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken)
        return 'anti';
    }
    // `process.argv[1] !== undefined && import.meta.url === …` — the form
    // `import-release.mjs` uses. A conjunction is a guard when a conjunct is.
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const a = isGuardExpression(node.left, sf, names);
      const b = isGuardExpression(node.right, sf, names);
      if (a === 'guard' || b === 'guard') return 'guard';
      if (a === 'anti' || b === 'anti') return 'anti';
    }
  }
  return 'other';
}

/** Things whose construction or call reaches a resource, not just memory. */
const OPENS = new Set([
  'fetch', 'psql', 'createPool', 'knex', 'drizzle', 'getRepository',
  'execSync', 'spawnSync', 'execFileSync', 'createConnection', 'connect',
]);
const RESOURCE_CLASSES = new Set(['Client', 'Pool', 'DataSource']);

/** A function being DEFINED is not a function being called. */
const isFunctionLike = (n) =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) ||
  ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ||
  ts.isClassDeclaration(n) || ts.isClassExpression(n);

/**
 * Does evaluating this expression open something?
 *
 * 🔴 WHY DECLARATIONS COUNT NOW. `verdict()` returns early when there is
 * no work, and a `VariableStatement` was never work — so
 * `const pool = new Pool(…)` at module level, which is literally the
 * shape this card is named after, never reached the database rule at
 * all. Review reproduced it: a file with `new Pool`, an exporting spec
 * and module-level queries passed with exit 0.
 *
 * A top-level `await` counts for the same reason: in ESM it is work the
 * import performs, and three files in the scanned roots do
 * `const res = await fetch(…)` at module level — the network, on import.
 */
function opensSomething(node, sf, resourceNames) {
  // The initializer itself being a function is the commonest case:
  // `const psql = (sql) => execFileSync(…)` defines a helper.
  if (isFunctionLike(node)) return false;
  let found = false;
  const walkNode = (n) => {
    if (found) return;
    // 🔴 `const psql = (sql) => execFileSync('psql', …)` is a definition.
    // Walking into it called three helper declarations work —
    // `check-restore.mjs:163`, `drop-non-eu.mjs:103` — none of which runs
    // anything until something calls them, which is the module-level
    // statement this check is actually looking for.
    if (n !== node && isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n)) { found = true; return; }
    // 🔴 CONSTRUCTION IS CONFIGURATION. `new DataSource({…})` does not
    // connect — TypeORM connects on `.initialize()` — and
    // `apps/api/src/data-source.ts:31` is exactly that line, exported for
    // the CLI to initialise later. `new Pool()` likewise waits for a
    // query. What opens a connection is a CALL, and in the shape review
    // reproduced (`const pool = new Pool(); for (…) pool.query(…)`) the
    // queries are module-level statements, caught on their own.
    if (ts.isCallExpression(n)) {
      const text = n.expression.getText(sf);
      const last = text.split('.').pop();
      if (OPENS.has(text) || OPENS.has(last) || resourceNames.has(text)) { found = true; return; }
    }
    ts.forEachChild(n, walkNode);
  };
  walkNode(node);
  return found;
}

/** Local names bound to a resource class by an import, aliases included. */
function resourceAliases(sf) {
  const names = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const from = ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : '';
    if (!/^(pg|typeorm|mysql2|knex|drizzle-orm|pg-promise)/.test(from)) continue;
    const named = st.importClause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const original = (el.propertyName ?? el.name).text;
        if (RESOURCE_CLASSES.has(original)) names.add(el.name.text);
      }
    }
    // `import * as pg from 'pg'` — the namespace itself, so `new pg.Client()`
    // is caught by the `.split('.').pop()` above.
    if (st.importClause.name) names.add(st.importClause.name.text);
  }
  return names;
}

/**
 * Statements at module level that DO something when the file is imported.
 *
 * 🔴 PARSED, NOT SCANNED. The first version counted brace depth over a
 * string with comments and literals blanked out, and matched a call
 * against a list of names the file declared. Review walked past it nine
 * ways — `const main = async function () {}`, a top-level async IIFE,
 * `new Runner().go()`, a missing semicolon, a backslash ending a line
 * comment, `if (x) main()` — each reproduced on a file that opened
 * Postgres and ran an UPDATE while the check reported `exit 0`.
 *
 * That is not a list of bugs to fix one at a time; it is a hand-written
 * parser losing to the language. TypeScript's own parser is already a
 * dependency, and it knows what a statement is.
 *
 * The rule: at module level an EXPRESSION statement is work, and so is a
 * declaration whose initializer opens something. Declarations that only
 * compute are not. A block whose condition means "we were run directly"
 * is not — but the ELSE of such a block is, and the THEN of its inverse
 * is.
 */
export function unguardedCalls(source, fileName = 'file.ts') {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : undefined,
  );

  const names = guardNames(sf);
  const resources = resourceAliases(sf);
  const found = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const label = (node) => node.getText(sf).split('\n')[0].slice(0, 60);
  const body = (node) => (node && ts.isBlock(node) ? node.statements : node ? [node] : []);

  const visit = (statements) => {
    for (const st of statements) {
      if (ts.isExpressionStatement(st)) {
        if (ts.isStringLiteral(st.expression)) continue; // 'use strict'
        found.push({ line: at(st), name: label(st.expression) });
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (d.initializer && opensSomething(d.initializer, sf, resources)) {
            found.push({ line: at(d), name: label(d) });
          }
        }
      } else if (ts.isIfStatement(st)) {
        const kind = isGuardExpression(st.expression, sf, names);
        if (kind !== 'guard') visit(body(st.thenStatement));
        if (kind !== 'anti') visit(body(st.elseStatement));
      } else if (ts.isBlock(st) || ts.isLabeledStatement(st)) {
        visit(ts.isBlock(st) ? st.statements : body(st.statement));
      } else if (ts.isTryStatement(st)) {
        visit(st.tryBlock.statements);
        if (st.catchClause) visit(st.catchClause.block.statements);
        if (st.finallyBlock) visit(st.finallyBlock.statements);
      } else if (
        ts.isForStatement(st) || ts.isForOfStatement(st) ||
        ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)
      ) {
        visit(body(st.statement));
      } else if (ts.isSwitchStatement(st)) {
        for (const clause of st.caseBlock.clauses) visit(clause.statements);
      } else if (ts.isClassDeclaration(st)) {
        // `static y = run()` and a static block both run at module load.
        for (const member of st.members) {
          if (ts.isPropertyDeclaration(member) &&
              member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) &&
              member.initializer && !ts.isLiteralExpression(member.initializer) &&
              (ts.isCallExpression(member.initializer) || ts.isNewExpression(member.initializer) ||
               ts.isAwaitExpression(member.initializer))) {
            found.push({ line: at(member), name: label(member) });
          }
          if (ts.isClassStaticBlockDeclaration(member)) visit(member.body.statements);
        }
      } else if (ts.isExportAssignment(st) && ts.isCallExpression(st.expression)) {
        found.push({ line: at(st), name: label(st.expression) });
      }
      // Everything else at module level defines; it does not do.
    }
  };
  visit(sf.statements);
  return found;
}

/**
 * Files that import `target`, by its module path without the extension.
 *
 * 🔴 PARSED, NOT GREPPED, and this file is the proof of why. The regex
 * version searched raw text, so the IMPORT_FORMS cases below — which are
 * strings CONTAINING `import './main';` — made this very check look like
 * an importer of `apps/api/src/main.ts`, and `main.ts` was reported as a
 * defect. A specifier inside a string literal is data; only the parser
 * can tell the difference.
 *
 * All four forms are covered, because the first version matched only
 * `from '…'` and the rehearsal walked through it: adding
 * `import './main';` to app.module.ts left this check green. A bare
 * side-effect import is exactly the form that would run an entry point.
 */
export function specifiersIn(source, fileName = 'file.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : undefined);
  const out = [];
  const text = (node) => (node && ts.isStringLiteral(node) ? node.text : null);
  const walkNode = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = text(node.moduleSpecifier);
      if (spec) out.push(spec);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamic) {
        const spec = text(node.arguments[0]);
        if (spec) out.push(spec);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const spec = text(node.argument.literal);
      if (spec) out.push(spec);
    }
    ts.forEachChild(node, walkNode);
  };
  ts.forEachChild(sf, walkNode);
  return out;
}

export function importers(files, target, read = (f) => readFileSync(f, 'utf8')) {
  const base = target.replace(/\.[cm]?[jt]sx?$/, '').split('/').pop();
  const found = [];
  for (const file of files) {
    if (file === target) continue;
    const hit = specifiersIn(read(file), file).some(
      (spec) => spec.replace(/\.[cm]?[jt]sx?$/, '').split('/').pop() === base,
    );
    if (hit) found.push(file);
  }
  return found;
}

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
  // 🔴 MY OWN EXPECTATION WAS WRONG HERE, and only a real parser showed
  // it. `bootstrap()` runs when this file is imported no matter where
  // `bootstrap` was declared — "not ours" described the old scanner's
  // blind spot, not anything about the hazard.
  ['calling an imported function runs on import too', `
import { bootstrap } from './nest';
bootstrap();
`, 1],
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
  // Wrong for the same reason: the WRAPPING is not a statement, but
  // `register(…)` is, and it runs. One finding, not two — the inner call
  // is part of it.
  ['a wrapped call is one statement, and it still runs', `
function helper() {}
register(
  helper(),
);
`, 1],
  ['a call after a closing brace IS a statement', `
async function main() {}
main();
`, 1],
  // 🔴 THE SECOND REVIEW PASS. The AST rewrite caught all nine of the
  // first round's bypasses and three more walked past it. Each is here
  // as a case before it was fixed, and each was reproduced on a file
  // that opened a resource while the check reported exit 0.
  // 🔴 MY OWN EXPECTATION WAS WRONG ON THE FIRST TRY. I wrote this
  // expecting `new Pool(…)` alone to count. It should not: construction
  // is configuration — pg connects on a query, TypeORM on `.initialize()`
  // — and `apps/api/src/data-source.ts:31` is exactly that line, exported
  // so the CLI can initialise it later. Calling it a defect would have
  // made the check cry wolf on correct code.
  ['constructing a client is configuration, not work', `
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const SQL = 'UPDATE camping_spots SET contact = $1';
`, 0],
  // …and the shape review actually reproduced, where the queries run.
  ['…but querying with it at module level is', `
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const SQL = 'UPDATE camping_spots SET contact = $1';
for (const ref of ['a', 'b']) { pool.query(SQL, [ref]); }
`, 1],
  ['a helper that WOULD call out is only a definition', `
import { execFileSync } from 'node:child_process';
export const psql = (sql) => execFileSync('psql', ['-c', sql], { encoding: 'utf8' });
`, 0],
  ['a fetch inside a component is not module-level work', `
import { useEffect } from 'react';
setWorkerUrl('/w.mjs');
export function Map() {
  useEffect(() => { void fetch('/api/spots').then((r) => r.json()); }, []);
  return null;
}
`, 1],
  ['a guard bound through an IIFE still reads as a guard', `
import { pathToFileURL } from 'node:url';
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; }
})();
async function main() {}
if (invokedDirectly) { main(); }
`, 0],
  ['so is a top-level await in a declaration', `
const res = await fetch('https://example.test/data.json');
export const DATA = await res.json();
`, 2],
  ['…but an ordinary computed constant is not', `
function compute() { return 1; }
export const X = compute();
const Y = [1, 2, 3].map((n) => n * 2);
`, 0],
  ['an INVERTED guard is not a guard — its body runs on import', `
async function main() {}
if (require.main !== module) { main(); }
`, 1],
  ['nor is the negated form of a guard name', `
const direct = require.main === module;
async function main() {}
if (!direct) { main(); }
`, 1],
  ['and the ELSE of a real guard runs on import', `
async function main() {}
async function other() {}
if (require.main === module) { main(); } else { other(); }
`, 1],
  ['the THEN of an inverted guard runs, its else does not', `
async function onImport() {}
async function onRun() {}
if (require.main !== module) { onImport(); } else { onRun(); }
`, 1],
  ['a name that merely MENTIONS import.meta is not a guard', `
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(import.meta.url);
function psql(q) { return q; }
if (here) { psql('DELETE FROM camping_spots'); }
`, 1],
  ['…and the real ESM guard still is one', `
import { pathToFileURL } from 'node:url';
const direct = import.meta.url === pathToFileURL(process.argv[1]).href;
async function main() {}
if (direct) { main(); }
`, 0],
  ['a loop at module level is visited', `
async function go(x) {}
for (const x of [1, 2]) { go(x); }
`, 1],
  ['so is a while, a switch and a label', `
async function go() {}
while (false) { go(); }
switch (1) { case 1: go(); }
outer: { go(); }
`, 3],
  ['a static class field runs when the module loads', `
function run() { return 1; }
export class X { static y = run(); }
`, 1],
  // 🔴 EIGHT WAYS PAST THE FIRST VERSION, every one of them found by
  // adversarial review and every one reproduced on a real file that
  // opened Postgres and ran an UPDATE while the check said exit 0.
  // They are cases here before they were fixed, so the fix is measured
  // rather than asserted.
  ['const NAME = async function () {} is an entry point', `
const main = async function () {};
main();
`, 1],
  ['const NAME = function () {} too', `
const main = function () {};
main();
`, 1],
  ['let NAME = async () => {} too', `
let main = async () => {};
main();
`, 1],
  ['a top-level async IIFE runs on import', `
(async () => {
  await work();
})();
`, 1],
  ['a bare IIFE does too', `
(function () {
  work();
})();
`, 1],
  ['a missing semicolon does not hide the next statement', `
async function main() {}
const x = 1
main();
`, 1],
  ['a method call on a fresh object runs too', `
class Runner { go() {} }
new Runner().go();
`, 1],
  ['a backslash ending a line comment does not swallow the next line', `
async function main() {}
// a trailing backslash \\
main();
`, 1],
  ['a call as the body of a one-line if still runs', `
async function main() {}
if (process.env.X) main();
`, 1],
];


/**
 * Does this file's module-level code reach a database?
 *
 * 🔴 A SECOND, STRICTER RULE, and the reason it exists is in
 * `scripts/osm-pipeline/drop-non-eu.mjs`: unguarded at module level, it
 * runs `DELETE FROM camping_spots WHERE slug IN (…)` and exports two
 * functions a spec would plausibly want. Nothing imports it today, so
 * the import rule below would let it pass.
 *
 * That is the wrong answer for this file. The import rule fires on the
 * commit that ADDS the import — and the test job can run before the
 * check job. "CI went red after the rows were gone" is not a guard. So a
 * file that can write to a database guards its module-level work whether
 * or not anything imports it: being unimportable is a fact about today,
 * being destructive is a fact about the file.
 *
 * 🔴 Asked of the AST, not of the text. The text version matched the SQL
 * inside `check-fixture-not-shrunk.mjs`'s own assertions and the
 * `new Client()` inside this file's own self-test fixtures — two files
 * that touch no database at all.
 */
export function touchesDatabase(source, fileName = 'file.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : undefined);
  // 🔴 Aliases and namespaces, because the first version compared a bare
  // identifier: `new pg.Client()`, `import { Client as PgClient }`,
  // `createPool()`, `knex()`, `drizzle()`, `getRepository()` and
  // `AppDataSource.initialize()` all walked past it.
  const aliases = resourceAliases(sf);
  const FACTORIES = new Set([
    'psql', 'createPool', 'createConnection', 'knex', 'drizzle',
    'getRepository', 'initialize',
  ]);
  let found = false;
  const walkNode = (node) => {
    if (found) return;
    if (ts.isNewExpression(node)) {
      const last = node.expression.getText(sf).split('.').pop();
      if (RESOURCE_CLASSES.has(last) || aliases.has(last)) { found = true; return; }
    }
    if (ts.isCallExpression(node)) {
      const text = node.expression.getText(sf);
      const last = text.split('.').pop();
      if (FACTORIES.has(text) || FACTORIES.has(last) || aliases.has(text)) { found = true; return; }
    }
    ts.forEachChild(node, walkNode);
  };
  ts.forEachChild(sf, walkNode);
  return found;
}

/**
 * Can this file's module-level code reach outside the process?
 *
 * 🔴 THE NARROWING THAT MAKES THE IMPORT RULE USABLE. Without it the
 * check reported three files that are doing exactly the right thing:
 * `campsite-map.tsx` and `route-map.tsx` call `setWorkerUrl(…)` at module
 * level because MapLibre needs it before any map exists, and
 * `map-sources.ts` pushes one entry onto an array behind an env check.
 * All three are in-memory, idempotent, and imported on purpose.
 *
 * A guard that calls those defects gets switched off, and then it is not
 * guarding `backfill-contact.ts` either. CAMP-202 was not about assigning
 * a variable at module level; it was about a database, a process and a
 * network socket. So the import rule asks for evidence that the file can
 * reach one.
 */
const OUTSIDE = new Set([
  'pg', 'pg-promise', 'typeorm', 'mysql2', 'sqlite3', 'ioredis', 'redis',
  'knex', 'drizzle-orm', 'mongodb', 'mongoose',
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'child_process', 'node:child_process',
  'http', 'node:http', 'https', 'node:https', 'net', 'node:net',
  'tls', 'node:tls', 'dgram', 'node:dgram', 'dns', 'node:dns',
  'worker_threads', 'node:worker_threads',
  'undici', 'node-fetch', 'axios', 'got',
  '@nestjs/core', 'nodemailer',
]);
/** Prefixes, for families like the AWS SDK. */
const OUTSIDE_PREFIXES = ['@aws-sdk/', '@google-cloud/', '@azure/'];

export function reachesOutside(source, fileName = 'file.ts') {
  const specs = specifiersIn(source, fileName);
  if (specs.some((spec) => OUTSIDE.has(spec))) return true;
  if (specs.some((spec) => OUTSIDE_PREFIXES.some((p) => spec.startsWith(p)))) return true;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : undefined);
  let found = false;
  const walkNode = (node) => {
    if (found) return;
    // 🔴 Not inside a function body. `campsite-map.tsx` calls `fetch`
    // where it belongs — in a component — and counting that made the
    // whole file "external", which turned its one legitimate module-level
    // line (`setWorkerUrl`, which MapLibre requires before any map
    // exists) into a defect. What matters is whether the module-level
    // code reaches out, not whether the file contains the word.
    if (node !== sf && isFunctionLike(node)) return;
    // 🔴 `fetch` IS THE LIVE ONE. It is a global, so no import names it,
    // and the first version's call list did not either. Three files in
    // the scanned roots do `const res = await fetch(…)` at module level —
    // `apps/web/scripts/gen-gone.mjs`, `gen-links.mjs` and
    // `scripts/seo/build-schema-index.mjs`. The network, on import,
    // invisible twice over: once as a declaration, once as "not external".
    if (
      ts.isCallExpression(node) &&
      /^(process\.exit|execSync|spawnSync|execFileSync|fetch)$/.test(node.expression.getText(sf))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, walkNode);
  };
  ts.forEachChild(sf, walkNode);
  return found;
}

/**
 * What to say about one file, as a pure decision.
 *
 * 🔴 PURE AND TESTED, because review found that the 24 cases this file
 * was proud of all exercised the PARSER and none of them touched the
 * file-selection or exemption layer — which is exactly where two of the
 * three blocking defects lived. Density of tests around one layer hid
 * zero coverage of the next.
 */
export function verdict({ file, work, importedBy, database, external }) {
  if (work.length === 0) return null;
  if (database) {
    return {
      file,
      line: work[0].line,
      why:
        `${work[0].name} runs when this file is imported, and this file can ` +
        'write to a database. Wrap module-level work in ' +
        '`if (require.main === module) { … }` (or the `import.meta.url` ' +
        'equivalent in an .mjs). A file that deletes rows does not get to ' +
        'rely on nobody importing it yet.',
    };
  }
  if (importedBy.length > 0 && external) {
    return {
      file,
      line: work[0].line,
      why:
        `${work[0].name} runs when this file is imported, and ` +
        `${importedBy.length} file${importedBy.length === 1 ? '' : 's'} ` +
        `import${importedBy.length === 1 ? 's' : ''} it: ` +
        `${importedBy.slice(0, 4).join(', ')}` +
        `${importedBy.length > 4 ? ', …' : ''}. In CAMP-202 that meant one ` +
        'spec importing one SQL constant ran a COMMITted 14 954-row ' +
        'migration, and the job went red with 1007 tests green.',
    };
  }
  // Nothing imports it, it cannot write: it is an entry point doing its job.
  return null;
}

const DECISIONS = [
  ['a quiet file is fine however many import it',
    { file: 'a.ts', work: [], importedBy: ['b.ts', 'c.ts'], database: true, external: true }, false],
  ['an entry point nothing imports is fine',
    { file: 'main.ts', work: [{ line: 9, name: 'bootstrap()' }], importedBy: [], database: false, external: true }, false],
  ['…but not once something imports it',
    { file: 'main.ts', work: [{ line: 9, name: 'bootstrap()' }], importedBy: ['main.spec.ts'], database: false, external: true }, true],
  ['a database file is caught even when nothing imports it',
    { file: 'drop.mjs', work: [{ line: 7, name: 'psql(…)' }], importedBy: [], database: true, external: true }, true],
  ['the CAMP-202 shape itself',
    { file: 'backfill-contact.ts', work: [{ line: 147, name: 'main()' }], importedBy: ['backfill-contact.spec.ts'], database: true, external: true }, true],
  ['in-memory module-level work is not a finding, however imported',
    { file: 'map-sources.ts', work: [{ line: 79, name: 'MAP_SOURCES.push({' }],
      importedBy: ['a.tsx', 'b.tsx'], database: false, external: false }, false],
  ['…but the same file reaching outside is',
    { file: 'map-sources.ts', work: [{ line: 79, name: 'writeFileSync(…)' }],
      importedBy: ['a.tsx'], database: false, external: true }, true],
];

if (argv.includes('--self-test')) {
  let failed = 0;
  const say = (ok, what, detail) => {
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what}${detail}`);
  };

  for (const [what, text, expected] of IMPORT_FORMS) {
    const got = importers(['a.ts'], 'apps/api/src/main.ts', () => text).length === 1;
    say(got === expected, what, ` (expected ${expected}, got ${got})`);
  }
  for (const [what, source, expected] of SELF_TEST) {
    const got = unguardedCalls(source).length;
    say(got === expected, what, ` (expected ${expected}, got ${got})`);
  }
  for (const [what, input, expected] of DECISIONS) {
    const got = verdict(input) !== null;
    say(got === expected, what, ` (expected ${expected}, got ${got})`);
  }
  // 🔴 The file-selection layer, which had no coverage at all. Both of
  // these were real: `walk` matched only .ts/.mts, so a whole root
  // contributed zero files; and specs were filtered out of the list the
  // exemption check searched, so the one class of file that caused
  // CAMP-202 was the one it could not see.
  const SELECTION = [
    ['an .mjs is a file we read', isReadable('drop-non-eu.mjs'), true],
    ['so is a .cjs', isReadable('x.cjs'), true],
    ['and a .tsx', isReadable('page.tsx'), true],
    ['a .sh is not', isReadable('run.sh'), false],
    ['a .spec.ts is not a subject', isSpec('a.spec.ts'), true],
    ['nor an .mjs test', isSpec('a.test.mjs'), true],
    ['an ordinary file is', isSpec('a.ts'), false],
  ];
  for (const [what, got, expected] of SELECTION) {
    say(got === expected, what, ` (expected ${expected}, got ${got})`);
  }

  const total = IMPORT_FORMS.length + SELF_TEST.length + DECISIONS.length + SELECTION.length;
  console.log(
    failed
      ? `\n::error::self-test failed on ${failed} of ${total} cases`
      : `\n✓ self-test passed: ${total} cases across the parser, the ` +
        'decision and the file selection',
  );
  exit(failed ? 1 : 0);
}

// 🔴 Guarded like everything it polices. Review found this file killed
// the probe process that imported it: it exports four functions AND
// scanned and called `exit()` at module level — the very shape it
// refuses in others, in the one directory it does not scan.
if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  let bad = 0;
  const counted = [];
  const all = [];
  for (const root of ROOTS) {
    let files;
    try {
      files = walk(root);
    } catch {
      // 🔴 Said out loud. A root that silently contributes nothing is how
      // `scripts/osm-pipeline` sat in this list reading zero files.
      console.error(`::error::ROOTS names ${root}, which does not exist here`);
      bad++;
      continue;
    }
    counted.push(`${root}: ${files.length}`);
    all.push(...files);
  }

  const subjects = all.filter((f) => !isSpec(f));
  for (const file of subjects) {
    const source = readFileSync(file, 'utf8');
    const work = unguardedCalls(source, file);
    if (work.length === 0) continue;
    // 🔴 Searched over EVERY file, specs included. Searching the subject
    // list meant a `main.spec.ts` importing `./main` was invisible — the
    // exact class of file CAMP-202 was about.
    const found = verdict({
      file,
      work,
      importedBy: importers(all, file),
      database: touchesDatabase(source, file),
      external: reachesOutside(source, file),
    });
    if (!found) continue;
    bad++;
    console.error(`::error file=${relative('.', found.file)},line=${found.line}::${found.why}`);
  }

  console.log(counted.join('  |  '));
  console.log(
    bad
      ? `\n✗ ${bad} file${bad === 1 ? ' does' : 's do'} work when imported`
      : `✓ ${subjects.length} files (of ${all.length} read): nothing does ` +
        'work that anything can import',
  );
  exit(bad ? 1 : 0);
}
