import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { DevMailbox, MailMessage, MailSender } from './mail';
import { WarningsService } from '../warnings/warnings.service';
import { AccountService, MAILER } from './account.service';
import * as passwordModule from './password';

// CAMP-228 — sign-up, confirmation and password reset, against a REAL
// PostgreSQL and the REAL application.
//
// 🔴 WHY THE WHOLE APP AND THE WHOLE MIGRATION CHAIN. Every promise this card
// makes is about what a stranger can observe over HTTP and what the database
// refuses to hold: "the same answer for an address we know and one we do not",
// "a refused tick is not consent", "a spent link is dead". A test that builds
// the controller by hand answers a different question. So: every migration in
// `src/migrations`, in order, on a scratch database; then `AppModule` itself —
// the same global throttle guard, the same middleware, the same controllers —
// pointed at it. Only the MAILER is swapped, and for a recording stand-in of
// the same interface; the flow under test never learns.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP: a skipped test reads as a
// passed one. Needs CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI
// sets it): any PostGIS database you may CREATE DATABASE in. This file creates
// its own `camp228_*` database and drops it; it touches nothing in the one you
// name.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;

/** The letters the recording sender saw, and a hook to slow it down. */
const box = new DevMailbox(() => undefined);
let latencyMs = 0;
const sender: MailSender = {
  async send(m: MailMessage) {
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    await box.send(m);
  },
};

/** Where letters link to. Written out, not imported: it is the oracle. */
const WEB = 'https://site.example';

/**
 * 🔴 `AppModule` starts the weather-warning poller, and the poller's first act
 * is to fetch 27 national feeds over HTTPS. This file is about accounts: it
 * must not reach the internet, and it must not leave a TLS socket open that
 * holds jest up for ten seconds after the last test. The service is swapped
 * for one that does nothing; nothing here reads warnings.
 */
const noWarnings = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
  current: () => ({}),
  callsLastCycle: () => 0,
};

async function migrateEverything(client: Client): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // TypeORM's own bookkeeping table: one migration deletes a row from it.
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
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp228_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await migrateEverything(db);

  // Read when app.module.ts is first IMPORTED, which is why the import below
  // is dynamic and comes after this line.
  process.env.DATABASE_URL = url.toString();
  // Each test brings its own caller address, so the rate limit counts it
  // alone; the tests that are ABOUT the limit pin one address.
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

type Reply = {
  status: number;
  text: string;
  json: any;
  headers: Headers;
};

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
      // Not kept alive: an idle keep-alive socket holds jest open for the
      // few seconds undici lets it linger.
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
  return { status: res.status, text, json, headers: res.headers };
}

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) => send('POST', path, body, headers);
const get = (path: string, token?: string) =>
  send(
    'GET',
    path,
    undefined,
    token ? { authorization: `Bearer ${token}` } : {},
  );

const service = () => app.get(AccountService);
/** Wait for the letters that are sent after a response has gone out. */
const settle = () => service().drain();

const PASSWORD = 'a long enough password';
let counter = 0;
const unique = () => `u${++counter}.${process.pid}@example.com`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const lettersTo = (email: string, kind?: MailMessage['kind']) =>
  box.sent.filter((m) => m.to === email && (!kind || m.kind === kind));

/** The raw token inside a letter's link — what a person's click would send. */
const tokenIn = (letter: MailMessage): string => {
  const link = /https?:\/\/\S+/.exec(letter.text)![0];
  return new URL(link).searchParams.get('t')!;
};

async function row(email: string) {
  return (await db.query('SELECT * FROM users WHERE email = $1', [email]))
    .rows[0];
}

async function register(over: Record<string, unknown> = {}) {
  const email = unique();
  const res = await post('/auth/signup', {
    email,
    password: PASSWORD,
    ...over,
  });
  await settle();
  return { email, res };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

async function timed<T>(f: () => Promise<T>): Promise<[number, T]> {
  const t0 = performance.now();
  const out = await f();
  return [performance.now() - t0, out];
}

/** A shape-valid scrypt hash that no password produces: enough for rows that are only looked up. */
const FAKE_HASH =
  'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** An account written straight into the table, so no letter has been sent for it. */
async function insertRawUser(email: string, confirmed = false) {
  return db.query(
    `INSERT INTO users (email, password_hash, email_verified_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [email, FAKE_HASH, confirmed ? new Date() : null],
  );
}

// ── sign-up ──────────────────────────────────────────────────────────────

describe('signing up', () => {
  it('creates the account, signs it in, and says the address is not confirmed yet', async () => {
    const { email, res } = await register({
      email: `  ${unique().toUpperCase()}  `,
    });
    expect(res.status).toBe(201);
    expect(res.json.emailVerified).toBe(false);
    expect(res.json.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.json.email).toBe(res.json.email.toLowerCase());
    expect(res.json.email).not.toBe(email);

    const stored = await row(res.json.email);
    expect(stored.email_verified_at).toBeNull();
    // A real scrypt hash, not the password.
    expect(stored.password_hash).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(stored.password_hash).not.toContain(PASSWORD);
  });

  it('stores the session as a HASH, never the token', async () => {
    const { res } = await register();
    const rows = (
      await db.query('SELECT token_hash FROM sessions WHERE token_hash = $1', [
        sha256(res.json.token),
      ])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(
      (
        await db.query('SELECT 1 FROM sessions WHERE token_hash = $1', [
          res.json.token,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('lets the new account sign in at once, whatever case the address is typed in', async () => {
    const { email } = await register();
    const login = await post('/auth/login', {
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
  });

  it('refuses a weak password with the reason, and writes nothing', async () => {
    const cases: [string, string][] = [
      ['short', 'too-short'],
      ['1234567890', 'common'],
      ['x'.repeat(129), 'too-long'],
    ];
    for (const [password, reason] of cases) {
      const email = unique();
      const res = await post('/auth/signup', { email, password });
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('weak_password');
      expect(res.json.reason).toBe(reason);
      expect(await row(email)).toBeUndefined();
    }
    const email = unique();
    const asEmail = await post('/auth/signup', { email, password: email });
    expect(asEmail.json.reason).toBe('is-email');
  });

  it('refuses an address that cannot be one', async () => {
    for (const email of ['', 'nobody', 'a@b', 'a b@c.de', undefined, 42]) {
      const res = await post('/auth/signup', { email, password: PASSWORD });
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('bad_email');
    }
  });

  it('sends exactly one confirmation letter, linking to the configured site', async () => {
    const { email } = await register();
    const letters = lettersTo(email, 'verify_email');
    expect(letters).toHaveLength(1);
    expect(letters[0].text).toContain(`${WEB}/verify-email?t=`);
  });

  it('keeps only the HASH of the link it emailed', async () => {
    const { email } = await register();
    const token = tokenIn(lettersTo(email)[0]);
    const stored = (
      await db.query(
        `SELECT t.token_hash FROM auth_tokens t JOIN users u ON u.id = t.user_id
          WHERE u.email = $1`,
        [email],
      )
    ).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).toBe(sha256(token));
    expect(stored[0].token_hash).not.toBe(token);
  });

  it('answers 409 for a taken address, in any case, and sends no second letter', async () => {
    const { email } = await register();
    const again = await post('/auth/signup', {
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    await settle();
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('email_taken');
    expect(again.json.token).toBeUndefined();
    expect(lettersTo(email)).toHaveLength(1);
    expect(
      (await db.query('SELECT 1 FROM users WHERE email = $1', [email])).rows,
    ).toHaveLength(1);
  });

  it('survives two sign-ups racing for one address: one account, one 409, no 500', async () => {
    const email = unique();
    const both = await Promise.all([
      post('/auth/signup', { email, password: PASSWORD }),
      post('/auth/signup', { email, password: PASSWORD }),
    ]);
    await settle();
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await db.query('SELECT 1 FROM users WHERE email = $1', [email])).rows,
    ).toHaveLength(1);
  });
});

// ── the two legal decisions about boxes ──────────────────────────────────

describe('🔴 the newsletter box is empty unless a person ticked it (Planet49)', () => {
  const consentOf = async (over: Record<string, unknown>) => {
    const { res } = await register(over);
    return (await row(res.json.email)).marketing_consent_at;
  };

  it('records nothing when the field is absent', async () => {
    expect(await consentOf({})).toBeNull();
  });

  it('records nothing for false', async () => {
    expect(await consentOf({ newsletter: false })).toBeNull();
  });

  // The ways a pre-ticked box or a sloppy client could say "yes" without a
  // person doing so. None of them is the explicit boolean.
  it.each([
    ['"true"', 'true'],
    ['1', 1],
    ['"on"', 'on'],
    ['"yes"', 'yes'],
    ['{}', {}],
    ['[true]', [true]],
    ['null', null],
  ])('records nothing for %s', async (_label, value) => {
    expect(await consentOf({ newsletter: value })).toBeNull();
  });

  it('records the moment of an explicit true', async () => {
    const before = Date.now();
    const at = await consentOf({ newsletter: true });
    expect(at).not.toBeNull();
    expect(new Date(at).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('🔴 the Terms have no box: the basis is the contract, so there is nothing to refuse', () => {
  it('signs up with no terms field at all', async () => {
    const { res } = await register();
    expect(res.status).toBe(201);
  });

  it('is not made to depend on one: terms:false changes nothing', async () => {
    const { res } = await register({ terms: false, acceptTerms: false });
    expect(res.status).toBe(201);
  });
});

// ── confirming the address ───────────────────────────────────────────────

describe('following the confirmation link', () => {
  it('confirms the address, once', async () => {
    const { email } = await register();
    const token = tokenIn(lettersTo(email, 'verify_email')[0]);

    const first = await post('/auth/verify-email', { token });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ verified: true });
    expect((await row(email)).email_verified_at).not.toBeNull();

    const second = await post('/auth/verify-email', { token });
    expect(second.status).toBe(410);
    expect(second.json.code).toBe('link_stale');
  });

  it('lets only one of two simultaneous clicks win', async () => {
    const { email } = await register();
    const token = tokenIn(lettersTo(email, 'verify_email')[0]);
    const both = await Promise.all([
      post('/auth/verify-email', { token }),
      post('/auth/verify-email', { token }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 410]);
  });

  it('says "stale" in one voice for a link that is unknown, empty, expired or of the wrong kind', async () => {
    const { email } = await register();
    const token = tokenIn(lettersTo(email, 'verify_email')[0]);

    await db.query(
      `UPDATE auth_tokens SET expires_at = now() - interval '1 second'
        WHERE token_hash = $1`,
      [sha256(token)],
    );
    const bodies = await Promise.all(
      [token, 'no-such-token', '', undefined, 42, 'x'.repeat(300)].map((t) =>
        post('/auth/verify-email', { token: t }),
      ),
    );
    for (const r of bodies) {
      expect(r.status).toBe(410);
      expect(r.json.code).toBe('link_stale');
    }
    expect(new Set(bodies.map((r) => r.text)).size).toBe(1);
    expect((await row(email)).email_verified_at).toBeNull();
  });

  it('does not open the reset form with a confirmation link, or the reverse', async () => {
    const { email } = await register();
    const confirm = tokenIn(lettersTo(email, 'verify_email')[0]);
    await post('/auth/forgot', { email });
    await settle();
    const reset = tokenIn(lettersTo(email, 'reset_password')[0]);

    const a = await post('/auth/reset-password', {
      token: confirm,
      password: 'another long password',
    });
    expect(a.status).toBe(410);
    const b = await post('/auth/verify-email', { token: reset });
    expect(b.status).toBe(410);
    // Neither wrong attempt spent the link.
    expect((await post('/auth/verify-email', { token: confirm })).status).toBe(
      200,
    );
  });

  it('keeps the FIRST confirmation time when a second link is followed', async () => {
    const { email } = await register();
    const first = tokenIn(lettersTo(email, 'verify_email')[0]);

    // A second letter is asked for BEFORE the first is followed, a minute
    // later by the service's own clock: only then are two live links held.
    const T1 = new Date(Date.now() + 61_000);
    await service().requestVerification(email, T1);
    await settle();
    const letters = lettersTo(email, 'verify_email');
    expect(letters).toHaveLength(2);
    const second = tokenIn(letters[1]);

    // Both links are live for an hour from now; follow them ten and
    // twenty minutes in.
    const t10 = new Date(Date.now() + 600_000);
    const t20 = new Date(Date.now() + 1_200_000);
    await service().verifyEmail(first, t10);
    await service().verifyEmail(second, t20);
    // The second click is a no-op on the account: the first moment stands.
    expect(new Date((await row(email)).email_verified_at).getTime()).toBe(
      t10.getTime(),
    );
  });

  it('lives for exactly 60 minutes: valid a millisecond before, dead at the minute', async () => {
    const T = new Date('2030-01-01T10:00:00.000Z');
    const inside = unique();
    const outside = unique();
    for (const e of [inside, outside]) {
      await post('/auth/signup', { email: e, password: PASSWORD });
    }
    await settle();
    // Re-issue both from a known instant: the signup letters were issued "now".
    for (const e of [inside, outside]) {
      await db.query(
        `UPDATE auth_tokens SET expires_at = $2
          WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
        [e, new Date(T.getTime() + 3_600_000)],
      );
    }
    const tIn = tokenIn(lettersTo(inside, 'verify_email')[0]);
    const tOut = tokenIn(lettersTo(outside, 'verify_email')[0]);
    await expect(
      service().verifyEmail(tIn, new Date(T.getTime() + 3_599_999)),
    ).resolves.toBeUndefined();
    await expect(
      service().verifyEmail(tOut, new Date(T.getTime() + 3_600_000)),
    ).rejects.toThrow();
  });
});

describe('🔴 the TTL written into a freshly issued link is 60 minutes', () => {
  it('expires_at is issue time plus 3 600 000 ms', async () => {
    const T = new Date('2031-03-03T03:03:03.000Z');
    const email = unique();
    await post('/auth/signup', { email, password: PASSWORD });
    await settle();
    await service().requestReset(email, T);
    await settle();
    const rows = (
      await db.query(
        `SELECT t.expires_at FROM auth_tokens t JOIN users u ON u.id = t.user_id
          WHERE u.email = $1 AND t.kind = 'reset_password'`,
        [email],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].expires_at).toISOString()).toBe(
      '2031-03-03T04:03:03.000Z',
    );
  });
});

// ── the link itself ──────────────────────────────────────────────────────

describe('🔴 the token in a letter is 256 bits — the whole defence of the link', () => {
  // The route that spends a link is not rate limited as a guessing target and
  // cannot usefully be: a stranger who can try a hundred and twenty a minute
  // still does not find 2^256. What stands between them and the account is the
  // length of this string, so the length is asserted as a literal — 43
  // base64url characters — and not as `TOKEN_BYTES`, which a mutation moves
  // together with the generator.
  const SHAPE = /^[A-Za-z0-9_-]{43}$/;

  it('is 43 URL-safe characters in the confirmation letter and in the reset letter', async () => {
    const { email } = await register();
    await post('/auth/forgot', { email });
    await settle();
    const confirm = tokenIn(lettersTo(email, 'verify_email')[0]);
    const reset = tokenIn(lettersTo(email, 'reset_password')[0]);
    expect(confirm).toMatch(SHAPE);
    expect(reset).toMatch(SHAPE);
    expect(reset).not.toBe(confirm);
  });

  it('is different for every letter, not just long', async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 6; i++) {
      const email = unique();
      await insertRawUser(email);
      await post('/auth/forgot', { email });
      await settle();
      tokens.push(tokenIn(lettersTo(email, 'reset_password')[0]));
    }
    for (const t of tokens) expect(t).toMatch(SHAPE);
    expect(new Set(tokens).size).toBe(6);
  });
});

describe('🔴 one valid reset link buys one hash, however many times it is posted at once', () => {
  // Measured on 15.10.2026 before the guard: twelve concurrent requests with
  // ONE valid link called `hashPassword` twelve times. The call is COUNTED, not
  // replaced: the spy passes through to the real scrypt, so a response that is
  // wrong for any other reason still fails.
  it('twelve concurrent resets with one link: one 204, eleven 410, ONE hash', async () => {
    const email = unique();
    await insertRawUser(email);
    await post('/auth/forgot', { email });
    await settle();
    const token = tokenIn(lettersTo(email, 'reset_password')[0]);

    const hashes = jest.spyOn(passwordModule, 'hashPassword');
    try {
      const replies = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          post('/auth/reset-password', {
            token,
            password: `a new long password ${i}`,
          }),
        ),
      );
      expect(replies.map((r) => r.status).sort()).toEqual([
        204, 410, 410, 410, 410, 410, 410, 410, 410, 410, 410, 410,
      ]);
      expect(hashes).toHaveBeenCalledTimes(1);
    } finally {
      hashes.mockRestore();
    }
  });

  it('a refused password gives the link back: the guard is released on every path', async () => {
    const email = unique();
    await insertRawUser(email);
    await post('/auth/forgot', { email });
    await settle();
    const token = tokenIn(lettersTo(email, 'reset_password')[0]);
    for (let i = 0; i < 3; i++) {
      const weak = await post('/auth/reset-password', {
        token,
        password: 'short',
      });
      expect(weak.status).toBe(400);
    }
    expect(
      (
        await post('/auth/reset-password', {
          token,
          password: 'a brand new password 42',
        })
      ).status,
    ).toBe(204);
  });

  it('a garbage token never reaches the hash', async () => {
    const hashes = jest.spyOn(passwordModule, 'hashPassword');
    try {
      for (let i = 0; i < 5; i++) {
        const r = await post('/auth/reset-password', {
          token: `garbage-${i}`,
          password: 'a perfectly good new password',
        });
        expect(r.status).toBe(410);
      }
      expect(hashes).not.toHaveBeenCalled();
    } finally {
      hashes.mockRestore();
    }
  });
});

describe('🔴 two links of ONE user, posted together, do not deadlock', () => {
  // The one-hash guard above is keyed on the LINK, so it says nothing here: two
  // different links of one user both reach the transaction. Taken in different
  // orders, their locks crossed and Postgres killed one with `deadlock
  // detected` — a 500, reproduced by review 6 in 6. A person who pressed
  // "send again", got two letters and used both from two tabs did exactly this.
  //
  // Five rounds, because a deadlock needs the two transactions to interleave
  // and one round can get lucky.
  const twoLinks = async (email: string, kind: 'reset' | 'confirm') => {
    const first = new Date();
    const second = new Date(first.getTime() + 61_000);
    const ask =
      kind === 'reset'
        ? (at: Date) => service().requestReset(email, at)
        : (at: Date) => service().requestVerification(email, at);
    await ask(first);
    await ask(second);
    await settle();
    return lettersTo(
      email,
      kind === 'reset' ? 'reset_password' : 'verify_email',
    ).map(tokenIn);
  };

  it('two reset links: one 204, one 410, never a 500', async () => {
    const resets: number[][] = [];
    const logins: number[][] = [];
    for (let round = 0; round < 5; round++) {
      const email = unique();
      await insertRawUser(email);
      const [a, b] = await twoLinks(email, 'reset');
      const replies = await Promise.all([
        post('/auth/reset-password', {
          token: a,
          password: 'password chosen in tab A',
        }),
        post('/auth/reset-password', {
          token: b,
          password: 'password chosen in tab B',
        }),
      ]);
      resets.push(replies.map((r) => r.status).sort());
      // Exactly one of the two passwords is now the account's.
      const tried = await Promise.all(
        ['password chosen in tab A', 'password chosen in tab B'].map(
          (password) => post('/auth/login', { email, password }),
        ),
      );
      logins.push(tried.map((r) => r.status).sort());
    }
    // Whole arrays, so a failure shows WHICH round was a 500.
    expect(resets).toEqual(Array.from({ length: 5 }, () => [204, 410]));
    expect(logins).toEqual(Array.from({ length: 5 }, () => [200, 401]));
  });

  it('two confirmation links and two reset links, all four at once: no 500 anywhere', async () => {
    const confirms: number[][] = [];
    const resets: number[][] = [];
    for (let round = 0; round < 5; round++) {
      const email = unique();
      await insertRawUser(email);
      const [v1, v2] = await twoLinks(email, 'confirm');
      const [r1, r2] = await twoLinks(email, 'reset');
      const replies = await Promise.all([
        post('/auth/verify-email', { token: v1 }),
        post('/auth/verify-email', { token: v2 }),
        post('/auth/reset-password', {
          token: r1,
          password: 'password chosen in tab A',
        }),
        post('/auth/reset-password', {
          token: r2,
          password: 'password chosen in tab B',
        }),
      ]);
      confirms.push(replies.slice(0, 2).map((r) => r.status));
      resets.push(
        replies
          .slice(2)
          .map((r) => r.status)
          .sort(),
      );
      expect((await row(email)).email_verified_at).not.toBeNull();
    }
    expect(confirms).toEqual(Array.from({ length: 5 }, () => [200, 200]));
    expect(resets).toEqual(Array.from({ length: 5 }, () => [204, 410]));
  });
});

// ── "forgot password": same answer, same wait ────────────────────────────

describe('🔴 "if an account exists" — the form does not tell', () => {
  it('answers a known and an unknown address with the same status and the same bytes', async () => {
    const { email: known } = await register();
    const hit = await post('/auth/forgot', { email: known });
    const miss = await post('/auth/forgot', { email: unique() });
    expect(hit.status).toBe(202);
    expect(miss.status).toBe(202);
    expect(hit.text).toBe('{"accepted":true}');
    expect(hit.text).toBe(miss.text);
    // Same headers by name, and the ones that describe the body by value.
    const names = (r: Reply) =>
      [...r.headers.keys()].filter((h) => h !== 'date').sort();
    expect(names(hit)).toEqual(names(miss));
    for (const h of ['content-type', 'content-length', 'etag']) {
      expect(hit.headers.get(h)).toBe(miss.headers.get(h));
    }
  });

  it('sends the letter to the one that exists, and to nobody else', async () => {
    const { email: known } = await register();
    const stranger = unique();
    await post('/auth/forgot', { email: known });
    await post('/auth/forgot', { email: stranger });
    await settle();
    expect(lettersTo(known, 'reset_password')).toHaveLength(1);
    expect(lettersTo(stranger)).toHaveLength(0);
    expect(
      (await db.query('SELECT 1 FROM users WHERE email = $1', [stranger])).rows,
    ).toHaveLength(0);
  });

  it('finds the account however the address is typed', async () => {
    const { email } = await register();
    await post('/auth/forgot', { email: `  ${email.toUpperCase()} ` });
    await settle();
    expect(lettersTo(email, 'reset_password')).toHaveLength(1);
  });

  it('refuses only what is not an address — the same for everybody', async () => {
    for (const email of ['', 'nobody', undefined, null, 42]) {
      const res = await post('/auth/forgot', { email });
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('bad_email');
    }
  });

  // 🔴 THE MEASUREMENT THE CARD ASKS FOR, as a test rather than a number in a
  // comment. A real provider is a network round trip to a vendor; here it
  // takes 150 ms, and the test asks whether a stranger can see it. Known and unknown
  // addresses alternate, so whatever the machine is doing hits both alike,
  // and the MEDIAN of twelve each ignores the one slow request.
  it('answers a known and an unknown address in the same time, though a letter takes 150 ms to send', async () => {
    latencyMs = 150;
    try {
      const known: string[] = [];
      for (let i = 0; i < 12; i++) known.push((await register()).email);

      const hit: number[] = [];
      const miss: number[] = [];
      for (let i = 0; i < 12; i++) {
        hit.push(
          (await timed(() => post('/auth/forgot', { email: known[i] })))[0],
        );
        miss.push(
          (await timed(() => post('/auth/forgot', { email: unique() })))[0],
        );
      }
      await settle();

      // The hits really did their work — otherwise "same time" would only
      // mean "neither did anything".
      for (const email of known)
        expect(lettersTo(email, 'reset_password')).toHaveLength(1);

      // A hit that waited for its own letter would be ~150 ms slower.
      expect(median(hit) - median(miss)).toBeLessThan(75);
      expect(median(miss) - median(hit)).toBeLessThan(75);
    } finally {
      latencyMs = 0;
    }
  });

  it('is the same for "send the confirmation again": unknown, unconfirmed, confirmed', async () => {
    // Written straight into the table: an account that signed up through the
    // form has just been sent a letter, and the counter would (rightly) refuse
    // a second one — a different test, below.
    const unconfirmed = unique();
    const confirmed = unique();
    await insertRawUser(unconfirmed);
    await insertRawUser(confirmed, true);
    const before = box.sent.length;

    const replies = await Promise.all(
      [unique(), unconfirmed, confirmed].map((email) =>
        post('/auth/resend-verification', { email }),
      ),
    );
    await settle();
    for (const r of replies) {
      expect(r.status).toBe(202);
      expect(r.text).toBe('{"accepted":true}');
    }
    // …but the letter went only where there was something to confirm.
    expect(box.sent.length - before).toBe(1);
    expect(lettersTo(unconfirmed, 'verify_email')).toHaveLength(1);
    expect(lettersTo(confirmed)).toHaveLength(0);
  });
});

describe('🔴 the 60-second counter — against us, not against people', () => {
  it('refuses a second request for one address, and says how long to wait', async () => {
    const { email } = await register();
    expect((await post('/auth/forgot', { email })).status).toBe(202);
    const again = await post('/auth/forgot', { email });
    expect(again.status).toBe(429);
    expect(again.json.code).toBe('too_soon');
    expect(again.json.retryAfter).toBeGreaterThanOrEqual(58);
    expect(again.json.retryAfter).toBeLessThanOrEqual(60);
    expect(Number(again.headers.get('retry-after'))).toBe(
      again.json.retryAfter,
    );
    await settle();
    // And no second letter went out.
    expect(lettersTo(email, 'reset_password')).toHaveLength(1);
  });

  // The counter must not become the oracle the card forbids: if it counted
  // letters SENT, the second request would be refused for a real address and
  // accepted for an invented one.
  it("refuses a stranger's address in exactly the same way", async () => {
    const { email: known } = await register();
    const stranger = unique();
    for (const email of [known, stranger])
      await post('/auth/forgot', { email });
    const a = await post('/auth/forgot', { email: known });
    const b = await post('/auth/forgot', { email: stranger });
    expect([a.status, b.status]).toEqual([429, 429]);
    expect({ ...a.json, retryAfter: 0 }).toEqual({ ...b.json, retryAfter: 0 });
    expect(Math.abs(a.json.retryAfter - b.json.retryAfter)).toBeLessThanOrEqual(
      1,
    );
  });

  it('counts the address as typed in any case', async () => {
    const { email } = await register();
    await post('/auth/forgot', { email });
    const again = await post('/auth/forgot', { email: email.toUpperCase() });
    expect(again.status).toBe(429);
  });

  it('keeps one clock per kind of letter: a reset does not block a confirmation', async () => {
    const { email } = await register();
    expect((await post('/auth/forgot', { email })).status).toBe(202);
    // Sign-up already used the confirmation clock; a DIFFERENT address's
    // confirmation is unaffected by this one's reset.
    const other = (await register()).email;
    expect(
      (await post('/auth/resend-verification', { email: other })).status,
    ).toBe(429);
    expect((await post('/auth/forgot', { email: other })).status).toBe(202);
  });

  it('starts the confirmation clock at sign-up, so the page and the server agree', async () => {
    const { email } = await register();
    const again = await post('/auth/resend-verification', { email });
    expect(again.status).toBe(429);
    expect(again.json.retryAfter).toBeGreaterThanOrEqual(58);
  });
});

// ── the link in the letter ───────────────────────────────────────────────

describe('🔴 where the link points is not up to the caller', () => {
  it('ignores Host, X-Forwarded-Host, Origin and Referer', async () => {
    const { email } = await register();
    // `fetch` will not let a script set Host, and Host is the one that
    // matters, so this goes out as a raw request.
    await new Promise<void>((resolve, reject) => {
      const u = new URL(base);
      const req = httpRequest(
        {
          host: u.hostname.replace(/^\[|\]$/g, ''),
          port: u.port,
          path: '/auth/forgot',
          method: 'POST',
          headers: {
            Host: 'evil.example',
            'X-Forwarded-Host': 'evil.example',
            Origin: 'https://evil.example',
            Referer: 'https://evil.example/',
            'content-type': 'application/json',
            'cf-connecting-ip': nextCaller(),
          },
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ email }));
    });
    await settle();
    const letter = lettersTo(email, 'reset_password')[0];
    expect(letter.text).toContain(`${WEB}/reset-password?t=`);
    expect(letter.text).not.toContain('evil.example');
    expect(letter.html).not.toContain('evil.example');
  });
});

// ── resetting ────────────────────────────────────────────────────────────

describe('resetting the password', () => {
  const NEW = 'a brand new password 42';

  async function requestedReset(email: string) {
    await post('/auth/forgot', { email });
    await settle();
    const letters = lettersTo(email, 'reset_password');
    return tokenIn(letters[letters.length - 1]);
  }

  it('sets the new password, retires the old one, and does not sign anyone in', async () => {
    const { email, res: signup } = await register();
    const token = await requestedReset(email);

    const done = await post('/auth/reset-password', { token, password: NEW });
    expect(done.status).toBe(204);
    expect(done.text).toBe('');

    expect(
      (await post('/auth/login', { email, password: PASSWORD })).status,
    ).toBe(401);
    expect((await post('/auth/login', { email, password: NEW })).status).toBe(
      200,
    );
    // The old session is gone with the old password.
    expect(signup.status).toBe(201);
  });

  it('🔴 signs out every session the account had', async () => {
    const { email, res: signup } = await register();
    const stillThere = await get('/trips/mine', signup.json.token);
    expect(stillThere.status).toBe(200);

    const token = await requestedReset(email);
    await post('/auth/reset-password', { token, password: NEW });

    expect((await get('/trips/mine', signup.json.token)).status).toBe(401);
  });

  it('spends the link: it works once', async () => {
    const { email } = await register();
    const token = await requestedReset(email);
    expect(
      (await post('/auth/reset-password', { token, password: NEW })).status,
    ).toBe(204);
    const again = await post('/auth/reset-password', {
      token,
      password: 'yet another password 7',
    });
    expect(again.status).toBe(410);
    expect(again.json.code).toBe('link_stale');
  });

  it('lets only one of two simultaneous resets win', async () => {
    const { email } = await register();
    const token = await requestedReset(email);
    const both = await Promise.all([
      post('/auth/reset-password', { token, password: NEW }),
      post('/auth/reset-password', {
        token,
        password: 'yet another password 7',
      }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([204, 410]);
  });

  it('🔴 does not burn the link on a password that is too weak', async () => {
    const { email } = await register();
    const token = await requestedReset(email);
    const weak = await post('/auth/reset-password', {
      token,
      password: 'short',
    });
    expect(weak.status).toBe(400);
    expect(weak.json.code).toBe('weak_password');
    // The same link still works.
    expect(
      (await post('/auth/reset-password', { token, password: NEW })).status,
    ).toBe(204);
  });

  it('kills the other reset links the person was sent', async () => {
    const { email } = await register();
    const first = await requestedReset(email);
    // A second letter, past the 60-second wait by the service's own clock.
    await service().requestReset(email, new Date(Date.now() + 61_000));
    await settle();
    const letters = lettersTo(email, 'reset_password');
    expect(letters).toHaveLength(2);
    const second = tokenIn(letters[1]);

    expect(
      (await post('/auth/reset-password', { token: second, password: NEW }))
        .status,
    ).toBe(204);
    expect(
      (
        await post('/auth/reset-password', {
          token: first,
          password: 'yet another password 7',
        })
      ).status,
    ).toBe(410);
  });

  it('refuses a password equal to the address, naming nothing else', async () => {
    const { email } = await register();
    const token = await requestedReset(email);
    const res = await post('/auth/reset-password', { token, password: email });
    expect(res.json.reason).toBe('is-email');
  });
});

// ── 🔴 the card's central sentence ───────────────────────────────────────

describe('🔴 an unconfirmed address does not block what the person came to do', () => {
  it('lets an unconfirmed account read its own trips', async () => {
    const { res } = await register();
    const userId = (await row(res.json.email)).id;
    const trip = (
      await db.query(
        `INSERT INTO trips (user_id, name) VALUES ($1, 'Alps in six days') RETURNING id`,
        [userId],
      )
    ).rows[0];
    expect((await row(res.json.email)).email_verified_at).toBeNull();

    const list = await get('/trips/mine', res.json.token);
    expect(list.status).toBe(200);
    expect(list.json.map((t: any) => t.name)).toEqual(['Alps in six days']);

    const one = await get(`/trips/${trip.id}`, res.json.token);
    expect(one.status).toBe(200);
    expect(one.json.name).toBe('Alps in six days');
  });

  it('lets an unconfirmed account sign in again', async () => {
    const { email } = await register();
    expect(
      (await post('/auth/login', { email, password: PASSWORD })).status,
    ).toBe(200);
  });
});

// ── CAMP-229: who is signed in ───────────────────────────────────────────

describe('🔴 GET /auth/me — who the account page is talking to', () => {
  /** The names the page may receive, written out. The oracle, not read back. */
  const FIELDS = ['displayName', 'email', 'emailVerified'];

  it('tells a signed-in person their own address, an empty name and an unconfirmed address', async () => {
    const { res } = await register();
    const me = await get('/auth/me', res.json.token);
    expect(me.status).toBe(200);
    expect(me.json).toEqual({
      email: res.json.email,
      displayName: null,
      emailVerified: false,
    });
  });

  it('says confirmed after the link is followed, and uses the name once there is one', async () => {
    const { email, res } = await register();
    await post('/auth/verify-email', {
      token: tokenIn(lettersTo(email, 'verify_email')[0]),
    });
    await db.query('UPDATE users SET display_name = $2 WHERE email = $1', [
      email,
      'Anna',
    ]);
    const me = await get('/auth/me', res.json.token);
    expect(me.json).toEqual({
      email,
      displayName: 'Anna',
      emailVerified: true,
    });
  });

  // 🔴 TWO ACCOUNTS, so "the first row" and "this row" are different answers.
  // With one account in the table a lookup that forgot its WHERE would still
  // be right.
  it('answers each person with their own account, not the first one in the table', async () => {
    const a = await register();
    const b = await register();
    expect((await get('/auth/me', a.res.json.token)).json.email).toBe(
      a.email.toLowerCase(),
    );
    expect((await get('/auth/me', b.res.json.token)).json.email).toBe(
      b.email.toLowerCase(),
    );
    expect(a.email).not.toBe(b.email);
  });

  // 🔴 THE CORPUS IS THE STORED HASH ITSELF, read out of the table by this
  // test and then searched for in the raw bytes of the answer. Checking the
  // response for the word "password" would only prove the response does not
  // contain a word; this proves it does not contain THAT value. The keys are
  // compared with a literal list for the same reason: an object spread of the
  // row would add `id` and `emailVerifiedAt` and still contain no hash, and
  // only the literal notices.
  it('never carries the password hash, the id, or any field outside the three', async () => {
    const { email, res } = await register({ newsletter: true });
    const stored = await row(email.toLowerCase());
    expect(stored.password_hash).toMatch(/^scrypt\$/);
    expect(stored.marketing_consent_at).not.toBeNull();

    const me = await get('/auth/me', res.json.token);
    expect(me.status).toBe(200);
    expect(Object.keys(me.json).sort()).toEqual(FIELDS);
    expect(me.text).not.toContain(stored.password_hash);
    expect(me.text).not.toContain(stored.id);
    expect(me.text).not.toMatch(/scrypt|password|hash|consent/i);
  });

  // The refusals. Every one is 401 with the SAME body, and none is a 200 with
  // something empty in it — the failure the card names.
  const NO_SESSION = {
    code: 'no_session',
    message: 'You are not signed in.',
  };

  async function expectRefused(headers: Record<string, string>) {
    const res = await send('GET', '/auth/me', undefined, headers);
    expect(res.status).toBe(401);
    expect(res.json).toEqual(NO_SESSION);
    return res;
  }

  it('refuses a request with no credential at all', async () => {
    await expectRefused({});
  });

  it.each([
    ['a token nobody issued', 'Bearer ' + 'A'.repeat(43)],
    ['an empty token', 'Bearer '],
    ['a header with no token in it', 'Bearer'],
    ['the wrong scheme with a real-looking token', 'Basic ' + 'A'.repeat(43)],
    ['junk', 'not an authorization header'],
  ])('refuses %s, in the same words', async (_what, authorization) => {
    await expectRefused({ authorization });
  });

  it('refuses the token of a session that has expired, and honoured it a second before', async () => {
    const { res } = await register();
    const token = res.json.token as string;
    const hash = sha256(token);
    const setExpiry = (sql: string) =>
      db.query(
        `UPDATE sessions SET expires_at = ${sql} WHERE token_hash = $1`,
        [hash],
      );

    await setExpiry(`now() + interval '5 seconds'`);
    expect((await get('/auth/me', token)).status).toBe(200);

    await setExpiry(`now() - interval '1 second'`);
    const refused = await get('/auth/me', token);
    expect(refused.status).toBe(401);
    expect(refused.json).toEqual(NO_SESSION);
  });

  it('refuses a token after the person signed out with it', async () => {
    const { res } = await register();
    const token = res.json.token as string;
    expect((await get('/auth/me', token)).status).toBe(200);
    const out = await send(
      'POST',
      '/auth/logout',
      {},
      { authorization: `Bearer ${token}` },
    );
    expect(out.status).toBe(204);
    expect((await get('/auth/me', token)).status).toBe(401);
  });

  it('refuses a session after the password was reset, which closes them all', async () => {
    const { email, res } = await register();
    await post('/auth/forgot', { email });
    await settle();
    const reset = tokenIn(lettersTo(email, 'reset_password')[0]);
    await post('/auth/reset-password', {
      token: reset,
      password: 'another long password',
    });
    expect((await get('/auth/me', res.json.token)).status).toBe(401);
  });

  // 🔴 THE REFUSAL NOTHING ELSE REACHES: a session that is still live, for an
  // account that is not. `sessions.user_id` cascades on delete, so in a
  // database as migrated this state cannot arise — a deleted account takes its
  // sessions with it and the first line of the handler answers instead. That
  // is why the controller line that answers THIS state could be deleted, or
  // given another body, without a single wire-level test noticing (the unit
  // test in `auth.spec.ts` sees the exception, not the response).
  //
  // So the state is built by hand, in this file's own scratch database: the
  // constraint is read back out of the catalog, dropped, the account deleted,
  // and the constraint put back exactly as it was in `finally`, so a failing
  // assertion cannot leave the later tests running on a schema that differs
  // from production. The two facts that make the request reach the second
  // line — the session row is there, the account row is not — are asserted
  // from the table before it is sent: without them this test would pass
  // through the FIRST line (no viewer) and prove nothing about the second.
  //
  // The answer is compared with the one a caller with no credential gets, on
  // the wire: status, every byte of the body, every header but the clock. One
  // answer for every reason is the property; a body of its own for "the
  // account is gone" would tell a guesser that a token was once real.
  it('refuses a live session whose account is gone with the very same 401 as nobody at all', async () => {
    const { res } = await register();
    const token = res.json.token as string;
    expect((await get('/auth/me', token)).status).toBe(200);
    const nobody = await get('/auth/me');
    expect(nobody.status).toBe(401);

    const fks = (
      await db.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = 'sessions'::regclass
            AND confrelid = 'users'::regclass
            AND contype = 'f'`,
      )
    ).rows;
    expect(fks).toHaveLength(1);
    const { conname, def } = fks[0] as { conname: string; def: string };

    let gone: Reply;
    await db.query(`ALTER TABLE sessions DROP CONSTRAINT "${conname}"`);
    try {
      await db.query('DELETE FROM users WHERE email = $1', [res.json.email]);
      const stored = await db.query(
        `SELECT
           (SELECT count(*) FROM sessions WHERE token_hash = $1)::int AS sessions,
           (SELECT count(*) FROM users WHERE email = $2)::int AS users`,
        [sha256(token), res.json.email],
      );
      expect(stored.rows[0]).toEqual({ sessions: 1, users: 0 });
      gone = await get('/auth/me', token);
    } finally {
      await db.query(
        'DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)',
      );
      await db.query(`ALTER TABLE sessions ADD CONSTRAINT "${conname}" ${def}`);
    }

    // Read the wire, not the exception: this is what the page receives.
    const wire = (r: Reply) =>
      [...r.headers.entries()]
        .filter(([name]) => name !== 'date')
        .sort(([a], [b]) => (a < b ? -1 : 1));
    expect(gone.status).toBe(401);
    expect(gone.json).toEqual(NO_SESSION);
    expect(gone.text).toBe(nobody.text);
    expect(wire(gone)).toEqual(wire(nobody));
    expect(gone.headers.get('cache-control')).toBe('no-store');
  });

  // 🔴 READ OFF THE WIRE, on both outcomes. A comment in the controller says
  // the header rides on the refusal too; this is where that sentence is
  // checked rather than believed.
  it('forbids any cache from keeping the answer — the 200 and the 401', async () => {
    const { res } = await register();
    const ok = await get('/auth/me', res.json.token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const refused = await get('/auth/me');
    expect(refused.status).toBe(401);
    expect(refused.headers.get('cache-control')).toBe('no-store');
  });

  it('is an ordinary read: thirty calls do not spend the sign-in bucket', async () => {
    const { email, res } = await register();
    const caller = nextCaller();
    for (let i = 0; i < 30; i++) {
      const r = await send('GET', '/auth/me', undefined, {
        authorization: `Bearer ${res.json.token}`,
        'cf-connecting-ip': caller,
      });
      expect(r.status).toBe(200);
    }
    // Same caller, and sign-in still answers as itself, not with a 429.
    const login = await send(
      'POST',
      '/auth/login',
      { email, password: PASSWORD },
      { 'cf-connecting-ip': caller },
    );
    expect(login.status).toBe(200);
  });
});

// ── mail that cannot be sent ─────────────────────────────────────────────

describe('when this process cannot send mail', () => {
  let bare: INestApplication;
  let bareBase: string;
  beforeAll(async () => {
    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue(null)
      .overrideProvider(WarningsService)
      .useValue(noWarnings)
      .compile();
    bare = moduleRef.createNestApplication();
    await bare.listen(0);
    bareBase = await bare.getUrl();
  });
  afterAll(async () => {
    await bare?.close();
  });

  const postBare = async (path: string, body: unknown) => {
    const res = await fetch(bareBase + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        connection: 'close',
        'cf-connecting-ip': nextCaller(),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  it('answers 503 — the same for every address — and creates no account', async () => {
    const email = unique();
    const signup = await postBare('/auth/signup', {
      email,
      password: PASSWORD,
    });
    expect(signup.status).toBe(503);
    expect(signup.json.code).toBe('mail_unavailable');
    expect(await row(email)).toBeUndefined();

    const known = (await register()).email;
    const a = await postBare('/auth/forgot', { email: known });
    const b = await postBare('/auth/forgot', { email: unique() });
    expect([a.status, b.status]).toEqual([503, 503]);
    expect(a.json).toEqual(b.json);
    expect(
      (await postBare('/auth/resend-verification', { email: known })).status,
    ).toBe(503);
  });

  it('still lets people sign in', async () => {
    const { email } = await register();
    expect(
      (await postBare('/auth/login', { email, password: PASSWORD })).status,
    ).toBe(200);
  });
});

// ── the rate limit, through the real guard ───────────────────────────────

describe('🔴 the routes that send a letter are counted in their own bucket', () => {
  const MAIL_IP = '203.0.113.201';
  const LOGIN_IP = '203.0.113.202';
  const asIp = (ip: string) => ({ 'cf-connecting-ip': ip });

  it('allows ten in ten minutes from one caller and answers the eleventh with 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push(
        (await post('/auth/forgot', { email: unique() }, asIp(MAIL_IP))).status,
      );
    expect(statuses).toEqual([...Array<number>(10).fill(202), 429]);
  });

  it('counts sign-up and "send again" in the same bucket as "forgot"', async () => {
    const ip = '203.0.113.203';
    for (let i = 0; i < 4; i++)
      await post('/auth/forgot', { email: unique() }, asIp(ip));
    for (let i = 0; i < 3; i++)
      await post('/auth/resend-verification', { email: unique() }, asIp(ip));
    for (let i = 0; i < 3; i++)
      await post(
        '/auth/signup',
        { email: unique(), password: PASSWORD },
        asIp(ip),
      );
    // Ten spent across three routes; the eleventh, on any of them, is refused.
    expect(
      (await post('/auth/forgot', { email: unique() }, asIp(ip))).status,
    ).toBe(429);
    expect(
      (await post('/auth/resend-verification', { email: unique() }, asIp(ip)))
        .status,
    ).toBe(429);
    expect(
      (
        await post(
          '/auth/signup',
          { email: unique(), password: PASSWORD },
          asIp(ip),
        )
      ).status,
    ).toBe(429);
  });

  it('a spent mail bucket leaves sign-in alone — and a spent login bucket leaves the letters alone', async () => {
    // MAIL_IP is already spent above.
    expect(
      (
        await post(
          '/auth/login',
          { email: unique(), password: PASSWORD },
          asIp(MAIL_IP),
        )
      ).status,
    ).toBe(401);

    for (let i = 0; i < 10; i++)
      await post(
        '/auth/login',
        { email: unique(), password: PASSWORD },
        asIp(LOGIN_IP),
      );
    expect(
      (
        await post(
          '/auth/login',
          { email: unique(), password: PASSWORD },
          asIp(LOGIN_IP),
        )
      ).status,
    ).toBe(429);
    expect(
      (await post('/auth/forgot', { email: unique() }, asIp(LOGIN_IP))).status,
    ).toBe(202);
  });

  it('is not spent by ordinary reading', async () => {
    const ip = '203.0.113.204';
    for (let i = 0; i < 12; i++)
      await get('/spots/countries').catch(() => undefined);
    for (let i = 0; i < 10; i++)
      expect(
        (await post('/auth/forgot', { email: unique() }, asIp(ip))).status,
      ).toBe(202);
  });

  // 🔴 A KNOWN RESIDUAL, PINNED SO THAT CLOSING IT IS A DECISION. The cooldown
  // paces an address as spelled, so one mailbox written ten ways is ten
  // addresses and ten letters; the only ceiling is this bucket — ten requests
  // in ten minutes from a caller, sixty letters an hour. Folding `+tag` and
  // dots would shrink it and would also decide who can register (dots are
  // different mailboxes at some providers): the owner's call. If this test
  // goes red because somebody added that folding, the product decision has
  // been taken — update the number here and in the comments that cite it.
  it('KNOWN RESIDUAL: ten spellings of one mailbox are ten letters into it, then the bucket', async () => {
    const ip = '203.0.113.206';
    // ONE mailbox under Gmail's rules (a `+tag` is ignored, dots are ignored),
    // written ten ways. The first draft put the tag AFTER the pid and so made
    // two mailboxes; the check below is what makes this one.
    const box = `victim${process.pid}`;
    const addresses = [
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `${box}+${n}@example.com`),
      `v.ictim${process.pid}@example.com`,
      `vi.ctim${process.pid}@example.com`,
      `vic.tim${process.pid}@example.com`,
    ];
    const mailbox = (a: string) =>
      a.replace(/\+[^@]*@/, '@').replace(/\.(?=[^@]*@)/g, '');
    expect(addresses).toHaveLength(10);
    expect(new Set(addresses).size).toBe(10);
    expect(new Set(addresses.map(mailbox))).toEqual(
      new Set([`${box}@example.com`]),
    );
    for (const a of addresses) await insertRawUser(a);
    const statuses: number[] = [];
    for (const a of addresses)
      statuses.push(
        (await post('/auth/forgot', { email: a }, asIp(ip))).status,
      );
    await settle();
    expect(statuses).toEqual(Array<number>(10).fill(202));
    // One letter each: ten letters, every one a separate address to us.
    for (const a of addresses)
      expect(lettersTo(a, 'reset_password')).toHaveLength(1);
    // And the eleventh — any spelling — is the bucket's, not the cooldown's.
    const eleventh = await post(
      '/auth/forgot',
      { email: `${box}+11@example.com` },
      asIp(ip),
    );
    expect(eleventh.status).toBe(429);
    expect(eleventh.json?.code).not.toBe('too_soon');
  });

  // verify-email is in the ordinary bucket on purpose, and the reason is not
  // "that is where it landed": the request does one indexed lookup and no hash
  // (a hash is only ever reached through a valid link, and the reset route
  // allows one per link), so there is nothing scarce to count; and guessing a
  // link is not what this bucket would stop — its length is, and that is
  // asserted above as a literal. Ten wrong clicks must not lock a person out
  // of anything else.
  it('does not count a link being followed: one lookup, no hash, nothing scarce', async () => {
    const ip = '203.0.113.205';
    for (let i = 0; i < 15; i++)
      expect(
        (await post('/auth/verify-email', { token: 'nope' }, asIp(ip))).status,
      ).toBe(410);
  });
});

// ── what the database refuses by itself ──────────────────────────────────

describe('the database holds its own line', () => {
  const insertUser = (email: string) => insertRawUser(email);

  it('refuses an address that is not lower-case and trimmed', async () => {
    await expect(insertUser('Mixed.Case@Example.com')).rejects.toThrow(
      /users_email_normalised/,
    );
    await expect(insertUser(' padded@example.com')).rejects.toThrow(
      /users_email_normalised/,
    );
    await expect(insertUser(unique())).resolves.toBeDefined();
  });

  it('refuses a link whose "hash" is not a SHA-256 digest — a raw token cannot be stored', async () => {
    const { res } = await register();
    const userId = (await row(res.json.email)).id;
    const insert = (kind: string, hash: string) =>
      db.query(
        `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, now())`,
        [userId, kind, hash],
      );
    await expect(
      insert('reset_password', 'a-raw-token-is-not-hex'),
    ).rejects.toThrow(/auth_tokens_token_hash_shape/);
    await expect(insert('reset_password', 'A'.repeat(64))).rejects.toThrow(
      /auth_tokens_token_hash_shape/,
    );
    await expect(insert('magic_link', sha256('x'))).rejects.toThrow(
      /auth_tokens_kind/,
    );
    await expect(insert('reset_password', sha256('x'))).resolves.toBeDefined();
  });

  it('refuses two links with one hash', async () => {
    const { res } = await register();
    const userId = (await row(res.json.email)).id;
    const insert = () =>
      db.query(
        `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, 'verify_email', $2, now())`,
        [userId, sha256('same')],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/idx_auth_tokens_token_hash/);
  });

  it("takes a person's links with them when the account is deleted", async () => {
    const { res } = await register();
    const userId = (await row(res.json.email)).id;
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    expect(
      (await db.query('SELECT 1 FROM auth_tokens WHERE user_id = $1', [userId]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT 1 FROM sessions WHERE user_id = $1', [userId]))
        .rows,
    ).toHaveLength(0);
  });
});

// ── a provider that fails ────────────────────────────────────────────────

describe('when the provider fails after the response has gone', () => {
  it('still answers 202, does not crash, and keeps serving', async () => {
    const { email } = await register();
    const real = box.send.bind(box);
    let attempts = 0;
    box.send = async () => {
      attempts++;
      throw new Error('provider down');
    };
    try {
      const a = await post('/auth/forgot', { email });
      expect(a.status).toBe(202);
      expect(a.text).toBe('{"accepted":true}');
      // Draining must not reject: the failure is logged and swallowed.
      await expect(settle()).resolves.toBeUndefined();
      expect(attempts).toBe(1);
    } finally {
      box.send = real;
    }
    // The process is alive and the next request is answered as usual.
    expect((await post('/auth/forgot', { email: unique() })).status).toBe(202);
  });
});

describe('🔴 shutting down does not lose the letters already promised', () => {
  it('waits for the deferred letter before the database goes away', async () => {
    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue({ sender, webBase: WEB })
      .overrideProvider(WarningsService)
      .useValue(noWarnings)
      .compile();
    const second = moduleRef.createNestApplication();
    await second.listen(0);
    const url = await second.getUrl();

    const email = unique();
    await insertRawUser(email);
    latencyMs = 300;
    try {
      const res = await fetch(`${url}/auth/forgot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          connection: 'close',
          'cf-connecting-ip': nextCaller(),
        },
        body: JSON.stringify({ email }),
      });
      expect(res.status).toBe(202);
      await res.text();
      // The letter is still on its way (300 ms) when the app is told to stop.
      expect(lettersTo(email)).toHaveLength(0);
      await second.close();
    } finally {
      latencyMs = 0;
    }
    expect(lettersTo(email, 'reset_password')).toHaveLength(1);
  });
});

// ── the migration itself ─────────────────────────────────────────────────

describe('the migration can be taken back and applied again', () => {
  it('drops what it added, and adds it again', async () => {
    const name = `${dbName}_mig`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${name}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await migrateEverything(client);
      const runner = {
        query: async (sql: string, params?: unknown[]) =>
          (await client.query(sql, params)).rows,
      } as unknown as QueryRunner;
      const { AccountEmail1791600000000 } =
        await import('../migrations/1791600000000-AccountEmail');

      const state = async () => ({
        columns: (
          await client.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_name = 'users' ORDER BY column_name`,
          )
        ).rows.map((r) => r.column_name as string),
        tokens: (await client.query(`SELECT to_regclass('auth_tokens') AS t`))
          .rows[0].t as string | null,
        check: (
          await client.query(
            `SELECT 1 FROM pg_constraint WHERE conname = 'users_email_normalised'`,
          )
        ).rowCount,
      });

      const applied = await state();
      expect(applied.columns).toEqual(
        expect.arrayContaining(['email_verified_at', 'marketing_consent_at']),
      );
      expect(applied.tokens).toBe('auth_tokens');
      expect(applied.check).toBe(1);

      await new AccountEmail1791600000000().down(runner);
      const removed = await state();
      expect(removed.columns).not.toContain('email_verified_at');
      expect(removed.columns).not.toContain('marketing_consent_at');
      expect(removed.tokens).toBeNull();
      expect(removed.check).toBe(0);

      await new AccountEmail1791600000000().up(runner);
      expect(await state()).toEqual(applied);
    } finally {
      await client.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  });
});
