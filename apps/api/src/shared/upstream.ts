// CAMP-440: a source that is down is not a collector that is broken.
//
// Measured 04.11.2026, twice in one day: in the morning
// water.discomap.eea.europa.eu answered HTTP 500 on the root of
// /arcgis/rest/services while the air server next door answered 200; by
// 18:25 UTC it was the other way round — air.discomap answered 500 and
// the air import died with a stack trace, OnFailure wrote its marker,
// and the owner got a letter about a server he does not run. The EEA
// takes its servers down in turn; both importers read them. An alarm
// that rings about the unchangeable teaches its reader not to read
// alarms.
//
// This module is what bathing/upstream.ts was before it was shared: the
// type that names the tolerated failure, the retry loop that produces
// it, and the streak counter that decides when tolerance ends. Each
// importer keeps ONE thing of its own — the escalation threshold —
// because that number is a function of the timer's cadence (weekly for
// bathing, every three hours for air) and the freshness budget of the
// table, and copying it blindly would be wrong for one of the two.
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
// 🔴 TOLERATED IS NOT MUTED. Dropping the exit 1 would leave a collector
// watched by nobody, which is worse than the letter. Instead the run
// keeps a streak of consecutive upstream failures in $STATE_DIRECTORY
// and exits non-zero on every N-th one (N per importer, see above): a
// one-off outage costs no letter, an outage that lasts gets one, and a
// success wipes the streak. Without a STATE_DIRECTORY there is nowhere
// to count, and the run fails the unit exactly as before — the fallback
// is loud, not quiet.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The source did not answer, or answered that it is broken. Not our bug. */
export class UpstreamUnavailable extends Error {}

/**
 * Whether this failure has to fail the unit on the spot.
 *
 * 🔴 Decided by TYPE. Matching on words would let a rephrased message
 * quietly bring the letters back — or, worse, let a coincidence of
 * words in a real bug swallow that bug.
 */
export const failsTheUnit = (err: unknown): boolean =>
  !(err instanceof UpstreamUnavailable);

/** Which HTTP answers are the source's problem rather than ours. */
export function isUpstreamStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

// ---------------------------------------------------------------------
// The retry loop.
// ---------------------------------------------------------------------

/**
 * How many times one request is tried before the source is declared
 * unavailable, and the pause between tries.
 *
 * The same shape as the download loop in .github/workflows/osm-weekly.yml:
 * a loop of SEPARATE calls, each attempt named in the log as
 * "attempt i of N", and the failure named once, after the loop, by the
 * caller. Three attempts thirty seconds apart ride out the common
 * one-off 5xx; the 04.11.2026 outage (the whole server, for longer) is
 * what the streak counter below is for.
 */
export const ATTEMPTS = 3;
export const RETRY_PAUSE_MS = 30_000;

export interface RetryOptions {
  attempts?: number;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Named in the failure, e.g. "the EEA ArcGIS server". */
  source?: string;
  /**
   * Request options. A FUNCTION when any of them must be fresh per
   * attempt — an `AbortSignal.timeout()` is spent once it has fired.
   */
  init?: RequestInit | (() => RequestInit);
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One request, retried while the SOURCE is the one failing.
 *
 * 🔴 Only a 5xx, a 429 or a transport error (the host unreachable, the
 * connection reset, our own timeout) is retried, and only those become
 * `UpstreamUnavailable` once the attempts are spent. Any other answer —
 * a 200 with an error object, a 404 because the layer moved — is handed
 * back untouched for the caller to fail on, loudly, as before. The pause
 * is injectable so tests do not wait thirty seconds; the loop is not.
 */
export async function fetchUpstream(
  fetchImpl: typeof fetch,
  url: string,
  what: string,
  opts: RetryOptions = {},
): Promise<Response> {
  const attempts = opts.attempts ?? ATTEMPTS;
  const pauseMs = opts.pauseMs ?? RETRY_PAUSE_MS;
  const sleep = opts.sleep ?? realSleep;
  const log = opts.log ?? ((line: string) => console.log(line));
  const source = opts.source ?? 'the source';
  let last = 'not attempted';

  for (let i = 1; i <= attempts; i++) {
    let res: Response | null = null;
    try {
      const init = typeof opts.init === 'function' ? opts.init() : opts.init;
      res = init ? await fetchImpl(url, init) : await fetchImpl(url);
    } catch (err) {
      const cause = (err as { cause?: { code?: string } })?.cause?.code;
      last = `unreachable (${(err as Error)?.message ?? String(err)}${
        cause ? `, ${cause}` : ''
      })`;
    }
    if (res) {
      if (!isUpstreamStatus(res.status)) return res;
      last = `HTTP ${res.status}`;
    }
    log(
      `  ${what}: attempt ${i} of ${attempts} — ${last}` +
        (i < attempts ? `, waiting ${pauseMs / 1000} s` : ''),
    );
    if (i < attempts) await sleep(pauseMs);
  }

  throw new UpstreamUnavailable(
    `${source} is unavailable: ${what} answered ${last} on all ` +
      `${attempts} attempts, ${pauseMs / 1000} s apart — the source, not this import`,
  );
}

// ---------------------------------------------------------------------
// The streak counter.
// ---------------------------------------------------------------------

export interface UpstreamVerdict {
  failUnit: boolean;
  say: string;
}

/**
 * Pure: given the streak INCLUDING this run, what to do.
 *
 * `every` is the importer's own number — see the head of this file for
 * why there is no default here.
 */
export function upstreamVerdict(
  streak: number,
  every: number,
): UpstreamVerdict {
  if (!Number.isInteger(streak) || streak < 1) {
    throw new Error(`a streak is a count of failed runs, not ${streak}`);
  }
  if (!Number.isInteger(every) || every < 1) {
    throw new Error(`"every" is a count of runs, not ${every}`);
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
 * declare one each. Nothing else in the importers reads that variable.
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
