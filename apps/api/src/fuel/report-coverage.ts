// CAMP-154: the measurements behind MATCH_RADIUS_M and the coverage
// figures, re-derivable from this branch.
//
//   npx ts-node src/fuel/report-coverage.ts
//
// 🔴 THIS FILE EXISTS BECAUSE match.ts CITED IT AND IT DID NOT.
//
// The comment on `MATCH_RADIUS_M` said the 150 m was "measured, not
// chosen — see report-coverage.ts, which prints the distance
// distribution this number was read off", and no such file was in the
// branch. A citation to a script nobody can run is worse than no
// citation: it reads as evidence and is a claim about a measurement
// somebody once took. The numbers below are the ones the constant was
// set from, and this prints them again from whatever database it is
// pointed at, so a future reader can check the radius rather than
// inherit it.
//
// It reads and writes nothing. Point it at a scratch database that has
// been through `import-stations.ts`.

import 'dotenv/config';
import { Client } from 'pg';
import { MATCH_RADIUS_M } from './match';
import { SOURCES } from './stations';

async function main(): Promise<void> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await client.connect();

  try {
    // ── 1. Coverage, counted over rows that exist whether or not they
    // matched. `osm_ref` is nullable precisely so this denominator is
    // not the column being measured.
    const coverage = await client.query(`
      SELECT country,
             count(DISTINCT (source, station_ref))                    AS stations,
             count(DISTINCT (source, station_ref))
               FILTER (WHERE osm_ref IS NOT NULL)                     AS matched,
             count(*)                                                 AS price_rows,
             count(*) FILTER (WHERE grade = 'diesel')                 AS diesel,
             count(*) FILTER (WHERE grade = 'petrol')                 AS petrol
        FROM fuel_station_prices
       GROUP BY country
       ORDER BY country
    `);
    console.log('\nStations and price rows, per country');
    console.log('  country  stations  matched   rate   diesel   petrol');
    for (const r of coverage.rows) {
      const rate = (Number(r.matched) / Number(r.stations)) * 100;
      console.log(
        `  ${String(r.country).padEnd(7)}  ${String(r.stations).padStart(8)}  ` +
          `${String(r.matched).padStart(7)}  ${rate.toFixed(1).padStart(5)}%  ` +
          `${String(r.diesel).padStart(6)}  ${String(r.petrol).padStart(7)}`,
      );
    }

    // ── 2. The other direction: how much of the route POI layer we can
    // put a price on. This is the number the PAGE's coverage is.
    const points = await client.query(
      `
      SELECT p.country,
             count(*)                                       AS fuel_points,
             count(*) FILTER (WHERE f.osm_ref IS NOT NULL)  AS with_price
        FROM osm_route_poi p
        LEFT JOIN (
               SELECT DISTINCT osm_ref FROM fuel_station_prices
                WHERE osm_ref IS NOT NULL
             ) f ON f.osm_ref = p.osm_ref
       WHERE p.kind = 'fuel'
         AND p.country = ANY($1::text[])
       GROUP BY p.country
       ORDER BY p.country
    `,
      [SOURCES.map((s) => s.country)],
    );
    console.log('\nOSM fuel points we can price, per country');
    console.log('  country  fuel points  with a price   share');
    for (const r of points.rows) {
      const share = (Number(r.with_price) / Number(r.fuel_points)) * 100;
      console.log(
        `  ${String(r.country).padEnd(7)}  ${String(r.fuel_points).padStart(11)}  ` +
          `${String(r.with_price).padStart(12)}  ${share.toFixed(1).padStart(5)}%`,
      );
    }

    // ── 3. 🔴 THE DISTRIBUTION MATCH_RADIUS_M WAS READ OFF.
    //
    // The shape is the argument, not the percentiles alone: the band
    // counts fall away steeply and are nearly flat by the last bucket,
    // which is what says the radius has exhausted the real pairs rather
    // than cutting through a population.
    const buckets = await client.query(
      `
      SELECT width_bucket(match_metres, 0, $1, 10) * ($1 / 10.0) AS upto_m,
             count(DISTINCT (source, station_ref))               AS stations
        FROM fuel_station_prices
       WHERE osm_ref IS NOT NULL
       GROUP BY 1 ORDER BY 1
    `,
      [MATCH_RADIUS_M],
    );
    console.log(`\nMatch distance, in ${MATCH_RADIUS_M / 10} m bands`);
    for (const r of buckets.rows) {
      console.log(
        `  ≤ ${String(Math.round(Number(r.upto_m))).padStart(4)} m  ` +
          `${String(r.stations).padStart(7)}`,
      );
    }

    const pct = await client.query(`
      SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY match_metres)::numeric, 1)  AS p50,
             round(percentile_cont(0.9) WITHIN GROUP (ORDER BY match_metres)::numeric, 1)  AS p90,
             round(percentile_cont(0.99) WITHIN GROUP (ORDER BY match_metres)::numeric, 1) AS p99
        FROM fuel_station_prices WHERE osm_ref IS NOT NULL
    `);
    const p = pct.rows[0];
    console.log(`  median ${p.p50} m · p90 ${p.p90} m · p99 ${p.p99} m`);

    // ── 4. What a WIDER radius would buy, which is the other half of
    // the argument: the matches between here and 300 m are the ones at
    // the distance where the next station down the road lives.
    const wider = await client.query(
      `
      WITH s AS (
        SELECT source, station_ref, country, min(location::text) AS loc,
               bool_or(osm_ref IS NOT NULL) AS matched
          FROM fuel_station_prices GROUP BY source, station_ref, country
      ),
      u AS (SELECT country, loc::geometry AS location FROM s WHERE NOT matched),
      n AS (
        SELECT (SELECT ST_Distance(u.location::geography, r.location::geography)
                  FROM osm_route_poi r
                 WHERE r.kind = 'fuel' AND r.country = u.country
                 ORDER BY r.location <-> u.location LIMIT 1) AS m
          FROM u
      )
      SELECT count(*) FILTER (WHERE m > $1 AND m <= 300)  AS band_to_300,
             count(*) FILTER (WHERE m > 300)              AS beyond_300,
             count(*) FILTER (WHERE m IS NULL)            AS no_point_at_all
        FROM n
    `,
      [MATCH_RADIUS_M],
    );
    const w = wider.rows[0];
    console.log(
      '\nUnmatched stations, by how far the nearest OSM fuel point is',
    );
    console.log(
      `  ${MATCH_RADIUS_M}–300 m   ${w.band_to_300}   ← what widening would buy`,
    );
    console.log(`  over 300 m   ${w.beyond_300}`);
    console.log(`  none at all  ${w.no_point_at_all}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
