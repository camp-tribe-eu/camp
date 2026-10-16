import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-229 (3/3) — the two rights an account owes its owner: to receive what
 * we hold (GDPR 15) and to have it erased (GDPR 17).
 *
 * 🔴 THREE THINGS, AND EACH IS A DECISION THE SCREEN SAYS ALOUD.
 *
 *   users.deleted_at       The moment the person asked. NULL for everyone alive.
 *                          Access ends in the same request (sessions are
 *                          deleted with it); the ROW stays for 30 days so that
 *                          a mistaken click can be undone by signing in, and
 *                          is deleted after that — see `purgeDeleted`.
 *
 *   data_exports           One archive per person, built after the request has
 *                          been answered. ONE ROW PER USER (the primary key IS
 *                          `user_id`): asking again replaces the old archive,
 *                          so a person's data is never held in more than one
 *                          copy. Cascades with the account.
 *
 *   moderation_log         What stays when everything else goes: that a
 *                          submission was REJECTED, why, and when. 🔴 THERE IS
 *                          NO COLUMN IN THIS TABLE THAT COULD NAME A PERSON — no
 *                          user, no address, no author. That is what makes the
 *                          record "anonymised" rather than "pseudonymised", and
 *                          `account-rights.db.spec.ts` searches every column of
 *                          every row for the deleted person's id and address.
 *
 * 🔴 `outcome` IS CONSTRAINED TO 'rejected'. The only reason to remember
 * anything is the one the screen gives (somebody blocked for fake photos must
 * not come back the next day with a new account), and an approved photo says
 * nothing about that. Keeping less is the point; widening this is a migration,
 * and so a conscious decision, not a quiet one.
 */
export class AccountRights1791900000000 implements MigrationInterface {
  name = 'AccountRights1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS deleted_at timestamptz
    `);
    // The sweep reads only the few rows that have been deleted; every other
    // row is NULL and stays out of the index.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_users_deleted_at
        ON users (deleted_at) WHERE deleted_at IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_exports (
        user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        status text NOT NULL,
        requested_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        expires_at timestamptz,
        file text,
        CONSTRAINT data_exports_status
          CHECK (status IN ('preparing', 'ready', 'failed')),
        -- A "ready" archive has a file, a finish and an expiry; nothing else
        -- does. The page reads the status and trusts that a ready one can be
        -- downloaded, so the database refuses the other combinations.
        CONSTRAINT data_exports_ready_means_file CHECK (
          (status = 'ready') =
          (file IS NOT NULL AND finished_at IS NOT NULL AND expires_at IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_data_exports_expires_at
        ON data_exports (expires_at)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS moderation_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind text NOT NULL,
        camping_spot_id uuid REFERENCES camping_spots (id) ON DELETE SET NULL,
        outcome text NOT NULL,
        reason text,
        submitted_at timestamptz,
        decided_at timestamptz,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT moderation_log_kind CHECK (kind IN ('photo', 'review')),
        CONSTRAINT moderation_log_outcome CHECK (outcome = 'rejected')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS moderation_log');
    await queryRunner.query('DROP TABLE IF EXISTS data_exports');
    await queryRunner.query('DROP INDEX IF EXISTS idx_users_deleted_at');
    await queryRunner.query(
      'ALTER TABLE users DROP COLUMN IF EXISTS deleted_at',
    );
  }
}
