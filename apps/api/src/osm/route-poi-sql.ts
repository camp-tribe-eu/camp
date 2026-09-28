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
