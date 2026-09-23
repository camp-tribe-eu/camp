#!/usr/bin/env node
// A test that failed and then passed must not leave the build green.
//
//   node scripts/ci/check-flaky.mjs apps/web/playwright-report/report.json
//   node scripts/ci/check-flaky.mjs --self-test
//
// 🔴 Why this exists, from one day's evidence.
//
// On 23.09.2026 the CI job for CAMP-92 reported success. Inside it, the
// card's own acceptance test — "a deliberately broken page produces a
// record" — had failed on its first attempt and passed on the retry.
// `retries: 1` turned that into a green tick.
//
// The flake was not noise. The listeners were being attached in a React
// effect, so everything thrown before hydration was invisible: a
// hydration mismatch, a chunk that 404s, a polyfill that throws on an
// old browser. The retry hid a real design fault, and the only way it
// was found was a human opening the log and reading it line by line.
// That is not a process; that is luck.
//
// 🔴 Why not simply `retries: 0`. Because some flakes are genuinely the
// environment — a runner that stalls, a port that is slow to bind — and
// a suite with no retries turns those into red builds that everyone
// learns to re-run without reading. Retries are useful. What is not
// useful is retries being SILENT. So the run still retries, and this
// makes the fact loud afterwards: the job goes red, the names are
// printed, and somebody decides whether it was the world or the code.

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

/**
 * Pull every test that passed only after failing.
 *
 * Playwright's JSON report nests suites arbitrarily deep, and a test
 * carries one `results` entry per attempt. `status: 'flaky'` is the
 * field to trust; the attempt count is kept for the message, because
 * "passed on attempt 3" reads very differently from "attempt 2".
 */
export function flaky(report) {
  const found = [];

  const walk = (suite, trail) => {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status !== 'flaky') continue;
        const attempts = (t.results ?? []).length;
        const failedWith = (t.results ?? [])
          .filter((r) => r.status === 'failed' || r.status === 'timedOut')
          .map((r) => r.error?.message?.split('\n')[0] ?? r.status)[0];
        found.push({
          title: [...here, spec.title].filter(Boolean).join(' › '),
          project: t.projectName ?? '',
          attempts,
          failedWith: failedWith ?? 'unknown',
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };

  for (const suite of report.suites ?? []) walk(suite, []);
  return found;
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

  const spec = (title, status, results, projectName = 'chromium-desktop') => ({
    title,
    tests: [{ status, projectName, results }],
  });

  // 🔴 The real shape, reduced: this is what the report looked like for
  // the run that went green over a broken design.
  const theRunThatWentGreen = {
    suites: [
      {
        title: 'error-reporting.spec.ts',
        suites: [
          {
            title: '🔴 a deliberately broken page produces a record',
            specs: [
              spec('an uncaught error reaches the API', 'flaky', [
                { status: 'failed', error: { message: 'the broken page produced no record\n  at x' } },
                { status: 'passed' },
              ]),
            ],
          },
        ],
        specs: [spec('something that simply passed', 'expected', [{ status: 'passed' }])],
      },
    ],
  };

  const got = flaky(theRunThatWentGreen);
  check('the flake that hid a design fault is found', got.length, 1);
  check(
    'and it is named the way a human needs it',
    got[0].title,
    'error-reporting.spec.ts › 🔴 a deliberately broken page produces a record › an uncaught error reaches the API',
  );
  check('with the reason it failed the first time', got[0].failedWith, 'the broken page produced no record');
  check('and how many attempts it took', got[0].attempts, 2);

  check('a clean run reports nothing', flaky({
    suites: [{ title: 'a', specs: [spec('t', 'expected', [{ status: 'passed' }])] }],
  }), []);

  // A test that failed outright is the other job's problem — Playwright
  // already fails the run. Reporting it here too would just be noise.
  check('an outright failure is not reported as flaky', flaky({
    suites: [{ title: 'a', specs: [spec('t', 'unexpected', [{ status: 'failed' }])] }],
  }), []);

  check('a skipped test is not flaky', flaky({
    suites: [{ title: 'a', specs: [spec('t', 'skipped', [{ status: 'skipped' }])] }],
  }), []);

  // A timeout is the commonest flake and must be caught like any other.
  check('a timeout on the first attempt counts', flaky({
    suites: [{ title: 'a', specs: [spec('t', 'flaky', [{ status: 'timedOut' }, { status: 'passed' }])] }],
  })[0].failedWith, 'timedOut');

  check('an empty report is not a crash', flaky({}), []);
  check('deeply nested suites are reached', flaky({
    suites: [{ title: 'a', suites: [{ title: 'b', suites: [{ title: 'c', specs: [spec('t', 'flaky', [{ status: 'failed' }, { status: 'passed' }])] }] }] }],
  })[0].title, 'a › b › c › t');

  console.log(failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed');
  exit(failures ? 1 : 0);
}

if (argv.includes('--self-test')) selfTest();

const path = argv[2];
if (!path) {
  console.error('usage: check-flaky.mjs <playwright report.json>');
  exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  // 🔴 A guard that cannot read its input must fail. A missing report
  // means the run did not finish, or the reporter was switched off —
  // neither of which is "no flakes".
  console.error(`✗ cannot read the Playwright report at ${path}: ${err.message}`);
  exit(1);
}

const found = flaky(report);
if (found.length === 0) {
  console.log('✓ no test needed a retry');
  exit(0);
}

console.error(`✗ ${found.length} test(s) passed only on a retry:\n`);
for (const f of found) {
  console.error(`  ${f.title}`);
  console.error(`    project: ${f.project}, attempts: ${f.attempts}`);
  console.error(`    first failure: ${f.failedWith}\n`);
}
console.error(
  'A retry that goes green is the shape a real fault takes when it is\n' +
    'intermittent. Read the first failure before dismissing it as noise.',
);
exit(1);
