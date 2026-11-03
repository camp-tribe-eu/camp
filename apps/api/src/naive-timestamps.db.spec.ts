import { Client } from 'pg';

// CAMP-433 / CAMP-338 — жодної колонки `timestamp without time zone`.
//
// 🔴 ЧОМУ ЦЕ ОКРЕМИЙ ТЕСТ, А НЕ ПЕРЕВІРКА ВСЕРЕДИНІ МІГРАЦІЇ.
//
// Міграція вже перевіряє себе й падає, якщо хоч одна колонка лишилась
// наївною. Але вона виконується ОДИН раз. Наступна міграція, що додасть
// `@CreateDateColumn` без `type: 'timestamptz'`, поверне проблему — і
// жодна стара перевірка про це не дізнається.
//
// 🔴 ЦІНА НАЇВНОЇ КОЛОНКИ, ЗАМІРЯНА 16.10.2026. Той самий архів
// вивантаження ніс `15:41:06.060` (без зони) і `13:41:06.068Z` для
// ОДНІЄЇ події: різниця рівно дві години, бо ноутбук у CEST, а сервер в
// UTC. Це потрапляє у файл, який людина завантажує за статтею 15.
//
// A MISSING DATABASE IS A FAILURE, NOT A SKIP.

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

let db: Client;

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
    );
  }
  db = new Client({ connectionString: URL });
  await db.connect();
});

afterAll(async () => {
  if (db) await db.end();
});

describe('жодної наївної мітки часу', () => {
  it('🔴 information_schema не знає колонок без зони', async () => {
    const { rows } = await db.query<{ col: string }>(`
      SELECT table_name || '.' || column_name AS col
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'timestamp without time zone'
       ORDER BY 1
    `);
    expect(rows.map((r) => r.col)).toEqual([]);
  });

  it('🔴 і це не порожній запит: колонки з зоною в базі Є', async () => {
    // Без цього випадку перший лишився б зеленим на базі без жодної
    // таблиці — тобто на порожнечі, а не на доведеній відсутності.
    const { rows } = await db.query<{ n: string }>(`
      SELECT count(*)::text AS n
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'timestamp with time zone'
    `);
    expect(Number(rows[0].n)).toBeGreaterThan(20);
  });

  it('🔴 пояс сесії прибитий до UTC', async () => {
    // Колонка з зоною зберігає мить правильно за будь-якого поясу, але
    // читається вона ЧЕРЕЗ пояс сесії. `db-session.ts` прибиває його до
    // UTC; якщо це відкотять, числа в архіві вивантаження поїдуть знову.
    const probe = new Client({
      connectionString: URL,
      options: '-c timezone=UTC',
    });
    await probe.connect();
    try {
      // 🔴 `current_setting`, а не `SHOW timezone`: той віддає колонку з
      // іменем `TimeZone`, і читання `rows[0].tz` дало `undefined` —
      // тобто перевірка впала не на поясі, а на моєму припущенні про
      // імʼя колонки. Тут імʼя задаємо самі.
      const { rows } = await probe.query<{ tz: string }>(
        `SELECT current_setting('TimeZone') AS tz`,
      );
      expect(rows[0].tz).toBe('UTC');
    } finally {
      await probe.end();
    }
  });
});
