import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-256: the day a mapper last edited the OpenStreetMap record, the
 * record's version number, and WHICH OBJECT that date and version belong to.
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
 * 🔴 THESE THREE COLUMNS ARE ONE FACT. They are written together, by the
 * importer, from the same staging rows that supply the rest of the row, and by
 * nothing else:
 *
 *   osm_record_ref        the OpenStreetMap OBJECT the date and version belong to
 *   osm_record_edited_at  when a mapper last edited THAT object
 *   osm_record_version    THAT object's version at that moment
 *
 * 🔴 `osm_record_ref` IS NOT ALWAYS `osm_ref`, and that is why it exists. For
 * a row made from one object — nearly every row — the object is the one the row
 * is keyed on: `osm_record_ref = osm_ref`, and the tags, name and location the
 * row holds are that object's. For a row the importer made from SEVERAL
 * objects (a campsite mapped as a node and as the way around it: it keeps the
 * way's id as `osm_ref`, fills the way's gaps from the node's tags and shows the
 * UNION) it is not so. The date is the newest of the objects the row was made
 * from, because a caption older than a tag it displays is a false statement; so
 * the date and version are the NEWEST object's — which may be the merged-away
 * one, not the one `osm_ref` points at — and `osm_record_ref` names that one.
 * Example, from review: way w2 (2012, version 9) and a node n1 that adds no
 * tag (2026-09-30, version 2) give `osm_ref = w2`, `osm_record_ref = n1`,
 * 2026-09-30, version 2. Version 2 is n1's, not w2's.
 *
 * So to CHECK a date, take the pair (date, version) and look up
 * `osm_record_ref` on openstreetmap.org, never `osm_ref`: that exact version
 * is in that object's history with exactly that date. A fresh date over a
 * version of 1 is what a substituted load date looks like; a merged row can
 * look exactly like that unless the ref says whose pair it is.
 *
 * 🔴 NEVER FILL THESE FROM ANOTHER EXTRACT — a join, a backfill, a copy from a
 * clone: the date, version and ref then describe a different version than the
 * name and tags the page shows. That was done once, on dev, on 15.10.2026, from
 * the 24.09 extracts onto rows imported on 12.10: 931 rows ended up with a new
 * name and an old date, one of them Arlberg (version 2, 2022-09-08, under the
 * name from version 3, 2026-10-08). To remove a date, set it NULL; to get one,
 * run the importer. A backfill of `osm_record_ref` from `osm_ref` would be the
 * same mistake in its quietest form: right for almost every row, wrong for
 * exactly the merged ones.
 *
 * 🔴 IF YOU AUDIT A DATE AGAINST openstreetmap.org, compare the version with the
 * one that was CURRENT WHEN WE IMPORTED (`last_seen_at` is its upper bound),
 * not the one that is current today. Against today, a row is "behind" simply
 * because a mapper edited the object after our import — review (16.10.2026)
 * measured about 0.8% of the rows, some 390, four days after the import, and
 * nulling them would delete dates that were right. The one-off on 15.10.2026 that set 963
 * rows to NULL used the import moment; a second run that used "now" would
 * destroy correct data and look like the same clean-up.
 *
 * 🔴 NULL IS "NOT KNOWN" AND IS NEVER FILLED IN. Existing rows start NULL
 * and stay NULL until an import reads their date out of an extract built
 * with `osmium export -a timestamp,version` (extract-campsites.sh). There
 * is deliberately no backfill from `last_seen_at`, `created_at`, `osm_ref` or
 * now(): every one of those would be a date or a ref that looks right and is
 * not.
 *
 * 🔴 The version is stored because it exposes the one substitution a date
 * cannot expose on its own. A record that claims "edited today" at version
 * 14 was either edited today or has had the load date written over its
 * real one; across a whole country the two are told apart by how many
 * records say it, and the importer refuses a country in which nearly all
 * of them do.
 *
 * Four CHECKs, because the importer is not the only thing that will ever
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
 *   ref_check      a date only WITH the object it belongs to, and an object
 *                  only with a date. A pair nobody can look up is not a
 *                  pair; a ref with no date names an object for nothing.
 *
 * No index. Nothing reads this column in a WHERE yet — sorting and
 * filtering by it is a separate step — and an index nothing uses is a cost
 * on every weekly upsert.
 *
 * `up` is idempotent: the columns are IF NOT EXISTS and each constraint is
 * dropped and re-added, so a half-applied run can simply be run again.
 *
 * 🔴 A re-run on a database that already holds the first shape of this
 * migration (dates and versions, no ref — the dev database did, from 15.10.2026)
 * sets those dates and versions to NULL before it adds `ref_check`. A date
 * whose object nobody recorded cannot be checked, and for a merged row it is
 * the other object's: the same reasoning as the NULLs of the 15.10 clean-up.
 * The next import fills all three again, together. On a database that never
 * had the first shape the statement touches no row.
 */
export class SpotRecordEdited1791800000000 implements MigrationInterface {
  name = 'SpotRecordEdited1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD COLUMN IF NOT EXISTS osm_record_edited_at timestamptz,
        ADD COLUMN IF NOT EXISTS osm_record_version integer,
        ADD COLUMN IF NOT EXISTS osm_record_ref character varying
    `);
    // A pair that was written before the ref existed has no object to be
    // looked up in: it is "not known" now, not a date kept under a ref it
    // never had (see the 🔴 above). No row on a database that never held
    // the first shape; the one `WHERE` is the whole of it.
    await queryRunner.query(`
      UPDATE camping_spots
         SET osm_record_edited_at = NULL, osm_record_version = NULL
       WHERE osm_record_ref IS NULL
         AND (osm_record_edited_at IS NOT NULL OR osm_record_version IS NOT NULL)
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_edited_range_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_version_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_origin_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_ref_check
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
                 OR osm_ref IS NOT NULL),
        ADD CONSTRAINT camping_spots_osm_record_ref_check
          CHECK ((osm_record_edited_at IS NULL) = (osm_record_ref IS NULL))
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN camping_spots.osm_record_edited_at IS
        'When a mapper last edited the OpenStreetMap object named by osm_record_ref (its tags or member list), from the extract''s own timestamp. NULL = not known. NOT last_seen_at: that is the day our importer last found the object, and it moves every week.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN camping_spots.osm_record_version IS
        'The version of the OpenStreetMap object named by osm_record_ref that osm_record_edited_at belongs to. NULL = not known.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN camping_spots.osm_record_ref IS
        'The OpenStreetMap object whose edit date and version osm_record_edited_at and osm_record_version are. Equal to osm_ref, EXCEPT on a row the importer built from several objects: there it is the newest of them, which may be the merged-away one. Look the pair up on this object, not on osm_ref. NULL = not known.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_ref_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_origin_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_version_check,
        DROP CONSTRAINT IF EXISTS camping_spots_osm_record_edited_range_check
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP COLUMN IF EXISTS osm_record_ref,
        DROP COLUMN IF EXISTS osm_record_version,
        DROP COLUMN IF EXISTS osm_record_edited_at
    `);
  }
}
