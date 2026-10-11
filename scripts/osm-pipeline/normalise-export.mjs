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

import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** The tags that make a feature one of ours. */
export const WANTED = ['camp_site', 'caravan_site'];

/**
 * libosmium's area id back to the object it was built from.
 *
 * 🔴 `a` → `w` is NOT a string substitution, and assuming it was cost me
 * an hour: areas are numbered `way × 2` and `relation × 2 + 1`, so
 * `a132953274` is way 66476637, not way 132953274.
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
    const id = canonicalId(f.id);
    const seen = kept.get(id);
    if (!seen) {
      kept.set(id, { ...f, id });
      continue;
    }
    collapsed += 1;
    if (rank(f) > rank(seen)) kept.set(id, { ...f, id });
  }

  return { features: [...kept.values()], notOurs, collapsed };
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
  t('…keeping the id of the real object', pair.features[0].id === 'w123', pair.features[0].id);
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

  let failed = 0;
  for (const [what, cond, detail] of ok) {
    if (!cond) failed++;
    console.log(`${cond ? '✓' : '✗'} ${what}${cond ? '' : `  → ${detail}`}`);
  }
  console.log(failed ? `\n::error::self-test failed on ${failed} cases` : `\n✓ self-test passed: ${ok.length} cases`);
  return failed;
};

if (argv.includes('--self-test')) exit(SELF_TEST() ? 1 : 0);

const RUN_DIRECTLY = argv[1] && fileURLToPath(import.meta.url) === resolve(argv[1]);
if (RUN_DIRECTLY) {
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

  // 🔴 Everything thrown away is a failure, not a filter that worked.
  if (before > 0 && features.length === 0) {
    console.error('::error::every feature was discarded — the tag test is wrong, not the data');
    exit(1);
  }
  writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features }));
}
