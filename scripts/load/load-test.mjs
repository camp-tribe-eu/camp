#!/usr/bin/env node
// Debt #2 (CAMP-60): find out what the API does under concurrency.
//
//   node scripts/load/load-test.mjs --self-test          # prove the verdict works
//   node scripts/load/load-test.mjs --profile smoke      # what CI runs
//   node scripts/load/load-test.mjs --profile soak       # the real one, on demand
//
// 🔴 No k6 and no Artillery, and not out of stubbornness. k6 is a binary
// to install on every machine and in CI; Artillery is a dependency tree
// on a public repo that already carries 85 advisories across three
// workspaces. What this actually needs is: send N requests at once,
// record how long each took, and fail on a rule. That is 200 lines of
// Node with no imports beyond the standard library, and it can be read
// in full by whoever has to trust its numbers.
//
// 🔴 What is worth loading, measured on 23.09.2026 rather than assumed.
//
// The card was written when the plan was a live API behind the site. It
// is not what we built: the browser fetches `/data/spots.geojson` and
// `/data/search/index.json`, both static files from the CDN, and every call in
// apps/web/src/lib/api.ts happens during `next build` on our own
// machine. So "the site under load" is Cloudflare serving files, which
// is not ours to test and not ours to fix.
//
// What IS ours is the API as it will be exposed the day the server
// exists (CAMP-97/99): the viewport query is the endpoint designed to be
// called from a reader's browser as they pan the map, and it is the one
// that runs PostGIS per request. That is what this loads.
//
// 🔴 Why CI asserts correctness and not speed. A GitHub runner is a
// shared machine with noisy neighbours; a p99 threshold tuned on a
// laptop fails there for reasons that have nothing to do with our code,
// and a load test that cries wolf gets deleted within a month. So the
// smoke profile fails on WRONGNESS — a non-2xx, a dropped connection, a
// body that stopped being valid JSON under concurrency — and treats
// latency as a number to print. The soak profile, run deliberately, is
// where a latency budget means something.

import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv, env, exit } from 'node:process';

// ---------------------------------------------------------------------
// The pure parts. Everything the verdict depends on lives here so the
// self-test can drive it without a server.

/** Percentile from an unsorted list of numbers, nearest-rank. */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export const PROFILES = {
  smoke: {
    concurrency: 20,
    durationMs: 10_000,
    // Deliberately loose. See the note above: this is a ceiling that
    // catches "the API fell over", not a performance budget.
    maxP99Ms: 5_000,
    minRequests: 50,
  },
  soak: {
    concurrency: 50,
    durationMs: 60_000,
    maxP99Ms: 800,
    minRequests: 2_000,
  },
};

/**
 * Decide whether a run passed.
 *
 * 🔴 An empty run FAILS. A load test that sent nothing and reported
 * "0 errors" is the same class of lie as a guard that cannot run
 * reporting success — and it is the likeliest failure mode here,
 * because the commonest reason to send nothing is that the API was not
 * up, which is exactly what we wanted to know.
 */
export function verdict(result, profile) {
  const problems = [];
  if (result.total < profile.minRequests) {
    problems.push(
      `only ${result.total} requests completed, expected at least ${profile.minRequests} — was the API up?`,
    );
  }
  if (result.failed > 0) {
    problems.push(`${result.failed} request(s) did not return 2xx`);
  }
  if (result.errors > 0) {
    problems.push(`${result.errors} connection error(s)`);
  }
  if (result.invalidBodies > 0) {
    problems.push(
      `${result.invalidBodies} response(s) were not the shape the endpoint promises`,
    );
  }
  const p99 = percentile(result.latencies, 99);
  if (p99 > profile.maxP99Ms) {
    problems.push(`p99 ${Math.round(p99)}ms is above the ${profile.maxP99Ms}ms ceiling`);
  }
  return { ok: problems.length === 0, problems, p99 };
}

/**
 * The scenarios, weighted.
 *
 * Each returns a path and a check. The check matters as much as the
 * timing: an API under load that starts answering 200 with an empty body
 * is worse than one that answers slowly, and a timing-only test calls
 * that a pass.
 */
export function scenarios() {
  // Four viewports across the data we hold, so the planner is not
  // answering the same cached question every time. A load test that
  // repeats one query measures the cache, not the query.
  const boxes = [
    '13.3,45.4,14.6,46.3', // Istria
    '14.0,45.8,15.8,46.9', // Slovenia
    '15.5,42.5,18.5,44.5', // Dalmatia
    '13.3,42.5,18.5,46.9', // all of it — the expensive one
  ];
  const list = boxes.map((bbox, i) => ({
    name: `map/points ${['istria', 'slovenia', 'dalmatia', 'everything'][i]}`,
    weight: 3,
    path: `/spots/map/points?bbox=${bbox}&limit=500`,
    // 🔴 The shape was checked against the running API before this was
    // written, and it was not what I guessed: the key is `markers`, not
    // `points`. A check written from memory would have counted every
    // single response as a bad body and the run would have "failed"
    // while the API was perfectly healthy.
    //
    // Non-empty, not merely present. Every one of these viewports holds
    // campsites today (133 / 120 / 262 / 1071, measured 23.09.2026), so
    // an empty array under concurrency is a real failure — and it is the
    // one a timing-only load test reports as a pass.
    check: (body) =>
      Array.isArray(body?.markers) && body.markers.length > 0
        ? null
        : 'no markers',
  }));

  list.push(
    {
      name: 'map/clusters',
      weight: 2,
      path: `/spots/map/clusters?bbox=${boxes[3]}&zoom=6`,
      check: (body) =>
        Array.isArray(body) && body.length > 0 ? null : 'no clusters',
    },
    {
      name: 'summary',
      weight: 1,
      path: '/spots/summary',
      check: (body) =>
        typeof body?.spots === 'number' && body.spots > 0
          ? null
          : 'summary reports no campsites',
    },
    {
      name: 'countries',
      weight: 1,
      path: '/spots/countries',
      check: (body) =>
        Array.isArray(body) && body.length > 0 ? null : 'no countries',
    },
  );
  return list;
}

/** Expand weights into a flat list the workers pick from. */
export function weighted(list) {
  const out = [];
  for (const s of list) for (let i = 0; i < s.weight; i++) out.push(s);
  return out;
}

// ---------------------------------------------------------------------

function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

async function run(base, profile) {
  const pool = weighted(scenarios());
  const result = {
    total: 0,
    failed: 0,
    errors: 0,
    invalidBodies: 0,
    latencies: [],
    byScenario: new Map(),
  };
  const deadline = Date.now() + profile.durationMs;

  const worker = async () => {
    while (Date.now() < deadline) {
      const s = pool[Math.floor(Math.random() * pool.length)];
      const started = performance.now();
      try {
        // 🔴 CAMP-69. With the build token, because this measures how
        // the API behaves under load — not whether the rate limiter
        // works, which rate-limit.spec.ts asks separately and without a
        // token.
        //
        // Without it the answer is meaningless in the worst way: 35 910
        // requests came back 429 in milliseconds, latency looked superb,
        // and the run "proved" the API is fast at refusing. Measured on
        // the first CI run after throttling landed.
        const res = await fetch(base + s.path, {
          headers: process.env.API_BUILD_TOKEN
            ? { 'x-build-token': process.env.API_BUILD_TOKEN }
            : {},
        });
        const ms = performance.now() - started;
        result.total++;
        result.latencies.push(ms);

        const stat = result.byScenario.get(s.name) ?? { n: 0, ms: [] };
        stat.n++;
        stat.ms.push(ms);
        result.byScenario.set(s.name, stat);

        if (!res.ok) {
          result.failed++;
          await res.arrayBuffer();
          continue;
        }
        // 🔴 The body is read and checked, not discarded. Reading it is
        // also what makes the timing honest: a fetch that resolves on
        // headers has not measured the query that produced the body.
        let body = null;
        try {
          body = await res.json();
        } catch {
          result.invalidBodies++;
          continue;
        }
        if (s.check(body)) result.invalidBodies++;
      } catch {
        result.total++;
        result.errors++;
      }
    }
  };

  await Promise.all(Array.from({ length: profile.concurrency }, worker));
  return result;
}

function report(result, profile, v) {
  const p = (n) => `${Math.round(percentile(result.latencies, n))}ms`;
  console.log('');
  console.log(`requests   ${result.total}`);
  console.log(`failed     ${result.failed}  errors ${result.errors}  bad bodies ${result.invalidBodies}`);
  console.log(`latency    p50 ${p(50)}   p90 ${p(90)}   p99 ${p(99)}`);
  console.log(
    `throughput ${Math.round((result.total / profile.durationMs) * 1000)} req/s at ${profile.concurrency} concurrent`,
  );
  console.log('');
  // Tolerant of a missing map: this function has already killed one CI
  // step after the run it was reporting on had passed, and a reporter
  // that can throw turns a green result into a red build.
  for (const [name, stat] of [...(result.byScenario ?? new Map())].sort()) {
    console.log(
      `  ${name.padEnd(28)} ${String(stat.n).padStart(5)}  p99 ${Math.round(percentile(stat.ms, 99))}ms`,
    );
  }

  // 🔴 `appendFileSync` is imported at the top, not require()d here.
  //
  // It was a lazy `require('node:fs')` and it only ever ran when
  // GITHUB_STEP_SUMMARY was set — that is, only in CI, never once on a
  // laptop. Node refuses a file that mixes require() with top-level
  // await (ERR_AMBIGUOUS_MODULE_SYNTAX), so the whole step died AFTER
  // reporting a perfectly healthy run. A branch that only executes in
  // CI is a branch nothing tests, which is why the self-test below now
  // drives this one too.
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### Load test\n\n- ${result.total} requests, ${result.failed} non-2xx, ${result.errors} connection errors\n- p50 ${p(50)}, p90 ${p(90)}, p99 ${p(99)}\n`,
    );
  }

  console.log('');
  if (v.ok) {
    console.log('✓ the API held up');
  } else {
    for (const problem of v.problems) console.error(`✗ ${problem}`);
  }
}

// ---------------------------------------------------------------------

function selfTest() {
  let failures = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.error(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
      failures++;
    } else console.log(`  ✓ ${name}`);
  };

  check('percentile of a known list', percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  check('p50 of a known list', percentile([10, 20, 30, 40], 50), 20);
  check('percentile of nothing is zero, not a crash', percentile([], 99), 0);
  check('percentile does not mutate its input', (() => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    return xs;
  })(), [3, 1, 2]);

  const clean = {
    total: 1000,
    failed: 0,
    errors: 0,
    invalidBodies: 0,
    latencies: Array(1000).fill(50),
    byScenario: new Map([['map/points istria', { n: 1000, ms: Array(1000).fill(50) }]]),
  };
  const smoke = PROFILES.smoke;

  check('a clean run passes', verdict(clean, smoke).ok, true);

  // 🔴 The case this whole file exists to avoid reporting green.
  check(
    'a run that sent nothing FAILS rather than reporting no errors',
    verdict({ ...clean, total: 0, latencies: [] }, smoke).problems,
    ['only 0 requests completed, expected at least 50 — was the API up?'],
  );

  check(
    'one non-2xx fails the run',
    verdict({ ...clean, failed: 1 }, smoke).ok,
    false,
  );
  check(
    'a dropped connection fails the run',
    verdict({ ...clean, errors: 1 }, smoke).ok,
    false,
  );
  // 🔴 200 with the wrong body is the failure a timing-only load test
  // calls a pass, which is why the scenarios carry a check.
  check(
    'a 200 with the wrong body fails the run',
    verdict({ ...clean, invalidBodies: 1 }, smoke).ok,
    false,
  );
  check(
    'latency above the ceiling fails the run',
    verdict({ ...clean, latencies: Array(1000).fill(9_999) }, smoke).ok,
    false,
  );
  check(
    'latency just under the ceiling passes',
    verdict({ ...clean, latencies: Array(1000).fill(smoke.maxP99Ms - 1) }, smoke).ok,
    true,
  );

  // The scenarios must actually exercise different queries — a load
  // test that repeats one bbox measures the cache, not the database.
  const paths = new Set(scenarios().map((s) => s.path));
  check('every scenario asks a different question', paths.size, scenarios().length);
  check('the heavy viewport is included', scenarios().some((s) => s.name.includes('everything')), true);
  check('weights expand', weighted([{ weight: 2, name: 'a' }, { weight: 1, name: 'b' }]).length, 3);

  // 🔴 The step-summary branch, driven on purpose. It is the one piece
  // of this file that runs only under GITHUB_STEP_SUMMARY, and the first
  // version of it crashed the whole step in CI while the load test
  // itself had just passed. Untested branches are where that lives.
  {
    const tmp = join(tmpdir(), `camp-load-summary-${process.pid}`);
    const previous = env.GITHUB_STEP_SUMMARY;
    env.GITHUB_STEP_SUMMARY = tmp;
    try {
      report(clean, smoke, verdict(clean, smoke));
      const written = readFileSync(tmp, 'utf8');
      check('the CI step summary is written, not crashed on', written.includes('Load test'), true);
      check('and it carries the numbers', written.includes('1000 requests'), true);
    } finally {
      if (previous === undefined) delete env.GITHUB_STEP_SUMMARY;
      else env.GITHUB_STEP_SUMMARY = previous;
      rmSync(tmp, { force: true });
    }
  }

  console.log(failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed');
  exit(failures ? 1 : 0);
}

if (argv.includes('--self-test')) selfTest();

const base = arg('base', env.API_BASE_URL ?? 'http://localhost:3001');
const name = arg('profile', 'smoke');
const profile = PROFILES[name];
if (!profile) {
  console.error(`✗ unknown profile "${name}" — one of: ${Object.keys(PROFILES).join(', ')}`);
  exit(1);
}

console.log(`load: ${name} — ${profile.concurrency} concurrent for ${profile.durationMs / 1000}s against ${base}`);
const result = await run(base, profile);
const v = verdict(result, profile);
report(result, profile, v);
exit(v.ok ? 0 : 1);
