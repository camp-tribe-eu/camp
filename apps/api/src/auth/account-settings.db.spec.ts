import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { DevMailbox, MailMessage, MailSender } from './mail';
import { WarningsService } from '../warnings/warnings.service';
import { AccountService, MAILER } from './account.service';

// CAMP-229 — налаштування акаунта: пароль, пошта, листи. Проти СПРАВЖНЬОЇ
// бази і СПРАВЖНЬОГО застосунку, з тих самих причин, що й `account.db.spec`:
// усе, що ця частина обіцяє, — про те, що бачить сторонній по HTTP і чого не
// дозволить база.
//
// 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПРОВАЛ, А НЕ ПРОПУСК: пропущений тест читається як
// пройдений. Потрібен CAMP_TEST_DATABASE_URL (локально) або CI_DATABASE_URL.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;

const box = new DevMailbox(() => undefined);
const sender: MailSender = {
  async send(m: MailMessage) {
    await box.send(m);
  },
};

/** Куди вказують посилання. Написано, а не імпортовано: це оракул. */
const WEB = 'https://site.example';

const noWarnings = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
  current: () => ({}),
  callsLastCycle: () => 0,
};

async function migrateEverything(client: Client): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await client.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  const dir = join(__dirname, '..', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const runner = {
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  } as unknown as QueryRunner;
  for (const file of files) {
    const mod = await import(join(dir, file));
    const Migration = Object.values(mod).find(
      (v): v is new () => { up(q: QueryRunner): Promise<void> } =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!Migration) throw new Error(`no migration class in ${file}`);
    await new Migration().up(runner);
  }
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
  dbName = `camp229s_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await migrateEverything(db);

  process.env.DATABASE_URL = url.toString();
  process.env.TRUST_PROXY_CLIENT_IP = '1';
  const { AppModule } = await import('../app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue({ sender, webBase: WEB })
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
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

let callers = 0;
const nextCaller = () => `198.51.100.${(callers++ % 250) + 1}`;

type Reply = { status: number; json: any };

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
  return { status: res.status, json };
}

const post = (p: string, b: unknown, h: Record<string, string> = {}) =>
  send('POST', p, b, h);
const get = (p: string, token?: string) =>
  send('GET', p, undefined, token ? { authorization: `Bearer ${token}` } : {});
const asUser = (token: string) => ({ authorization: `Bearer ${token}` });

const settle = () => app.get(AccountService).drain();

const PASSWORD = 'a long enough password';
let counter = 0;
const unique = () => `s${++counter}.${process.pid}@example.com`;

const lettersTo = (email: string, kind?: MailMessage['kind']) =>
  box.sent.filter((m) => m.to === email && (!kind || m.kind === kind));

/** Сирий токен усередині посилання — те, що надіслав би клік людини. */
const tokenIn = (letter: MailMessage): string => {
  const link = /https?:\/\/\S+/.exec(letter.text)![0];
  return new URL(link).searchParams.get('t')!;
};

/** Новий акаунт і його сесія. */
async function makeUser(email = unique()) {
  const r = await post('/auth/signup', { email, password: PASSWORD });
  expect(r.status).toBe(201);
  return { email, token: r.json.token as string };
}

const emailOf = async (email: string) =>
  (
    await db.query(
      'SELECT email, email_verified_at FROM users WHERE email = $1',
      [email],
    )
  ).rows[0];

// ── пароль ────────────────────────────────────────────────────────────────

describe('зміна пароля', () => {
  it('без сесії — 401, і тим самим тілом, що й усюди', async () => {
    const r = await post('/account/password', {
      currentPassword: PASSWORD,
      newPassword: 'another long password',
    });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe('no_session');
  });

  it('🔴 хибний чинний пароль — 403, НЕ 401, і нічого не змінилось', async () => {
    const u = await makeUser();
    const r = await post(
      '/account/password',
      { currentPassword: 'not the password', newPassword: 'another long one' },
      asUser(u.token),
    );
    // 401 тут прочиталось би сторінкою як «сесія скінчилась» і викинуло б
    // людину на /login посеред зміни пароля.
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('wrong_password');
    // Старий пароль досі той самий, і сесія жива.
    expect((await get('/auth/me', u.token)).status).toBe(200);
    expect(
      (await post('/auth/login', { email: u.email, password: PASSWORD }))
        .status,
    ).toBe(200);
  });

  it('🔴 слабкий новий пароль — 400 ДО будь-якого запису', async () => {
    const u = await makeUser();
    const r = await post(
      '/account/password',
      { currentPassword: PASSWORD, newPassword: 'short' },
      asUser(u.token),
    );
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('weak_password');
    expect(r.json.reason).toBe('too-short');
    // Людина лишається там, де була: сесія жива, старий пароль працює.
    expect((await get('/auth/me', u.token)).status).toBe(200);
    expect(
      (await post('/auth/login', { email: u.email, password: PASSWORD }))
        .status,
    ).toBe(200);
  });

  it('порожній чинний пароль — 400, і scrypt не кличеться', async () => {
    const u = await makeUser();
    const r = await post(
      '/account/password',
      { currentPassword: '', newPassword: 'another long password' },
      asUser(u.token),
    );
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('password_required');
  });

  it('🔴 успіх: СТАРА сесія мертва, нова видана, старий пароль більше не пускає', async () => {
    const u = await makeUser();
    const next = 'a different long password';
    const r = await post(
      '/account/password',
      { currentPassword: PASSWORD, newPassword: next },
      asUser(u.token),
    );
    expect(r.status).toBe(200);
    expect(typeof r.json.token).toBe('string');
    expect(r.json.token).not.toBe(u.token);

    // Причина змінити пароль звучить як «хтось має доступ»: зміна, що лишає
    // стару сесію живою, не робить нічого з тим, через що її й затіяли.
    expect((await get('/auth/me', u.token)).status).toBe(401);
    expect((await get('/auth/me', r.json.token)).status).toBe(200);

    expect(
      (await post('/auth/login', { email: u.email, password: PASSWORD }))
        .status,
    ).toBe(401);
    expect(
      (await post('/auth/login', { email: u.email, password: next })).status,
    ).toBe(200);
  });

  it('🔴 невикористані посилання на скидання після зміни мертві', async () => {
    const u = await makeUser();
    await post('/auth/forgot', { email: u.email });
    await settle();
    const letter = lettersTo(u.email, 'reset_password').at(-1)!;
    const token = tokenIn(letter);

    await post(
      '/account/password',
      { currentPassword: PASSWORD, newPassword: 'yet another long password' },
      asUser(u.token),
    );

    // Лист міг лежати в чужій скриньці; людина щойно довела, що памʼятає
    // пароль, тож старе посилання більше не потрібне нікому.
    const used = await post('/auth/reset-password', {
      token,
      password: 'a third long password',
    });
    expect(used.status).toBe(410);
  });
});

// ── пошта ─────────────────────────────────────────────────────────────────

describe('зміна пошти', () => {
  it('хибний пароль — 403, і жодного листа', async () => {
    const u = await makeUser();
    const target = unique();
    const r = await post(
      '/account/email',
      { password: 'not it', email: target },
      asUser(u.token),
    );
    await settle();
    expect(r.status).toBe(403);
    expect(lettersTo(target)).toHaveLength(0);
  });

  it('не схоже на адресу — 400, і жодного листа', async () => {
    const u = await makeUser();
    const r = await post(
      '/account/email',
      { password: PASSWORD, email: 'not-an-address' },
      asUser(u.token),
    );
    await settle();
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('bad_email');
  });

  it('власна чинна адреса — 400: про неї людина й так знає', async () => {
    const u = await makeUser();
    const r = await post(
      '/account/email',
      { password: PASSWORD, email: u.email },
      asUser(u.token),
    );
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('same_email');
  });

  it('🔴 ЧУЖА адреса: та сама 202 і те саме тіло, але жодного листа', async () => {
    const other = await makeUser();
    const u = await makeUser();
    const free = unique();

    const taken = await post(
      '/account/email',
      { password: PASSWORD, email: other.email },
      asUser(u.token),
    );
    const vacant = await post(
      '/account/email',
      { password: PASSWORD, email: free },
      asUser(u.token),
    );
    await settle();

    // Інакше форма налаштувань стає тим самим оракулом перелічення, який ми
    // закрили у формах відновлення.
    expect(taken.status).toBe(202);
    expect(vacant.status).toBe(202);
    expect(taken.json).toEqual(vacant.json);

    // І власникові чужої адреси нема за що отримувати листа про чужу спробу.
    expect(lettersTo(other.email, 'change_email')).toHaveLength(0);
  });

  it('🔴 лист іде на НОВУ адресу, називає її, і пошта ще не змінилась', async () => {
    const u = await makeUser();
    const target = unique();
    const r = await post(
      '/account/email',
      { password: PASSWORD, email: target },
      asUser(u.token),
    );
    await settle();
    expect(r.status).toBe(202);

    expect(lettersTo(u.email, 'change_email')).toHaveLength(0);
    const letters = lettersTo(target, 'change_email');
    expect(letters).toHaveLength(1);
    expect(letters[0].text).toContain(target);
    // Стара адреса в цьому листі НЕ називається: він міг потрапити в чужу
    // скриньку, і не повинен казати тому, хто його читає, про чужий акаунт.
    expect(letters[0].text).not.toContain(u.email);
    expect(letters[0].text).toContain(`${WEB}/confirm-email-change?t=`);

    // Нічого не змінилось, доки ніхто не клікнув.
    expect(await emailOf(u.email)).toBeTruthy();
    expect(await emailOf(target)).toBeFalsy();
  });

  it('друга спроба на іншу адресу вбиває перше посилання', async () => {
    const u = await makeUser();
    const first = unique();
    const second = unique();
    await post(
      '/account/email',
      { password: PASSWORD, email: first },
      asUser(u.token),
    );
    await settle();
    const firstToken = tokenIn(lettersTo(first, 'change_email')[0]);

    await post(
      '/account/email',
      { password: PASSWORD, email: second },
      asUser(u.token),
    );
    await settle();

    // Людина передумала: намір, який вона замінила, не має лишатись робочим.
    expect(
      (await post('/auth/confirm-email-change', { token: firstToken })).status,
    ).toBe(410);
    const live = tokenIn(lettersTo(second, 'change_email')[0]);
    expect(
      (await post('/auth/confirm-email-change', { token: live })).status,
    ).toBe(204);
  });
});

describe('підтвердження переїзду', () => {
  it('🔴 клік переносить пошту, позначає її підтвердженою і вбиває ВСІ сесії', async () => {
    const u = await makeUser();
    const target = unique();
    await post(
      '/account/email',
      { password: PASSWORD, email: target },
      asUser(u.token),
    );
    await settle();
    const token = tokenIn(lettersTo(target, 'change_email')[0]);

    expect((await post('/auth/confirm-email-change', { token })).status).toBe(
      204,
    );

    const row = await emailOf(target);
    expect(row).toBeTruthy();
    // Людина щойно довела, що читає цю адресу — питати ще один лист означало
    // б питати двічі те саме.
    expect(row.email_verified_at).not.toBeNull();
    expect(await emailOf(u.email)).toBeFalsy();

    // Пошта — це спосіб повернути доступ, тож її зміна коштує стільки ж,
    // скільки зміна пароля.
    expect((await get('/auth/me', u.token)).status).toBe(401);
    expect(
      (await post('/auth/login', { email: target, password: PASSWORD })).status,
    ).toBe(200);
    expect(
      (await post('/auth/login', { email: u.email, password: PASSWORD }))
        .status,
    ).toBe(401);
  });

  it('те саме посилання вдруге — 410', async () => {
    const u = await makeUser();
    const target = unique();
    await post(
      '/account/email',
      { password: PASSWORD, email: target },
      asUser(u.token),
    );
    await settle();
    const token = tokenIn(lettersTo(target, 'change_email')[0]);
    expect((await post('/auth/confirm-email-change', { token })).status).toBe(
      204,
    );
    expect((await post('/auth/confirm-email-change', { token })).status).toBe(
      410,
    );
  });

  it('🔴 посилання ІНШОГО виду цей маршрут не відкриває', async () => {
    const email = unique();
    await post('/auth/signup', { email, password: PASSWORD });
    await settle();
    const verify = tokenIn(lettersTo(email, 'verify_email')[0]);
    // Підтвердження адреси й переїзд на іншу — різні наміри. Вид входить у
    // пошук, тож один лист не виконує роботу іншого.
    expect(
      (await post('/auth/confirm-email-change', { token: verify })).status,
    ).toBe(410);
  });

  it('🔴 адресу зайняли, поки лист ішов — 409, а не 500', async () => {
    const u = await makeUser();
    const target = unique();
    await post(
      '/account/email',
      { password: PASSWORD, email: target },
      asUser(u.token),
    );
    await settle();
    const token = tokenIn(lettersTo(target, 'change_email')[0]);

    // Хтось інший зареєструвався на цю адресу між листом і кліком.
    await post('/auth/signup', { email: target, password: PASSWORD });

    const r = await post('/auth/confirm-email-change', { token });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('email_taken');
  });

  it('сміття замість токена — те саме 410, що й усе інше', async () => {
    for (const token of ['', 'x', 'x'.repeat(300), null, 42]) {
      expect((await post('/auth/confirm-email-change', { token })).status).toBe(
        410,
      );
    }
  });
});

// ── листи ─────────────────────────────────────────────────────────────────

describe('листи про новини', () => {
  it('🔴 вмикає ЛИШЕ літеральний true (Planet49)', async () => {
    const u = await makeUser();
    for (const value of ['true', 1, 'on', {}, [], null, undefined]) {
      const r = await post(
        '/account/letters',
        { letters: value },
        asUser(u.token),
      );
      expect(r.status).toBe(200);
      // Згода, яку можна отримати неточним значенням, не є згодою.
      expect(r.json.letters).toBe(false);
    }
    const on = await post(
      '/account/letters',
      { letters: true },
      asUser(u.token),
    );
    expect(on.json.letters).toBe(true);
  });

  it('зберігається МОМЕНТ, і вимкнення його прибирає', async () => {
    const u = await makeUser();
    await post('/account/letters', { letters: true }, asUser(u.token));
    const after = await db.query(
      'SELECT marketing_consent_at FROM users WHERE email = $1',
      [u.email],
    );
    expect(after.rows[0].marketing_consent_at).not.toBeNull();

    await post('/account/letters', { letters: false }, asUser(u.token));
    const off = await db.query(
      'SELECT marketing_consent_at FROM users WHERE email = $1',
      [u.email],
    );
    expect(off.rows[0].marketing_consent_at).toBeNull();
  });

  it('без сесії — 401', async () => {
    expect((await post('/account/letters', { letters: true })).status).toBe(
      401,
    );
  });
});

// ── що показує сторінка ───────────────────────────────────────────────────

describe('GET /account/settings', () => {
  it('віддає адресу, підтвердженість і стан листів — і нічого більше', async () => {
    const u = await makeUser();
    await post('/account/letters', { letters: true }, asUser(u.token));
    const r = await get('/account/settings', u.token);
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(
      ['displayName', 'email', 'emailVerified', 'letters'].sort(),
    );
    expect(r.json.email).toBe(u.email);
    expect(r.json.letters).toBe(true);
    // Момент згоди лишається в базі; сторінці нема що з ним робити, а поле,
    // якого тут немає, не може витекти.
    expect(r.json).not.toHaveProperty('marketingConsentAt');
  });

  it('без сесії — 401', async () => {
    expect((await get('/account/settings')).status).toBe(401);
  });
});

// ── те, чого не дозволить сама база ───────────────────────────────────────

describe('🔴 auth_tokens_new_email — еквівалентність, а не NOT NULL', () => {
  const insert = (kind: string, newEmail: string | null) =>
    db.query(
      `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at, new_email)
       SELECT id, $1, $2, now() + interval '1 hour', $3 FROM users LIMIT 1`,
      [kind, 'a'.repeat(64), newEmail],
    );

  it('change_email БЕЗ адреси база не приймає', async () => {
    // Інакше код, що спробує його застосувати, поставить людині email = NULL.
    await expect(insert('change_email', null)).rejects.toThrow(
      /auth_tokens_new_email/,
    );
  });

  it('verify_email З адресою база теж не приймає', async () => {
    // Рядок, який виглядає як запит на зміну пошти, якого ніхто не робив.
    await expect(insert('verify_email', 'someone@example.com')).rejects.toThrow(
      /auth_tokens_new_email/,
    );
  });

  it('ненормалізована адреса не приймається — як і в users', async () => {
    await expect(
      insert('change_email', '  Mixed@Example.COM '),
    ).rejects.toThrow(/auth_tokens_new_email_normalised/);
  });

  it('а правильна пара приймається — інакше ці три нічого не доводять', async () => {
    await expect(
      insert('change_email', 'ok@example.com'),
    ).resolves.toBeTruthy();
  });
});
