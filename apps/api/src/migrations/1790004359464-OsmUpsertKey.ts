import { MigrationInterface, QueryRunner } from 'typeorm';

export class OsmUpsertKey1790004359464 implements MigrationInterface {
  name = 'OsmUpsertKey1790004359464';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reviews" DROP CONSTRAINT "CHK_reviews_rating_1_5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ADD "osm_ref" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ADD "owner_overrides" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ADD "last_seen_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ADD "missing_since" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ALTER COLUMN "name" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1d1857673412d5b14737e1b618" ON "camping_spots"  ("osm_ref") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d1857673412d5b14737e1b618"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ALTER COLUMN "name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP COLUMN "missing_since"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP COLUMN "last_seen_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP COLUMN "owner_overrides"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP COLUMN "osm_ref"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD CONSTRAINT "CHK_reviews_rating_1_5" CHECK (((rating >= 1) AND (rating <= 5)))`,
    );
  }
}
