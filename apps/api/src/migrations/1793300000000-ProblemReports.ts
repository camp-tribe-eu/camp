import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Report a problem» on a campsite page — the table the reports land in.
 *
 * The first step of the arbitration the owner asked for: a reader or a
 * campsite owner says the data is wrong, we look. This migration creates the
 * inbox and nothing else — no automatic edits, no publishing of what arrives,
 * no notion of who is allowed to report (anyone may).
 *
 * 🔴 `up()` ONLY ADDS. One `CREATE TABLE` and three indexes; no existing row,
 * column or constraint is touched.
 *
 * 🔴 WHAT THE TABLE CANNOT HOLD, by construction and not by convention:
 *   · a `kind` outside the seven the API offers — `CHECK`, the same list as
 *     `PROBLEM_KINDS` in `reports/problem-reports.rules.ts` (the spec there
 *     reads this file and compares);
 *   · a description longer than 2 000 characters or empty, a contact longer
 *     than 200 — the same limits the API applies, so a code path that forgot
 *     to validate still cannot store more;
 *   · a status outside `new`, `resolved`, `dismissed`.
 *   There is no column for an IP address, a browser string or a user: the
 *   contact the reader chose to type is the only thing here that can name a
 *   person, and `problem-reports.db.spec.ts` reads this column list back.
 *
 * 🔴 `kind` AND `status` ARE `text` WITH A `CHECK`, NOT `enum` — the same
 * choice as `consent_record`: a new value is a visible migration, not an
 * `ALTER TYPE` that some Postgres versions refuse inside a transaction.
 *
 * `created_at` is indexed because it is the purge key: how long a report is
 * kept is not decided (no lawyer — GDPR-REGISTER.md §10), and when it is, the
 * delete is by this column. `ON DELETE CASCADE` from `camping_spots`: a report
 * about a row that left the table has nothing left to arbitrate.
 *
 * `down()` removes only what `up()` made.
 */
export class ProblemReports1793300000000 implements MigrationInterface {
  name = 'ProblemReports1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS problem_reports (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        camping_spot_id uuid NOT NULL REFERENCES camping_spots (id) ON DELETE CASCADE,
        spot_path text NOT NULL,
        kind text NOT NULL,
        description text NOT NULL,
        contact text,
        status text NOT NULL DEFAULT 'new',
        resolution_note text,
        reviewed_at timestamptz,
        reviewed_by_directus_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT problem_reports_kind CHECK (kind IN (
          'closed', 'wrong_location', 'wrong_facilities', 'wrong_price',
          'wrong_name_or_contact', 'not_a_campsite', 'other'
        )),
        CONSTRAINT problem_reports_status CHECK (status IN (
          'new', 'resolved', 'dismissed'
        )),
        CONSTRAINT problem_reports_description_length
          CHECK (char_length(description) BETWEEN 1 AND 2000),
        CONSTRAINT problem_reports_contact_length
          CHECK (contact IS NULL OR char_length(contact) <= 200)
      )
    `);
    // The moderator's view: newest first, and open ones first.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_problem_reports_spot
        ON problem_reports (camping_spot_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_problem_reports_status
        ON problem_reports (status)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_problem_reports_created
        ON problem_reports (created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS problem_reports`);
  }
}
