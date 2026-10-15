// CAMP-113: the pure part of "what services are beside this stage".
//
// 🔴 Separate from routes.service.ts for the reason route-points.ts
// gives: the service imports @nestjs/typeorm, which ships ESM that Jest
// will not parse in this package, so anything reachable only through the
// service has no test while appearing to have one. The SQL builder below
// is exactly the code that must not quietly change — it is what decides
// whether the query is an index scan or a sequential one.

import {
  isRestStopKind,
  isRoutePoiKind,
  ROUTE_POI_KINDS,
  SERVICES_PER_KIND,
  type RoutePoiKind,
} from '../osm/route-poi';
import { type FacilityState } from '../osm/route-poi-facilities';
import { DEFAULT_PER_POINT, OVERFETCH } from './route-points';
// CAMP-154: the three sources whose licences permit us to republish a
// per-station price. A closed list, and the only one the query may serve.
import { SOURCES } from '../fuel/stations';

/**
 * CAMP-119: what OpenStreetMap says about the five facilities a driver
 * asks a rest area about. Each is one of THREE words, and the third is a
 * value rather than an absence: `unknown` is "nobody wrote it down", and
 * it is never `no`.
 *
 * 🔴 The keys are camelCase because this is JSON; the database columns
 * they come from are in FACILITY_FIELDS, one place, so the SELECT, the
 * mapping and the spec that compares them with the migration cannot
 * disagree about which column is which.
 *
 * 🔴 There is no field for how CLEAN or WORKING a toilet is. That is what
 * the owner said decides the stop, it is not in open data, and it will
 * arrive as community reviews (CAMP-53) or not at all. A field here that
 * could carry a score would be the first place an invented one appeared.
 */
export interface RouteServiceFacilities {
  toilets: FacilityState;
  shower: FacilityState;
  drinkingWater: FacilityState;
  /** `sanitary_dump_station` on the place itself, not the nearest dump point. */
  dumpStation: FacilityState;
  fee: FacilityState;
}

/**
 * The five columns, and the key each is sent under. Written as data so
 * the SQL, the row mapping and the spec read one list.
 */
export const FACILITY_FIELDS = [
  { key: 'toilets', column: 'toilets' },
  { key: 'shower', column: 'shower' },
  { key: 'drinkingWater', column: 'drinking_water' },
  { key: 'dumpStation', column: 'sanitary_dump_station' },
  { key: 'fee', column: 'fee' },
] as const satisfies readonly {
  key: keyof RouteServiceFacilities;
  column: string;
}[];

/**
 * One facility column → the word a reader is told.
 *
 * 🔴 TOTAL, AND FAIL-SAFE IN ONE DIRECTION. Only the exact strings `yes`
 * and `no` are answers; everything else — `unknown`, NULL, a missing
 * column from a query that did not select it, a status word a half-
 * deployed migration has not heard of — is `unknown`. The table's CHECK
 * already refuses anything else, so this is the second lock for every
 * caller that is not the table, and it is written so that the one thing
 * it cannot produce from a gap is `no`.
 */
export function readFacilityState(raw: unknown): FacilityState {
  return raw === 'yes' || raw === 'no' ? raw : 'unknown';
}

/** The five facility columns of one row, as the page is sent them. */
export function facilitiesFromRow(
  row: Record<string, unknown>,
): RouteServiceFacilities {
  const out = {} as RouteServiceFacilities;
  for (const f of FACILITY_FIELDS)
    out[f.key] = readFacilityState(row[f.column]);
  return out;
}

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
  /**
   * CAMP-154 — the price of a litre ON THIS FORECOURT, or absent.
   *
   * 🔴 Only ever present on `kind: 'fuel'`, and absent far more often
   * than not. Measured 28.09.2026 against the live route POI layer:
   * we hold a price for 58.2% of Spain's 16 063 OSM fuel points, 42.9%
   * of France's 16 110 and 68.5% of Italy's 27 811 — and for none at
   * all in the other 24 member states, because only these three publish
   * per station on terms that permit commercial reuse (§6).
   *
   * 🔴 This is NOT the CAMP-55 country average, and the page must never
   * let it read as one or vice versa. The average is a national figure
   * for a week; this is one forecourt at one moment, and it carries
   * `measuredAt` and `source` so the page can say which it is showing.
   */
  prices?: RouteFuelStationPrice[];
  /**
   * CAMP-119 — what the place says about toilets, showers, drinking
   * water, a disposal point and a fee. 🔴 Present on `rest_area` and
   * `service_area` and ABSENT on the other seven kinds, and on those two
   * it is always present with all five keys: a stopping place whose
   * facilities were never read is five `unknown`, not a missing object,
   * so a page cannot mistake "no facilities block" for "no facilities".
   */
  facilities?: RouteServiceFacilities;
}

/** One grade's price on one forecourt. */
export interface RouteFuelStationPrice {
  grade: 'diesel' | 'petrol';
  /**
   * 🔴 The source's own product name — `Gazole`, `Gasóleo A`, `SP95`,
   * `E10`, `Benzina (servito)`. France sells 95-octane petrol as both
   * SP95 and E10 at different prices and 5 619 of its stations post only
   * E10, so the page prints this rather than the word "petrol" alone.
   */
  product: string;
  /**
   * 🔴 A STRING, and deliberately not a number.
   *
   * The column is `numeric(6,3)` because these are money — the argument
   * spot_tariffs makes, where the upstream feed literally contained
   * `"2.7999999523162841796875"` for €2.80. Sending it as a float
   * would put the defect back in on the wire, in JSON, on the way to a
   * page whose whole job is to print the figure exactly as published.
   * Nothing between here and the reader converts it.
   */
  price: string;
  /** ISO 8601. When the SOURCE says the price was set, never our fetch. */
  measuredAt: string;
  /** `es-minetur` | `fr-data-economie` | `it-mimit`. */
  source: string;
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
  /**
   * 🔴 True when the total cap stopped this answer short.
   *
   * It exists because an absent service and an unasked-about service
   * render as the same sentence unless somebody says otherwise, and that
   * sentence is "our database holds none within 25 km" — a statement
   * about the ground. Review found the page printing it 49 times from a
   * failed API call. The cap can no longer bind (see MAX_SERVICES_TOTAL)
   * but the flag is on the wire so that a future change to either number
   * cannot reintroduce a silent short answer.
   */
  truncated: boolean;
}

/**
 * Our own floor for "Substantial" under ODbL, mirroring
 * `ODBL_SUBSTANTIAL_FLOOR` in the web app's lib/routes.ts.
 */
export const ODBL_SUBSTANTIAL_FLOOR = 100;

/**
 * 🔴 HOW MANY STAGES A PAGE MAY ASK ABOUT, DERIVED RATHER THAN CHOSEN.
 *
 * This is the constraint the old numbers were hiding. A route page shows
 * `DEFAULT_PER_POINT` campsites AND one of each service kind per stage,
 * so it takes `DEFAULT_PER_POINT + ROUTE_POI_KINDS.length` objects from
 * the database per stage: 4 + 7 = 11 until CAMP-119, 4 + 9 = 13 now. The
 * ODbL Produced Work position rests on staying under 100 of them, which
 * made NINE stages the real ceiling with seven kinds and makes SEVEN the
 * ceiling with nine — not the 12 the points parser allows.
 *
 * 🔴 SEVEN IS ALSO THE LONGEST ROUTE IN THE LIBRARY, so there is no
 * headroom left: an eighth stage on any route is refused by the web
 * suite (`routes.spec.ts`, "no route has more stages than the services
 * endpoint will answer about") before it is ever refused here. That is
 * the intended order — the author is told at commit time, not the reader
 * at build time — and it is a cost of CAMP-119 named here, not hidden.
 *
 * Review found the gap exactly here: the services cap was 56 against an
 * askable 84, so a nine-stage route satisfied the API spec (which
 * compared against a hard-coded 7) and the web spec (36 + 63 = 99 < 100)
 * and then silently lost its ninth stage — printing "our database holds
 * no hotel, motel, hostel or guest house within 25 km of this stop"
 * about a stop nothing had looked at.
 *
 * Deriving it means the day somebody adds an eighth kind, this number
 * drops to 8 on its own and the tests that depend on it say so.
 */
export const MAX_SERVICE_POINTS = Math.floor(
  (ODBL_SUBSTANTIAL_FLOOR - 1) / (DEFAULT_PER_POINT + ROUTE_POI_KINDS.length),
);

/**
 * 🔴 The total cap, set so that it CANNOT bind on a request the API has
 * already accepted.
 *
 * It was 56 against an askable 84. Now it is exactly what
 * `MAX_SERVICE_POINTS` stages of every kind comes to, so a short answer
 * is impossible rather than merely unlikely — and when a caller asks
 * about more stages than that, the answer says `truncated` instead of
 * quietly returning fewer.
 */
export const MAX_SERVICES_TOTAL =
  MAX_SERVICE_POINTS * ROUTE_POI_KINDS.length * SERVICES_PER_KIND;

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
 * `alias.toilets, alias.shower, …` — the five facility columns, from the
 * one list. 🔴 Selected for EVERY kind, because a UNION ALL needs the same
 * columns in every block; only the two stopping places are ever READ for
 * them (see `rowToRouteService`), so the other seven carry five strings
 * that are dropped on the way out.
 */
const FACILITY_COLUMNS_SQL = (alias: string): string =>
  FACILITY_FIELDS.map((f) => {
    // Belt and braces, as for the kinds and the source ids: this is
    // interpolated into SQL and nothing here comes from a request.
    if (!/^[a-z_]+$/.test(f.column)) {
      throw new Error(
        `route-services: unsafe column ${JSON.stringify(f.column)}`,
      );
    }
    return `${alias}.${f.column}`;
  }).join(', ');

/**
 * One query per stage: one index scan per kind in a UNION ALL, then the
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
                    r.phone, r.website, r.opening_hours,
                    ${FACILITY_COLUMNS_SQL('r')}
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
                   ${FACILITY_COLUMNS_SQL('c')},
                   ST_Y(c.location) AS lat, ST_X(c.location) AS lon,
                   ST_Distance(c.location::geography,
                               (SELECT g FROM here)::geography) AS metres
              FROM cand c
          ),
          picked AS (
            SELECT DISTINCT ON (kind) *
              FROM measured
             WHERE metres <= $4
             ORDER BY kind, metres
          )
          SELECT p.*, ${FUEL_PRICE_SUBQUERY} AS prices
            FROM picked p
           ORDER BY p.kind`;
}

/**
 * CAMP-154 — the price of a litre on the fuel point we just picked.
 *
 * 🔴 A correlated subquery on the FINAL row, not a join in `cand`.
 *
 * `cand` holds `$3` candidates PER KIND per stage before the nearest of
 * each kind is chosen; joining prices there would look them up for every
 * candidate we are about to discard. Here it runs once per stage, for
 * one row.
 *
 * 🔴 `p.kind = 'fuel'` short-circuits it for every other kind. A café
 * has no row in `fuel_station_prices` so the result would be null
 * anyway — but "would be null anyway" is one index probe per other kind
 * per stage that exists only to return nothing, and this project has already paid
 * 9 699 ms for one plausible-looking lookup on this table.
 *
 * 🔴 `price_eur::text`. The column is `numeric(6,3)`; `json_build_object`
 * on a numeric emits an unquoted JSON number, which `JSON.parse` turns
 * into a float on the other side and hands to a page that must print
 * what the ministry published. `::text` keeps `1.849` as `"1.849"` all
 * the way to the reader.
 *
 * 🔴 ORDER BY grade, so diesel precedes petrol on every forecourt in
 * every country. Without it the order is whatever the index returns and
 * two stages of the same route can list the two grades the other way
 * round — which reads as a difference between the stations.
 */
/**
 * 🔴 THE SOURCE WHITELIST, IN THE QUERY, NOT ONLY IN THE RENDERER.
 *
 * Review found the refused-country gate living solely in the web app:
 * `displayPrices` drops a price whose `source` has no attribution entry,
 * which protects the route page and nothing else. The API is public.
 * `/routes/services` would have served an Austrian row — a country for
 * which **no consumer licence exists** — to any caller, and the page's
 * silence would have read as our having decided nothing.
 *
 * A permission is a property of the data, so the gate belongs where the
 * data leaves. Literals rather than a parameter for the reason the whole
 * of this file gives: the list is closed, it comes from `SOURCES` in
 * fuel/stations.ts, and nothing in it is reachable from a request.
 */
const SOURCE_IDS = SOURCES.map((s) => {
  // Belt and braces. Nothing here comes from a request, but this string
  // is interpolated into SQL and this repository is public.
  if (!/^[a-z][a-z0-9-]*$/.test(s.id)) {
    throw new Error(`route-services: unsafe source id ${JSON.stringify(s.id)}`);
  }
  return `'${s.id}'`;
}).join(', ');

export const FUEL_PRICE_SUBQUERY = `(
              SELECT json_agg(json_build_object(
                       'grade', f.grade,
                       'product', f.product,
                       'price', f.price_eur::text,
                       'measuredAt', f.measured_at,
                       'source', f.source
                     ) ORDER BY f.grade)
                FROM fuel_station_prices f
               WHERE p.kind = 'fuel'
                 AND f.osm_ref = p.osm_ref
                 AND f.source IN (${SOURCE_IDS})
            )`;

/** How many candidates each kind's index walk fetches before re-sorting. */
export const servicesOverfetch = (perKind: number) => perKind * OVERFETCH;

/**
 * One row of `buildServicesSql` → what the endpoint sends.
 *
 * 🔴 HERE AND NOT INLINE IN routes.service.ts, for the reason this file's
 * header gives: the service imports @nestjs/typeorm, which Jest cannot
 * parse in this package, so a mapping written there has no test while
 * appearing to have one. It was inline until CAMP-119 added a field to
 * it, and a field that decides whether a rest area says "toilets: no" or
 * "toilets: not known" is not one to leave untested.
 */
export function rowToRouteService(r: Record<string, unknown>): RouteService {
  const kind = r.kind as RoutePoiKind;
  return {
    kind,
    osmRef: r.osm_ref as string,
    name: (r.name as string | null) ?? null,
    lat: Number(r.lat),
    lon: Number(r.lon),
    metres: Math.round(Number(r.metres)),
    // 🔴 `?? null`, never `?? ''`. An empty string renders as a blank
    // cell that reads "none"; null is what the page turns into the word
    // "unknown", which is the card's acceptance criterion and the
    // difference between the two facts.
    phone: (r.phone as string | null) ?? null,
    website: (r.website as string | null) ?? null,
    openingHours: (r.opening_hours as string | null) ?? null,
    // CAMP-154. `json_agg` over no rows is SQL NULL, not `[]`, so the
    // overwhelming majority of fuel points and every non-fuel kind
    // arrive here as null — which is the honest shape: the key is simply
    // absent, and the page then says we hold no price rather than
    // rendering an empty space beside a pump.
    ...(Array.isArray(r.prices) && r.prices.length > 0
      ? { prices: r.prices as RouteFuelStationPrice[] }
      : {}),
    // CAMP-119. The two stopping places, always with all five keys; no
    // other kind, ever. See RouteService.facilities.
    ...(isRestStopKind(kind) ? { facilities: facilitiesFromRow(r) } : {}),
  };
}
