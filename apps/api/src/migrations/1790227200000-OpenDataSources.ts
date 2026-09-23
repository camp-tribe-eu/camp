import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-101: room for data that does not come from OpenStreetMap.
 *
 * 🔴 `sources` records WHICH FIELDS came from where, and that is the
 * point of this migration rather than a nicety.
 *
 * We are about to hold one campsite built from two databases under two
 * different licences: OpenStreetMap under ODbL, which is share-alike,
 * and DATAtourisme under Licence Ouverte 2.0, which asks only for
 * attribution — but attribution that names the source AND the date the
 * information was last updated:
 *
 *   "La « Réutilisation » ne doit pas induire en erreur des tiers quant
 *    au contenu… sa source et sa date de mise à jour."
 *
 * A single "sources: OSM, DATAtourisme" line at the bottom of a page
 * cannot satisfy that, because the two licences do not ask the same
 * thing of the same fields. Recording the provenance per field is the
 * only way to attribute each one correctly — and it is also what CAMP-87
 * will need when it finally decides where the ODbL Derivative Database
 * boundary runs for us.
 *
 * Shape:
 *   [{ "id": "datatourisme",
 *      "ref": "https://data.datatourisme.fr/13/eb3a…",
 *      "updatedAt": "2026-08-28",
 *      "fields": ["name", "description", "stars", "website"] }]
 *
 * `description_lang` exists because the descriptions are French and the
 * site is English. We do not translate them — a machine translation of
 * an operator's own words, published as if it were theirs, is exactly
 * the kind of invention this project is built not to do. So the text is
 * carried verbatim and tagged, and the page renders it with `lang`.
 */
export class OpenDataSources1790227200000 implements MigrationInterface {
  name = 'OpenDataSources1790227200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "camping_spots"
        ADD COLUMN "description" text,
        ADD COLUMN "description_lang" character varying(8),
        ADD COLUMN "stars" smallint,
        ADD COLUMN "sources" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    // 🔴 A star rating outside 1–5 is not a rating, it is a parse error
    // that reached the database. The official French classification has
    // exactly five levels; anything else means the scheme check upstream
    // failed and we would be publishing a number we invented.
    await queryRunner.query(`
      ALTER TABLE "camping_spots"
        ADD CONSTRAINT "CHK_camping_spots_stars"
        CHECK ("stars" IS NULL OR ("stars" BETWEEN 1 AND 5))
    `);

    // 🔴 A description with no language is unpublishable: we would not
    // know what to put in `lang`, and an English page that silently
    // serves French text is wrong for a screen reader and for a
    // translating crawler alike.
    await queryRunner.query(`
      ALTER TABLE "camping_spots"
        ADD CONSTRAINT "CHK_camping_spots_description_lang"
        CHECK ("description" IS NULL OR "description_lang" IS NOT NULL)
    `);

    // The question asked of this column is always "which campsites came
    // from source X", never "show me the whole array".
    await queryRunner.query(
      `CREATE INDEX "IDX_camping_spots_sources" ON "camping_spots" USING GIN ("sources" jsonb_path_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_camping_spots_sources"`);
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP CONSTRAINT "CHK_camping_spots_description_lang"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP CONSTRAINT "CHK_camping_spots_stars"`,
    );
    await queryRunner.query(`
      ALTER TABLE "camping_spots"
        DROP COLUMN "sources",
        DROP COLUMN "stars",
        DROP COLUMN "description_lang",
        DROP COLUMN "description"
    `);
  }
}
