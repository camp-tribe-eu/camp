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
 * 🔴 So the radius is chosen on a DIFFERENT FIELD FROM THE ONE IT
 * JUDGES. CAMP-33 already computed, from OpenStreetMap and years before
 * this dataset arrived, the nearest water feature for every campsite and
 * labelled it sea / lake / reservoir / river. If the nearest bathing
 * water is the water beside the campsite, its EEA category agrees with
 * that label. Nothing in that comparison is derived from the distance,
 * so it is a measurement rather than a restatement — the trap this
 * repository has fallen into four times.
 *
 * Share of campsites whose nearest bathing water agrees with the kind of
 * water we already name, by band (same run):
 *
 *     up to   500 m   8 301   86.2% agree
 *     up to  1000 m   5 178   81.4%
 *     up to  1500 m   2 980   71.7%
 *     up to  2000 m   2 145   63.3%   <- chosen
 *     up to  2500 m   1 699   57.2%
 *     up to  3000 m   1 568   52.3%
 *     up to  4000 m   1 420   48.6%
 *     up to  5000 m   1 239   47.1%
 *
 * The signal dies between 2 and 3 km. Inside 2 km the nearest bathing
 * water is still, by a clear margin, the water beside the campsite;
 * past 2.5 km agreement flattens around half and stops moving, which is
 * what a band of unrelated water looks like. 2 000 m is the last radius
 * whose marginal band still carries signal, so it is where we stop.
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
   * There is no code path that produces a classification without one,
   * because the column is NOT NULL and the view type has no optional
   * here. The page cannot forget to print it; it can only be rewritten
   * to drop it, and a test reads the served HTML for the year.
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
 * 🔴 The season filter is `max(season)` over the table, not a constant
 * compiled in. Next June's import adds 2026 rows beside the 2025 ones
 * and this query follows them without a deploy — while a mixed table,
 * mid-import, still yields exactly one row per campsite rather than one
 * per season.
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
       AND b.season = (SELECT max(season) FROM bathing_waters)
       AND ST_DWithin(${spotLocationExpr}, b.location, ${radiusM})
     ORDER BY ${spotLocationExpr} <-> b.location, b.ref
     LIMIT 1
  )`;
}
