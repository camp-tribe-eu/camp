// CAMP-113: the SQL fragments the route-POI import is built from.
//
// 🔴 A separate file from load-route-poi.ts because that file is a
// SCRIPT — it connects to a database and runs on import — so nothing
// inside it can be unit-tested. Review found the consequence: removing
// the `^https?://` check on a website, and swapping ST_PointOnSurface for
// ST_Centroid, both left the whole suite green. Neither is a mistake you
// see on a page; the first is a `javascript:` URL rendered as a link on
// a public site, the second is a fuel station placed in the field next
// to itself.
//
// Everything here is a pure string builder over constants, so the specs
// can assert the shape of what will run.

import { EU_MEMBER_STATES_AND_SUBDIVISIONS, ISO_SUBDIVISION_OF } from './eu';
import {
  facilitySelectSql,
  lpgSelectSql,
  ROW_FACILITY_COLUMNS,
  tagPartsSql,
} from './route-poi-facilities';
import { CANONICAL_REF_KINDS, classifyCaseSql } from './route-poi';

/**
 * 🔴 ST_PointOnSurface, not ST_Centroid.
 *
 * 473 000 of the staged objects are polygons and 469 000 are open ways.
 * The centroid of a C-shaped building, or of a ring-road services area,
 * can land outside the thing it names — which puts a fuel station in the
 * field next door and prints a distance that is wrong by more than the
 * page's own precision. PointOnSurface is guaranteed to lie on the
 * geometry. There is a spec asserting this, because the swap is silent.
 */
export const POINT_SQL = `ST_PointOnSurface(ST_CollectionExtract(ST_MakeValid(s.geom)))`;

/**
 * 🔴 The first value only, where OSM separates several with ';'.
 *
 * The campsite page already learned this: a `tel:` with two numbers glued
 * together dials neither, and 157 live rows were doing it before
 * CAMP-141. Same rule, applied at import rather than at render.
 */
export const firstOf = (expr: string) =>
  `nullif(btrim(split_part(${expr}, ';', 1)), '')`;

/**
 * 🔴 http and https only.
 *
 * `cleanWebsite` in import-spots.ts makes the same check for campsites
 * and for the same reason: these are URLs typed by strangers into a
 * public database, they are rendered as links, and `javascript:` is a
 * string somebody can type. A value that is not a plain web URL is
 * dropped, so the page says "unknown" instead of linking it.
 */
const WEBSITE_RAW = `coalesce(s.website, s."contact:website")`;
export const WEBSITE_SQL = `
  CASE WHEN ${firstOf(WEBSITE_RAW)} ~* '^https?://[^\\s<>"]+$'
       THEN ${firstOf(WEBSITE_RAW)}
  END`;

/** The member list, as SQL sees it — members plus subdivision aliases. */
export const EU_SQL_LIST = EU_MEMBER_STATES_AND_SUBDIVISIONS;

/**
 * Natural Earth's code, normalised to the member state it belongs to.
 *
 * 🔴 Generated from ISO_SUBDIVISION_OF so there is one alias table, not
 * one in TypeScript and another written out in a query. Values are
 * checked against a literal pattern before interpolation: nothing here
 * comes from a request, but this repository is public and a SQL string
 * assembled by concatenation is one careless edit from being the thing
 * that does.
 */
export function normaliseCountrySql(expr: string): string {
  const safe = (v: string) => {
    if (!/^[a-z]{2}$/.test(v)) {
      throw new Error(
        `route-poi-sql: unsafe country code ${JSON.stringify(v)}`,
      );
    }
    return `'${v}'`;
  };
  const whens = Object.entries(ISO_SUBDIVISION_OF).map(
    ([from, to]) => `WHEN ${safe(from)} THEN ${safe(to)}`,
  );
  if (whens.length === 0) return expr;
  return `(CASE ${expr} ${whens.join(' ')} ELSE ${expr} END)`;
}

/**
 * 🔴 WHICH COUNTRY A POINT IS IN — CONTAINMENT, ELSE THE NEAREST
 * POLYGON, AND NEVER NULL.
 *
 * The first version of this answered NULL for a point inside no polygon
 * and the import KEPT those rows, reasoning that Natural Earth is
 * simplified and a marina sits just off the coastline. That reasoning is
 * true and the rule built on it was not: a point 7 m outside NORTHERN
 * CYPRUS is also inside no polygon. Measured on the live table, the
 * exception admitted 423 rows that are strictly nearer to a non-member
 * than to any member — 169 Northern Cyprus, 126 United Kingdom, 72
 * Monaco, 30 Turkey, 8 Bosnia, 6 Gibraltar, 1 Akrotiri. `n2152489292`
 * (K-Pet, Girne) sits 7 m from Northern Cyprus and 17 256 m from the
 * Union; `n2470102356` (a KFC in Bangor) is 87 978 m from it.
 *
 * So the question "is this row coastal or foreign" is answered by
 * geometry rather than by an exception: the nearest polygon wins. That
 * is safe to do, and it was measured before it was written. Across the
 * 65 464 rows inside no polygon, a genuinely EU-coastal row sits a
 * median of 322 m from its own country (p99 8 294 m, worst 52 952 m),
 * and there is NO row where a member polygon lies within 100 m of a
 * nearer non-member — the nearest non-member wins by 383 m at the very
 * closest (Gibraltar, and Gibraltar is genuinely not in the Union).
 *
 * 🔴 Overfetched and re-ranked on the spheroid. `<->` orders by planar
 * degrees because that is what the GiST index holds, and a degree of
 * longitude is 111 km at the equator against 55 km at Uppsala — the same
 * trap routes.near() documents. Eight candidates, then true distance.
 *
 * 🔴 Ties go to the NON-member. Five rows sit equidistant from both, and
 * when we cannot tell which country a point is in we do not publish it.
 * The alternative — preferring the member — is how a leak is spelled.
 */
export function countrySql(point: string, euParam: string): string {
  return `${normaliseCountrySql(`COALESCE(
    (SELECT lower(a.iso_a2) FROM ne_admin1 a
      WHERE a.geom && ${point} AND ST_Contains(a.geom, ${point})
        AND a.iso_a2 IS NOT NULL
      ORDER BY (a.iso_a2 = '-1')
      LIMIT 1),
    (SELECT c.iso FROM (
       SELECT lower(a.iso_a2) AS iso,
              ST_Distance(a.geom::geography, ${point}::geography) AS m
         FROM ne_admin1 a
        WHERE a.iso_a2 IS NOT NULL
        ORDER BY a.geom <-> ${point}
        LIMIT 8) c
      ORDER BY c.m, (c.iso = ANY (${euParam}::text[])), c.iso
      LIMIT 1)
  )`)}`;
}

/**
 * 🔴 THE GUARD, AND IT DOES NOT READ THE COLUMN IT IS GUARDING.
 *
 * The previous check asked `country <> ALL(members)` — which is exactly
 * the failure `eu.ts` records from CAMP-118, a safeguard consulting the
 * thing it is meant to check. Against the live table it returned 0 while
 * 423 foreign rows sat in it, because every one of them had a NULL
 * country and `NULL <> ALL(...)` is NULL, not true. It fired only for
 * the blunt break (filter removed → 2 268 rows), which is the failure
 * nobody was going to make.
 *
 * This one re-derives from geometry instead: drive out from the
 * NON-MEMBER polygons, take every stored point near one, and flag it if
 * a non-member is at least as near as the nearest member. It does not
 * care what `country` says, so it sees the NULL path, a widened member
 * list and a broken normalisation alike.
 *
 * 🔴 The 0.05° band is a cost bound, not a correctness one, and it was
 * checked: widening it to 0.15° returns the same count and takes 45%
 * longer. A row tens of kilometres from every non-member polygon cannot
 * be nearer to one than to a member.
 *
 * Rehearsed against the live table before the fix: 423 rows, naming
 * Northern Cyprus, the United Kingdom, Monaco, Turkey, Bosnia,
 * Gibraltar and Akrotiri. Afterwards: 0.
 */
export function euLeakGuardSql(euParam: string): string {
  const foreign = `a.iso_a2 IS NOT NULL AND lower(a.iso_a2) <> ALL (${euParam}::text[])`;
  return `
    WITH near_foreign AS (
      SELECT DISTINCT r.osm_ref, r.location, r.name
        FROM ne_admin1 a
        JOIN osm_route_poi r ON ST_DWithin(a.geom, r.location, 0.05)
       WHERE ${foreign}
    )
    SELECT n.osm_ref, n.name,
           round(f.m) AS foreign_m, round(e.m) AS member_m, f.admin
      FROM near_foreign n
      JOIN LATERAL (
        SELECT a.admin, ST_Distance(a.geom::geography, n.location::geography) AS m
          FROM ne_admin1 a WHERE ${foreign}
         ORDER BY a.geom <-> n.location LIMIT 1) f ON true
      JOIN LATERAL (
        SELECT ST_Distance(a.geom::geography, n.location::geography) AS m
          FROM ne_admin1 a WHERE lower(a.iso_a2) = ANY (${euParam}::text[])
         ORDER BY a.geom <-> n.location LIMIT 1) e ON true
     WHERE f.m <= e.m
     ORDER BY f.m
     LIMIT 20`;
}

/**
 * 🔴 ONE ROW PER OSM OBJECT: `a246` and `w123` are the same way.
 *
 * `osmium export` hands a closed way out twice (CAMP-253): as a
 * LineString under `w<id>` and as a Polygon under `a<id>`, where
 * libosmium numbers an area `way × 2` for a way and `relation × 2 + 1`
 * for a relation. Two ids for one object, so the upsert key never
 * collapsed them. Measured on the Slovenian extract, 14.10.2026: every
 * `w` came with an `a` twin (43 of 43 rest areas, 32 of 32 service areas,
 * 5 of 5 dump stations), and 16 rest areas and 44 service areas came
 * ONLY as `a` — so folding on the pair alone would still miss them.
 *
 * This maps an area id back to the object it was built from. The result
 * is a real OpenStreetMap id — `w123` opens at openstreetmap.org/way/123 —
 * which `a246` never did.
 *
 * 🔴 `a` → `w` is NOT a string substitution (`a132953274` is way
 * 66476637), which is the mistake normalise-export.mjs documents making.
 */
export function canonicalRefSql(idExpr: string): string {
  return `CASE
              WHEN ${idExpr} ~ '^a[0-9]+$' THEN
                CASE WHEN substr(${idExpr}, 2)::bigint % 2 = 0
                     THEN 'w' || (substr(${idExpr}, 2)::bigint / 2)::text
                     ELSE 'r' || ((substr(${idExpr}, 2)::bigint - 1) / 2)::text
                END
              ELSE ${idExpr}
            END`;
}

/**
 * The columns every statement here names, in order, so the INSERT list,
 * the SELECT list and the ON CONFLICT list cannot drift apart.
 */
const BASE_COLUMNS = [
  'osm_ref',
  'kind',
  'name',
  'location',
  'country',
  'phone',
  'website',
  'opening_hours',
  'last_seen_at',
] as const;

/**
 * The statement `load-route-poi.ts` runs: staging → osm_route_poi.
 * Parameters: $1 the run's timestamp, $2 the access values that mean
 * "not you", $3 the EU-27 member list.
 *
 * Lives here, and not in the script, so a spec can run EXACTLY this text
 * against a real database. It used to be a template literal inside a
 * file that opens a connection on import — which is why four mutations
 * of it shipped green (see the header of this file).
 *
 * 🔴 TWO ROW KEYS, ON PURPOSE.
 *
 * `rest_area`, `service_area` (CAMP-119), `gas_exchange` (CAMP-258, new, so
 * nothing is keyed on it) and `dump` are keyed on the
 * canonical object id, one row per OSM object. The other six kinds — the
 * 2.2 million rows that were here before — are keyed on what osmium
 * wrote. Re-keying them would fold 338 305 closed-way twins (measured
 * 14.10.2026 on camptribe_dev, `dump` included) — and it would also move
 * 37 576 fuel points whose `fuel_station_prices.osm_ref` points at them,
 * with no foreign key to say so. That is a decision with a cost and it is
 * not this card's; it is written down for the next one. `dump` is folded
 * because nothing is keyed on it and its count is the number the card
 * asks to be reproducible (see route-poi.ts).
 *
 * 🔴 Where both twins arrive, the AREA wins (`a` first): its geometry is a
 * polygon, which ST_PointOnSurface can place inside; the line is the
 * ring's outline.
 */
export function buildRoutePoiInsertSql(): string {
  const foldedKinds = CANONICAL_REF_KINDS.map((k) => {
    if (!/^[a-z_]+$/.test(k))
      throw new Error(`route-poi-sql: unsafe kind ${k}`);
    return `'${k}'`;
  }).join(', ');
  const base = BASE_COLUMNS.join(', ');
  const facilities = ROW_FACILITY_COLUMNS.join(', ');
  const updates = [
    ...BASE_COLUMNS.filter((c) => c !== 'osm_ref'),
    ...ROW_FACILITY_COLUMNS,
  ]
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(',\n            ');

  return `INSERT INTO osm_route_poi
         (${base},
          ${facilities})
       SELECT ${[...BASE_COLUMNS, ...ROW_FACILITY_COLUMNS].map((c) => `r.${c}`).join(', ')}
         FROM (
         SELECT DISTINCT ON (x.ref)
                x.ref AS osm_ref,
                k.kind AS kind,
                nullif(btrim(s.name), '') AS name,
                ${POINT_SQL} AS location,
                ${countrySql(POINT_SQL, '$3')} AS country,
                ${firstOf(`coalesce(s.phone, s."contact:phone")`)} AS phone,
                ${WEBSITE_SQL} AS website,
                nullif(btrim(s.opening_hours), '') AS opening_hours,
                $1::timestamptz AS last_seen_at,
                ${facilitySelectSql('s')},
                ${lpgSelectSql('s')}
           FROM osm_route_poi_staging s
          CROSS JOIN LATERAL (SELECT ${classifyCaseSql('s')} AS kind) k
          CROSS JOIN LATERAL (
                SELECT CASE WHEN k.kind IN (${foldedKinds})
                            THEN ${canonicalRefSql('s.id')}
                            ELSE s.id
                       END AS ref) x
          WHERE k.kind IS NOT NULL
            -- 🔴 A private or employees-only fuel station is not
            -- somewhere a stranger can fill up. 9 874 of the candidates
            -- say so. The same goes for a rest area behind a barrier.
            --
            -- 🔴 Read through the SAME expression the access COLUMN is
            -- written with (normalisedSql / tagPartsSql), and not the raw
            -- tag: 'Private', 'private ' and '\tprivate' were published
            -- while their own column said "private". A list is out when
            -- ANY part is excluded — see isAccessExcluded in route-poi.ts.
            -- coalesce: a NULL tag has no parts, and NOT NULL is NULL, which
            -- would drop every row that never wrote an access at all.
            AND NOT coalesce(${tagPartsSql('s."access"')} && $2::text[], false)
            AND s.geom IS NOT NULL
            AND ${POINT_SQL} IS NOT NULL
          ORDER BY x.ref, (s.id LIKE 'a%') DESC, s.id
       ) r
        -- 🔴 CAMP-118, and NO "country IS NULL" exception.
        --
        -- There used to be one, reasoning that a row inside no Natural
        -- Earth polygon is coastal rather than foreign. Measured: it
        -- admitted 423 rows strictly nearer to a non-member than to any
        -- member, because a point 7 m outside NORTHERN CYPRUS is also
        -- inside no polygon. countrySql now answers with the nearest
        -- polygon instead, so there is nothing to make an exception for
        -- — and the column is NOT NULL, so the exception cannot come
        -- back without the import failing loudly.
        WHERE r.country = ANY ($3::text[])
       ON CONFLICT (osm_ref) DO UPDATE SET
            ${updates}`;
}

/**
 * CAMP-258: the `lpg` distribution over fuel stations — ROWS and OBJECTS.
 *
 * Rows, because that is what the table holds; objects, because the older
 * kinds are not folded (see buildRoutePoiInsertSql) and a closed-way fuel
 * station is two rows, so only the second is comparable with a count of OSM
 * objects. Measured on camptribe_dev before this card: 154 183 `fuel` rows
 * against 119 201 objects in the raw extracts.
 */
export const LPG_SUMMARY_SQL = `SELECT lpg AS state, count(*)::text AS rows,
              count(DISTINCT ${canonicalRefSql('osm_ref')})::text AS objects
         FROM osm_route_poi WHERE kind = 'fuel' GROUP BY 1`;
