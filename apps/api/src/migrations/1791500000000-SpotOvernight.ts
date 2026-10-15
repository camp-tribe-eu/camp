import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-255: may a motorhome stay the night here — three answers, and a
 * source for every one that is not "we do not know".
 *
 * 🔴 Why columns, and not a key in `amenities`.
 *
 * `amenities` answers "is there a shower", where a wrong `yes` costs a
 * wasted detour. This answers "may I sleep here", where a wrong `yes` is
 * a fine and a wrong `no` is a closed door that was open — and it has to
 * carry a source and a date, which a jsonb of bare yes/no/unknown cannot.
 * The map filter, the region counts and the page all ask this question in
 * SQL, and a column is what a CHECK can be written against.
 *
 * 🔴 The invariant lives in the database, in three named constraints,
 * because "no source, no claim" is the card's own sentence and a rule
 * that only the importer enforces is a rule the next importer forgets:
 *
 *   status_check    exactly three words.
 *   evidence_check  `unknown` ⇔ no source AND no date. An `allowed` with
 *                   nothing behind it cannot be stored, and neither can a
 *                   source dangling from an `unknown`.
 *   source_shape    `<source>:<evidence>`, no spaces, e.g.
 *                   `osm:motorhome=yes`. An empty string would pass a bare
 *                   NOT NULL.
 *
 * 🔴 Existing rows are `unknown` and stay so until the next import reads
 * their tags. That is the truth about them, not a placeholder: the
 * default is the whole point of a three-valued field.
 *
 * 🔴 No index. Every query that asks this is already narrowed by a
 * bounding box, a region or a country first, and the one that is not
 * (region counts) scans the table anyway. An index nothing needs is a
 * cost on every weekly upsert.
 *
 * `up` is idempotent: the columns are IF NOT EXISTS and each constraint
 * is dropped and re-added, so a half-applied run can simply be run again.
 */
export class SpotOvernight1791500000000 implements MigrationInterface {
  name = 'SpotOvernight1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD COLUMN IF NOT EXISTS overnight_status text NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS overnight_source text,
        ADD COLUMN IF NOT EXISTS overnight_checked_at date
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS camping_spots_overnight_status_check,
        DROP CONSTRAINT IF EXISTS camping_spots_overnight_evidence_check,
        DROP CONSTRAINT IF EXISTS camping_spots_overnight_source_shape_check
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD CONSTRAINT camping_spots_overnight_status_check
          CHECK (overnight_status IN ('allowed', 'forbidden', 'unknown')),
        ADD CONSTRAINT camping_spots_overnight_evidence_check
          CHECK (
            ((overnight_status = 'unknown') = (overnight_source IS NULL))
            AND ((overnight_status = 'unknown') = (overnight_checked_at IS NULL))
          ),
        ADD CONSTRAINT camping_spots_overnight_source_shape_check
          CHECK (overnight_source IS NULL
                 OR overnight_source ~ '^[a-z][a-z0-9_]*:[^[:space:]]+$')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS camping_spots_overnight_source_shape_check,
        DROP CONSTRAINT IF EXISTS camping_spots_overnight_evidence_check,
        DROP CONSTRAINT IF EXISTS camping_spots_overnight_status_check
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP COLUMN IF EXISTS overnight_checked_at,
        DROP COLUMN IF EXISTS overnight_source,
        DROP COLUMN IF EXISTS overnight_status
    `);
  }
}
