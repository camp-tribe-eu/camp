import type { QueryRunner } from 'typeorm';
import { AirQuality1790749200000 } from '../migrations/1790749200000-AirQuality';
import { EU_MEMBER_STATES } from '../osm/eu';
import { AIR_BASES, AIR_POLLUTANTS, AIR_STATION_TYPES } from './source';

// CAMP-164: what the database itself refuses.
//
// 🔴 WHY THIS FILE EXISTS. The card's central rule — a model output is
// never filed as a station's report — is enforced twice: by the parser,
// and by a CHECK on the column. The API reads the row out of JSON with an
// unchecked cast, so nothing in TypeScript stops a wrong `basis` reaching
// a page; the column is what does, and no test referenced the migration
// at all until now.
//
// This runs the REAL `up()` against a query runner that records what it
// is asked to execute and asserts the constraints in the DDL it emitted —
// the same statement CI executes when it migrates the fixture. Each
// assertion was checked by deleting the clause it names.

async function emittedSql(): Promise<string> {
  const statements: string[] = [];
  const runner = {
    query: async (sql: string) => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  await new AirQuality1790749200000().up(runner);
  return statements.map((s) => s.replace(/\s+/g, ' ').trim()).join('\n');
}

describe('the air_quality_stations migration', () => {
  it('creates both tables', async () => {
    const sql = await emittedSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS air_quality_stations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS air_quality_modelled');
  });

  // 🔴 "A query for everything not in this list returns zero" — made true
  // by the column, so that a station filed under a country we do not
  // serve is refused by the database and not merely by a parser.
  it('limits country to exactly the 27, Greece as gr', async () => {
    const sql = await emittedSql();
    const list = EU_MEMBER_STATES.map((c) => `'${c}'`).join(', ');
    expect(sql).toContain(`CHECK (country IN (${list}))`);
    expect(EU_MEMBER_STATES).toHaveLength(27);
    expect(list).toContain("'gr'");
    expect(list).not.toContain("'el'");
    expect(list).not.toContain("'ch'");
    expect(list).not.toContain("'uk'");
  });

  // 🔴 THE ONE THE CARD EXISTS FOR. A station row can hold `reported` or
  // `mixed`; a fully modelled hour is not storable.
  it('limits the basis of a reading to reported and mixed — never modelled', async () => {
    const sql = await emittedSql();
    const list = AIR_BASES.map((b) => `'${b}'`).join(', ');
    expect(sql).toContain(`CHECK (reading_basis IN (${list}))`);
    expect(list).toBe("'reported', 'mixed'");
    expect(sql).not.toMatch(/reading_basis IN \([^)]*modelled/);
  });

  it('makes a reading all-or-nothing', async () => {
    const sql = await emittedSql();
    expect(sql).toContain(
      'CHECK ( (reading_hour IS NULL AND reading_index IS NULL AND reading_band IS NULL AND reading_basis IS NULL AND reading_culprit IS NULL AND reading_pollutants IS NULL) OR (reading_hour IS NOT NULL AND reading_index IS NOT NULL AND reading_band IS NOT NULL AND reading_basis IS NOT NULL AND reading_culprit IS NOT NULL AND reading_pollutants IS NOT NULL) )',
    );
  });

  it('limits the level to 1–6 and ties it to the index', async () => {
    const sql = await emittedSql();
    expect(sql).toContain('CHECK (reading_band BETWEEN 1 AND 6)');
    expect(sql).toContain('CHECK (floor(reading_index) = reading_band)');
    expect(sql).toContain('CHECK (band BETWEEN 1 AND 6)');
  });

  it('limits the culprit to the five pollutants and the kind to the three', async () => {
    const sql = await emittedSql();
    expect(sql).toContain(
      `CHECK (reading_culprit IN (${AIR_POLLUTANTS.map((p) => `'${p}'`).join(', ')}))`,
    );
    expect(sql).toContain(
      `CHECK (station_type IN (${AIR_STATION_TYPES.map((t) => `'${t}'`).join(', ')}))`,
    );
  });

  it('gives every station a location, because the page is chosen by geography', async () => {
    expect(await emittedSql()).toMatch(
      /\blocation geography\(Point, 4326\) NOT NULL\b/,
    );
  });

  it('indexes the location for the nearest-station walk', async () => {
    expect(await emittedSql()).toContain(
      'CREATE INDEX IF NOT EXISTS idx_air_quality_stations_location ON air_quality_stations USING GIST (location)',
    );
  });

  it('keys a station by its code and a modelled value by its campsite', async () => {
    const sql = await emittedSql();
    expect(sql).toMatch(/\bcode text PRIMARY KEY\b/);
    expect(sql).toMatch(/\bspot_id uuid PRIMARY KEY\b/);
  });

  // No foreign key: the weekly OSM import upserts campsites and must
  // never be able to fail on, or cascade into, this table.
  it('has no foreign key to camping_spots', async () => {
    expect(await emittedSql()).not.toMatch(/REFERENCES/i);
  });
});
