import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-33: the computed surroundings of a campsite.
 *
 * One jsonb column rather than eight scalars. The set of facts we compute
 * will grow — the card already lists six and CAMP-49 will add weather —
 * and every addition would otherwise be a migration plus an entity change
 * plus a backfill. The shape lives in `spot-context.ts`, which is where a
 * reader should look; the database only has to store and return it.
 *
 * `context_computed_at` is separate and indexed because the recompute job
 * needs "everything older than X", which is a query on the column, not a
 * scan of the json.
 */
export class SpotContext1790018291000 implements MigrationInterface {
  name = 'SpotContext1790018291000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ADD "context" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ADD "context_computed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_camping_spots_context_computed_at" ON "camping_spots" ("context_computed_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_camping_spots_context_computed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP COLUMN "context_computed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP COLUMN "context"`,
    );
  }
}
