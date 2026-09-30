#!/usr/bin/env node
// CAMP-142: prove the rate-limit bypass works BEFORE generating 65 435 pages.
//
// 🔴 This exists because the bypass silently stopped working and it cost
// seven hours. The full story, because the shape of the failure is the
// whole justification for this file:
//
//   The API process was started at 14:52:47 on 27.09.2026.
//   `API_BUILD_TOKEN` was added to `.env` at 15:03:17 — ten minutes later.
//   `ConfigModule` reads `.env` once, at boot, so the running process had
//   never heard of the token. `isExempt()` did exactly what it promises
//   and failed closed.
//
// Nothing said so. The build did not stop; it *degraded*. Every request
// was throttled, a local proxy retried each one with backoff, and pages
// began timing out at sixty seconds. Measured on that build: 1 558
// timeouts, 4 939 pages in fifty minutes, a projected seven hours. After
// a restart, the same build: 0 timeouts, 65 435 pages in about ten
// minutes.
//
// 🔴 The check is EMPIRICAL, not a configuration read. Asserting that
// `API_BUILD_TOKEN` is set would have passed on that very afternoon: the
// variable WAS set, in `.env` and in this process — just not in the one
// answering on port 3001. The only honest question is the one a build
// actually asks: "if I send this token, am I throttled?" So we send it.
//
// 🔴 Bulk route, on purpose. `/spots/map/points` carries BULK_LIMIT (6 a
// minute), the tightest bucket we have, so ten requests is four past the
// edge. A tiny bbox keeps each answer at ~52 bytes: the point is the
// bucket, not the payload.
//
// Runs first in `prebuild`, so a broken bypass costs seconds instead of
// an afternoon.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const TOKEN = process.env.API_BUILD_TOKEN;

// BULK_LIMIT is 6 (apps/api/src/throttle.ts). Four past it is enough to
// be unambiguous and few enough to stay instant.
const ATTEMPTS = 10;
const PROBE = '/spots/map/points?bbox=0,0,0.01,0.01';

const die = (lines) => {
  console.error('\n\u001b[31m' + lines.join('\n') + '\u001b[0m\n');
  process.exit(1);
};

if (!TOKEN) {
  die([
    'The build has no API_BUILD_TOKEN.',
    '',
    'Without it every request is rate-limited, and because getSpot()',
    'returns null rather than throwing, the build EXITS 0 with most of',
    'the site missing. That has happened: 580 campsite pages instead of',
    '9 830.',
    '',
    'Set it from apps/api/.env:  set -a; . apps/api/.env; set +a',
  ]);
}

const statuses = [];
for (let i = 0; i < ATTEMPTS; i++) {
  let res;
  try {
    res = await fetch(API + PROBE, { headers: { 'x-build-token': TOKEN } });
  } catch (e) {
    die([
      `Could not reach the API at ${API} — ${e.message}`,
      '',
      'The build reads every campsite from it. Start it first:',
      '  cd apps/api && npm run build && node dist/main',
    ]);
  }
  statuses.push(res.status);
  // Drain, so a kept-alive socket does not hold the response open.
  await res.arrayBuffer();
}

const throttled = statuses.filter((s) => s === 429).length;

if (throttled > 0) {
  die([
    `The rate-limit bypass is NOT working: ${throttled} of ${ATTEMPTS} probes were throttled.`,
    `  statuses: ${statuses.join(' ')}`,
    '',
    'The token this build holds is not the one the API is checking',
    'against. The usual cause is not the code — it is that the API',
    'process was started BEFORE API_BUILD_TOKEN reached its .env, and',
    'ConfigModule reads .env only at boot.',
    '',
    'Restart the API and try again:',
    '  cd apps/api && npm run build && node dist/main',
    '',
    'Stopping now. Left alone this does not fail the build — it makes it',
    'take about seven hours and drop pages in silence.',
  ]);
}

const bad = statuses.filter((s) => s !== 200);
if (bad.length > 0) {
  die([
    `The API answered ${bad.join(', ')} on ${PROBE}.`,
    'Not a throttling problem — the probe route itself is unhealthy.',
  ]);
}

console.log(
  `build bypass: ${ATTEMPTS}/${ATTEMPTS} probes past a limit of 6 a minute — not throttled`,
);
