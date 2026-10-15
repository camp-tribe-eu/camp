import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-258: whether a place sells LPG, and the index for the new kind.
 *
 * 🔴 ONE COLUMN, THREE WORDS, NEVER NULL.
 *
 * `lpg` is `yes`, `no` or `unknown`, the same three words and the same
 * reasoning as the nine columns of 1791400000000-RoutePoiFacilities.ts: a
 * nullable column cannot say "nobody wrote it down" apart from "not
 * extracted" and "the importer crashed", and `WHERE lpg IS NOT TRUE` would
 * sweep all three in with `no`. NOT NULL DEFAULT 'unknown' and a CHECK that
 * refuses everything else — the DEFAULT matters on its own, because the
 * 2.27 million rows already in the table are not re-read until the next
 * import and must say "we do not know" until then, not "we read it and it
 * said no".
 *
 * 🔴 `unknown` IS NOT `no`, AND THE NUMBERS ARE WHY. Measured 15.10.2026 on
 * the 27 raw extracts, over the 118 726 distinct `amenity=fuel` objects:
 * `fuel:lpg=yes` on 18 081, `=no` on 3 010, and no statement at all on
 * 97 621 — 82%. A filter that read the silence as "no LPG" would hide four
 * stations in five.
 *
 * 🔴 ADD COLUMN … NOT NULL DEFAULT <constant> IS NOT A REWRITE on PostgreSQL
 * 11 and later, for the reason the facilities migration measured (heap
 * unchanged). The CHECK is still validated against every existing row, so
 * the column and the index are one `up()` and one table lock each, not
 * more.
 *
 * 🔴 ONE PARTIAL GiST INDEX FOR THE NEW KIND, FOR THE REASON
 * 1790572800000-RoutePoi.ts SPENDS A PAGE ON. Every query this table exists
 * for is "the nearest X to this point" or "every X inside this box", and a
 * kind without its own index is a walk over the 2.27 million rows of every
 * other kind on the way to the answer. `gas_exchange` is about 2 000 rows
 * of them. The owner lost 4 minutes 42 seconds on exactly this query
 * without the index, where with it the same query ran in 547 ms (his
 * measurement of 15.10.2026, quoted from the brief and not re-run here).
 * What a spec can hold is the plan, read from the catalog, in
 * route-services.db.spec.ts.
 *
 * The kinds are a closed list; a spec asserts this list and
 * `STORED_ONLY_KINDS` are the same, and the catalog spec asserts the INDEX
 * exists — a list of kinds is not an index, which is the CAMP-119 review's
 * finding and the reason both exist.
 */
export class RoutePoiLpg1791700000000 implements MigrationInterface {
  name = 'RoutePoiLpg1791700000000';

  /** Kept beside the up() that creates them, so the two cannot drift. */
  static readonly KINDS = ['gas_exchange'] as const;

  static readonly COLUMN = 'lpg' as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE osm_route_poi
         ADD COLUMN IF NOT EXISTS ${RoutePoiLpg1791700000000.COLUMN} text NOT NULL DEFAULT 'unknown'
         CHECK (${RoutePoiLpg1791700000000.COLUMN} IN ('yes', 'no', 'unknown'))`,
    );
    for (const kind of RoutePoiLpg1791700000000.KINDS) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_osm_route_poi_${kind}
          ON osm_route_poi USING GIST (location)
         WHERE kind = '${kind}'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const kind of RoutePoiLpg1791700000000.KINDS) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_osm_route_poi_${kind}`);
    }
    await queryRunner.query(
      `ALTER TABLE osm_route_poi DROP COLUMN IF EXISTS ${RoutePoiLpg1791700000000.COLUMN}`,
    );
  }
}
