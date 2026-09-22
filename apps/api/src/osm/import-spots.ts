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

/** Metres within which two identically named sites are taken to be one. */
const DUPLICATE_RADIUS_M = 200;

/** Rough metres between two WKT points. Fine at this scale. */
function metresApart(a: string, b: string): number {
  const p = (w: string) => {
    const m = /POINT\s*\(([-\d.]+)\s+([-\d.]+)\)/.exec(w);
    return m ? { lon: +m[1], lat: +m[2] } : null;
  };
  const x = p(a);
  const y = p(b);
  if (!x || !y) return Infinity;
  const dLat = (y.lat - x.lat) * 111_320;
  const dLon =
    (y.lon - x.lon) *
    111_320 *
    Math.cos(((x.lat + y.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/**
 * 🔴 One campsite, two OSM objects.
 *
 * OSM commonly carries a campsite as a node AND as the way around its
 * perimeter, and our filter asks for both, so both arrive as separate
 * rows with different type_ids. Measured on Slovenia: 120 such pairs,
 * average 37 m apart — **51% of all rows were involved in a duplicate**.
 * Every listing page showed each site twice, and every count was inflated.
 *
 * The way wins, not the node: it carries the real footprint, which is
 * what the campsite page is meant to draw. The node's tags are merged in
 * underneath, because the two objects rarely carry the same tags and
 * throwing the node away wholesale would lose amenities.
 *
 * Unnamed sites are merged only under a much stricter rule — see
 * `mergeUnnamed` below.
 */
export function dedupe(rows: StagingRow[]): StagingRow[] {
  const byName = new Map<string, StagingRow[]>();
  const unnamed: StagingRow[] = [];
  const out: StagingRow[] = [];

  for (const row of rows) {
    const name = row.tags.name?.trim().toLowerCase();
    if (!name) {
      unnamed.push(row);
      continue;
    }
    const bucket = byName.get(name);
    if (bucket) bucket.push(row);
    else byName.set(name, [row]);
  }

  out.push(...mergeUnnamed(unnamed));

  for (const bucket of byName.values()) {
    const clusters: StagingRow[][] = [];
    for (const row of bucket) {
      const near = clusters.find((c) =>
        c.some(
          (o) => metresApart(o.point_wkt, row.point_wkt) <= DUPLICATE_RADIUS_M,
        ),
      );
      if (near) near.push(row);
      else clusters.push([row]);
    }

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        out.push(cluster[0]);
        continue;
      }
      // Ways (`w…`) and areas (`a…`) beat nodes (`n…`); between equals,
      // the richer tag set wins so the merge starts from the better row.
      //
      // 🔴 The osm_ref comparison is the important one, even though it
      // looks like a formality. Without it two equally-ranked rows are
      // ordered by whatever Postgres happened to return, which is not
      // guaranteed and does change — so the winner, and therefore the
      // slug, and therefore the published URL, would flip between runs.
      // Caught in testing: Camping Bled moved between `camping-bled` and
      // `camping-bled-2` on consecutive imports of identical data, which
      // is precisely the URL churn CAMP-87 forbids, happening silently
      // every Monday.
      const ranked = [...cluster].sort((a, b) => {
        const rank = (r: StagingRow) => (r.osm_ref.startsWith('n') ? 1 : 0);
        return (
          rank(a) - rank(b) ||
          Object.keys(b.tags).length - Object.keys(a.tags).length ||
          a.osm_ref.localeCompare(b.osm_ref)
        );
      });
      const [winner, ...losers] = ranked;
      for (const loser of losers) {
        for (const [k, v] of Object.entries(loser.tags)) {
          if (winner.tags[k] === undefined) winner.tags[k] = v;
        }
      }
      out.push(winner);
    }
  }

  return out;
}

/** Unnamed sites merge only this close — a quarter of the named radius. */
const UNNAMED_DUPLICATE_RADIUS_M = 50;

/** `n123` is a node; `w456` and `a789` are both the traced outline. */
const isPolygon = (ref: string) => !ref.startsWith('n');

/**
 * Polygon beats node; between equals, the richer tag set wins; and when
 * those tie, osm_ref decides.
 *
 * 🔴 That last step is not tidiness. Two equal rows would otherwise be
 * separated by input order, which comes from Postgres and is not
 * guaranteed stable — so the same data could elect a different winner on
 * a later run and move a published URL.
 */
function betterRow(a: StagingRow, b: StagingRow): StagingRow {
  if (isPolygon(a.osm_ref) !== isPolygon(b.osm_ref)) {
    return isPolygon(a.osm_ref) ? a : b;
  }
  const byTags = Object.keys(b.tags).length - Object.keys(a.tags).length;
  if (byTags !== 0) return byTags < 0 ? a : b;
  return a.osm_ref.localeCompare(b.osm_ref) <= 0 ? a : b;
}

/**
 * 🔴 Unnamed duplicates: merged, on a much tighter radius.
 *
 * With no name, proximity alone cannot tell "one site mapped twice" from
 * "two pitches side by side", so the first version of this refused to
 * merge unnamed rows at all. Measuring the built pages showed the cost:
 * the most duplicate-looking pages on the whole site were pairs of
 * unnamed spots in one region — same heading, same breadcrumb, every
 * amenity unknown, differing only in coordinates.
 *
 * So the rule is tightened instead of dropped: unnamed rows merge within
 * 50 m, a quarter of the named radius.
 *
 * The first attempt also demanded that one row be a node and the other a
 * polygon. Measuring killed that idea: of the 54 unnamed pairs inside
 * 50 m, only 8 are node-vs-polygon. The dominant pattern is 39 pairs of
 * `a` against `w` — an area and the way it was built from, both emitted
 * by `osmium export`, 3 to 43 m apart and averaging 19 m. That is our own
 * pipeline producing the same outline twice, not two campsites.
 *
 * The "two pitches side by side" worry that motivated the original
 * caution was calibrated for the 200 m radius and does not survive here:
 * we filter `tourism=camp_site` and `caravan_site`, never
 * `tourism=camp_pitch`, so individual pitches are not in this data at
 * all, and two whole campsites 19 m apart are not a real arrangement.
 */
export function mergeUnnamed(rows: StagingRow[]): StagingRow[] {
  const out: StagingRow[] = [];
  const taken = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    if (taken.has(i)) continue;
    let winner = rows[i];

    for (let j = i + 1; j < rows.length; j++) {
      if (taken.has(j)) continue;
      const other = rows[j];
      if (
        metresApart(winner.point_wkt, other.point_wkt) >
        UNNAMED_DUPLICATE_RADIUS_M
      ) {
        continue;
      }

      taken.add(j);
      const keep = betterRow(winner, other);
      const drop = keep === winner ? other : winner;
      for (const [k, v] of Object.entries(drop.tags)) {
        if (keep.tags[k] === undefined) keep.tags[k] = v;
      }
      winner = keep;
    }

    out.push(winner);
  }

  return out;
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
            osm_ref, last_seen_at, missing_since, content_changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326), $8, $9, NULL, $9)
         ON CONFLICT (osm_ref) DO UPDATE SET
           name          = EXCLUDED.name,
           country       = EXCLUDED.country,
           region        = EXCLUDED.region,
           type          = EXCLUDED.type,
           amenities     = EXCLUDED.amenities,
           location      = EXCLUDED.location,
           last_seen_at  = EXCLUDED.last_seen_at,
           missing_since = NULL,
           -- 🔴 CAMP-39: only moves when something a reader would notice
           -- moved. last_seen_at ticks every week whether or not anything
           -- changed, so using it as <lastmod> would restamp every page
           -- each Monday and teach crawlers the field is noise.
           content_changed_at = CASE
             WHEN (camping_spots.name, camping_spots.country,
                   camping_spots.region, camping_spots.type,
                   camping_spots.amenities)
                  IS DISTINCT FROM
                  (EXCLUDED.name, EXCLUDED.country,
                   EXCLUDED.region, EXCLUDED.type,
                   EXCLUDED.amenities)
               OR NOT ST_Equals(camping_spots.location, EXCLUDED.location)
             THEN EXCLUDED.last_seen_at
             ELSE camping_spots.content_changed_at
           END
           -- slug and owner_overrides are intentionally absent: see the
           -- header. Adding them here is the bug this comment prevents.
         -- RETURNING sees the final row, never EXCLUDED — Postgres
         -- rejects it there. $9 is the same value last_seen_at was set
         -- to, so comparing against it answers the same question.
         RETURNING (xmax = 0) AS was_insert,
                   (camping_spots.content_changed_at = $9) AS content_changed`;

interface StagingRow {
  osm_ref: string;
  point_wkt: string;
  /** Admin-1 name the point falls inside, e.g. "Bled". Null outside coverage. */
  admin_region: string | null;
  /** ISO-3166-1 alpha-2 of that polygon - overrides the CLI argument. */
  admin_country: string | null;
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
  const tagColumns = cols.rows
    .map((r) => r.column_name)
    .filter((c) => c !== 'id');

  // CAMP-34: the region and the country come from the geometry, not from
  // tags and not from the command line.
  //
  // Tags cannot supply them: addr:state or addr:province was present on
  // 0 of 448 Slovenian campsites (measured). And the country argument is
  // a claim about the whole extract, which is wrong at the edges - a
  // Geofabrik extract carries a strip beyond the border, so nine spots in
  // the Slovenian file actually stand in Croatia and Austria. Publishing
  // those under /camping/si/ would be a wrong URL that CAMP-87 then
  // forbids us to move.
  const hasBoundaries = await db.query(
    `SELECT to_regclass('public.ne_admin1') IS NOT NULL AS ok`,
  );
  if (!hasBoundaries.rows[0]?.ok) {
    throw new Error(
      'Table ne_admin1 is missing - every page URL depends on it.\n' +
        'Run: ./scripts/osm-pipeline/load-boundaries.sh',
    );
  }

  // 🔴 68% of the Slovenian extract are ways, not nodes - campsites are
  // mapped as areas. ST_PointOnSurface, not ST_Centroid: the centroid of a
  // concave or ring-shaped site can land outside it, which would put the
  // pin in a neighbouring field.
  const rows = await db.query(
    `WITH pts AS (
       SELECT s.*,
              CASE WHEN GeometryType(s.geom) = 'POINT'
                   THEN s.geom
                   ELSE ST_PointOnSurface(s.geom) END AS pt
         FROM "${TABLE}" s
        WHERE s.id IS NOT NULL
     )
     SELECT p.id AS osm_ref,
            ST_AsText(p.pt) AS point_wkt,
            a.name   AS admin_region,
            a.iso_a2 AS admin_country,
            p.*
       FROM pts p
       LEFT JOIN LATERAL (
         SELECT name, iso_a2 FROM ne_admin1
          WHERE ST_Contains(geom, p.pt) LIMIT 1
       ) a ON true
      ORDER BY p.id`,
  );

  const staged: StagingRow[] = rows.rows.map((row) => {
    const tags: OsmTags = {};
    for (const col of tagColumns) {
      const v = row[col];
      if (v !== null && v !== undefined && v !== '') tags[col] = String(v);
    }
    return {
      osm_ref: row.osm_ref,
      point_wkt: row.point_wkt,
      admin_region: row.admin_region ?? null,
      admin_country: row.admin_country ?? null,
      tags,
    };
  });

  const deduped = dedupe(staged);
  const droppedAsDuplicate = staged.length - deduped.length;

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
  /** Points whose polygon says a different country than the argument. */
  let outsideExtent = 0;
  /** Points outside every admin-1 polygon - these get no page URL. */
  let withoutRegion = 0;

  await db.query('BEGIN');
  try {
    for (const row of deduped) {
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

      // Geometry wins over the argument. The argument only stands in where
      // the point falls outside every polygon (open sea, a gap in the data).
      const region = row.admin_region;
      const country = row.admin_country ?? COUNTRY;
      if (row.admin_country && row.admin_country !== COUNTRY) outsideExtent++;
      if (!region) withoutRegion++;

      const res = await db.query(UPSERT_SPOT_SQL, [
        name,
        country,
        region,
        slug,
        type,
        JSON.stringify(amenities),
        row.point_wkt,
        row.osm_ref,
        startedAt,
      ]);
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
    console.log(
      `  merged duplicates  ${droppedAsDuplicate}  (named within 200 m, unnamed within 50 m; polygon beats node)`,
    );
    console.log(`  inserted           ${inserted}`);
    console.log(`  updated            ${updated}`);
    console.log(`  newly missing      ${gone.rowCount}`);
    console.log(`  ─────────────────────────`);
    console.log(`  rows in ${COUNTRY} now     ${total.rows[0].n}`);
    console.log(
      `\n  without a name     ${unnamed}  (pin shown, name honestly unknown)`,
    );
    console.log(`  mapped as areas    ${fromPolygon}  (ST_PointOnSurface)`);
    console.log(
      `  outside ${COUNTRY.padEnd(2)}         ${outsideExtent}  (extent overlaps the border; country taken from geometry)`,
    );
    if (withoutRegion) {
      console.log(
        `  🔴 no region       ${withoutRegion}  (no admin-1 polygon — these cannot get a page URL)`,
      );
    }
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
