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

/**
 * Statements at module level that DO something when the file is imported.
 *
 * 🔴 PARSED, NOT SCANNED. The first version counted brace depth over a
 * string with comments and literals blanked out, and matched a call
 * against a list of names the file declared. Review walked past it eight
 * ways — `const main = async function () {}`, a top-level async IIFE,
 * `new Runner().go()`, a missing semicolon, `let main = async () => {}`,
 * a backslash at the end of a line comment, `if (x) main()` — each one
 * reproduced on a file that opened Postgres and ran an UPDATE while the
 * check reported `exit 0`.
 *
 * That is not a list of bugs to fix one at a time; it is a hand-written
 * parser losing to the language. TypeScript's own parser is already a
 * dependency, and it knows what a statement is.
 *
 * The rule is now simpler and stronger: at module level, an EXPRESSION
 * statement is work. Declarations are not, imports are not, and a block
 * guarded by `require.main === module` is not.
 */
export function unguardedCalls(source, fileName = 'file.ts') {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : undefined,
  );

  // Names assigned `require.main === module` (or the ESM equivalent), so
  // `if (RUN_DIRECTLY) { … }` reads as the guard it is.
  const guardNames = new Set();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (d.initializer && /require\.main|import\.meta/.test(d.initializer.getText(sf))) {
        guardNames.add(d.name.getText(sf));
      }
    }
  }
  const isGuard = (expr) => {
    const text = expr.getText(sf);
    if (/require\.main|import\.meta/.test(text)) return true;
    return [...guardNames].some((n) => new RegExp(`\\b${n}\\b`).test(text));
  };

  const found = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const body = (node) => (node && ts.isBlock(node) ? node.statements : node ? [node] : []);

  const visit = (statements) => {
    for (const st of statements) {
      if (ts.isExpressionStatement(st)) {
        // `'use strict'` and friends are directives, not work.
        if (ts.isStringLiteral(st.expression)) continue;
        found.push({ line: at(st), name: st.expression.getText(sf).split('\n')[0].slice(0, 60) });
      } else if (ts.isIfStatement(st)) {
        // 🔴 A guarded block is the whole point and is left alone. A
        // top-level `if` that is NOT the guard does not make its body any
        // less module-level, so we keep looking inside it.
        if (isGuard(st.expression)) continue;
        visit(body(st.thenStatement));
        visit(body(st.elseStatement));
      } else if (ts.isBlock(st)) {
        visit(st.statements);
      } else if (ts.isTryStatement(st)) {
        visit(st.tryBlock.statements);
        if (st.catchClause) visit(st.catchClause.block.statements);
        if (st.finallyBlock) visit(st.finallyBlock.statements);
      } else if (ts.isExportAssignment(st) && ts.isCallExpression(st.expression)) {
        // `export default main();` runs too.
        found.push({ line: at(st), name: st.expression.getText(sf).slice(0, 60) });
      }
      // Everything else at module level is a declaration, an import or an
      // export of one: it defines, it does not do.
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
  const CLIENTS = new Set(['Client', 'Pool', 'DataSource']);
  let found = false;
  const walkNode = (node) => {
    if (found) return;
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && CLIENTS.has(node.expression.text)) {
      found = true;
      return;
    }
    // A helper that shells out to psql, which is how the .mjs pipeline
    // scripts talk to Postgres.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'psql') {
      found = true;
      return;
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
  'pg', 'typeorm', 'mysql2', 'sqlite3', 'ioredis', 'redis',
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'child_process', 'node:child_process',
  'http', 'node:http', 'https', 'node:https', 'net', 'node:net',
  'node:dns', 'dns', 'undici', 'node-fetch',
  '@nestjs/core', 'nodemailer',
]);

export function reachesOutside(source, fileName = 'file.ts') {
  if (specifiersIn(source, fileName).some((spec) => OUTSIDE.has(spec))) return true;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : undefined);
  let found = false;
  const walkNode = (node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      /^(process\.exit|execSync|spawnSync|execFileSync)$/.test(node.expression.getText(sf))
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
