import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-256: the day a mapper last edited the OpenStreetMap record, and
 * the record's version number.
 *
 * 🔴 TWO DATES, TWO NAMES, AND THE NAMES ARE THE POINT.
 *
 *   last_seen_at          the day OUR importer last found this object in an
 *                         extract. It ticks every week for every campsite
 *                         whether or not anybody touched it.
 *   osm_record_edited_at  the day a MAPPER last changed this object in
 *                         OpenStreetMap. It moves only when somebody edits.
 *
 * They are different facts, and the first is always the more recent: it
 * is stamped on every row of every import, so it says "this month" about a
 * campsite nobody has touched in years. Reading one as the other is the
 * failure this card is most likely to ship, and it looks like success —
 * every campsite "updated this month". Hence a name that cannot be mistaken for the other, a COMMENT on the
 * column that says so where a person running `\d camping_spots` will see
 * it, and a CHECK that refuses a date that cannot be an OSM edit.
 *
 * 🔴 It is the date of THE OBJECT'S OWN RECORD: its tags and its member
 * list. A way keeps its timestamp when somebody drags one of its nodes, so
 * this is not "the outline was last redrawn on".
 *
 * 🔴 NULL IS "NOT KNOWN" AND IS NEVER FILLED IN. Existing rows start NULL
 * and stay NULL until an import reads their date out of an extract built
 * with `osmium export -a timestamp,version` (extract-campsites.sh). There
 * is deliberately no backfill from `last_seen_at`, `created_at` or now():
 * every one of those would be a date that looks right and is not.
 *
 * 🔴 The version is stored because it exposes the one substitution a date
 * cannot expose on its own. A record that claims "edited today" at version
 * 14 was either edited today or has had the load date written over its
 * real one; across a whole country the two are told apart by how many
 * records say it, and the importer refuses a country in which nearly all
 * of them do.
 *
 * Three CHECKs, because the importer is not the only thing that will ever
 * write here:
 *
 *   edited_range   between 2004-08-01 (OpenStreetMap began that month) and
 *                  2100. Catches 0 (1970) and milliseconds read as seconds
 *                  (a year in the tens of thousands), the two unit mistakes
 *                  a Unix timestamp invites. No `now()` in it: a CHECK that changes its mind
 *                  with the clock makes a dump unrestorable. "In the future"
 *                  is the importer's test, against its own start time.
 *   version_check  a version is 1 or more.
 *   origin_check   a date or version only on a row that HAS an OSM object.
 *                  The DATAtourisme rows have none, and an OSM edit date on
 *                  one would be a claim with nothing behind it.
 *
 * No index. Nothing reads this column in a WHERE yet — sorting and
 * filtering by it is a separate step — and an index nothing uses is a cost
 * on every weekly upsert.
 *
 * `up` is idempotent: the columns are IF NOT EXISTS and each constraint is
 * dropped and re-added, so a half-applied run can simply be run again.
 */
export class SpotRecordEdited1791800000000 implements MigrationInterface {
  name = 'SpotRecordEdited1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD COLUMN IF NOT EXISTS osm_record_edited_at timestamptz,
        ADD COLUMN IF NOT EXISTS osm_record_version integer
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_edited_range_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_version_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_origin_check
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD CONSTRAINT camping_spots_osm_record_edited_range_check
          CHECK (osm_record_edited_at IS NULL
                 OR (osm_record_edited_at >= '2004-08-01 00:00:00+00'
                     AND osm_record_edited_at < '2100-01-01 00:00:00+00')),
        ADD CONSTRAINT camping_spots_osm_record_version_check
          CHECK (osm_record_version IS NULL OR osm_record_version >= 1),
        ADD CONSTRAINT camping_spots_osm_record_origin_check
          CHECK ((osm_record_edited_at IS NULL AND osm_record_version IS NULL)
                 OR osm_ref IS NOT NULL)
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN camping_spots.osm_record_edited_at IS
        'When a mapper last edited this OpenStreetMap object (its tags or member list), from the extract''s own timestamp. NULL = not known. NOT last_seen_at: that is the day our importer last found the object, and it moves every week.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN camping_spots.osm_record_version IS
        'The OpenStreetMap object version that osm_record_edited_at belongs to. NULL = not known.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_origin_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_version_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_edited_range_check
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP COLUMN IF EXISTS osm_record_version,
        DROP COLUMN IF EXISTS osm_record_edited_at
    `);
  }
}
