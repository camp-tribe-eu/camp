import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-154: the price of a litre on one forecourt.
 *
 * 🔴 WHY THIS IS A SEPARATE TABLE FROM `osm_route_poi` RATHER THAN THREE
 * COLUMNS ON IT.
 *
 * The obvious shape is `diesel_price`, `petrol_price`, `price_seen_at`
 * on the POI row. It is wrong for three reasons, and the third is the
 * one that would have bitten:
 *
 * 1. Lifetimes differ by four orders of magnitude. `osm_route_poi` is
 *    rebuilt weekly from the Geofabrik extracts (CAMP-28); these prices
 *    refresh between every thirty minutes and once a day. A weekly
 *    `-overwrite` over a table holding today's prices would drop them,
 *    and the page would render with no prices and exit 0 — the silent
 *    partial build this project has already shipped once (CAMP-69).
 *
 * 2. Provenance is per price, not per station. Each row carries the
 *    source that published it and the moment THAT source says the price
 *    was set. A column on the POI row could hold one timestamp for a
 *    station whose diesel was filed on Friday and whose petrol was
 *    filed in March. Measured 28.09.2026, that is not hypothetical:
 *    France's per-product `_maj` stamps on one station differ by weeks.
 *
 * 3. 🔴 MOST OF THESE PRICES BELONG TO NO OSM POINT AT ALL, and they
 *    must survive that. `osm_ref` is NULLABLE, and a row with a null
 *    one is a station we hold a price for and could not match — which
 *    is a measurement about our coverage. Hanging the price off the POI
 *    row would make the unmatched ones unrepresentable, and a coverage
 *    figure computed from a table that cannot hold the misses is not a
 *    measurement. That is this project's rule about a corpus sharing a
 *    field with what it measures, in table form.
 *
 * 🔴 `numeric(6,3)`, not `real`. Same argument as spot_tariffs: these
 * are money, three decimals is how every one of the three sources
 * publishes a price per litre, and a float column turns 1.849 into
 * 1.8489999771118164 for the page to print.
 *
 * 🔴 THE PRIMARY KEY IS (source, station_ref, grade).
 *
 * `station_ref` is unique within one source and means nothing across
 * them — Spain's IDEESS 3464 and Italy's idImpianto 3464 are different
 * forecourts in different countries. A key on `station_ref` alone would
 * have collided them silently. `grade` is in the key because one
 * forecourt posts a diesel price and a petrol price and they are
 * separate facts with separate dates.
 *
 * 🔴 THE UNIQUE INDEX ON (osm_ref, grade) IS THE ONE THAT MATTERS.
 *
 * It enforces that no OpenStreetMap fuel point can carry two stations'
 * prices for the same grade. Without it, two source stations either
 * side of a motorway — or a duplicate in the source register — both
 * match the same forecourt and the page prints whichever the planner
 * returned first, with no way to tell. The matcher assigns one-to-one
 * for that reason and this index is what makes a regression in it a
 * failed import instead of a wrong number on a page. `WHERE osm_ref IS
 * NOT NULL` because the unmatched rows are many and are all equally
 * null.
 */
export class FuelStationPrices1790662801000 implements MigrationInterface {
  name = 'FuelStationPrices1790662801000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fuel_station_prices (
        -- The feed, as fuel/stations.ts SOURCES names it. A closed list
        -- there; free text here, because a CHECK constraint that has to
        -- be migrated to add a country is a constraint people work
        -- around. The spec asserts the list instead.
        source        text NOT NULL,
        -- The source's own station id, verbatim.
        station_ref   text NOT NULL,
        -- 'diesel' | 'petrol' — the two grades the EU bulletin also
        -- publishes, so a station price and a country average compare.
        grade         text NOT NULL,
        country       char(2) NOT NULL,
        -- 🔴 The SOURCE'S OWN product name, unchanged: 'Gazole',
        -- 'Gasóleo A', 'Gasolio', 'SP95', 'E10', 'Benzina (servito)'.
        -- France sells 95-octane as SP95 and as E10 at different prices
        -- and 5 619 of its stations post only E10; the page prints this
        -- string so it never puts one product's number under another's
        -- name.
        product       text NOT NULL,
        price_eur     numeric(6,3) NOT NULL,
        -- When the SOURCE says the price was set. Never our fetch time.
        measured_at   timestamptz NOT NULL,
        -- When we fetched. The two are days apart in the normal case.
        fetched_at    timestamptz NOT NULL DEFAULT now(),
        location      geometry(Point, 4326) NOT NULL,
        -- The source's own label for the forecourt, where it has one.
        station_name  text,
        -- 🔴 NULLABLE, and most rows are null. See note 3 above.
        osm_ref       text,
        -- Straight-line metres from the source station to the OSM point
        -- it was matched to. Null when unmatched. Kept so a future
        -- change to MATCH_RADIUS_M can be measured against the matches
        -- it would gain or lose rather than argued about.
        match_metres  double precision,
        PRIMARY KEY (source, station_ref, grade)
      )
    `);

    // The route page's only read path: given an OSM fuel point, its price.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_fuel_station_prices_osm_ref
        ON fuel_station_prices (osm_ref)
       WHERE osm_ref IS NOT NULL
    `);

    // 🔴 The invariant. See the note above — this is what makes a broken
    // matcher a failed import rather than a wrong price on a forecourt.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_station_prices_osm_grade
        ON fuel_station_prices (osm_ref, grade)
       WHERE osm_ref IS NOT NULL
    `);

    // For the coverage report, which counts per country and per source.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_fuel_station_prices_country
        ON fuel_station_prices (country, grade)
    `);

    // 🔴 CAMP-179. This migration used to carry `1790662800000`, the same
    // stamp as BathingWaters, and the stamp is the ONLY thing TypeORM
    // orders migrations by. Two rows with one sort key are ordered by
    // whatever order the directory was read in — which differs between
    // macOS and the Linux runner. Nothing broke while the two tables
    // stayed independent; the day a third migration puts a foreign key
    // between them it would break on one machine and not the other.
    //
    // Renaming is safe only because every statement above is
    // `IF NOT EXISTS`: on a database that already ran the old name,
    // TypeORM sees the new name as pending and runs this again, to no
    // effect. What it would leave behind is a row for a migration that
    // no longer exists, so the row goes too. On a fresh database this
    // matches nothing and costs nothing.
    await queryRunner.query(
      `DELETE FROM migrations WHERE name = 'FuelStationPrices1790662800000'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_fuel_station_prices_country`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_fuel_station_prices_osm_grade`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_fuel_station_prices_osm_ref`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS fuel_station_prices`);
  }
}
