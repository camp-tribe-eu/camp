// CAMP-391: the two numbers the HTTP entry chooses FOR the caller.
//
// The algorithm wants a band (what one day's run may cover) and a buffer (how
// far from the line a night may lie). The form has neither, and a stranger's
// client should not have to know them: the entry derives them from what it is
// given.
//
// 🔴 ONE STATEMENT, READ BY TWO CALLERS. `measure-itinerary.ts` measures the
// planner, and a measurement of a different question than the one the public
// asks is a measurement of nothing. It imports these instead of keeping its
// own copy, so "the median call is 15 ms" is about the requests the API
// really answers. They used to live there; the values did not change.
//
// 🔴 A SHARE OF AN EVEN DAY, NOT A NUMBER OF KILOMETRES. A fixed band
// ("60 to 120 km") is feasible for exactly one length of trip and a refusal
// for every other, and the refusal would say "the band cannot cover the
// corridor" about a number the caller never chose. Half to one and a half of
// the even day — a calm day and a hurried one around the mean — fits ANY
// corridor in ANY number of days (`D · 0.5 · L/D ≤ L ≤ D · 1.5 · L/D`), so the
// `band` refusal cannot happen through this entry, and the mapper treats it as
// the bug it would be (plan-response.ts). What CAN refuse is a corridor with
// no campsites to chain across (open water): `no-chain`.
//
// 🔴 NOTHING HERE IS A ROAD. The band is metres along the straight line from A
// to B, as everywhere in the planner (corridor.ts), and `0.5` of an even
// straight day is not "two hours at the wheel".

import { EARTH_RADIUS_M } from '../planner/corridor';
import type { LonLat } from '../planner/hard-constraints';
import type { DayBand } from '../planner/split-days';

/** Runs of 0.5 to 1.5 of an even day: a calm and a hurried day around the mean. */
export const BAND_SHARE = { min: 0.5, max: 1.5 } as const;

/** Metres to either side of the straight line a night may lie. */
export const BUFFER_M = 30_000;

/** The band for `days` days over a corridor `lengthM` metres long. */
export function bandFor(lengthM: number, days: number): DayBand {
  const even = lengthM / days;
  return { minM: even * BAND_SHARE.min, maxM: even * BAND_SHARE.max };
}

/**
 * Two points closer than this are ONE place, whatever the digits say.
 *
 * 🔴 FOUND BY ASKING, NOT BY READING: `from` = 46.0569 and `to` = 46.0569000000001
 * are two different numbers, so the algorithm's own test for a round trip
 * (`from[0] === to[0] && …`) says "different", and the corridor then refuses to
 * draw an arc between two points 1e-8 m apart (corridor.ts: "the same place or
 * opposite ones") — with an `Error`, which was a 500 for a caller who had done
 * nothing wrong but type a coordinate twice with a slip in the fifteenth digit.
 * Measured against the running API before this was written.
 *
 * A metre is a decision, not a measurement: far above the 6 µm at which the
 * corridor gives up (so it can never be reached from below), far below anything
 * a person marks on a map, and it is what the service does with the pair — hands
 * the algorithm `to` AS `from`, so the algorithm's own refusal (`unsupported`,
 * `round-trip`) answers, and the answer is the one an exactly equal pair gets.
 */
export const SAME_PLACE_M = 1;

/** Haversine on the planner's sphere: a different formula from the corridor's, on purpose. */
export function metresBetween(a: LonLat, b: LonLat): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const samePlace = (a: LonLat, b: LonLat): boolean =>
  metresBetween(a, b) < SAME_PLACE_M;
