// CAMP-168: which bathing water, if any, a campsite page may name.
//
// 🔴 ONE PLACE, IN SQL, ON THE WAY OUT OF THE DATABASE — the same shape
// as spots/tariffs.ts. The radius is a claim about what "near this
// campsite" means, and a claim like that must not be one component's
// opinion that the next consumer of /spots does not share.

import { BATHING_SOURCE_ID } from './source';

/**
 * 🔴 HOW FAR A BATHING WATER MAY BE AND STILL BE THIS CAMPSITE'S.
 *
 * Measured 28.09.2026 with `report-coverage.ts` in this directory —
 * all 61 558 campsites against all 22 010 EU-27 bathing waters, nearest
 * by geography distance, no sampling:
 *
 *      250 m    3 885    6.3%
 *      500 m    8 307   13.5%
 *     1000 m   13 482   21.9%
 *     1500 m   16 461   26.7%
 *     2000 m   18 605   30.2%   <- chosen
 *     3000 m   21 873   35.5%
 *     5000 m   27 434   44.6%
 *    10000 m   38 254   62.1%
 *
 * 🔴 That curve CANNOT choose the radius, and it is important to say why
 * rather than pick the knee off it. It has no knee: it climbs all the
 * way, because at 10 km you are counting campsites that share a
 * coastline with something, not campsites beside it. Choosing by
 * "coverage" alone always argues for the largest number.
 *
 * 🔴 So the radius is examined on a DIFFERENT FIELD FROM THE ONE IT
 * JUDGES. CAMP-33 already computed, from OpenStreetMap and years before
 * this dataset arrived, the nearest water feature for every campsite and
 * labelled it sea / lake / reservoir / river. If the nearest bathing
 * water is the water beside the campsite, its EEA category agrees with
 * that label. `context.water.kind` comes from `osm_ctx_water` through
 * compute-context.ts and the category from the EEA: no column is shared
 * and nothing in the comparison is derived from the distance. All 61 558
 * campsites carry a kind, so none is dropped from the comparison for
 * want of a recognised one (the report prints that count: 0).
 *
 * 🔴 BUT THE RAW CURVE IS CONFOUNDED, AND THIS COMMENT USED TO READ IT
 * AS IF IT WERE NOT. Share of the campsites in each 500 m band whose
 * nearest bathing water agrees with that kind:
 *
 *     0-500 m   86.3%     1000-1500 m   71.7%     2000-2500 m   57.2%
 *     4500-5000 m   47.2%
 *
 * Read straight, that is a signal dying with distance. It is partly a
 * change of population: the campsites in the far bands are not the ones
 * in the near bands. The coastal share falls from 45.7% (0-500 m) to
 * 7.5% (4.5-5 km) and the river share rises from 20.0% to 54.3%, and a
 * river campsite's nearest bathing water agrees with its kind far less
 * often than a coastal one's whatever the distance.
 *
 * Agreement WITHIN each kind (a reservoir counts as a lake):
 *
 *                   0-500 m    1.5-2 km    2.5-3 km    4.5-5 km
 *     sea            99.8%       97.7%       96.1%       94.6%
 *     lake           94.6%       69.5%       65.3%       70.8%
 *     river          41.0%       23.0%       23.6%       24.1%
 *
 * Re-weighted to the 0-500 m mix (sea 45.7 / lake 34.3 / river 20.0),
 * so that only distance is left to move it, the same ten bands read:
 *
 *     0-500  86.3   500-1000  80.5   1000-1500  76.9   1500-2000  73.1
 *     2000-2500  73.6   2500-3000  71.0   3000-3500  73.8
 *     3500-4000  74.4   4000-4500  71.8   4500-5000  72.4
 *
 * What that supports, and what it does not:
 *
 *   - It DOES support 2 000 m as the place to stop: the standardised
 *     curve falls from 86.3% to 73.1% by the 1.5-2 km band and, for
 *     every band from there to 5 km, does not fall again. The decline
 *     ends in the last band we keep.
 *   - It does NOT support "the signal dies between 2 and 3 km", or "past
 *     2.5 km is a band of unrelated water" — both were said here, and
 *     both were the raw curve talking. From 2 to 5 km the standardised
 *     figure stays at 71-74%, about double the 35-38% it would read if
 *     the category of the nearest bathing water were unrelated to the
 *     campsite's water (the `chance` column, on the same weights). At
 *     4.5-5 km a coastal campsite still agrees 94.6% of the time, and
 *     the last band printed, 9.5-10 km, reads 64.5% against 34.0%.
 *   - Agreement in KIND is a weak test at a distance. A coastal
 *     campsite's nearest bathing water is sea at 5 km without being the
 *     water beside it, so this measure cannot say where "near" ends. It
 *     shows where the decline stops; 2 000 m is a judgement placed
 *     there, on the cautious side — not a distance the data imposes.
 *     Widening it would add campsites (3 000 m: 3 268, 5 000 m: 8 829)
 *     that this test cannot tell apart from the band before them.
 *
 * All of it is `report-coverage.ts`, run 29.09.2026 over the full
 * database. The raw column there is (lo, hi] on unrounded distance and
 * its cumulative counts equal the sweep above at every radius that is a
 * band edge; the earlier table rounded the distance and bucketed
 * half-open, and printed 86.2% and 47.1% where this one prints 86.3% and
 * 47.2%. The arithmetic is agreement.ts, checked by hand in
 * agreement.spec.ts.
 *
 * 🔴 The distance is RENDERED, not just used to filter. A radius the
 * reader cannot see is a radius they cannot disagree with, and "1.8 km
 * away" is a fact they can check against the map on the same page.
 *
 * What it yields, at 2 000 m, over all 61 558 campsites:
 *
 *     a classified bathing water nearby   18 082   29.4%
 *       excellent 15 343 · good 2 000 · sufficient 464 · poor 275
 *     nearest one is "Not classified"        523    0.8%
 *     no bathing water within 2 km        42 953   69.8%
 *
 * All 27 member states are represented, from LU at 1.8% of its 113
 * campsites to MT at 85.7% of its 14 — a country sitting at zero in that
 * breakdown is the shape a dropped country code or a swapped
 * latitude/longitude makes, which is why report-coverage.ts prints it.
 */
export const BATHING_RADIUS_M = 2000;

/** One bathing water, as the API sends it to a page. */
export interface BathingWaterView {
  /** The EEA's own identifier for the bathing water. */
  ref: string;
  name: string;
  /** Coastal | Lake | River | Transitional, as the member state files it. */
  category: string;
  /**
   * 🔴 THE SEASON. A year, and it travels with every single record.
   *
   * What stops a record reaching a page without one is the column: it is
   * `int NOT NULL` with a range CHECK, and migration.spec.ts pins that
   * DDL. What stops a wrong one is the end-to-end spec, which pins the
   * payload's season and the rendered year to BATHING_SEASON rather than
   * to each other. The type below has no optional here, but the API
   * reads it out of JSON with an unchecked cast — the type is a promise,
   * not a check.
   */
  season: number;
  /** excellent | good | sufficient | poor | not_classified. */
  status: string;
  /** The member state's own bathing water profile page, where it has one. */
  profileUrl: string | null;
  /** Straight-line metres from the campsite. Honest: not a walking route. */
  metres: number;
  sourceId: string;
}

/**
 * The nearest bathing water to one campsite, or SQL NULL.
 *
 * 🔴 `LIMIT 1`, not a list. Several designated bathing waters can sit
 * within 2 km of one campsite — a lake with four beaches is four rows —
 * and printing four classifications for what a reader experiences as one
 * lake invites them to average the four. The nearest one, named and with
 * its distance, is a fact they can check.
 *
 * 🔴 The ORDER BY ends in `b.ref`, and that is not padding. Two bathing
 * waters at an identical distance would otherwise swap between builds,
 * and a statically built site then rewrites pages whose content did not
 * change and tells crawlers the content moved. The same lesson as
 * tariffsSql.
 *
 * 🔴 The season filter is `max(season)`, not a constant compiled in.
 * Next June's import adds 2026 rows beside the 2025 ones and this query
 * follows them without a deploy — while a mixed table, mid-import, still
 * yields exactly one row per campsite rather than one per season.
 *
 * 🔴 And it is `max(season)` over THIS SOURCE'S rows. The subquery used
 * to read the whole table, so a second publisher whose newest season was
 * higher than the EEA's would have made `b.season = max(...)` match no
 * EEA row at all, and every campsite page would have said "no bathing
 * water within 2 km" — a confident, silent, wrong answer on all 61 558
 * pages. Nothing in the table today but this source, so it was latent.
 */
export function nearestBathingWaterSql(
  spotLocationExpr: string,
  radiusM: number = BATHING_RADIUS_M,
): string {
  return `(
    SELECT json_build_object(
             'ref', b.ref,
             'name', b.name,
             'category', b.category,
             'season', b.season,
             'status', b.status,
             'profileUrl', b.profile_url,
             'metres', round(ST_Distance(${spotLocationExpr}, b.location))::int,
             'sourceId', b.source_id
           )
      FROM bathing_waters b
     WHERE b.source_id = '${BATHING_SOURCE_ID}'
       AND b.season = (
              SELECT max(m.season) FROM bathing_waters m
               WHERE m.source_id = '${BATHING_SOURCE_ID}')
       AND ST_DWithin(${spotLocationExpr}, b.location, ${radiusM})
     ORDER BY ${spotLocationExpr} <-> b.location, b.ref
     LIMIT 1
  )`;
}
