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
 * ended up with. 6 816 of the 8 938 distinct objects that say `gas` in `shop`
 * (as the whole tag or as an element of a `;` list) are also `amenity=fuel`
 * (hypermarket forecourts, mostly French) and stay `fuel`, because their
 * rows are the ones prices are keyed on. Without this column the fact that
 * they swap cylinders is stored nowhere and a map layer could show 2 114
 * points where the data holds 8 925. Without the kind, a
 * lone gas shop would be a row of some other kind carrying a flag. Both stay;
 * the layer is `kind = 'gas_exchange' OR cylinder_swap = 'yes'`. The long
 * form of this note is at STORED_ONLY_KINDS in osm/route-poi.ts.
 *
 * 🔴 ADD COLUMN … NOT NULL DEFAULT <constant> IS NOT A REWRITE on PostgreSQL
 * 11 and later, for the reason the facilities migration measured (heap
 * unchanged), and the two CHECKs are one `ALTER` — one lock and one scan for
 * both, not two. `up()` is written to bring the columns, CHECKs and indexes
 * to their shape WHATEVER STATE THEY ARE IN (see the comments in it): the
 * first version used `ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT … CHECK`,
 * which PostgreSQL skips as a whole when the column exists. Measured
 * 15.10.2026 on a fresh copy of the table in its pre-migration shape (2 271
 * 596 rows, 18 columns, 10 indexes), load average about 13: the whole `up()`
 * took 938 ms; run again over the result (the repair path) it took 1 121 and
 * 1 247 ms and changed nothing (20 columns, 12 indexes, 11 CHECKs, no NULL —
 * counted before and after). A busy machine multiplies these: at a load average above 200 the
 * same statements took 26 and 46 seconds, so time it on a quiet one.
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

  /**
   * `DROP INDEX`, aimed at THIS TABLE'S index of that name and at nothing
   * else.
   *
   * 🔴 TWO WAYS A PLAIN `DROP INDEX IF EXISTS name` DROPS WHAT IS NOT OURS,
   * AND BOTH ARE CLOSED HERE.
   *   · It walks the whole search_path and drops the first index of that name
   *     it meets — in ANOTHER schema if this one has none yet. That is what
   *     happened while the CAMP-258 specs were being run: they build the table
   *     in a schema of their own, `up()` found no such index there, and the
   *     two REAL indexes in `public` on camptribe_dev went.
   *   · Qualifying it by schema is not enough: an index of that name on
   *     ANOTHER TABLE of the same schema is dropped just the same. Production
   *     has one schema, so this is the one form of the incident that could
   *     still happen there.
   * So the index is looked up through `pg_index`, as an index OF
   * `osm_route_poi` — whose schema is resolved the way `ALTER TABLE
   * osm_route_poi` resolves it, by the search_path — and only that one is
   * dropped. A same-named index on another table is left alone, and the
   * `CREATE INDEX` that follows then fails loudly on the taken name.
   */
  private static dropIndex(name: string): string {
    if (!/^[a-z_]+$/.test(name)) throw new Error(`unsafe index name ${name}`);
    return `DO $$
        DECLARE r record;
        BEGIN
          FOR r IN
            SELECT n.nspname AS s, c.relname AS i
              FROM pg_index x
              JOIN pg_class c ON c.oid = x.indexrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE x.indrelid = 'osm_route_poi'::regclass
               AND c.relname = '${name}'
          LOOP
            EXECUTE format('DROP INDEX %I.%I', r.s, r.i);
          END LOOP;
        END $$`;
  }

  /** The schema `osm_route_poi` lives in, resolved by the search_path. */
  private static readonly TABLE_SCHEMA = `(SELECT n.nspname
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.oid = 'osm_route_poi'::regclass)`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns = RoutePoiGas1791700000000.COLUMNS;
    const indexes = [
      ...RoutePoiGas1791700000000.KINDS.map((k) => `idx_osm_route_poi_${k}`),
      RoutePoiGas1791700000000.FLAG_INDEX,
    ];

    // Our indexes go FIRST and are made LAST: the flag index is partial on
    // `cylinder_swap`, and a column that is about to change type should not
    // have an index hanging on it.
    for (const name of indexes) {
      await queryRunner.query(RoutePoiGas1791700000000.dropIndex(name));
    }

    // 🔴 THE COLUMN, IN WHATEVER STATE IT IS ALREADY IN.
    //
    // `ADD COLUMN IF NOT EXISTS lpg text NOT NULL DEFAULT 'unknown' CHECK (…)`
    // looks idempotent and is not: when the column exists PostgreSQL skips the
    // WHOLE subcommand, NOT NULL, DEFAULT and CHECK with it. Measured on a
    // scratch database in the CAMP-258 review: after a bare `ADD COLUMN lpg
    // text`, that `up()` left the column nullable, without a DEFAULT and
    // without a CHECK, `lpg = 'banana'` went in, and the migration was
    // recorded as done. On production that is 2.27 million rows of NULL — the
    // one thing this file's header says cannot happen.
    //
    // So the two paths are separate, decided in SQL (no result is read: the
    // specs' QueryRunner shim and TypeORM's return different things):
    //   · no such column: ADD COLUMN … NOT NULL DEFAULT, which is a catalog
    //     change and not a rewrite;
    //   · the column exists, in whatever shape: every CHECK that is about this
    //     column alone is dropped WHATEVER IT IS CALLED (a leftover
    //     `lpg_legacy_values` made every default INSERT fail with 23514 after
    //     an `up()` that reported success); the type becomes `text` (a
    //     `char(10)` read back as `'unknown   '`); then the NULLs are filled
    //     and DEFAULT and NOT NULL set. The type step is a no-op, with no
    //     table rewrite, when the column is already `text` — a spec reads the
    //     relation's file node before and after.
    //     A value that is not one of the three words is NOT touched — the
    //     CHECK below then refuses it and the migration stops, loudly: a
    //     fourth state somebody wrote by hand is not ours to call `unknown`.
    //     (`boolean` and `integer` columns end the same way: their text is
    //     `'true'`, `'1'`, which no CHECK allows.)
    for (const c of columns) {
      await queryRunner.query(`
        DO $$
        DECLARE
          tbl regclass := 'osm_route_poi'::regclass;
          r record;
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = ${RoutePoiGas1791700000000.TABLE_SCHEMA}
               AND table_name = 'osm_route_poi' AND column_name = '${c}'
          ) THEN
            EXECUTE format('ALTER TABLE %s ADD COLUMN ${c} text NOT NULL DEFAULT ''unknown''', tbl);
          ELSE
            FOR r IN
              SELECT k.conname
                FROM pg_constraint k
                JOIN pg_attribute a
                  ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
               WHERE k.conrelid = tbl AND k.contype = 'c'
                 AND array_length(k.conkey, 1) = 1 AND a.attname = '${c}'
            LOOP
              EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, r.conname);
            END LOOP;
            EXECUTE format('ALTER TABLE %s ALTER COLUMN ${c} DROP DEFAULT', tbl);
            EXECUTE format('ALTER TABLE %s ALTER COLUMN ${c} TYPE text USING ${c}::text', tbl);
            EXECUTE format('UPDATE %s SET ${c} = ''unknown'' WHERE ${c} IS NULL', tbl);
            EXECUTE format('ALTER TABLE %s ALTER COLUMN ${c} SET DEFAULT ''unknown'', ALTER COLUMN ${c} SET NOT NULL', tbl);
          END IF;
        END $$`);
    }

    // 🔴 THE CHECKS: the canonical ones, added in ONE statement for both
    // columns — one ACCESS EXCLUSIVE lock and one scan validating both, which
    // is why the facilities migration is one ALTER. Anything of the same name
    // that is still there is dropped first.
    const checks = columns.map((c) => `osm_route_poi_${c}_check`);
    await queryRunner.query(
      `ALTER TABLE osm_route_poi
        ${[
          ...checks.map((n) => `DROP CONSTRAINT IF EXISTS ${n}`),
          ...columns.map(
            (c, i) =>
              `ADD CONSTRAINT ${checks[i]} CHECK (${c} IN ('yes', 'no', 'unknown'))`,
          ),
        ].join(',\n        ')}`,
    );

    // 🔴 THE INDEXES, MADE FRESH — `CREATE INDEX IF NOT EXISTS name` would be
    // satisfied by an index of that name on the wrong predicate, and the
    // catalog spec would then be the only thing that knew.
    for (const kind of RoutePoiGas1791700000000.KINDS) {
      await queryRunner.query(`
        CREATE INDEX idx_osm_route_poi_${kind}
          ON osm_route_poi USING GIST (location)
         WHERE kind = '${kind}'
      `);
    }
    await queryRunner.query(`
      CREATE INDEX ${RoutePoiGas1791700000000.FLAG_INDEX}
        ON osm_route_poi USING GIST (location)
       WHERE cylinder_swap = 'yes'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      RoutePoiGas1791700000000.dropIndex(RoutePoiGas1791700000000.FLAG_INDEX),
    );
    for (const kind of RoutePoiGas1791700000000.KINDS) {
      await queryRunner.query(
        RoutePoiGas1791700000000.dropIndex(`idx_osm_route_poi_${kind}`),
      );
    }
    for (const column of [...RoutePoiGas1791700000000.COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE osm_route_poi DROP COLUMN IF EXISTS ${column}`,
      );
    }
  }
}
