import { Client } from 'pg';
import { DataSource } from 'typeorm';
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

const DB_URL =
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
  db = new Client({ connectionString: DB_URL });
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

  // 🔴 `down()` ON ITS OWN. The test above runs `up()` first, which creates
  // the indexes in the table's own schema — so a bare `DROP INDEX IF EXISTS`
  // in `down()` alone found them there and never reached the decoy. The review
  // reproduced the incident through `down()` exactly this way, with the table's
  // indexes absent. MUTATION: an unqualified `DROP INDEX` in down() only.
  it('down() alone: the decoy keeps both of its indexes', async () => {
    const before = await decoyWithTheWholeResult();
    await freshTable(); // the table has none of the indexes
    await db.query(`SET search_path = ${schema}, ${decoy}, public`);
    await new RoutePoiGas1791700000000().down(runner());
    expect(await indexesOf(decoy)).toEqual(before);
  });

  // 🔴 AN INDEX OF THAT NAME ON ANOTHER TABLE OF THE SAME SCHEMA. Qualifying
  // the drop by schema does not stop it; production has one schema, so this is
  // the form of the incident that can still happen there. The migration must
  // leave it alone and stop loudly on the taken name. MUTATION: drop by
  // schema and name only (`DROP INDEX %I.%I` without the table).
  it.each([
    'idx_osm_route_poi_gas_exchange',
    'idx_osm_route_poi_cylinder_swap',
  ])(
    'up(): an index %s on ANOTHER table of the same schema survives, and the migration stops',
    async (name) => {
      await freshTable();
      await db.query(
        `CREATE TABLE other_table (id int, location geometry(Point, 4326))`,
      );
      await db.query(
        `CREATE INDEX ${name} ON other_table USING GIST (location)`,
      );
      await expect(
        new RoutePoiGas1791700000000().up(runner()),
      ).rejects.toMatchObject({
        code: '42P07', // duplicate_table: the name is taken
      });
      const left = (
        await db.query(
          `SELECT tablename FROM pg_indexes
            WHERE schemaname = current_schema() AND indexname = $1`,
          [name],
        )
      ).rows;
      expect(left).toEqual([{ tablename: 'other_table' }]);
    },
  );

  it('down(): an index of that name on another table of the same schema survives', async () => {
    await freshTable();
    await db.query(
      `CREATE TABLE other_table (id int, location geometry(Point, 4326))`,
    );
    await db.query(
      `CREATE INDEX idx_osm_route_poi_gas_exchange ON other_table USING GIST (location)`,
    );
    await new RoutePoiGas1791700000000().down(runner());
    expect(
      (
        await db.query(
          `SELECT tablename FROM pg_indexes
            WHERE schemaname = current_schema() AND indexname = 'idx_osm_route_poi_gas_exchange'`,
        )
      ).rows,
    ).toEqual([{ tablename: 'other_table' }]);
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

  // 🔴 THE REVIEW'S TWO COUNTER-EXAMPLES TO "WHATEVER STATE".
  //
  // (a) `lpg char(10)`: `up()` succeeded and the values read back padded,
  //     `'unknown   '`. MUTATION: take the `TYPE text` step out of up().
  it('on a column of the wrong TYPE: char(10) becomes text, and the padding goes', async () => {
    await freshTable();
    await db.query(
      `ALTER TABLE osm_route_poi ADD COLUMN lpg char(10), ADD COLUMN cylinder_swap text`,
    );
    await insertRow('n1', 'fuel', `lpg='unknown'`);
    await insertRow('n2', 'fuel', `lpg='yes'`);
    await new RoutePoiGas1791700000000().up(runner());
    expect(
      (
        await db.query(
          `SELECT data_type FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'osm_route_poi'
              AND column_name = 'lpg'`,
        )
      ).rows[0].data_type,
    ).toBe('text');
    expect(
      (await db.query(`SELECT osm_ref, lpg FROM osm_route_poi ORDER BY 1`))
        .rows,
    ).toEqual([
      { osm_ref: 'n1', lpg: 'unknown' }, // not 'unknown   '
      { osm_ref: 'n2', lpg: 'yes' },
    ]);
    await expectTheWantedShape();
  });

  // (b) a CHECK of ANOTHER NAME: `up()` succeeded, and then every default
  //     INSERT failed with 23514. MUTATION: drop only the canonical name.
  it('on a column with a CHECK of another name: it is dropped, and a default INSERT works', async () => {
    await freshTable();
    await db.query(
      `ALTER TABLE osm_route_poi
         ADD COLUMN lpg text NOT NULL DEFAULT 'no',
         ADD COLUMN cylinder_swap text`,
    );
    await db.query(
      `ALTER TABLE osm_route_poi ADD CONSTRAINT lpg_legacy_values
         CHECK (lpg IN ('banana', 'yes'))`,
    );
    await new RoutePoiGas1791700000000().up(runner());
    expect(
      (
        await db.query(
          `SELECT conname FROM pg_constraint
            WHERE conrelid = 'osm_route_poi'::regclass AND conname = 'lpg_legacy_values'`,
        )
      ).rows,
    ).toEqual([]);
    await expectTheWantedShape(); // includes a default INSERT and 'banana' refused
  });

  // A CHECK that is about this column AND another is not ours and stays.
  it('leaves a CHECK that is about more than the one column alone', async () => {
    await freshTable();
    await db.query(
      `ALTER TABLE osm_route_poi ADD COLUMN lpg text, ADD COLUMN cylinder_swap text`,
    );
    await db.query(
      `ALTER TABLE osm_route_poi ADD CONSTRAINT lpg_or_country
         CHECK (lpg IS NOT NULL OR country = 'si')`,
    );
    await new RoutePoiGas1791700000000().up(runner());
    expect(
      (
        await db.query(
          `SELECT conname FROM pg_constraint
            WHERE conrelid = 'osm_route_poi'::regclass AND conname = 'lpg_or_country'`,
        )
      ).rows,
    ).toEqual([{ conname: 'lpg_or_country' }]);
  });

  // Wrong types that cannot be made right end LOUDLY, and nothing is changed
  // (see the transaction test below for the "nothing changed" half).
  it.each([
    ['boolean', 'true'],
    ['integer', '1'],
  ])('a %s column ends the migration loudly', async (type, value) => {
    await freshTable();
    await db.query(
      `ALTER TABLE osm_route_poi ADD COLUMN lpg ${type}, ADD COLUMN cylinder_swap text`,
    );
    await db.query(
      `INSERT INTO osm_route_poi (osm_ref, kind, location, country, lpg)
       VALUES ('n1', 'fuel', ${point}, 'si', ${value})`,
    );
    await expect(
      new RoutePoiGas1791700000000().up(runner()),
    ).rejects.toMatchObject({
      code: '23514', // check_violation: 'true' / '1' are not one of the three words
    });
  });

  // 🔴 NO REWRITE WHEN THE COLUMN IS ALREADY RIGHT. `ALTER COLUMN … TYPE text`
  // on a `text` column must not copy 2.27 million rows. The relation's file
  // node changes when a table is rewritten; it is read before and after.
  // MUTATION: `TYPE text USING lpg::varchar(7)` or any change of type.
  it('does not rewrite the table when the columns are already right', async () => {
    await freshTable();
    await new RoutePoiGas1791700000000().up(runner());
    await insertRow('n1', 'fuel', `lpg='yes'`);
    const node = async () =>
      (await db.query(`SELECT pg_relation_filenode('osm_route_poi') AS f`))
        .rows[0].f;
    const before = await node();
    await new RoutePoiGas1791700000000().up(runner());
    expect(await node()).toBe(before);
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

// ── ONE TRANSACTION, THROUGH TYPEORM'S OWN EXECUTOR ─────────────────────────
//
// 🔴 THE SHIM ABOVE IS NOT TRANSACTIONAL: it sends each statement on its own,
// so it cannot say what the production run depends on — that an `up()` which
// fails in the middle leaves NOTHING behind. TypeORM runs a pending migration
// inside a transaction by default, and every statement here is transactional
// (no CONCURRENTLY, no VACUUM), but "by default" and "by construction" are not
// the same as shown. So this runs `up()` through a real DataSource's
// `runMigrations()` — the code that production runs — against a table in the
// state that makes it fail LATE: `lpg` holds a fourth word (the CHECK, which
// comes after the first column and the second column's ADD COLUMN and after
// every index was dropped, refuses it), and asks what is left.
//
// MUTATION: `transaction: 'none'` in the DataSource, or a statement that
// cannot run in a transaction in up().
describe('RoutePoiGas through TypeORM: a migration that fails in the middle leaves nothing behind', () => {
  it('rolls back the second column, the dropped indexes and the migrations row', async () => {
    await freshTable();
    // the table already HAS indexes of ours, so a dropped one would show
    await db.query(
      `CREATE INDEX idx_osm_route_poi_gas_exchange ON osm_route_poi USING GIST (location) WHERE kind = 'fuel'`,
    );
    await db.query(`ALTER TABLE osm_route_poi ADD COLUMN lpg text`);
    await insertRow('n1', 'fuel', `lpg='banana'`);
    const before = {
      columns: (
        await db.query(
          `SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'osm_route_poi'
            ORDER BY ordinal_position`,
        )
      ).rows,
      indexes: await indexDefs(),
    };

    const url = new URL(DB_URL);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    const ds = new DataSource({
      type: 'postgres',
      url: url.toString(),
      schema,
      migrations: [RoutePoiGas1791700000000],
      migrationsTableName: 'migrations',
      logging: false,
      migrationsTransactionMode: 'all',
    });
    await ds.initialize();
    try {
      await expect(ds.runMigrations()).rejects.toMatchObject({ code: '23514' });
    } finally {
      await ds.destroy();
    }

    const after = {
      columns: (
        await db.query(
          `SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'osm_route_poi'
            ORDER BY ordinal_position`,
        )
      ).rows,
      indexes: await indexDefs(),
    };
    // no `cylinder_swap` column, `lpg` still nullable, the index still the old one
    expect(after).toEqual(before);
    expect(after.columns.map((c) => c.column_name)).not.toContain(
      'cylinder_swap',
    );
    // and the run is NOT recorded as done
    expect(
      (
        await db.query(
          `SELECT count(*)::int AS n FROM migrations WHERE name = 'RoutePoiGas1791700000000'`,
        )
      ).rows[0].n,
    ).toBe(0);
  });

  // …and the same migration, through the same executor, on a good table, IS
  // recorded: the test above is not a DataSource that never runs anything.
  it('and records itself when it succeeds', async () => {
    await freshTable();
    const url = new URL(DB_URL);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    const ds = new DataSource({
      type: 'postgres',
      url: url.toString(),
      schema,
      migrations: [RoutePoiGas1791700000000],
      migrationsTableName: 'migrations',
      logging: false,
    });
    await ds.initialize();
    try {
      const ran = await ds.runMigrations();
      expect(ran.map((m) => m.name)).toEqual(['RoutePoiGas1791700000000']);
    } finally {
      await ds.destroy();
    }
    await expectTheWantedShape();
    expect(
      (
        await db.query(
          `SELECT count(*)::int AS n FROM migrations WHERE name = 'RoutePoiGas1791700000000'`,
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
