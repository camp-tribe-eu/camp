import { MigrationInterface, QueryRunner } from 'typeorm';
import { STORED_SHAPE } from '../auth/password';

/**
 * CAMP-223 — an empty `password_hash` would be a 1 700× existence oracle.
 *
 * 🔴 WHAT THIS CLOSES. `AuthService.signIn` substitutes a decoy hash with
 * `??`, which catches `null` and `undefined` and not `''`. A row with an
 * empty `password_hash` skipped the decoy and reached
 * `verifyPassword('')`, which refuses while parsing the format. Measured
 * by adversarial review on PR #128: **0.1 ms against 173 ms**.
 *
 * Every claim this module makes about timing — the decoy, its warm-up,
 * the comment that says an unknown address costs the same — rests on
 * "the stored hash is always a real hash". One row makes that false, and
 * no test would see it, because no test writes an empty hash.
 *
 * 🔴 A CHECK RATHER THAN A RULE WE AGREE TO FOLLOW. The same reasoning as
 * `sessions_token_hash_shape`, which exists so a RAW session token
 * cannot physically be stored: the value of a database constraint is
 * exactly that it holds when the application was bypassed — a direct
 * `psql`, an import script, a future code path that forgets. `signIn`
 * refuses the same shape independently, and `password.spec.ts` asserts
 * the two use one pattern so they cannot drift apart.
 *
 * 🔴 STRUCTURE, NOT COST. No floor on N, r or p, and that is deliberate:
 * `verifyPassword` documents that a hash stored under weaker parameters
 * must keep verifying, or raising the work factor signs out exactly the
 * users the design protects. Only the shape is fixed here, plus salt and
 * key lengths at `MIN.saltLen`/`MIN.keyLen`, so a hash of a believable
 * shape but no strength cannot be written either.
 */
export class PasswordHashShape1791100000000 implements MigrationInterface {
  name = 'PasswordHashShape1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 🔴 Read from the module rather than written out again. Two copies of
    // a regex drift the first time either is touched, and the direction
    // this one drifts in is "the database stops refusing what the code
    // still thinks it refuses".
    //
    // Interpolated, not parameterised: a CHECK expression is DDL, and
    // `STORED_SHAPE` is a frozen constant in our own source, never user
    // input. The spec asserts the constraint the database ended up with
    // is character-for-character this string.
    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT users_password_hash_shape
        CHECK (password_hash ~ '${STORED_SHAPE}')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_password_hash_shape
    `);
  }
}
