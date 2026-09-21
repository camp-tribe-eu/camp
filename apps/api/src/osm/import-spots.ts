// CAMP-28: staging -> camping_spots, as an upsert.
//
//   cd apps/api
//   npx ts-node src/osm/import-spots.ts <country-code> [staging-table]
//   npx ts-node src/osm/import-spots.ts SI
//
// Run it twice on the same data and the row count must not move. That is
// the acceptance criterion of the card, and it is the whole reason this is
// an upsert keyed on the OSM id rather than an insert.
//
// Two things this deliberately never writes:
//
//   slug             assigned once, on first insert. If OSM renames a
//                    campsite the URL stays put - a slug that follows the
//                    name would break every link and search ranking the
//                    page has earned (CAMP-87).
//
//   owner_overrides  belongs to the campsite owner (CAMP-86). A weekly job
//                    that overwrites it would quietly erase their work.

import 'dotenv/config';
import { Client } from 'pg';
import { mapAmenities, mapSpotType, OsmTags } from './tag-mapping';

const COUNTRY = (process.argv[2] ?? '').toUpperCase();
const TABLE = process.argv[3] ?? 'osm_camping_staging';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/** True only when this file is run directly, not when a test imports it. */
const RUN_DIRECTLY = require.main === module;

if (RUN_DIRECTLY && !/^[A-Z]{2}$/.test(COUNTRY)) {
  console.error(
    'Usage: import-spots.ts <ISO-3166-1 alpha-2 country> [staging-table]\n' +
      '\n' +
      'The country is an argument, not a tag: only 26 of 448 Slovenian\n' +
      'campsites carry addr:country, and we import one country extract at a\n' +
      'time anyway. Reading it from the data would leave 94% of rows blank.',
  );
  process.exit(1);
}

/** Latin-ish slug. Falls back to the OSM id when a name yields nothing. */
function slugify(name: string | null, osmRef: string): string {
  const base = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `spot-${osmRef}`;
}

/**
 * The upsert, kept as a named constant so a test can assert what it does
 * NOT contain. `slug` and `owner_overrides` must never appear in the DO
 * UPDATE clause - the first would break every earned URL when OSM renames
 * a site, the second would erase the campsite owner's corrections once a
 * week. Both are easy to add by accident and invisible once added.
 */
export const UPSERT_SPOT_SQL = `INSERT INTO camping_spots
           (name, country, region, slug, type, amenities, location,
            osm_ref, last_seen_at, missing_since)
         VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326), $8, $9, NULL)
         ON CONFLICT (osm_ref) DO UPDATE SET
           name          = EXCLUDED.name,
           country       = EXCLUDED.country,
           region        = EXCLUDED.region,
           type          = EXCLUDED.type,
           amenities     = EXCLUDED.amenities,
           location      = EXCLUDED.location,
           last_seen_at  = EXCLUDED.last_seen_at,
           missing_since = NULL
           -- slug and owner_overrides are intentionally absent: see the
           -- header. Adding them here is the bug this comment prevents.
         RETURNING (xmax = 0) AS was_insert`;

interface StagingRow {
  osm_ref: string;
  point_wkt: string;
  tags: OsmTags;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const startedAt = new Date();

  // Text columns only: ogr2ogr lands every OSM tag as its own column, and
  // the tag bag we hand to the mapper is rebuilt from them.
  const cols = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND data_type IN ('text','character varying')`,
    [TABLE],
  );
  const tagColumns = cols.rows.map((r) => r.column_name).filter((c) => c !== 'id');

  // 🔴 68% of the Slovenian extract are ways, not nodes - campsites are
  // mapped as areas. ST_PointOnSurface, not ST_Centroid: the centroid of a
  // concave or ring-shaped site can land outside it, which would put the
  // pin in a neighbouring field.
  const rows = await db.query(
    `SELECT s.id AS osm_ref,
            ST_AsText(
              CASE WHEN GeometryType(s.geom) = 'POINT'
                   THEN s.geom
                   ELSE ST_PointOnSurface(s.geom) END
            ) AS point_wkt,
            s.*
       FROM "${TABLE}" s
      WHERE s.id IS NOT NULL`,
  );

  const staged: StagingRow[] = rows.rows.map((row) => {
    const tags: OsmTags = {};
    for (const col of tagColumns) {
      const v = row[col];
      if (v !== null && v !== undefined && v !== '') tags[col] = String(v);
    }
    return { osm_ref: row.osm_ref, point_wkt: row.point_wkt, tags };
  });

  // Existing slugs stay with their spot; new ones must not collide.
  const known = await db.query<{ osm_ref: string; slug: string }>(
    `SELECT osm_ref, slug FROM camping_spots WHERE osm_ref IS NOT NULL`,
  );
  const slugByRef = new Map(known.rows.map((r) => [r.osm_ref, r.slug]));
  const allSlugs = await db.query<{ slug: string }>(
    `SELECT slug FROM camping_spots`,
  );
  const usedSlugs = new Set(allSlugs.rows.map((r) => r.slug));

  let inserted = 0;
  let updated = 0;
  let unnamed = 0;
  let fromPolygon = 0;

  await db.query('BEGIN');
  try {
    for (const row of staged) {
      const name = row.tags.name?.trim() || null;
      if (!name) unnamed++;

      let slug = slugByRef.get(row.osm_ref);
      if (!slug) {
        const base = slugify(name, row.osm_ref);
        slug = base;
        let n = 2;
        // Campsite names repeat constantly ("Camping Municipal" appears
        // hundreds of times in France), so collisions are the norm.
        while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
        usedSlugs.add(slug);
      }

      const amenities = mapAmenities(row.tags);
      const type = mapSpotType(row.tags).type;
      const region = row.tags['addr:state'] ?? row.tags['addr:province'] ?? null;

      const res = await db.query(
        UPSERT_SPOT_SQL,
        [
          name,
          COUNTRY,
          region,
          slug,
          type,
          JSON.stringify(amenities),
          row.point_wkt,
          row.osm_ref,
          startedAt,
        ],
      );
      if (res.rows[0]?.was_insert) inserted++;
      else updated++;
    }

    // Anything in this country that OSM stopped mentioning. Only the first
    // disappearance is stamped, so the four-import rule from CAMP-87 can
    // measure how long it has been gone.
    const gone = await db.query(
      `UPDATE camping_spots
          SET missing_since = $1
        WHERE country = $2
          AND osm_ref IS NOT NULL
          AND (last_seen_at IS NULL OR last_seen_at < $1)
          AND missing_since IS NULL
        RETURNING osm_ref`,
      [startedAt, COUNTRY],
    );

    await db.query('COMMIT');

    const polygons = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM "${TABLE}" WHERE GeometryType(geom) <> 'POINT'`,
    );
    fromPolygon = Number(polygons.rows[0]?.n ?? 0);

    const total = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM camping_spots WHERE country = $1`,
      [COUNTRY],
    );

    const unknownCounts = await db.query<{ amenity: string; n: string }>(
      `SELECT key AS amenity, count(*) AS n
         FROM camping_spots, jsonb_each_text(amenities)
        WHERE country = $1 AND value = 'unknown'
        GROUP BY key ORDER BY key`,
      [COUNTRY],
    );

    console.log(`\nOSM import — ${COUNTRY}, from "${TABLE}"\n`);
    console.log(`  staged rows        ${staged.length}`);
    console.log(`  inserted           ${inserted}`);
    console.log(`  updated            ${updated}`);
    console.log(`  newly missing      ${gone.rowCount}`);
    console.log(`  ─────────────────────────`);
    console.log(`  rows in ${COUNTRY} now     ${total.rows[0].n}`);
    console.log(`\n  without a name     ${unnamed}  (pin shown, name honestly unknown)`);
    console.log(`  mapped as areas    ${fromPolygon}  (ST_PointOnSurface)`);
    if (unknownCounts.rowCount) {
      console.log('\n  amenities still unknown:');
      for (const r of unknownCounts.rows) {
        console.log(`    ${r.amenity.padEnd(13)} ${r.n}`);
      }
    }
    console.log('');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

if (RUN_DIRECTLY) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
