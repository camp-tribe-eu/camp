import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-144: make `idx_spot_links_primary_live` actually unique.
 *
 * 🔴 WHY THIS IS A SECOND MIGRATION AND NOT AN EDIT TO THE FIRST.
 *
 * It was an edit to the first, and review caught that the edit could
 * never reach the database that matters. TypeORM records a migration by
 * NAME in the `migrations` table and never runs it twice, so a database
 * that had already applied `SpotLinks1790486400000` would skip the
 * corrected version entirely. And even on a re-run the statement was
 * `CREATE UNIQUE INDEX IF NOT EXISTS idx_spot_links_primary_live`, which
 * finds the existing non-unique index OF THAT NAME and does nothing at
 * all — no error, no index, no uniqueness.
 *
 * So the constraint would have existed on a freshly built CI database
 * and been absent everywhere the 2 986 links actually live, while the
 * migration's comment claimed "the second link is refused". The one
 * database where it mattered was the one where it was not true.
 *
 * 🔴 It is also invisible to the checks. `verify-links.ts` asserts that
 * no primary carries two live secondaries — a statement about ROWS. With
 * no duplicates yet it passes on a database with no constraint at all,
 * and would keep passing until the day two records collide and one of
 * them silently wins the star rating.
 *
 * DROP then CREATE, not `IF NOT EXISTS`. If duplicate live links already
 * exist this fails loudly here, at the moment somebody is deploying and
 * watching, rather than at 3 a.m. inside an import.
 */
export class SpotLinkOnePerPrimary1790490000000 implements MigrationInterface {
  name = 'SpotLinkOnePerPrimary1790490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_spot_links_primary_live`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_spot_links_primary_live
        ON spot_links (primary_id) WHERE unlinked_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Back to the non-unique index the first migration described, so a
    // rollback leaves the shape that migration documents rather than no
    // index at all.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_spot_links_primary_live`);
    await queryRunner.query(`
      CREATE INDEX idx_spot_links_primary_live
        ON spot_links (primary_id) WHERE unlinked_at IS NULL
    `);
  }
}
