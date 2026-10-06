import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotFoundHits1791000000000 implements MigrationInterface {
  name = 'NotFoundHits1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS not_found_hits (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        path varchar(512) NOT NULL,
        referrer varchar(512),
        created_at timestamptz NOT NULL DEFAULT now(),
        -- 🔴 Enforced by the database, not only by the code that writes.
        -- A query string in either column would be personal data we never
        -- asked for; these make such a row impossible to insert rather
        -- than merely unlikely, the same way sessions.token_hash does.
        CONSTRAINT not_found_hits_path_shape
          CHECK (path LIKE '/%' AND path NOT LIKE '%?%' AND path NOT LIKE '%#%'),
        CONSTRAINT not_found_hits_referrer_shape
          CHECK (referrer IS NULL
                 OR (referrer ~ '^https?://' AND referrer NOT LIKE '%?%'
                     AND referrer NOT LIKE '%#%'))
      )
    `);

    // The report: group by path over a window.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_not_found_hits_path
        ON not_found_hits (path)
    `);

    // 🔴 Every read of this table is "the last N days", and every sweep
    // of it is "older than N days" — the rows are only useful while the
    // link is still being followed.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_not_found_hits_created_at
        ON not_found_hits (created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS not_found_hits');
  }
}
