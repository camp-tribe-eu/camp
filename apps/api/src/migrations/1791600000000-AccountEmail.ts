import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-228 — what an account needs beyond a password: a confirmed address,
 * a record of the newsletter tick, and the links we email.
 *
 * 🔴 `users_email_normalised` IS A CHECK, NOT A HABIT. Every door that looks
 * an account up by address lower-cases and trims it first (`normalizeEmail`);
 * a row stored any other way is a row none of them can find, so the same
 * person could register twice and the recovery form would answer differently
 * for an address that is, in truth, registered. `users` is empty in
 * production today, so this costs nothing now; on a table that already holds
 * a mixed-case row it FAILS the migration, which is right — the deployment
 * stops rather than shipping an address nobody can sign in with.
 *
 * 🔴 THE TOKEN TABLE KEEPS THE HASH, shaped as a SHA-256 hex digest by a
 * CHECK, exactly like `sessions`. If something ever writes a raw token it
 * fails here instead of quietly storing a working "reset this password" link.
 */
export class AccountEmail1791600000000 implements MigrationInterface {
  name = 'AccountEmail1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
        ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT users_email_normalised
        CHECK (email = lower(btrim(email)))
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind text NOT NULL,
        token_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT auth_tokens_kind CHECK (kind IN ('verify_email', 'reset_password')),
        CONSTRAINT auth_tokens_token_hash_shape CHECK (token_hash ~ '^[0-9a-f]{64}$')
      )
    `);

    // Every click on a link is this lookup.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_token_hash
        ON auth_tokens (token_hash)
    `);

    // "Invalidate this person's other links" reads by user and kind.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_kind
        ON auth_tokens (user_id, kind)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS auth_tokens');
    await queryRunner.query(
      'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_normalised',
    );
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS marketing_consent_at,
        DROP COLUMN IF EXISTS email_verified_at
    `);
  }
}
