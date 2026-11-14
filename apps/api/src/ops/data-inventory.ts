// CAMP-508 — what we hold, one line per ENTITY, each with the query that
// counted it.
//
//   node dist/ops/data-inventory.js          # DATABASE_URL, prints markdown
//   node dist/ops/data-inventory.js --sql    # prints the one SELECT instead
//
// Against production, read-only, before the build is deployed there:
//
//   node dist/ops/data-inventory.js --sql \
//     | ssh camptribe "sudo -u postgres psql -At -d camptribe"
//
// 🔴 WHY THIS EXISTS. A description of the project written for outside
// readers on 12.11.2026 carried, side by side under "prices":
//
//   81 100   called "fuel prices"       — rows of `fuel_station_prices`:
//                                         one per station AND grade;
//   38 924   called "unique stations"   — `count(DISTINCT station_ref)`,
//                                         which is not a station either
//                                         (see `fuel_stations` below);
//   14 352   called "tariffs (prices)"  — rows of `spot_tariffs`: what a
//                                         CAMPSITE charges. Nothing to do
//                                         with fuel.
//
// Two outside reviewers read the first and the third as one measure that
// disagreed with itself. Neither number was wrong; the labels were. And a
// day later all of them had moved — the fuel import runs daily — so the
// typed copies were stale as well as mislabelled.
//
// 🔴 SO NO NUMBER IS WRITTEN HERE, AND NONE BELONGS IN A DESCRIPTION
// WITHOUT ITS LINE FROM THIS REPORT. Every line names the entity in
// words, the table, and the exact SQL — and the SQL printed is the SQL
// that ran, because both come from the same string (`ENTITIES[].sql`).
//
// 🔴 ONE SELECT, AND IT RETURNS FINISHED LINES. The CLI and `psql -At`
// print the same thing, so there is no second formatter to drift.

import 'dotenv/config';
import { Client } from 'pg';

export type Entity = {
  /** Stable name, for a test or a script to pick the line by. */
  key: string;
  /** What ONE counted thing is, in words a partner can read. */
  what: string;
  table: 'fuel_station_prices' | 'spot_tariffs' | 'camping_spots';
  /** A scalar query. Printed verbatim next to the number it produced. */
  sql: string;
};

export const ENTITIES: readonly Entity[] = [
  {
    key: 'fuel_price_rows',
    what: 'fuel price observations: one per station and fuel grade',
    table: 'fuel_station_prices',
    sql: 'SELECT count(*) FROM fuel_station_prices',
  },
  {
    // 🔴 (source, station_ref), NOT station_ref. The reference is the
    // publisher's own id and three national feeds number independently,
    // so the same `station_ref` is a different forecourt in another
    // feed — the table's primary key is (source, station_ref, grade)
    // for that reason. Measured on production, 13.11.2026 05:53 UTC:
    // DISTINCT station_ref = 39 096, DISTINCT (source, station_ref) =
    // 41 464. The shorter spelling loses 2 368 real stations.
    key: 'fuel_stations',
    what: 'filling stations we hold at least one price for',
    table: 'fuel_station_prices',
    sql: 'SELECT count(*) FROM (SELECT DISTINCT source, station_ref FROM fuel_station_prices) s',
  },
  {
    key: 'fuel_station_countries',
    what: 'countries those filling stations are in',
    table: 'fuel_station_prices',
    sql: 'SELECT count(DISTINCT country) FROM fuel_station_prices',
  },
  {
    key: 'campsite_tariffs',
    what: 'campsite tariffs: a price a campsite publishes for a pitch or a stay. Not fuel',
    table: 'spot_tariffs',
    sql: 'SELECT count(*) FROM spot_tariffs',
  },
  {
    key: 'campsites_with_a_tariff',
    what: 'campsites that publish at least one tariff',
    table: 'spot_tariffs',
    sql: 'SELECT count(DISTINCT spot_id) FROM spot_tariffs',
  },
  {
    // Everything ever imported. Larger than what the site shows: see
    // apps/web/src/lib/campsite-count.ts for the three campsite numbers.
    key: 'campsite_rows',
    what: 'campsite rows ever imported, including ones OpenStreetMap no longer has',
    table: 'camping_spots',
    sql: 'SELECT count(*) FROM camping_spots',
  },
  {
    key: 'campsite_rows_not_missing',
    what: 'campsite rows OpenStreetMap still has',
    table: 'camping_spots',
    sql: 'SELECT count(*) FROM camping_spots WHERE missing_since IS NULL',
  },
  {
    // 🔴 CODES, not countries and not "countries we show". A code can be
    // a subdivision (`AX`), and a member state can be held and not
    // published (apps/web/src/lib/unpublished-countries.ts). Measured on
    // production, 13.11.2026: the codes are exactly the 27 member
    // states and `AX` is not among them — the one we hold and do not
    // show is `CY`, by the owner's decision, not Åland.
    key: 'campsite_country_codes',
    what: 'distinct country codes on campsite rows (codes held, not countries shown)',
    table: 'camping_spots',
    sql: 'SELECT count(DISTINCT country) FROM camping_spots',
  },
];

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * One statement, one text column, one row per finished line.
 *
 * `| key | what | table | number | query |` — and a first line carrying
 * the database's own clock, because a count without its moment is the
 * thing this card was opened for.
 */
export function inventorySql(entities: readonly Entity[] = ENTITIES): string {
  const rows = entities.map(
    (e, i) =>
      `SELECT ${i + 1} AS ord, format('| %s | %s | \`%s\` | %s | \`%s\` |', ` +
      `${lit(e.key)}, ${lit(e.what)}, ${lit(e.table)}, (${e.sql}), ${lit(e.sql)}) AS line`,
  );
  return [
    `SELECT line FROM (`,
    `SELECT 0 AS ord, format('measured %s UTC on database %s', ` +
      `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), current_database()) AS line`,
    ...rows.map((r) => `UNION ALL ${r}`),
    `) t ORDER BY ord;`,
  ].join('\n');
}

async function main(): Promise<void> {
  if (process.argv.includes('--sql')) {
    console.log(inventorySql());
    return;
  }
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const r = await client.query<{ line: string }>(inventorySql());
    for (const row of r.rows) console.log(row.line);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
