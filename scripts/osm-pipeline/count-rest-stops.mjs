#!/usr/bin/env node
// CAMP-119: how many stopping places the RAW extracts hold — counted as
// OBJECTS, with no export, no ogr2ogr and no `a…`/`w…` ids between us and
// the number.
//
//   node scripts/osm-pipeline/count-rest-stops.mjs [dir]     (default ~/camptribe-osm)
//   node scripts/osm-pipeline/count-rest-stops.mjs --self-test
//
// 🔴 WHY THIS EXISTS. The loader's own count cannot be the evidence for
// the loader: `osmium export` hands a closed way out twice (CAMP-253), so
// a count taken from the exported file or from the table inherits the
// doubling it is supposed to expose — 338 305 of the 2 248 280 rows that
// were already in `osm_route_poi` are such twins. This reads the extracts
// directly, one `osmium tags-filter -R` per file (-R: the objects that
// match, not the nodes a way is made of), and counts what comes out.
//
// It is the oracle the import is reconciled against, and it is kept in
// the repository so the number can be re-taken, not remembered.
//
// 🔴 WHAT IT DOES NOT DO: decide anything. It prints, per kind and per
// element type, what the extracts contain; the loader's formula
// (load-route-poi.ts, DUMP_FORMULA) is nodes and ways only, access
// filtered, inside the EU-27 — so the gap between the "all" column and
// the table is relations, excluded access, non-members, and closed-way
// twins, and every one of those is a number here or in the table.
//
// 🔴 `ACCESS_EXCLUDED` below is a copy of the one in
// apps/api/src/osm/route-poi.ts, because a `.mjs` cannot import a `.ts`.
// route-poi-facilities.spec.ts reads this file and fails if the two lists
// differ — and RUNS `isAccessExcluded` below beside the loader's own, over
// every spelling it can think of, and fails if they ever answer differently
// (CAMP-119 review: this file normalised before the list and the loader
// did not, so the oracle counted a rule the loader did not apply).

import { spawn } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

/** `access` values that mean "not you". Mirrors ACCESS_EXCLUDED. */
export const ACCESS_EXCLUDED = ['private', 'no', 'employees', 'permit'];

/**
 * An ASCII-only `toLowerCase`. The loader folds ASCII and nothing else
 * (route-poi-facilities.ts says why: PostgreSQL's `lower()` follows the
 * database's locale and no two agree on `İ`), so the oracle must too.
 */
export function asciiLower(text) {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/**
 * The parts of a tag value: blanks off both ends, ASCII letters folded,
 * split on `;` with blanks around it. JavaScript's `trim()` and `\s` are
 * the 25 blanks the loader's SQL strips — the API spec sweeps every code
 * point to prove it — so nothing here is a second list.
 */
export function tagParts(raw) {
  if (raw === undefined || raw === null) return [];
  return asciiLower(raw.trim())
    .split(/\s*;\s*/)
    .filter((part) => part.length > 0);
}

/**
 * 🔴 The loader's rule, not a cousin of it: an `access` value keeps the
 * place out when ANY part of it is in ACCESS_EXCLUDED, after the same
 * normalisation the loader writes the column with. It is
 * `isAccessExcluded` in apps/api/src/osm/route-poi.ts, and the API spec
 * runs both over the same inputs.
 */
export function isAccessExcluded(raw) {
  return tagParts(raw).some((part) => ACCESS_EXCLUDED.includes(part));
}

/** The tags the card names, in the order the loader writes them. */
export const FACILITY_TAGS = [
  'toilets',
  'shower',
  'fee',
  'drinking_water',
  'sanitary_dump_station',
  'access',
  'hgv',
  'maxheight',
  'maxlength',
];

/** What `osmium tags-filter` is asked for. One expression per kind. */
export const EXPRESSIONS = [
  'highway=rest_area',
  'highway=services',
  'amenity=sanitary_dump_station',
];

/**
 * OPL escapes a character as `%<hex>%` — NOT `%XX` as a URL does, which
 * is the mistake of reading it with decodeURIComponent: `%2c%` would come
 * back as `,%`.
 */
export function decodeOpl(text) {
  return text.replace(/%([0-9a-fA-F]+)%/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
}

/**
 * One OPL line → `{ type, id, tags }`, or null for a line that is not an
 * object. Fields are separated by single spaces and a value cannot hold
 * one, because OPL escapes it; the tag field is the one that starts `T`.
 */
export function parseOpl(line) {
  const fields = line.trimEnd().split(' ');
  const head = /^([nwr])(\d+)$/.exec(fields[0] ?? '');
  if (!head) return null;
  const tagField = fields.find((f, i) => i > 0 && f.startsWith('T'));
  const tags = {};
  if (tagField && tagField.length > 1) {
    for (const pair of tagField.slice(1).split(',')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      tags[decodeOpl(pair.slice(0, eq))] = decodeOpl(pair.slice(eq + 1));
    }
  }
  return { type: head[1], id: head[2], tags };
}

/** The kinds an object belongs to by its own tags. Exact match, not prefix. */
export function kindsOf(tags) {
  const out = [];
  if (tags.highway === 'rest_area') out.push('rest_area');
  if (tags.highway === 'services') out.push('service_area');
  if (tags.amenity === 'sanitary_dump_station') out.push('dump');
  return out;
}

export function emptyTally() {
  const t = {};
  for (const kind of ['rest_area', 'service_area', 'dump']) {
    t[kind] = {
      n: 0,
      w: 0,
      r: 0,
      // nodes and ways whose `access` is not excluded (isAccessExcluded:
      // the loader's own rule) — the loader's "one row per object" before
      // the EU filter
      loaderCandidates: 0,
      values: Object.fromEntries(FACILITY_TAGS.map((tag) => [tag, new Map()])),
    };
  }
  return t;
}

/**
 * Adds one object to a tally.
 *
 * 🔴 `<absent>` and `<blank>` are different keys on purpose. A tag that is
 * not there and a tag whose value is empty are both "nobody said", and
 * both must come out 'unknown' in the table — but they are not the same
 * observation, and a count that merged them could not show that the
 * import treats them the same.
 */
export function add(tally, obj) {
  for (const kind of kindsOf(obj.tags)) {
    const k = tally[kind];
    k[obj.type] += 1;
    if (obj.type !== 'r' && !isAccessExcluded(obj.tags.access)) {
      k.loaderCandidates += 1;
    }
    for (const tag of FACILITY_TAGS) {
      const raw = obj.tags[tag];
      const key = raw === undefined ? '<absent>' : raw.trim() === '' ? '<blank>' : asciiLower(raw.trim());
      k.values[tag].set(key, (k.values[tag].get(key) ?? 0) + 1);
    }
  }
}

export function merge(into, from) {
  for (const kind of Object.keys(into)) {
    for (const f of ['n', 'w', 'r', 'loaderCandidates']) into[kind][f] += from[kind][f];
    for (const tag of FACILITY_TAGS) {
      for (const [v, c] of from[kind].values[tag]) {
        into[kind].values[tag].set(v, (into[kind].values[tag].get(v) ?? 0) + c);
      }
    }
  }
  return into;
}

export const total = (k) => k.n + k.w + k.r;

/** Counts one extract by streaming osmium's OPL — no shell, no temp file. */
function countFile(pbf) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'osmium',
      ['tags-filter', '-R', '-f', 'opl', '-o', '-', pbf, ...EXPRESSIONS],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const tally = emptyTally();
    createInterface({ input: child.stdout }).on('line', (line) => {
      const obj = parseOpl(line);
      if (obj) add(tally, obj);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(tally) : reject(new Error(`osmium exited ${code} on ${pbf}`)),
    );
  });
}

function report(t) {
  const lines = [];
  lines.push('kind          nodes    ways  relations      all   n+w, access ok');
  for (const [kind, k] of Object.entries(t)) {
    lines.push(
      `${kind.padEnd(13)} ${String(k.n).padStart(6)} ${String(k.w).padStart(7)} ${String(k.r).padStart(10)} ${String(total(k)).padStart(8)} ${String(k.loaderCandidates).padStart(14)}`,
    );
  }
  lines.push('');
  for (const [kind, k] of Object.entries(t)) {
    const n = total(k);
    for (const tag of FACILITY_TAGS) {
      const m = k.values[tag];
      const absent = m.get('<absent>') ?? 0;
      const top = [...m.entries()]
        .filter(([v]) => v !== '<absent>')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([v, c]) => `${v}=${c}`)
        .join(' ');
      lines.push(
        `${kind.padEnd(13)} ${tag.padEnd(22)} absent ${String(absent).padStart(6)} (${((100 * absent) / n).toFixed(1).padStart(5)}%)  ${top}`,
      );
    }
  }
  return lines.join('\n');
}

const SELF_TEST = () => {
  const ok = [];
  const t = (what, cond, detail = '') => ok.push([what, cond, detail]);

  // ── the OPL reader ──
  t('%2c% is a comma and %20% a space, not a URL escape', decodeOpl('a%2c%b%20%c') === 'a,b c', decodeOpl('a%2c%b%20%c'));
  t('%25% is a percent sign', decodeOpl('100%25%') === '100%', decodeOpl('100%25%'));
  t('a code point above the BMP survives', decodeOpl('%1f600%') === '😀');

  const node = parseOpl('n12 v1 dV c1 t2020-01-01T00:00:00Z i1 uAnna Thighway=rest_area,toilets=yes x14.5 y46.0');
  t('a node line gives its type, id and tags', node?.type === 'n' && node.id === '12' && node.tags.toilets === 'yes', JSON.stringify(node));

  const way = parseOpl('w34 v2 dV c2 t2020-01-01T00:00:00Z i2 u Thighway=services Nn1,n2,n3,n1');
  t('a way line is read the same way', way?.type === 'w' && way.tags.highway === 'services', JSON.stringify(way));

  const relation = parseOpl('r5 v1 dV c1 t2020-01-01T00:00:00Z i1 u Thighway=rest_area,type=multipolygon Mw1@outer');
  t('a relation line is read, and keeps its type', relation?.type === 'r' && relation.tags.type === 'multipolygon');

  t('a line with no tags has none', Object.keys(parseOpl('n1 v1 dV c1 t2020-01-01T00:00:00Z i1 u T x1 y2')?.tags ?? { x: 1 }).length === 0);
  t('an escaped = inside a value stays inside it', parseOpl('n1 v1 T' + 'name=a%3d%b,highway=rest_area')?.tags.name === 'a=b');
  // 🔴 CAMP-119 review, defect 5: the order of parsing is the whole of the
  // OPL format — split on `,` and `=` FIRST, decode AFTER. Decoding the tag
  // field before splitting turned `name=a%2c%b,highway=rest_area` into
  // `{ name: "a" }` (the `b` has no `=` and is dropped) and the self-test
  // stayed at 23 cases, because no `parseOpl` case held an escaped comma —
  // only `decodeOpl` did, one level down. The ci.yml step is named after
  // exactly this and claimed a check that was not there.
  const escapedComma = parseOpl('n1 v1 T' + 'name=a%2c%b,highway=rest_area');
  t('an escaped comma inside a value is not a separator', JSON.stringify(escapedComma?.tags) === JSON.stringify({ name: 'a,b', highway: 'rest_area' }), JSON.stringify(escapedComma?.tags));
  const escapedKeyComma = parseOpl('n1 v1 T' + 'a%2c%b=c,highway=rest_area');
  t('an escaped comma inside a KEY is not a separator either', JSON.stringify(escapedKeyComma?.tags) === JSON.stringify({ 'a,b': 'c', highway: 'rest_area' }), JSON.stringify(escapedKeyComma?.tags));
  const escapedKeyEq = parseOpl('n1 v1 T' + 'k%3d%1=v,highway=rest_area');
  t('an escaped = inside a KEY stays inside it', JSON.stringify(escapedKeyEq?.tags) === JSON.stringify({ 'k=1': 'v', highway: 'rest_area' }), JSON.stringify(escapedKeyEq?.tags));
  t('a comment line is not an object', parseOpl('# a comment') === null && parseOpl('') === null);

  // ── which kinds an object has ──
  t('highway=rest_area is a rest_area', kindsOf({ highway: 'rest_area' }).join() === 'rest_area');
  t('highway=services is a service_area, not "services"', kindsOf({ highway: 'services' }).join() === 'service_area');
  t('amenity=sanitary_dump_station is a dump', kindsOf({ amenity: 'sanitary_dump_station' }).join() === 'dump');
  t('the KEY sanitary_dump_station on something else is NOT a dump', kindsOf({ highway: 'rest_area', sanitary_dump_station: 'yes' }).join() === 'rest_area');
  t('a prefix is not a match', kindsOf({ highway: 'rest_area_foo' }).length === 0 && kindsOf({ Highway: 'rest_area' }).length === 0);
  t('an object with two kinds is counted under both', kindsOf({ highway: 'services', amenity: 'sanitary_dump_station' }).length === 2);

  // ── the tally ──
  const tally = emptyTally();
  add(tally, { type: 'n', id: '1', tags: { highway: 'rest_area', toilets: 'yes', fee: 'no', access: 'yes' } });
  add(tally, { type: 'w', id: '2', tags: { highway: 'rest_area', toilets: '', access: 'private' } });
  add(tally, { type: 'r', id: '3', tags: { highway: 'rest_area' } });
  add(tally, { type: 'n', id: '4', tags: { amenity: 'sanitary_dump_station' } });
  const ra = tally.rest_area;
  t('nodes, ways and relations are counted apart', ra.n === 1 && ra.w === 1 && ra.r === 1 && total(ra) === 3, JSON.stringify([ra.n, ra.w, ra.r]));
  // 🔴 CAMP-119 review, defect 4: this fixture was ONE allowed node and ONE
  // excluded way, so the filter and its exact inversion both counted 1 and
  // the self-test stayed green with `!excluded` turned into `excluded`
  // (exit 0, 23 cases) — a check that is true by construction, which only
  // the removal of the filter, not its inversion, could break. Five allowed,
  // three excluded and a relation: the right filter counts 5; its inversion
  // 3; no filter 8; one that forgets relations 6; one that compares the raw
  // value ('Private ' and 'private;customers' both get in) 7; one that
  // normalises but does not split a list 6; one that reads a list as
  // excluded only when EVERY part is 4 (and a blank value goes out with it).
  const cand = emptyTally();
  for (const [type, access] of [
    ['n', undefined], ['n', 'customers'], ['w', 'yes'], ['w', 'permissive'], ['n', '   '],
    ['w', 'private'], ['n', 'Private '], ['n', 'private;customers'],
    ['r', 'yes'],
  ]) {
    add(cand, { type, id: '1', tags: access === undefined ? { highway: 'rest_area' } : { highway: 'rest_area', access } });
  }
  t('the loader candidates are nodes and ways with access not excluded', cand.rest_area.loaderCandidates === 5, `${cand.rest_area.loaderCandidates} of 9, expected 5`);
  // …and per object, so a mutation cannot hide behind a count that happens
  // to come out right: each spelling is let in (1) or kept out (0) as the
  // loader's own filter does (route-poi-sql.db.spec.ts runs that one).
  const letIn = (type, access) => {
    const x = emptyTally();
    add(x, { type, id: '1', tags: access === undefined ? { highway: 'rest_area' } : { highway: 'rest_area', access } });
    return x.rest_area.loaderCandidates;
  };
  const wrongVerdicts = [
    ['n', undefined, 1], ['w', undefined, 1], ['n', '', 1], ['n', '   ', 1],
    ['n', 'customers', 1], ['n', 'yes', 1], ['w', 'permissive', 1], ['n', 'students', 1],
    ['n', 'customers;visitors;members', 1], ['n', 'private road', 1], ['n', 'not_private', 1],
    ['n', 'private', 0], ['w', 'no', 0], ['n', 'employees', 0], ['w', 'permit', 0],
    ['n', 'Private', 0], ['n', 'PRIVATE ', 0], ['n', '\tno', 0], ['n', '\u00a0permit', 0],
    ['n', 'delivery;private', 0], ['n', 'private;customers', 0], ['n', 'customers ; Permit', 0],
    ['n', 'no;yes', 0], ['n', 'students;employees', 0],
    ['r', undefined, 0], ['r', 'yes', 0], ['r', 'private', 0],
  ].filter(([type, access, want]) => letIn(type, access) !== want).map(([type, access, want]) => `${type} ${JSON.stringify(access)} → want ${want}`);
  t('each access spelling is let in or kept out the way the loader does it', wrongVerdicts.length === 0, wrongVerdicts.join('; '));
  t('a relation is never a loader candidate', (() => { const x = emptyTally(); add(x, { type: 'r', id: '1', tags: { highway: 'rest_area' } }); return x.rest_area.loaderCandidates === 0; })());
  t('an absent tag and a blank one are different observations', ra.values.toilets.get('<blank>') === 1 && ra.values.toilets.get('<absent>') === 1, JSON.stringify([...ra.values.toilets]));
  t('a written value is counted as written', ra.values.toilets.get('yes') === 1 && ra.values.fee.get('no') === 1);
  t('a dump is counted under dump and nowhere else', tally.dump.n === 1 && total(tally.rest_area) === 3);

  const a = emptyTally(); add(a, { type: 'n', id: '1', tags: { highway: 'rest_area', toilets: 'yes' } });
  const b = emptyTally(); add(b, { type: 'w', id: '2', tags: { highway: 'rest_area', toilets: 'yes' } });
  const both = merge(a, b);
  t('two files add up', both.rest_area.n === 1 && both.rest_area.w === 1 && both.rest_area.values.toilets.get('yes') === 2);

  t('the access list is the loader\'s', ACCESS_EXCLUDED.join() === 'private,no,employees,permit');

  let failed = 0;
  for (const [what, cond, detail] of ok) {
    if (!cond) failed++;
    console.log(`${cond ? '✓' : '✗'} ${what}${cond ? '' : `  → ${detail}`}`);
  }
  // 🔴 A printed total is a label. The number that ran is compared with
  // the number written down, so a case lost to a bad edit is a red run.
  const EXPECTED_CASES = 27;
  if (ok.length !== EXPECTED_CASES) {
    failed += 1;
    console.log(`✗ ${ok.length} cases ran, expected ${EXPECTED_CASES}`);
  }
  console.log(
    failed
      ? `\n::error::count-rest-stops self-test failed on ${failed} cases`
      : `\n✓ count-rest-stops self-test: ${ok.length} cases`,
  );
  return failed;
};

// 🔴 BOTH ENTRY POINTS BELOW THE GUARD, and the guard resolves the real
// path — see normalise-export.mjs and scripts/lib/entrypoint.mjs for the
// three ways an unguarded `--self-test` printed nothing and exited 0.
const RUN_DIRECTLY = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (RUN_DIRECTLY) {
  const action = chooseAction(argv.slice(2), ['--self-test'], 'count-rest-stops.mjs', {
    positional: 1,
  });
  if (action.has('--self-test')) exit(SELF_TEST() ? 1 : 0);

  const dir = argv[2] ?? join(homedir(), 'camptribe-osm');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.osm.pbf'))
    .sort();
  if (files.length === 0) {
    console.error(`::error::no *.osm.pbf in ${dir}`);
    exit(1);
  }
  const grand = emptyTally();
  for (const f of files) merge(grand, await countFile(join(dir, f)));
  console.log(`${files.length} extracts in ${dir}\n`);
  console.log(report(grand));
}
