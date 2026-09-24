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
import { isEuMemberState } from './eu';

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
            osm_ref, last_seen_at, missing_since, content_changed_at, sources)
         -- 🔴 $8::text in BOTH places, not just in the JSON below.
         --
         -- osm_ref is character varying, so an uncast $8 here made
         -- Postgres deduce varchar from the column and text from the
         -- cast in jsonb_build_object, and refuse the whole statement:
         -- "inconsistent types deduced for parameter $8 — text versus
         -- character varying". Every OSM import failed on the first row.
         --
         -- It went unnoticed because the sources column (CAMP-101) added
         -- the second use of $8 after the last import had run, and the
         -- weekly workflow only BUILDS extracts — it does not import
         -- them. So the break sat between two jobs that each looked
         -- healthy. Found 24.09.2026 while importing the EU.
         VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326), $8::text, $9, NULL, $9,
                 jsonb_build_array(jsonb_build_object(
                   'id', 'osm', 'ref', $8::text,
                   'updatedAt', to_char($9::timestamptz, 'YYYY-MM-DD'),
                   'fields', '["name","location","amenities"]'::jsonb)))
         ON CONFLICT (osm_ref) DO UPDATE SET
           name          = EXCLUDED.name,
           country       = EXCLUDED.country,
           region        = EXCLUDED.region,
           type          = EXCLUDED.type,
           amenities     = EXCLUDED.amenities,
           location      = EXCLUDED.location,
           last_seen_at  = EXCLUDED.last_seen_at,
           missing_since = NULL,
           -- 🔴 CAMP-101. Replace only OUR entry; keep every other
           -- source's. Writing EXCLUDED.sources wholesale would erase
           -- the DATAtourisme attribution every Monday — the same class
           -- of bug as overwriting owner_overrides, and just as silent.
           --
           -- The date here is when WE last found the campsite in OSM,
           -- never when a mapper last edited it, and the page says
           -- exactly that ("last checked against this source on").
           sources = (
             SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
               FROM jsonb_array_elements(camping_spots.sources) e
              WHERE e->>'id' <> 'osm'
           ) || EXCLUDED.sources,
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
            -- 🔴 Natural Earth writes -1 where it has no ISO code, and
            -- that is "unknown", not "not a country".
            --
            -- Measured 24.09.2026 on the released Cyprus extract: of 66
            -- campsites, 33 fall in the polygon called Northern Cyprus
            -- and 3 in Dhekelia, both coded -1. Read literally, the EU
            -- filter below then throws 55% of Cyprus away as foreign —
            -- from the extract of a member state, which is the one place
            -- it cannot be right. (Some builds use -99; both are here.)
            --
            -- A sentinel becomes NULL, and NULL already has an answer
            -- one line down: fall back to the country being imported.
            -- That is the same rule as a point in the sea, for the same
            -- reason — we do not know better than the extract, and a
            -- missing value must never read as a refusal.
            CASE WHEN a.iso_a2 ~ '^[A-Za-z]{2}$' THEN a.iso_a2 END
              AS admin_country,
            p.*
       FROM pts p
       LEFT JOIN LATERAL (
         -- 🔴 Containment first, nearest polygon second — and the second
         -- is not a nicety.
         --
         -- Natural Earth is 1:10m, so its coastline is generalised. The
         -- first Croatian import put 367 campsites of 778 — 47% — outside
         -- every admin-1 polygon, and without a region a campsite gets no
         -- page URL at all. Measured, every one of them was within
         -- 3.85 km of a Croatian polygon; the average was 593 m and the
         -- closest 8 m. They are not in the sea: they are on a shore or a
         -- small island that the generalised outline smooths away, and
         -- Croatia's campsites are overwhelmingly coastal.
         --
         -- So a point that falls in nothing takes the nearest polygon of
         -- a country, within a hard limit. The limit is what keeps this
         -- honest: beyond it the row keeps no region and gets no page,
         -- rather than being assigned a county by a guess.
         --
         -- 🔴 Two steps, because one was unusably slow. Casting every
         -- polygon to geography to measure a distance defeats the GiST
         -- index, and the query then compared each point against all
         -- 4,594 admin-1 polygons on Earth. First the index narrows to a
         -- handful of candidates by bounding box and KNN; only those few
         -- are measured exactly.
         SELECT c.name, c.iso_a2
           FROM (
             SELECT name, iso_a2, geom, ST_Contains(geom, p.pt) AS inside
               FROM ne_admin1
              WHERE geom && ST_Expand(p.pt, 0.1)
              ORDER BY geom <-> p.pt
              LIMIT 8
           ) c
          WHERE c.inside
             OR ST_DWithin(c.geom::geography, p.pt::geography, 5000)
          -- Containment always wins; among near misses the closest wins.
          -- 🔴 name breaks the tie, because two polygons can be
          -- equidistant and an undetermined winner would move a published
          -- URL between runs (the lesson of CAMP-39).
          ORDER BY c.inside DESC, c.geom <-> p.pt, c.name
          LIMIT 1
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
  /** Points that resolved to a country outside the European Union. */
  let outsideUnion = 0;
  /** Points outside every admin-1 polygon - these get no page URL. */
  let withoutRegion = 0;

  await db.query('BEGIN');
  try {
    for (const row of deduped) {
      // Geometry wins over the argument. The argument only stands in where
      // the point falls outside every polygon (open sea, a gap in the data).
      const region = row.admin_region;
      const country = row.admin_country ?? COUNTRY;

      // 🔴 CAMP-118: the Union, and nothing else. DECIDED FIRST, on purpose.
      //
      // Geofabrik cuts its extracts to bounding boxes, so Slovenia's
      // includes a strip of Bosnia and Croatia's a strip of Serbia. The
      // line above resolves those points to their real country — which is
      // right — and the old code then imported them anyway, merely
      // counting them as `outsideExtent`. That is how 13 Bosnian and 2
      // Serbian campsites ended up in a database whose stated scope is
      // the EU, with nobody deciding anything.
      //
      // They are skipped here rather than filtered later, because a row
      // that never arrives cannot be forgotten about; and the count is
      // printed, because a filter that silently drops things is the next
      // problem after the one it fixed.
      //
      // 🔴 And it stands BEFORE the slug, not after. Review caught the
      // first version skipping the row only once the slug had already
      // been reserved in `usedSlugs`: a Bosnian "Camping Sava" that we
      // never import would take `camping-sava` with it, and the Slovenian
      // one arriving later in the same run would be published as
      // `camping-sava-2` — a permanent URL, paid for by a row that does
      // not exist. Same reason the other counters moved down: a row we
      // refuse is not an unnamed campsite, not a border campsite and not
      // a region-less campsite. It is not a campsite of ours at all.
      if (!isEuMemberState(country)) {
        outsideUnion++;
        continue;
      }

      const name = row.tags.name?.trim() || null;
      if (!name) unnamed++;
      if (row.admin_country && row.admin_country !== COUNTRY) outsideExtent++;
      if (!region) withoutRegion++;

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
    //
    // 🔴 `last_seen_at < startedAt` on its own is wrong, and the second
    // country is what exposed it.
    //
    // Geofabrik's extracts overlap at the borders, and their idea of a
    // border is OSM's, while ours is Natural Earth's. Kamp Hupkač sits in
    // Međimurje: Natural Earth puts it inside Croatia, so we store it as
    // HR — and Geofabrik's Croatian extract does not contain it, because
    // OSM's boundary runs differently. It arrived in the SLOVENIAN
    // extract, an hour earlier in the same import cycle.
    //
    // With the naive condition, every weekly Croatian import declared a
    // campsite that plainly exists to be missing, and after four of them
    // CAMP-73 would start answering 410 for a live campsite — the exact
    // damage the 410 was built to avoid.
    //
    // So a spot seen by ANY extract in this cycle is not missing. The
    // window is generous on purpose: the gone rule already waits four
    // weeks, so nothing is lost by being slow to suspect.
    const CYCLE_HOURS = 24;
    const gone = await db.query(
      `UPDATE camping_spots
          SET missing_since = $1
        WHERE country = $2
          AND osm_ref IS NOT NULL
          AND (last_seen_at IS NULL
               OR last_seen_at < $1::timestamptz - ($3 || ' hours')::interval)
          AND missing_since IS NULL
        RETURNING osm_ref`,
      [startedAt, COUNTRY, CYCLE_HOURS],
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
    if (outsideUnion) {
      // 🔴 Said out loud every run. A filter nobody sees working is a
      // filter somebody removes as dead code, and this one is the only
      // thing keeping the project's stated scope true in the data.
      console.log(
        `  outside the EU     ${outsideUnion}  (skipped — CAMP-118, we serve the Union)`,
      );
    }
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
