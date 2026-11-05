// CAMP-440: a source that is down is not a collector that is broken.
//
// The mechanics — `UpstreamUnavailable`, `failsTheUnit`, the retry loop
// and the streak counter in $STATE_DIRECTORY — live in
// ../shared/upstream.ts: the EEA took its air server down the same day
// it took the water server down (04.11.2026, morning and evening), and
// the air importer needed exactly this. What stays here is the ONE
// number that is this importer's own.
//
// 🔴 TOLERATED IS NOT MUTED. bathing_waters holds 22 010 rows on a
// 365-day budget (the EEA classifies once a year), so the freshness
// sentry stays green through a YEAR of failed runs; dropping the exit 1
// would leave this collector watched by nobody, which is worse than the
// letter. Instead the run keeps a streak of consecutive upstream
// failures and exits non-zero on every ESCALATE_EVERY-th one: a one-off
// outage costs no letter, an outage that lasts gets one per three
// failed Wednesdays, and a success wipes the streak.
//
// What we pay: an outage that is secretly ours — a renamed service that
// still answers 500 rather than 404 — is learnt on the third Wednesday,
// fifteen days in, instead of the first. What the reader pays: nothing;
// the table keeps serving the last season, which stays valid for 365
// days. What we refuse to pay: silence.

import { upstreamVerdict as verdict } from '../shared/upstream';
import type { UpstreamVerdict } from '../shared/upstream';

export {
  UpstreamUnavailable,
  clearStreak,
  failsTheUnit,
  isUpstreamStatus,
  readStreak,
  recordFailure,
  stateDirectory,
} from '../shared/upstream';
export type { UpstreamVerdict } from '../shared/upstream';

/**
 * Every how-many-th consecutive upstream failure fails the unit.
 *
 * The timer is weekly (camptribe-bathing-waters.timer), so 3 means the
 * first letter on the third failed Wednesday, then one per three more.
 * The air importer runs every three hours and has its own, smaller
 * number (air/import.ts) — this one is NOT the default for anything.
 */
export const ESCALATE_EVERY = 3;

/** Pure: given the streak INCLUDING this run, what to do. */
export function upstreamVerdict(
  streak: number,
  every = ESCALATE_EVERY,
): UpstreamVerdict {
  return verdict(streak, every);
}
