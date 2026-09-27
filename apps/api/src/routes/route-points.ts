// CAMP-3 / CAMP-45: the pure rules of the route proximity request.
//
// 🔴 A separate file from routes.service.ts, for the reason spelled out
// at the top of spots/canonical.ts — and learned again here by watching
// the test fail.
//
// The service imports @nestjs/typeorm, which ships as ESM. Jest runs
// CommonJS in this package and will not parse it, so a spec that reached
// these functions through the service could not run AT ALL:
//
//   SyntaxError: Unexpected token 'export'
//     at Object.<anonymous> (routes/routes.service.ts:2:1)
//
// Which means the caps and the coordinate parsing — the two things here
// that must never quietly change behaviour — would have had no test,
// while appearing to have one.

/**
 * 🔴 The ODbL boundary, as numbers.
 *
 * `MAX_TOTAL` is the one that matters. ODbL's "Substantial" is not
 * defined as a row count, and pretending it is would be false precision
 * — but the direction is not in doubt, and our own legal note draws the
 * line at "fewer than 100 objects chosen by our own criteria". So the
 * server refuses to assemble a hundred. The real pages ask for far less:
 * the longest route here has 7 stages at 4 each, which is 28.
 *
 * A cap that lives in the caller is a cap the next caller will not have.
 */
export const MAX_PER_POINT = 8;
export const MAX_TOTAL = 96;
export const MAX_POINTS = 12;
export const DEFAULT_PER_POINT = 4;
export const DEFAULT_RADIUS_M = 25_000;
export const MAX_RADIUS_M = 60_000;
export const MIN_RADIUS_M = 1_000;

/**
 * 🔴 How much wider than `perPoint` the index walk goes, and why it must.
 *
 * `location <-> point` on a geometry column orders by PLANAR degrees,
 * because that is what the GiST index holds. A degree of longitude is
 * 111 km at the equator and about 55 km at Uppsala, so at Nordic
 * latitudes the planar ordering is stretched east-west and can hand back
 * a campsite 30 km east ahead of one 20 km north. `spots.nearby()` has
 * the same property; on a route page it would be visible, because the
 * page prints the metres beside each name and they would not be in
 * order.
 *
 * So: walk the index for `perPoint * OVERFETCH` candidates — still an
 * index walk, still bounded — then re-sort those by true spheroid
 * distance and keep the ones asked for.
 */
export const OVERFETCH = 5;

export const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * "46.1603,-1.1511;43.8430,10.5017" → points.
 *
 * 🔴 Anything malformed is DROPPED rather than defaulted. A latitude
 * that failed to parse must not silently become 0, because (0, 0) is a
 * real place in the Gulf of Guinea and the classic way a map ends up
 * drawing a route to nowhere. This project has already published route
 * distances anchored to the wrong town once.
 */
export function parsePoints(raw: unknown): LatLon[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw
    .split(';')
    .map((pair) => pair.split(','))
    .filter((parts) => parts.length === 2)
    .map(([a, b]) => [decimal(a), decimal(b)] as const)
    .filter(
      (pair): pair is readonly [number, number] =>
        pair[0] !== null && pair[1] !== null,
    )
    .map(([lat, lon]) => ({ lat, lon }))
    .filter((p) => p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180)
    .slice(0, MAX_POINTS);
}

/**
 * A plain decimal number, or null.
 *
 * 🔴 A regex rather than `Number()`, and this file's first version got
 * it wrong in exactly the way it warns about elsewhere.
 *
 * `Number('')` is **0**, not NaN. So `"46.16,"` split cleanly into two
 * parts, the empty longitude became 0, and the point sailed past a
 * `Number.isFinite` check as a perfectly valid coordinate on the
 * Greenwich meridian — off the coast of west Africa if the latitude
 * went the same way. `Number(' ')` is 0 too, and `Number('0x10')` is
 * 16, and `Number('1e999')` is Infinity.
 *
 * None of that is hypothetical input from an attacker; it is what a
 * truncated query string looks like. The whole point of dropping
 * malformed coordinates instead of defaulting them is defeated by a
 * parser that treats "nothing" as a number.
 */
function decimal(raw: string): number | null {
  const t = raw.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
