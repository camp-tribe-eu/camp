import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { RoutePoi1790572800000 } from '../migrations/1790572800000-RoutePoi';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { RoutePoiGas1791700000000 } from '../migrations/1791700000000-RoutePoiGas';

// CAMP-258 — THE MIGRATION, RUN OVER EVERY STATE ITS COLUMNS CAN BE IN.
//
// 🔴 WHY THIS EXISTS. The first `up()` was
//
//     ADD COLUMN IF NOT EXISTS lpg text NOT NULL DEFAULT 'unknown'
//       CHECK (lpg IN ('yes', 'no', 'unknown'))
//
// and it reads as idempotent. It is not: when the column exists PostgreSQL
// skips the WHOLE subcommand — NOT NULL, DEFAULT and CHECK with it. After a
// bare `ADD COLUMN lpg text` that `up()` left the column nullable, with no
// DEFAULT and no CHECK, `lpg = 'banana'` went in, and the migration would
// have been recorded as run. Every other spec runs `up()` on a table that has
// no such column, which is the one state in which the two forms agree, so none
// of them could see it.
//
// So every test here builds the table the way production has it before this
// card (the two real earlier migrations), puts the columns or indexes into a
// state `up()` has to repair, runs the REAL `up()`, and asks the CATALOG and
// the table what they hold — and then tries to insert `'banana'`.
//
// Everything happens in a schema made for this test and dropped afterwards;
// the connection's search_path puts it first, so the real `osm_route_poi` is
// never in reach. A missing database is a FAILURE, not a skip.

jest.setTimeout(120_000);

const URL =
  process.env.CI_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';

let db: Client;
let schema = '';
let decoy = '';
let n = 0;

const runner = () =>
  ({ query: (sql: string) => db.query(sql) }) as unknown as QueryRunner;

/** The table as production holds it before this card. */
async function freshTable() {
  n += 1;
  schema = `camp258_mig_${process.pid}_${n}`;
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET search_path = ${schema}, public`);
  await new RoutePoi1790572800000().up(runner());
  await new RoutePoiFacilities1791400000000().up(runner());
}

const point = `ST_SetSRID(ST_MakePoint(14, 46), 4326)`;
const insertRow = (ref: string, kind: string, extra = '') =>
  db.query(
    `INSERT INTO osm_route_poi (osm_ref, kind, location, country${extra ? ', ' + extra.split('=')[0] : ''})
     VALUES ('${ref}', '${kind}', ${point}, 'si'${extra ? ', ' + extra.split('=')[1] : ''})`,
  );

interface Shape {
  nullable: string;
  def: string | null;
  checks: string[];
}

async function shape(column: string): Promise<Shape> {
  const col = (
    await db.query(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'osm_route_poi'
          AND column_name = $1`,
      [column],
    )
  ).rows[0];
  const checks = (
    await db.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'osm_route_poi'::regclass AND contype = 'c'
          AND conname = $1`,
      [`osm_route_poi_${column}_check`],
    )
  ).rows.map((r) => `${r.conname}: ${r.def}`);
  return { nullable: col.is_nullable, def: col.column_default, checks };
}

const WANTED = (column: string): Shape => ({
  nullable: 'NO',
  def: `'unknown'::text`,
  checks: [
    `osm_route_poi_${column}_check: CHECK ((${column} = ANY (ARRAY['yes'::text, 'no'::text, 'unknown'::text])))`,
  ],
});

async function indexDefs(): Promise<Record<string, string>> {
  const rows = (
    await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = 'osm_route_poi'
          AND indexname IN ('idx_osm_route_poi_gas_exchange', 'idx_osm_route_poi_cylinder_swap')`,
    )
  ).rows;
  // `CREATE INDEX name ON schema.osm_route_poi USING gist …`: the schema
  // is this test's, so it is cut out to keep the expectation readable
  return Object.fromEntries(
    rows.map((r) => [
      r.indexname as string,
      (r.indexdef as string).replace(
        /ON \S+\.osm_route_poi/,
        'ON osm_route_poi',
      ),
    ]),
  );
}

const WANTED_INDEXES = {
  idx_osm_route_poi_gas_exchange:
    "CREATE INDEX idx_osm_route_poi_gas_exchange ON osm_route_poi USING gist (location) WHERE (kind = 'gas_exchange'::text)",
  idx_osm_route_poi_cylinder_swap:
    "CREATE INDEX idx_osm_route_poi_cylinder_swap ON osm_route_poi USING gist (location) WHERE (cylinder_swap = 'yes'::text)",
};

/** What the migration has to have made, whatever it started from. */
async function expectTheWantedShape() {
  for (const column of ['lpg', 'cylinder_swap']) {
    expect({ column, ...(await shape(column)) }).toEqual({
      column,
      ...WANTED(column),
    });
  }
  expect(await indexDefs()).toEqual(WANTED_INDEXES);

  // …and the shape is not a description: the table refuses what it says it
  // refuses, and takes what it says it takes.
  for (const column of ['lpg', 'cylinder_swap']) {
    for (const bad of ['banana', 'YES', '']) {
      await expect(
        insertRow('n9', 'fuel', `${column}='${bad}'`),
      ).rejects.toMatchObject({
        code: '23514', // check_violation
        constraint: `osm_route_poi_${column}_check`,
      });
    }
    await expect(
      insertRow('n9', 'fuel', `${column}=NULL`),
    ).rejects.toMatchObject({
      code: '23502', // not_null_violation
    });
    for (const good of ['yes', 'no', 'unknown']) {
      await insertRow('n8', 'fuel', `${column}='${good}'`);
      expect(
        (
          await db.query(
            `SELECT ${column} AS v FROM osm_route_poi WHERE osm_ref = 'n8'`,
          )
        ).rows[0].v,
      ).toBe(good);
      await db.query(`DELETE FROM osm_route_poi WHERE osm_ref = 'n8'`);
    }
  }
  // a row written without either column is `unknown`, never NULL and never no
  await insertRow('n7', 'fuel');
  expect(
    (
      await db.query(
        `SELECT lpg, cylinder_swap FROM osm_route_poi WHERE osm_ref = 'n7'`,
      )
    ).rows[0],
  ).toEqual({ lpg: 'unknown', cylinder_swap: 'unknown' });
  await db.query(`DELETE FROM osm_route_poi WHERE osm_ref = 'n7'`);
}

beforeAll(async () => {
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
});

afterEach(async () => {
  await db.query('RESET search_path');
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await db.query(`DROP SCHEMA IF EXISTS ${decoy} CASCADE`);
});

afterAll(async () => {
  await db?.end();
});

// 🔴 A MIGRATION DROPS WHAT BELONGS TO ITS OWN TABLE, AND NOTHING ELSE.
//
// An unqualified `DROP INDEX IF EXISTS name` walks the whole search_path and
// drops the first index of that name it finds — in ANOTHER schema, when its
// own has none yet. That is what this very spec did to camptribe_dev the first
// time it ran the rewritten `up()`: the table was built in a schema of its
// own, the two indexes were not there yet, and the REAL ones in `public` went.
// Production has one schema and would never have shown it, so it is made to
// show here: a second schema, later on the search_path, holds the complete
// result of this migration, and it has to come out untouched.
describe('RoutePoiGas.up() and down() leave another schema alone', () => {
  const indexesOf = async (name: string) =>
    (
      await db.query(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = $1 AND tablename = 'osm_route_poi' ORDER BY 1`,
        [name],
      )
    ).rows.map((r) => r.indexname as string);

  async function decoyWithTheWholeResult() {
    decoy = `camp258_decoy_${process.pid}`;
    await db.query(`CREATE SCHEMA ${decoy}`);
    await db.query(`SET search_path = ${decoy}, public`);
    await new RoutePoi1790572800000().up(runner());
    await new RoutePoiFacilities1791400000000().up(runner());
    await new RoutePoiGas1791700000000().up(runner());
    return indexesOf(decoy);
  }

  // MUTATION: an unqualified `DROP INDEX IF EXISTS …` in up() or down().
  it('up(): the decoy keeps both of its indexes', async () => {
    const before = await decoyWithTheWholeResult();
    expect(before).toEqual(
      expect.arrayContaining([
        'idx_osm_route_poi_gas_exchange',
        'idx_osm_route_poi_cylinder_swap',
      ]),
    );
    await freshTable();
    // the table's own schema first, the decoy after it — the shape of
    // `search_path = camp258_mig_…, public`, where `public` held the real ones
    await db.query(`SET search_path = ${schema}, ${decoy}, public`);
    await new RoutePoiGas1791700000000().up(runner());
    expect(await indexesOf(decoy)).toEqual(before);
    expect(Object.keys(await indexDefs())).toHaveLength(2);
  });

  it('down(): the decoy keeps both of its indexes', async () => {
    const before = await decoyWithTheWholeResult();
    await freshTable();
    await db.query(`SET search_path = ${schema}, ${decoy}, public`);
    await new RoutePoiGas1791700000000().up(runner());
    await new RoutePoiGas1791700000000().down(runner());
    expect(await indexesOf(decoy)).toEqual(before);
  });

  // …and the columns of the decoy are as they were: the DO block that decides
  // between ADD COLUMN and repair looks at THIS table's schema, not at the
  // first schema on the path, so a decoy that already has the columns cannot
  // make a fresh table skip them.
  it('up(): a decoy that has the columns does not stop the table from getting them', async () => {
    await decoyWithTheWholeResult();
    await freshTable();
    await db.query(`SET search_path = ${schema}, ${decoy}, public`);
    await new RoutePoiGas1791700000000().up(runner());
    await expectTheWantedShape();
  });
});

describe('RoutePoiGas.up() resolves the table the way the search_path does', () => {
  // The DO block that chooses between ADD COLUMN and repair must look at the
  // schema the TABLE is in, which is not always the first schema on the path:
  // here the first one exists and holds nothing. MUTATION: ask
  // `current_schema()` instead — it answers the empty one, finds no column,
  // and tries to ADD a column that is already there.
  it('when the first schema on the path exists and holds no table', async () => {
    await freshTable();
    await db.query(
      `ALTER TABLE osm_route_poi ADD COLUMN lpg text, ADD COLUMN cylinder_swap text`,
    );
    decoy = `camp258_empty_${process.pid}`;
    await db.query(`CREATE SCHEMA ${decoy}`);
    await db.query(`SET search_path = ${decoy}, ${schema}, public`);
    await new RoutePoiGas1791700000000().up(runner());
    await db.query(`SET search_path = ${schema}, public`);
    await expectTheWantedShape();
  });
});

describe('RoutePoiGas.up() brings the columns, checks and indexes to their shape', () => {
  it('on a table that has none of them', async () => {
    await freshTable();
    await insertRow('n1', 'fuel');
    await new RoutePoiGas1791700000000().up(runner());
    await expectTheWantedShape();
    // the row that was there before is `unknown`, not NULL
    expect(
      (
        await db.query(
          `SELECT lpg, cylinder_swap FROM osm_route_poi WHERE osm_ref = 'n1'`,
        )
      ).rows[0],
    ).toEqual({ lpg: 'unknown', cylinder_swap: 'unknown' });
  });

  // 🔴 THE REVIEW'S CASE, NAME FOR NAME. MUTATION: put
  // `ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT … CHECK (…)` back into up().
  // The column then stays nullable, without a default and without a CHECK,
  // and `lpg = 'banana'` is inserted.
  it('on columns that exist as a bare `text`, with NULLs in them', async () => {
    await freshTable();
    await db.query(
      `ALTER TABLE osm_route_poi ADD COLUMN lpg text, ADD COLUMN cylinder_swap text`,
    );
    await insertRow('n1', 'fuel'); // both NULL
    await insertRow('n2', 'fuel', `lpg='yes'`); // one written, one NULL
    await new RoutePoiGas1791700000000().up(runner());
    await expectTheWantedShape();
    expect(
      (
        await db.query(
          `SELECT osm_ref, lpg, cylinder_swap FROM osm_route_poi ORDER BY 1`,
        )
      ).rows,
    ).toEqual([
      { osm_ref: 'n1', lpg: 'unknown', cylinder_swap: 'unknown' },
      // what somebody had written is kept, and only the NULL is filled
      { osm_ref: 'n2', lpg: 'yes', cylinder_swap: 'unknown' },
    ]);
  });

  // 🔴 THE FIRST HAND-MADE VERSION ON DEV, AND ITS WORSE COUSINS: a CHECK of
  // the right name that allows a fourth word, a DEFAULT of 'no', an index of
  // the right name on the wrong predicate, and one that is not partial at all.
  // MUTATION: `CREATE INDEX IF NOT EXISTS`, or `ADD CONSTRAINT` without the
  // DROP before it.
  it('on columns with the wrong CHECK and DEFAULT, and indexes with the wrong predicate', async () => {
    await freshTable();
    await db.query(
      `ALTER TABLE osm_route_poi
         ADD COLUMN lpg text NOT NULL DEFAULT 'no'
           CHECK (lpg IN ('banana', 'yes', 'no', 'unknown')),
         ADD COLUMN cylinder_swap text DEFAULT 'unknown'`,
    );
    await db.query(
      `CREATE INDEX idx_osm_route_poi_gas_exchange ON osm_route_poi USING GIST (location) WHERE kind = 'fuel'`,
    );
    await db.query(
      `CREATE INDEX idx_osm_route_poi_cylinder_swap ON osm_route_poi USING GIST (location)`,
    );
    // …and they are visibly wrong before `up()`, so passing afterwards is not
    // the fixture already being right
    expect((await shape('lpg')).def).toBe(`'no'::text`);
    expect((await shape('cylinder_swap')).nullable).toBe('YES');
    expect((await indexDefs()).idx_osm_route_poi_gas_exchange).toContain(
      `'fuel'`,
    );
    await new RoutePoiGas1791700000000().up(runner());
    await expectTheWantedShape();
  });

  // A value that is not one of the three words is NOT silently called
  // `unknown`: the CHECK refuses it and the migration stops. MUTATION: add
  // `UPDATE … SET c = 'unknown' WHERE c NOT IN (…)` to up().
  it('stops, and changes nothing it should not, when a column holds a fourth word', async () => {
    await freshTable();
    await db.query(
      `ALTER TABLE osm_route_poi ADD COLUMN lpg text, ADD COLUMN cylinder_swap text`,
    );
    await insertRow('n1', 'fuel', `lpg='banana'`);
    await expect(
      new RoutePoiGas1791700000000().up(runner()),
    ).rejects.toMatchObject({
      code: '23514',
    });
    expect(
      (await db.query(`SELECT lpg FROM osm_route_poi WHERE osm_ref = 'n1'`))
        .rows[0].lpg,
    ).toBe('banana');
  });

  it('twice over: the second run changes nothing and does not fail', async () => {
    await freshTable();
    await new RoutePoiGas1791700000000().up(runner());
    await insertRow('n1', 'fuel', `lpg='yes'`);
    await new RoutePoiGas1791700000000().up(runner());
    await expectTheWantedShape();
    expect(
      (await db.query(`SELECT lpg FROM osm_route_poi WHERE osm_ref = 'n1'`))
        .rows[0].lpg,
    ).toBe('yes');
  });

  it('and down() takes it all back', async () => {
    await freshTable();
    await new RoutePoiGas1791700000000().up(runner());
    await new RoutePoiGas1791700000000().down(runner());
    const left = (
      await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'osm_route_poi'
            AND column_name IN ('lpg', 'cylinder_swap')`,
      )
    ).rows;
    expect(left).toEqual([]);
    expect(await indexDefs()).toEqual({});
  });
});
