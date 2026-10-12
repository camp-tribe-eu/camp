import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-281: a primary may carry more than one secondary.
 *
 * 🔴 THIS REVERSES CAMP-144's CONSTRAINT, SO IT OWES AN ARGUMENT.
 *
 * `SpotLinkOnePerPrimary` made the index unique because two secondaries
 * on one primary made the star rating on a page depend on the query
 * planner: `LIMIT 1` with no total order returned different rows between
 * builds, with no error anywhere. That reasoning was right, and nothing
 * here disputes it.
 *
 * What was wrong was the conclusion. Uniqueness is one way to make the
 * answer deterministic; it is not the only one, and it is the one that
 * also forbids a shape the data genuinely has.
 *
 * A campsite can be THREE rows. OpenStreetMap exports the same site as
 * an area `a…` and as the way `w…` it was built from; a DATAtourisme
 * record describes it a third time. 23 were in that state on
 * 12.10.2026 — 16 with a duplicate page nobody could fold, and 7 whose
 * official star rating, website and prices sat one level below where the
 * merge could reach them, measured and named in CAMP-280.
 *
 * 🔴 The determinism is now made the other way, and it is proven rather
 * than assumed: `linkedSecondariesJoin` returns every live secondary
 * ordered by `(created_at, id)` — a TOTAL order, so a tie between two
 * links made in the same transaction is still decided — and
 * `mergeAllLinked` folds the merge over that order. A rehearsal in
 * `verify-links.ts` plants two secondaries, reads the shipped page
 * query back, and checks that the same rows in the opposite insert
 * order give the same answer. That rehearsal ran BEFORE this migration
 * existed, against a copy of this index dropped inside a rolled-back
 * transaction, because a safeguard should not be removed on a promise.
 *
 * The index itself stays: it is what makes "the secondaries of this
 * primary" an index probe rather than a scan. Only the uniqueness goes.
 */
export class SpotLinkManySecondaries1791200000000 implements MigrationInterface {
  name = 'SpotLinkManySecondaries1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_spot_links_primary_live`);
    await queryRunner.query(`
      CREATE INDEX idx_spot_links_primary_live
        ON spot_links (primary_id) WHERE unlinked_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 🔴 Going back can FAIL, and that is correct. Once a campsite has
    // two secondaries, restoring uniqueness would have to discard one of
    // them — which link, and which source's star rating, is not a
    // decision a rollback may take in silence. The error names the rows.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_spot_links_primary_live`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_spot_links_primary_live
        ON spot_links (primary_id) WHERE unlinked_at IS NULL
    `);
  }
}
