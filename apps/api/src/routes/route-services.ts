// CAMP-113: the pure part of "what services are beside this stage".
//
// 🔴 Separate from routes.service.ts for the reason route-points.ts
// gives: the service imports @nestjs/typeorm, which ships ESM that Jest
// will not parse in this package, so anything reachable only through the
// service has no test while appearing to have one. The SQL builder below
// is exactly the code that must not quietly change — it is what decides
// whether the query is an index scan or a sequential one.

import {
  isRoutePoiKind,
  ROUTE_POI_KINDS,
  type RoutePoiKind,
} from '../osm/route-poi';
import { OVERFETCH } from './route-points';

/** One service beside a stage, or the fact that there is none. */
export interface RouteService {
  kind: RoutePoiKind;
  /** The OSM object, so a reader can check it. `n123` / `w456`. */
  osmRef: string;
  /**
   * 🔴 Null far more often than not, and rendered as "unnamed", never
   * dropped. Measured across the 67 stages of the published library: the
   * nearest drinking water is unnamed at 65 of them, the nearest dump
   * station at 49 of 51, the nearest charger at 28. Hiding the unnamed
   * ones would delete the answer at most stops.
   */
  name: string | null;
  lat: number;
  lon: number;
  /** 🔴 Straight-line metres, like every other distance on a route page. */
  metres: number;
  /** Null where OSM has none, which the page must say out loud. */
  phone: string | null;
  website: string | null;
  /**
   * 🔴 OSM's own syntax, verbatim and untranslated.
   *
   * This project has the scar already: raw OSM `opening_hours` was
   * emitted as schema.org `openingHours` and 2 045 of 2 182 values —
   * 93.7% — were not schema.org syntax. jsonld.ts resolved it with an
   * all-or-nothing translation, and the campsite page shows the original
   * verbatim in a monospace font for everything that does not translate.
   *
   * The same answer applies here and the measurement says so louder.
   * Of the 2 248 490 rows this table holds, 683 603 carry opening hours;
   * of those only 108 574 are `24/7` and 174 557 are a single simple
   * `Mo-Su HH:MM-HH:MM` rule. That is 283 131 — 41.4% — that the
   * repository's existing all-or-nothing grammar can read, and 117 544
   * that contain months, `PH`, `off`, `sunrise` or a quoted comment. So
   * a parser would have to be right about the other 58.6% in order to
   * print "open now" — a claim a driver acts on at 21:40 with a quarter
   * of a tank.
   *
   * We do not print "open now". We print what the map says, labelled as
   * what it is, and let the reader read it.
   */
  openingHours: string | null;
}

export interface RouteServiceGroup {
  lat: number;
  lon: number;
  /** One entry per kind that has something within the radius. Others are absent. */
  services: RouteService[];
}

export interface RouteServiceAnswer {
  groups: RouteServiceGroup[];
  radiusMetres: number;
  perKind: number;
  returned: number;
}

/**
 * 🔴 The per-page ceiling, and it is the ODbL position rather than a
 * layout choice.
 *
 * lib/routes.ts sets our own floor for "Substantial" at 100 objects and
 * the longest published route already shows 28 campsites across its 7
 * stages. Seven kinds at one each adds 49, for 77. At two each it would
 * be 126 — past our own line, on the page whose licence note claims the
 * opposite. There is a test that fails if a route or a kind is added
 * that would push a page over it.
 */
export const MAX_SERVICES_TOTAL = 56;

/**
 * The kinds a caller asked for, narrowed to ones we actually hold.
 *
 * 🔴 A whitelist, not an escape. The kind is written into the SQL as a
 * literal — see buildServicesSql — because a partial index cannot be
 * proven usable against a parameter, and the difference measured on one
 * route page was 9 699 ms against a handful of milliseconds. Anything
 * interpolated into SQL has to come from a closed list, and this is it.
 */
export function parseKinds(raw: unknown): RoutePoiKind[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [...ROUTE_POI_KINDS];
  const asked = raw.split(',').map((s) => s.trim());
  const kept = ROUTE_POI_KINDS.filter((k) => asked.includes(k));
  // An unrecognised list is the full list, never an empty page: a typo in
  // a query string should not look like "this stop has no services".
  return kept.length > 0 ? kept : [...ROUTE_POI_KINDS];
}

/**
 * One query per stage: seven index scans in a UNION ALL, then the
 * nearest of each kind.
 *
 * 🔴 Overfetched and re-sorted, the same as spots.nearby() and
 * routes.near(). `location <-> point` orders by PLANAR degrees because
 * that is what the GiST index holds, and a degree of longitude is 111 km
 * at the equator against about 55 km at Uppsala. On a Swedish stage the
 * planar order can hand back a charger 30 km east ahead of one 20 km
 * north — and this page prints the metres, so the reader would see a
 * list that is not in the order it claims.
 */
export function buildServicesSql(kinds: RoutePoiKind[]): string {
  // 🔴 An empty list is a thrown error, not an empty UNION. `parseKinds`
  // already refuses to return one — a typo falls back to every kind
  // rather than to nothing — but this function is exported, and
  // `cand AS ()` is a syntax error that would surface as a 500 from a
  // route page at build time rather than as the mistake it is.
  if (kinds.length === 0) {
    throw new Error('route-services: asked for no kinds at all');
  }

  const blocks = kinds.map((kind) => {
    // Belt and braces: the list above is already closed, and this is the
    // line that would matter if somebody widened it.
    if (!isRoutePoiKind(kind)) {
      throw new Error(`route-services: unknown kind ${JSON.stringify(kind)}`);
    }
    return `(SELECT '${kind}'::text AS kind, r.osm_ref, r.name, r.location,
                    r.phone, r.website, r.opening_hours
               FROM osm_route_poi r
              WHERE r.kind = '${kind}'
              ORDER BY r.location <-> (SELECT g FROM here)
              LIMIT $3)`;
  });

  return `WITH here AS (
            SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326) AS g
          ),
          cand AS (
            ${blocks.join('\n            UNION ALL\n            ')}
          ),
          measured AS (
            SELECT c.kind, c.osm_ref, c.name, c.phone, c.website, c.opening_hours,
                   ST_Y(c.location) AS lat, ST_X(c.location) AS lon,
                   ST_Distance(c.location::geography,
                               (SELECT g FROM here)::geography) AS metres
              FROM cand c
          )
          SELECT DISTINCT ON (kind) *
            FROM measured
           WHERE metres <= $4
           ORDER BY kind, metres`;
}

/** How many candidates each kind's index walk fetches before re-sorting. */
export const servicesOverfetch = (perKind: number) => perKind * OVERFETCH;
