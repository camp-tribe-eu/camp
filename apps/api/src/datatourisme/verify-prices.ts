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
import { DISPLAYABLE_TARIFF_SQL, tariffsSql } from '../spots/tariffs';

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
/**
 * 🔴 `src` IS THE PRIMARY WHENEVER THE PRIMARY HAS ANY TARIFF OF ITS OWN.
 *
 * This said `COALESCE(l.secondary_id, p.id)` — which is the secondary
 * whenever a link exists, whatever the primary holds. `mergeLinked` does
 * the opposite: it is gap-filling, so the primary's own price list wins
 * and the secondary's is used only when the primary has none.
 *
 * The two agree today only because 0 linked primaries carry a tariff, so
 * the verifier would have confirmed that disagreement rather than caught
 * it — a check that reads a different row from the page it is checking
 * is worth less than no check.
 *
 * The rule, stated once: THE PRIMARY'S OWN LIST WINS; the secondary's is
 * read only when the primary has none. `mergeLinked` in spots/links.ts is
 * the implementation, this is the mirror, and the `src` column below is
 * how they are kept the same sentence.
 */
const PAGE_SQL = `
  SELECT p.id,
         CASE WHEN EXISTS (SELECT 1 FROM spot_tariffs t WHERE t.spot_id = p.id)
              THEN p.id
              ELSE COALESCE(l.secondary_id, p.id)
         END AS src
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
    name: '🔴 the read path serves no tariff without a validity period',
    // 🔴 This asks the SHIPPED QUERY, not the table.
    //
    // It used to be `WHERE <displayable> AND valid_from IS NULL AND
    // valid_until IS NULL` — which is `(A OR B) AND NOT A AND NOT B`, a
    // tautology returning 0 rows against any database whatsoever,
    // including one where `DISPLAYABLE_TARIFF_SQL` had been deleted. The
    // single check the card's central prohibition rests on could not
    // fail, which is worse than not having it.
    //
    // `tariffsSql` is what `spots.service.ts` builds the page payload
    // with. Running it and inspecting what comes out is the only version
    // of this question that can answer it.
    sql: `SELECT count(*)::int AS n
            FROM camping_spots s,
                 LATERAL json_array_elements(${tariffsSql('s.id')}) AS e
           WHERE e->>'validFrom' IS NULL AND e->>'validUntil' IS NULL`,
  },
  {
    name: 'the read path is not simply returning nothing',
    // 🔴 The companion the check above needs. "No undated tariff was
    // served" is also true of a query that serves none at all, and an
    // empty result passing for a clean one is the failure this
    // repository has already paid for.
    sql: `SELECT CASE WHEN count(*) > 0 THEN 0 ELSE 1 END::int AS n
            FROM camping_spots s,
                 LATERAL json_array_elements(${tariffsSql('s.id')}) AS e`,
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

/**
 * 🔴 Prove the check can fail, before believing the run that says it
 * passed.
 *
 * Every invariant above is "this count is zero", and on a database where
 * the import never ran every one of them is zero — a row of ticks nobody
 * earned. `verify-filters.ts` twenty lines away carries the same flag for
 * the same reason.
 *
 * What is planted is the one thing the schema does NOT refuse and the
 * card forbids outright: a tariff with no validity period. The CHECK
 * constraints stop a backwards range, a missing amount and an unlabelled
 * language; nothing in the table stops an undated price reaching a page
 * except `DISPLAYABLE_TARIFF_SQL`, which is exactly what this has to
 * prove still works.
 *
 * Everything happens inside a transaction that is rolled back.
 */
async function selfTest(db: Client): Promise<boolean> {
  const spot = (await db.query(`SELECT id FROM camping_spots LIMIT 1`)).rows[0];
  if (!spot) {
    console.error('  ✗ self-test: no campsites at all, so nothing to plant on');
    return false;
  }

  /** What the SHIPPED read query returns for this spot, right now. */
  const served = async (): Promise<{ total: number; undated: number }> => {
    const r = (
      await db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE e->>'validFrom' IS NULL
                                   AND e->>'validUntil' IS NULL)::int AS undated
           FROM camping_spots s,
                LATERAL json_array_elements(${tariffsSql('s.id')}) AS e
          WHERE s.id = $1`,
        [spot.id],
      )
    ).rows[0];
    return { total: Number(r.total), undated: Number(r.undated) };
  };

  await db.query('BEGIN');
  try {
    const before = await served();

    // 1. A DATED tariff must come back. A predicate that filtered
    //    everything would satisfy "no undated tariff was served" too.
    await db.query(
      `INSERT INTO spot_tariffs
         (spot_id, source_id, source_ref, min_price, currency,
          valid_from, valid_until, source_updated_at)
       VALUES ($1, 'self-test', 'urn:self-test-dated', 1.00, 'EUR',
               CURRENT_DATE - 1, CURRENT_DATE + 1, CURRENT_DATE)`,
      [spot.id],
    );
    const withDated = await served();
    if (withDated.total !== before.total + 1) {
      console.error(
        '  ✗ self-test: a dated tariff was planted and the read query did\n' +
          '      not return it — so "no undated tariff was served" is a\n' +
          '      statement about a query that serves nothing.',
      );
      return false;
    }
    console.log('  ✓ self-test: a dated tariff is served');

    // 2. An UNDATED tariff must NOT come back. This is the card's
    //    central prohibition, and the only thing enforcing it is the
    //    predicate under test.
    await db.query(
      `INSERT INTO spot_tariffs
         (spot_id, source_id, source_ref, min_price, currency,
          source_updated_at)
       VALUES ($1, 'self-test', 'urn:self-test-undated', 2.00, 'EUR',
               CURRENT_DATE)`,
      [spot.id],
    );
    const withUndated = await served();
    if (withUndated.undated > 0 || withUndated.total !== withDated.total) {
      console.error(
        `  ✗ self-test: an undated tariff reached the read path ` +
          `(${withUndated.undated} undated of ${withUndated.total}). ` +
          `DISPLAYABLE_TARIFF_SQL is not filtering.`,
      );
      return false;
    }
    console.log('  ✓ self-test: an undated tariff is refused by the read path');
    return true;
  } finally {
    await db.query('ROLLBACK');
  }
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  let failed = 0;

  try {
    // 🔴 `--self-test` runs the self-test AND NOTHING ELSE, and that is
    // what makes it runnable in CI.
    //
    // The checks below measure a populated database: they require
    // tariffs to exist and fail loudly when none do, because "0 problems
    // over 0 rows" is the failure this repository has already paid for.
    // CI's fixture has 72 campsites and no tariffs at all, so the full
    // run there would be a guaranteed red that says nothing. The
    // self-test plants its own rows and rolls them back, so it is
    // meaningful on any database — including an empty one — and it is
    // the half that proves `DISPLAYABLE_TARIFF_SQL` still filters.
    if (process.argv.includes('--self-test')) {
      console.log('── self-test ───────────────────────────────────────────');
      const ok = await selfTest(db);
      console.log('  (rolled back — the database is exactly as it was)');
      if (!ok) {
        console.error('\n✗ self-test failed');
        process.exit(1);
      }
      console.log('\n✓ self-test passed');
      return;
    }

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
    //
    // 🔴 "Current" means IN SEASON TODAY — both ends checked. It used to
    // check only `valid_until >= CURRENT_DATE`, which counts a season
    // starting next April as current; that is the same defect the web
    // layer had, and a verifier carrying it would have confirmed the bug
    // instead of catching it. The three states here are exactly the
    // three `tariffStatus` returns.
    const shown = (
      await db.query(`
        WITH page AS (${PAGE_SQL}),
        state AS (
          SELECT page.id,
                 EXISTS (SELECT 1 FROM spot_tariffs t
                          WHERE t.spot_id = page.src
                            AND ${DISPLAYABLE_TARIFF_SQL}) AS any_shown,
                 EXISTS (SELECT 1 FROM spot_tariffs t
                          WHERE t.spot_id = page.src
                            AND ${DISPLAYABLE_TARIFF_SQL}
                            AND (t.valid_until IS NULL
                                 OR t.valid_until >= CURRENT_DATE)
                            AND (t.valid_from IS NULL
                                 OR t.valid_from <= CURRENT_DATE)) AS in_season,
                 EXISTS (SELECT 1 FROM spot_tariffs t
                          WHERE t.spot_id = page.src
                            AND ${DISPLAYABLE_TARIFF_SQL}
                            AND t.valid_from > CURRENT_DATE) AS upcoming
            FROM page
        )
        SELECT count(*)::int AS pages,
               count(*) FILTER (WHERE any_shown)::int AS priced,
               count(*) FILTER (WHERE in_season)::int AS current,
               count(*) FILTER (WHERE any_shown AND NOT in_season
                                  AND upcoming)::int AS upcoming_only,
               count(*) FILTER (WHERE any_shown AND NOT in_season
                                  AND NOT upcoming)::int AS expired_only
          FROM state`)
    ).rows[0];
    const pages = Number(shown.pages);
    const priced = Number(shown.priced);
    const current = Number(shown.current);
    const upcomingOnly = Number(shown.upcoming_only);
    const expiredOnly = Number(shown.expired_only);
    const pct = (n: number) => `${((100 * n) / pages).toFixed(2)}%`;
    console.log(`  published campsite pages        ${pages}`);
    console.log(`  showing a price                 ${priced}  ${pct(priced)}`);
    console.log(
      `  …in season today                ${current}  ${pct(current)}`,
    );
    console.log(`  …only a season not yet started  ${upcomingOnly}`);
    console.log(`  …only seasons already ended     ${expiredOnly}`);
    // 🔴 This block counts ROWS and says so. It used to end with "these
    // pages say so rather than staying silent", which is a statement
    // about the RENDERING — and it went on printing that sentence while
    // review had the expiry heading, the row marker and the "ask the
    // operator" line deleted from tariff-table.tsx and the whole web
    // suite still green. A check that reads the database cannot see the
    // page; claiming otherwise is how 435 pages came to rest on nothing.
    //
    // The rendering half is asserted where it can be seen, by rendering
    // the component: apps/web/tests/unit/tariff-table.spec.tsx. Each of
    // those three deletions now fails it.
    console.log(
      '  (whether those pages SAY so is a fact about the rendering and is\n' +
        '   proven in apps/web/tests/unit/tariff-table.spec.tsx, not here)',
    );
    if (priced !== current + upcomingOnly + expiredOnly) {
      console.error(
        `  ✗ the three states do not add up to ${priced} — the buckets overlap`,
      );
      failed++;
    }

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
