import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-258: bottled gas and LPG — two columns, and the index for the new kind.
 *
 *   lpg            does this place sell LPG (autogas)?   `fuel:lpg=yes|no`
 *   cylinder_swap  can you swap a gas cylinder here?     `shop=gas`
 *
 * 🔴 BOTH ARE yes / no / unknown, NEVER NULL.
 *
 * The same three words and the same reasoning as the nine columns of
 * 1791400000000-RoutePoiFacilities.ts: a nullable column cannot say "nobody
 * wrote it down" apart from "not extracted" and "the importer crashed", and
 * `WHERE lpg IS NOT TRUE` would sweep all three in with `no`. NOT NULL
 * DEFAULT 'unknown' and a CHECK that refuses everything else — the DEFAULT
 * matters on its own, because the 2.27 million rows already in the table are
 * not re-read until the next import and must say "we do not know" until then,
 * not "we read it and it said no".
 *
 * 🔴 `unknown` IS NOT `no`, AND THE NUMBERS ARE WHY. Measured 15.10.2026 on
 * the 27 raw extracts, over the 118 726 distinct `amenity=fuel` objects:
 * `fuel:lpg=yes` on 18 081, `=no` on 3 010, and no statement at all on
 * 97 621 — 82%. A filter that read the silence as "no LPG" would hide four
 * stations in five.
 *
 * 🔴 `cylinder_swap` IS WRITTEN `yes` OR `unknown`, AND THE LOADER NEVER
 * WRITES `no`. No tag says "you cannot swap a cylinder here"; a place that is
 * not tagged `shop=gas` is a place nobody described that way, which is
 * exactly what `unknown` means. The CHECK allows `no` so that the day a tag
 * that says it exists nothing needs to change — and a spec asserts the
 * loader does not write it before then.
 *
 * 🔴 WHY THERE IS A COLUMN AND ALSO A KIND, `gas_exchange`.
 * `kind` says what the point IS; an object has one kind. `cylinder_swap`
 * says what can be DONE there, and an object can say that whatever kind it
 * ended up with. 4 014 of the 6 109 distinct `shop=gas` objects are also
 * `amenity=fuel` (hypermarket forecourts, 3 800 in France) and stay `fuel`,
 * because their rows are the ones prices are keyed on. Without this column
 * the fact that they swap cylinders is stored nowhere and a map layer could
 * show 2 088 points where the data holds about 6 100. Without the kind, a
 * lone gas shop would be a row of some other kind carrying a flag. Both stay;
 * the layer is `kind = 'gas_exchange' OR cylinder_swap = 'yes'`. The long
 * form of this note is at STORED_ONLY_KINDS in osm/route-poi.ts.
 *
 * 🔴 ADD COLUMN … NOT NULL DEFAULT <constant> IS NOT A REWRITE on PostgreSQL
 * 11 and later, for the reason the facilities migration measured (heap
 * unchanged). Each CHECK is still validated against every existing row, so
 * both columns are ONE `ALTER` — one ACCESS EXCLUSIVE lock and one scan, not
 * two. Measured 15.10.2026 on a fresh copy of the table in its pre-migration
 * shape (2 271 596 rows, 18 columns, 10 indexes): the whole `up()` — both
 * columns, both new indexes — took 904 ms; a second `up()` over the result
 * took 4 ms and changed nothing (columns, indexes and CHECKs counted before
 * and after).
 *
 * 🔴 TWO PARTIAL GiST INDEXES, FOR THE REASON 1790572800000-RoutePoi.ts
 * SPENDS A PAGE ON. Every query this table exists for is "the nearest X to
 * this point" or "every X inside this box", and a query without an index of
 * its own is a walk over the 2.27 million rows of every other kind on the way
 * to the answer. The owner lost 4 minutes 42 seconds on exactly this query
 * for `gas_exchange` without one, where with it the same query ran in 547 ms
 * (his measurement of 15.10.2026, quoted from the brief and not re-run here).
 *   · `idx_osm_route_poi_gas_exchange`  WHERE kind = 'gas_exchange'
 *   · `idx_osm_route_poi_cylinder_swap` WHERE cylinder_swap = 'yes'
 * The second is what makes the OTHER half of the layer an index scan: about
 * 4 000 forecourts out of 2.27 million rows. The planner serves
 * `kind = 'gas_exchange' OR cylinder_swap = 'yes'` as a BitmapOr of the two.
 *
 * The kinds are a closed list; a spec asserts this list and
 * `STORED_ONLY_KINDS` are the same, and the catalog spec asserts the INDEXES
 * exist — a list of kinds is not an index, which is the CAMP-119 review's
 * finding and the reason both exist.
 */
export class RoutePoiGas1791700000000 implements MigrationInterface {
  name = 'RoutePoiGas1791700000000';

  /** Kept beside the up() that creates them, so the two cannot drift. */
  static readonly KINDS = ['gas_exchange'] as const;

  /** The columns this adds, in the order the loader's INSERT writes them. */
  static readonly COLUMNS = ['lpg', 'cylinder_swap'] as const;

  /** The partial index on the flag, named after its column. */
  static readonly FLAG_INDEX = 'idx_osm_route_poi_cylinder_swap';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns = RoutePoiGas1791700000000.COLUMNS.map(
      (c) =>
        `ADD COLUMN IF NOT EXISTS ${c} text NOT NULL DEFAULT 'unknown' ` +
        `CHECK (${c} IN ('yes', 'no', 'unknown'))`,
    );
    await queryRunner.query(
      `ALTER TABLE osm_route_poi\n        ${columns.join(',\n        ')}`,
    );
    for (const kind of RoutePoiGas1791700000000.KINDS) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_osm_route_poi_${kind}
          ON osm_route_poi USING GIST (location)
         WHERE kind = '${kind}'
      `);
    }
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ${RoutePoiGas1791700000000.FLAG_INDEX}
        ON osm_route_poi USING GIST (location)
       WHERE cylinder_swap = 'yes'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS ${RoutePoiGas1791700000000.FLAG_INDEX}`,
    );
    for (const kind of RoutePoiGas1791700000000.KINDS) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_osm_route_poi_${kind}`);
    }
    for (const column of [...RoutePoiGas1791700000000.COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE osm_route_poi DROP COLUMN IF EXISTS ${column}`,
      );
    }
  }
}
