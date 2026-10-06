import { MigrationInterface, QueryRunner } from 'typeorm';

export class Sessions1790922000000 implements MigrationInterface {
  name = 'Sessions1790922000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        -- 🔴 The shape of a SHA-256 hex digest, enforced by the database.
        -- If anything ever writes a RAW token into this column it will
        -- fail here rather than quietly storing a working credential.
        CONSTRAINT sessions_token_hash_shape CHECK (token_hash ~ '^[0-9a-f]{64}$')
      )
    `);

    // Every authenticated request is this lookup.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
        ON sessions (token_hash)
    `);

    // Signing out everywhere, and the sweep of dead rows, both read by user.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)
    `);

    // 🔴 Expired rows are not deleted on read — a read path that writes
    // turns every GET into a transaction. They are swept by expiry, so
    // the sweep needs its own index.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
        ON sessions (expires_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS sessions');
  }
}
