// CAMP-440: a source that is down is not a collector that is broken.
//
// Measured 04.11.2026: water.discomap.eea.europa.eu answered HTTP 500 on
// the root of /arcgis/rest/services — every layer with it — while the
// EEA's air server next door answered 200. The import died in a second
// with a stack trace, OnFailure wrote its marker, and the owner got a
// letter about a server he does not run. An alarm that rings about the
// unchangeable teaches its reader not to read alarms.
//
// 🔴 TWO KINDS OF FAILURE, TOLD APART BY TYPE, NEVER BY MESSAGE TEXT
// (the pattern is air/import.ts, `RasterNotAdvancing`). A 5xx, a 429 or
// an unreachable host that survives every retry is `UpstreamUnavailable`.
// Everything else — a 4xx (the layer moved: ours to fix), an ArcGIS
// error object inside a 200, a body that is not JSON, a short read, a
// bug in our own parsing — stays a plain Error and fails the unit as
// loudly as it always did. A plain Error carrying the same words fails
// too; only what we deliberately named is tolerated.
//
// 🔴 TOLERATED IS NOT MUTED. bathing_waters holds 22 010 rows on a
// 365-day budget (the EEA classifies once a year), so the freshness
// sentry stays green through a YEAR of failed runs; dropping the exit 1
// would leave this collector watched by nobody, which is worse than the
// letter. Instead the run keeps a streak of consecutive upstream failures
// in $STATE_DIRECTORY and exits non-zero on every ESCALATE_EVERY-th one:
// a one-off outage costs no letter, an outage that lasts gets one per
// three failed Wednesdays, and a success wipes the streak.
//
// What we pay: an outage that is secretly ours — a renamed service that
// still answers 500 rather than 404 — is learnt on the third Wednesday,
// fifteen days in, instead of the first. What the reader pays: nothing;
// the table keeps serving the last season, which stays valid for 365
// days. What we refuse to pay: silence. Without a STATE_DIRECTORY there
// is nowhere to count, and the run fails the unit exactly as before —
// the fallback is loud, not quiet.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The source did not answer, or answered that it is broken. Not our bug. */
export class UpstreamUnavailable extends Error {}

/**
 * Whether this failure has to fail the unit.
 *
 * 🔴 Decided by TYPE. Matching on words would let a rephrased message
 * quietly bring the weekly letters back — or, worse, let a coincidence
 * of words in a real bug swallow that bug.
 */
export const failsTheUnit = (err: unknown): boolean =>
  !(err instanceof UpstreamUnavailable);

/** Which HTTP answers are the source's problem rather than ours. */
export function isUpstreamStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Every how-many-th consecutive upstream failure fails the unit.
 *
 * The timer is weekly (camptribe-bathing-waters.timer), so 3 means the
 * first letter on the third failed Wednesday, then one per three more.
 */
export const ESCALATE_EVERY = 3;

export interface UpstreamVerdict {
  failUnit: boolean;
  say: string;
}

/** Pure: given the streak INCLUDING this run, what to do. */
export function upstreamVerdict(
  streak: number,
  every = ESCALATE_EVERY,
): UpstreamVerdict {
  if (!Number.isInteger(streak) || streak < 1) {
    throw new Error(`a streak is a count of failed runs, not ${streak}`);
  }
  const failUnit = streak % every === 0;
  const left = every - (streak % every);
  return {
    failUnit,
    say: failUnit
      ? `${streak} upstream failures in a row — failing the unit so that somebody looks ` +
        `(one in every ${every}; a success resets the count)`
      : `${streak} upstream failure(s) in a row — NOT failing the unit; ` +
        `${left} more and it will (one in every ${every}; a success resets the count)`,
  };
}

/**
 * The first directory systemd hands us in STATE_DIRECTORY, or null.
 *
 * systemd joins several with ':' when a unit declares several; ours
 * declares one. Nothing else in this importer reads that variable.
 */
export function stateDirectory(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.STATE_DIRECTORY;
  if (!raw) return null;
  const first = raw.split(':')[0].trim();
  return first || null;
}

const STREAK_FILE = 'upstream-streak.json';

interface StreakRecord {
  streak: number;
  since: string;
  last: string;
  message: string;
}

/** Consecutive upstream failures recorded so far; 0 when none or unreadable. */
export function readStreak(dir: string): number {
  let text: string;
  try {
    text = readFileSync(join(dir, STREAK_FILE), 'utf8');
  } catch {
    return 0;
  }
  try {
    const rec = JSON.parse(text) as Partial<StreakRecord>;
    return Number.isInteger(rec.streak) && rec.streak > 0 ? rec.streak : 0;
  } catch {
    console.error(
      `  the streak file in ${dir} is unreadable — counting from zero`,
    );
    return 0;
  }
}

/** Record one more failure; returns the streak including it. */
export function recordFailure(
  dir: string,
  message: string,
  now = new Date(),
): number {
  const previous = readStreak(dir);
  const streak = previous + 1;
  let since = now.toISOString();
  if (previous > 0) {
    try {
      const rec = JSON.parse(
        readFileSync(join(dir, STREAK_FILE), 'utf8'),
      ) as Partial<StreakRecord>;
      if (typeof rec.since === 'string') since = rec.since;
    } catch {
      // unreadable: `since` is now
    }
  }
  mkdirSync(dir, { recursive: true });
  const rec: StreakRecord = { streak, since, last: now.toISOString(), message };
  writeFileSync(join(dir, STREAK_FILE), JSON.stringify(rec, null, 2) + '\n');
  return streak;
}

/** A successful read from the source: the streak is over. */
export function clearStreak(dir: string): void {
  rmSync(join(dir, STREAK_FILE), { force: true });
}
