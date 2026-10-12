// CAMP-281: prove the fold script, on rows this script makes itself.
//
//   npx ts-node src/spots/verify-folds.ts
//
// 🔴 WHY THIS IS NOT IN verify-links.ts.
//
// That file asks whether the link TABLE is in a sane state. This one
// asks whether the program that changes it behaves — and the two
// questions want opposite fixtures. The invariants want the real
// database; these want shapes that do not exist in it, built on
// purpose, so they run the same anywhere, including the CI fixture
// where `spot_links` is empty.
//
// Three properties, each the scar of a review:
//
//   1. one dry run describes the whole change. Twice the plan was not a
//      fixed point — the stamps could only be seen after the links were
//      written, and when that was fixed the chains still could. Both
//      times the dry run under-reported and the second apply printed
//      "still outstanding".
//   2. a link a person took apart is never proposed again. The unique
//      index on the pair is not partial, so re-proposing one does not
//      merely re-link it: the insert throws and takes the run with it.
//   3. an OSM area carrying nothing but its own twin is not "already
//      linked to another record". That reading sent 821 areas to review
//      and made the shape the invariants call legal unreachable.
//
// Exits non-zero on any failure, so CI can run it.

import 'dotenv/config';
import { Client } from 'pg';
import { applyFolds, plan, skipped } from './fold-three-row-campsites';
import { CLAIMED_BY_OUTSIDE_RECORD_SQL } from './reconcile-sources';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * A campsite row made from an existing one, inside the caller's
 * transaction. Cloning rather than inserting keeps this working when a
 * column is added, and makes the rehearsal independent of whatever the
 * database happens to hold.
 */
async function clone(
  db: Client,
  seed: string,
  slug: string,
  osmRef: string | null,
  missing: boolean,
): Promise<string> {
  await db.query(`DROP TABLE IF EXISTS fold_src`);
  await db.query(
    `CREATE TEMP TABLE fold_src AS SELECT * FROM camping_spots WHERE id = $1`,
    [seed],
  );
  await db.query(
    `UPDATE fold_src
        SET id = uuid_generate_v4(), slug = $1, osm_ref = $2,
            region = coalesce(region, 'Fold'),
            missing_since = CASE WHEN $3 THEN now() - interval '2 hours'
                                 ELSE NULL END`,
    [slug, osmRef, missing],
  );
  const r = await db.query<{ id: string }>(
    `INSERT INTO camping_spots SELECT * FROM fold_src RETURNING id`,
  );
  return r.rows[0].id;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  let failed = 0;
  try {
    const seedRow = await db.query<{ id: string }>(
      `SELECT id FROM camping_spots ORDER BY id LIMIT 1`,
    );
    const seed = seedRow.rows[0]?.id;
    if (!seed) {
      console.error('✗ no campsite to clone from');
      process.exit(1);
    }

    // ------------------------------------------------------------------
    console.log('--- one dry run describes the whole change ---');
    await db.query('BEGIN');
    try {
      // Shape one: an area and its twin, unlinked, the twin stamped.
      const areaA = await clone(db, seed, 'fold-a-1', 'a200000002', false);
      const twinA = await clone(db, seed, 'fold-w-1', 'w100000001', true);
      // Shape two: an area whose twin carries an outside record, so the
      // chain exists only once the twin is folded — which is what made
      // the plan move under its own feet.
      const areaB = await clone(db, seed, 'fold-a-2', 'a200000004', false);
      const twinB = await clone(db, seed, 'fold-w-2', 'w100000002', false);
      const outside = await clone(db, seed, 'fold-dt-1', null, false);
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal')`,
        [twinB, outside],
      );

      const first = await plan(db);
      const kinds: Record<string, number> = {};
      for (const f of first) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
      const sawAll =
        (kinds.link ?? 0) >= 2 &&
        (kinds.repoint ?? 0) >= 1 &&
        (kinds.unmark ?? 0) >= 1;
      console.log(
        `  ${sawAll ? '✓' : '✗'} the first plan names all three kinds of work ` +
          `(${JSON.stringify(kinds)})`,
      );
      if (!sawAll) failed++;

      await applyFolds(db, first);
      const second = await plan(db);
      console.log(
        `  ${second.length === 0 ? '✓' : '✗'} and after applying it, nothing is left`,
      );
      if (second.length !== 0) {
        failed++;
        for (const f of second.slice(0, 5)) {
          console.error(`      ${JSON.stringify(f).slice(0, 120)}`);
        }
      }
      void areaA;
      void twinA;
      void areaB;
    } finally {
      await db.query('ROLLBACK');
    }

    // ------------------------------------------------------------------
    console.log('\n--- a link a person took apart stays apart ---');
    await db.query('BEGIN');
    try {
      const area = await clone(db, seed, 'fold-a-3', 'a200000006', false);
      const twin = await clone(db, seed, 'fold-w-3', 'w100000003', true);
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule, unlinked_at,
                                 unlinked_reason)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal', now(), 'not the same site')`,
        [area, twin],
      );
      const p = await plan(db);
      const proposed = p.some(
        (f) =>
          (f.kind === 'link' && f.secondary === twin) ||
          (f.kind === 'unmark' && f.row === twin),
      );
      console.log(
        `  ${!proposed ? '✓' : '✗'} neither re-linked nor un-stamped`,
      );
      if (proposed) failed++;
      // 🔴 And prove the check can fail: with the judgement removed, the
      // same rows ARE proposed. Otherwise this passes on a plan that
      // proposes nothing for any reason at all.
      await db.query(`DELETE FROM spot_links WHERE rule = 'fold-rehearsal'`);
      const q = await plan(db);
      const nowProposed = q.some(
        (f) => f.kind === 'link' && f.secondary === twin,
      );
      console.log(
        `  ${nowProposed ? '✓' : '✗'} and without that judgement it IS proposed`,
      );
      if (!nowProposed) failed++;
    } finally {
      await db.query('ROLLBACK');
    }

    // ------------------------------------------------------------------
    console.log('\n--- an area carrying only its twin is not spoken for ---');
    await db.query('BEGIN');
    try {
      const area = await clone(db, seed, 'fold-a-4', 'a200000008', false);
      const twin = await clone(db, seed, 'fold-w-4', 'w100000004', false);
      const outside = await clone(db, seed, 'fold-dt-2', null, false);
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal')`,
        [area, twin],
      );
      const claimedOnTwin = await db.query<{ id: string }>(
        CLAIMED_BY_OUTSIDE_RECORD_SQL,
      );
      const freeWithTwin = !claimedOnTwin.rows.some((r) => r.id === area);
      console.log(
        `  ${freeWithTwin ? '✓' : '✗'} its own twin does not make it claimed`,
      );
      if (!freeWithTwin) failed++;

      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal')`,
        [area, outside],
      );
      const claimedOnOutside = await db.query<{ id: string }>(
        CLAIMED_BY_OUTSIDE_RECORD_SQL,
      );
      const takenNow = claimedOnOutside.rows.some((r) => r.id === area);
      console.log(`  ${takenNow ? '✓' : '✗'} but an outside record does`);
      if (!takenNow) failed++;
    } finally {
      await db.query('ROLLBACK');
    }

    // ------------------------------------------------------------------
    console.log('\n--- applyFolds refuses to write outside a transaction ---');
    // 🔴 THE SHAPE NO REHEARSAL BUILT.
    //
    // The first guard asked for a transaction id, which Postgres assigns
    // only once something has been WRITTEN. The real path is plan() —
    // all reads — then BEGIN, then applyFolds: no writes yet, no id, so
    // every --apply threw. Every rehearsal passed, because each of them
    // clones rows first. So the empty transaction is now built on
    // purpose, and so is the no-transaction case.
    {
      let threwOutside = false;
      try {
        await applyFolds(db, []);
      } catch {
        threwOutside = true;
      }
      console.log(
        `  ${threwOutside ? '✓' : '✗'} outside a transaction it throws`,
      );
      if (!threwOutside) failed++;

      await db.query('BEGIN');
      let threwInside = false;
      try {
        await applyFolds(db, []);
      } catch (err) {
        threwInside = true;
        console.error(`      ${String(err)}`);
      } finally {
        await db.query('ROLLBACK');
      }
      console.log(
        `  ${!threwInside ? '✓' : '✗'} inside one that has written nothing yet, it does not`,
      );
      if (threwInside) failed++;
    }

    // ------------------------------------------------------------------
    console.log(
      '\n--- a fold that would strand a chain is refused, out loud ---',
    );
    await db.query('BEGIN');
    try {
      const area = await clone(db, seed, 'fold-a-5', 'a300000010', false);
      const twin = await clone(db, seed, 'fold-w-5', 'w150000005', false);
      const outside = await clone(db, seed, 'fold-dt-3', null, false);
      // The twin already carries the outside record...
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal')`,
        [twin, outside],
      );
      // ...and somebody has already decided the area and that record are
      // NOT the same campsite. Folding the twin would make a chain the
      // flattening step may not undo.
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule, unlinked_at,
                                 unlinked_reason)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal', now(), 'different sites')`,
        [area, outside],
      );
      const p = await plan(db);
      const wouldLink = p.some(
        (f) => f.kind === 'link' && f.secondary === twin,
      );
      console.log(`  ${!wouldLink ? '✓' : '✗'} the fold is not proposed`);
      if (wouldLink) failed++;
      const skips = await skipped(db);
      const named = skips.some((sk) => sk.why.includes('may not undo'));
      console.log(
        `  ${named ? '✓' : '✗'} and the run says so instead of staying silent`,
      );
      if (!named) failed++;
    } finally {
      await db.query('ROLLBACK');
    }

    // ------------------------------------------------------------------
    console.log('\n--- a chain under a hand-separated pair is left alone ---');
    await db.query('BEGIN');
    try {
      const area = await clone(db, seed, 'fold-a-6', 'a300000012', false);
      const twin = await clone(db, seed, 'fold-w-6', 'w150000006', false);
      const outside = await clone(db, seed, 'fold-dt-4', null, false);
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal')`,
        [twin, outside],
      );
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule, unlinked_at,
                                 unlinked_reason)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal', now(), 'different sites')`,
        [area, twin],
      );
      const p = await plan(db);
      const wouldMove = p.some((f) => f.kind === 'repoint' && f.to === area);
      console.log(
        `  ${!wouldMove ? '✓' : '✗'} the outside record is not moved onto the area`,
      );
      if (wouldMove) failed++;
      const skips = await skipped(db);
      const named = skips.some((sk) => sk.why.includes('apart by hand'));
      console.log(`  ${named ? '✓' : '✗'} and that is reported too`);
      if (!named) failed++;
    } finally {
      await db.query('ROLLBACK');
    }

    // ------------------------------------------------------------------
    console.log(
      '\n--- an already-folded chain that cannot be flattened says so ---',
    );
    // 🔴 The shape all seven real chains have: area and twin ALREADY
    // linked. A review built it with a human judgement underneath and
    // found the run silent — plan empty, nothing skipped, and the
    // invariant red for good. Neither earlier branch described it: one
    // wants no link between area and twin, the other wants that link
    // undone, and here it is present and live.
    await db.query('BEGIN');
    try {
      const area = await clone(db, seed, 'fold-a-7', 'a300000020', false);
      const twin = await clone(db, seed, 'fold-w-7', 'w150000010', false);
      const outside = await clone(db, seed, 'fold-dt-5', null, false);
      for (const [pri, sec] of [
        [area, twin],
        [twin, outside],
      ]) {
        await db.query(
          `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                   name_similarity, rule)
           VALUES ($1, $2, 0, 1, 'fold-rehearsal')`,
          [pri, sec],
        );
      }
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule, unlinked_at,
                                 unlinked_reason)
         VALUES ($1, $2, 0, 1, 'fold-rehearsal', now(), 'different sites')`,
        [area, outside],
      );
      const p = await plan(db);
      const quiet = p.length === 0;
      const skips = await skipped(db);
      const named = skips.some((sk) =>
        sk.why.includes('already carries a decision'),
      );
      console.log(
        `  ${quiet ? '✓' : '✗'} the chain is not flattened (the pair was judged)`,
      );
      console.log(
        `  ${named ? '✓' : '✗'} and the run names it instead of printing nothing`,
      );
      if (!quiet) failed++;
      if (!named) failed++;

      // 🔴 One campsite, one line. The second branch joined through the
      // links below the twin, so a twin carrying two records named its
      // area twice and the count lied.
      const once =
        skips.filter((sk) => sk.name === skips[0]?.name).length === 1;
      console.log(
        `  ${once ? '✓' : '✗'} and names it once, not once per record below it`,
      );
      if (!once) failed++;
    } finally {
      await db.query('ROLLBACK');
    }

    // ------------------------------------------------------------------
    console.log('\n--- a second outside record is refused, not stacked ---');
    // 🔴 The last form a review found silent, and it turned a GREEN
    // database red in one run: the area legitimately carries its own
    // outside record, the twin carries another one level down, and the
    // flattening step moved the second one up. Two records on one
    // campsite is either a duplicate in their data or two different
    // businesses, and this script may not decide which — that is what
    // the invariant says, and the script was breaking it while printing
    // "0 outstanding".
    await db.query('BEGIN');
    try {
      const area = await clone(db, seed, 'fold-a-8', 'a300000060', false);
      const twin = await clone(db, seed, 'fold-w-8', 'w150000030', false);
      const mine = await clone(db, seed, 'fold-dt-6', null, false);
      const theirs = await clone(db, seed, 'fold-dt-7', null, false);
      for (const [pri, sec] of [
        [area, mine],
        [twin, theirs],
      ]) {
        await db.query(
          `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                   name_similarity, rule)
           VALUES ($1, $2, 0, 1, 'fold-rehearsal')`,
          [pri, sec],
        );
      }
      const p = await plan(db);
      await applyFolds(db, p);
      const ceiling = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM (
           SELECT l.primary_id
             FROM spot_links l
             JOIN camping_spots s ON s.id = l.secondary_id
            WHERE l.unlinked_at IS NULL
            GROUP BY l.primary_id
           HAVING count(*) FILTER (WHERE s.osm_ref IS NULL) > 1) x`,
      );
      const kept = (ceiling.rows[0]?.n ?? 0) === 0;
      const skips = await skipped(db);
      const named = skips.some((sk) =>
        sk.why.includes('an outside record of its own'),
      );
      console.log(
        `  ${kept ? '✓' : '✗'} applying the plan leaves the one-record ceiling intact`,
      );
      console.log(`  ${named ? '✓' : '✗'} and the refusal is named`);
      if (!kept) failed++;
      if (!named) failed++;
    } finally {
      await db.query('ROLLBACK');
    }

    // ------------------------------------------------------------------
    console.log('\n--- an unfolded twin whose record has nowhere to go ---');
    // 🔴 The gap the fourth condition itself opened, and the reason the
    // reasons now live in one fragment.
    //
    // The area carries its own outside record; its twin carries another
    // one; they are not linked yet. Folding the twin would make the
    // chain, and the flattening step would then refuse to undo it — so
    // the fold must not happen at all. The fourth refusal was added to
    // the flattening query only, and the folding query went on building
    // exactly the chain it could no longer undo, reporting success.
    await db.query('BEGIN');
    try {
      const area = await clone(db, seed, 'fold-a-9', 'a300000080', false);
      const twin = await clone(db, seed, 'fold-w-9', 'w150000040', false);
      const mine = await clone(db, seed, 'fold-dt-8', null, false);
      const theirs = await clone(db, seed, 'fold-dt-9', null, false);
      for (const [pri, sec] of [
        [area, mine],
        [twin, theirs],
      ]) {
        await db.query(
          `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                   name_similarity, rule)
           VALUES ($1, $2, 0, 1, 'fold-rehearsal')`,
          [pri, sec],
        );
      }
      const p = await plan(db);
      await applyFolds(db, p);
      const chains = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM spot_links l
           JOIN spot_links o ON o.secondary_id = l.primary_id
                            AND o.unlinked_at IS NULL
          WHERE l.unlinked_at IS NULL`,
      );
      const noChain = (chains.rows[0]?.n ?? 0) === 0;
      const skips = await skipped(db);
      const named = skips.some((sk) => sk.why.includes('left unfolded'));
      console.log(
        `  ${noChain ? '✓' : '✗'} the run does not build the chain it could not undo`,
      );
      console.log(
        `  ${named ? '✓' : '✗'} and says the twin is left unfolded, not that a chain stays`,
      );
      if (!noChain) failed++;
      if (!named) failed++;
    } finally {
      await db.query('ROLLBACK');
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
