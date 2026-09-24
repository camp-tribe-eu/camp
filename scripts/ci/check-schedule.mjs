#!/usr/bin/env node
// Silence watchdog: tell us when a scheduled job has simply stopped.
//
//   node scripts/ci/check-schedule.mjs             # check (needs gh)
//   node scripts/ci/check-schedule.mjs --self-test # prove it works
//
// 🔴 Why this exists, measured rather than imagined.
//
// `osm-weekly.yml` was written on 21.09.2026, merged to main at 17:33 —
// after that Monday's 04:00 slot — and was then unparseable for two days.
// On 23.09.2026 the GitHub API answered this question:
//
//   gh run list --workflow=osm-weekly.yml --event=schedule
//   → (nothing)
//
// Zero scheduled runs, ever. Meanwhile the Actions tab showed the
// workflow as "active" and the repository looked entirely healthy. The
// only visible symptom would have been campsite data quietly going stale,
// which nobody can see by looking.
//
// 🔴 Why the existing failure alert does not cover this. That alert is a
// job inside the weekly workflow with `if: failure()`. It fires when a
// run fails. It cannot fire when there is no run — which is the failure
// mode we actually had, and the one a cron has by default: crons stop
// silently. A watchdog that lives inside the thing it watches is not a
// watchdog.
//
// 🔴 What this still does NOT cover, stated rather than papered over.
// GitHub disables scheduled workflows in a repository with 60 days of no
// activity, and it would disable this one alongside the job it watches.
// We commit most days so it is not near, but the honest shape of the
// guarantee is: this catches a cron that broke, not a repository that
// was abandoned. Nothing inside GitHub can catch the second, because the
// thing that would report it is the thing that stopped.

import { execFileSync } from 'node:child_process';

const DAY_MS = 86_400_000;

/**
 * What we watch, and how long silence is allowed to last.
 *
 * `everyDays` is the schedule itself; `graceDays` covers a run that
 * started late or a week where GitHub was busy — a watchdog that fires
 * on the first late minute gets muted, and a muted watchdog is worse
 * than none. The sum is the real deadline.
 */
export const WATCHED = [
  {
    workflow: 'osm-weekly.yml',
    everyDays: 7,
    graceDays: 1,
    why: 'campsite data stops being refreshed: closures, new sites and tag changes never arrive, and nothing on the site looks wrong',
  },
  {
    // CAMP-58. 🔴 The card asks for an alarm on the ABSENCE of a backup
    // check, not only on its failure — and this is that alarm, for the
    // same reason the one above exists: a failing job shouts, a job that
    // stopped running says nothing at all.
    //
    // The consequence here is worse than stale campsite data. Nothing
    // about the site looks different when the restore rehearsal stops;
    // the backups keep being written and keep looking fine, and the fact
    // that nobody has proved they can be read back is discovered on the
    // one day it matters.
    workflow: 'backup-verify.yml',
    everyDays: 1,
    graceDays: 1,
    why: 'nobody is checking that the backups can be restored: they keep being written, they keep looking fine, and whether they can be read back is unknown until the day it is the only copy',
  },
];

/**
 * Decide, from the runs GitHub reports, whether anything has gone quiet.
 *
 * Pure on purpose — `runsByWorkflow` is data, so the self-test can drive
 * every branch without the network, and the check that runs in CI and
 * the check that is tested are the same code.
 *
 * @param {Array<{workflow: string, everyDays: number, graceDays: number, why: string}>} watched
 * @param {Record<string, Array<{conclusion: string, createdAt: string}>>} runsByWorkflow
 * @param {Date} now
 */
export function evaluate(watched, runsByWorkflow, now) {
  const problems = [];
  const notes = [];

  for (const w of watched) {
    const maxDays = w.everyDays + w.graceDays;
    const runs = runsByWorkflow[w.workflow] ?? [];

    // 🔴 Only a SUCCESSFUL run counts as the job having happened. A
    // workflow that fails every Monday is running on schedule and
    // producing nothing, and "it ran" is not the question this guard
    // asks — "did the data arrive" is.
    const good = runs
      .filter((r) => r.conclusion === 'success')
      .map((r) => new Date(r.createdAt))
      .filter((d) => !Number.isNaN(d.getTime()))
      // A run stamped in the future is a clock or an API oddity, not
      // proof of freshness. Clamp rather than trust it, so skew can
      // never silence the guard.
      .map((d) => (d > now ? now : d))
      .sort((a, b) => b - a);

    if (good.length === 0) {
      problems.push({
        workflow: w.workflow,
        kind: runs.length === 0 ? 'never-ran' : 'never-succeeded',
        days: null,
        maxDays,
        why: w.why,
      });
      continue;
    }

    const last = good[0];
    const days = (now - last) / DAY_MS;
    if (days > maxDays) {
      problems.push({
        workflow: w.workflow,
        kind: 'overdue',
        days: Math.floor(days),
        maxDays,
        lastAt: last.toISOString(),
        why: w.why,
      });
    } else {
      notes.push({
        workflow: w.workflow,
        text: `last succeeded ${days < 1 ? 'today' : `${Math.floor(days)}d ago`} (allowed ${maxDays}d)`,
      });
    }
  }

  return { problems, notes };
}

/** Render one problem the way a human reading an issue needs it. */
export function describe(p) {
  const head =
    p.kind === 'never-ran'
      ? `\`${p.workflow}\` has never run on schedule.`
      : p.kind === 'never-succeeded'
        ? `\`${p.workflow}\` has run but has never succeeded.`
        : `\`${p.workflow}\` last succeeded ${p.days} days ago (allowed ${p.maxDays}).`;
  return `${head}\n\nWhile this is quiet: ${p.why}.`;
}

// ---------------------------------------------------------------------

function selfTest() {
  let failures = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.error(
        `  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`,
      );
      failures++;
    } else {
      console.log(`  ✓ ${name}`);
    }
  };

  const now = new Date('2026-09-23T12:00:00Z');
  const ago = (days) => new Date(now - days * DAY_MS).toISOString();
  const one = [{ workflow: 'w', everyDays: 7, graceDays: 1, why: 'reason' }];
  const kinds = (r) => r.problems.map((p) => p.kind);
  const ok = (runs) => kinds(evaluate(one, { w: runs }, now));

  // — the case this file was written for ————————————————————————
  check('a workflow that has never run is reported', ok([]), ['never-ran']);

  check(
    'runs that all failed are silence, not health',
    ok([
      { conclusion: 'failure', createdAt: ago(1) },
      { conclusion: 'failure', createdAt: ago(8) },
    ]),
    ['never-succeeded'],
  );

  check(
    'a successful run yesterday is fine',
    ok([{ conclusion: 'success', createdAt: ago(1) }]),
    [],
  );

  check(
    'nine days of silence is reported',
    ok([{ conclusion: 'success', createdAt: ago(9) }]),
    ['overdue'],
  );

  // — the boundary, both sides ————————————————————————————————
  check(
    'exactly at the deadline is not yet overdue',
    ok([{ conclusion: 'success', createdAt: ago(8) }]),
    [],
  );
  check(
    'a minute past the deadline is overdue',
    ok([
      {
        conclusion: 'success',
        createdAt: new Date(now - 8 * DAY_MS - 60_000).toISOString(),
      },
    ]),
    ['overdue'],
  );

  // — the newest success is what counts, not the first in the list ———
  check(
    'an old success does not hide behind a newer failure',
    ok([
      { conclusion: 'failure', createdAt: ago(0) },
      { conclusion: 'success', createdAt: ago(20) },
    ]),
    ['overdue'],
  );
  check(
    'a recent success survives an older one being ancient',
    ok([
      { conclusion: 'success', createdAt: ago(30) },
      { conclusion: 'success', createdAt: ago(2) },
    ]),
    [],
  );

  // — a manual run is still a run: the data arrived ————————————————
  check(
    'a successful manual run counts',
    ok([{ conclusion: 'success', createdAt: ago(2) }]),
    [],
  );

  // — skew and junk must not silence the guard ——————————————————
  check(
    'a run stamped in the future is clamped, not trusted',
    ok([
      {
        conclusion: 'success',
        createdAt: new Date(+now + 400 * DAY_MS).toISOString(),
      },
    ]),
    [],
  );
  check(
    'an unparseable date is ignored rather than crashing',
    ok([{ conclusion: 'success', createdAt: 'not a date' }]),
    ['never-succeeded'],
  );

  // — the report a human will read ————————————————————————————
  check(
    'the days reported are the days elapsed',
    evaluate(one, { w: [{ conclusion: 'success', createdAt: ago(12) }] }, now)
      .problems[0].days,
    12,
  );
  check(
    'a healthy workflow still says when it last ran',
    evaluate(one, { w: [{ conclusion: 'success', createdAt: ago(3) }] }, now)
      .notes[0].text,
    'last succeeded 3d ago (allowed 8d)',
  );

  // — the real configuration is sane ——————————————————————————
  check(
    'every watched workflow allows more than its own interval',
    WATCHED.every((w) => w.graceDays > 0 && w.everyDays > 0),
    true,
  );

  console.log(
    failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed',
  );
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------------

if (process.argv.includes('--self-test')) selfTest();

/** Ask GitHub for the recent runs of one workflow. */
function fetchRuns(workflow) {
  const raw = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--workflow',
      workflow,
      '--limit',
      '30',
      '--json',
      'conclusion,createdAt',
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw);
}

const runsByWorkflow = {};
for (const w of WATCHED) {
  try {
    runsByWorkflow[w.workflow] = fetchRuns(w.workflow);
  } catch (err) {
    // 🔴 A guard that cannot run must fail, not pass. If the API is
    // unreachable we do not know whether the job is quiet, and "we do
    // not know" is not "everything is fine".
    console.error(`✗ could not ask GitHub about ${w.workflow}: ${err.message}`);
    process.exit(1);
  }
}

const { problems, notes } = evaluate(WATCHED, runsByWorkflow, new Date());

for (const n of notes) console.log(`✓ ${n.workflow}: ${n.text}`);

if (problems.length === 0) {
  console.log('\n✓ every scheduled job has run recently');
  process.exit(0);
}

for (const p of problems) console.error(`\n✗ ${describe(p)}`);

// The workflow reads this to decide whether to open an issue.
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  const body = problems.map(describe).join('\n\n');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `quiet=true\nbody<<CAMPEOF\n${body}\nCAMPEOF\n`,
  );
}
process.exit(1);
