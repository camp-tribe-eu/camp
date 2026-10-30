import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

// Строк зберігання `problem_reports` — на СПРАВЖНЬОМУ Postgres.
//
// Правила (12 місяців від закриття, 24 для нерозглянутих) живуть в одному
// місці — `RULES` у scripts/ops/retention-purge.mjs — і сюди беруться
// звідти, не копіюються: тест, який носить власну «12», погоджувався б із
// автором, а не з кодом. Що саме та умова робить із рядками, вирішує
// Postgres, тож запит, який їде на машину, тут біжить проти таблиці.
//
// Тимчасова таблиця з іменем справжньої затуляє її на цю сесію (той самий
// прийом, що в fuel/freshness-probe.db.spec.ts). Її форма — колонки з
// міграції 1793300000000-ProblemReports (PR #379): id, status, reviewed_at,
// created_at — усе, до чого торкаються правила. CHECK на status навмисно
// не повторено: один випадок нижче перевіряє, що робить сторож із станом,
// якого правила не знають.
//
// 🔴 ВІДСУТНЯ БАЗА — ПРОВАЛ, А НЕ ПРОПУСК (див. account.db.spec.ts).
//
// 🔴 ДВІ МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЛОВИТИ:
//   · сторож при помилці бази повертає 0  → «таблиці немає — виняток» червоніє;
//   · 12 місяців для обох станів            → «нерозглянута 18 міс — живе» червоніє.

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
let rule: Rule;

// Мить «зараз» зафіксована: кожна дата нижче названа відносно неї.
const NOW = new Date('2026-10-30T04:00:00Z');
const monthsAgo = (m: number) => {
  const d = new Date(NOW);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString();
};

// 🔴 Сторож синхронний (psql на машині), а pg — асинхронний. Тому запити
// збираються наперед: один прогін = спершу всі SELECT, потім DELETE за
// тим самим текстом. Виконуємо їх по черзі через невеликий драйвер, який
// віддає сторожу відповіді синхронно з уже виконаних запитів.
async function run(
  flags: string[] = [],
  rules?: readonly Rule[],
): Promise<{ code: number; lines: string[]; errors: string[] }> {
  const lines: string[] = [];
  const errors: string[] = [];
  const answers = new Map<string, string[][]>();
  // Повторюємо прогін, поки сторож не отримає відповідь на КОЖЕН запит,
  // який поставив; між спробами виконуємо на базі те, чого ще не було.
  // DELETE виконується на базі рівно один раз — відповідь кешується.
  for (let attempt = 0; attempt < 16; attempt++) {
    const need: { sql: string | null } = { sql: null };
    lines.length = 0;
    errors.length = 0;
    let code: number;
    try {
      code = mod.runWith(new Set(flags), {
        now: NOW,
        log: { log: (s) => lines.push(s), error: (s) => errors.push(s) },
        db: (sql) => {
          const hit = answers.get(sql);
          if (hit) return hit;
          need.sql = sql;
          throw new Error(`__need__ ${sql}`);
        },
        dbUrl: 'postgres://test',
        ...(rules ? { rules } : {}),
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
    return { code, lines, errors };
  }
  throw new Error('сторож поставив більше запитів, ніж очікувалось');
}

const statuses = async () =>
  (
    await db.query(
      `SELECT status, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM problem_reports ORDER BY created_at`,
    )
  ).rows.map((r: { status: string; m: string }) => `${r.status}@${r.m}`);

const insert = (status: string, createdAt: string, reviewedAt: string | null) =>
  db.query(
    `INSERT INTO problem_reports (status, created_at, reviewed_at) VALUES ($1, $2, $3) RETURNING id`,
    [status, createdAt, reviewedAt],
  );

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  mod = (await import(SCRIPT)) as Mod;
  rule = mod.RULES.find((r) => r.table === 'problem_reports') as Rule;
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query(
    `CREATE TEMP TABLE problem_reports (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       status text NOT NULL DEFAULT 'new',
       reviewed_at timestamptz,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query(`DELETE FROM problem_reports`);
});

describe('правила беруться зі скрипта, не з цього файла', () => {
  it('problem_reports має гілку для закритих і для нерозглянутих', () => {
    expect(rule.branches.map((b) => b.name).sort()).toEqual(['closed', 'open']);
  });
  it('і строки в них різні', () => {
    const [a, b] = rule.branches.map((b) => b.months);
    expect(a).not.toBe(b);
  });
});

describe('закрита заявка — строк від закриття', () => {
  const months = () =>
    (rule.branches.find((b) => b.name === 'closed') as Branch).months;

  it('старша за строк — видаляється, молодша — лишається (обидві з датами)', async () => {
    await insert('resolved', monthsAgo(months() + 3), monthsAgo(months() + 1)); // закрита 13 міс тому
    await insert('dismissed', monthsAgo(months() + 1), monthsAgo(months() - 1)); // закрита 11 міс тому
    const r = await run();
    expect(r.code).toBe(0);
    expect(await statuses()).toEqual([
      `dismissed@${monthsAgo(months() + 1).slice(0, 7)}`,
    ]);
    expect(r.lines.join('\n')).toContain('перевірено 2 рядків');
    expect(r.lines.join('\n')).toContain('→ видалено 1');
  });

  it('рівно на межі строку ще живе; на день старша — ні', async () => {
    const edge = new Date(NOW);
    edge.setUTCMonth(edge.getUTCMonth() - months());
    const older = new Date(edge.getTime() - 86_400_000);
    await insert('resolved', monthsAgo(months() + 2), edge.toISOString());
    await insert('resolved', monthsAgo(months() + 2), older.toISOString());
    const r = await run();
    expect(r.code).toBe(0);
    const left = await db.query(`SELECT reviewed_at FROM problem_reports`);
    expect(left.rows).toHaveLength(1);
    expect(new Date(left.rows[0].reviewed_at).toISOString()).toBe(
      edge.toISOString(),
    );
  });

  it('закрита без дати закриття рахується від створення — не пізніше, ніж від закриття', async () => {
    await insert('resolved', monthsAgo(months() + 1), null);
    const r = await run();
    expect(r.code).toBe(0);
    expect(await statuses()).toEqual([]);
  });
});

describe('🔴 нерозглянута і закрита — різні гілки, не одна константа', () => {
  // 18 місяців: за строком для закритих (12) і в межах строку для
  // нерозглянутих (24). Мутація «12 для обох» видаляє обидві — і червонить
  // перший випадок.
  it('нерозглянута заявка віком 18 місяців живе, закрита того ж віку — ні', async () => {
    await insert('new', monthsAgo(18), null);
    await insert('resolved', monthsAgo(18), monthsAgo(18));
    const r = await run();
    expect(r.code).toBe(0);
    expect(await statuses()).toEqual([`new@${monthsAgo(18).slice(0, 7)}`]);
  });

  it('нерозглянута старша за свій строк видаляється — з позначкою в журналі', async () => {
    const open = rule.branches.find((b) => b.name === 'open') as Branch;
    const { rows } = await insert('new', monthsAgo(open.months + 1), null);
    const r = await run();
    expect(r.code).toBe(0);
    expect(await statuses()).toEqual([]);
    const mark = r.lines.find((l) => l.includes('позначка'));
    expect(mark).toBeDefined();
    expect(mark).toContain(rows[0].id);
    expect(mark).toContain(open.mark as string);
  });

  it('нерозглянута молодша за свій строк живе — і позначки немає', async () => {
    const open = rule.branches.find((b) => b.name === 'open') as Branch;
    await insert('new', monthsAgo(open.months - 1), null);
    const r = await run();
    expect(r.code).toBe(0);
    expect(await statuses()).toHaveLength(1);
    expect(r.lines.some((l) => l.includes('позначка'))).toBe(false);
  });
});

describe('вивід сторожа на трьох рядках: закрита прострочена, нерозглянута прострочена, свіжа', () => {
  it('видаляє дві, лишає одну, і журнал каже скільки перевірено', async () => {
    await insert('resolved', monthsAgo(14), monthsAgo(13));
    await insert('new', monthsAgo(25), null);
    await insert('new', monthsAgo(1), null);
    const r = await run();
    expect(r.code).toBe(0);
    expect(await statuses()).toEqual([`new@${monthsAgo(1).slice(0, 7)}`]);
    const text = r.lines.join('\n');
    expect(text).toContain(
      'problem_reports: перевірено 3 рядків станом на 2026-10-30T04:00:00Z',
    );
    expect(text).toContain('закриті (resolved/dismissed), 12 міс');
    expect(text).toContain('у стані 1, прострочених 1 → видалено 1');
    expect(text).toContain('нерозглянуті (new), 24 міс');
    expect(text).toContain('у стані 2, прострочених 1 → видалено 1');
    expect(text).toContain(
      'перевірено 3, прострочених 2, видалено 2, з них нерозглянутих 1',
    );
  });
});

describe('🔴 сторож падає, коли не зміг', () => {
  it('таблиці немає — виняток, не код 0 і не «прострочених 0»', async () => {
    const rules: Rule[] = [{ ...rule, table: 'problem_reports_nope' }];
    await expect(run([], rules)).rejects.toThrow(/problem_reports_nope/);
  });

  it('стан, якого правила не знають — код 1, і прострочене НЕ видалене', async () => {
    await insert('archived', monthsAgo(30), monthsAgo(30));
    await insert('resolved', monthsAgo(14), monthsAgo(13));
    const r = await run();
    expect(r.code).toBe(1);
    expect(r.errors.join('\n')).toContain('є стан без строку');
    expect(await statuses()).toHaveLength(2);
  });

  it('порожня жива таблиця — код 0 і «перевірено 0»', async () => {
    const r = await run();
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('перевірено 0 рядків');
    expect(r.lines.join('\n')).toContain('прострочених 0');
  });
});

describe('--dry-run', () => {
  it('рахує прострочене, нічого не видаляє, код 0', async () => {
    await insert('resolved', monthsAgo(14), monthsAgo(13));
    await insert('new', monthsAgo(25), null);
    const r = await run(['--dry-run']);
    expect(r.code).toBe(0);
    expect(await statuses()).toHaveLength(2);
    expect(r.lines.join('\n')).toContain('прострочених 2 — сухий прогін');
  });
});
