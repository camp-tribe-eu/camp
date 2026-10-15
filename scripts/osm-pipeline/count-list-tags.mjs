#!/usr/bin/env node
// CAMP-327: what the RAW extracts hold under two readings of a tag — the
// whole value (`amenity=restaurant`) and the elements of a `;` list
// (`amenity=restaurant;ice_cream`) — counted as OBJECTS, with no export, no
// ogr2ogr and no table between us and the number.
//
//   node scripts/osm-pipeline/count-list-tags.mjs [dir] [--objects FILE]
//                                                  (default dir ~/camptribe-osm)
//   node scripts/osm-pipeline/count-list-tags.mjs --self-test
//
// 🔴 WHY THIS EXISTS. The pipeline compared a tag's WHOLE value with the
// list of values it wanted, so `amenity=restaurant;ice_cream` was neither a
// restaurant nor an ice-cream shop, and an osmium filter written the same way
// never selected it. A count taken from the table inherits that blindness —
// the objects it is meant to expose are the ones that are not in it. This
// reads the extracts directly, one `osmium tags-filter -R` per file with a
// SUBSTRING filter (wider than any reading below), parses the OPL, and
// counts what each reading would make of every object.
//
// 🔴 TWO READINGS, ONE KIND. An object gets the first kind in RULES whose
// tag matches — the order of STORED_POI_KINDS, which is the order of the
// SQL CASE — under
//   · `exact`: the whole value equals the word (what every rule but gas read
//              before CAMP-327);
//   · `list`:  the word is an element of the value split on `;` (blanks off,
//              ASCII letters folded — `tagParts`, the reading `access` and
//              `shop=gas` already had).
// `gas_exchange` was a list rule before this card (CAMP-258) and is one in
// both readings here, so the card's own change is what the two columns differ
// by.
//
// 🔴 WHAT THE OBJECTS FILE IS FOR. `--objects FILE` writes one tab-separated
// line per distinct object: type, id, kind under `exact`, kind under `list`,
// whether `access` keeps it out, and in how many extracts it appeared. That
// is what a database is reconciled against, object by object: the oracle says
// what SHOULD be there, the table says what is, and the difference is named.
//
// 🔴 `RULES` is a copy of STORED_POI_RULES in apps/api/src/osm/route-poi.ts,
// because a `.mjs` cannot import a `.ts`. A spec in the API reads this file
// and fails if the two differ. The parser and the access rule are NOT copied:
// they are imported from count-rest-stops.mjs, whose own self-test and the
// API spec already hold them to the loader's.

import { spawn } from 'node:child_process';
import { createWriteStream, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { isAccessExcluded, parseOpl, tagParts } from './count-rest-stops.mjs';

/**
 * Every rule, in CASE order: `[kind, key, values, readAsListBefore]`. The
 * last field is what the pipeline did BEFORE this card, so that the `exact`
 * column is a faithful count of the old behaviour and not an approximation.
 */
export const RULES = [
  ['fuel', 'amenity', ['fuel'], false],
  ['charging', 'amenity', ['charging_station'], false],
  ['water', 'amenity', ['drinking_water', 'water_point'], false],
  ['water', 'man_made', ['water_tap'], false],
  ['dump', 'amenity', ['sanitary_dump_station'], false],
  ['groceries', 'shop', ['supermarket', 'convenience'], false],
  ['food', 'amenity', ['restaurant', 'cafe', 'fast_food'], false],
  ['shelter', 'tourism', ['hotel', 'motel', 'hostel', 'guest_house'], false],
  ['rest_area', 'highway', ['rest_area'], false],
  ['service_area', 'highway', ['services'], false],
  ['gas_exchange', 'shop', ['gas'], true],
];

export const KINDS = [...new Set(RULES.map((r) => r[0]))];

/** What `osmium tags-filter` is asked for: a substring for EVERY value. */
export const EXPRESSIONS = RULES.flatMap(([, key, values]) =>
  values.map((v) => `nwr/${key}=*${v}*`),
);

/**
 * The kind an object gets under one reading, or null. The first rule in
 * order whose tag matches wins — the SQL CASE.
 *
 * 🔴 `exact` compares the raw value, as `s.amenity IN ('fuel')` does: no
 * trim, no case-folding. A `list` match is `tagParts(...)` containing the
 * word, which does both.
 */
export function kindOf(tags, reading) {
  for (const [kind, key, values, listBefore] of RULES) {
    const raw = tags[key];
    if (raw === undefined) continue;
    const hit =
      reading === 'list' || listBefore
        ? tagParts(raw).some((p) => values.includes(p))
        : values.includes(raw);
    if (hit) return kind;
  }
  return null;
}

/** Per-kind counters. `exact` and `list` are DISTINCT objects, n+w+r. */
function emptyKindTally() {
  return Object.fromEntries(
    KINDS.map((k) => [k, { exact: 0, list: 0, gained: 0, lost: 0 }]),
  );
}

/**
 * Adds one object to the by-object map (keyed `type+id`, so an object that
 * sits in two extracts is one object). `extracts` counts the files it was
 * seen in.
 */
export function addObject(objects, obj) {
  const key = `${obj.type}${obj.id}`;
  const seen = objects.get(key);
  if (seen) {
    seen.extracts += 1;
    return;
  }
  objects.set(key, {
    type: obj.type,
    id: obj.id,
    exact: kindOf(obj.tags, 'exact'),
    list: kindOf(obj.tags, 'list'),
    access: isAccessExcluded(obj.tags.access),
    extracts: 1,
    // kept only for the objects the card's change touches: they are the ones
    // a reader will ask about by name
    tags:
      kindOf(obj.tags, 'exact') !== kindOf(obj.tags, 'list') ? obj.tags : null,
  });
}

/**
 * The summary. `loadable` is what the loader can write: nodes and ways, not
 * a relation, access not excluded — before the EU-27 filter, which needs
 * geometry and is the database's to apply.
 */
export function summarise(objects) {
  const kinds = emptyKindTally();
  const sum = {
    kinds,
    distinct: 0,
    noise: 0,
    gainedByType: { n: 0, w: 0, r: 0 },
    gainedAccess: 0,
    gainedLoadable: 0,
    movedBetweenKinds: 0,
  };
  for (const o of objects.values()) {
    sum.distinct += 1;
    if (o.list === null && o.exact === null) {
      sum.noise += 1;
      continue;
    }
    if (o.exact !== null) kinds[o.exact].exact += 1;
    if (o.list !== null) kinds[o.list].list += 1;
    if (o.exact === o.list) continue;
    if (o.exact === null) {
      // admitted by the list reading and by nothing before it
      sum.gainedByType[o.type] += 1;
      if (o.access) sum.gainedAccess += 1;
      else if (o.type !== 'r') sum.gainedLoadable += 1;
      kinds[o.list].gained += 1;
    } else {
      // already in, and the kind it is IN changes
      sum.movedBetweenKinds += 1;
      kinds[o.exact].lost += 1;
      kinds[o.list].gained += 1;
    }
  }
  return sum;
}

/** Streams one extract through osmium and adds every object to `objects`. */
function readFile(pbf, objects) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'osmium',
      ['tags-filter', '-R', '-f', 'opl', '-o', '-', pbf, ...EXPRESSIONS],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let lines = 0;
    createInterface({ input: child.stdout }).on('line', (line) => {
      const obj = parseOpl(line);
      if (!obj) return;
      lines += 1;
      addObject(objects, obj);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(lines)
        : reject(new Error(`osmium exited ${code} on ${pbf}`)),
    );
  });
}

function report(sum, files, lines) {
  const out = [];
  out.push(`${files} extracts, ${lines} object lines, ${sum.distinct} distinct objects`);
  out.push('');
  out.push('kind          exact reading   list reading   gained   lost');
  for (const [kind, k] of Object.entries(sum.kinds)) {
    out.push(
      `${kind.padEnd(13)} ${String(k.exact).padStart(13)} ${String(k.list).padStart(14)} ${String(k.gained).padStart(8)} ${String(k.lost).padStart(6)}`,
    );
  }
  const exactAll = Object.values(sum.kinds).reduce((a, k) => a + k.exact, 0);
  const listAll = Object.values(sum.kinds).reduce((a, k) => a + k.list, 0);
  out.push(
    `${'all'.padEnd(13)} ${String(exactAll).padStart(13)} ${String(listAll).padStart(14)}`,
  );
  out.push('');
  out.push(
    `substring-filter objects that NO reading takes (the noise the rule must refuse): ${sum.noise}`,
  );
  out.push(
    `objects only the list reading takes: ${listAll - exactAll} ` +
      `(nodes ${sum.gainedByType.n}, ways ${sum.gainedByType.w}, relations ${sum.gainedByType.r}; ` +
      `access keeps out ${sum.gainedAccess}; a loader candidate, before the EU-27 filter: ${sum.gainedLoadable})`,
  );
  out.push(
    `objects both readings take whose KIND differs: ${sum.movedBetweenKinds}`,
  );
  return out.join('\n');
}

const SELF_TEST = () => {
  const ok = [];
  const t = (what, cond, detail = '') => ok.push([what, cond, detail]);

  // ── the filter is a substring for every value, and there is one per value ──
  t(
    'one substring expression per value, on all three element types',
    EXPRESSIONS.length === RULES.reduce((n, r) => n + r[2].length, 0) &&
      EXPRESSIONS.every((e) => /^nwr\/[a-z_]+=\*[a-z_]+\*$/.test(e)),
    EXPRESSIONS.join(' '),
  );

  // ── the two readings ──
  const exact = (tags) => kindOf(tags, 'exact');
  const list = (tags) => kindOf(tags, 'list');
  t('a plain value is the same under both', exact({ amenity: 'restaurant' }) === 'food' && list({ amenity: 'restaurant' }) === 'food');
  t('a `;` list is nothing under exact and the kind under list', exact({ amenity: 'restaurant;ice_cream' }) === null && list({ amenity: 'restaurant;ice_cream' }) === 'food');
  t('blanks after the `;` are read (the live `restaurant; ice_cream`)', list({ amenity: 'ice_cream; restaurant' }) === 'food');
  t('a list of OTHER words is nothing under both', list({ amenity: 'bench;device_charging_station' }) === null);
  t('a substring is not an element', list({ amenity: 'internet_cafe' }) === null && list({ amenity: 'device_charging_station' }) === null);
  t('a comma is not a `;`', list({ tourism: 'camp_site,caravan_site,hotel' }) === null);
  t('a value that holds the key is not an element', list({ tourism: 'tourism=hotel' }) === null);
  t('the first rule in order wins a double tag', list({ amenity: 'restaurant', tourism: 'hotel' }) === 'food' && exact({ amenity: 'restaurant', tourism: 'hotel' }) === 'food');
  t('a hotel with a LISTED restaurant moves from shelter to food', exact({ tourism: 'hotel', amenity: 'restaurant;bar' }) === 'shelter' && list({ tourism: 'hotel', amenity: 'restaurant;bar' }) === 'food');
  t('gas was a list rule before this card, in both columns', exact({ shop: 'gas;hairdresser' }) === 'gas_exchange' && list({ shop: 'gas;hairdresser' }) === 'gas_exchange');
  // 🔴 The one place the change touches the kind CAMP-258 added: groceries
  // comes BEFORE gas_exchange in the CASE, so `convenience;gas` — which the
  // gas rule alone made a gas_exchange — is a grocery once convenience reads
  // lists too. The flag `cylinder_swap` keeps it in the gas layer.
  t('convenience;gas moves from gas_exchange to groceries', exact({ shop: 'convenience;gas' }) === 'gas_exchange' && list({ shop: 'convenience;gas' }) === 'groceries');
  t('case is folded by the list reading and not by the exact one', list({ amenity: 'Restaurant' }) === 'food' && exact({ amenity: 'Restaurant' }) === null);

  // ── the tally ──
  const objects = new Map();
  const add = (type, id, tags) => addObject(objects, { type, id, tags });
  add('n', '1', { amenity: 'restaurant' }); // both
  add('n', '2', { amenity: 'restaurant;ice_cream' }); // list only → gained food
  add('w', '3', { amenity: 'cafe;bar', access: 'private' }); // gained, access out
  add('r', '4', { amenity: 'fast_food;bar' }); // gained, a relation
  add('n', '5', { amenity: 'internet_cafe' }); // noise
  add('n', '6', { tourism: 'hotel', amenity: 'restaurant;bar' }); // moved
  add('n', '2', { amenity: 'restaurant;ice_cream' }); // the same object, a second extract
  const s = summarise(objects);
  t('an object in two extracts is one object', s.distinct === 6 && objects.get('n2').extracts === 2, JSON.stringify(s));
  t('noise is counted apart', s.noise === 1);
  t('the list reading gains the list-only objects, per type', s.gainedByType.n === 1 && s.gainedByType.w === 1 && s.gainedByType.r === 1, JSON.stringify(s.gainedByType));
  t('an access-excluded gain is not loadable, and neither is a relation', s.gainedAccess === 1 && s.gainedLoadable === 1, `${s.gainedAccess} ${s.gainedLoadable}`);
  t('a kind that moves is counted lost where it was and gained where it went', s.movedBetweenKinds === 1 && s.kinds.shelter.lost === 1 && s.kinds.food.gained === 4, JSON.stringify(s.kinds.food));
  t('food holds 1 under exact and 5 under list', s.kinds.food.exact === 1 && s.kinds.food.list === 5, `${s.kinds.food.exact} ${s.kinds.food.list}`);

  let failed = 0;
  for (const [what, cond, detail] of ok) {
    if (!cond) failed++;
    console.log(`${cond ? '✓' : '✗'} ${what}${cond ? '' : `  → ${detail}`}`);
  }
  // 🔴 A printed total is a label: compare the number that ran with the
  // number written down.
  const EXPECTED_CASES = 19;
  if (ok.length !== EXPECTED_CASES) {
    failed += 1;
    console.log(`✗ ${ok.length} cases ran, expected ${EXPECTED_CASES}`);
  }
  console.log(
    failed
      ? `\n::error::count-list-tags self-test failed on ${failed} cases`
      : `\n✓ count-list-tags self-test: ${ok.length} cases`,
  );
  return failed;
};

// 🔴 The entry guard, written out, and resolving the real path — see
// scripts/lib/entrypoint.mjs for why it is not a helper.
const RUN_DIRECTLY = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (RUN_DIRECTLY) {
  const args = argv.slice(2);
  const at = args.indexOf('--objects');
  const objectsFile = at >= 0 ? args[at + 1] : null;
  if (at >= 0) {
    if (!objectsFile) {
      console.error('::error::--objects needs a file name');
      exit(1);
    }
    args.splice(at, 2);
  }
  const action = chooseAction(args, ['--self-test'], 'count-list-tags.mjs', {
    positional: 1,
  });
  if (action.has('--self-test')) exit(SELF_TEST() ? 1 : 0);

  const dir = args[0] ?? join(homedir(), 'camptribe-osm');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.osm.pbf'))
    .sort();
  if (files.length === 0) {
    console.error(`::error::no *.osm.pbf in ${dir}`);
    exit(1);
  }
  const objects = new Map();
  let lines = 0;
  for (const f of files) lines += await readFile(join(dir, f), objects);
  console.log(report(summarise(objects), files.length, lines));

  if (objectsFile) {
    const out = createWriteStream(objectsFile);
    for (const o of objects.values()) {
      out.write(
        [o.type, o.id, o.exact ?? '', o.list ?? '', o.access ? 't' : 'f', o.extracts].join('\t') + '\n',
      );
    }
    await new Promise((resolve) => out.end(resolve));
    console.log(`\n${objects.size} objects written to ${objectsFile}`);
  }
}
