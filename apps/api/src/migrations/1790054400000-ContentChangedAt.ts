import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-39: when this campsite's page last actually changed.
 *
 * 🔴 Not the same as `last_seen_at`, and the difference is the whole
 * point. `last_seen_at` moves every week, because every week the import
 * confirms OSM still contains the site — nothing about the page changed.
 * Publishing that as `<lastmod>` would stamp today's date on 50,000
 * unchanged pages every Monday, which is precisely how a crawler learns
 * that our lastmod means nothing and starts ignoring it.
 *
 * This column moves only when a field a reader would notice moves.
 * Backfilled from created_at, which is the last honest answer we have
 * for rows imported before the distinction existed.
 */
export class ContentChangedAt1790054400000 implements MigrationInterface {
  name = 'ContentChangedAt1790054400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ADD "content_changed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "camping_spots" SET "content_changed_at" = "created_at"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP COLUMN "content_changed_at"`,
    );
  }
}
