// CAMP-246: the two stages, wired in the only order they work in.
//
//   stage 1  selectCandidates()  hard constraints, in SQL (hard-constraints.ts)
//   stage 2  shortlist()         soft scoring, on what stage 1 returned
//
// 🔴 THE ORDER IS THE POINT, and it is structural: `rank` is only ever handed
// rows that came out of `selectCandidates`. There is no path by which a
// campsite that failed a hard constraint reaches the ranking, and so none by
// which it could outscore one that passed.
//
// 🔴 THE WEIGHTS ARE READ FROM `scoring`, a ScoringConfig — the one
// `loadScoring` has already checked against the measured coverage table —
// and not from a constant in this file. Hand it other weights and the same
// campsites come back in another order.
//
// This is the single-stop reader: one target stop, the distance a straight
// line in metres, not time on a road. Splitting a corridor into days is
// itinerary.ts (CAMP-46); it reads the same stage 1 through `selectLocated`
// below, so there is one list of columns and one rule for what a malformed
// amenity set reads as.

import { AmenityKey, AmenityValue } from '../osm/tag-mapping';
import { mergedStarsSql } from '../spots/links';
import {
  effectiveAmenitiesSql,
  hardWhere,
  HardRequest,
  LonLat,
  needsOf,
} from './hard-constraints';
import { Queryable } from './read-only';
import {
  Candidate,
  loadMeasuredScoring,
  ScoringConfig,
  score,
} from './scoring';

export interface ShortlistRequest extends HardRequest {
  /** The stop the day's leg asks for: `distance_fit` is measured from here. */
  target: LonLat;
  /** Metres at which `distance_fit` reaches 0. */
  toleranceM: number;
}

/** What stage 1 returns: a campsite that passed every hard constraint. */
export interface Selected extends Candidate {
  country: string;
  /** The amenities as the reader sees them (owner's corrections applied). */
  amenities: Partial<Record<AmenityKey, string>>;
  /** WGS84 degrees, as stored: the corridor measures from these. */
  lon: number;
  lat: number;
}

/** Stage 1 without a target: a campsite and where it is, nothing measured from it. */
export type Placed = Omit<Selected, 'distanceM'>;

export interface Shortlisted extends Selected {
  score: number;
  /**
   * Each REQUIRED amenity and what we know of it. `yes`, or `unknown` — a
   * recorded `no` was rejected in stage 1 and does not appear here.
   */
  needs: Array<{ key: AmenityKey; state: AmenityValue }>;
}

type Row = {
  slug: string;
  country: string;
  amenities: unknown;
  stars: number | null;
  lon: number | string;
  lat: number | string;
  metres?: number | string | null;
};

/** The columns both readers of stage 1 take, in one place. */
const placedColumns = (alias: string): string =>
  `${alias}.slug, ${alias}.country,
            ${effectiveAmenitiesSql(alias)} AS amenities,
            ${mergedStarsSql(alias)} AS stars,
            ST_X(${alias}.location) AS lon, ST_Y(${alias}.location) AS lat`;

const placedOf = (r: Row): Placed => ({
  slug: r.slug,
  country: r.country,
  // A stored amenity set that is not an object reads as nothing known.
  amenities: (typeof r.amenities === 'object' && r.amenities !== null
    ? r.amenities
    : {}) as Selected['amenities'],
  stars: r.stars === null ? null : Number(r.stars),
  lon: Number(r.lon),
  lat: Number(r.lat),
});

/**
 * Stage 1. Every published campsite that passes the hard constraints, with
 * its distance from the target in METRES (`ST_Distance` on geography, which
 * is metres; on geometry it would be degrees).
 */
export async function selectCandidates(
  db: Queryable,
  req: ShortlistRequest,
): Promise<Selected[]> {
  const hard = hardWhere(req, 's', 0);
  const t = hard.params.length;
  const res = await db.query(
    `SELECT ${placedColumns('s')},
            ST_Distance(s.location::geography,
              ST_SetSRID(ST_MakePoint($${t + 1}::float8, $${t + 2}::float8), 4326)::geography
            ) AS metres
       FROM camping_spots s
      WHERE ${hard.where}`,
    [...hard.params, req.target[0], req.target[1]],
  );
  return (res.rows as unknown as Row[]).map((r) => ({
    ...placedOf(r),
    // NaN, not 0, for a distance that is not there: `distanceFit` scores NaN
    // as nothing, whereas 0 metres would be a perfect fit.
    distanceM: r.metres === null ? NaN : Number(r.metres),
  }));
}

/**
 * Stage 1 for a reader that has no single target (the itinerary, CAMP-46):
 * every published campsite that passes the hard constraints, and where it is.
 * The same rules, the same columns and the same reading of a malformed
 * amenity set as `selectCandidates`, so a campsite is never in one and out of
 * the other.
 */
export async function selectLocated(
  db: Queryable,
  req: HardRequest,
): Promise<Placed[]> {
  const hard = hardWhere(req, 's', 0);
  const res = await db.query(
    `SELECT ${placedColumns('s')}
       FROM camping_spots s
      WHERE ${hard.where}`,
    hard.params,
  );
  return (res.rows as unknown as Row[]).map(placedOf);
}

/**
 * Stage 2 over stage 1: best first, equal scores by slug so one input gives
 * one order. Each result says what is and is not recorded about the
 * amenities that were required.
 */
export async function shortlist(
  db: Queryable,
  req: ShortlistRequest,
  scoring: ScoringConfig = loadMeasuredScoring(),
): Promise<Shortlisted[]> {
  const selected = await selectCandidates(db, req);
  const scored = selected.map((c) => ({
    ...c,
    score: score(c, req.toleranceM, [], scoring.components),
    needs: needsOf(c.amenities, req.needs),
  }));
  scored.sort(
    (a, b) =>
      b.score - a.score || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  return scored;
}
