import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

// The freshness check reads `fuel_station_prices` through ONE query, and the
// claim that query makes — "the table is as old as its oldest source" — is
// about what PostgreSQL returns, not about what the string looks like. So the
// query that ships is taken from the script that ships (not copied here) and
// run against a real table.
//
// A temp table named like the real one shadows it for this session only.
// A MISSING DATABASE IS A FAILURE, NOT A SKIP (see account.db.spec.ts).

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
const SCRIPT = pathToFileURL(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'scripts',
    'ci',
    'check-data-freshness.mjs',
  ),
).href;

type Source = { table: string; column: string; groupBy?: string; name: string };
type Mod = { probeSql: (s: Source) => string; DB_SOURCES: readonly Source[] };

let db: Client;
let mod: Mod;
let fuel: Source;

const probe = async () => {
  const r = await db.query(mod.probeSql(fuel));
  const row = r.rows[0] as Record<string, string | null>;
  const [rows, stamp] = Object.values(row);
  return { rows: Number(rows), stamp };
};

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  mod = (await import(SCRIPT)) as Mod;
  fuel = mod.DB_SOURCES.find(
    (s) => s.table === 'fuel_station_prices',
  ) as Source;
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query(
    `CREATE TEMP TABLE fuel_station_prices (source text NOT NULL, fetched_at timestamptz NOT NULL)`,
  );
});
afterAll(async () => {
  await db?.end();
});

describe('the fuel freshness probe', () => {
  it('reads an empty table as no rows and no stamp, so it is "never run"', async () => {
    expect(await probe()).toEqual({ rows: 0, stamp: null });
  });

  it('is the age of the OLDEST source, not of the newest row', async () => {
    await db.query(
      `INSERT INTO fuel_station_prices VALUES
         ('es-minetur',       '2026-10-28 06:59:27+00'),
         ('fr-data-economie', '2026-10-28 06:59:27+00'),
         ('it-mimit',         '2026-10-13 09:59:39+00')`,
    );
    expect(await probe()).toEqual({ rows: 3, stamp: '2026-10-13T09:59:39Z' });
  });

  it('turns fresh again only when the stale source is read', async () => {
    await db.query(
      `UPDATE fuel_station_prices SET fetched_at = '2026-10-28 07:10:00+00' WHERE source = 'it-mimit'`,
    );
    expect(await probe()).toEqual({ rows: 3, stamp: '2026-10-28T06:59:27Z' });
  });
});
