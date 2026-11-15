import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { SpotLinkRuns1797200000000 } from '../migrations/1797200000000-SpotLinkRuns';
import { applyLinks } from './reconcile-sources';

// 🔴 ТИЖДЕНЬ БЕЗ НОВИХ ЗВʼЯЗКІВ — НЕ ЗУПИНКА ЗБИРАЧА.
//
// Заміряно на проді 13.11.2026: прогін 10.11 дав «0 links written»,
// `max(spot_links.created_at)` лишився 03.11, і сторож свіжості бачив
// 9,53 доби при бюджеті 10. Тут три справжні ланки разом, а не три
// рядки-двійники: міграція, що ШИПИТЬСЯ, створює таблицю; `applyLinks`,
// що ШИПИТЬСЯ, пише мітку; запит сторожа береться з його ж файлу.
//
// `search_path = pg_temp, public` на цю сесію: і `CREATE TABLE` міграції,
// і всі читання лягають у тимчасову схему, справжні таблиці не зачеплені.
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

type Source = {
  table: string;
  column: string;
  name: string;
  unit: string | null;
};
type Mod = {
  probeSql: (s: Source, now?: number) => string;
  DB_SOURCES: readonly Source[];
};

const LAST_NEW_LINK = '2026-11-03T20:23:03Z';

let db: Client;
let mod: Mod;
let links: Source;

const probe = async () => {
  const r = await db.query(mod.probeSql(links));
  const [rows, stamp] = Object.values(
    r.rows[0] as Record<string, string | null>,
  );
  return { rows: Number(rows), stamp };
};
const migrate = () =>
  new SpotLinkRuns1797200000000().up({
    query: (sql: string) => db.query(sql),
  } as unknown as QueryRunner);
const reset = async (seed: string | null) => {
  await db.query(`DROP TABLE IF EXISTS pg_temp.spot_link_runs`);
  await db.query(`DROP TABLE IF EXISTS pg_temp.spot_links`);
  await db.query(
    `CREATE TEMP TABLE spot_links (created_at timestamptz NOT NULL)`,
  );
  if (seed) await db.query(`INSERT INTO spot_links VALUES ($1)`, [seed]);
  await migrate();
};

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  mod = (await import(SCRIPT)) as Mod;
  links = mod.DB_SOURCES.find(
    (s) => s.unit === 'camptribe-reconcile-sources',
  ) as Source;
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query(`SET search_path = pg_temp, public`);
});
afterAll(async () => {
  await db?.end();
});

describe('freshness of spot_links is the last RUN, not the last new link', () => {
  it('the guard has exactly one source fed by the reconciler unit', () => {
    expect(
      mod.DB_SOURCES.filter((s) => s.unit === 'camptribe-reconcile-sources'),
    ).toHaveLength(1);
  });

  it('🔴 the migration seeds the last known truth, not the migration date', async () => {
    await reset(LAST_NEW_LINK);
    expect(await probe()).toEqual({ rows: 1, stamp: LAST_NEW_LINK });
  });

  it('🔴 a run that writes ZERO links still makes the source fresh', async () => {
    await reset(LAST_NEW_LINK);
    const before = Date.now();
    const r = await applyLinks(db, []);
    expect(r.written).toBe(0);

    const after = await probe();
    expect(after.rows).toBe(2);
    expect(Date.parse(String(after.stamp))).toBeGreaterThanOrEqual(
      before - 1000,
    );

    // Саме та умова, за якої старий запит брехав: новий звʼязок НЕ зʼявився.
    const newest = await db.query(
      `SELECT to_char(max(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS m FROM spot_links`,
    );
    expect(newest.rows[0].m).toBe(LAST_NEW_LINK);
  });

  it('an empty spot_links seeds nothing: "never ran" stays "never ran"', async () => {
    await reset(null);
    expect(await probe()).toEqual({ rows: 0, stamp: null });
  });

  it('🔴 a run that rolls back leaves no stamp', async () => {
    await reset(LAST_NEW_LINK);
    const failing = {
      query: (sql: string, params?: unknown[]) => {
        if (/^\s*COMMIT/i.test(sql)) {
          return db.query('ROLLBACK').then(() => {
            throw new Error('commit failed');
          });
        }
        return db.query(sql, params);
      },
    };
    await expect(applyLinks(failing, [])).rejects.toThrow('commit failed');
    expect(await probe()).toEqual({ rows: 1, stamp: LAST_NEW_LINK });
  });
});

// 🔴 ЦЕ ПЕРЕВІРКА ТЕКСТУ, І ВОНА ТАК І НАЗИВАЄТЬСЯ. `main()` ходить у
// справжню базу з 57 тисячами рядків і тут не запускається; усе, що вище,
// доводить `applyLinks`. Лишається одна ланка: що `--apply` пише саме
// через неї, а не власним BEGIN/COMMIT повз мітку. Її видно лише в тексті.
describe('main() writes through applyLinks, and only through it', () => {
  const src = readFileSync(join(__dirname, 'reconcile-sources.ts'), 'utf8');
  const main = src.slice(src.indexOf('async function main()'));

  it('found main() at all', () => {
    expect(main.length).toBeGreaterThan(1000);
    expect(main.length).toBeLessThan(src.length);
  });
  it('🔴 calls applyLinks once and opens no transaction of its own', () => {
    expect(main.match(/await applyLinks\(db, auto\)/g)).toHaveLength(1);
    expect(main).not.toMatch(/writeLinks\(/);
    expect(main).not.toMatch(/query\('(BEGIN|COMMIT)'\)/);
  });
});
