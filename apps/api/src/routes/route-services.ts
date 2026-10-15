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

/**
 * CAMP-254 — THE KIND THAT IS ASKED WHERE ITS DRINKING WATER IS.
 *
 * One kind, named once, and used by BOTH the SQL (`WATER_NEAR_SUBQUERY`
 * runs for this kind and no other) and the row mapping (only this kind
 * carries the answer). Two literals `'dump'` would be two lists that can
 * drift: the query answering for one kind and the mapper reading it for
 * another.
 */
export const WATER_CHECKED_KIND = 'dump' as const satisfies RoutePoiKind;

/**
 * CAMP-254 — HOW CLOSE "NEAR" IS, IN METRES ON THE GROUND.
 *
 * 🔴 The only place this number is written. The SQL takes it, the payload
 * carries it back (`RouteDumpWater.radiusMetres`) and the page prints the
 * radius it was sent — so the sentence "no drinking water within 500 m"
 * can only ever say the radius that was actually searched. A second copy
 * in the web app would be a second number to keep right.
 *
 * Measured 15.10.2026 on camptribe_dev: of 7 214 disposal points, 4 069
 * (56.4%) have a drinking-water point inside it. 2 073 of those are
 * within 10 m and 1 537 (37.8%) are 50 m or more away, 810 of them 200 m
 * or more — so the radius is not decorative, and the distance is not
 * always "right there".
 */
export const WATER_NEAR_DUMP_RADIUS_M = 500;

/**
 * CAMP-254 — HOW MUCH WIDER THE PREFILTER BOX IS THAN THE VERDICT.
 *
 * 🔴 THE INVARIANT, AND IT IS ONE-SIDED: the box may be WIDER than the
 * radius and must NEVER be narrower. It only chooses which water rows the
 * index hands to `ST_DWithin`; the answer is `ST_DWithin`'s. A box that is
 * too wide costs a few extra rows to test. A box that is too narrow drops
 * real water before the verdict sees it, and the page then says "our
 * database holds no drinking water within 500 m" over a tap 495 m away.
 *
 * `ST_Buffer(geography, 500)::geometry` is NOT a box of 500 m, which is
 * why this is not 1. Measured 15.10.2026 (`ST_Distance` from the point to
 * the middle of each edge of the buffer's lon/lat bounding box): 499.9 m
 * a side up to 69.999° N, and **491.9 m east-west from 70.0° N**, where
 * PostGIS changes projection. Swept every 0.25° from -85° to 85°, the
 * worst is 491.93 m, at ±70° (a 1.6% shortfall). 5% clears that by three
 * times over, and the sweep in `route-services-water.db.spec.ts` asserts
 * the invariant at every latitude rather than trusting this paragraph.
 *
 * The EU-27 has land above 70° (Utsjoki and Nuorgam, 70.09° N). Today
 * that costs nothing — the northernmost of the 7 214 disposal points is
 * at 69.584° N, so both forms answer 4 069 — but that is a fact about
 * today's data, and the first disposal point in Lapland would have made
 * the page wrong, silently.
 */
export const WATER_BOX_MARGIN = 1.05;

/**
 * The box's radius in metres: the verdict's radius, widened, and rounded
 * UP so that a fractional product can never come out narrower.
 */
export const WATER_BOX_METRES = Math.ceil(
  WATER_NEAR_DUMP_RADIUS_M * WATER_BOX_MARGIN,
);

/**
 * The prefilter geometry around a point expression, as SQL. Exported so the
 * latitude sweep in the database spec tests THIS text and not a copy of it.
 */
export const waterBoxSql = (point: string): string =>
  `ST_Buffer(${point}::geography, ${WATER_BOX_METRES})::geometry`;

/**
 * CAMP-254 — is there drinking water near THIS disposal point?
 *
 * 🔴 `metres: null` is an ANSWER: we searched and found none inside
 * `radiusMetres`. It is not "unknown". An absent `drinkingWaterNear`
 * (the key missing from a row) is the other thing: nobody asked. The two
 * must stay different on the wire, because the page says "our database
 * holds none within 500 m" for the first and must NOT say it for the
 * second — see `waterNearField`.
 *
 * 🔴 Straight-line metres to the NEAREST such point, like every other
 * distance on a route page. The water point itself — its name, its
 * coordinates, its OSM reference — is not sent: the page prints a
 * distance, not a second object.
 */
export interface RouteDumpWater {
  /** The radius that was searched, in metres. */
  radiusMetres: number;
  /** Metres to the nearest drinking-water point inside it, or null. */
  metres: number | null;
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
  /**
   * CAMP-254 — drinking water near a disposal point. 🔴 Present on `dump`
   * and ABSENT on the other eight kinds, and on `dump` present whenever
   * the query asked, with `metres: null` when it found nothing. See
   * `RouteDumpWater`.
   */
  drinkingWaterNear?: RouteDumpWater;
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
          SELECT p.*, ${FUEL_PRICE_SUBQUERY} AS prices,
                 ${WATER_NEAR_SUBQUERY} AS water_near_m
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

/**
 * CAMP-254 — the nearest drinking water to the disposal point we just
 * picked, within `WATER_NEAR_DUMP_RADIUS_M` metres, or NULL.
 *
 * 🔴 `geography` AT BOTH ENDS OF THE DISTANCE. `ST_DWithin` and
 * `ST_Distance` on `geometry` answer in DEGREES: `ST_DWithin(a, b, 500)`
 * on two geometry columns is "within 500 degrees", which is every point
 * on Earth, and `round(ST_Distance(a, b))` is 0 for anything under half
 * a degree. Both read as plausible, and both have already cost this
 * repository a wrong answer. The casts are the unit.
 *
 * 🔴 THE `&&` IS A PREFILTER AND NOT THE VERDICT, AND WITHOUT IT THE
 * PLAN LOOKS RIGHT AND IS NOT. A cast column cannot be matched against
 * the GiST index on `location`, so without the box PostgreSQL walks the
 * WHOLE partial index and filters every row: measured 15.10.2026 on
 * camptribe_dev, one stage, `Index Scan using idx_osm_route_poi_water`
 * with no Index Cond, `Rows Removed by Filter: 230431`, 3 422 ms; with
 * the box, an Index Cond and 0.025 ms. Both plans name the same index and
 * neither is a sequential scan, so "uses the index" is not the check —
 * the database spec asks for the Index Cond. `ST_DWithin` on the
 * geography then decides.
 *
 * 🔴 THE BOX IS `WATER_BOX_MARGIN` WIDER THAN THE VERDICT, ON PURPOSE —
 * see that constant for the invariant (wider is fine, narrower drops real
 * water) and for the 70.0° N projection change that made a box of exactly
 * the radius too narrow. It is still derived from the one radius constant,
 * not a second number in degrees. Measured on all 7 214 disposal points,
 * the plain `ST_Expand(location, 0.02)` and this form both answer 4 069.
 *
 * 🔴 `p.kind = 'dump'` short-circuits it for the other eight kinds, as
 * the fuel lookup's `p.kind = 'fuel'` does: only a disposal point is asked
 * where its drinking water is, and the mapper drops the column for every
 * other kind, so a probe for them would be work whose answer is thrown
 * away.
 *
 * 🔴 The point is rebuilt from `p.lon, p.lat`, which `measured` made with
 * ST_X/ST_Y of the very geometry — the same two doubles, so no distance
 * is measured from a point a metre away from the one that was printed.
 *
 * 🔴 `min` over no rows is NULL, and NULL is what the mapper turns into
 * "searched, found none" — not into "unknown".
 */
export const WATER_NEAR_SUBQUERY = `(
              SELECT min(ST_Distance(w.location::geography,
                                     here.g::geography))
                FROM (SELECT ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)
                             AS g) here,
                     osm_route_poi w
               WHERE p.kind = '${WATER_CHECKED_KIND}'
                 AND w.kind = 'water'
                 AND w.location && ${waterBoxSql('here.g')}
                 AND ST_DWithin(w.location::geography, here.g::geography,
                                ${WATER_NEAR_DUMP_RADIUS_M})
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
    // CAMP-254. The disposal point only, and only when the query asked.
    ...(kind === WATER_CHECKED_KIND ? waterNearField(r) : {}),
  };
}

/**
 * One row's answer to "is there drinking water near this disposal
 * point", as the field the endpoint sends — or no field at all.
 *
 * 🔴 THREE OUTCOMES, AND THE THIRD IS THE ONE THAT MUST NOT TURN INTO THE
 * SECOND.
 *
 *   - `water_near_m` is a number inside the radius → `metres: <rounded>`.
 *   - `water_near_m` is NULL                       → `metres: null`:
 *     the query ran and `min` of nothing is NULL. Searched, none found.
 *   - the row has no `water_near_m` at all, or a value that is not a
 *     distance inside the radius                   → NO FIELD.
 *
 * The third is a row from a query that never asked — a refactor that
 * drops the column from the SQL and keeps this mapper, a caller with its
 * own SELECT. Reading a missing column as "none" would make every
 * disposal point on every route page say "our database holds no drinking
 * water within 500 m", 4 069 of them untruthfully, with every test that
 * only looks at the SQL still green. The same rule `readFacilityState`
 * follows: the one thing a gap cannot produce is a negative.
 */
export function waterNearField(
  r: Record<string, unknown>,
): { drinkingWaterNear: RouteDumpWater } | Record<string, never> {
  const raw = r.water_near_m;
  // 🔴 STRICTLY `null`, never `== null`: `undefined` is a column the query
  // did not select, and the loose comparison would read it as "searched,
  // found none".
  if (raw === null) {
    return {
      drinkingWaterNear: {
        radiusMetres: WATER_NEAR_DUMP_RADIUS_M,
        metres: null,
      },
    };
  }
  // A number, or a numeric string (the driver hands float8 back as a
  // number, a `numeric` as text). Not `Number(raw)` on anything: that
  // turns '' and `true` into 0 and 1, and 0 m is an answer.
  const m =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  // A distance outside [0, radius] is not an answer to the question that
  // was asked, and printing it under "within 500 m" would contradict
  // itself. Dropped, so the page says it did not check.
  if (!Number.isFinite(m) || m < 0 || m > WATER_NEAR_DUMP_RADIUS_M) return {};
  return {
    drinkingWaterNear: {
      radiusMetres: WATER_NEAR_DUMP_RADIUS_M,
      metres: Math.round(m),
    },
  };
}
