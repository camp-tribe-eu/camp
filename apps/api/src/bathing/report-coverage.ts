// CAMP-168: how many campsites actually get a bathing water, and at what
// radius — measured, printed, and re-runnable.
//
//   npx ts-node src/bathing/report-coverage.ts
//
// 🔴 THE CORPUS AND THE MEASUREMENT DO NOT SHARE A FIELD.
//
// The population is every campsite row (`count(*)` over camping_spots),
// never "campsites that have a nearby bathing water". A coverage figure
// whose denominator is drawn from the same join as its numerator is not
// a measurement, it is a tautology — this repository has been caught by
// that four times.
//
// 🔴 The radius sweep is printed in full rather than only the chosen
// number, so the next person can see the shape of the curve and judge
// the choice instead of inheriting it.

import 'dotenv/config';
import { Client } from 'pg';
import { BATHING_SEASON } from './source';
import { BATHING_RADIUS_M } from './nearby';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

const RADII = [250, 500, 1000, 1500, 2000, 3000, 5000, 10000];

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const [{ spots }] = (
      await db.query(`SELECT count(*)::int AS spots FROM camping_spots`)
    ).rows;
    const [{ waters }] = (
      await db.query(
        `SELECT count(*)::int AS waters FROM bathing_waters WHERE season = $1`,
        [BATHING_SEASON],
      )
    ).rows;
    console.log(`campsites            ${spots}`);
    console.log(`bathing waters ${BATHING_SEASON}  ${waters}\n`);

    // One KNN per campsite, then bucket by radius — so the sweep is one
    // pass over the table rather than eight.
    console.log('nearest bathing water, by radius');
    const rows = (
      await db.query(
        `WITH nearest AS (
           SELECT s.id,
                  (SELECT ST_Distance(s.location, b.location)
                     FROM bathing_waters b
                    WHERE b.season = $1
                    ORDER BY s.location <-> b.location
                    LIMIT 1) AS m
             FROM camping_spots s
         )
         SELECT r AS radius,
                count(*) FILTER (WHERE m IS NOT NULL AND m <= r)::int AS within
           FROM nearest, unnest($2::int[]) AS r
          GROUP BY r ORDER BY r`,
        [BATHING_SEASON, RADII],
      )
    ).rows;
    for (const r of rows) {
      const pct = ((r.within / spots) * 100).toFixed(1);
      const mark = Number(r.radius) === BATHING_RADIUS_M ? '  <- chosen' : '';
      console.log(
        `  ${String(r.radius).padStart(6)} m   ${String(r.within).padStart(6)}   ${pct.padStart(5)}%${mark}`,
      );
    }

    // What the chosen radius yields, split by the thing the page has to
    // say — because "has a bathing water" and "has a CLASSIFIED bathing
    // water" are different sentences and the page prints both.
    console.log(`\nat ${BATHING_RADIUS_M} m, what the page will show`);
    const byStatus = (
      await db.query(
        `WITH nearest AS (
           SELECT s.id,
                  (SELECT b.status
                     FROM bathing_waters b
                    WHERE b.season = $1
                      AND ST_DWithin(s.location, b.location, $2)
                    ORDER BY s.location <-> b.location
                    LIMIT 1) AS status
             FROM camping_spots s
         )
         SELECT coalesce(status, 'none nearby') AS status, count(*)::int AS n
           FROM nearest GROUP BY 1 ORDER BY n DESC`,
        [BATHING_SEASON, BATHING_RADIUS_M],
      )
    ).rows;
    for (const r of byStatus) {
      console.log(
        `  ${String(r.status).padEnd(16)}${String(r.n).padStart(6)}   ` +
          `${((r.n / spots) * 100).toFixed(1)}%`,
      );
    }

    // 🔴 THE ARGUMENT FOR THE RADIUS, AND IT USES A DIFFERENT FIELD
    // FROM THE ONE IT IS JUDGING.
    //
    // "How near is near enough" cannot be answered with distance — every
    // rule of the form `gap <= x` is satisfied automatically by the rows
    // closest to zero, which is a corpus sharing a field with what it
    // measures. So the test is the KIND of water: CAMP-33 already
    // computed the nearest water feature for every campsite and labelled
    // it sea / lake / reservoir / river, from OpenStreetMap, years
    // before this dataset arrived. If the nearest bathing water is the
    // water beside the campsite, its EEA category agrees with that
    // label. Nothing in the comparison is derived from the distance.
    console.log("\ndoes the nearest bathing water agree with CAMP-33's");
    console.log('computed water KIND, by distance band?');
    const bands = (
      await db.query(
        `WITH n AS (
           SELECT s.context->'water'->>'kind' AS ctx_kind,
                  (SELECT round(ST_Distance(s.location, b.location))
                     FROM bathing_waters b WHERE b.season = $1
                    ORDER BY s.location <-> b.location, b.ref LIMIT 1) AS m,
                  (SELECT b.category
                     FROM bathing_waters b WHERE b.season = $1
                    ORDER BY s.location <-> b.location, b.ref LIMIT 1) AS cat
             FROM camping_spots s
         ), j AS (
           SELECT m, CASE
                  WHEN ctx_kind = 'sea'                 THEN cat IN ('Coastal','Transitional')
                  WHEN ctx_kind IN ('lake','reservoir') THEN cat = 'Lake'
                  WHEN ctx_kind = 'river'               THEN cat IN ('River','Transitional')
                  ELSE NULL END AS agrees
             FROM n WHERE m IS NOT NULL
         )
         SELECT (width_bucket(m, 0, 5000, 10) * 500)::int AS band,
                count(*)::int AS n,
                round(100.0 * count(*) FILTER (WHERE agrees) / count(*), 1) AS pct
           FROM j WHERE m <= 5000 GROUP BY 1 ORDER BY 1`,
        [BATHING_SEASON],
      )
    ).rows;
    for (const r of bands) {
      const mark =
        Number(r.band) === BATHING_RADIUS_M ? '  <- chosen radius' : '';
      console.log(
        `  up to ${String(r.band).padStart(5)} m   ${String(r.n).padStart(6)}   ` +
          `${String(r.pct).padStart(5)}% agree${mark}`,
      );
    }

    // 🔴 Countries with campsites but no match, printed by name. A
    // longitude/latitude swap, or a country lost to a code-system
    // mismatch, shows up here as a whole member state at zero — and as
    // nothing at all in the single percentage above.
    console.log('\nmatched campsites by country');
    const byCountry = (
      await db.query(
        `SELECT s.country,
                count(*)::int AS spots,
                count(*) FILTER (
                  WHERE EXISTS (SELECT 1 FROM bathing_waters b
                                 WHERE b.season = $1
                                   AND ST_DWithin(s.location, b.location, $2))
                )::int AS matched
           FROM camping_spots s
          GROUP BY s.country ORDER BY s.country`,
        [BATHING_SEASON, BATHING_RADIUS_M],
      )
    ).rows;
    for (const r of byCountry) {
      const pct = r.spots ? ((r.matched / r.spots) * 100).toFixed(1) : '0.0';
      console.log(
        `  ${r.country}  ${String(r.matched).padStart(5)} / ${String(r.spots).padStart(5)}  ${pct.padStart(5)}%`,
      );
    }
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
