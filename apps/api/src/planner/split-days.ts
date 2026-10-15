// CAMP-46: cut a corridor into D day-runs with a night at the end of each.
//
// The dynamic programme of docs/trip-planner-design.md (Г.2), exact and not a
// heuristic: of every way to choose D−1 campsites that leave EVERY day's run
// inside the band, it returns the one whose nights are worth the most.
//
//   day 1            A  → night 1      along(night 1) − 0
//   day k            night k−1 → night k
//   day D            night D−1 → B     metres − along(night D−1)
//
// A candidate is nothing but a slug and a number — `along`, metres from the
// start — so this file cannot know whether that number is a straight line or a
// road (corridor.ts). What a night is WORTH is the caller's `value(c, k)`,
// which may differ for each night k: the itinerary scores a campsite by how
// close it is to where night k ideally falls.
//
// 🔴 WHY NO "DIFFERENT TOWN" RULE. docs/trip-planner-design.md Г.2 sketched
// `c[j].town !== c[i].town` as the guard against "seven days, six stops in one
// place". It does nothing the band does not already do better: consecutive
// nights are at least `band.minM` apart along the line, so two of them can
// share a town only if `minM` is smaller than the town — and then the rule
// compares a NAME (the nearest town's, which two campsites 20 km apart can
// share or not at will) where the band compares a distance. The guarantee is
// the lower bound of the band, it is MEASURED on what comes out
// (itinerary.db.spec.ts, measure-itinerary.ts), and `minM` must be positive.
//
// 🔴 ONE INPUT, ONE ANSWER. The candidates are put in a canonical order (along,
// then slug) before anything is read, so the order the database happened to
// return them in changes nothing, and every tie — two predecessors worth the
// same, two endings worth the same — is broken by slug and, last, by position
// in that order. No randomness, no clock.
//
// 🔴 A REFUSAL IS AN ANSWER. When the band cannot cover the corridor, or the
// campsites do not chain across it, this says so and says where it ran out; it
// never returns the nearest thing that does not fit.

export interface Placement {
  slug: string;
  /** Metres from the start of the corridor, along it. */
  along: number;
}

/** What one day's run may cover. Both ends are allowed. */
export interface DayBand {
  minM: number;
  maxM: number;
}

export interface SplitRequest<T extends Placement> {
  /** D. The number of day-runs; there are D−1 nights. */
  days: number;
  /** The corridor's length, in the unit of `along`. */
  metres: number;
  band: DayBand;
  /**
   * What candidate `c` is worth as night `night` (1..D−1). Finite. A
   * candidate whose value is not finite cannot be night `night`: one bad
   * record costs that record, not the answer.
   */
  value(c: T, night: number): number;
}

export type Split<T> =
  | { status: 'ok'; nights: T[]; total: number }
  | {
      status: 'infeasible';
      reason: 'band';
      /** The shortest and longest corridor `days` runs inside the band can cover. */
      reach: { minM: number; maxM: number };
    }
  | {
      status: 'infeasible';
      reason: 'no-chain';
      /**
       * How many nights could be placed from the start before no campsite was
       * left to carry the chain on, 0..D−1. Equal to D−1 when the nights fit
       * but the last one cannot reach the end.
       */
      reachedNights: number;
    };

const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

const bySlug = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Throws on a band that is not one. `minM` must be positive: it is what keeps
 * two nights apart. With zero, every campsite in one town may be a night of
 * its own.
 */
export function assertBand(band: DayBand): void {
  const { minM, maxM } = band ?? ({} as Partial<DayBand>);
  if (!finite(minM) || minM <= 0) {
    throw new Error(`band.minM must be a positive number, got ${minM}`);
  }
  if (!finite(maxM) || maxM < minM) {
    throw new Error(
      `band.maxM must be a number of at least band.minM (${minM}), got ${maxM}`,
    );
  }
}

/**
 * D runs of at least minM and at most maxM cover between D·minM and D·maxM:
 * necessary, and with real-valued runs sufficient. No campsite is needed to
 * know this, and the reason it gives is the useful one.
 */
export function bandReach(
  days: number,
  metres: number,
  band: DayBand,
): { fits: boolean; minM: number; maxM: number } {
  const minM = days * band.minM;
  const maxM = days * band.maxM;
  return { fits: metres >= minM && metres <= maxM, minM, maxM };
}

/**
 * Throws on a request that is not a question: that is a caller's mistake,
 * and answering it would hide it.
 */
function assertAsk(req: { days: number; metres: number; band: DayBand }): void {
  const { days, metres, band } = req;
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`days must be a whole number of at least 1, got ${days}`);
  }
  if (!finite(metres) || metres <= 0) {
    throw new Error(`metres must be a positive number, got ${metres}`);
  }
  assertBand(band);
}

export function splitIntoDays<T extends Placement>(
  candidates: readonly T[],
  req: SplitRequest<T>,
): Split<T> {
  assertAsk(req);
  const { days, metres, band, value } = req;
  const { minM, maxM } = band;
  const nights = days - 1;

  const { fits, ...reach } = bandReach(days, metres, band);
  if (!fits) return { status: 'infeasible', reason: 'band', reach };
  if (nights === 0) return { status: 'ok', nights: [], total: 0 };

  // A campsite we cannot place is not one to build a night on. Dropped here,
  // singly: the rest are still a corridor.
  const C = candidates
    .filter((c) => finite(c.along))
    .sort((a, b) => a.along - b.along || bySlug(a.slug, b.slug));
  const n = C.length;

  const best: Float64Array[] = [];
  const prev: Int32Array[] = [];
  const level = (): [Float64Array, Int32Array] => [
    new Float64Array(n).fill(-Infinity),
    new Int32Array(n).fill(-1),
  ];

  // Night 1: from the start.
  [best[1], prev[1]] = level();
  let reached = 0;
  for (let i = 0; i < n; i++) {
    if (C[i].along < minM || C[i].along > maxM) continue;
    const v = value(C[i], 1);
    if (!finite(v)) continue;
    best[1][i] = v;
    reached = 1;
  }

  // Night k: from the best night k−1 whose run to it is in the band. In the
  // canonical order those are a contiguous window, and both of its ends only
  // ever move forward.
  for (let k = 2; k <= nights && reached === k - 1; k++) {
    [best[k], prev[k]] = level();
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      const at = C[i].along;
      while (hi < n && C[hi].along <= at - minM) hi++;
      while (lo < hi && C[lo].along < at - maxM) lo++;
      let from = -1;
      let fromValue = -Infinity;
      for (let j = lo; j < hi; j++) {
        const v = best[k - 1][j];
        if (v === -Infinity) continue;
        if (v > fromValue || (v === fromValue && C[j].slug < C[from].slug)) {
          from = j;
          fromValue = v;
        }
      }
      if (from < 0) continue;
      const v = value(C[i], k);
      if (!finite(v)) continue;
      best[k][i] = fromValue + v;
      prev[k][i] = from;
      reached = k;
    }
  }

  // The last night must be within the band of the end.
  let end = -1;
  let endValue = -Infinity;
  if (reached === nights) {
    for (let i = 0; i < n; i++) {
      const v = best[nights][i];
      if (v === -Infinity) continue;
      const run = metres - C[i].along;
      if (run < minM || run > maxM) continue;
      if (v > endValue || (v === endValue && C[i].slug < C[end].slug)) {
        end = i;
        endValue = v;
      }
    }
  }
  if (end < 0)
    return { status: 'infeasible', reason: 'no-chain', reachedNights: reached };

  const out: T[] = new Array<T>(nights);
  for (let k = nights, i = end; k >= 1; k--) {
    out[k - 1] = C[i];
    i = prev[k][i];
  }
  return { status: 'ok', nights: out, total: endValue };
}
