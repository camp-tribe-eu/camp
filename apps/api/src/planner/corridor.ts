// CAMP-46: the corridor a trip is cut along, and the ONE place that says how
// far along it a campsite is.
//
// 🔴 THERE IS NO ROUTER. Every distance below is a straight line on a sphere:
// the great-circle arc from A to B, and a campsite's position on it. It is not
// a road, and it is not time. `measure: 'straight'` travels with every figure
// built from it (itinerary.ts) so that nothing downstream can print "85 km"
// without the word that qualifies it, and no "hours at the wheel" can be
// computed from it.
//
// 🔴 THE SEAM. `splitIntoDays` (split-days.ts) knows `along` — a number of
// metres from the start — and nothing about how it was measured. When a
// router exists (CAMP-42/99, not stood up: the merged EU-27 asks for about
// 145 GB of disk and 63 GB of memory, so the tiles are built on a rented
// machine), the change is one provider here, in corridor-source.ts:
//
//   · `line` becomes the road's geometry (hard-constraints.ts already takes a
//     polyline, and `corridorBox` was written for tens of thousands of
//     vertices),
//   · `metres` becomes the road's length,
//   · `locate` places a point on that road,
//   · `measure` becomes 'road' — and widening the type below makes the
//     compiler find every consumer that has to say so.
//
// The dynamic programme, the scoring and the SQL are not touched.
//
// The arc: PostGIS measures `ST_DWithin` on a `geography` to the great-circle
// ARC between two vertices, not to the line a flat map draws, and the corridor
// rule (hard-constraints.ts) uses exactly that. `locate` uses the same arc, so
// a campsite the corridor kept is located on the line it was kept by.
//
// Sphere, not spheroid: PostGIS measures on the WGS84 spheroid, this on a
// sphere of the mean radius. The two differ by up to about 0.5% on a leg —
// a 100 km figure here can be 100.5 km to PostGIS — which is far below what a
// day's run on a real road will differ from either, and is why none of this
// may be shown to the metre.

import { cross, dot, LonLat, unitVector, Vec3 } from './hard-constraints';

/** The sphere every figure here is on: the IUGG mean Earth radius, metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

/**
 * What a distance is. Only one value exists, on purpose: a `'road'` that
 * nothing can compute would be a promise, not a type. See the seam above.
 */
export type Measure = 'straight';

/** Where a point is, relative to the corridor. Both in metres of `measure`. */
export interface Located {
  /**
   * Metres from the start, along the line. Negative behind the start, more
   * than `metres` beyond the end.
   */
  along: number;
  /** Metres to the side of the line; never negative. */
  offset: number;
}

export interface Corridor {
  /** What the corridor rule cuts candidates along (hard-constraints.ts). */
  line: readonly LonLat[];
  /** Length of the line, in the same unit as `along`. */
  metres: number;
  measure: Measure;
  locate(p: LonLat): Located;
}

export interface CorridorRequest {
  from: LonLat;
  to: LonLat;
}

/** The one thing the planner needs from the world to know where things are. */
export type CorridorProvider = (req: CorridorRequest) => Promise<Corridor>;

const norm = (v: Vec3): number => Math.sqrt(dot(v, v));

/**
 * The great-circle arc from `from` to `to`.
 *
 * Throws for two points that are the same place, or opposite ones: there is
 * no single arc between them. The planner never asks the first (it turns a
 * round trip away before it gets here) and Europe has no example of the
 * second.
 */
export const straightCorridor: CorridorProvider = async ({ from, to }) => {
  const a = unitVector(from);
  const b = unitVector(to);
  const axb = cross(a, b);
  const sin = norm(axb);
  if (!(sin > 1e-12)) {
    throw new Error(
      `corridor: ${JSON.stringify(from)} and ${JSON.stringify(to)} are the ` +
        `same place or opposite ones, so there is no arc between them`,
    );
  }
  // The pole of the great circle: the direction every point on it is
  // perpendicular to.
  const n: Vec3 = [axb[0] / sin, axb[1] / sin, axb[2] / sin];
  const metres = Math.atan2(sin, dot(a, b)) * EARTH_RADIUS_M;
  return {
    line: [from, to],
    metres,
    measure: 'straight',
    locate(p) {
      const v = unitVector(p);
      // Angle along the circle from A to the point's foot on it, signed by
      // which side of A it falls on; and the angle off the circle.
      const along = Math.atan2(dot(n, cross(a, v)), dot(a, v));
      const off = Math.asin(Math.max(-1, Math.min(1, dot(v, n))));
      return {
        along: along * EARTH_RADIUS_M,
        offset: Math.abs(off) * EARTH_RADIUS_M,
      };
    },
  };
};
