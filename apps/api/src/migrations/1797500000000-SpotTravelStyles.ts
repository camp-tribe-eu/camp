import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-520: travel styles on a campsite — and a source for every one.
 *
 * `travel_styles` is a jsonb object, style key → `{ value, source }`:
 *
 *   {"winter": {"value": "yes", "source": "osm:seasonal=no"}}
 *
 * 🔴 UNKNOWN IS THE KEY BEING ABSENT. There is no third value, so "a
 * label nobody vouched for" has no spelling the table accepts.
 *
 * 🔴 THE CARD'S CHECK LIVES IN THE DATABASE. «Проставити мітку без
 * джерела, сторож червоніє» — the sentry is this constraint: every entry
 * must be an object whose `value` is yes or no AND whose `source` is a
 * string shaped `<source>:<evidence>`. A rule only the importer keeps is a
 * rule the owner's cabinet (CAMP-500) forgets the day it starts writing
 * here.
 *
 * 🔴 WRITTEN AS "EVERY ENTRY IS GOOD", NOT "NO ENTRY IS BAD". The first
 * draft was `NOT jsonb_path_exists(… ? (!(@.source like_regex …)))`, and
 * `{"source": null}` walked through it: `like_regex` on a null is UNKNOWN,
 * `!UNKNOWN` is UNKNOWN, and a filter keeps only TRUE. Counting the good
 * entries against all of them has no such hole — measured on PostgreSQL
 * 17 against null, a number, an empty string, a missing key and a bare
 * string in place of the object.
 *
 * 🔴 Existing rows are `{}` and stay so until the next import reads their
 * tags. That is the truth about them.
 *
 * 🔴 No index: every reader is narrowed to a region first.
 *
 * `up` is idempotent, like SpotOvernight.
 */
export const TRAVEL_STYLES_CHECK = 'camping_spots_travel_styles_sourced_check';

export class SpotTravelStyles1797500000000 implements MigrationInterface {
  name = 'SpotTravelStyles1797500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD COLUMN IF NOT EXISTS travel_styles jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS ${TRAVEL_STYLES_CHECK}
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD CONSTRAINT ${TRAVEL_STYLES_CHECK}
          CHECK (
            jsonb_typeof(travel_styles) = 'object'
            AND jsonb_array_length(jsonb_path_query_array(travel_styles, '$.*'))
              = jsonb_array_length(jsonb_path_query_array(
                  travel_styles,
                  '$.* ? ((@.value == "yes" || @.value == "no") && @.source like_regex "^[a-z_]+:[^ ]")'
                ))
          )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS ${TRAVEL_STYLES_CHECK}
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots DROP COLUMN IF EXISTS travel_styles
    `);
  }
}
