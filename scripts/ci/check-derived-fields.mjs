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
// `apps/web/src/content/legal/database.tsx` is it.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TYPE_FILE = join(ROOT, 'apps', 'api', 'src', 'osm', 'spot-context.ts');
const PAGE_FILE = join(ROOT, 'apps', 'web', 'src', 'content', 'legal', 'database.tsx');

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
 * 🔴 The page as a READER sees it, not as the file is written.
 *
 * This tested the file's bytes. Review deleted the whole `<li>` that
 * describes `station` and left `<B>station</B>` inside a `//` comment:
 * rc=0, "✓ all 7", and not one word about `station` anywhere a reader
 * could reach it. That is the same defect this guard was built to catch
 * — a disclosure that exists only where nobody looks — moved up one
 * level into the guard itself.
 *
 * So comments are removed before the match, exactly as `declaredFields`
 * removes them from the type.
 */
export function renderedPage(page) {
  return page
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/[^\n]*$/gm, ' ');
}

export function namedInPage(field, page) {
  return new RegExp(`<B>${field}</B>`).test(renderedPage(page));
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
      '\n  apps/web/src/content/legal/database.tsx is the file we offer\n' +
        '  recipients INSTEAD of the derived database. A field it does not\n' +
        '  name is a field we did not disclose. Describe what it holds and\n' +
        '  how it is computed — not "and other fields", which is not a\n' +
        '  method of making alterations.',
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
  if (fields.join(',') !== 'water,elevation,at') {
    bad(`read ${JSON.stringify(fields)}, not water,elevation,at`);
  }
  // 🔴 Only SpotContext. A neighbouring interface is not our disclosure.
  if (fields.includes('notAField')) bad('a field from another interface was read');
  if (fields.includes('helper')) bad('a function was read as a field');
  // And a word that appears only in a comment is not a field.
  if (fields.includes('decoy')) bad('a word from a comment was read as a field');

  const full = '<B>water</B> <B>elevation</B> <B>at</B>';
  if (run(type, full, quiet) !== 0) bad('a complete page was rejected');

  for (const drop of ['water', 'elevation', 'at']) {
    const holed = full.replace(`<B>${drop}</B>`, '');
    if (run(type, holed, quiet) !== 1) bad(`a page missing "${drop}" was accepted`);
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
  if (afterBrace.join(',') !== 'water,elevation,at') {
    bad(`a "}" inside a comment cut the interface short: read ${JSON.stringify(afterBrace)}`);
  }
  if (run(braceInComment, full, quiet) !== 0) bad('a complete page was rejected after a brace in a comment');

  const modifiers = `
export interface SpotContext {
  readonly water?: NearestWater;
  "elevation"?: number;
  at?: { lat: number; lon: number };
}
`;
  const withModifiers = declaredFields(modifiers);
  if (withModifiers.join(',') !== 'water,elevation,at') {
    bad(`a modifier or a quoted key hid a field: read ${JSON.stringify(withModifiers)}`);
  }

  // 🔴 And a field named ONLY in a comment is not described. Review
  // deleted the whole entry for `station` and left `<B>station</B>` in a
  // `//` comment; the guard said ✓ over a page that told a reader
  // nothing.
  for (const commented of [
    '<B>water</B> <B>elevation</B> {/* <B>at</B> — elsewhere */}',
    '<B>water</B> <B>elevation</B>\n// <B>at</B>\n',
    '<B>water</B> <B>elevation</B> /* <B>at</B> */',
  ]) {
    if (run(type, commented, quiet) !== 1) {
      bad(`a field named only inside a comment was accepted: ${commented}`);
    }
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
  if (a.join(',') !== b.join(',')) {
    bad(`the two readers disagree on a file they should both read: ${a} vs ${b}`);
  }
  if (!a.includes('nested') || a.includes('b')) {
    bad(`a nested object type was read wrong: ${JSON.stringify(a)}`);
  }

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
  if (main.join(',') === second.join(',')) {
    bad(`the disagreement fixture no longer makes them disagree: both read ${main}`);
  }
  if (run(disagree, '<B>water</B> <B>nested</B> <B>at</B>', quiet) !== 1) {
    bad('two readings that disagree were not refused');
  }

  // The anti-emptiness guard, which every comparison above depends on.
  if (run('export interface Something {}', full, quiet) !== 1) {
    bad('a renamed interface was treated as "no derived fields"');
  }

  if (rc === 0) {
    console.log(
      '✓ rehearsal: fields are read from SpotContext alone — not from a\n' +
        '  neighbouring interface, a function or a comment — a complete page\n' +
        '  passes, each missing field is reported, and a renamed interface\n' +
        '  fails instead of reading as "nothing is derived".\n' +
        '  And the three shapes that got past it: a "}" inside a JSDoc, a\n' +
        '  `readonly` or quoted key, and a field named only in a comment on\n' +
        '  the page. Two independent readers of the type must agree.',
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
} else if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
} else {
  process.exit(run(readFileSync(TYPE_FILE, 'utf8'), readFileSync(PAGE_FILE, 'utf8')));
}
