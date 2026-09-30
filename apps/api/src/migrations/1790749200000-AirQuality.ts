import { MigrationInterface, QueryRunner } from 'typeorm';
import { EU_MEMBER_STATES } from '../osm/eu';
import { AIR_BASES, AIR_POLLUTANTS, AIR_STATION_TYPES } from '../air/source';

/**
 * CAMP-164: the EEA's European Air Quality Index — the station roster,
 * each station's latest REPORTED hour, and the 1 km modelled index for
 * the campsites no station is near.
 *
 * 🔴 Measured 29.09.2026 against the live endpoints:
 *
 *     roster                               4 643 stations, 40 country prefixes
 *     ├─ EU-27                             4 018   (27 of 27)
 *     └─ outside the Union (declared)        625   (13 prefixes)
 *     EU-27 stations with an index value
 *       in the 19:00 UTC map file          3 206 of 4 018   (79.8%)
 *
 * One station in five is silent in any given hour. That is the normal
 * state, and it is why a station's reading columns are all-or-nothing
 * here and a page renders "no fresh data" for the nothing.
 *
 * 🔴 THE READING LIVES ON THE STATION ROW, AND NOT IN A HISTORY TABLE.
 * Only the newest hour in which something was REPORTED is kept. A page
 * says what the station last reported and when; it does not draw a
 * curve, and an hourly history of 4 018 stations is 35 million rows a
 * year answering a question nobody asks. What it costs: no chart, and a
 * reading can only be corrected by the next import.
 *
 * 🔴 `reading_basis` IS 'reported' OR 'mixed' AND NOTHING ELSE.
 * The newest hour of nearly every station is a model estimate filed
 * under the station's name (240 of 240 sampled). A row that could hold
 * one would let a page print "as reported to the EEA" over a model
 * output. The CHECK is generated from AIR_BASES so the column and the
 * TypeScript union cannot drift — and an hour that is entirely modelled
 * is refused by the parser and by this constraint alike, two locks on
 * the one rule the card exists to keep.
 *
 * 🔴 `country` IS CHECKED AGAINST THE 27, generated from EU_MEMBER_STATES.
 * "Everything not in this list" is a query that must return zero, and
 * here the database is what makes it so: a station the parser let
 * through by mistake, or a future importer that forgot to translate a
 * code, is refused by the column and not filed under a country we do
 * not serve.
 *
 * 🔴 `reading_*` ARE ALL NULL OR ALL SET. A half-filled reading — an
 * hour without a basis, a basis without an hour — is the row from which
 * a page prints something it cannot vouch for.
 *
 * 🔴 `floor(reading_index) = reading_band`. The band is the whole part
 * of the index as published; stored twice so that disagreement is
 * visible instead of one of them silently winning.
 *
 * 🔴 The modelled table is keyed by CAMPSITE, not by grid cell, and holds
 * one row per campsite that has no station within AIR_RADIUS_M — replaced
 * whole on every import. A row that outlived its reason (a station
 * arrived nearby; the model stopped covering the point) would be read
 * by a page; deleting them all first is what makes the table a fact
 * about now. No foreign key: the weekly OSM import upserts campsites and
 * must never be able to fail on, or cascade into, this table.
 */
export class AirQuality1790749200000 implements MigrationInterface {
  name = 'AirQuality1790749200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const countries = EU_MEMBER_STATES.map((c) => `'${c}'`).join(', ');
    const types = AIR_STATION_TYPES.map((t) => `'${t}'`).join(', ');
    const bases = AIR_BASES.map((b) => `'${b}'`).join(', ');
    const pollutants = AIR_POLLUTANTS.map((p) => `'${p}'`).join(', ');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS air_quality_stations (
        code                text PRIMARY KEY,
        name                text NOT NULL,
        municipality        text,
        country             text NOT NULL,
        station_type        text NOT NULL,
        area_classification text,
        location            geography(Point, 4326) NOT NULL,
        roster_file         text NOT NULL,

        reading_hour        timestamptz,
        reading_index       numeric,
        reading_band        smallint,
        reading_basis       text,
        reading_culprit     text,
        reading_pollutants  jsonb,
        read_at             timestamptz,

        CONSTRAINT air_quality_stations_country_eu27
          CHECK (country IN (${countries})),

        CONSTRAINT air_quality_stations_type_known
          CHECK (station_type IN (${types})),

        CONSTRAINT air_quality_stations_reading_whole
          CHECK (
            (reading_hour IS NULL AND reading_index IS NULL
              AND reading_band IS NULL AND reading_basis IS NULL
              AND reading_culprit IS NULL AND reading_pollutants IS NULL)
            OR
            (reading_hour IS NOT NULL AND reading_index IS NOT NULL
              AND reading_band IS NOT NULL AND reading_basis IS NOT NULL
              AND reading_culprit IS NOT NULL AND reading_pollutants IS NOT NULL)
          ),

        CONSTRAINT air_quality_stations_basis_known
          CHECK (reading_basis IN (${bases})),

        CONSTRAINT air_quality_stations_band_known
          CHECK (reading_band BETWEEN 1 AND 6),

        CONSTRAINT air_quality_stations_index_is_band
          CHECK (floor(reading_index) = reading_band),

        CONSTRAINT air_quality_stations_culprit_known
          CHECK (reading_culprit IN (${pollutants}))
      )
    `);

    // The page's read: a KNN walk from a campsite to the nearest station.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_air_quality_stations_location
        ON air_quality_stations USING GIST (location)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS air_quality_modelled (
        spot_id  uuid PRIMARY KEY,
        hour     timestamptz NOT NULL,
        band     smallint NOT NULL,
        read_at  timestamptz NOT NULL,

        CONSTRAINT air_quality_modelled_band_known
          CHECK (band BETWEEN 1 AND 6)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS air_quality_modelled`);
    await queryRunner.query(`DROP TABLE IF EXISTS air_quality_stations`);
  }
}
