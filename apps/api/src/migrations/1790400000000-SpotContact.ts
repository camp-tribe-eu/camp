import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-141: how to reach the campsite, which we were throwing away.
 *
 * 🔴 Measured 27.09.2026 through Overpass before this was written. Of
 * the campsites OpenStreetMap holds, some contact exists for 75.4% in
 * Slovenia and 79.6% in Austria — website 61-72%, phone 40-49%, email
 * 27-36%, addr:city 50-52%. We imported none of it. The 10.7% of
 * websites in the table came from DATAtourisme, which covers France.
 *
 * 🔴 One jsonb column, not seven scalar ones.
 *
 * The same shape as `amenities` and `context`, and for the same reason:
 * the set of things OSM records about reaching a place is open-ended
 * (fax, mobile, a second website, a Facebook page), and each new one
 * should cost a mapping rule rather than a migration. It also keeps the
 * upsert's DO UPDATE list short, which is the list this repository has
 * already been bitten by twice for containing one column too many.
 *
 * 🔴 The existing `website` column is NOT touched.
 *
 * It holds DATAtourisme's value, which is an official tourism register
 * rather than a crowd-sourced tag, and CAMP-101 kept per-source
 * attribution deliberately. OSM's website lands in `contact.website`
 * and the reader-facing code decides which to show — a decision that
 * belongs in one place and not in an UPDATE that silently prefers
 * whichever import ran last.
 */
export class SpotContact1790400000000 implements MigrationInterface {
  name = 'SpotContact1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD COLUMN IF NOT EXISTS contact jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    // 🔴 Partial, on "has anything at all". The page and the sitemap ask
    // "which campsites can a reader actually contact"; nothing asks for
    // campsites with an empty object, and at 61 557 rows most of them
    // will be empty until the next full import.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_camping_spots_has_contact
        ON camping_spots ((contact <> '{}'::jsonb))
        WHERE contact <> '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_camping_spots_has_contact`);
    await queryRunner.query(`ALTER TABLE camping_spots DROP COLUMN IF EXISTS contact`);
  }
}
