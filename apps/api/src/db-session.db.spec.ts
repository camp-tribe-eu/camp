import { Client } from 'pg';
import { PG_SESSION_OPTIONS } from './db-session';

// 🔴 CAMP-338. ЦЕЙ ТЕСТ ІСНУЄ ТОМУ, ЩО ЙОГО НЕ БУЛО, І ДЕФЕКТ ЖИВ.
//
// Наївна колонка (`timestamp without time zone`) зберігає місцевий час
// ТІЄЇ машини, що писала рядок, а `::timestamptz` читає його через пояс
// СЕСІЇ. На ноуті в Europe/Brussels і на проді в UTC та сама мить дає
// різні значення — різниця дві години.
//
// Картка просила дослівно: «тест, що задає сесії `SET TimeZone = 'UTC'`
// і `'Europe/Brussels'` і доводить, що записане значення однакове.
// Сьогодні такий тест червоний — саме тому він і потрібен».
//
// Ось він. Зелений він лише тому, що `PG_SESSION_OPTIONS` закріплює
// пояс; приберіть їх із зʼєднання — і третій випадок почервоніє.

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
const PROBE = 'camp338_probe';

const connect = async (opts: { pinned: boolean; tz: string }) => {
  const c = new Client({
    connectionString: URL,
    ...(opts.pinned ? { options: PG_SESSION_OPTIONS } : {}),
  });
  await c.connect();
  if (!opts.pinned) await c.query(`SET TimeZone = '${opts.tz}'`);
  return c;
};

describe('🔴 пояс сесії задаємо ми, а не машина', () => {
  let setup: Client;

  beforeAll(async () => {
    if (!URL) {
      throw new Error('set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL)');
    }
    setup = await connect({ pinned: true, tz: 'UTC' });
    // Власна схема: проба з DDL не торкається `public`.
    await setup.query(`DROP SCHEMA IF EXISTS ${PROBE} CASCADE`);
    await setup.query(`CREATE SCHEMA ${PROBE}`);
    await setup.query(`CREATE TABLE ${PROBE}.t (ts timestamp NOT NULL)`);
    await setup.query(
      `INSERT INTO ${PROBE}.t (ts) VALUES (TIMESTAMP '2026-07-01 12:00:00')`,
    );
  });

  afterAll(async () => {
    await setup?.query(`DROP SCHEMA IF EXISTS ${PROBE} CASCADE`);
    await setup?.end();
  });

  const epochOf = async (c: Client) => {
    const r = await c.query<{ e: string }>(
      // `::text` на extract дає «1782907200.000000» — порівнюємо числом,
      // а не рядком, щоб тест не падав на формі запису.
      `SELECT extract(epoch FROM ts::timestamptz)::bigint::text AS e FROM ${PROBE}.t`,
    );
    return r.rows[0].e;
  };

  it('🔴 БЕЗ закріплення той самий рядок читається як різні миті', async () => {
    // Негативний контроль. Без нього «значення однакові» так само вірно
    // для перевірки, яка нічого не порівнює: саме цей випадок доводить,
    // що пояс сесії справді на щось впливає.
    const utc = await connect({ pinned: false, tz: 'UTC' });
    const bru = await connect({ pinned: false, tz: 'Europe/Brussels' });
    try {
      expect(await epochOf(utc)).not.toBe(await epochOf(bru));
    } finally {
      await utc.end();
      await bru.end();
    }
  });

  // 🔴 ОЧІКУВАННЯ АБСОЛЮТНЕ, А НЕ «ОБИДВА ОДНАКОВІ».
  //
  // Перша редакція порівнювала два закріплені зʼєднання між собою — і
  // мутація «прибрати закріплення» її НЕ червонила: без параметрів
  // обидва однаково зсувались до пояса сервера (на цьому ноуті
  // `Europe/Brussels`), тобто лишались рівними одне одному.
  //
  // Заміряно: `SHOW TimeZone` без параметрів → `Europe/Brussels`,
  // з параметрами → `UTC`. Тому тут стоїть та мить, якою рядок МАЄ
  // читатись, а не рівність двох однаково зіпсованих читань.
  it('🔴 ІЗ закріпленням рядок читається саме як UTC', async () => {
    const expected = String(Date.UTC(2026, 6, 1, 12, 0, 0) / 1000);
    for (const tz of ['UTC', 'Europe/Brussels']) {
      const c = await connect({ pinned: true, tz });
      try {
        expect(await epochOf(c)).toBe(expected);
      } finally {
        await c.end();
      }
    }
  });

  it('закріплене зʼєднання повідомляє саме UTC', async () => {
    const c = await connect({ pinned: true, tz: 'Europe/Brussels' });
    try {
      const r = await c.query<{ TimeZone: string }>('SHOW TimeZone');
      expect(r.rows[0].TimeZone).toBe('UTC');
    } finally {
      await c.end();
    }
  });
});
