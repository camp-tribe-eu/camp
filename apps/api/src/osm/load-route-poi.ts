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
// 🔴 The SQL lives in its own file so it can be unit-tested — a script
// that opens a database connection on import cannot be. See the header
// of route-poi-sql.ts for what got through while it could not.
import {
  countrySql,
  EU_SQL_LIST,
  euLeakGuardSql,
  firstOf,
  POINT_SQL,
  WEBSITE_SQL,
} from './route-poi-sql';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

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
                ${countrySql(POINT_SQL, '$3')} AS country,
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
            kind          = EXCLUDED.kind,
            name          = EXCLUDED.name,
            location      = EXCLUDED.location,
            country       = EXCLUDED.country,
            phone         = EXCLUDED.phone,
            website       = EXCLUDED.website,
            opening_hours = EXCLUDED.opening_hours,
            last_seen_at  = EXCLUDED.last_seen_at`,
      [runAt, ACCESS_EXCLUDED, EU_SQL_LIST],
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

    // 🔴 CAMP-118, CHECKED AGAINST THE GEOMETRY AND NOT AGAINST THE
    // COLUMN THE IMPORT JUST WROTE.
    //
    // The previous check here read `country <> ALL(members)`. Against
    // the live table it returned 0 while 423 foreign rows sat in it,
    // because every one of them had a NULL country and `NULL <> ALL(…)`
    // is NULL, not true. It fired for the blunt break — remove the
    // filter, get "2 268 rows outside the EU-27" — and was blind to the
    // only path anything actually came through. That is the same shape
    // as the failure eu.ts records from CAMP-118: a safeguard that
    // consults the thing it is meant to check.
    //
    // This one drives out from the non-member polygons and compares
    // distances itself, so it does not care what `country` says. It was
    // rehearsed against the live table BEFORE the fix and reported 423,
    // naming Northern Cyprus, the United Kingdom, Monaco, Turkey,
    // Bosnia, Gibraltar and Akrotiri.
    const leaked = await db.query<{
      osm_ref: string;
      name: string | null;
      admin: string;
      foreign_m: string;
      member_m: string;
    }>(euLeakGuardSql('$1'), [EU_SQL_LIST]);
    // (the guard deliberately does not select `country` — see its header)
    if (leaked.rows.length > 0) {
      throw new Error(
        `rows nearer a non-member than the Union reached the table: ` +
          leaked.rows
            .map(
              (r) =>
                `${r.osm_ref} (${r.name ?? 'unnamed'}) ${r.foreign_m} m from ` +
                `${r.admin}, ${r.member_m} m from the Union`,
            )
            .join('; '),
      );
    }

    // 🔴 And the cheap half, kept as well as the geometric one: a NULL
    // country. The column is NOT NULL so this cannot happen — which is
    // exactly why it is asserted, because the day somebody makes it
    // nullable again to "handle coastal points" this is the line that
    // says what that costs.
    const nulls = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM osm_route_poi WHERE country IS NULL`,
    );
    if (Number(nulls.rows[0].n) > 0) {
      throw new Error(
        `${nulls.rows[0].n} rows have no country — the NULL exception is back`,
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
