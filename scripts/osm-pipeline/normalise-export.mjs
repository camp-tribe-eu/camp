#!/usr/bin/env node
// What `osmium export` hands us is not what we want in the table.
//
//   node scripts/osm-pipeline/normalise-export.mjs <in.geojson> <out.geojson>
//   node scripts/osm-pipeline/normalise-export.mjs --self-test
//
// 🔴 WHY THIS EXISTS (CAMP-253). Two faults, both measured on Austria
// 11.10.2026, both invisible in every count we had:
//
// 1. A CLOSED WAY COMES BACK TWICE. `osmium export` emits it as a
//    LineString under `w<id>` and again as a Polygon under `a<id>`,
//    where libosmium numbers areas `way × 2` (and `relation × 2 + 1`).
//    Two different ids for one object, so the upsert key never collapsed
//    them. Austria: 603 lines and 611 areas for the same 611 ways.
//
// 2. ANYTHING TAGGED INSIDE A CAMPSITE COMES WITH IT. `tags-filter` has
//    to keep the nodes a way is made of, or there is no geometry to
//    build; `export` then emits every one of those nodes that carries
//    tags of its own as a feature in its own right. Austria: 116 of
//    them. Looked three up by hand in OSM:
//
//        n10051077470  barrier=gate
//        n10126159242  man_made=flagpole
//        n10139119374  barrier=lift_gate
//
//    A gate, a flagpole and a lift gate, each in the database as a PAID
//    CAMPSITE with a page of its own. Across the EU-27 that is 5 755
//    rows, 10.9% of everything we imported from OSM — and for a site
//    whose entire acquisition channel is generated pages, thin pages
//    about nothing are a risk to the domain, not to one URL.
//
// So: keep only features that carry the tag themselves, and give each
// one its real OSM identifier back, so `w871234` in our table is a thing
// a person can open on openstreetmap.org.

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

/** The tags that make a feature one of ours. */
export const WANTED = ['camp_site', 'caravan_site'];

/**
 * The identity an area and its line share — for GROUPING only.
 *
 * 🔴 `a` → `w` is NOT a string substitution, and assuming it was cost me
 * an hour: areas are numbered `way × 2` and `relation × 2 + 1`, so
 * `a132953274` is way 66476637, not way 132953274.
 *
 * 🔴 AND IT IS NOT WHAT WE STORE. The first version of this wrote the
 * canonical form into `osm_ref`, which would have been better data and a
 * much worse day. Review measured what it costs: `camping_spots` holds
 * **32 413** rows keyed `a…` today, and both the upsert
 * (`import-spots.ts` ON CONFLICT (osm_ref)) and the slug lookup
 * (`slugByRef`) are keyed on that string. Re-keying them means no
 * conflict, no slug hit, a new row, a new slug and a new
 * `/camping/<country>/<region>/<slug>` — while the old row goes unseen
 * and is stamped `missing_since`, which serves 410. That is ~34 500
 * published URLs moved in one run, against the rule that says a URL we
 * published is forever (CAMP-87).
 *
 * So this is the grouping key, and the feature keeps the id it arrived
 * with. Canonical refs are worth having and they need a migration that
 * rewrites the column IN PLACE, where the row — and its slug — survives.
 */
export function canonicalId(id) {
  const s = String(id ?? '');
  if (s[0] !== 'a') return s;
  const n = Number(s.slice(1));
  if (!Number.isInteger(n)) return s;
  return n % 2 === 0 ? `w${n / 2}` : `r${(n - 1) / 2}`;
}

/** Polygons beat lines beat points: the richest geometry for one object. */
const RANK = { MultiPolygon: 4, Polygon: 3, MultiLineString: 2, LineString: 2, Point: 1 };
const rank = (f) => RANK[f?.geometry?.type] ?? 0;

export function normalise(features) {
  const kept = new Map();
  let notOurs = 0;
  let collapsed = 0;

  for (const f of features) {
    const tourism = f?.properties?.tourism;
    // 🔴 The feature's OWN tag, not the file it arrived in. Everything
    // else in that file is scaffolding: the nodes a polygon is made of,
    // and whatever those nodes happen to be.
    if (!WANTED.includes(tourism)) {
      notOurs += 1;
      continue;
    }
    // Grouped by the object, emitted with the id it came with.
    const key = canonicalId(f.id);
    const seen = kept.get(key);
    if (!seen) {
      kept.set(key, f);
      continue;
    }
    collapsed += 1;
    if (rank(f) > rank(seen)) kept.set(key, f);
  }

  return { features: [...kept.values()], notOurs, collapsed };
}

/**
 * Is a result safe to load, or did the filter eat everything?
 *
 * 🔴 Lifted out of the runtime block on review. It used to live inline
 * under `if (RUN_DIRECTLY)`, where no test could reach it — and the
 * mutation proved it: changing that `if` to `if (false)` left the
 * self-test at 14/14 green. A safeguard nothing exercises is a comment.
 */
export function verdict(before, kept) {
  if (before > 0 && kept === 0) {
    return 'every feature was discarded — the tag test is wrong, not the data';
  }
  return null;
}

const SELF_TEST = () => {
  const ok = [];
  const t = (what, cond, detail = '') => ok.push([what, cond, detail]);

  t('an area id is halved, not string-swapped', canonicalId('a132953274') === 'w66476637', canonicalId('a132953274'));
  t('an odd area id is a relation', canonicalId('a9') === 'r4', canonicalId('a9'));
  t('a node id is left alone', canonicalId('n7') === 'n7');
  t('a way id is left alone', canonicalId('w7') === 'w7');

  const camp = (id, type, tourism = 'camp_site') => ({
    id,
    geometry: { type, coordinates: [] },
    properties: { tourism },
  });

  // 🔴 THE DUPLICATE THIS FILE EXISTS FOR.
  const pair = normalise([camp('w123', 'LineString'), camp('a246', 'Polygon')]);
  t('a line and its area collapse to one', pair.features.length === 1, JSON.stringify(pair.features.map((f) => f.id)));
  // 🔴 The id is NOT rewritten: 32 413 live rows are keyed `a…`, and the
  // upsert and the slug lookup both use that string. See canonicalId.
  t('…keeping the id it arrived with, not a rewritten one', pair.features[0].id === 'a246', pair.features[0].id);
  t('…and the polygon, not the line', pair.features[0].geometry.type === 'Polygon', pair.features[0].geometry.type);
  t('…counted, so a run can say how many', pair.collapsed === 1, String(pair.collapsed));

  // Order must not decide the answer.
  const flipped = normalise([camp('a246', 'Polygon'), camp('w123', 'LineString')]);
  t('…whichever order they arrive in', flipped.features[0].geometry.type === 'Polygon', flipped.features[0].geometry.type);

  // 🔴 THE STRAY NODES.
  const strays = normalise([
    camp('n1', 'Point'),
    { id: 'n2', geometry: { type: 'Point' }, properties: { barrier: 'gate' } },
    { id: 'n3', geometry: { type: 'Point' }, properties: { man_made: 'flagpole' } },
  ]);
  t('a gate inside a campsite is not a campsite', strays.features.length === 1, JSON.stringify(strays.features.map((f) => f.id)));
  t('…and they are counted, not silently dropped', strays.notOurs === 2, String(strays.notOurs));

  const caravan = normalise([camp('n9', 'Point', 'caravan_site')]);
  t('a caravan site is ours too', caravan.features.length === 1);
  const hotel = normalise([camp('n9', 'Point', 'hotel')]);
  t('a hotel is not', hotel.features.length === 0);

  // 🔴 Nothing in, nothing out — and that must not look like success to
  // a caller that only checks the exit code.
  const empty = normalise([]);
  t('an empty input gives an empty result, not a crash', empty.features.length === 0);
  t('…and an empty input is not itself an error', verdict(0, 0) === null);

  // 🔴 THE SAFEGUARD ITSELF, which nothing tested until review mutated it
  // to `if (false)` and watched 14/14 stay green.
  t('discarding every feature of a non-empty input is refused', verdict(1684, 0) !== null, String(verdict(1684, 0)));
  t('keeping some is not refused', verdict(1684, 796) === null);
  t('keeping exactly one is not refused', verdict(1, 1) === null);

  let failed = 0;
  for (const [what, cond, detail] of ok) {
    if (!cond) failed++;
    console.log(`${cond ? '✓' : '✗'} ${what}${cond ? '' : `  → ${detail}`}`);
  }
  // 🔴 CAMP-286: counted and named after this file.
  const EXPECTED_CASES = 18;
  if (ok.length !== EXPECTED_CASES) {
    failed += 1;
    console.log(`✗ ${ok.length} cases ran, expected ${EXPECTED_CASES}`);
  }
  console.log(
    failed
      ? `\n::error::normalise-export self-test failed on ${failed} cases`
      : `\n✓ normalise-export self-test: ${ok.length} cases`,
  );
  return failed;
};

// 🔴 CAMP-286: BOTH entry points below the guard, and the guard resolves
// the real path.
//
// `--self-test` sat ABOVE the guard, so importing this module from a
// process whose argv happened to carry it ran the whole suite and called
// `exit()` — the very shape the comment above warns about. And
// `resolve()` only makes argv[1] absolute; it follows no symlink, while
// Node resolves `import.meta.url` through one, so through a link the
// guard said "imported" and nothing ran at all.
const RUN_DIRECTLY = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (RUN_DIRECTLY) {
  const action = chooseAction(argv.slice(2), ['--self-test'], 'normalise-export.mjs', {
    positional: 2,
  });
  if (action.has('--self-test')) exit(SELF_TEST() ? 1 : 0);

  const [, , inPath, outPath] = argv;
  if (!inPath || !outPath) {
    console.error('usage: normalise-export.mjs <in.geojson> <out.geojson>');
    exit(2);
  }
  const doc = JSON.parse(readFileSync(inPath, 'utf8'));
  const before = doc.features?.length ?? 0;
  const { features, notOurs, collapsed } = normalise(doc.features ?? []);

  console.log(`    export had        ${String(before).padStart(7)} features`);
  console.log(`    not campsites     ${String(notOurs).padStart(7)}  (gates, flagpoles, benches inside a site)`);
  console.log(`    duplicate copies  ${String(collapsed).padStart(7)}  (a closed way arriving as line AND area)`);
  console.log(`    kept              ${String(features.length).padStart(7)}`);

  const bad = verdict(before, features.length);
  if (bad) {
    console.error(`::error::${bad}`);
    exit(1);
  }
  writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features }));
}
