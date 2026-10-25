import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { AccountRightsService } from '../auth/account-rights.service';
import { AccountService, MAILER } from '../auth/account.service';
import { DevMailbox, MailMessage, MailSender } from '../auth/mail';
import { hashPassword } from '../auth/password';
import { ConsentRecord } from '../entities/consent-record.entity';
import { WarningsService } from '../warnings/warnings.service';
import { currentWording, wordingAt } from './wordings';

// CAMP-390 — журнал згод проти СПРАВЖНЬОЇ бази й СПРАВЖНЬОГО застосунку.
//
// Усе, що журнал обіцяє, — про рядки, які лишаються в базі, і про те, чого
// база не дозволить; мок цього не побачив би. Той самий стенд, що й
// `account-settings.db.spec.ts`: власна база `camp390_<pid>_<час>`, усі
// міграції, прибирається за собою.
//
// 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПРОВАЛ, А НЕ ПРОПУСК. Потрібен CAMP_TEST_DATABASE_URL
// (локально) або CI_DATABASE_URL.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

const THIS_MIGRATION = '1792900000000-ConsentRecord.ts';

let admin: Client;
let db: Client;
let dbName: string;
const extraDbs: string[] = [];
let app: INestApplication;
let base: string;

const box = new DevMailbox(() => undefined);
const sender: MailSender = {
  async send(m: MailMessage) {
    await box.send(m);
  },
};

const noWarnings = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
  current: () => ({}),
  callsLastCycle: () => 0,
};

type Runner = {
  up(q: QueryRunner): Promise<void>;
  down(q: QueryRunner): Promise<void>;
};

async function migrations(): Promise<Array<{ file: string; m: Runner }>> {
  const dir = join(__dirname, '..', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const out: Array<{ file: string; m: Runner }> = [];
  for (const file of files) {
    const mod = await import(join(dir, file));
    const Migration = Object.values(mod).find(
      (v): v is new () => Runner =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!Migration) throw new Error(`no migration class in ${file}`);
    out.push({ file, m: new Migration() });
  }
  return out;
}

const runnerOf = (client: Client) =>
  ({
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  }) as unknown as QueryRunner;

/** Усі міграції, крім (за бажанням) тих, чиє імʼя зазначено. */
async function migrate(client: Client, skip: string[] = []): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await client.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  for (const { file, m } of await migrations())
    if (!skip.includes(file)) await m.up(runnerOf(client));
}

async function scratch(prefix: string): Promise<{ name: string; url: string }> {
  const name = `${prefix}_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${name}`);
  extraDbs.push(name);
  const url = new URL(ADMIN_URL as string);
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const main = await scratch('camp390');
  dbName = main.name;
  db = new Client({ connectionString: main.url });
  await db.connect();
  await migrate(db);

  process.env.DATABASE_URL = main.url;
  process.env.TRUST_PROXY_CLIENT_IP = '1';
  const { AppModule } = await import('../app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue({ sender, webBase: 'https://site.example' })
    .overrideProvider(WarningsService)
    .useValue(noWarnings)
    .compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  base = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  await db?.end();
  if (admin) {
    for (const name of [dbName, ...extraDbs])
      if (name)
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});

let callers = 0;
const nextCaller = () => `198.51.100.${(callers++ % 250) + 1}`;

type Reply = { status: number; json: any; text: string };

async function send(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Reply> {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      'cf-connecting-ip': nextCaller(),
      ...headers,
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

const post = (p: string, b: unknown, h: Record<string, string> = {}) =>
  send('POST', p, b, h);
const get = (p: string, token?: string) =>
  send('GET', p, undefined, token ? { authorization: `Bearer ${token}` } : {});
const asUser = (token: string) => ({ authorization: `Bearer ${token}` });

const PASSWORD = 'a long enough password';
let counter = 0;
const unique = () => `c${++counter}.${process.pid}@example.com`;

async function signUp(over: Record<string, unknown> = {}) {
  const email = unique();
  const res = await post('/auth/signup', {
    email,
    password: PASSWORD,
    ...over,
  });
  return { email, res };
}

const userRow = async (email: string) =>
  (await db.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];

const journal = async (userId: string) =>
  (
    await db.query(
      'SELECT * FROM consent_record WHERE user_id = $1 ORDER BY id',
      [userId],
    )
  ).rows;

/** Нова людина з сесією; `newsletter` — що вона зробила з галочкою. */
async function person(over: Record<string, unknown> = {}) {
  const { email, res } = await signUp(over);
  expect(res.status).toBe(201);
  const row = await userRow(email);
  return { email, id: row.id as string, token: res.json.token as string };
}

const letters = (token: string, value: unknown) =>
  post('/account/letters', { letters: value }, asUser(token));

const SIGNUP_V = currentWording('newsletter.signup').version;
const SETTINGS_V = currentWording('newsletter.settings').version;

// ── 1. реєстрація ─────────────────────────────────────────────────────────

describe('1. реєстрація: з галочкою — рядок із версією, без — рядка немає', () => {
  it('🔴 з галочкою: рівно один рядок, і в ньому вид, версія, джерело й момент', async () => {
    const { email, res } = await signUp({ newsletter: true });
    expect(res.status).toBe(201);
    const user = await userRow(email);
    const rows = await journal(user.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: user.id,
      kind: 'newsletter',
      granted: true,
      wording_key: 'newsletter.signup',
      wording_version: SIGNUP_V,
      source: 'signup',
    });
    // Прапорець і журнал — про один момент, а не про два близьких.
    expect(user.marketing_consent_at).not.toBeNull();
    expect(new Date(rows[0].recorded_at).getTime()).toBe(
      new Date(user.marketing_consent_at).getTime(),
    );
    // Версія в базі — число, написане тут, а не прочитане з тієї ж функції,
    // що її записала: перша редакція тексту — версія 1.
    expect(rows[0].wording_version).toBe(1);
  });

  // 🔴 КОЖЕН ВИПАДОК — ОКРЕМИЙ ТЕСТ. Це все, що пре-тикнута галочка чи
  // недбалий клієнт могли б сказати «так», не будучи людиною, що поставила
  // її. Жоден — не булевий `true`.
  it.each([
    ['відсутнє', {}],
    ['false', { newsletter: false }],
    ['"true"', { newsletter: 'true' }],
    ['"on"', { newsletter: 'on' }],
    ['1', { newsletter: 1 }],
    ['null', { newsletter: null }],
    ['{}', { newsletter: {} }],
  ] as Array<[string, Record<string, unknown>]>)(
    '🔴 без галочки (%s) — рядка немає',
    async (_label, over) => {
      const { email, res } = await signUp(over);
      expect(res.status).toBe(201);
      const user = await userRow(email);
      expect(user.marketing_consent_at).toBeNull();
      expect(await journal(user.id)).toHaveLength(0);
    },
  );

  it('🔴 текст бере сервер: версію, вид, джерело й «текст» від клієнта запис не бере', async () => {
    const { email, res } = await signUp({
      newsletter: true,
      wordingVersion: 99,
      version: 99,
      wordingKey: 'newsletter.settings',
      kind: 'photo_publish',
      source: 'moderation',
      granted: false,
      text: 'I agree to everything, forever.',
    });
    expect(res.status).toBe(201);
    const user = await userRow(email);
    const rows = await journal(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'newsletter',
      granted: true,
      wording_key: 'newsletter.signup',
      wording_version: SIGNUP_V,
      source: 'signup',
    });
    expect(JSON.stringify(rows)).not.toContain('forever');
  });

  it('🔴 акаунт і доказ — одна транзакція: рядок не записався — акаунта немає', async () => {
    // Тригер, що ламає кожну вставку в журнал, лише в цій тестовій базі.
    await db.query(`
      CREATE FUNCTION test_boom() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);
    await db.query(`
      CREATE TRIGGER test_boom BEFORE INSERT ON consent_record
        FOR EACH ROW EXECUTE FUNCTION test_boom()`);
    // Очікуваний збій не мусить шуміти в журналі прогону, як справжній.
    Logger.overrideLogger(false);
    try {
      const { email, res } = await signUp({ newsletter: true });
      expect(res.status).toBe(500);
      // Прапорця без рядка не лишилось, і акаунта з прапорцем теж.
      expect(await userRow(email)).toBeUndefined();

      // Без галочки журнал не чіпається, тож той самий збій реєстрації не б'є.
      const plain = await signUp({});
      expect(plain.res.status).toBe(201);
    } finally {
      Logger.overrideLogger(['log', 'error', 'warn']);
      await db.query('DROP TRIGGER test_boom ON consent_record');
      await db.query('DROP FUNCTION test_boom()');
    }
  });
});

// ── 2. налаштування ───────────────────────────────────────────────────────

describe('2. налаштування: вимкнення — НОВИЙ рядок granted=false, старий на місці', () => {
  it('🔴 увімкнув, вимкнув: два рядки, перший байт у байт той самий', async () => {
    const p = await person();
    expect(await journal(p.id)).toHaveLength(0);

    expect((await letters(p.token, true)).json.letters).toBe(true);
    const afterOn = await journal(p.id);
    expect(afterOn).toHaveLength(1);
    expect(afterOn[0]).toMatchObject({
      kind: 'newsletter',
      granted: true,
      wording_key: 'newsletter.settings',
      wording_version: SETTINGS_V,
      source: 'settings',
    });
    expect(afterOn[0].wording_version).toBe(1);

    expect((await letters(p.token, false)).json.letters).toBe(false);
    const afterOff = await journal(p.id);
    expect(afterOff).toHaveLength(2);
    // Старий рядок — той самий: ні `granted`, ні момент, ні `id` не змінились.
    expect(afterOff[0]).toEqual(afterOn[0]);
    expect(afterOff[1]).toMatchObject({
      granted: false,
      wording_key: 'newsletter.settings',
      wording_version: SETTINGS_V,
      source: 'settings',
    });
    expect(BigInt(afterOff[1].id)).toBeGreaterThan(BigInt(afterOff[0].id));

    // Прапорець — як і раніше: вимкнення його скидає.
    expect((await userRow(p.email)).marketing_consent_at).toBeNull();
  });

  it('🔴 згода з реєстрації лишається на місці, коли людина відкликає її в налаштуваннях', async () => {
    const p = await person({ newsletter: true });
    const [signupRow] = await journal(p.id);
    expect(signupRow.source).toBe('signup');

    await letters(p.token, false);
    const rows = await journal(p.id);
    expect(rows.map((r) => [r.source, r.granted])).toEqual([
      ['signup', true],
      ['settings', false],
    ]);
    expect(rows[0]).toEqual(signupRow);
  });

  it('🔴 «true» рядком, 1, порожнє тіло — це вимкнення, і воно теж лишає рядок', async () => {
    const p = await person({ newsletter: true });
    for (const value of ['true', 1, 'on', {}, null, undefined]) {
      const before = (await journal(p.id)).length;
      await letters(p.token, true); // знову ввімкнути
      expect((await journal(p.id)).length).toBe(before + 1);
      const r = await letters(p.token, value);
      expect(r.json.letters).toBe(false);
      const rows = await journal(p.id);
      expect(rows.length).toBe(before + 2);
      expect(rows[rows.length - 1]).toMatchObject({ granted: false });
      expect((await userRow(p.email)).marketing_consent_at).toBeNull();
    }
  });

  it('🔴 журнал і прапорець не розходяться: після будь-якої послідовності останній рядок = прапорець', async () => {
    const p = await person();
    const steps: unknown[] = [true, false, true, 'x', true, true, false, true];
    let sent = 0;
    for (const s of steps) {
      await letters(p.token, s);
      sent++;
      const rows = await journal(p.id);
      const flag = (await userRow(p.email)).marketing_consent_at !== null;
      // Кожен прийнятий запит — рівно один рядок.
      expect(rows).toHaveLength(sent);
      expect(rows[rows.length - 1].granted).toBe(flag);
    }
    // Кожне ввімкнення — з тим самим моментом, що й прапорець у ту мить.
    expect(sent).toBeGreaterThanOrEqual(8);
  });

  it('🔴 прапорець і рядок — одна транзакція: рядок не записався — прапорець не змінився', async () => {
    const p = await person({ newsletter: true });
    const before = (await userRow(p.email)).marketing_consent_at;
    expect(before).not.toBeNull();
    await db.query(`
      CREATE FUNCTION test_boom() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);
    await db.query(`
      CREATE TRIGGER test_boom BEFORE INSERT ON consent_record
        FOR EACH ROW EXECUTE FUNCTION test_boom()`);
    Logger.overrideLogger(false);
    try {
      const r = await letters(p.token, false);
      expect(r.status).toBe(500);
      // Людина натиснула «вимкнути», і нічого не вийшло: ні прапорець не
      // скинувся, ні рядка немає — не буде ситуації «вимкнено без сліду».
      expect((await userRow(p.email)).marketing_consent_at).toEqual(before);
      expect(await journal(p.id)).toHaveLength(1);
    } finally {
      Logger.overrideLogger(['log', 'error', 'warn']);
      await db.query('DROP TRIGGER test_boom ON consent_record');
      await db.query('DROP FUNCTION test_boom()');
    }
  });

  it('акаунт, який просив забути, не отримує нового рядка про згоду', async () => {
    const p = await person({ newsletter: true });
    await db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [p.id]);
    const before = await journal(p.id);
    await expect(
      app.get(AccountService).setLetters(p.id, true),
    ).rejects.toThrow();
    expect(await journal(p.id)).toEqual(before);
  });

  it('без сесії — 401 і жодного рядка', async () => {
    const before = (
      await db.query('SELECT count(*)::int n FROM consent_record')
    ).rows[0].n;
    expect((await post('/account/letters', { letters: true })).status).toBe(
      401,
    );
    expect(
      (await db.query('SELECT count(*)::int n FROM consent_record')).rows[0].n,
    ).toBe(before);
  });
});

// ── база не дає переписати ────────────────────────────────────────────────

describe('🔴 рядок додається, не переписується — і це тримає база, а не звичка', () => {
  it('UPDATE відхиляється тригером, і рядок лишається як був', async () => {
    const p = await person({ newsletter: true });
    const [row] = await journal(p.id);
    for (const sql of [
      'UPDATE consent_record SET granted = false WHERE user_id = $1',
      'UPDATE consent_record SET wording_version = 99 WHERE user_id = $1',
      'UPDATE consent_record SET recorded_at = now() WHERE user_id = $1',
    ]) {
      await expect(db.query(sql, [p.id])).rejects.toThrow(/append-only/);
    }
    expect(await journal(p.id)).toEqual([row]);
  });

  it('вид, джерело й версію база перевіряє сама', async () => {
    const p = await person();
    const bad = (kind: string, source: string, version: number) =>
      db.query(
        `INSERT INTO consent_record (user_id, kind, granted, wording_key, wording_version, source)
         VALUES ($1, $2, true, 'k', $3, $4)`,
        [p.id, kind, version, source],
      );
    await expect(bad('marketing', 'signup', 1)).rejects.toThrow(
      /consent_record_kind/,
    );
    await expect(bad('newsletter', 'email', 1)).rejects.toThrow(
      /consent_record_source/,
    );
    await expect(bad('newsletter', 'signup', 0)).rejects.toThrow(
      /consent_record_version/,
    );
    // …а законна комбінація проходить, тож відмови вище — не від чогось іншого.
    await expect(bad('photo_publish', 'moderation', 1)).resolves.toBeDefined();
  });

  it('сутність і таблиця мають одні й ті самі колонки', async () => {
    const meta = app.get(DataSource).getMetadata(ConsentRecord);
    const fromEntity = meta.columns.map((c) => c.databaseName).sort();
    const fromDb = (
      await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'consent_record'`,
      )
    ).rows
      .map((r) => r.column_name as string)
      .sort();
    expect(fromDb.length).toBeGreaterThan(0);
    expect(fromEntity).toEqual(fromDb);
  });
});

// ── 5. міграція не чіпає дані ─────────────────────────────────────────────

describe('5. міграція додає таблицю й не чіпає наявні дані', () => {
  it('🔴 users: число рядків і вміст до й після однакові; жодна інша таблиця не змінилась', async () => {
    const s = await scratch('camp390m');
    const c = new Client({ connectionString: s.url });
    await c.connect();
    try {
      await migrate(c, [THIS_MIGRATION]);
      const hash = await hashPassword(PASSWORD);
      expect(
        (await c.query(`SELECT to_regclass('public.consent_record') AS t`))
          .rows[0].t,
      ).toBeNull();

      // Люди, сесії й посилання, що вже існують у «бойовій» базі до міграції.
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        const r = await c.query(
          `INSERT INTO users (email, password_hash, marketing_consent_at)
           VALUES ($1, $3, CASE WHEN $2 THEN now() END) RETURNING id`,
          [`pre${i}.${process.pid}@example.com`, i % 2 === 0, hash],
        );
        ids.push(r.rows[0].id);
      }
      await c.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, repeat('0', 64), now() + interval '1 day')`,
        [ids[0]],
      );

      const snapshot = async () => {
        const tables = (
          await c.query(
            `SELECT table_name FROM information_schema.tables
              WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                AND table_name <> 'consent_record'
              ORDER BY 1`,
          )
        ).rows.map((r) => r.table_name as string);
        const counts: Record<string, number> = {};
        const columns: Record<string, string> = {};
        for (const t of tables) {
          counts[t] = (
            await c.query(`SELECT count(*)::int n FROM "${t}"`)
          ).rows[0].n;
          columns[t] = (
            await c.query(
              `SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable,
                                 ',' ORDER BY ordinal_position) s
                 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1`,
              [t],
            )
          ).rows[0].s;
        }
        const usersHash = (
          await c.query(
            `SELECT md5(string_agg(u::text, '|' ORDER BY id::text)) h FROM users u`,
          )
        ).rows[0].h;
        return { counts, columns, usersHash };
      };

      const before = await snapshot();
      expect(before.counts.users).toBe(7);
      expect(before.counts.sessions).toBe(1);

      const mig = (await migrations()).find((x) => x.file === THIS_MIGRATION)!;
      await mig.m.up(runnerOf(c));
      const after = await snapshot();

      expect(after.counts.users).toBe(7); // «число рядків users до й після однакове»
      expect(after.counts).toEqual(before.counts);
      expect(after.columns).toEqual(before.columns);
      expect(after.usersHash).toBe(before.usersHash);
      // Таблиця зʼявилась, порожня.
      expect(
        (await c.query('SELECT count(*)::int n FROM consent_record')).rows[0].n,
      ).toBe(0);

      // `down()` прибирає лише своє: тригер, функцію, таблицю — і users так само ціла.
      await mig.m.down(runnerOf(c));
      expect(
        (await c.query(`SELECT to_regclass('public.consent_record') AS t`))
          .rows[0].t,
      ).toBeNull();
      expect(
        (
          await c.query(
            `SELECT count(*)::int n FROM pg_proc WHERE proname = 'consent_record_refuse_update'`,
          )
        ).rows[0].n,
      ).toBe(0);
      expect(await snapshot()).toEqual(before);

      // …і її можна накотити знову: down() нічого не лишив навпіл.
      await mig.m.up(runnerOf(c));
      expect(await snapshot()).toEqual(before);
    } finally {
      await c.end();
    }
  });
});

// ── 6. вивантаження ───────────────────────────────────────────────────────

async function exportOf(token: string) {
  const start = await post('/account/export', {}, asUser(token));
  expect(start.status).toBe(202);
  await app.get(AccountRightsService).drain();
  const file = await get('/account/export/file', token);
  expect(file.status).toBe(200);
  return { text: file.text, json: JSON.parse(file.text) };
}

describe('6. вивантаження даних (ст. 15) включає журнал згод', () => {
  it('🔴 усі рядки людини, за порядком запису, з текстом формулювання, і відкликання поруч із наданням', async () => {
    const p = await person({ newsletter: true });
    await letters(p.token, false);
    await letters(p.token, true);

    const { json, text } = await exportOf(p.token);
    const log = json.consentLog;
    expect(Array.isArray(log)).toBe(true);
    expect(log).toHaveLength(3);
    expect(
      log.map((r: any) => [
        r.source,
        r.granted,
        r.wording.key,
        r.wording.version,
      ]),
    ).toEqual([
      ['signup', true, 'newsletter.signup', 1],
      ['settings', false, 'newsletter.settings', 1],
      ['settings', true, 'newsletter.settings', 1],
    ]);
    // Текст — саме той, що діяв за цією версією; людина бачить, на ЩО погодилась.
    expect(log[0].wording.text).toBe(wordingAt('newsletter.signup', 1)!.text);
    expect(log[1].wording.text).toBe(wordingAt('newsletter.settings', 1)!.text);
    // …і це дослівно текст біля галочки при реєстрації.
    expect(log[0].wording.text).toBe(
      'I want emails about new routes and guides. No more than once a month.',
    );
    for (const r of log) {
      expect(r.kind).toBe('newsletter');
      expect(r.recordedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      expect(Object.keys(r).sort()).toEqual(
        ['granted', 'kind', 'recordedAt', 'source', 'wording'].sort(),
      );
    }
    // Внутрішній ключ і ідентифікатор людини у файл не потрапляють.
    expect(text).not.toContain(p.id);
  });

  it('🔴 лише своє: рядки іншої людини у файл не потрапляють', async () => {
    const a = await person({ newsletter: true });
    const b = await person();
    // Інша людина вмикає й вимикає тричі: шість рядків із джерелом `settings`.
    for (const v of [true, false, true, false, true, false])
      await letters(b.token, v);
    expect(await journal(b.id)).toHaveLength(6);

    const { json } = await exportOf(a.token);
    expect(json.consentLog).toHaveLength(1);
    expect(json.consentLog[0].source).toBe('signup');
  });

  it('людина без жодної згоди: `consentLog` — порожній перелік, а не пропущене поле', async () => {
    const p = await person();
    const { json } = await exportOf(p.token);
    expect(json).toHaveProperty('consentLog');
    expect(json.consentLog).toEqual([]);
  });

  it('🔴 один рядок із втраченим текстом коштує одного `null`, а не всього вивантаження', async () => {
    const p = await person({ newsletter: true });
    // Рядок, що посилається на версію, якої реєстр не знає.
    await db.query(
      `INSERT INTO consent_record (user_id, kind, granted, wording_key, wording_version, source)
       VALUES ($1, 'newsletter', true, 'newsletter.signup', 7, 'signup')`,
      [p.id],
    );
    const { json } = await exportOf(p.token);
    expect(json.consentLog).toHaveLength(2);
    expect(json.consentLog[0].wording.text).toBe(
      wordingAt('newsletter.signup', 1)!.text,
    );
    expect(json.consentLog[1].wording).toEqual({
      key: 'newsletter.signup',
      version: 7,
      text: null,
    });
    // Решта архіву на місці.
    expect(json.account.email).toBe(p.email);
  });
});

// ── стирання ──────────────────────────────────────────────────────────────

describe('стирання акаунта (ст. 17) не впирається в журнал', () => {
  it('🔴 purge прибирає акаунт разом з його рядками, чужі не чіпає', async () => {
    const gone = await person({ newsletter: true });
    await letters(gone.token, false);
    const stays = await person({ newsletter: true });
    expect(await journal(gone.id)).toHaveLength(2);

    // Прохання про видалення давно минуло: вікно вичерпано.
    await db.query(
      "UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1",
      [gone.id],
    );
    const out = await app.get(AccountRightsService).purge();
    expect(out.accounts).toBeGreaterThanOrEqual(1);

    expect(
      (await db.query('SELECT 1 FROM users WHERE id = $1', [gone.id])).rows,
    ).toHaveLength(0);
    expect(await journal(gone.id)).toHaveLength(0);
    expect(await journal(stays.id)).toHaveLength(1);
  });
});
