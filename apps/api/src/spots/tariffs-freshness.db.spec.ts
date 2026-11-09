/**
 * 🔴 CAMP-446. ТАРИФ, ЯКОГО ФІД БІЛЬШЕ НЕ ДЕКЛАРУЄ, НЕ ПОТРАПЛЯЄ НА СТОРІНКУ.
 *
 * Імпорт — `INSERT … ON CONFLICT DO UPDATE`: він оновлює те, що фід
 * назвав, і ніколи не торкається того, чого фід не назвав. Тому тариф
 * переживає і зняття ціни кемпінгом, і зміну URI пропозиції, і зникнення
 * самого кемпінгу з DATAtourisme.
 *
 * Замір на проді 09.11.2026, після того як тижневий таймер відпрацював:
 * 13 560 рядків, із них 3 061 (22,6%) мають `fetched_at` від попередніх
 * прогонів — тобто фід їх уже не декларує, а читач бачив їх поруч із
 * живими.
 *
 * 🔴 ТЕСТ ВИКОНУЄ СПРАВЖНІЙ SQL ЧИТАЛЬНОГО ШЛЯХУ (`tariffsSql`,
 * `withheldTariffCountSql`), а не повторює умову своїми словами. Тест,
 * який пише власний `WHERE`, перевіряє себе.
 */
import { Client } from 'pg';
import {
  tariffsSql,
  withheldTariffCountSql,
  TARIFF_STALE_AFTER_DAYS,
} from './tariffs';

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

const SPOT = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camptar_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();

  // Лише ті колонки, які читає `tariffsSql`, із типами справжньої таблиці.
  await db.query(`
    CREATE TABLE spot_tariffs (
      id serial PRIMARY KEY,
      spot_id uuid NOT NULL,
      source_id uuid,
      source_ref text,
      offer text, mode text, policy text,
      min_price numeric(10,2), max_price numeric(10,2),
      currency text NOT NULL DEFAULT 'EUR',
      valid_from date, valid_until date,
      label text, label_lang text,
      source_updated_at date,
      created_at timestamptz NOT NULL DEFAULT now(),
      fetched_at timestamptz NOT NULL DEFAULT now());`);
});

afterAll(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

beforeEach(async () => {
  await db.query('TRUNCATE spot_tariffs');
});

/** Один рядок тарифу. `daysAgo` — наскільки `fetched_at` відстає від `base`. */
async function tariff(opts: {
  ref: string;
  dated: boolean;
  fetchedAt: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO spot_tariffs
       (spot_id, source_ref, min_price, valid_from, fetched_at)
     VALUES ($1, $2, 10.00, $3, $4)`,
    [SPOT, opts.ref, opts.dated ? '2026-04-01' : null, opts.fetchedAt],
  );
}

/** Те, що віддає читальний шлях: назви `source_ref` показаних тарифів. */
async function shown(): Promise<string[]> {
  const { rows } = await db.query(`SELECT ${tariffsSql('$1::uuid')} AS t`, [
    SPOT,
  ]);
  // `tariffsSql` не віддає source_ref назовні — звіряємо за кількістю й ціною.
  return (rows[0].t as unknown[]).map(() => 'row');
}

async function shownCount(): Promise<number> {
  return (await shown()).length;
}

async function withheldCount(): Promise<number> {
  const { rows } = await db.query(
    `SELECT ${withheldTariffCountSql('$1::uuid')} AS n`,
    [SPOT],
  );
  return rows[0].n as number;
}

const DAY = 24 * 60 * 60 * 1000;
const at = (base: Date, daysAgo: number) =>
  new Date(base.getTime() - daysAgo * DAY).toISOString();

test('🔴 поріг рахується від max(fetched_at), і тариф, не підтверджений 30 діб, зникає', async () => {
  const base = new Date('2026-11-09T06:00:00Z');
  await tariff({ ref: 'fresh', dated: true, fetchedAt: at(base, 0) });
  await tariff({ ref: 'week', dated: true, fetchedAt: at(base, 7) });
  await tariff({ ref: 'month', dated: true, fetchedAt: at(base, 30) });

  expect(await shownCount()).toBe(2);
});

test('🔴 ЖОДЕН рядок не зникає тільки через те, що імпорт давно не біг', async () => {
  // Усі три однаково старі — тобто таймер мовчить, але фід нічого не
  // знімав. Поріг від `now()` сховав би ВСЮ таблицю; поріг від
  // max(fetched_at) не ховає нічого. Саме цей випадок коштував би
  // кожної ціни на кожній сторінці.
  const base = new Date('2026-11-09T06:00:00Z');
  for (const ref of ['a', 'b', 'c']) {
    await tariff({ ref, dated: true, fetchedAt: at(base, 60) });
  }
  expect(await shownCount()).toBe(3);
});

test(`🔴 межа рівно на ${TARIFF_STALE_AFTER_DAYS} добах: на ній лишається, за нею — ні`, async () => {
  // 🔴 МЕЖА БЕРЕТЬСЯ З БАЗИ, А НЕ РАХУЄТЬСЯ ТУТ, І ЦЕ НЕ ПЕДАНТИЗМ.
  //
  // Перша редакція цього тесту ставила рядок на `base − 21 доба`,
  // порахований у JS. Мутація `>=` → `>` його НЕ почервонила: у
  // PostgreSQL `timestamptz - interval '21 days'` рахується в часовій
  // зоні сеансу, і 21 доба назад від 09.11.2026 перетинає перехід на
  // зимовий час — межа в базі виявлялась на годину збоку від моєї, тож
  // рядок у жодному разі на неї не потрапляв. Тест був зелений і
  // перевіряв не те.
  //
  // Тепер межу питаємо в бази тим самим виразом, що й код, і ставимо
  // рядок РІВНО на неї. Тоді різниця між `>=` і `>` — це рівно цей рядок.
  const base = new Date('2026-11-09T06:00:00Z');
  await tariff({ ref: 'newest', dated: true, fetchedAt: base.toISOString() });

  const { rows } = await db.query(
    `SELECT (SELECT max(fetched_at) FROM spot_tariffs)
            - interval '${TARIFF_STALE_AFTER_DAYS} days' AS edge`,
  );
  const edge: Date = rows[0].edge;
  await tariff({
    ref: 'on-the-line',
    dated: true,
    fetchedAt: edge.toISOString(),
  });
  await tariff({
    ref: 'past-the-line',
    dated: true,
    fetchedAt: new Date(edge.getTime() - 1000).toISOString(),
  });

  expect(await shownCount()).toBe(2);
});

test('🔴 CAMP-475: недатована свіжа ціна ПОКАЗУЄТЬСЯ, застаріла — ні, і прихованих більше немає', async () => {
  // Рішення власника 09.11.2026. Речення «The source publishes N further
  // prices … with no validity period» зі сторінки зникло разом із самим
  // приховуванням: недатований свіжий рядок тепер видно, з позначкою
  // «Season not stated» і нотою про джерело ціни.
  //
  // 🔴 А застарілий рядок і далі не показується й не рахується ніде: про
  // те, чого джерело БІЛЬШЕ НЕ ПУБЛІКУЄ, будь-яке речення хибне.
  const base = new Date('2026-11-09T06:00:00Z');
  await tariff({ ref: 'shown', dated: true, fetchedAt: at(base, 0) });
  await tariff({ ref: 'undated-fresh', dated: false, fetchedAt: at(base, 0) });
  await tariff({ ref: 'undated-stale', dated: false, fetchedAt: at(base, 30) });
  await tariff({ ref: 'dated-stale', dated: true, fetchedAt: at(base, 30) });

  // Двоє свіжих — датований і недатований. Двоє застарілих — ні.
  expect(await shownCount()).toBe(2);
  // Категорія «приховано» спорожніла: ховати за відсутність дати ми
  // перестали, а застарілий рядок сюди ніколи й не рахувався.
  expect(await withheldCount()).toBe(0);
});
