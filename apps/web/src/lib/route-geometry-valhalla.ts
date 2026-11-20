// CAMP-457 (item 4 of the Valhalla checklist): the CONSUMER of road routing.
//
// No server, no tiles and no deployment belong to this file. It is the
// client that will talk to Valhalla when somebody starts one, and until
// then nothing constructs it: `routeGeometryProvider()` hands it out only
// when BOTH `ROUTING_PROVIDER=valhalla` and `VALHALLA_URL` are set.
//
// 🔴 THE LORRY. Valhalla's `costing: "truck"` is not a camper profile, it
// is a lorry: its defaults are height 4.11 m and weight 21.77 t. A route
// asked for without overrides is routed for a vehicle nobody here drives,
// and it would look entirely plausible. So the request ALWAYS carries the
// reader's own height, width, length and weight, and a vehicle that is not
// four finite positive numbers is REFUSED (`kind: "vehicle"`) before any
// request is made. Leaving a field out is not "use the default": it is
// "use the lorry".
//
// 🔴 NO STRAIGHT LINE IN DISGUISE. Every failure — timeout, refused
// connection, non-200, a body that is not a route — throws a
// `RouteGeometryError`. This class never returns a line it did not get from
// the engine. Falling back to the straight line, and saying so, is the
// CALLER's decision (`measureRoute` in routes.ts), because only the caller
// knows what the page may print.

import type {
  RoadGeometry,
  RoadLeg,
  RouteGeometryProvider,
  RouteGeometryResult,
  VehicleDims,
  Waypoint,
} from './route-geometry';

export type RouteGeometryErrorKind =
  | 'vehicle'
  | 'timeout'
  | 'network'
  | 'http'
  | 'shape';

/** The one error this module throws. Named, so a caller can tell it from a bug. */
export class RouteGeometryError extends Error {
  readonly kind: RouteGeometryErrorKind;
  constructor(kind: RouteGeometryErrorKind, message: string) {
    super(message);
    this.name = 'RouteGeometryError';
    this.kind = kind;
  }
}

export const VALHALLA_TIMEOUT_MS = 8_000;

export interface ValhallaOptions {
  /** Base URL of the Valhalla service, no trailing path. */
  baseUrl: string;
  /** The vehicle the road is computed for. Required: there is no safe default. */
  vehicle: VehicleDims;
  timeoutMs?: number;
  /** For tests. Read at call time, so a stub installed later is honoured. */
  fetchImpl?: typeof fetch;
}

/**
 * Decode a polyline with 6 decimal digits (Valhalla's `shape`) into
 * GeoJSON-order [lon, lat] pairs.
 *
 * Valhalla encodes (lat, lon) at 1e6 — Google's algorithm with a different
 * precision. Using the 1e5 decoder is the classic mistake and yields a
 * route 10× too close to the origin.
 */
export function decodePolyline6(encoded: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) {
        throw new RouteGeometryError('shape', 'truncated polyline in the response');
      }
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

const positive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Refuse a vehicle that would let Valhalla fall back to its lorry defaults. */
export function assertVehicle(v: VehicleDims): void {
  for (const k of ['heightM', 'widthM', 'lengthM', 'weightT'] as const) {
    if (!positive(v[k])) {
      throw new RouteGeometryError(
        'vehicle',
        `vehicle ${k} must be a positive number, got ${String(v[k])}`,
      );
    }
  }
}

interface ValhallaSummary {
  length?: unknown;
  time?: unknown;
  has_toll?: unknown;
  has_ferry?: unknown;
  has_highway?: unknown;
}
interface ValhallaLeg {
  shape?: unknown;
  summary?: ValhallaSummary;
}

export class ValhallaRouteGeometry implements RouteGeometryProvider {
  readonly id = 'valhalla';
  constructor(private readonly opts: ValhallaOptions) {}

  /** The JSON body, exposed so a test can read exactly what is sent. */
  requestBody(waypoints: Waypoint[]): Record<string, unknown> {
    const { vehicle } = this.opts;
    return {
      locations: waypoints.map((w) => ({ lat: w.lat, lon: w.lon, type: 'break' })),
      costing: 'truck',
      costing_options: {
        truck: {
          height: vehicle.heightM,
          width: vehicle.widthM,
          length: vehicle.lengthM,
          weight: vehicle.weightT,
        },
      },
      units: 'kilometers',
      directions_options: { units: 'kilometers' },
    };
  }

  async road(waypoints: Waypoint[]): Promise<RouteGeometryResult> {
    assertVehicle(this.opts.vehicle);
    if (waypoints.length < 2) {
      throw new RouteGeometryError('shape', 'a road needs at least two waypoints');
    }
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/route`;
    const timeoutMs = this.opts.timeoutMs ?? VALHALLA_TIMEOUT_MS;
    const doFetch = this.opts.fetchImpl ?? globalThis.fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.requestBody(waypoints)),
        signal: ctl.signal,
      });
    } catch (e) {
      if (ctl.signal.aborted) {
        throw new RouteGeometryError('timeout', `Valhalla did not answer within ${timeoutMs} ms`);
      }
      throw new RouteGeometryError('network', `Valhalla unreachable: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status !== 200) {
      throw new RouteGeometryError('http', `Valhalla answered HTTP ${res.status}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new RouteGeometryError('shape', 'Valhalla answered 200 with a body that is not JSON');
    }
    return { available: true, geometry: this.parse(body, waypoints.length - 1) };
  }

  private parse(body: unknown, expectedLegs: number): RoadGeometry {
    const trip = (body as { trip?: { legs?: ValhallaLeg[] } } | null)?.trip;
    const legs = trip?.legs;
    if (!Array.isArray(legs) || legs.length !== expectedLegs) {
      throw new RouteGeometryError(
        'shape',
        `expected ${expectedLegs} legs, got ${Array.isArray(legs) ? legs.length : 'none'}`,
      );
    }
    const line: [number, number][] = [];
    const outLegs: RoadLeg[] = [];
    let km = 0;
    let sec = 0;
    for (const leg of legs) {
      const s = leg.summary;
      if (typeof leg.shape !== 'string' || !s || !positive(s.length) || !positive(s.time)) {
        throw new RouteGeometryError('shape', 'a leg has no shape, length or time');
      }
      const pts = decodePolyline6(leg.shape);
      if (pts.length < 2) throw new RouteGeometryError('shape', 'a leg has fewer than two points');
      // The joint between two legs is the same point twice; keep one.
      line.push(...(line.length > 0 ? pts.slice(1) : pts));
      km += s.length;
      sec += s.time;
      outLegs.push({
        metres: s.length * 1000,
        seconds: s.time,
        hasToll: s.has_toll === true,
        hasFerry: s.has_ferry === true,
        hasHighway: s.has_highway === true,
      });
    }
    return {
      line,
      metres: km * 1000,
      seconds: sec,
      engine: 'Valhalla',
      legs: outLegs,
      vehicle: this.opts.vehicle,
    };
  }
}
