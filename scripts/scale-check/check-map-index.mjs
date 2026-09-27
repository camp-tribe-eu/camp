#!/usr/bin/env node
// CAMP-134, defect 6 of six: the map snapshot, 61 521 against a cap of
// 20 000, and a panel that said "0 campsites".
//
//   node scripts/scale-check/check-map-index.mjs
//   node scripts/scale-check/check-map-index.mjs --self-test
//
// 🔴 WHAT CI COULD NOT SEE.
//
// Until CAMP-127 the map was one file: /spots/map/points over the whole
// world, capped at 20 000, and a build that refused a truncated answer.
// The fixture holds 72 campsites, so that request was never capped and
// the guard never spoke. The EU-27 import took the database past the cap
// in one afternoon; the route threw, the map served a 500, and the panel
// under it printed "0 campsites" — a true-looking number over a broken
// request.
//
// The design that replaced it is an index plus one file per region. That
// design has its own invariants, and every one of them is about size:
// how big the index a reader downloads first is, whether the parts add up
// to the whole, and whether a part says the same number as the index that
// promised it. None of them can fail on 72 campsites in 4 regions.
//
// This probe is deliberately NOT a browser and NOT a build. It asks the
// full-scale API the questions the fixture cannot pose. Measured today it
// runs in under two seconds.

import { pathToFileURL } from 'node:url';

/**
 * The index every reader downloads before the map draws anything.
 *
 * The number is the route's own (apps/web/src/app/data/spots/index.json),
 * repeated here on purpose: this probe has to be able to fail when the
 * route is changed to accommodate a bigger index rather than the index
 * being made smaller.
 */
const INDEX_BUDGET_BYTES = 400_000;

/**
 * The cap the deleted whole-world snapshot carried, kept so the rehearsal
 * below is the real thing rather than a story about it.
 */
const WHOLE_WORLD_LIMIT = 20_000;
const WHOLE_WORLD_BBOX = '-180,-85,180,85';

/** The chunk a campsite with no region lands in — see map-chunks.ts. */
const UNPLACED = '_unplaced';

/**
 * Slovenia and Croatia in one box — the two countries CI's fixture is
 * drawn from. Used by the rehearsal to show the same request, the same
 * code and the same cap going quiet on a smaller map.
 */
const FIXTURE_COUNTRIES_BBOX = '13.3,42.3,19.5,46.9';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';

async function api(path) {
  const token = process.env.API_BUILD_TOKEN;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { 'x-build-token': token } : {},
  });
  if (!res.ok) {
    // 🔴 429 gets its own sentence. Without the build token every bulk
    // route answers 429 and a probe that only printed "failed" would send
    // somebody looking for a data bug.
    if (res.status === 429) {
      throw new Error(
        `${path} answered 429. Set API_BUILD_TOKEN from apps/api/.env — ` +
          'the bulk routes are rate-limited and this probe is a bulk caller.',
      );
    }
    throw new Error(`${path} answered ${res.status}`);
  }
  const body = await res.text();
  return { body, json: JSON.parse(body), bytes: Buffer.byteLength(body) };
}

const fail = [];
const note = (ok, message) => {
  console.log(`  ${ok ? '✓' : '✗'} ${message}`);
  if (!ok) fail.push(message);
};

/** A deterministic sample, so two runs compare the same regions. */
export function sample(regions, n) {
  const sorted = [...regions].sort((a, b) =>
    `${a.country}/${a.slug}`.localeCompare(`${b.country}/${b.slug}`),
  );
  const step = Math.max(1, Math.floor(sorted.length / n));
  const out = [];
  for (let i = 0; i < sorted.length && out.length < n; i += step) out.push(sorted[i]);
  // The largest one always, because it is the one that breaks a budget.
  const biggest = sorted.reduce((a, b) => (b.count > a.count ? b : a));
  if (!out.some((r) => r.country === biggest.country && r.slug === biggest.slug)) {
    out.push(biggest);
  }
  return out;
}

async function run() {
  console.log(`api: ${BASE}`);

  const index = await api('/spots/map/regions');
  const regions = index.json;

  note(Array.isArray(regions) && regions.length > 0,
    `the index is a non-empty array (${regions.length} regions)`);

  // 🔴 The scale gate. Below this the rest of the probe proves nothing,
  // and saying so is the difference between a check and a decoration.
  if (regions.length < 100) {
    console.error(
      `\n✗ ${regions.length} regions. This probe exists to ask questions that\n` +
        '  only have answers at scale; run it against the full database, not\n' +
        '  against the CI fixture, or it reports green over nothing.\n',
    );
    process.exit(1);
  }

  note(index.bytes <= INDEX_BUDGET_BYTES,
    `the index is ${(index.bytes / 1000).toFixed(0)} kB, budget ` +
      `${INDEX_BUDGET_BYTES / 1000} kB`);

  const countries = new Set(regions.map((r) => r.country));
  note(countries.size >= 20,
    `it spans ${countries.size} countries`);

  const keys = new Set(regions.map((r) => `${r.country}/${r.slug}`));
  note(keys.size === regions.length,
    `every region has its own address (${keys.size} of ${regions.length})`);

  // 🔴 The numbers must BE numbers before they can be compared.
  //
  // `undefined < undefined` is false, so every comparison below is false
  // and the box check reports "0 are not" over an index with no boxes in
  // it at all. Rename one of these fields in the map service and the
  // guard goes green forever — the same silent-scope failure the
  // dependency guard had.
  const CORNERS = ['lon', 'lat', 'minLon', 'minLat', 'maxLon', 'maxLat'];
  const malformed = regions.filter(
    (r) => !CORNERS.every((k) => Number.isFinite(r[k])),
  );
  note(malformed.length === 0,
    `every region carries all six coordinates (${malformed.length} do not)`);

  const outside = regions.filter(
    (r) =>
      r.lon < r.minLon || r.lon > r.maxLon || r.lat < r.minLat || r.lat > r.maxLat,
  );
  note(outside.length === 0,
    `every region's centre is inside its own box (${outside.length} are not)`);

  // 🔴 The parts must add up to the whole, checked across two independent
  // routes. This is the invariant the old one-file map lost silently: a
  // truncated snapshot is still a valid GeoJSON document, and nothing
  // downstream can tell it from a complete one.
  //
  // The sum splits in two and both halves matter:
  //
  //   800 regions with a real slug   61 422  = /spots/summary.spots
  //    12 `_unplaced` chunks            135  = the campsites with no region
  //   812                            61 557
  //
  // The 135 are the ones this design was nearly written without. They have
  // no region and therefore no region page, and the first cut of the
  // chunking simply left them out of the index — 135 campsites that exist
  // in the database, are served by the API, and appear on no map. CI's
  // fixture cannot pose that question: all 72 of its rows carry a region,
  // so the `_unplaced` branch is dead code there.
  const placed = regions.filter((r) => r.slug !== UNPLACED);
  const unplaced = regions.filter((r) => r.slug === UNPLACED);
  const count = (rs) => rs.reduce((n, r) => n + r.count, 0);
  const summary = (await api('/spots/summary')).json;

  note(count(placed) === summary.spots,
    `the placed chunks promise ${count(placed).toLocaleString('en')} campsites and ` +
      `the API publishes ${Number(summary.spots).toLocaleString('en')}`);
  note(placed.length === summary.regions,
    `${placed.length} placed chunks against ${summary.regions} regions in the API`);
  note(unplaced.length > 0 && count(unplaced) > 0,
    `the campsites with no region are still on the map: ${count(unplaced)} of them ` +
      `in ${unplaced.length} chunks`);

  const promised = count(regions);

  // 🔴 And the number the map is going to show has to be past the point
  // where one file could have carried it. If this ever stops being true
  // the fixture and production have converged and this whole workflow can
  // be retired — which is worth knowing, so it is asserted rather than
  // assumed.
  note(promised > WHOLE_WORLD_LIMIT,
    `the dataset is past the ${WHOLE_WORLD_LIMIT.toLocaleString('en')} a single ` +
      'snapshot could carry, so the chunked design is still the right one');

  // A chunk that disagrees with the index is the "0 campsites" failure in
  // miniature: a number on screen that no file behind it supports.
  const WANT_SAMPLES = 12;
  const chosen = sample(regions, WANT_SAMPLES);
  // 🔴 How many were actually compared, asserted rather than assumed.
  // `sample(regions, 0)` returns exactly one row — `Math.floor(n/0)` is
  // Infinity, the loop never runs, and only the biggest region is
  // appended. The note would then read "✓ 1 sampled chunks each hold
  // exactly what the index promised", which is the shape of a guard
  // whose scope has quietly collapsed.
  note(chosen.length >= WANT_SAMPLES,
    `${chosen.length} chunks chosen to compare, wanted at least ${WANT_SAMPLES}`);
  // 🔴 Together, not one after another.
  //
  // Measured 27.09.2026 on a machine that was also running a full site
  // build: one of these took about 20 s, so twelve in sequence took
  // 4 min 43 s — against under a second on a quiet machine. The probe was
  // not doing more work, it was queueing behind somebody else at the same
  // database, twelve times over. Asking at once costs the API one round
  // of the same queries and takes as long as the slowest.
  const chunks = await Promise.all(
    chosen.map((r) =>
      api(
        `/spots/map/region/${encodeURIComponent(r.country.toLowerCase())}/${encodeURIComponent(r.slug)}`,
      ),
    ),
  );

  let mismatched = 0;
  let biggestChunkBytes = 0;
  for (const [i, chunk] of chunks.entries()) {
    const r = chosen[i];
    biggestChunkBytes = Math.max(biggestChunkBytes, chunk.bytes);
    if (chunk.json.length !== r.count) {
      mismatched++;
      console.log(
        `    ${r.country}/${r.slug}: index says ${r.count}, the chunk has ${chunk.json.length}`,
      );
    }
  }
  note(mismatched === 0,
    `${chosen.length} sampled chunks each hold exactly what the index promised`);
  console.log(
    `    largest sampled chunk: ${(biggestChunkBytes / 1000).toFixed(0)} kB`,
  );

  if (fail.length > 0) {
    console.error(`\n✗ ${fail.length} of the map's scale invariants do not hold\n`);
    process.exit(1);
  }
  console.log('\n✓ the map index and its chunks agree with the API at full scale');
}

/**
 * 🔴 The rehearsal: make the DELETED design's request against live data.
 *
 * `apps/web/src/app/data/spots.geojson/route.ts` asked for the whole
 * world at a limit of 20 000 and threw when the answer came back
 * truncated. What runs here is that REQUEST and that verdict, rewritten
 * in four lines — not the deleted route itself, which is gone. So this
 * proves the data still trips the cap; it does not re-exercise the
 * route's own error path, and the difference is worth stating rather
 * than glossing.
 *
 * It must be truncated now, and it must NOT be truncated over the two
 * countries CI's fixture is drawn from — the same mirror as every other
 * defect on this card.
 */
async function selfTest() {
  let ok = true;

  const wide = await api(
    `/spots/map/points?bbox=${WHOLE_WORLD_BBOX}&limit=${WHOLE_WORLD_LIMIT}`,
  );
  console.log(
    `the deleted whole-world snapshot, at full scale: ${wide.json.markers.length} ` +
      `markers, truncated=${wide.json.truncated}, ${(wide.bytes / 1e6).toFixed(1)} MB`,
  );
  if (!wide.json.truncated) {
    console.error('✗ the whole-world request was not truncated, so the rehearsal proves nothing');
    ok = false;
  } else {
    console.log('  ✓ fires: the build would have stopped here, and did not because CI never asked');
  }

  // 🔴 The mirror. The same code, the same request, the same cap — over
  // the two countries CI's fixture is drawn from. It must go quiet, or
  // this was never a scale defect and the argument for this whole
  // workflow is wrong.
  const small = await api(
    `/spots/map/points?bbox=${FIXTURE_COUNTRIES_BBOX}&limit=${WHOLE_WORLD_LIMIT}`,
  );
  console.log(
    `the same request over Slovenia and Croatia, where the fixture lives: ` +
      `${small.json.markers.length} markers, truncated=${small.json.truncated}`,
  );
  if (small.json.truncated) {
    console.error('✗ even the small map truncates, so the mirror is not a mirror');
    ok = false;
  } else {
    console.log('  ✓ silent — and CI\'s fixture is 72 rows, 0.4% of that cap');
  }

  console.log(
    ok
      ? '\n✓ rehearsed: the cap fires on the live dataset'
      : '\n✗ rehearsal failed',
  );
  return ok;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const job = process.argv.includes('--self-test') ? selfTest() : run();
  job.then(
    (ok) => process.exit(ok === false ? 1 : 0),
    (e) => {
      console.error(`\n✗ ${e.message}`);
      process.exit(1);
    },
  );
}
