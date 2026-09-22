/**
 * CAMP-32 — does the viewport query actually use the spatial index?
 *
 * The card asks for `EXPLAIN ANALYZE` "на реальному обсязі, а не на
 * десяти тестових рядках", and that qualifier is the whole point. With
 * 289 rows Postgres reads the table sequentially no matter what index
 * exists, because a sequential read of 289 rows is faster. A plan taken
 * at that size says nothing about the plan at 55 000, so measuring it
 * would be worse than not measuring it: it would look like proof.
 *
 * So this loads a realistic volume and reads the plan back.
 *
 * 🔴 It fails rather than warns. A performance check that prints a
 * warning is a performance check that nobody reads. Exit codes:
 *   0  the viewport query uses the GiST index
 *   1  it does not, or the harness could not run at all
 *
 * 🔴 It never touches public.camping_spots. Everything happens in a
 * scratch schema created with `LIKE public.camping_spots INCLUDING ALL`,
 * so the table, the column types and — the part that matters — the index
 * definitions are copies of the real ones rather than a hand-written
 * approximation that could drift from the migration.
 *
 * Run:  DATABASE_URL=... npx ts-node apps/api/src/spots/explain-map-queries.ts
 */

import { Client } from 'pg';

const SCHEMA = 'map_bench';
const ROWS = Number(process.env.BENCH_ROWS ?? 55_000);

/** Roughly Slovenia — the size of window at which the client asks for points. */
const REGION_BBOX = [13.3, 45.4, 16.6, 46.9] as const;
/** Roughly Europe — the size at which it must ask for clusters instead. */
const CONTINENT_BBOX = [-10, 35, 30, 60] as const;

const POINTS_SQL = `
  SELECT slug, name, country, region, type, amenities,
         ST_Y(location::geometry) AS lat,
         ST_X(location::geometry) AS lon
    FROM camping_spots
   WHERE missing_since IS NULL
     AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
   ORDER BY slug
   LIMIT 2001`;

const CLUSTERS_SQL = `
  SELECT COUNT(*)::int AS count,
         AVG(ST_X(location::geometry)) AS lon,
         AVG(ST_Y(location::geometry)) AS lat
    FROM camping_spots
   WHERE missing_since IS NULL
     AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
   GROUP BY ST_SnapToGrid(location::geometry, $5, $5)`;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

function walk(node: PlanNode, visit: (n: PlanNode) => void) {
  visit(node);
  for (const child of node.Plans ?? []) walk(child, visit);
}

interface PlanFacts {
  indexes: string[];
  seqScans: string[];
  ms: number;
  rows: number;
}

async function explain(
  db: Client,
  sql: string,
  params: unknown[],
): Promise<PlanFacts> {
  const res = await db.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    params,
  );
  const plan = res.rows[0]['QUERY PLAN'][0];
  const facts: PlanFacts = {
    indexes: [],
    seqScans: [],
    ms: plan['Execution Time'],
    rows: plan.Plan['Actual Rows'],
  };
  walk(plan.Plan, (n) => {
    if (n['Node Type'] === 'Seq Scan' && n['Relation Name']) {
      facts.seqScans.push(n['Relation Name']);
    }
    if (n['Index Name']) facts.indexes.push(n['Index Name']);
  });
  return facts;
}

async function seed(db: Client) {
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(
    `CREATE TABLE ${SCHEMA}.camping_spots
       (LIKE public.camping_spots INCLUDING ALL)`,
  );

  // 🔴 Not a uniform scatter. Campsites cluster — along coasts, in the
  // Alps, around lakes — and the planner's decisions depend on that
  // distribution. A uniform cloud would make every bbox equally
  // selective and quietly turn this into an easier problem than the
  // real one.
  await db.query(`SELECT setseed(0.42)`);
  await db.query(
    `INSERT INTO ${SCHEMA}.camping_spots
       (slug, name, country, region, type, amenities, location, last_seen_at)
     SELECT 'bench-' || g,
            CASE WHEN g % 4 = 0 THEN NULL ELSE 'Bench site ' || g END,
            (ARRAY['si','hr','at','it','fr','de','es','no'])[1 + (g % 8)],
            'bench-region-' || (g % 40),
            'paid'::public.camping_spots_type_enum,
            '{}'::jsonb,
            ST_SetSRID(
              ST_MakePoint(
                b.lon + (random() - 0.5) * 2.0,
                b.lat + (random() - 0.5) * 1.2
              ), 4326),
            now()
       FROM generate_series(1, $1) g
       JOIN (
         SELECT i,
                -- 🔴 Blob 0 is pinned inside the region window on
                -- purpose. With forty blobs scattered at random over
                -- Europe the chance that any lands in the window we
                -- measure is small, and the first run of this script
                -- produced a beautiful plan over ZERO rows. A plan for
                -- an empty result is not evidence of anything.
                CASE WHEN i = 0 THEN $2 ELSE -10 + random() * 40 END AS lon,
                CASE WHEN i = 0 THEN $3 ELSE  35 + random() * 25 END AS lat
           FROM generate_series(0, 39) i
       ) b ON b.i = g % 40`,
    [
      ROWS,
      (REGION_BBOX[0] + REGION_BBOX[2]) / 2,
      (REGION_BBOX[1] + REGION_BBOX[3]) / 2,
    ],
  );

  // Without this the planner is working from the statistics of an empty
  // table and will pick a plan that has nothing to do with the one it
  // would pick in production.
  await db.query(`ANALYZE ${SCHEMA}.camping_spots`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL is not set — refusing to report a plan I did not measure.',
    );
    process.exit(1);
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  let failed = false;

  try {
    await seed(db);
    await db.query(`SET search_path TO ${SCHEMA}, public`);

    // 🔴 `--self-test` proves the check can still fail. Postgres is told
    // to avoid index scans; the assertion below must then trip. A
    // performance guard that has quietly stopped guarding reports green
    // forever, which is worse than having none — the same reason the
    // structured-data validator carries a self-test (CAMP-37).
    if (process.argv.includes('--self-test')) {
      await db.query(`SET enable_indexscan = off`);
      await db.query(`SET enable_bitmapscan = off`);
      await db.query(`SET enable_indexonlyscan = off`);
      console.log(
        'SELF-TEST: index scans disabled; the check must now fail.\n',
      );
    }

    const count = (
      await db.query(`SELECT COUNT(*)::int AS n FROM camping_spots`)
    ).rows[0].n;
    if (count !== ROWS) {
      throw new Error(`seeded ${count} rows, expected ${ROWS}`);
    }
    console.log(
      `Seeded ${count.toLocaleString('en-GB')} campsites in ${SCHEMA}.\n`,
    );

    // ---- 1. The viewport query, at the window size that asks for points.
    const region = await explain(db, POINTS_SQL, [...REGION_BBOX]);
    const usesIndex = region.indexes.length > 0;
    console.log('points() over a region-sized viewport');
    console.log(`  rows      ${region.rows}`);
    console.log(`  time      ${region.ms.toFixed(1)} ms`);
    console.log(`  index     ${region.indexes.join(', ') || '— none —'}`);
    console.log(`  seq scans ${region.seqScans.join(', ') || 'none'}`);
    if (region.rows === 0) {
      // 🔴 The first version of this script reported a clean index scan
      // over an empty result and called it proof. It was not: Postgres
      // will happily use an index to find nothing.
      console.error(
        '\n✗ The region window contained no campsites, so the plan above ' +
          'measures nothing. Fix the seed, not the assertion.',
      );
      failed = true;
    } else if (!usesIndex || region.seqScans.includes('camping_spots')) {
      console.error(
        '\n✗ The viewport query did NOT use the spatial index. That is the ' +
          'one thing this card asks to be true.',
      );
      failed = true;
    } else {
      console.log('  ✓ uses the GiST index\n');
    }

    // ---- 2. The same query over a continent, which is why clusters exist.
    //
    // 🔴 Read this one carefully, because the first measurement misled
    // me. The wide query comes back FAST — and not because it is a good
    // idea. `ORDER BY slug LIMIT 2001` lets Postgres walk the slug index
    // and stop after two thousand rows, so it never touches the rest of
    // the table. It is quick and the answer is rubbish: the two thousand
    // alphabetically-first campsites in Europe, which is not a map.
    //
    // So the argument for clustering at low zoom was never CPU. It is
    // that no capped list of points can answer a continent-wide
    // question, however cheaply it returns.
    const wide = await explain(db, POINTS_SQL, [...CONTINENT_BBOX]);
    const total = (
      await db.query(
        `SELECT COUNT(*)::int AS n FROM camping_spots
          WHERE missing_since IS NULL
            AND location && ST_MakeEnvelope($1,$2,$3,$4,4326)`,
        [...CONTINENT_BBOX],
      )
    ).rows[0].n;
    console.log('points() over a continent-sized viewport');
    console.log(`  time      ${wide.ms.toFixed(1)} ms`);
    console.log(`  index     ${wide.indexes.join(', ') || '— none —'}`);
    console.log(
      `  returned  ${wide.rows} of ${total.toLocaleString('en-GB')} — ` +
        `truncated, and the subset is alphabetical, not spatial`,
    );

    const grid = (CONTINENT_BBOX[2] - CONTINENT_BBOX[0]) / 8;
    const clusters = await explain(db, CLUSTERS_SQL, [...CONTINENT_BBOX, grid]);
    console.log('clusters() over the same viewport');
    console.log(`  cells     ${clusters.rows}`);
    console.log(`  time      ${clusters.ms.toFixed(1)} ms`);
    console.log(`  index     ${clusters.indexes.join(', ') || '— none —'}`);
    console.log(`  seq scans ${clusters.seqScans.join(', ') || 'none'}`);
    console.log(
      `  covers    all ${total.toLocaleString('en-GB')} campsites in view\n`,
    );

    // The cluster query's job is to answer a whole-continent question
    // without sending the rows. If it ever returns a point-sized answer,
    // the grid rule has broken and the client would draw 55 000 bubbles.
    if (clusters.rows > 500) {
      console.error(
        `\n✗ The cluster grid produced ${clusters.rows} cells for one ` +
          'viewport. The grid rule is wrong.',
      );
      failed = true;
    }
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await db.end();
  }

  if (process.argv.includes('--self-test')) {
    if (failed) {
      console.log(
        '\n✓ Self-test passed: the check does still fail when it should.',
      );
      process.exit(0);
    }
    console.error(
      '\n✗ Self-test FAILED: with index scans switched off the check still ' +
        'reported success, so it is not checking anything.',
    );
    process.exit(1);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
