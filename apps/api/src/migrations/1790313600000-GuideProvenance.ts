import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-66: how each guide was made, as a column nobody can forget.
 *
 * 🔴 Article 50(2) of the EU AI Act is IN FORCE. It applies from
 * 02.08.2026, and the Digital Omnibus (Regulation (EU) 2026/1744, in
 * force 27.07.2026) deferred the high-risk obligations to December 2027
 * and August 2028 — it did not defer Article 50. Synthetic text must be
 * marked as machine-generated, from the first publication, not later.
 *
 * So this is not metadata. A guide with no provenance is a guide we are
 * not allowed to publish, and the way to make that true is to make the
 * column NOT NULL rather than to remember it.
 *
 * The values are deliberately about WHO WROTE THE SENTENCES, because
 * that is what Article 50 asks about:
 *
 *   human          a person wrote it. No label needed, but we say who.
 *   ai-assisted    a person wrote and edited it with machine help.
 *                  Labelled, because the reader cannot tell which.
 *   ai-generated   a machine wrote it; a person checked it. Labelled.
 *   data-generated assembled from our own database by a program, where
 *                  every sentence is a value we hold. Labelled too —
 *                  the honest label for it is not "AI" but "generated",
 *                  and it is the one kind we can produce at volume
 *                  without inventing anything.
 *
 * 🔴 `data-generated` is NOT a way around the AI Act. It is narrower
 * than what the Act covers, not wider: a template filled from measured
 * rows is not a generative model's output at all. The label exists
 * because a reader deserves to know a program wrote the sentence,
 * whichever law happens to require it.
 */
export class GuideProvenance1790313600000 implements MigrationInterface {
  name = 'GuideProvenance1790313600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "guides_provenance_enum" AS ENUM
        ('human', 'ai-assisted', 'ai-generated', 'data-generated')
    `);

    // No default. A default would let a guide be written with nobody
    // having decided how it was made, which is the exact failure this
    // column exists to prevent.
    await queryRunner.query(`
      ALTER TABLE "guides"
        ADD COLUMN "provenance" "guides_provenance_enum" NOT NULL
    `);

    // 🔴 A human-written guide needs a named author, and a generated one
    // needs the recipe. Both are enforced here rather than in a form,
    // because a form can be bypassed by anything that writes SQL — the
    // importer, a fixture, a future admin tool.
    await queryRunner.query(`
      ALTER TABLE "guides"
        ADD COLUMN "generator" character varying(64),
        ADD CONSTRAINT "CHK_guides_provenance_is_accountable" CHECK (
          ("provenance" = 'human' AND "author_name" IS NOT NULL)
          OR ("provenance" <> 'human' AND "generator" IS NOT NULL)
        )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_guides_status_category" ON "guides" ("status", "category")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_guides_status_category"`);
    await queryRunner.query(
      `ALTER TABLE "guides" DROP CONSTRAINT "CHK_guides_provenance_is_accountable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "guides" DROP COLUMN "generator", DROP COLUMN "provenance"`,
    );
    await queryRunner.query(`DROP TYPE "guides_provenance_enum"`);
  }
}
