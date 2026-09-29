// CAMP-154: which OpenStreetMap fuel point a published price belongs to.
//
// 🔴 THIS IS THE FILE THAT CAN PRINT THE WRONG PRICE ON THE RIGHT
// FORECOURT, WHICH IS WORSE THAN PRINTING NOTHING.
//
// The whole card rests on one sentence: park4night shows you a filling
// station, we show the price of a litre beside it. That sentence is
// only worth making if the litre and the station are the same place. A
// national average misread as a pump price misleads by one kind of
// error; a neighbouring station's price printed under this station's
// name misleads by a subtler one, because it looks exactly right.
//
// So the join is deliberately conservative in three ways, and each of
// them costs matches on purpose:
//
//   1. A RADIUS, NOT A NEAREST-NEIGHBOUR. `ORDER BY location <-> p
//      LIMIT 1` always returns something. Over Spain's 11 496 stations
//      it would return 11 496 answers including one 40 km away on a
//      different road. Beyond MATCH_RADIUS_M the answer is "no match",
//      and the page then says we have no price for that forecourt.
//
//   2. ONE-TO-ONE. Two source stations either side of a dual
//      carriageway are two forecourts with two prices and usually one
//      OSM node between them. Without an assignment rule they both
//      claim it and the page shows whichever the planner returned
//      first. `assignOneToOne` below gives the node to the nearer of
//      the two and leaves the other unmatched; the unique index in the
//      migration makes a regression here a failed import.
//
//   3. SAME COUNTRY. The candidate query filters on `country`, which is
//      NOT NULL on osm_route_poi by CAMP-118's design. Along the
//      Ventimiglia border a French station and an Italian one are 300 m
//      apart, and the two feeds disagree by 20 cents because the taxes
//      differ.
//
// 🔴 NO NEST IMPORTS — same rule as osm/route-poi.ts and
// routes/route-services.ts. The assignment is the part that must not
// quietly change, so it lives where Jest can reach it.

/** A candidate pairing, before any of them is accepted. */
export interface MatchCandidate {
  /** `${source}:${stationRef}` — unique across all three feeds. */
  stationKey: string;
  osmRef: string;
  metres: number;
}

export interface Assignment {
  stationKey: string;
  osmRef: string;
  metres: number;
}

/**
 * 🔴 HOW FAR A PUBLISHED STATION MAY BE FROM ITS OSM POINT — 150 m.
 *
 * Measured, not chosen. See `report-coverage.ts`, which prints the
 * distance distribution this number was read off. The two datasets
 * disagree about where a forecourt is for ordinary reasons: the
 * ministry geocodes the postal address (often the street entrance) and
 * OSM puts the node on the pumps or draws the whole site as a way whose
 * centroid is the shop. 150 m covers that and does not reach the next
 * station: measured 28.09.2026 across the three countries, the median
 * gap between an OSM fuel point and its SECOND-nearest OSM fuel point
 * is far larger than this, and the matches gained between 150 m and
 * 300 m are dominated by pairs where a nearer station already took the
 * obvious point.
 *
 * Raising it is not free and not symmetric: a wider radius adds matches
 * at the edges of towns, where fuel stations cluster, which is exactly
 * where a wrong match is most likely and least visible.
 */
export const MATCH_RADIUS_M = 150;

/**
 * How many OSM points each station's index walk considers.
 *
 * Six, because one-to-one assignment needs somewhere to fall back to: a
 * station whose nearest point is taken by a nearer station should get
 * its second choice rather than nothing. Six covers the densest
 * forecourt clusters measured inside 150 m; a station with more than
 * six OSM fuel points within 150 m is a mapping artefact, not a place.
 */
export const MATCH_CANDIDATES = 6;

/**
 * Greedy one-to-one assignment, shortest edge first.
 *
 * 🔴 Greedy rather than optimal, and the reason is that "optimal" is
 * the wrong objective here. A minimum-cost perfect matching would
 * happily pair a station with a point 149 m away in order to let
 * another station take the 3 m one — trading a certainly-correct match
 * for two doubtful ones, to minimise a total that nobody reads. Taking
 * the shortest edges first means the confident pairs are made first and
 * the doubt is pushed to the end, where it ends as "no match" — the
 * answer the page can state honestly.
 *
 * 🔴 The sort is total: distance, then station key, then OSM ref. Two
 * candidates at exactly the same distance are not unheard of (a source
 * that files the same coordinate for two adjacent bays), and a
 * comparator that left them tied would make the import's output depend
 * on the order the database happened to return rows in. A re-run must
 * produce the same assignment or the coverage numbers mean nothing.
 */
export function assignOneToOne(candidates: MatchCandidate[]): Assignment[] {
  const sorted = [...candidates].sort(
    (a, b) =>
      a.metres - b.metres ||
      (a.stationKey < b.stationKey
        ? -1
        : a.stationKey > b.stationKey
          ? 1
          : 0) ||
      (a.osmRef < b.osmRef ? -1 : a.osmRef > b.osmRef ? 1 : 0),
  );

  const takenStations = new Set<string>();
  const takenPoints = new Set<string>();
  const out: Assignment[] = [];

  for (const c of sorted) {
    // 🔴 Belt and braces against a caller that widened the SQL radius
    // without widening this constant. The two are read from the same
    // export, but this function is exported and testable on its own.
    if (c.metres > MATCH_RADIUS_M) continue;
    if (takenStations.has(c.stationKey) || takenPoints.has(c.osmRef)) continue;
    takenStations.add(c.stationKey);
    takenPoints.add(c.osmRef);
    out.push({ stationKey: c.stationKey, osmRef: c.osmRef, metres: c.metres });
  }

  return out;
}

/**
 * The candidate query.
 *
 * 🔴 A LATERAL over the staging table, so the per-station lookup uses
 * the partial GiST index `idx_osm_route_poi_fuel`. `kind = 'fuel'` is
 * written as a literal for the reason the RoutePoi migration spends
 * thirty lines on: a partial index is only usable when the planner can
 * prove the query's quals imply its predicate, and it cannot prove that
 * against a parameter. The same mistake cost 9 699 ms on one route page.
 *
 * 🔴 `location <-> p.location` orders by PLANAR degrees, which is what
 * the GiST index holds, and a degree of longitude is 111 km at the
 * equator against 79 km at Narbonne. So the walk overfetches and
 * `ST_Distance(::geography)` gives the metres that are actually
 * compared against the radius — the same overfetch-and-re-sort
 * spots.nearby(), routes.near() and route-services all use.
 */
export function buildCandidateSql(): string {
  return `
    SELECT s.station_key,
           n.osm_ref,
           ST_Distance(s.location::geography, n.location::geography) AS metres
      FROM fuel_station_staging s
      JOIN LATERAL (
             SELECT r.osm_ref, r.location
               FROM osm_route_poi r
              WHERE r.kind = 'fuel'
                AND r.country = s.country
              ORDER BY r.location <-> s.location
              LIMIT $1
           ) n ON true
     WHERE ST_Distance(s.location::geography, n.location::geography) <= $2
  `;
}
