#!/usr/bin/env node
// 🔴 Every field we DERIVE must be named on the page that describes our
// derivations.
//
// CAMP-186. ODbL 1.0 §4.6 lets us answer a recipient with
//
//   "A file containing all of the alterations made to the Database or
//    the method of making the alterations to the Database (such as an
//    algorithm), including any additional Contents"
//
// instead of shipping the derived database itself. We chose that, and
// the legal document `database` is it.
//
// 🔴 CAMP-365: THAT DOCUMENT NO LONGER LIVES IN `apps/web/src`. It lives in
// the database (`legal_pages`), and the one copy of its text a CI step with
// no database can read is the one the seed migration inserts. This guard
// reads THAT. What it therefore cannot see is an edit made later in the
// CMS: a field described in the seed and deleted in the CMS passes here.
// Said plainly rather than left for the next reader to discover — closing
// it needs a check over the BUILT page, which is a job with the real data.
//
// A description that has fallen behind the code is not that file. It is
// a page that looks like compliance — which is worse than no page,
// because nobody goes looking for a hole they believe is covered. The
// failure is silent by construction: adding a computed field breaks
// nothing, renders fine, and quietly puts us outside §4.6.
//
// So the page is checked against the TYPE, not against anyone's memory:
// every property `SpotContext` declares must appear by name in the
// prose. Adding a field is therefore a two-file change, and CI says so.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TYPE_FILE = join(ROOT, 'apps', 'api', 'src', 'osm', 'spot-context.ts');
const SEED_FILE = join(
  ROOT,
  'apps',
  'api',
  'src',
  'migrations',
  '1792800000000-SeedLegalPages.ts',
);

/**
 * The markup of one seeded legal document.
 *
 * 🔴 Cut out by position, not evaluated: the migration is TypeScript and
 * this runs on the Node the CI job has, with no transpiler. That is
 * faithful only while the body is a plain template literal — no escape,
 * no `${}` — and the day it stops being one this REFUSES rather than
 * quietly returning text that is not what the database holds.
 *
 * 🔴 The body is taken from the slug's OWN entry. Looking for the first
 * `body: \`` after the slug and stopping there would read the NEXT
 * document's text for a slug that has no body field of its own.
 */
export function seededBody(source, slug) {
  const at = source.indexOf(`slug: '${slug}',`);
  if (at < 0) throw new Error(`no document «${slug}» in the legal seed`);
  const next = source.indexOf("slug: '", at + 1);
  const open = source.indexOf('body: `', at);
  if (open < 0 || (next >= 0 && open > next)) {
    throw new Error(`document «${slug}» has no body in the legal seed`);
  }
  const start = open + 'body: `'.length;
  const end = source.indexOf('`', start);
  if (end < 0 || source[end + 1] !== ',') {
    throw new Error(`the body of «${slug}» does not end where a template literal does`);
  }
  const body = source.slice(start, end);
  if (/\\|\$\{/.test(body)) {
    throw new Error(
      `the body of «${slug}» holds a backslash or a template placeholder; ` +
        'reading it by position would not give what the database holds',
    );
  }
  return body;
}

/**
 * The property names `SpotContext` declares.
 *
 * 🔴 Read from the interface body, not from the whole file: the file
 * also holds helper types and functions, and sweeping those in would
 * demand prose about things no reader of the page has ever seen.
 */
export function declaredFields(source) {
  // 🔴 COMMENTS GO FIRST, AND THE ORDER IS THE WHOLE BUG.
  //
  // This used to find the end of the interface with
  // `source.indexOf('\n}', start)` and strip comments afterwards. A
  // JSDoc containing a `}` at column zero therefore ENDED the interface
  // early. Review put one after `water`, added two real fields, and the
  // guard read 1 field out of 9 and printed "✓ all 1 derived fields are
  // described" — green, with eight fields undisclosed.
  //
  // Stripping first means a brace inside a comment cannot be the brace
  // that closes the body.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

  const start = stripped.indexOf('export interface SpotContext {');
  if (start < 0) return [];
  const end = stripped.indexOf('\n}', start);
  if (end < 0) return [];
  const body = stripped.slice(start, end);

  const out = [];
  // 🔴 A field is not always a bare word. Review got `readonly fuel?:`,
  // `"fuel"?:` and a name alone on its line past the old pattern, each
  // of which is a field TypeScript declares and this did not see.
  //
  // `readonly` is a modifier, not a name; a quoted key is still a key;
  // and the colon may sit on the next line. Each of those is a real
  // declaration that would otherwise never need a word on the page.
  const FIELD = /^ {2}(?:readonly\s+)?(?:\[?["']?)([A-Za-z_$][\w$]*)["']?\]?\s*\??\s*:/gm;
  for (const m of body.matchAll(FIELD)) out.push(m[1]);
  return [...new Set(out)];
}

/**
 * Is this field named in the page's field list?
 *
 * 🔴 The TAGGED form only, and the loose version was a real hole. An
 * earlier draft also accepted a bare word anywhere in the prose, so
 * `station` was satisfied by the sentence "the nearest railway station"
 * and `at` — an English preposition — was satisfied by almost every
 * sentence on the page. Both passed with their entry deleted.
 *
 * A field is disclosed when it is LISTED, not when its name happens to
 * occur. `<B>name</B>` is the shape the list uses.
 */
/**
 * 🔴 The page as a READER sees it, not as the markup is written.
 *
 * With JSX this stripped comments: review deleted the whole `<li>` that
 * describes `station` and left `<B>station</B>` in a `//` comment, and the
 * guard said "✓ all 7" over a page that told a reader nothing. Markup has
 * no comments — anything written in it renders — but it has two places
 * where a name is written and not shown: a link's destination and a
 * heading's `{#anchor}`. A field named only there is not described.
 */
export function renderedPage(page) {
  return page
    .replace(/\]\([^)\s]*\)/g, ']')
    .replace(/\s*\{#[^}\n]*\}\s*$/gm, '');
}

export function namedInPage(field, page) {
  // `$` is legal in an identifier and special in a pattern.
  const name = field.replace(/[$]/g, '\\$&');
  return new RegExp(`\\*\\*${name}\\*\\*`).test(renderedPage(page));
}

/**
 * A SECOND reader of the same interface, written to share as little as
 * possible with the first.
 *
 * 🔴 WHY TWO. Every one of the three holes review found was an UNDER-read
 * — the guard saw fewer fields than TypeScript declares and said "✓ all
 * 1 derived fields are described" over a file with nine. An under-read
 * cannot be caught by anything downstream, because the comparison it
 * feeds is then simply smaller. Nothing anywhere pinned the count
 * against the real file.
 *
 * Pinning a number would work and would rot: it becomes a third place to
 * edit, and the first person in a hurry edits it to whatever the guard
 * just printed.
 *
 * So instead: find the body by COUNTING BRACES rather than looking for
 * `\n}`, and take names with a different pattern. The two disagree
 * exactly when one of them is wrong, and `run` refuses to proceed on a
 * disagreement. Neither is the authority; the agreement is.
 */
export function declaredFieldsCrude(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  const marker = 'export interface SpotContext {';
  const at = stripped.indexOf(marker);
  if (at < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = at + marker.length - 1; i < stripped.length; i++) {
    if (stripped[i] === '{') depth += 1;
    else if (stripped[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  const body = stripped.slice(at + marker.length, end);

  // Walk it as text at nesting depth 0, which is where the interface's
  // own members live — a nested object type's keys are not our fields.
  const out = [];
  let level = 0;
  let line = '';
  for (const ch of body) {
    if (ch === '\n') {
      if (level === 0) {
        const m = /^\s*(?:readonly\s+)?["'[]?([A-Za-z_$][\w$]*)["'\]]?\s*\??\s*:/.exec(line);
        if (m) out.push(m[1]);
      }
      line = '';
      continue;
    }
    if (level === 0) line += ch;
    if (ch === '{' || ch === '(' || ch === '[') level += 1;
    if (ch === '}' || ch === ')' || ch === ']') level -= 1;
  }
  return [...new Set(out)];
}

export function missingFrom(fields, page) {
  return fields.filter((f) => !namedInPage(f, page));
}

function run(typeSrc, pageSrc, log = console) {
  const fields = declaredFields(typeSrc);

  // 🔴 Two readers, and the agreement is the authority. See
  // `declaredFieldsCrude`: every hole review found was an under-read,
  // and an under-read is invisible to every comparison downstream.
  const crude = declaredFieldsCrude(typeSrc);
  const only = (a, b) => a.filter((f) => !b.includes(f));
  if (only(fields, crude).length > 0 || only(crude, fields).length > 0) {
    log.error(
      '✗ The two readings of SpotContext disagree, so neither can be trusted:\n' +
        `  the main reader saw:  ${fields.join(', ') || '(nothing)'}\n` +
        `  the second reader saw: ${crude.join(', ') || '(nothing)'}\n` +
        '\n  One of them is missing a field. A field this guard cannot see is\n' +
        '  a field it will never ask the page to describe, and the ✓ it would\n' +
        '  print is over a §4.6 hole.',
    );
    return 1;
  }

  // 🔴 An empty reading passes any comparison below. If the interface is
  // ever renamed, this is what says so rather than quietly agreeing that
  // we derive nothing at all.
  if (fields.length === 0) {
    log.error(
      '✗ No fields were read from SpotContext — the interface moved or was renamed.\n' +
        '  Until this reads them again the page below is unchecked, which is\n' +
        '  the state §4.6 is least forgiving of.',
    );
    return 1;
  }

  const missing = missingFrom(fields, pageSrc);
  if (missing.length > 0) {
    log.error('✗ Computed fields missing from the ODbL §4.6 description:\n');
    for (const f of missing) log.error(`  ${f}`);
    log.error(
      '\n  The legal document `database` (seeded by\n' +
        '  apps/api/src/migrations/1792800000000-SeedLegalPages.ts) is what\n' +
        '  we offer recipients INSTEAD of the derived database. A field it\n' +
        '  does not name is a field we did not disclose. List it as\n' +
        '  `- **name** — what it holds`, and say how it is computed — not\n' +
        '  "and other fields", which is not a method of making alterations.',
    );
    return 1;
  }

  log.log(`✓ all ${fields.length} derived fields are described: ${fields.join(', ')}`);
  return 0;
}

// Prove it can fail. Nothing here reads the real files.
function selfTest() {
  let rc = 0;
  const bad = (m) => {
    console.error(`✗ REHEARSAL FAILED: ${m}`);
    rc = 1;
  };
  // 🔴 CAMP-286. Every assertion registers HERE, as it runs — not where it
  // is written. A case that stopped executing prints exactly what a case
  // that passed prints, so the only thing that tells them apart is how
  // many actually ran. The two loops below contribute one case per
  // iteration for the same reason: a shortened fixture list is a case
  // that stopped running.
  const cases = [];
  const failIf = (cond, m) => {
    cases.push(m);
    if (cond) bad(m);
  };
  const quiet = { log: () => {}, error: () => {} };

  const type = `
export interface SpotContext {
  /** Nearest lake. Mentions decoy in its comment. */
  water?: NearestWater;
  elevation?: number;
  at?: { lat: number; lon: number };
}
export function helper(x: number) { return x; }
export interface Other { notAField?: string; }
`;

  const fields = declaredFields(type);
  failIf(
    fields.join(',') !== 'water,elevation,at',
    `read ${JSON.stringify(fields)}, not water,elevation,at`,
  );
  // 🔴 Only SpotContext. A neighbouring interface is not our disclosure.
  failIf(fields.includes('notAField'), 'a field from another interface was read');
  failIf(fields.includes('helper'), 'a function was read as a field');
  // And a word that appears only in a comment is not a field.
  failIf(fields.includes('decoy'), 'a word from a comment was read as a field');

  const full = '- **water** — a\n- **elevation** — b\n- **at** — c';
  failIf(run(type, full, quiet) !== 0, 'a complete page was rejected');

  for (const drop of ['water', 'elevation', 'at']) {
    const holed = full.replace(`**${drop}**`, '');
    failIf(
      run(type, holed, quiet) !== 1,
      `a page missing "${drop}" was accepted`,
    );
  }

  // 🔴 THE THREE SHAPES THE REHEARSAL DID NOT HAVE.
  //
  // Its fixture was a simpler file than the real one — single-line JSDoc
  // only, no `readonly`, no brace inside a comment — so all three holes
  // review found passed it. Each is now a fixture, because a rehearsal
  // that only exercises the easy shape proves the easy shape.
  const braceInComment = `
export interface SpotContext {
  /**
   * Shaped like
}
   * which used to end this interface right here.
   */
  water?: NearestWater;
  elevation?: number;
  at?: { lat: number; lon: number };
}
`;
  const afterBrace = declaredFields(braceInComment);
  failIf(
    afterBrace.join(',') !== 'water,elevation,at',
    `a "}" inside a comment cut the interface short: read ${JSON.stringify(afterBrace)}`,
  );
  failIf(
    run(braceInComment, full, quiet) !== 0,
    'a complete page was rejected after a brace in a comment',
  );

  const modifiers = `
export interface SpotContext {
  readonly water?: NearestWater;
  "elevation"?: number;
  at?: { lat: number; lon: number };
}
`;
  const withModifiers = declaredFields(modifiers);
  failIf(
    withModifiers.join(',') !== 'water,elevation,at',
    `a modifier or a quoted key hid a field: read ${JSON.stringify(withModifiers)}`,
  );

  // 🔴 And a field named only where a reader is not shown it is not
  // described. In JSX that was a comment (review deleted the whole entry
  // for `station` and left `<B>station</B>` in a `//` one; the guard said ✓
  // over a page that told a reader nothing). In markup it is a link's
  // destination, an anchor, an escaped pair of asterisks, or a word in
  // prose — each a way to have the NAME on the page without LISTING it.
  for (const unlisted of [
    '- **water** — a\n- **elevation** — b\n[x](/y/**at**)',
    '- **water** — a\n- **elevation** — b\n## Heading {#**at**}',
    '- **water** — a\n- **elevation** — b\n\\*\\*at\\*\\* is escaped, not bold',
    '- **water** — a\n- **elevation** — b\nthe at field, in prose',
    '- **water** — a\n- **elevation** — b\n*at* in italics only',
  ]) {
    failIf(
      run(type, unlisted, quiet) !== 1,
      `a field named only where a reader is not shown it was accepted: ${unlisted}`,
    );
  }

  // 🔴 The two readers must agree, and must be seen to disagree when one
  // is wrong. `extra` is a field only a correct reader finds.
  const extra = `
export interface SpotContext {
  water?: NearestWater;
  elevation?: number;
  at?: { lat: number; lon: number };
  nested?: { a: { b: number } };
}
`;
  const a = declaredFields(extra);
  const b = declaredFieldsCrude(extra);
  failIf(
    a.join(',') !== b.join(','),
    `the two readers disagree on a file they should both read: ${a} vs ${b}`,
  );
  failIf(
    !a.includes('nested') || a.includes('b'),
    `a nested object type was read wrong: ${JSON.stringify(a)}`,
  );

  // 🔴 And the agreement must be LOAD-BEARING, not decorative.
  //
  // Here the two readers really do disagree: a nested object type whose
  // closing brace sits at column zero ends the body for the reader that
  // looks for "\n}", and does not for the one that counts braces. The
  // first therefore never sees `at`. Neither reading is trustworthy once
  // they differ, and `run` must refuse rather than pick one.
  const disagree = `
export interface SpotContext {
  water?: NearestWater;
  nested?: {
a: number;
}
  at?: { lat: number; lon: number };
}
`;
  const main = declaredFields(disagree);
  const second = declaredFieldsCrude(disagree);
  failIf(
    main.join(',') === second.join(','),
    `the disagreement fixture no longer makes them disagree: both read ${main}`,
  );
  failIf(
    run(disagree, '- **water** — a\n- **nested** — b\n- **at** — c', quiet) !== 1,
    'two readings that disagree were not refused',
  );

  // 🔴 THE EXTRACTOR READS THE RIGHT DOCUMENT, OR REFUSES. It cuts text out
  // of a TypeScript file by position, so each way that goes wrong is a case:
  // the neighbour's body, a missing slug, an escape, an unterminated body.
  const seed = (...docs) =>
    `class X {\n  private readonly pages = [\n${docs
      .map((d) => `    {\n      slug: '${d[0]}',\n      title: 'T',\n${d[1]}    },\n`)
      .join('')}  ];\n}\n`;
  const withBody = (b) => `      body: \`${b}\`,\n`;
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  failIf(
    seededBody(seed(['a', withBody('first')], ['database', withBody('- **at** — c')]), 'database') !==
      '- **at** — c',
    'the extractor did not return the requested document\'s own body',
  );
  failIf(
    !throws(() => seededBody(seed(['database', ''], ['b', withBody('NEIGHBOUR')]), 'database')),
    'a document with no body field was given its neighbour\'s body',
  );
  failIf(
    !throws(() => seededBody(seed(['a', withBody('x')]), 'database')),
    'an unknown slug was not refused',
  );
  failIf(
    !throws(() => seededBody(seed(['database', withBody('a \\ b')]), 'database')),
    'a body with a backslash was read by position instead of refused',
  );
  failIf(
    !throws(() =>
      seededBody("slug: 'database',\n      body: `never ends", 'database'),
    ),
    'a body that does not end like a template literal was not refused',
  );

  // The anti-emptiness guard, which every comparison above depends on.
  failIf(
    run('export interface Something {}', full, quiet) !== 1,
    'a renamed interface was treated as "no derived fields"',
  );

  // 🔴 A literal, never `cases.length`. Deriving the expectation from the
  // thing it checks makes the comparison true by construction — the exact
  // defect this count exists to catch.
  const EXPECTED_CASES = 26;
  if (cases.length !== EXPECTED_CASES) {
    console.error(
      `✗ REHEARSAL FAILED: ${cases.length} cases ran, expected ${EXPECTED_CASES}`,
    );
    rc = 1;
  }

  // 🔴 The line names this file. "26 cases passed" is a sentence several
  // scripts could print, and a CI step grepping for it could be satisfied
  // by somebody else's self-test.
  console.log(
    rc === 0
      ? `✓ check-derived-fields self-test: ${cases.length} cases over the derived-field disclosure`
      : `✗ check-derived-fields self-test: ${cases.length} cases, at least one failed`,
  );

  if (rc === 0) {
    console.log(
      '✓ rehearsal: fields are read from SpotContext alone — not from a\n' +
        '  neighbouring interface, a function or a comment — a complete page\n' +
        '  passes, each missing field is reported, and a renamed interface\n' +
        '  fails instead of reading as "nothing is derived".\n' +
        '  And the shapes that got past it: a "}" inside a JSDoc, a\n' +
        '  `readonly` or quoted key, and a field named only where a reader\n' +
        '  is not shown it (a link destination, an anchor, escaped asterisks,\n' +
        '  plain prose). Two independent readers of the type must agree, and\n' +
        '  the extractor reads the right document or refuses.',
    );
  }
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (!invokedDirectly) {
  // imported for its functions
} else {
  // 🔴 CAMP-286. `includes('--self-test')` meant a typo — `--selftest` —
  // fell through to the real check, which passes. Green step, rehearsal
  // never run. An unknown flag is an error, not a shrug.
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test'],
    'check-derived-fields.mjs',
  );
  if (action.has('--self-test')) process.exit(selfTest());
  else
    process.exit(
      run(
        readFileSync(TYPE_FILE, 'utf8'),
        seededBody(readFileSync(SEED_FILE, 'utf8'), 'database'),
      ),
    );
}
