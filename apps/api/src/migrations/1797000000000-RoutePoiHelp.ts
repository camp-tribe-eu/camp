import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-506: two kinds join `osm_route_poi` — `pharmacy` (`amenity=pharmacy`)
 * and `car_repair` (`shop=car_repair`) — for the campsite page's "when
 * something goes wrong" group.
 *
 * THIS MIGRATION ONLY MAKES THE TABLE READY: one partial GiST index per kind
 * (the same shape as every other kind: a kind written as a LITERAL in the
 * query is what lets the planner use a partial index). It inserts no rows.
 * The rows arrive with the next weekly OSM import, whose tag list now carries
 * both tags (scripts/osm-pipeline/route-poi-filters.sh); until then the block
 * simply has nothing to say about them.
 *
 * 🔴 The index is dropped through `pg_index` as an index OF `osm_route_poi`,
 * never by bare name: see RoutePoiGas1791700000000.dropIndex for the incident
 * a bare `DROP INDEX name` caused in a spec schema.
 */
export class RoutePoiHelp1797000000000 implements MigrationInterface {
  name = 'RoutePoiHelp1797000000000';

  static readonly KINDS = ['pharmacy', 'car_repair'] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const kind of RoutePoiHelp1797000000000.KINDS) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_osm_route_poi_${kind}
          ON osm_route_poi USING GIST (location)
         WHERE kind = '${kind}'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const kind of RoutePoiHelp1797000000000.KINDS) {
      await queryRunner.query(`
        DO $$
        DECLARE r record;
        BEGIN
          FOR r IN
            SELECT n.nspname AS s, c.relname AS i
              FROM pg_index x
              JOIN pg_class c ON c.oid = x.indexrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE x.indrelid = 'osm_route_poi'::regclass
               AND c.relname = 'idx_osm_route_poi_${kind}'
          LOOP
            EXECUTE format('DROP INDEX %I.%I', r.s, r.i);
          END LOOP;
        END $$`);
    }
  }
}
