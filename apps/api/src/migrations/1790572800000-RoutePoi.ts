import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-113: the services a driver needs BETWEEN campsites.
 *
 * 🔴 Why a new table rather than a query over `osm_ctx_poi`.
 *
 * The card, and the brief that came with it, both assumed `osm_ctx_poi`
 * already held these points. It does not. Measured 28.09.2026 against
 * the live database, that table holds 252 858 rows and exactly two
 * things: 214 906 supermarkets and 37 389 railway stations and halts —
 * because CAMP-33 built it to answer one question ("does this campsite
 * work without a car") and `load-context.sh` exports only the three tags
 * `compute-context.ts` reads. There is no fuel, no charging, no water,
 * no dump station and no contact field anywhere in it.
 *
 * So this is a second layer off the same 27 Geofabrik extracts, loaded
 * by scripts/osm-pipeline/load-route-poi.sh. Same source, same licence
 * (ODbL), no new dependency on CAMP-111.
 *
 * 🔴 The table is declared HERE and filled by the pipeline, which is the
 * opposite of how the three `osm_ctx_*` tables work — those are created
 * by ogr2ogr's `-overwrite` and so have whatever shape the last run gave
 * them. A table whose columns are a side effect of a shell script cannot
 * be reasoned about from this repository, and `-overwrite` on a table
 * the API reads is the "silently wrong data" shape load-context.sh's own
 * header spends thirty lines warning about. The loader writes into this
 * table inside a transaction instead.
 *
 * 🔴 SEVEN PARTIAL GiST INDEXES, ONE PER KIND, AND NOT ONE INDEX ON
 * `location`.
 *
 * Every query this table exists for is "the nearest X to this point".
 * A single GiST index on `location` makes that a KNN walk that reads and
 * discards every other kind on the way out — and for `dump` (7 519 rows
 * against 2 248 490) that walk is most of the table. A partial index per
 * kind makes each query a walk over only its own rows: measured
 * 28.09.2026, 0.2 ms for `food` and 24 ms cold for `dump`.
 *
 * 🔴 AND THE PREDICATE HAS TO BE A LITERAL, WHICH IS NOT OBVIOUS AND
 * COST 9.7 SECONDS BEFORE IT WAS MEASURED.
 *
 * A partial index is only usable when the planner can PROVE the query's
 * quals imply its predicate, and it can only do that against a constant.
 * The first version of the service asked for all seven kinds in one pass
 * with `WHERE r.kind = k.kind` against an `unnest(...)` — a perfectly
 * ordinary-looking join, and `kind = k.kind` does not imply
 * `kind = 'fuel'` at plan time. Measured on the seven-stage France
 * route: Seq Scan on osm_route_poi, 1 938 428 rows removed by filter per
 * lookup, **9 699 ms for one page**. With the kind written in as a
 * literal the same 49 lookups are an Index Scan each.
 *
 * `$1` is no better than a join column here: a generic plan cannot prove
 * the implication either, so it is not something to leave to the planner
 * getting lucky on a custom plan. routes.service.ts therefore builds the
 * kind into the SQL from the closed `ROUTE_POI_KINDS` whitelist, and a
 * spec asserts the list and these indexes match.
 *
 * The kinds are a closed list for that reason: adding one without its
 * index would not fail, it would get slow, which is the failure nobody
 * notices.
 */
export class RoutePoi1790572800000 implements MigrationInterface {
  name = 'RoutePoi1790572800000';

  /** Kept beside the up() that creates them, so the two cannot drift. */
  static readonly KINDS = [
    'fuel',
    'charging',
    'water',
    'dump',
    'groceries',
    'food',
    'shelter',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS osm_route_poi (
        -- 'n1234' / 'w5678' — osmium's type_id. Stable across imports,
        -- so a re-run is an upsert and not a new set of rows.
        osm_ref       text PRIMARY KEY,
        kind          text NOT NULL,
        name          text,
        location      geometry(Point, 4326) NOT NULL,
        -- 🔴 CAMP-118's scope, enforced on this table too.
        --
        -- Lower-case ISO 3166-1 alpha-2, resolved at import by a
        -- point-in-polygon against ne_admin1. NULLABLE, and that is not
        -- laziness: Natural Earth's polygons are simplified, so 65 464 of
        -- the 2.26 M rows (2.9%) fall in no polygon at all — a fuel dock
        -- on a marina, a services area on a reclaimed spit. Those are
        -- kept, because they came out of an EU-27 extract and "outside
        -- every simplified coastline" is not evidence of being outside
        -- the Union. What is dropped is a row positively inside a
        -- NON-member's polygon: 13 009 of them, 6 320 in the United
        -- Kingdom alone, because the Geofabrik extract for Ireland is
        -- "ireland-and-northern-ireland" and the Alpine extracts cross
        -- into Switzerland.
        --
        -- Without this the Wild Atlantic Way page could offer a driver a
        -- charging point in a country none of our safety sources covers,
        -- which is the failure CAMP-118 was opened for.
        country       char(2),
        -- 🔴 Every one of these is nullable and most of them are null.
        -- Measured on the 2 248 490 rows this table holds: opening hours
        -- on 43.5% of fuel stations and 1.5% of drinking water; a phone
        -- on 16.3% of fuel stations and 0.0% of drinking water. The page
        -- says "unknown" rather than leaving a gap, which is the card's
        -- acceptance criterion.
        phone         text,
        website       text,
        opening_hours text,
        -- When OUR import last saw it. Never "when a mapper last edited"
        -- — we are not told that, and lib/sources.ts is explicit that
        -- claiming it would be a lie on every page.
        last_seen_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const kind of RoutePoi1790572800000.KINDS) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_osm_route_poi_${kind}
          ON osm_route_poi USING GIST (location)
         WHERE kind = '${kind}'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const kind of RoutePoi1790572800000.KINDS) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_osm_route_poi_${kind}`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS osm_route_poi`);
  }
}
