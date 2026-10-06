import { MigrationInterface, QueryRunner } from 'typeorm';
import { MAX_MEM, STORED_SHAPE, WORK_CEILING } from '../auth/password';

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
 * refuses the same shapes independently.
 *
 * 🔴 WHAT THE SPEC ACTUALLY CHECKS, stated exactly: it reads this FILE
 * and requires the pattern and the bounds to be interpolated from
 * `../auth/password` rather than copied. It does not query a database —
 * no unit test here has one. So "the constraint Postgres ended up with
 * is character-for-character STORED_SHAPE" is something verified by hand
 * with `pg_get_constraintdef` (99 bytes, identical), not something CI
 * re-verifies. Saying otherwise would be a comment claiming more than
 * the code does, which is the failure this project keeps writing down.
 *
 * 🔴 SHAPE IS NOT ENOUGH, and the first version of this migration said
 * it was. Review measured `scrypt$1$1$1$<16B>$<32B>` being ACCEPTED by
 * this constraint — a perfectly shaped hash whose N is not a power of
 * two, so Node throws before scrypt does any work and the answer comes
 * back in **0.1 ms against an honest 202.7 ms**. The oracle this card
 * exists to close was still open; it had only moved one gate along.
 *
 * So the constraint now asks the same four questions `isWorkable` asks,
 * in SQL: a power of two above 1, below 2^(128·r/8), inside the memory
 * ceiling, and a cost product no larger than `WORK_CEILING`.
 *
 * 🔴 A CEILING, NEVER A FLOOR. `verifyPassword` documents why, and it
 * holds here: a hash stored under weaker parameters has to keep
 * verifying, or raising the work factor signs out exactly the users the
 * design protects. `MIN.saltLen`/`MIN.keyLen` are in the pattern because
 * a one-byte key is not a weak hash, it is not a hash.
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

    // 🔴 The parameters, which the pattern cannot express. Separate from
    // the shape check so a violation says WHICH question failed — "it is
    // not shaped like a hash" and "scrypt cannot evaluate it" are
    // different repairs.
    //
    // `split_part` is safe here only because the shape constraint above
    // has already fixed the field count and made every parameter digits.
    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT users_password_hash_workable
        CHECK (
          -- A power of two above 1: scrypt's own requirement on N.
          (split_part(password_hash, '$', 2))::bigint > 1
          AND ((split_part(password_hash, '$', 2))::bigint
               & ((split_part(password_hash, '$', 2))::bigint - 1)) = 0
          -- N < 2^(128·r/8), Node's rule. Capped at 62 so the shift in
          -- the comparison cannot overflow for a large r.
          AND (split_part(password_hash, '$', 2))::bigint
              < (2::bigint ^ least(16 * (split_part(password_hash, '$', 3))::bigint, 62))
          -- 128 · r · (N + p), the buffer Node sizes, inside maxmem.
          AND 128 * (split_part(password_hash, '$', 3))::bigint
                  * ((split_part(password_hash, '$', 2))::bigint
                     + (split_part(password_hash, '$', 4))::bigint) <= ${MAX_MEM}
          -- And the cost itself, which is a product, not a sum.
          AND (split_part(password_hash, '$', 2))::bigint
              * (split_part(password_hash, '$', 3))::bigint
              * (split_part(password_hash, '$', 4))::bigint <= ${WORK_CEILING}
        )
    `);
  }

  // 🔴 ON A TABLE THAT ALREADY HOLDS A BAD ROW this migration FAILS and
  // the deployment stops — `check constraint … is violated by some row`.
  // That is right, and it is written here rather than discovered: a row
  // that cannot satisfy these constraints is a row the timing guarantees
  // are false for, and shipping past it quietly would leave the oracle
  // open while the migration log said success.
  //
  // Toothless today, and said so plainly: `users` is empty and no
  // production path writes it — `hashPassword` has exactly one caller
  // (the decoy) and `needsRehash` has none. The first thing that writes
  // a user will be the first thing to test this.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_password_hash_workable
    `);
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_password_hash_shape
    `);
  }
}
