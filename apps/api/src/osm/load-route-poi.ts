// CAMP-113: staging rows → osm_route_poi.
//
//   cd apps/api && npx ts-node src/osm/load-route-poi.ts
//
// Normally run for you by scripts/osm-pipeline/load-route-poi.sh, which
// produces the staging table this reads.
//
// 🔴 One statement, inside one transaction, and never a TRUNCATE
// followed by an INSERT outside one. The API is reading this table while
// the weekly import runs; a truncate that is visible before its insert
// finishes is a route page that renders "no fuel station within 25 km"
// for a minute and a half, which is a false statement about the ground
// rather than an outage anybody would notice.

import 'dotenv/config';
import { Client } from 'pg';
import { ACCESS_EXCLUDED, classifyCaseSql, ROUTE_POI_KINDS } from './route-poi';
import { EU_MEMBER_STATES } from './eu';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * 🔴 ST_PointOnSurface, not ST_Centroid.
 *
 * 473 000 of the staged objects are polygons and 469 000 are open ways.
 * A centroid of a C-shaped building, or of a ring road services area,
 * can land outside the thing it names — which would put a fuel station
 * in the field next to it and print a distance that is wrong by more
 * than the page's own precision. PointOnSurface is guaranteed to lie on
 * the geometry.
 */
const POINT_SQL = `ST_PointOnSurface(ST_CollectionExtract(ST_MakeValid(s.geom)))`;

/**
 * 🔴 The first value only, where OSM separates several with ';'.
 *
 * The campsite page already learned this: `tel:` with two numbers glued
 * together dials neither, and 157 live rows were doing it before
 * CAMP-141 split them. Same rule, applied at import rather than at
 * render, so the column holds one number.
 */
const firstOf = (expr: string) =>
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
const WEBSITE_SQL = `
  CASE WHEN ${firstOf(`coalesce(s.website, s."contact:website")`)} ~* '^https?://[^\\s<>"]+$'
       THEN ${firstOf(`coalesce(s.website, s."contact:website")`)}
  END`;

/**
 * 🔴 CAMP-118's scope, applied here rather than cleaned up afterwards.
 *
 * Geofabrik extracts are not clipped to a border. Measured on the first
 * full load, 28.09.2026: 13 009 of the 2 261 499 classified rows sat
 * positively inside a non-member's polygon — 6 320 in the United Kingdom
 * (the Irish extract is `ireland-and-northern-ireland`), 2 227 in
 * Switzerland, 2 159 in Northern Cyprus, then Serbia, Ukraine, Monaco,
 * Russia. 2 248 490 rows are left.
 *
 * `drop-non-eu.mjs` exists because exactly this happened to the campsite
 * table and nobody noticed for months: "we build for the EU only" was
 * true on paper and false in the data. A delete-afterwards script is a
 * cure; a filter at import is the prevention, and it costs 3 m 37 s of a
 * pipeline that already spends hours downloading.
 *
 * 🔴 A row in no polygon has a NULL country and must be KEPT. Natural
 * Earth is simplified and 65 464 rows (2.9%) sit just outside every
 * coastline. So the test is "NULL or a member", never "not a
 * non-member": `country NOT IN (...)` evaluates to NULL for those rows,
 * which is not true, which would silently drop every coastal point in
 * Europe.
 *
 * 🔴 The twelve polygons Natural Earth codes `-1` are INCLUDED here, and
 * the first version wrongly excluded them.
 *
 * `-1` is not "unknown, probably fine" — it is a territory whose status
 * is disputed, and the three that matter to us are Northern Cyprus and
 * the two British Sovereign Base Areas. Skipping them made 2 268 rows
 * come back with a NULL country and sail through the "NULL is coastal"
 * exception into the table. They are neither coastal nor in the Union,
 * and no EU safety instrument covers them. Letting `-1` through as the
 * country makes the EU test reject it, which is the honest answer.
 *
 * The Republic of Cyprus is unaffected: its five admin-1 rows carry a
 * real `CY`, and the ORDER BY prefers a real code wherever a disputed
 * polygon overlaps one.
 */
const COUNTRY_SQL = `(
  SELECT lower(a.iso_a2) FROM ne_admin1 a
   WHERE a.geom && ${POINT_SQL} AND ST_Contains(a.geom, ${POINT_SQL})
     AND a.iso_a2 IS NOT NULL
   ORDER BY (a.iso_a2 = '-1')
   LIMIT 1)`;

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    const staged = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM osm_route_poi_staging`,
    );
    if (Number(staged.rows[0].n) === 0) {
      throw new Error(
        'osm_route_poi_staging is empty — run scripts/osm-pipeline/load-route-poi.sh first',
      );
    }

    await db.query('BEGIN');

    // 🔴 An UPSERT keyed on the OSM ref, plus a delete of what this run
    // did not see — not a truncate. The point is that `last_seen_at` on
    // a row that is still there keeps meaning "our import found it", and
    // a re-run of the same extract does not rewrite 2 248 490 rows.
    const runAt = new Date().toISOString();
    const inserted = await db.query(
      `INSERT INTO osm_route_poi
         (osm_ref, kind, name, location, country,
          phone, website, opening_hours, last_seen_at)
       SELECT * FROM (
         SELECT DISTINCT ON (s.id)
                s.id AS osm_ref,
                ${classifyCaseSql('s')} AS kind,
                nullif(btrim(s.name), '') AS name,
                ${POINT_SQL} AS location,
                ${COUNTRY_SQL} AS country,
                ${firstOf(`coalesce(s.phone, s."contact:phone")`)} AS phone,
                ${WEBSITE_SQL} AS website,
                nullif(btrim(s.opening_hours), '') AS opening_hours,
                $1::timestamptz AS last_seen_at
           FROM osm_route_poi_staging s
          WHERE ${classifyCaseSql('s')} IS NOT NULL
            -- 🔴 A private or employees-only fuel station is not
            -- somewhere a stranger can fill up. 9 874 of the candidates
            -- say so.
            AND (s.access IS NULL OR s.access <> ALL ($2::text[]))
            AND s.geom IS NOT NULL
            AND ${POINT_SQL} IS NOT NULL
          -- osmium gives one row per object, but a merge of overlapping
          -- extracts can hand the same border object twice.
          ORDER BY s.id
       ) r
        -- 🔴 CAMP-118. The IS NULL half of this is load-bearing and is
        -- not a widening: a row in no Natural Earth polygon is coastal,
        -- not foreign. See COUNTRY_SQL above.
        WHERE r.country IS NULL OR r.country = ANY ($3::text[])
       ON CONFLICT (osm_ref) DO UPDATE SET
            kind          = EXCLUDED.kind,
            name          = EXCLUDED.name,
            location      = EXCLUDED.location,
            country       = EXCLUDED.country,
            phone         = EXCLUDED.phone,
            website       = EXCLUDED.website,
            opening_hours = EXCLUDED.opening_hours,
            last_seen_at  = EXCLUDED.last_seen_at`,
      [runAt, ACCESS_EXCLUDED, EU_MEMBER_STATES],
    );

    const gone = await db.query(
      `DELETE FROM osm_route_poi WHERE last_seen_at < $1::timestamptz`,
      [runAt],
    );

    // 🔴 Every kind must have arrived, and the check is inside the
    // transaction so a kind that came back empty rolls the whole thing
    // back rather than being published.
    //
    // This is the guard for the one failure that cannot be seen from a
    // page: the shell script's tag list and ROUTE_POI_RULES drifting
    // apart. A kind nobody filters for does not break anything — it just
    // quietly says "we hold no charging station within 25 km" on every
    // route in Europe, which reads exactly like an honest gap.
    const byKind = await db.query<{ kind: string; n: string }>(
      `SELECT kind, count(*)::text AS n FROM osm_route_poi GROUP BY kind`,
    );
    const counts = new Map(byKind.rows.map((r) => [r.kind, Number(r.n)]));
    const empty = ROUTE_POI_KINDS.filter((k) => !counts.get(k));
    if (empty.length > 0) {
      throw new Error(
        `these kinds loaded nothing: ${empty.join(', ')} — the tag list in ` +
          `scripts/osm-pipeline/load-route-poi.sh and ROUTE_POI_RULES in ` +
          `src/osm/route-poi.ts have drifted apart`,
      );
    }

    // 🔴 CAMP-118, proved rather than assumed, and inside the
    // transaction so a scope leak rolls back instead of shipping.
    //
    // The campsite table had this exact problem for months and the rule
    // stayed true only on paper — which is why drop-non-eu.mjs had to be
    // written to clean up after it. The filter above is upstream of that;
    // this is the check that the filter did what it says.
    const outside = await db.query<{ n: string; country: string }>(
      `SELECT country, count(*)::text AS n
         FROM osm_route_poi
        WHERE country IS NOT NULL AND country <> ALL ($1::text[])
        GROUP BY country ORDER BY 2 DESC`,
      [EU_MEMBER_STATES],
    );
    if (outside.rows.length > 0) {
      throw new Error(
        `rows outside the EU-27 reached the table: ` +
          outside.rows.map((r) => `${r.country}=${r.n}`).join(', '),
      );
    }

    await db.query('COMMIT');
    await db.query('ANALYZE osm_route_poi');

    console.log(`  written: ${inserted.rowCount}, removed: ${gone.rowCount}`);
    for (const kind of ROUTE_POI_KINDS) {
      console.log(`    ${kind.padEnd(10)} ${counts.get(kind)}`);
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
