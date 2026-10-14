import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-119: what a stopping place says about itself, and two new kinds.
 *
 * 🔴 NINE COLUMNS, AND NONE OF THEM IS NULLABLE.
 *
 * The owner's rule for this card (14.10.2026) is "show what is in the
 * data and say 'unknown' where it is not" — the same three words
 * `camping_spots.amenities` already uses (yes / no / unknown), with the
 * third as a stored value rather than the absence of one. A nullable
 * column cannot carry that: NULL means "not extracted", "tag absent" and
 * "importer crashed" at once, and a filter `WHERE toilets IS NOT TRUE`
 * would sweep all three in with `no`.
 *
 * So every column is NOT NULL DEFAULT 'unknown', and a CHECK refuses
 * anything but the words. The DEFAULT matters on its own: the 2.2 million
 * rows already in the table are not re-read until the next import, and
 * until then they must say "we do not know" and not "we read it and it
 * said no".
 *
 *   yes / no / unknown   toilets, shower, drinking_water,
 *                        sanitary_dump_station, fee
 *   verbatim, or unknown access, hgv, maxheight, maxlength
 *
 * The second group is a value, not a yes/no — `access=customers`,
 * `maxheight=3.5` — and is stored as OSM wrote it (lower-cased), the same
 * stance the opening_hours column takes. The CHECK there forbids the
 * empty string, which is the other way a gap can pose as an answer.
 *
 * 🔴 NO `fee` FILTER IS BUILT ON THIS, AND NONE SHOULD BE. Measured on
 * the 27 raw extracts, 25.09.2026: `fee=*` is set on 5.1% of rest areas
 * and `fee=yes` on TEN of 16 817. A control labelled "free" over that
 * column would say 16 807 rest areas are free when what OSM holds is
 * that nobody wrote anything down. The column is here so a page can say
 * "fee: yes / no / unknown" per place, which is a statement about the
 * data and not about the road.
 *
 * 🔴 ADD COLUMN … NOT NULL DEFAULT <constant> IS NOT A REWRITE on
 * PostgreSQL 11 and later: measured on a copy of the live table
 * (2 248 280 rows, 14.10.2026) the heap stayed at 287 MB. It still scans —
 * each CHECK in an ADD COLUMN is validated against the rows — and the
 * first version of this file did it nine times: nine ACCESS EXCLUSIVE
 * locks on a table the API reads, 17.8 s in all. One ALTER with nine
 * ADD COLUMNs plus the two index builds is 2.7 s, which is what up()
 * does.
 *
 * 🔴 WHAT IT COSTS ONCE THE IMPORT HAS WRITTEN THEM. Nine short strings on
 * every one of 2.27 million rows: the table went from 445 MB to 609 MB
 * (+37%, heap 287 → 450 MB, indexes unchanged at 158 MB), measured after
 * a full import into the copy and a VACUUM FULL. That is the price of
 * storing the three states on EVERY row, so a later card can ask about a
 * fuel station's toilets as well as a rest area's. If 164 MB matters
 * more than that, the alternative is a side table keyed on osm_ref for
 * the 30 843 stopping places and dump points — 4.6 MB measured, at the price
 * of a join and of NULL meaning "not extracted" for every other kind.
 *
 * 🔴 TWO PARTIAL GiST INDEXES FOR THE TWO NEW KINDS, for the reason
 * 1790572800000-RoutePoi.ts spends a page on: every query this table
 * exists for is "the nearest X to this point", and a kind without its
 * own index is a walk over every other kind on the way to the answer.
 * The kinds are a closed list; a spec asserts this list and
 * REST_STOP_KINDS are the same.
 */
export class RoutePoiFacilities1791400000000 implements MigrationInterface {
  name = 'RoutePoiFacilities1791400000000';

  /** Kept beside the up() that creates them, so the two cannot drift. */
  static readonly KINDS = ['rest_area', 'service_area'] as const;

  static readonly TRISTATE = [
    'toilets',
    'shower',
    'drinking_water',
    'sanitary_dump_station',
    'fee',
  ] as const;

  static readonly VERBATIM = [
    'access',
    'hgv',
    'maxheight',
    'maxlength',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 🔴 ONE ALTER, NOT NINE. Each ALTER takes ACCESS EXCLUSIVE on a table
    // the API reads, and each CHECK in an ADD COLUMN is validated by a
    // scan, so nine statements are nine locks and nine scans of 2.2
    // million rows. One statement is one of each.
    const columns = [
      ...RoutePoiFacilities1791400000000.TRISTATE.map(
        (c) =>
          `ADD COLUMN IF NOT EXISTS ${c} text NOT NULL DEFAULT 'unknown' ` +
          `CHECK (${c} IN ('yes', 'no', 'unknown'))`,
      ),
      ...RoutePoiFacilities1791400000000.VERBATIM.map(
        (c) =>
          `ADD COLUMN IF NOT EXISTS ${c} text NOT NULL DEFAULT 'unknown' ` +
          `CHECK (btrim(${c}) <> '')`,
      ),
    ];
    await queryRunner.query(
      `ALTER TABLE osm_route_poi\n        ${columns.join(',\n        ')}`,
    );
    for (const kind of RoutePoiFacilities1791400000000.KINDS) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_osm_route_poi_${kind}
          ON osm_route_poi USING GIST (location)
         WHERE kind = '${kind}'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const kind of RoutePoiFacilities1791400000000.KINDS) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_osm_route_poi_${kind}`);
    }
    for (const column of [
      ...RoutePoiFacilities1791400000000.VERBATIM,
      ...RoutePoiFacilities1791400000000.TRISTATE,
    ]) {
      await queryRunner.query(
        `ALTER TABLE osm_route_poi DROP COLUMN IF EXISTS ${column}`,
      );
    }
  }
}
