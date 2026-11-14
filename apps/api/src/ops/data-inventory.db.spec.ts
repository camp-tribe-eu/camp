import { Client } from 'pg';
import { ENTITIES, inventorySql } from './data-inventory';

// CAMP-508 — the inventory against a REAL PostgreSQL, on rows built so
// that every entity has a different count.
//
// 🔴 THE FIXTURE IS THE TEST. On a fixture where each station has one
// grade and no two feeds share a reference, "price rows", "stations" and
// `count(DISTINCT station_ref)` are the same number, and a report that
// confused all three would pass. So here:
//
//   · two stations post two grades          → rows ≠ stations;
//   · reference '1' exists in TWO feeds     → stations ≠ DISTINCT station_ref;
//   · tariffs live in their own table, with a count no fuel query yields.
//
// Expected numbers are written out below, counted by hand from the
// INSERTs — not computed with the SQL under test.
//
// 🔴 TEMP tables: they shadow the real ones for this session only, so the
// spec is safe on a database somebody else is using.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP.

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

let db: Client;
let lines: string[];

/** `| key | what | `table` | number | `query` |` → its cells. */
const cells = (line: string) =>
  line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

const lineOf = (key: string) => {
  const found = lines.filter((l) => cells(l)[0] === key);
  expect(found).toHaveLength(1);
  const [, what, table, n, query] = cells(found[0]);
  return { what, table, n: Number(n), query };
};

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query(`
    CREATE TEMP TABLE fuel_station_prices (
      source text NOT NULL, station_ref text NOT NULL, grade text NOT NULL,
      country char(2) NOT NULL, PRIMARY KEY (source, station_ref, grade));
    CREATE TEMP TABLE spot_tariffs (spot_id int NOT NULL);
    CREATE TEMP TABLE camping_spots (country text NOT NULL, missing_since date);

    -- 6 price rows · 4 stations · 3 distinct station_ref · 3 countries
    INSERT INTO fuel_station_prices VALUES
      ('es-minetur',       '1', 'diesel', 'es'),
      ('es-minetur',       '1', 'petrol', 'es'),
      ('it-mimit',         '1', 'diesel', 'it'),
      ('it-mimit',         '2', 'diesel', 'it'),
      ('it-mimit',         '2', 'petrol', 'it'),
      ('fr-data-economie', '3', 'diesel', 'fr');

    -- 5 tariffs · 2 campsites
    INSERT INTO spot_tariffs VALUES (10), (10), (10), (20), (20);

    -- 9 campsite rows · 8 not missing · 7 country codes
    INSERT INTO camping_spots VALUES
      ('FR', NULL), ('FR', NULL), ('FR', '2026-10-01'),
      ('DE', NULL), ('IT', NULL), ('ES', NULL), ('FI', NULL),
      ('AX', NULL), ('CY', NULL);
  `);
  const r = await db.query<{ line: string }>(inventorySql());
  lines = r.rows.map((row) => row.line);
});
afterAll(async () => {
  await db?.end();
});

describe('the data inventory', () => {
  it('counts price rows, stations and campsite tariffs as three different things', () => {
    expect(lineOf('fuel_price_rows').n).toBe(6);
    expect(lineOf('fuel_stations').n).toBe(4);
    expect(lineOf('campsite_tariffs').n).toBe(5);
  });

  it('does not merge two feeds that reuse a station reference', () => {
    // DISTINCT station_ref would say 3.
    expect(lineOf('fuel_stations').n).toBe(4);
  });

  it('counts the rest', () => {
    expect(lineOf('fuel_station_countries').n).toBe(3);
    expect(lineOf('campsites_with_a_tariff').n).toBe(2);
    expect(lineOf('campsite_rows').n).toBe(9);
    expect(lineOf('campsite_rows_not_missing').n).toBe(8);
    expect(lineOf('campsite_country_codes').n).toBe(7);
  });

  it('prints, beside every number, the table and the query that produced it', async () => {
    expect(lines).toHaveLength(ENTITIES.length + 1);
    for (const e of ENTITIES) {
      const l = lineOf(e.key);
      expect(l.table).toBe(`\`${e.table}\``);
      expect(l.query).toBe(`\`${e.sql}\``);
      // 🔴 Run the PRINTED query, not the one in the module: the line is
      // what a partner is handed, so the line is what must reproduce.
      const again = await db.query(l.query.slice(1, -1));
      expect(Number(Object.values(again.rows[0] as object)[0])).toBe(l.n);
    }
  });

  it('never calls a campsite tariff fuel, nor reads fuel from the tariff table', () => {
    for (const e of ENTITIES) {
      // each query reads the table its line names, and only that one
      const read = [...e.sql.matchAll(/\bFROM\s+([a-z_]+)/g)].map((m) => m[1]);
      expect(read.length).toBeGreaterThan(0);
      expect(new Set(read)).toEqual(new Set([e.table]));
      if (e.table === 'spot_tariffs') expect(e.key).not.toMatch(/fuel/);
      if (e.table === 'fuel_station_prices') expect(e.key).toMatch(/^fuel_/);
    }
    expect(lineOf('campsite_tariffs').what).toMatch(/campsite/i);
    expect(lineOf('campsite_tariffs').what).toMatch(/not fuel/i);
  });

  it('dates the report from the database clock, first line', () => {
    expect(lines[0]).toMatch(
      /^measured \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC on database \S+$/,
    );
  });
});
