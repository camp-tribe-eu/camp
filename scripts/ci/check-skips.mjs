#!/usr/bin/env node
// A test that declined to run must not look like a test that passed.
//
//   node scripts/ci/check-skips.mjs apps/web/playwright-report/report.json --max 0
//   node scripts/ci/check-skips.mjs --self-test
//
// 🔴 WHY THIS EXISTS, and why it is a sibling of check-flaky.mjs.
//
// check-flaky.mjs was written because `retries: 1` lets a test fail and
// then pass while the job stays green. This is the same failure one door
// along: a SKIPPED test is green too, and the summary line everybody
// reads — "295 passed" — does not mention it.
//
// Measured on this repository, 27.09.2026:
//
//   npx playwright test --project=unit   →  295 passed, 5 skipped
//
// All five are `ranking-quality.spec.ts`, and they skip because the live
// search index is not cached at the path the file defaults to. CI does
// not set RANKING_INDEX, so on CI those five have never run — including
// guards written specifically to keep a hand-maintained lookup table in
// step with its expectations. Green, and nothing checked.
//
// That is the seventh instance of the defect CAMP-134 is about, with a
// twist worth naming: the other six were "the fixture is too small to
// show it". This one is "the test declined to run at all, anywhere".
//
// 🔴 The same shape reached INSIDE the CAMP-134 work while it was being
// written. tests/scale used `test.skip` when a browser had no WebGL2 —
// five of six map tests would have become silent passes on a runner with
// a changed driver, while the runner still printed "✓ every scale check
// passed". That is why the scale suite now fails instead of skipping,
// and why this guard exists to hold it to that.

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Every test the run declined to execute.
 *
 * Playwright reports two things that both mean "did not run", and only
 * counting one of them would be its own blind spot:
 *
 *   'skipped'  — test.skip(), or a describe-level skip
 *   'expected' with every result 'skipped' — a test annotated `fixme`
 *
 * The reason lives on the annotation when there is one, so the message
 * can say WHY rather than only which.
 */
export function skipped(report) {
  const found = [];

  const walk = (suite, trail) => {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const didNotRun =
          t.status === 'skipped' ||
          (results.length > 0 && results.every((r) => r.status === 'skipped'));
        if (!didNotRun) continue;
        const why = (t.annotations ?? []).find(
          (a) => a.type === 'skip' || a.type === 'fixme',
        );
        found.push({
          title: [...here, spec.title].filter(Boolean).join(' › '),
          project: t.projectName ?? '',
          file: spec.file ?? '',
          why: why?.description ?? '(no reason given)',
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };

  for (const suite of report.suites ?? []) walk(suite, []);
  return found;
}

/**
 * 🔴 A report with no tests in it is a failed run, not a clean one.
 *
 * Without this, pointing the guard at an empty or truncated report — the
 * exact thing that happens when a suite crashes before it starts — gives
 * "0 skipped, ✓". This guard's whole subject is results that are absent
 * and look fine.
 */
export function countTests(report) {
  let n = 0;
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) n += (spec.tests ?? []).length;
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return n;
}

/** Every spec file the report contains, for `--require`. */
export function filesInReport(report) {
  const files = new Set();
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) if (spec.file) files.add(spec.file);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return [...files];
}

/**
 * The decision, as a pure function.
 *
 * 🔴 It lives here rather than inline in the CLI because the first
 * version's `--self-test` drove the WALKER and never the verdict, and
 * review demonstrated two one-token mutations that survived it:
 * `found.length > max + 1` let one skip through at a budget of zero, and
 * `total < 0` made an empty report print "✓ every test ran". Both are
 * this file's own subject surviving this file's own rehearsal, while the
 * CI step calling it is titled "still catches a test that did not run" —
 * a claim about the verdict.
 *
 * @returns {{ok: boolean, errors: string[]}}
 */
export function verdict({ total, found, max, required = [], files = [] }) {
  const errors = [];

  // 🔴 A run that executed nothing reports zero skips.
  if (total === 0) {
    errors.push(
      'the report contains no tests at all. A run that executed nothing ' +
        'reports zero skips, which is the kind of clean result this check ' +
        'exists to disbelieve.',
    );
  }

  // 🔴 `--require`, and this is the hole review reproduced on tape.
  //
  // It took the real 300-test report, deleted ranking-quality.spec.ts
  // from it, and got: "295 tests, 0 of them skipped ✓ every test ran",
  // exit 0. A budget of zero cannot tell "nothing declined" from
  // "nothing was there to decline" — so a rename, a move out of testDir,
  // a testIgnore, or a grep that stops matching takes the five tests
  // this whole mechanism exists to run, and leaves a tick behind.
  //
  // Matched against the spec FILE, and it names what went missing rather
  // than quoting a count somebody has to maintain.
  for (const want of required) {
    if (!files.some((f) => f.includes(want))) {
      errors.push(
        `no test from \`${want}\` is in this report. It was required, so ` +
          'its absence is a failure rather than a smaller run.',
      );
    }
  }

  if (found.length > max) {
    errors.push(`${found.length} test(s) did not run, against a budget of ${max}`);
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------

function selfTest() {
  let failures = 0;
  const check = (name, ok) => {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) failures++;
  };

  const spec = (title, test) => ({ title, file: 'x.spec.ts', tests: [test] });

  // The real shape, reduced: this is what the unit run looks like today.
  const report = {
    suites: [
      {
        title: 'ranking-quality.spec.ts',
        suites: [
          {
            title: 'ranking quality, measured on the live index',
            specs: [
              spec('a two-word query is not decided by the common word', {
                status: 'skipped',
                projectName: 'unit',
                annotations: [{ type: 'skip', description: 'no index cached at /tmp/x.json' }],
                results: [{ status: 'skipped' }],
              }),
              spec('a one-word place query still finds that place', {
                status: 'expected',
                projectName: 'unit',
                annotations: [],
                results: [{ status: 'passed' }],
              }),
            ],
          },
        ],
      },
    ],
  };

  const out = skipped(report);
  check('a skipped test is found', out.length === 1);
  check('and it carries the reason', out[0]?.why.includes('no index cached'));
  check('a passing test is not', !out.some((s) => s.title.includes('one-word')));

  // 🔴 The case the guard exists for: `expected` whose only result was
  // skipped. Playwright reports a `fixme` this way, and counting only
  // `status === 'skipped'` would walk straight past it.
  const fixmeOnly = {
    suites: [
      {
        title: 'x',
        specs: [
          spec('annotated fixme', {
            status: 'expected',
            projectName: 'unit',
            annotations: [{ type: 'fixme', description: 'broken since Tuesday' }],
            results: [{ status: 'skipped' }],
          }),
        ],
      },
    ],
  };
  check('a fixme is a test that did not run', skipped(fixmeOnly).length === 1);
  check('and it says why', skipped(fixmeOnly)[0].why === 'broken since Tuesday');

  check('an empty report has no skips', skipped({ suites: [] }).length === 0);
  check('…and no tests either, which is the point', countTests({ suites: [] }) === 0);
  check('a real report counts its tests', countTests(report) === 2);

  // Deep nesting, because the real reports nest per file and per describe.
  const deep = {
    suites: [
      { title: 'a', suites: [{ title: 'b', suites: [{ title: 'c', specs: [
        spec('buried', {
          status: 'skipped', projectName: 'unit',
          annotations: [{ type: 'skip', description: 'deep' }],
          results: [{ status: 'skipped' }],
        }),
      ] }] }] },
    ],
  };
  check('a skip nested three deep is still found', skipped(deep).length === 1);
  check('and its title carries the trail',
    skipped(deep)[0].title === 'a › b › c › buried');

  // ── the VERDICT, which the first version of this file never drove ──
  //
  // 🔴 Everything above exercises the walker. Review demonstrated two
  // one-token mutations that survived exactly that: `found.length > max`
  // → `> max + 1` let one skip through at a budget of zero, and
  // `total === 0` → `total < 0` made an empty report print a tick. Both
  // are this file's own subject surviving this file's own rehearsal.
  const one = [{ title: 't', project: 'unit', file: 'a.spec.ts', why: 'x' }];

  check('a skip over budget is refused',
    verdict({ total: 10, found: one, max: 0 }).ok === false);
  check('…and exactly at budget is allowed',
    verdict({ total: 10, found: one, max: 1 }).ok === true);
  check('…and one past it is not',
    verdict({ total: 10, found: [...one, ...one], max: 1 }).ok === false);
  check('a clean run passes',
    verdict({ total: 10, found: [], max: 0 }).ok === true);

  check('🔴 an empty report is refused however clean it looks',
    verdict({ total: 0, found: [], max: 0 }).ok === false);
  check('…and says so in words',
    verdict({ total: 0, found: [], max: 0 }).errors.join(' ').includes('no tests at all'));

  // 🔴 The hole review reproduced: a report with 295 tests, none skipped,
  // and the five that matter simply absent. A budget alone cannot tell
  // "nothing declined" from "nothing was there to decline".
  const absent = verdict({
    total: 295,
    found: [],
    max: 0,
    required: ['ranking-quality.spec.ts'],
    files: ['search.spec.ts', 'i18n.spec.ts'],
  });
  check('🔴 a required file missing from the report is a failure',
    absent.ok === false);
  check('…and the message names the file',
    absent.errors.join(' ').includes('ranking-quality.spec.ts'));
  check('…while a report that contains it passes',
    verdict({
      total: 300, found: [], max: 0,
      required: ['ranking-quality.spec.ts'],
      files: ['../unit/ranking-quality.spec.ts'],
    }).ok === true);
  check('every required file is checked, not just the first',
    verdict({
      total: 300, found: [], max: 0,
      required: ['a.spec.ts', 'b.spec.ts'],
      files: ['a.spec.ts'],
    }).ok === false);

  check('filesInReport lists the spec files', (() => {
    const f = filesInReport(report);
    return f.length === 1 && f[0] === 'x.spec.ts';
  })());

  console.log(failures === 0 ? '\n✓ self-test passed' : `\n✗ ${failures} failed`);
  return failures === 0;
}

// ---------------------------------------------------------------------

// 🔴 Nothing below runs on import.
//
// `skipped`, `countTests` and `verdict` are exported so they can be
// driven from a test, and review found that importing this file ran the
// CLI instead: `await import(…)` printed `usage:` and exited 2. A module
// whose exports cannot be imported has exports in name only. The sibling
// scripts on this card already do this; this one had copied the older
// check-flaky.mjs, which has the same gap.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main();

function main() {
  if (argv.includes('--self-test')) {
    exit(selfTest() ? 0 : 1);
  }

  const path = argv[2];
  if (!path || path.startsWith('--')) {
    console.error(
      'usage: check-skips.mjs <report.json> [--max N] [--require <file substring>]…',
    );
    exit(2);
  }

  const maxArg = argv.indexOf('--max');
  const max = maxArg >= 0 ? Number(argv[maxArg + 1]) : 0;
  if (!Number.isInteger(max) || max < 0) {
    console.error(`--max must be a whole number, got ${argv[maxArg + 1]}`);
    exit(2);
  }

  const required = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--require') continue;
    const want = argv[i + 1];
    if (!want || want.startsWith('--')) {
      console.error('--require needs a file substring');
      exit(2);
    }
    required.push(want);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`✗ cannot read the Playwright report at ${path}: ${e.message}`);
    exit(1);
  }

  const total = countTests(report);
  const found = skipped(report);
  const files = filesInReport(report);
  console.log(`${total} tests, ${found.length} of them skipped (budget ${max})`);

  const { ok, errors } = verdict({ total, found, max, required, files });
  if (ok) {
    console.log(
      found.length === 0
        ? '✓ every test ran'
        : `✓ ${found.length} skipped, within the budget`,
    );
    return;
  }

  console.error('');
  for (const e of errors) console.error(`✗ ${e}`);
  if (found.length > max) {
    console.error('');
    for (const s of found) {
      console.error(`   [${s.project}] ${s.title}`);
      console.error(`       ${s.why}`);
    }
    console.error(
      '\nA skipped test is green, and the summary line says "passed" and a\n' +
        'number that does not include it. If the condition is real, the fix is\n' +
        'to give the run what it needs — not to let the suite report success\n' +
        'over work it declined to do.\n',
    );
  }
  exit(1);
}
