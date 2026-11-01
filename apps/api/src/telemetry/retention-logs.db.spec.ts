import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

// Строк зберігання двох журналів без стану — `client_errors` (помилки
// браузера, CAMP-92) і `not_found_hits` (ненайдені адреси, CAMP-235) — на
// СПРАВЖНЬОМУ Postgres.
//
// 🔴 ЧОМУ ЦЕЙ ФАЙЛ. 01.11.2026 реєстр §4/§5 відсилав до «сторожа строків у
// CI», якого не існувало: `DELETE FROM client_errors|not_found_hits` у
// репозиторії — 0 збігів. Правила тепер у `RULES` сторожа
// scripts/ops/retention-purge.mjs і беруться ЗВІДТИ, не переписуються:
// тест, який носить власну «3», погоджувався б із автором, а не з кодом.
//
// Тимчасові таблиці з іменами справжніх затуляють їх на цю сесію (прийом
// із reports/retention.db.spec.ts). Колонки — з міграцій
// 1790140800000-ClientErrors і 1791000000000-NotFoundHits; усе, чого
// правила не торкаються, має DEFAULT, щоб кожен рядок називав лише дату.
//
// 🔴 ВІДСУТНЯ БАЗА — ПРОВАЛ, А НЕ ПРОПУСК.
//
// 🔴 ДВІ МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЛОВИТИ:
//   · `<` → `<=` в умові віку          → «рівно на межі строку ще живе» червоніє;
//   · строк однієї таблиці для іншої   → «рядок віком 2 місяці» червоніє в обох.

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
const SCRIPT = pathToFileURL(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'scripts',
    'ops',
    'retention-purge.mjs',
  ),
).href;

type Branch = {
  name: string;
  months: number;
  where: string;
  since: string;
  mark: string | null;
};
type Rule = { table: string; branches: readonly Branch[] };
type Log = { log: (s: string) => void; error: (s: string) => void };
type RunOpts = {
  now: Date;
  log: Log;
  db: (sql: string) => string[][];
  dbUrl: string;
  rules?: readonly Rule[];
};
type Mod = {
  RULES: readonly Rule[];
  runWith: (flags: Set<string>, opts: RunOpts) => number;
};

let db: Client;
let mod: Mod;
let errors: Rule;
let misses: Rule;

// Мить «зараз» зафіксована: кожна дата нижче названа відносно неї.
const NOW = new Date('2026-10-30T04:00:00Z');
const monthsAgo = (m: number) => {
  const d = new Date(NOW);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString();
};
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

// 🔴 МЕЖУ СТРОКУ ПИТАЄМО В POSTGRES, А НЕ РАХУЄМО В JS. `timestamptz −
// interval 'N months'` обчислюється в часовому поясі сесії: при
// Europe/Brussels межа «3 місяці до 2026-10-30T04:00Z» — це
// 2026-07-30T03:00Z (літній час), а не 04:00. Заміряно 01.11.2026: рядок на
// 04:00 був на годину МОЛОДШИЙ за межу, і мутація `<` → `<=` лишала тест
// зеленим. Межа береться тим самим виразом, що в `ageClause` сторожа.
const edgeOf = async (months: number) =>
  (
    await db.query(
      `SELECT $1::timestamptz - ($2 || ' months')::interval AS edge`,
      [NOW.toISOString(), String(months)],
    )
  ).rows[0].edge.toISOString() as string;
const dayBefore = (iso: string) =>
  new Date(new Date(iso).getTime() - 86_400_000).toISOString();

// Той самий синхронний драйвер, що в reports/retention.db.spec.ts: сторож
// синхронний (psql на машині), pg — ні, тож відповіді збираються за кілька
// спроб; DELETE виконується на базі рівно один раз.
async function run(
  rules: readonly Rule[],
  flags: string[] = [],
): Promise<{ code: number; lines: string[]; errors: string[] }> {
  const lines: string[] = [];
  const errs: string[] = [];
  const answers = new Map<string, string[][]>();
  for (let attempt = 0; attempt < 24; attempt++) {
    const need: { sql: string | null } = { sql: null };
    lines.length = 0;
    errs.length = 0;
    let code: number;
    try {
      code = mod.runWith(new Set(flags), {
        now: NOW,
        log: { log: (s) => lines.push(s), error: (s) => errs.push(s) },
        db: (sql) => {
          const hit = answers.get(sql);
          if (hit) return hit;
          need.sql = sql;
          throw new Error(`__need__ ${sql}`);
        },
        dbUrl: 'postgres://test',
        rules,
      });
    } catch (e) {
      if (need.sql === null) throw e;
      const r = await db.query(need.sql);
      answers.set(
        need.sql,
        r.rows.map((row: Record<string, unknown>) =>
          Object.values(row).map((v) => (v === null ? '' : String(v))),
        ),
      );
      continue;
    }
    return { code, lines, errors: errs };
  }
  throw new Error('сторож поставив більше запитів, ніж очікувалось');
}

const insertError = (receivedAt: string) =>
  db.query(`INSERT INTO client_errors (received_at) VALUES ($1) RETURNING id`, [
    receivedAt,
  ]);
const insertMiss = (createdAt: string) =>
  db.query(`INSERT INTO not_found_hits (created_at) VALUES ($1) RETURNING id`, [
    createdAt,
  ]);
const leftErrors = async () =>
  (
    await db.query(`SELECT received_at FROM client_errors ORDER BY received_at`)
  ).rows.map((r: { received_at: Date }) => r.received_at.toISOString());
const leftMisses = async () =>
  (
    await db.query(`SELECT created_at FROM not_found_hits ORDER BY created_at`)
  ).rows.map((r: { created_at: Date }) => r.created_at.toISOString());

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  mod = (await import(SCRIPT)) as Mod;
  errors = mod.RULES.find((r) => r.table === 'client_errors') as Rule;
  misses = mod.RULES.find((r) => r.table === 'not_found_hits') as Rule;
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query(
    `CREATE TEMP TABLE client_errors (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       kind varchar(16) NOT NULL DEFAULT 'error',
       message text NOT NULL DEFAULT 'TypeError: x is not a function',
       stack text,
       path varchar(512) NOT NULL DEFAULT '/campsites/x',
       source varchar(512),
       line integer,
       user_agent varchar(512) NOT NULL DEFAULT 'Mozilla/5.0',
       since_load_ms integer NOT NULL DEFAULT 0,
       fingerprint varchar(512) NOT NULL DEFAULT 'error|x|',
       received_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await db.query(
    `CREATE TEMP TABLE not_found_hits (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       path varchar(512) NOT NULL DEFAULT '/old-slug',
       referrer varchar(512),
       created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT not_found_hits_path_shape
         CHECK (path LIKE '/%' AND path NOT LIKE '%?%' AND path NOT LIKE '%#%')
     )`,
  );
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query(`DELETE FROM client_errors`);
  await db.query(`DELETE FROM not_found_hits`);
});

describe('правила беруться зі скрипта, не з цього файла', () => {
  it('обидва журнали мають рівно одну гілку, яка покриває всі рядки', () => {
    expect(errors.branches.map((b) => b.where)).toEqual(['TRUE']);
    expect(misses.branches.map((b) => b.where)).toEqual(['TRUE']);
  });
  it('і строки в них різні', () => {
    expect(errors.branches[0].months).not.toBe(misses.branches[0].months);
  });
  it('строк іде від дати запису — тієї колонки, яку індексує міграція', () => {
    expect(errors.branches[0].since).toBe('received_at');
    expect(misses.branches[0].since).toBe('created_at');
  });
});

describe('client_errors — строк від received_at', () => {
  const months = () => errors.branches[0].months;

  it('старший за строк — видаляється, молодший — лишається (обидві дати названі)', async () => {
    const old = monthsAgo(months() + 1); // 2026-06-30T04:00:00Z при 3 міс
    const fresh = monthsAgo(months() - 1); // 2026-08-30T04:00:00Z при 3 міс
    await insertError(old);
    await insertError(fresh);
    const r = await run([errors]);
    expect(r.code).toBe(0);
    expect(await leftErrors()).toEqual([fresh]);
    expect(r.lines.join('\n')).toContain('client_errors: перевірено 2 рядків');
    expect(r.lines.join('\n')).toContain(
      `усі (журнал без стану), ${months()} міс від received_at: у стані 2, прострочених 1 → видалено 1`,
    );
  });

  it('рівно на межі строку ще живе; на день старший — ні', async () => {
    const edge = await edgeOf(months()); // 2026-07-30T03:00:00Z при Europe/Brussels, 04:00 при UTC
    const older = dayBefore(edge);
    await insertError(edge);
    await insertError(older);
    const r = await run([errors]);
    expect(r.code).toBe(0);
    expect(await leftErrors()).toEqual([edge]);
  });
});

describe('not_found_hits — строк від created_at', () => {
  const months = () => misses.branches[0].months;

  it('старший за строк — видаляється, молодший (у вікні звіту, 7 діб) — лишається', async () => {
    const old = monthsAgo(months() + 1); // 2026-08-30T04:00:00Z при 1 міс
    const fresh = daysAgo(7); // 2026-10-23T04:00:00Z — те, що читає REPORT_DAYS
    await insertMiss(old);
    await insertMiss(fresh);
    const r = await run([misses]);
    expect(r.code).toBe(0);
    expect(await leftMisses()).toEqual([fresh]);
    expect(r.lines.join('\n')).toContain('not_found_hits: перевірено 2 рядків');
    expect(r.lines.join('\n')).toContain(
      `усі (журнал без стану), ${months()} міс від created_at: у стані 2, прострочених 1 → видалено 1`,
    );
  });

  it('рівно на межі строку ще живе; на день старший — ні', async () => {
    const edge = await edgeOf(months()); // 2026-09-30T03:00:00Z при Europe/Brussels, 04:00 при UTC
    const older = dayBefore(edge);
    await insertMiss(edge);
    await insertMiss(older);
    const r = await run([misses]);
    expect(r.code).toBe(0);
    expect(await leftMisses()).toEqual([edge]);
  });
});

describe('🔴 строк одного журналу не можна застосувати до іншого', () => {
  // Два місяці: за строком 404 (1) і в межах строку помилок (3). Мутація
  // «переплутали таблиці» перевертає обидва твердження.
  it('рядок віком 2 місяці: у client_errors живе, у not_found_hits — ні', async () => {
    const two = monthsAgo(2); // 2026-08-30T04:00:00Z
    expect(misses.branches[0].months).toBeLessThan(2);
    expect(errors.branches[0].months).toBeGreaterThan(2);
    await insertError(two);
    await insertMiss(two);
    const r = await run([errors, misses]);
    expect(r.code).toBe(0);
    expect(await leftErrors()).toEqual([two]);
    expect(await leftMisses()).toEqual([]);
  });
});

describe('вивід сторожа на трьох рядках у кожній таблиці', () => {
  it('видаляє прострочене, лишає свіже, і журнал каже скільки перевірено', async () => {
    await insertError(monthsAgo(6));
    await insertError(monthsAgo(4));
    await insertError(daysAgo(1));
    await insertMiss(monthsAgo(2));
    await insertMiss(daysAgo(40));
    await insertMiss(daysAgo(3));
    const r = await run([errors, misses]);
    expect(r.code).toBe(0);
    expect(await leftErrors()).toEqual([daysAgo(1)]);
    expect(await leftMisses()).toEqual([daysAgo(3)]);
    const text = r.lines.join('\n');
    expect(text).toContain(
      'client_errors: перевірено 3 рядків станом на 2026-10-30T04:00:00Z',
    );
    expect(text).toContain(
      'not_found_hits: перевірено 3 рядків станом на 2026-10-30T04:00:00Z',
    );
    expect(text).toContain(
      'таблиць 2, перевірено 6, прострочених 4, видалено 4, з них нерозглянутих 0',
    );
    expect(r.lines.some((l) => l.includes('позначка'))).toBe(false);
  });
});

describe('🔴 сторож падає, коли не зміг', () => {
  it('таблиці немає — виняток, не код 0 і не «прострочених 0»', async () => {
    await expect(
      run([{ ...errors, table: 'client_errors_nope' }]),
    ).rejects.toThrow(/client_errors_nope/);
  });

  it('порожні живі таблиці — код 0 і «перевірено 0»', async () => {
    const r = await run([errors, misses]);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('client_errors: перевірено 0 рядків');
    expect(r.lines.join('\n')).toContain('not_found_hits: перевірено 0 рядків');
  });

  it('--dry-run рахує прострочене й нічого не видаляє', async () => {
    await insertError(monthsAgo(6));
    await insertMiss(monthsAgo(2));
    const r = await run([errors, misses], ['--dry-run']);
    expect(r.code).toBe(0);
    expect(await leftErrors()).toHaveLength(1);
    expect(await leftMisses()).toHaveLength(1);
    expect(r.lines.join('\n')).toContain('прострочених 2 — сухий прогін');
  });
});
