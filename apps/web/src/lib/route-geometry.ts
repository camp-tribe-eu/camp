// CAMP-3 / CAMP-45: where road geometry comes from, and what we say
// while it comes from nowhere.
//
// 🔴 THE CONSTRAINT THIS FILE EXISTS FOR.
//
// A route page wants three things we cannot produce today: the line the
// road actually takes, how many kilometres it is, and how long it takes
// to drive. All three need a routing engine. Ours is Valhalla (CAMP-42),
// which needs a VPS that is not paid for yet (CAMP-99), so there is no
// engine to ask.
//
// The obvious alternative is a third-party routing API, and it is ruled
// out on purpose rather than by oversight. Self-hosting is precisely
// what keeps CC-BY-SA off our geometry: a route line computed by
// somebody else's service arrives with somebody else's licence attached,
// and it would then be attached to every page that draws it. We are
// building a Produced Work under ODbL §4.5(a) — attribution, no
// share-alike, our content stays ours — and a borrowed polyline would
// undo that for the sake of a number.
//
// 🔴 So the number is absent. Not estimated, not "approximately",
// not a straight line quietly relabelled as a drive.
//
// This project has been burned by exactly the opposite move twice:
// `maximumAttendeeCapacity` published pitches as people, and a set of
// route distances were anchored to the wrong town and looked entirely
// plausible. A plausible invented number is worse than an empty slot,
// because nobody goes looking for it afterwards. An empty slot with a
// sentence saying why is a promise we can keep.
//
// ─────────────────────────────────────────────────────────────────────
// 🔴 HOW TO SWITCH THIS ON — ONE LINE, AND IT IS NAMED.
//
// When Valhalla is running, write ONE implementation of
// `RouteGeometryProvider` (e.g. `ValhallaRouteGeometry` in
// `lib/route-geometry-valhalla.ts`) and change the single `return`
// inside `routeGeometryProvider()` at the bottom of this file to return
// it. Nothing else changes: the page already asks this module for the
// geometry, already renders the road line when `available` is true, and
// already prints the road distance and the driving time from the same
// answer. There is no second call site and no second switch.
// ─────────────────────────────────────────────────────────────────────

/** One point on the ground. Order is (lat, lon) — as people write it. */
export interface Waypoint {
  lat: number;
  lon: number;
}

/**
 * What a real routing engine gives back.
 *
 * `line` is GeoJSON order — [lon, lat] — because it goes straight into a
 * LineString and MapLibre reads it from there. The mismatch with
 * `Waypoint` above is deliberate and annotated rather than tidied away:
 * GeoJSON is longitude-first by specification, and silently "fixing" it
 * is how a route ends up drawn in the Indian Ocean.
 */
export interface RoadGeometry {
  /** The road line, GeoJSON [lon, lat] pairs. */
  line: [number, number][];
  /** Road distance in metres — what the wheels cover, not the crow. */
  metres: number;
  /** Driving time in seconds, as the engine models it. */
  seconds: number;
  /** Which engine produced this, for the attribution line on the page. */
  engine: string;
}

/**
 * The answer, which is allowed to be "no".
 *
 * 🔴 A discriminated union rather than `RoadGeometry | null`. `null`
 * would let a caller write `geometry?.metres ?? 0` and print a confident
 * zero; this shape has no member to reach through, so a caller that
 * forgets the unavailable case does not compile.
 */
export type RouteGeometryResult =
  | { available: true; geometry: RoadGeometry }
  | { available: false; reason: string };

export interface RouteGeometryProvider {
  /** Stable id, so a page can say which engine drew the line. */
  readonly id: string;
  /**
   * The road through these waypoints, in order.
   *
   * Async because every real implementation is a network call to a
   * routing service we host. The null one is async too, so that turning
   * the real one on changes no call site's shape.
   */
  road(waypoints: Waypoint[]): Promise<RouteGeometryResult>;
}

/**
 * The honest nothing.
 *
 * 🔴 It reports unavailable, always, and it says why in words a reader
 * can be shown. It does NOT fall back to a straight line: a straight
 * line between two towns is a real measurement we are happy to publish
 * (see `straightLineMetres`), but it is a different measurement, and a
 * provider called "geometry" handing one back is how it would end up
 * labelled as a drive.
 */
export class NullRouteGeometry implements RouteGeometryProvider {
  readonly id = 'none';

  // The parameter is accepted and ignored. Declaring it keeps the
  // signature identical to the interface, so swapping a real provider in
  // is a one-line change at the factory below and not a hunt for call
  // sites that typecheck differently.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async road(_waypoints: Waypoint[]): Promise<RouteGeometryResult> {
    return {
      available: false,
      reason:
        'Road distance and driving time need our own routing engine, which is not running yet.',
    };
  }
}

/**
 * The provider the whole site uses.
 *
 * 🔴 THE SINGLE WIRING CHANGE. Replace the `return` below with the real
 * provider and every route page gains its road line, its road distance
 * and its driving time. See the header of this file.
 */
export function routeGeometryProvider(): RouteGeometryProvider {
  return new NullRouteGeometry();
}

// ── what we CAN measure, and what it is called ───────────────────────────

/** Mean Earth radius, metres — the figure the haversine formula assumes. */
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Straight-line distance between two points, in metres.
 *
 * 🔴 This is a great-circle distance and nothing else. It is the same
 * measurement the campsite pages already publish for "distance to the
 * nearest town", and they label it "in a straight line" every single
 * time for the same reason: on a mountain road the drive can be double
 * it, and a reader who reads it as a drive has been misled by us.
 *
 * Every surface that shows this number must carry that label. There is a
 * test asserting the page does.
 */
export function straightLineMetres(a: Waypoint, b: Waypoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The straight-line distances between consecutive stages, and their sum.
 *
 * 🔴 `total` is explicitly NOT the length of the route. It is the sum of
 * the hops as the crow flies, which is a lower bound on the driving
 * distance and never equal to it. The page says so in those words; this
 * function is named `straightLine…` so that a future caller cannot reach
 * for it thinking it is anything else.
 */
export function straightLineLegs(stages: Waypoint[]): {
  legs: number[];
  total: number;
} {
  const legs: number[] = [];
  for (let i = 1; i < stages.length; i += 1) {
    legs.push(straightLineMetres(stages[i - 1], stages[i]));
  }
  return { legs, total: legs.reduce((a, b) => a + b, 0) };
}

/** 84 213 → "84 km". Kilometres only: metre precision on a 200 km hop is noise. */
export function formatKm(metres: number): string {
  return `${Math.round(metres / 1000).toLocaleString('en-GB')} km`;
}
