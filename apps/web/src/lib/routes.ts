// CAMP-3 / CAMP-45: reading the curated routes, and fetching the
// campsites that sit beside them.
//
// The routes themselves are a typed data file (src/data/routes). This
// module is everything the pages need on top of that: lookup, the
// derived numbers we are allowed to state, and the one API call.

import { apiFetch, type Amenities, type Spot } from './api';
import { CURATED_ROUTES } from '@/data/routes';
import type { CuratedRoute } from './route-types';
import {
  formatKm,
  routeGeometryProvider,
  straightLineLegs,
  type RouteGeometryResult,
} from './route-geometry';
import type { SpotSource } from './sources';

export type { CuratedRoute, RouteStage } from './route-types';
export { TRAVELLER_LABEL, TRAVELLER_TAGS } from './route-types';

export const ROUTES = CURATED_ROUTES;

export function getRoutes(): CuratedRoute[] {
  return CURATED_ROUTES;
}

export function getRoute(slug: string): CuratedRoute | null {
  return CURATED_ROUTES.find((r) => r.slug === slug) ?? null;
}

// ── the campsites beside a route ─────────────────────────────────────────

/**
 * 🔴 How many campsites a route page may show, per stage.
 *
 * This number is a legal position, not a layout preference. A route page
 * is a Produced Work under ODbL §4.5(a) — we attribute OpenStreetMap,
 * share-alike does not reach our own text, the page stays ours — and
 * that holds because the page presents a small handful of objects picked
 * by our editorial criteria rather than a systematic extract of the
 * database. A page that listed every campsite in Tuscany would be a
 * Substantial extract and a different act entirely.
 *
 * Four per stage, capped again server-side (MAX_TOTAL in the API's
 * routes.service.ts). The longest route here has seven stages, so the
 * largest page shows 28 — measured, not assumed, and there is a test
 * that fails if a route is ever added that would push a page over the
 * ceiling.
 */
export const CAMPSITES_PER_STAGE = 4;

/**
 * The count below which our own legal note says a selection is not
 * "Substantial". Used by the test, not by the request: the point is that
 * no page can approach it, not that we stop at 99.
 */
export const ODBL_SUBSTANTIAL_FLOOR = 100;

/** How far from a stage we will look. Beyond this it is not "near the route". */
export const STAGE_RADIUS_M = 25_000;

export interface RouteNeighbour {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  /**
   * 🔴 The campsite's page, as the API's own `canonicalPath` builds it.
   *
   * Never rebuilt here. The rule strips accents, and a second
   * implementation of it in the web layer produced links that 404 on
   * every accented region — most of Croatia, Latvia, Estonia and a
   * great deal of France. Null when the campsite has no region and so
   * no page; such a campsite is not linked.
   */
  path: string | null;
  type: Spot['type'];
  lat: number;
  lon: number;
  /** 🔴 Straight-line metres. Never a driving distance — see route-geometry.ts. */
  metres: number;
  amenities: Amenities;
  sources: SpotSource[];
}

export interface StageNeighbours {
  lat: number;
  lon: number;
  spots: RouteNeighbour[];
}

interface NearAnswer {
  groups: StageNeighbours[];
  perPoint: number;
  radiusMetres: number;
  returned: number;
}

/**
 * 🔴 THREE STATES, NOT TWO — the same third state `getRouteServices`
 * gained in CAMP-113, and for the same reason.
 *
 * This used to return `StageNeighbours[]`, with an empty `spots` array
 * per stage on ANY failure: a dead API, a 500, a group-count mismatch.
 * The route page then printed, under every stage, "Our database holds no
 * campsite within 25 km of this stop." That is a statement about the
 * ground made by code that never looked at it. "We looked and there is
 * nothing" and "we did not look" arrived at the page as the same empty
 * array, so the page had no way to tell them apart.
 *
 * So the answer carries whether we actually looked. `looked: false`
 * means the page says so in one line per stop instead of inventing an
 * absence; `looked: true` with an empty `spots` is the genuine "we
 * checked, and our database holds nothing within the radius" — which is
 * a real and publishable fact and must keep being said.
 */
export interface RouteNeighboursResult {
  looked: boolean;
  groups: StageNeighbours[];
}

/**
 * Campsites beside every stage of one route, in one request.
 *
 * 🔴 One request for the whole page, not one per stage. The build
 * renders every route page and the API throttles per caller; seven
 * separate calls per page would be 84 requests for the section where
 * this is 12. The API endpoint takes the whole point list for exactly
 * this reason.
 *
 * Does not throw on failure: it returns `looked: false` with a
 * stage-shaped, empty set of groups, so the page keeps its layout. A
 * route page without its campsite list is a page with less on it; a
 * route page that throws is a build that produces nothing — and this
 * project has already shipped one silent build truncation (CAMP-69).
 * What the failure must never do is reach the reader as an empty list.
 */
export async function getRouteNeighbours(
  route: CuratedRoute,
): Promise<RouteNeighboursResult> {
  const unlooked: RouteNeighboursResult = {
    looked: false,
    groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, spots: [] })),
  };
  const points = route.stages
    .map((s) => `${s.lat},${s.lon}`)
    .join(';');

  try {
    const res = await apiFetch(
      `/routes/near?points=${encodeURIComponent(points)}` +
        `&perPoint=${CAMPSITES_PER_STAGE}&radius=${STAGE_RADIUS_M}`,
      // Campsite data changes at most weekly (CAMP-28); daily is already
      // far more often than the ground moves.
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return unlooked;
    const answer = (await res.json()) as NearAnswer;
    // 🔴 An answer with the wrong number of groups is not merged by
    // index. Silently pairing stage 3 with stage 4's campsites is
    // exactly the "anchored to the wrong town" failure this section is
    // supposed to have learned from.
    if (!Array.isArray(answer?.groups) || answer.groups.length !== route.stages.length) {
      return unlooked;
    }
    // 🔴 A group we cannot read is not an empty group. Treating a
    // `spots` that is missing or not a list as "no campsites" would be
    // the same lie one level down.
    if (answer.groups.some((g) => !Array.isArray(g?.spots))) return unlooked;
    // 🔴 THE RADIUS WE ASKED FOR IS THE RADIUS WE PRINT.
    //
    // The page says "within 25 km" beside every stop, and the API clamps
    // `radius` to its own ceiling. Were STAGE_RADIUS_M ever raised above
    // it, every one of those sentences would be false while everything
    // still rendered. The answer says what was actually applied, so it is
    // compared rather than assumed — and a mismatch is a failure to look
    // at what we claim to have looked at. Same check, same reason, as
    // `getRouteServices`.
    if (answer.radiusMetres !== STAGE_RADIUS_M) return unlooked;
    return { looked: true, groups: answer.groups };
  } catch {
    return unlooked;
  }
}

// ── what the page may state, and what it may not ─────────────────────────

export interface RouteMeasurements {
  /** Straight-line metres between consecutive stages. */
  legs: number[];
  /** Their sum. 🔴 NOT the length of the route — see the label rules below. */
  straightLineTotal: number;
  /** Nights across all stages. */
  nights: number;
  /** The road answer, which today is always "not available". */
  road: RouteGeometryResult;
}

/**
 * Everything numeric a route page is allowed to print.
 *
 * 🔴 Assembled in one place so that the honest label travels with the
 * number. `straightLineTotal` is named what it is; `road` carries its
 * own unavailability and its own reason, so a page cannot print a road
 * figure by accident — there is no field holding one.
 */
export async function measureRoute(
  route: CuratedRoute,
): Promise<RouteMeasurements> {
  const { legs, total } = straightLineLegs(route.stages);
  const road = await routeGeometryProvider().road(route.stages);
  return {
    legs,
    straightLineTotal: total,
    nights: route.stages.reduce((a, s) => a + s.nights, 0),
    road,
  };
}

/**
 * 🔴 The words that must accompany a straight-line number, in one place.
 *
 * Exported and used by both the route page and the index card, because
 * the failure mode is a number appearing on one surface without its
 * qualifier. There is a test asserting the rendered page contains this
 * phrase wherever it prints the total.
 */
export const STRAIGHT_LINE_LABEL = 'in a straight line';

export { formatKm };

/** "10 days · 9 nights · 3 countries" — the spine of a route card. */
export function routeShape(route: CuratedRoute): string {
  const nights = route.stages.reduce((a, s) => a + s.nights, 0);
  const countries = route.countries.length;
  return [
    `${route.days} days`,
    `${nights} ${nights === 1 ? 'night' : 'nights'}`,
    `${countries} ${countries === 1 ? 'country' : 'countries'}`,
  ].join(' · ');
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * [4,5,6,9,10] → "Apr–Jun, Sep–Oct". [11,12,1,2,3] → "Nov–Mar".
 *
 * 🔴 Wraps across the year end, because a winter route's months do. The
 * first version printed the Andalusian winter route as "Jan–Mar, Nov–Dec",
 * which is two separate seasons rather than the one continuous one it is.
 */
export function formatMonths(months: number[]): string {
  const set = new Set(months);
  if (set.size === 0) return '';
  if (set.size === 12) return 'All year';

  // Find a month that starts a run: in the set, with the previous month
  // not in it. Walking from there handles the December→January wrap.
  const prev = (m: number) => (m === 1 ? 12 : m - 1);
  const next = (m: number) => (m === 12 ? 1 : m + 1);
  const starts = [...set].filter((m) => !set.has(prev(m))).sort((a, b) => a - b);

  return starts
    .map((start) => {
      let end = start;
      while (set.has(next(end)) && next(end) !== start) end = next(end);
      return start === end
        ? MONTH_SHORT[start - 1]
        : `${MONTH_SHORT[start - 1]}–${MONTH_SHORT[end - 1]}`;
    })
    .join(', ');
}

/** Every country code used across the library, for the index filter. */
export function allRouteCountries(routes = CURATED_ROUTES): string[] {
  return [...new Set(routes.flatMap((r) => r.countries))].sort();
}
