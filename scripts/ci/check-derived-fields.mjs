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
  const start = source.indexOf('export interface SpotContext {');
  if (start < 0) return [];
  const end = source.indexOf('\n}', start);
  if (end < 0) return [];
  const body = source
    .slice(start, end)
    // Comments describe the field; they must not BE the field.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const out = [];
  for (const m of body.matchAll(/^\s{2}([A-Za-z_][\w]*)\??\s*:/gm)) out.push(m[1]);
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
export function namedInPage(field, page) {
  return new RegExp(`<B>${field}</B>`).test(page);
}

export function missingFrom(fields, page) {
  return fields.filter((f) => !namedInPage(f, page));
}

function run(typeSrc, pageSrc, log = console) {
  const fields = declaredFields(typeSrc);

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

  // The anti-emptiness guard, which every comparison above depends on.
  if (run('export interface Something {}', full, quiet) !== 1) {
    bad('a renamed interface was treated as "no derived fields"');
  }

  if (rc === 0) {
    console.log(
      '✓ rehearsal: fields are read from SpotContext alone — not from a\n' +
        '  neighbouring interface, a function or a comment — a complete page\n' +
        '  passes, each missing field is reported, and a renamed interface\n' +
        '  fails instead of reading as "nothing is derived".',
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
