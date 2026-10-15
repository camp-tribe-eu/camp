// CAMP-262: how much of each scoring input do we actually know?
//
// The planner's formula puts a weight on each input. A weight on an input
// we know for 3% of the campsites ranks the other 97% by "we know nothing
// about them". This script is where that percentage comes from, so that it
// is a measurement and not a sentence somebody typed.
//
//   cd apps/api
//   npx ts-node src/planner/measure-coverage.ts            # print the table
//   npx ts-node src/planner/measure-coverage.ts --write    # rewrite coverage.snapshot.json
//   npx ts-node src/planner/measure-coverage.ts --check    # exit 1 if the snapshot has drifted
//
// Reads DATABASE_URL (default: the local camptribe_dev). Read-only by
// construction: everything runs in one READ ONLY transaction (read-only.ts),
// which is also why the numbers agree with each other while an import is
// writing.
//
// 🔴 THE POPULATION is `plannerPopulationSql` — the campsites that have a
// page. Not "all rows": thousands are missing, regionless or hidden
// secondaries, and a coverage measured over rows the planner can never
// suggest says nothing about what it will suggest.
//
// 🔴 STARS ARE READ THE WAY THE PAGE READS THEM, through `mergedStarsSql`.
// The official star rating lives on a DATAtourisme row that is linked to
// the OSM row and hidden behind it; the page prints it on the OSM row. The
// raw column of the visible row holds a fraction of what the page shows
// (`evidence.starsOwnRow` against `fields.stars`). Three cards quoted three
// different numbers for this field because each counted a different set,
// read a different way.
//
// 🔴 AN AMENITY IS KNOWN WHEN IT SAYS `yes` OR `no`. `unknown` and a key
// that is simply absent (a row written before the amenity existed) are the
// same thing: nobody recorded it. CAMP-260's table counts the same way.

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { AMENITY_KEYS, AmenityValue } from '../osm/tag-mapping';
import { mergedStarsSql } from '../spots/links';
import {
  CoverageSnapshot,
  driftOf,
  FieldCoverage,
  shareOf,
} from './coverage-snapshot';
import { plannerPopulationSql } from './population';
import { inReadOnlyTransaction, Queryable } from './read-only';

export const SNAPSHOT_FILE = join(__dirname, 'coverage.snapshot.json');

/** The planner's candidates, with the one thing each input is read from. */
const POPULATION_CTE = `WITH p AS (
  SELECT s.country, s.location, s.amenities, s.owner_overrides,
         s.stars AS own_stars,
         ${mergedStarsSql('s')} AS stars
    FROM camping_spots s
   WHERE ${plannerPopulationSql('s')}
)`;

export const SQL = {
  scalars: `${POPULATION_CTE}
SELECT count(*)::int                                          AS n,
       count(*) FILTER (WHERE location IS NOT NULL)::int      AS location_known,
       count(*) FILTER (WHERE stars IS NOT NULL)::int         AS stars_known,
       count(*) FILTER (WHERE own_stars IS NOT NULL)::int     AS stars_own_row,
       coalesce(avg(stars), 0)::float8                        AS stars_mean,
       count(*) FILTER (WHERE owner_overrides <> '{}'::jsonb)::int AS overridden,
       now()::text                                            AS measured_at
  FROM p`,
  // One row per amenity key, the keys passed as ONE array parameter: a
  // list this file does not splice into SQL text.
  amenities: `${POPULATION_CTE}
SELECT k.key,
       count(*) FILTER (WHERE p.amenities ->> k.key IN ('${AmenityValue.YES}', '${AmenityValue.NO}'))::int AS known,
       count(*) FILTER (WHERE p.amenities ->> k.key = '${AmenityValue.YES}')::int AS yes
  FROM p CROSS JOIN unnest($1::text[]) AS k(key)
 GROUP BY k.key`,
  starsByCountry: `${POPULATION_CTE}
SELECT country, count(*)::int AS known
  FROM p WHERE stars IS NOT NULL
 GROUP BY country ORDER BY known DESC, country`,
};

/** What the snapshot is the output OF. A different query is a different table. */
export function queryHash(): string {
  return createHash('sha256')
    .update(JSON.stringify([SQL, [...AMENITY_KEYS]]))
    .digest('hex');
}

/**
 * Measures the population. The caller owns the transaction.
 *
 * Throws when a row in the population carries an owner override: the page
 * prefers an owner's correction to the imported value, this query reads the
 * imported value, and a measurement that cannot see something it is
 * supposed to count must say so instead of rounding it to nothing.
 */
export async function measureCoverage(
  db: Queryable,
): Promise<CoverageSnapshot> {
  const [scalars] = (await db.query(SQL.scalars)).rows as Array<
    Record<string, number | string>
  >;
  const n = Number(scalars.n);
  if (!(n > 0)) {
    throw new Error('the planner population is empty - nothing to measure');
  }
  if (Number(scalars.overridden) > 0) {
    throw new Error(
      `${scalars.overridden} campsites carry owner_overrides, which this ` +
        `measurement does not read. Teach it the override before trusting it.`,
    );
  }

  const fields: Record<string, FieldCoverage> = {
    location: { known: Number(scalars.location_known) },
    stars: { known: Number(scalars.stars_known) },
  };
  const amenityRows = (await db.query(SQL.amenities, [[...AMENITY_KEYS]]))
    .rows as Array<{ key: string; known: number; yes: number }>;
  // Anchor: one row per key, or an amenity silently has no coverage.
  if (amenityRows.length !== AMENITY_KEYS.length) {
    throw new Error(
      `expected ${AMENITY_KEYS.length} amenity rows, got ${amenityRows.length}`,
    );
  }
  // In AMENITY_KEYS order, not the order GROUP BY happened to return, so
  // two runs over the same data write the same file.
  for (const key of AMENITY_KEYS) {
    const r = amenityRows.find((row) => row.key === key);
    if (!r) throw new Error(`no coverage row for amenity ${key}`);
    fields[key] = { known: Number(r.known), yes: Number(r.yes) };
  }

  const byCountry: Record<string, number> = {};
  for (const r of (await db.query(SQL.starsByCountry)).rows) {
    byCountry[String(r.country)] = Number(r.known);
  }

  return {
    measuredAt: String(scalars.measured_at),
    population: { n },
    queryHash: queryHash(),
    fields,
    evidence: {
      starsMean: Number(scalars.stars_mean),
      starsOwnRow: Number(scalars.stars_own_row),
      starsKnownByCountry: byCountry,
    },
  };
}

/** The table people read. Every figure is derived from the snapshot. */
export function formatTable(s: CoverageSnapshot): string {
  const lines = [
    `Coverage of scoring inputs, measured ${s.measuredAt}`,
    `population: ${s.population.n} campsites with a page`,
    '',
    'input'.padEnd(16) + 'known'.padStart(8) + 'of n'.padStart(8) + '   share',
  ];
  for (const [field, f] of Object.entries(s.fields)) {
    const share = shareOf(s, field);
    lines.push(
      field.padEnd(16) +
        String(f.known).padStart(8) +
        String(s.population.n).padStart(8) +
        `   ${share === undefined ? 'n/a' : (share * 100).toFixed(1) + '%'}` +
        (f.yes === undefined ? '' : `   (yes ${f.yes})`),
    );
  }
  lines.push(
    '',
    `stars: mean ${s.evidence.starsMean.toFixed(2)}, on the visible row alone ` +
      `${s.evidence.starsOwnRow}, known by country ` +
      JSON.stringify(s.evidence.starsKnownByCountry),
  );
  return lines.join('\n');
}

export function readSnapshotFile(): CoverageSnapshot {
  return JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as CoverageSnapshot;
}

/** Stable layout and a trailing newline: a re-run over the same data diffs to nothing. */
export function serialise(s: CoverageSnapshot): string {
  return JSON.stringify(s, null, 2) + '\n';
}

async function main(argv: string[]): Promise<number> {
  const flags = argv.filter((a) => a.startsWith('--'));
  const stray = argv.filter((a) => !a.startsWith('--'));
  const known = ['--write', '--check'];
  const unknownFlag = flags.find((f) => !known.includes(f));
  if (unknownFlag || stray.length || flags.length > 1) {
    console.error(
      `usage: measure-coverage.ts [--write | --check]  (got: ${argv.join(' ') || 'nothing'})`,
    );
    return 2;
  }

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await client.connect();
  let live: CoverageSnapshot;
  try {
    live = await inReadOnlyTransaction(client, () => measureCoverage(client));
  } finally {
    await client.end();
  }

  if (flags[0] === '--write') {
    writeFileSync(SNAPSHOT_FILE, serialise(live));
    console.log(formatTable(live));
    console.log(`\nwrote ${SNAPSHOT_FILE}`);
    return 0;
  }
  if (flags[0] === '--check') {
    const drift = driftOf(readSnapshotFile(), live);
    if (drift.length) {
      console.error('coverage.snapshot.json no longer matches the database:');
      for (const d of drift) console.error(`  ${d}`);
      console.error('re-measure with --write, then re-read the weights.');
      return 1;
    }
    console.log(
      `coverage.snapshot.json still matches the database (${live.population.n} campsites).`,
    );
    return 0;
  }
  console.log(formatTable(live));
  return 0;
}

// Guarded like every other script here: an import must not run it.
if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
