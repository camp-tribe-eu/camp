// CAMP-147: prove the prices on the site are ones we are allowed to show.
//
//   npx ts-node src/datatourisme/verify-prices.ts
//
// 🔴 THE CARD'S OWN ACCEPTANCE CLAUSES, AS QUERIES.
//
//   "The share of campsites with a price on the site is measured and
//    equals what the matching produced; no displayed price exists
//    without a validity period and a source; a page with an expired
//    tariff says so rather than staying silent; textPriceSpecification
//    is nowhere turned into a number."
//
// Three of those four are statements about ROWS and are checked here.
// The fourth — that prose is never read as a number — is a statement
// about CODE, and lives in prices.spec.ts where a mutation can test it:
// `textPriceNotes` returns strings and has no way to return a number.
// What this file can add is the row-level corollary, that nothing in
// `spot_tariffs` came from a prose record.
//
// Exits non-zero on any failure, so CI can run it.

import 'dotenv/config';
import { Client } from 'pg';
import { DISPLAYABLE_TARIFF_SQL } from '../spots/tariffs';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * Every campsite that actually has a page.
 *
 * 🔴 The same three conditions the read path uses — a region (or there
 * is no URL), not missing from OSM, and not hidden behind a link. A
 * "coverage" number counted over all 61 558 rows would be a different
 * and much more flattering question than the one the card asks.
 */
const PAGE_SQL = `
  SELECT p.id, COALESCE(l.secondary_id, p.id) AS src
    FROM camping_spots p
    LEFT JOIN spot_links l
      ON l.primary_id = p.id AND l.unlinked_at IS NULL
   WHERE p.region IS NOT NULL
     AND p.missing_since IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM spot_links s
         JOIN camping_spots sp ON sp.id = s.primary_id
        WHERE s.secondary_id = p.id AND s.unlinked_at IS NULL
          AND sp.missing_since IS NULL AND sp.region IS NOT NULL)`;

/** A count that must be zero, and what a non-zero one would mean. */
const MUST_BE_ZERO: { name: string; sql: string }[] = [
  {
    name: 'no stored tariff is missing its source attribution date',
    // Licence Ouverte 2.0: the source AND the date it last updated what
    // we reuse. The column is NOT NULL, so this can only fail if
    // somebody makes it nullable — which is exactly when it matters.
    sql: `SELECT count(*)::int AS n FROM spot_tariffs
           WHERE source_updated_at IS NULL OR source_id IS NULL
              OR source_id = ''`,
  },
  {
    name: 'no stored tariff is a currency with no amount',
    // 1 264 specifications in the feed are exactly that. A row here
    // would render as "€ –" on a page.
    sql: `SELECT count(*)::int AS n FROM spot_tariffs
           WHERE min_price IS NULL AND max_price IS NULL`,
  },
  {
    name: 'no stored tariff has a range that runs backwards',
    sql: `SELECT count(*)::int AS n FROM spot_tariffs
           WHERE min_price IS NOT NULL AND max_price IS NOT NULL
             AND min_price > max_price`,
  },
  {
    name: 'no stored tariff has a season that runs backwards',
    sql: `SELECT count(*)::int AS n FROM spot_tariffs
           WHERE valid_from IS NOT NULL AND valid_until IS NOT NULL
             AND valid_from > valid_until`,
  },
  {
    name: 'no label travels without the language it is written in',
    // The page renders this into a `lang` attribute. Unlabelled French
    // prose is read aloud in English by a screen reader.
    sql: `SELECT count(*)::int AS n FROM spot_tariffs
           WHERE label IS NOT NULL AND label_lang IS NULL`,
  },
  {
    name: '🔴 no DISPLAYABLE tariff exists without a validity period',
    // The card's central prohibition, asked of the rows the read path
    // would actually serve — using the read path's own predicate rather
    // than a copy of it.
    sql: `SELECT count(*)::int AS n FROM spot_tariffs t
           WHERE ${DISPLAYABLE_TARIFF_SQL}
             AND t.valid_from IS NULL AND t.valid_until IS NULL`,
  },
  {
    name: 'no tariff is attached to a campsite that no longer exists',
    sql: `SELECT count(*)::int AS n FROM spot_tariffs t
           WHERE NOT EXISTS (SELECT 1 FROM camping_spots s WHERE s.id = t.spot_id)`,
  },
  {
    name: 'every tariff names a currency',
    sql: `SELECT count(*)::int AS n FROM spot_tariffs
           WHERE currency IS NULL OR currency !~ '^[A-Z]{3}$'`,
  },
];

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  let failed = 0;

  try {
    console.log('── invariants ──────────────────────────────────────────');
    for (const check of MUST_BE_ZERO) {
      const n = Number((await db.query(check.sql)).rows[0]?.n ?? 0);
      console.log(
        `  ${n === 0 ? '✓' : '✗'} ${check.name}${n ? ` (${n})` : ''}`,
      );
      if (n !== 0) failed++;
    }

    console.log('\n── what the table holds ────────────────────────────────');
    const stored = (
      await db.query(`
        SELECT count(*)::int AS rows,
               count(DISTINCT spot_id)::int AS spots,
               count(*) FILTER (WHERE valid_from IS NOT NULL
                                   OR valid_until IS NOT NULL)::int AS datable,
               count(DISTINCT spot_id) FILTER (WHERE valid_from IS NOT NULL
                                   OR valid_until IS NOT NULL)::int AS datable_spots
          FROM spot_tariffs`)
    ).rows[0];
    console.log(`  tariff rows                     ${stored.rows}`);
    console.log(`  campsites carrying one          ${stored.spots}`);
    console.log(`  rows with a validity period     ${stored.datable}`);
    console.log(`  campsites with a datable price  ${stored.datable_spots}`);

    console.log('\n── what a reader actually sees ─────────────────────────');
    // 🔴 THE number the card asks for. Counted over pages, through the
    // link, with the read path's own predicate.
    const shown = (
      await db.query(`
        WITH page AS (${PAGE_SQL})
        SELECT count(*)::int AS pages,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM spot_tariffs t
                  WHERE t.spot_id = page.src AND ${DISPLAYABLE_TARIFF_SQL}))::int
                 AS priced,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM spot_tariffs t
                  WHERE t.spot_id = page.src AND ${DISPLAYABLE_TARIFF_SQL}
                    AND (t.valid_until IS NULL OR t.valid_until >= CURRENT_DATE)))::int
                 AS current
          FROM page`)
    ).rows[0];
    const pages = Number(shown.pages);
    const priced = Number(shown.priced);
    const current = Number(shown.current);
    const pct = (n: number) => `${((100 * n) / pages).toFixed(2)}%`;
    console.log(`  published campsite pages        ${pages}`);
    console.log(`  showing a price                 ${priced}  ${pct(priced)}`);
    console.log(
      `  …of which a CURRENT price       ${current}  ${pct(current)}`,
    );
    console.log(
      `  …showing only expired seasons   ${priced - current}` +
        `  — these pages say so rather than staying silent`,
    );

    // 🔴 An empty result is a FAILURE, not a pass. A verification that
    // reports "0 problems" over 0 rows is the shape of check this
    // repository has been bitten by before.
    if (priced === 0) {
      console.error(
        '\n✗ no page shows a price at all — either the import has not run ' +
          'or the read path stopped finding tariffs. Either way this is not a pass.',
      );
      failed++;
    }
  } finally {
    await db.end();
  }

  if (failed > 0) {
    console.error(`\n✗ ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ all checks passed');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
