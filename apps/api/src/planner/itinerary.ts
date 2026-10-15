// CAMP-46: the planner's core — A to B in D days, a campsite for each night.
//
//   1  corridor        corridor-source.ts   where the line is, and how far
//                                           along it a point lies
//   2  hard rules      hard-constraints.ts  in SQL, through `selectLocated`
//   3  split into days split-days.ts        the dynamic programme
//   scoring            scoring.ts           the weights `loadScoring` checked
//
// Nothing here is a model and nothing here is random: one request over one
// table gives one answer, to the byte (a spec runs it twice and compares the
// text). It replaces the formula in the card — `rating·0.4 + scenic·0.3 +
// popularity·0.2` — which stood on two inputs that exist nowhere (CAMP-262).
//
// 🔴 DISTANCES ARE STRAIGHT LINES, AND SAY SO. There is no router (see
// corridor.ts). Every figure in the outcome is metres along the straight line
// from A to B — or off it — and every day carries `measure`, so a consumer
// has to read the word to read the number. There are no hours in the outcome
// and nothing to compute them from.
//
// 🔴 WHAT A NIGHT IS WORTH is `score()` from scoring.ts, with the weights it
// is handed. The "stop the day's leg asks for" (the `distance_fit` input) is,
// for night k, the point k/D of the way from A to B: the even split. A
// campsite further from its point than one even day earns nothing for
// position, and a recorded `yes` on a hook-up or a dump point lifts it a
// little (the weights say how little). An unknown is never a minus; a
// recorded `no` the reader asked about was rejected in stage 1.
//
// 🔴 "SEVEN DAYS, SIX STOPS IN ONE PLACE" cannot happen because of the band:
// every run is at least `band.minM`, so two nights are at least that far
// apart along the line. It is a property of the answer and it is measured on
// it (itinerary.db.spec.ts: the smallest distance between any two nights,
// read back from PostGIS rather than from this file's own arithmetic).

import { AmenityKey, AmenityValue } from '../osm/tag-mapping';
import { buildCorridor } from './corridor-source';
import { Corridor, CorridorProvider, Measure } from './corridor';
import { LonLat, needsOf, validateRequest } from './hard-constraints';
import { MAX_RADIUS_M } from '../routes/route-points';
import { Queryable } from './read-only';
import { loadMeasuredScoring, ScoringConfig, score } from './scoring';
import { Placed, selectLocated } from './shortlist';
import { assertBand, bandReach, DayBand, splitIntoDays } from './split-days';

/**
 * The most days one request may ask for. It is the page's own limit
 * (apps/web/src/lib/plan.ts, MAX_DAYS) and a spec compares the two. Here it
 * is also what bounds the work: the table the programme fills is D−1 rows of
 * one entry per candidate, and `days` is the only number in the request that
 * a caller can make arbitrarily large.
 */
export const MAX_DAYS = 60;

/**
 * The widest corridor one request may ask for: the widest radius
 * `routes/near` gives a point (routes/route-points.ts), imported rather than
 * copied. The work is the number of campsites in the corridor times the
 * width of a day's window of them, and `bufferM` is the only number in the
 * request that makes the first unbounded.
 */
export const MAX_BUFFER_M = MAX_RADIUS_M;

export interface ItineraryRequest {
  from: LonLat;
  to: LonLat;
  /** D. D−1 nights between A and B; the last day ends at B. */
  days: number;
  /**
   * What one day's run may cover, in metres along the straight line from A to
   * B. Both ends are allowed. `minM` must be positive: it is the guarantee
   * that two nights are never in one place.
   */
  band: DayBand;
  /** Metres to either side of the line a night may lie; at most MAX_BUFFER_M. */
  bufferM: number;
  /** Member states to stay in; absent means the whole EU-27. */
  countries?: readonly string[];
  /** Amenities required: a recorded `no` rejects, an `unknown` passes. */
  needs?: readonly AmenityKey[];
}

export interface Night {
  slug: string;
  country: string;
  lon: number;
  lat: number;
  /** Metres from A, along the straight line to B. */
  alongM: number;
  /** Metres from that line, straight. */
  offsetM: number;
  /** A ranking key, not a percentage (scoring.ts). */
  score: number;
  amenities: Placed['amenities'];
  stars: number | null;
  /** Each REQUIRED amenity: `yes`, or `unknown` — a recorded `no` is not here. */
  needs: Array<{ key: AmenityKey; state: AmenityValue }>;
}

export interface Day {
  /** 1..D. */
  day: number;
  /**
   * How far this day goes, in metres of `measure` — along the line A to B,
   * from where the day starts to where it ends. NOT a road distance and not
   * a time.
   */
  runM: number;
  measure: Measure;
  /** Where the day ends; `null` on the last day, which ends at B. */
  night: Night | null;
}

export type ItineraryOutcome =
  | {
      status: 'ok';
      measure: Measure;
      /** A to B, in metres of `measure`. */
      lengthM: number;
      days: Day[];
      /** Campsites the corridor rule kept: what the nights were chosen from. */
      candidates: number;
    }
  | {
      /** The band cannot cover the corridor in that many days. No campsite asked. */
      status: 'infeasible';
      reason: 'band';
      measure: Measure;
      lengthM: number;
      daysAsked: number;
      /** The shortest and longest corridor that many days inside the band cover. */
      reachM: { minM: number; maxM: number };
    }
  | {
      /** The band fits, and the campsites do not chain across the corridor. */
      status: 'infeasible';
      reason: 'no-chain';
      measure: Measure;
      lengthM: number;
      daysAsked: number;
      candidates: number;
      /** Nights that could be placed from A before the chain ran out. */
      reachedNights: number;
    }
  | {
      /** A and B are one place: a round trip has no direction to cut. Not planned here. */
      status: 'unsupported';
      reason: 'round-trip';
    };

export interface ItineraryDeps {
  /** Where distances come from. Default: corridor-source.ts. */
  corridor?: CorridorProvider;
  /** The weights, already checked against the measured table. */
  scoring?: ScoringConfig;
}

/**
 * Throws on a request that is not a question: a campsite-less answer to it
 * would hide one caller's mistake. (The line, the buffer, the countries and
 * the amenity keys are checked by `validateRequest`, which the corridor rule
 * also runs.)
 */
export function validateItinerary(req: ItineraryRequest): void {
  validateRequest({
    line: [req.from, req.to],
    bufferM: req.bufferM,
    countries: req.countries,
    needs: req.needs,
  });
  if (!Number.isInteger(req.days) || req.days < 1 || req.days > MAX_DAYS) {
    throw new Error(
      `days must be a whole number from 1 to ${MAX_DAYS}, got ${req.days}`,
    );
  }
  if (req.bufferM > MAX_BUFFER_M) {
    throw new Error(
      `bufferM must be at most ${MAX_BUFFER_M} m, got ${req.bufferM}`,
    );
  }
  assertBand(req.band);
}

type OnLine = Placed & { along: number; offset: number };

/**
 * Where each campsite lies on the line. A source that cannot place one
 * answers with a number that is not finite, and `splitIntoDays` leaves that
 * campsite out, singly: the rest are still a corridor.
 */
const locateAll = (found: readonly Placed[], corridor: Corridor): OnLine[] =>
  found.map((p) => ({ ...p, ...corridor.locate([p.lon, p.lat]) }));

export async function planItinerary(
  db: Queryable,
  req: ItineraryRequest,
  deps: ItineraryDeps = {},
): Promise<ItineraryOutcome> {
  validateItinerary(req);
  if (req.from[0] === req.to[0] && req.from[1] === req.to[1]) {
    return { status: 'unsupported', reason: 'round-trip' };
  }
  const corridor = await (deps.corridor ?? buildCorridor)({
    from: req.from,
    to: req.to,
  });
  const scoring = deps.scoring ?? loadMeasuredScoring();
  const L = corridor.metres;
  const D = req.days;

  // The even split, and the width of "close to it": one even day. Both come
  // from the corridor and the request; neither is a number chosen here.
  const evenM = L / D;
  const value = (c: OnLine, night: number): number =>
    score(
      {
        slug: c.slug,
        // Metres from the point night k ideally falls on. `along` and
        // `offset` are two perpendicular distances, so Pythagoras; over a
        // day's run the flat figure is within a fraction of a per cent of
        // the arc.
        distanceM: Math.hypot(c.along - night * evenM, c.offset),
        amenities: c.amenities,
        stars: c.stars,
      },
      evenM,
      [],
      scoring.components,
    );

  // The band can be checked against the corridor before any campsite is
  // read: no need to ask the database for a corridor that cannot be split.
  const { fits, ...reachM } = bandReach(D, L, req.band);
  if (!fits) {
    return {
      status: 'infeasible',
      reason: 'band',
      measure: corridor.measure,
      lengthM: L,
      daysAsked: D,
      reachM,
    };
  }

  const found = await selectLocated(db, {
    line: corridor.line,
    bufferM: req.bufferM,
    countries: req.countries,
    needs: req.needs,
  });
  const located = locateAll(found, corridor);
  const split = splitIntoDays(located, {
    days: D,
    metres: L,
    band: req.band,
    value,
  });

  if (split.status === 'infeasible') {
    if (split.reason === 'band') {
      // Unreachable: the same question was answered above, with no campsites.
      throw new Error('itinerary: the band changed its answer');
    }
    return {
      status: 'infeasible',
      reason: 'no-chain',
      measure: corridor.measure,
      lengthM: L,
      daysAsked: D,
      candidates: located.length,
      reachedNights: split.reachedNights,
    };
  }

  const days: Day[] = [];
  let from = 0;
  for (let k = 1; k <= D; k++) {
    const c = split.nights[k - 1];
    const end = c ? c.along : L;
    days.push({
      day: k,
      runM: end - from,
      measure: corridor.measure,
      night: c
        ? {
            slug: c.slug,
            country: c.country,
            lon: c.lon,
            lat: c.lat,
            alongM: c.along,
            offsetM: c.offset,
            score: value(c, k),
            amenities: c.amenities,
            stars: c.stars,
            needs: needsOf(c.amenities, req.needs),
          }
        : null,
    });
    from = end;
  }
  return {
    status: 'ok',
    measure: corridor.measure,
    lengthM: L,
    days,
    candidates: located.length,
  };
}
