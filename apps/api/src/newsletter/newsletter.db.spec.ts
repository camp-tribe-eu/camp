import { createHash } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { MAILER } from '../auth/account.service';
import type { MailMessage, Mailer } from '../auth/mail';
import { NewsletterSubscribers1798040000000 } from '../migrations/1798040000000-NewsletterSubscribers';
import { DEFAULT_LIMIT } from '../throttle';
import { ApiThrottlerGuard } from '../throttle.guard';
import { NewsletterController } from './newsletter.controller';
import {
  CONFIRM_TTL_HOURS,
  NewsletterService,
  PENDING_KEPT_DAYS,
  RESEND_GAP_MINUTES,
} from './newsletter.service';

// Підписка на листи — проти СПРАВЖНЬОЇ таблиці й справжнього застосунку.
// Усе, що ендпоїнт обіцяє, — про рядки, які лишаються в Postgres, і про рядки,
// яких немає; заглушка бачила б ні те, ні інше. Той самий стенд, що
// `problem-reports.db.spec.ts`: власна база `campnews_<pid>_<time>`, міграція
// таблиці, прибирання за собою.
//
// 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПАДІННЯ, А НЕ ПРОПУСК. Потрібна CAMP_TEST_DATABASE_URL
// (локально) або CI_DATABASE_URL: будь-яка база, у якій можна CREATE DATABASE.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(60_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;
let sent: MailMessage[];
let failSend = false;
let deliveries: Array<Promise<void>> = [];
const savedEnv = {
  WEB: process.env.WEB_BASE_URL,
  API: process.env.NEXT_PUBLIC_API_BASE_URL,
  TRUST: process.env.TRUST_PROXY_CLIENT_IP,
};

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostgreSQL database you may CREATE DATABASE in).\n' +
        'This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `campnews_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  // 🔴 Таблицю створює САМА міграція, а не копія її SQL у тесті.
  await new NewsletterSubscribers1798040000000().up({
    query: async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params)).rows,
  } as unknown as QueryRunner);

  process.env.WEB_BASE_URL = 'https://camptribe.eu';
  process.env.NEXT_PUBLIC_API_BASE_URL = 'https://camptribe.eu/api';
  process.env.TRUST_PROXY_CLIENT_IP = '1';
  const mailer: Mailer = {
    sender: {
      send: async (m) => {
        if (failSend) throw new Error(`smtp down for ${m.to}`);
        sent.push(m);
      },
    },
    webBase: 'https://camptribe.eu',
  };
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: url.toString(),
        entities: [],
      }),
      ThrottlerModule.forRoot([DEFAULT_LIMIT]),
    ],
    controllers: [NewsletterController],
    providers: [
      NewsletterService,
      { provide: MAILER, useValue: mailer },
      { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  base = await app.getUrl();

  // Лист іде у фоні (так задумано) — тести чекають на нього, а не вгадують.
  const real = NewsletterService.prototype.subscribe;
  jest
    .spyOn(NewsletterService.prototype, 'subscribe')
    .mockImplementation(async function (this: NewsletterService, ...a) {
      const r = await real.apply(this, a);
      deliveries.push(r.delivery);
      return r;
    });
});

afterAll(async () => {
  jest.restoreAllMocks();
  await app?.close();
  await db?.end();
  if (admin) {
    if (dbName)
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
  for (const [k, v] of [
    ['WEB_BASE_URL', savedEnv.WEB],
    ['NEXT_PUBLIC_API_BASE_URL', savedEnv.API],
    ['TRUST_PROXY_CLIENT_IP', savedEnv.TRUST],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  sent = [];
  failSend = false;
  deliveries = [];
  await db.query('DELETE FROM newsletter_subscribers');
});

// Кожен виклик — інший абонент, щоб відро `mail` тут не заважало іншим тестам.
let callers = 0;
const nextCaller = () => `198.51.100.${(callers++ % 250) + 1}`;

async function subscribe(email: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/newsletter`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': nextCaller(),
    },
    body: JSON.stringify({ email, leaveBlank: '', elapsedMs: 9000, ...extra }),
  });
  const text = await res.text();
  await Promise.all(deliveries);
  deliveries = [];
  return { status: res.status, text };
}

const follow = async (link: string) => {
  // Посилання з листа веде на публічну адресу; тут той самий шлях — на наш сокет.
  const path =
    new URL(link).pathname.replace(/^\/api/, '') + new URL(link).search;
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') };
};

const tokens = (m: MailMessage) => ({
  confirmLink: /(https:\/\/\S+\/newsletter\/confirm\?token=[\w-]+)/.exec(
    m.text,
  )![1],
  unsubLink: /(https:\/\/\S+\/newsletter\/unsubscribe\?token=[\w-]+)/.exec(
    m.text,
  )![1],
  confirm: /confirm\?token=([\w-]+)/.exec(m.text)![1],
  unsub: /unsubscribe\?token=([\w-]+)/.exec(m.text)![1],
});

const row = async (email: string) =>
  (
    await db.query('SELECT * FROM newsletter_subscribers WHERE email = $1', [
      email,
    ])
  ).rows[0];
const count = async () =>
  Number(
    (await db.query('SELECT count(*) FROM newsletter_subscribers')).rows[0]
      .count,
  );

describe('a new address', () => {
  it('🔴 gets ONE letter, and the row is pending with the HASH of the token — never the token', async () => {
    const res = await subscribe('Anna@Example.EU');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('anna@example.eu');
    expect(sent[0].kind).toBe('newsletter_confirm');
    const t = tokens(sent[0]);
    expect(t.confirm.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
    expect(t.unsub.length).toBeGreaterThanOrEqual(43);
    expect(t.confirm).not.toBe(t.unsub);
    // The link points at the API's public address, not at the request's host.
    expect(
      t.confirmLink.startsWith(
        'https://camptribe.eu/api/newsletter/confirm?token=',
      ),
    ).toBe(true);

    const r = await row('anna@example.eu');
    expect(r.status).toBe('pending');
    expect(r.confirm_token_hash).toBe(sha(t.confirm));
    expect(r.unsubscribe_token_hash).toBe(sha(t.unsub));
    // The raw tokens are in the letter and NOWHERE in the row.
    const whole = JSON.stringify(r);
    expect(whole).not.toContain(t.confirm);
    expect(whole).not.toContain(t.unsub);
    expect(r.confirmed_at).toBeNull();
    expect(r.unsubscribed_at).toBeNull();
    // Expires in 48 hours, measured by the database's own clock.
    const { rows } = await db.query(
      `SELECT extract(epoch FROM (confirm_token_expires_at - now())) AS s
         FROM newsletter_subscribers WHERE email = $1`,
      ['anna@example.eu'],
    );
    expect(Math.round(rows[0].s / 3600)).toBe(CONFIRM_TTL_HOURS);
  });

  it('the table refuses what the code never writes (the CHECKs are real)', async () => {
    await expect(
      db.query(
        `INSERT INTO newsletter_subscribers (email) VALUES ('Upper@Example.EU')`,
      ),
    ).rejects.toThrow(/newsletter_email_lower/);
    await expect(
      db.query(
        `INSERT INTO newsletter_subscribers (email, status) VALUES ('a@example.eu', 'maybe')`,
      ),
    ).rejects.toThrow(/newsletter_status/);
    await expect(
      db.query(
        `INSERT INTO newsletter_subscribers (email, confirm_token_hash) VALUES ('a@example.eu', 'rawtoken')`,
      ),
    ).rejects.toThrow(/newsletter_confirm_hash_shape/);
  });

  it('the columns are exactly the ones the policy names: no IP, no browser, no account', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'newsletter_subscribers' ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'confirm_token_expires_at',
      'confirm_token_hash',
      'confirmed_at',
      'created_at',
      'email',
      'id',
      'status',
      'unsubscribe_token_hash',
      'unsubscribed_at',
    ]);
  });

  it('upper and lower case are the same address: one row', async () => {
    await subscribe('Anna@Example.EU');
    await db.query(
      `UPDATE newsletter_subscribers SET confirm_token_expires_at = now() - interval '1 hour'`,
    );
    await subscribe('anna@example.eu');
    expect(await count()).toBe(1);
  });
});

describe('🔴 the answer does not say who is on the list', () => {
  it('new, pending (just asked), confirmed and unsubscribed get the SAME status and the SAME body', async () => {
    const replies: Array<{ status: number; text: string }> = [];
    // new
    replies.push(await subscribe('a@example.eu'));
    // pending, a letter went a moment ago
    replies.push(await subscribe('a@example.eu'));
    // confirmed
    await subscribe('b@example.eu');
    const b = tokens(sent[sent.length - 1]);
    expect((await follow(b.confirmLink)).location).toBe(
      'https://camptribe.eu/newsletter/confirmed',
    );
    replies.push(await subscribe('b@example.eu'));
    // unsubscribed
    await subscribe('c@example.eu');
    const c = tokens(sent[sent.length - 1]);
    await follow(c.unsubLink);
    replies.push(await subscribe('c@example.eu'));

    for (const r of replies) {
      expect(r.status).toBe(200);
      expect(r.text).toBe(replies[0].text);
    }
    expect(replies[0].text).toBe('{"ok":true}');
  });

  it('a pending address just asked, and a confirmed one, get NO second letter', async () => {
    await subscribe('a@example.eu');
    await subscribe('a@example.eu');
    expect(sent).toHaveLength(1);

    await subscribe('b@example.eu');
    await follow(tokens(sent[1]).confirmLink);
    await subscribe('b@example.eu');
    expect(sent).toHaveLength(2);
    expect((await row('b@example.eu')).status).toBe('confirmed');
  });

  it(`a pending address asked again after ${RESEND_GAP_MINUTES} minutes gets a new letter, and the OLD link dies`, async () => {
    await subscribe('a@example.eu');
    const first = tokens(sent[0]);
    await db.query(
      `UPDATE newsletter_subscribers
          SET confirm_token_expires_at = now() + ($1 * interval '1 hour') - ($2 * interval '1 minute' + interval '1 minute')`,
      [CONFIRM_TTL_HOURS, RESEND_GAP_MINUTES],
    );
    await subscribe('a@example.eu');
    expect(sent).toHaveLength(2);
    const second = tokens(sent[1]);
    expect(second.confirm).not.toBe(first.confirm);
    expect((await follow(first.confirmLink)).location).toBe(
      'https://camptribe.eu/newsletter/link-invalid',
    );
    expect((await row('a@example.eu')).status).toBe('pending');
    expect((await follow(second.confirmLink)).location).toBe(
      'https://camptribe.eu/newsletter/confirmed',
    );
  });

  it('a pending address asked again just BEFORE the gap gets nothing', async () => {
    await subscribe('a@example.eu');
    await db.query(
      `UPDATE newsletter_subscribers
          SET confirm_token_expires_at = now() + ($1 * interval '1 hour') - ($2 * interval '1 minute' - interval '1 minute')`,
      [CONFIRM_TTL_HOURS, RESEND_GAP_MINUTES],
    );
    await subscribe('a@example.eu');
    expect(sent).toHaveLength(1);
  });
});

describe('confirm', () => {
  it('a good link confirms: status, date, and the token is spent (single use)', async () => {
    await subscribe('a@example.eu');
    const t = tokens(sent[0]);
    const ok = await follow(t.confirmLink);
    expect(ok).toEqual({
      status: 302,
      location: 'https://camptribe.eu/newsletter/confirmed',
    });
    const r = await row('a@example.eu');
    expect(r.status).toBe('confirmed');
    expect(r.confirmed_at).toBeInstanceOf(Date);
    expect(r.confirm_token_hash).toBeNull();
    expect(r.confirm_token_expires_at).toBeNull();
    // The second click on the same link says it is not valid, and changes nothing.
    const again = await follow(t.confirmLink);
    expect(again.location).toBe('https://camptribe.eu/newsletter/link-invalid');
    expect((await row('a@example.eu')).confirmed_at).toEqual(r.confirmed_at);
  });

  it('🔴 an EXPIRED token fails and the address stays pending, not confirmed', async () => {
    await subscribe('a@example.eu');
    const t = tokens(sent[0]);
    await db.query(
      `UPDATE newsletter_subscribers SET confirm_token_expires_at = now() - interval '1 second'`,
    );
    expect((await follow(t.confirmLink)).location).toBe(
      'https://camptribe.eu/newsletter/link-invalid',
    );
    const r = await row('a@example.eu');
    expect(r.status).toBe('pending');
    expect(r.confirmed_at).toBeNull();
  });

  it('an unknown (well-formed) token fails and changes nothing', async () => {
    await subscribe('a@example.eu');
    const res = await follow(
      `https://camptribe.eu/api/newsletter/confirm?token=${'A'.repeat(43)}`,
    );
    expect(res.location).toBe('https://camptribe.eu/newsletter/link-invalid');
    expect((await row('a@example.eu')).status).toBe('pending');
  });

  it('the UNSUBSCRIBE token cannot confirm, and the confirm token cannot unsubscribe', async () => {
    await subscribe('a@example.eu');
    const t = tokens(sent[0]);
    const wrong = await follow(
      `https://camptribe.eu/api/newsletter/confirm?token=${t.unsub}`,
    );
    expect(wrong.location).toBe('https://camptribe.eu/newsletter/link-invalid');
    expect((await row('a@example.eu')).status).toBe('pending');
    const wrong2 = await follow(
      `https://camptribe.eu/api/newsletter/unsubscribe?token=${t.confirm}`,
    );
    expect(wrong2.location).toBe(
      'https://camptribe.eu/newsletter/link-invalid',
    );
    expect((await row('a@example.eu')).status).toBe('pending');
  });
});

describe('unsubscribe', () => {
  it('sets unsubscribed with a date, from pending and from confirmed alike', async () => {
    await subscribe('a@example.eu');
    const a = tokens(sent[0]);
    expect((await follow(a.unsubLink)).location).toBe(
      'https://camptribe.eu/newsletter/unsubscribed',
    );
    const ra = await row('a@example.eu');
    expect(ra.status).toBe('unsubscribed');
    expect(ra.unsubscribed_at).toBeInstanceOf(Date);
    expect(ra.confirm_token_hash).toBeNull();

    await subscribe('b@example.eu');
    const b = tokens(sent[1]);
    await follow(b.confirmLink);
    expect((await row('b@example.eu')).status).toBe('confirmed');
    await follow(b.unsubLink);
    expect((await row('b@example.eu')).status).toBe('unsubscribed');
  });

  it('the link keeps working after the address is confirmed, and a second click is harmless (first date kept)', async () => {
    await subscribe('a@example.eu');
    const t = tokens(sent[0]);
    await follow(t.confirmLink);
    await follow(t.unsubLink);
    const first = (await row('a@example.eu')).unsubscribed_at;
    await new Promise((r) => setTimeout(r, 20));
    expect((await follow(t.unsubLink)).location).toBe(
      'https://camptribe.eu/newsletter/unsubscribed',
    );
    expect((await row('a@example.eu')).unsubscribed_at).toEqual(first);
  });

  it('an unknown token unsubscribes nobody — and does not claim it did', async () => {
    await subscribe('a@example.eu');
    const res = await follow(
      `https://camptribe.eu/api/newsletter/unsubscribe?token=${'B'.repeat(43)}`,
    );
    expect(res.location).toBe('https://camptribe.eu/newsletter/link-invalid');
    expect((await row('a@example.eu')).status).toBe('pending');
  });

  it('asking again after unsubscribing is a NEW request: pending, a new letter, the old links dead', async () => {
    await subscribe('a@example.eu');
    const t1 = tokens(sent[0]);
    await follow(t1.unsubLink);
    await subscribe('a@example.eu');
    expect(sent).toHaveLength(2);
    const r = await row('a@example.eu');
    expect(r.status).toBe('pending');
    expect(r.unsubscribed_at).toBeNull();
    const t2 = tokens(sent[1]);
    expect(r.confirm_token_hash).toBe(sha(t2.confirm));
    expect((await follow(t1.unsubLink)).location).toBe(
      'https://camptribe.eu/newsletter/link-invalid',
    );
  });
});

describe(`an address nobody confirms is deleted after ${PENDING_KEPT_DAYS} days — on the next subscribe or confirm`, () => {
  const insertAged = (email: string, status: string, days: number) =>
    db.query(
      `INSERT INTO newsletter_subscribers (email, status, created_at)
       VALUES ($1, $2, now() - ($3 * interval '1 day'))`,
      [email, status, days],
    );

  it('deletes pending ones older than the term, keeps pending ones inside it, and NEVER touches confirmed or unsubscribed ones', async () => {
    await insertAged(
      'old-pending@example.eu',
      'pending',
      PENDING_KEPT_DAYS + 1,
    );
    await insertAged(
      'fresh-pending@example.eu',
      'pending',
      PENDING_KEPT_DAYS - 1,
    );
    await insertAged('old-confirmed@example.eu', 'confirmed', 400);
    await insertAged('old-unsub@example.eu', 'unsubscribed', 400);
    await subscribe('someone@example.eu');
    const left = (
      await db.query('SELECT email FROM newsletter_subscribers ORDER BY email')
    ).rows.map((r) => r.email);
    expect(left).toEqual([
      'fresh-pending@example.eu',
      'old-confirmed@example.eu',
      'old-unsub@example.eu',
      'someone@example.eu',
    ]);
  });

  it('a confirm click does the same cleanup', async () => {
    await subscribe('a@example.eu');
    await insertAged(
      'old-pending@example.eu',
      'pending',
      PENDING_KEPT_DAYS + 1,
    );
    await follow(tokens(sent[0]).confirmLink);
    expect(await row('old-pending@example.eu')).toBeUndefined();
  });

  it('asking again does NOT extend the term: it counts from the FIRST request', async () => {
    await subscribe('a@example.eu');
    await db.query(
      `UPDATE newsletter_subscribers
          SET created_at = now() - interval '6 days',
              confirm_token_expires_at = now() - interval '1 hour'`,
    );
    await subscribe('a@example.eu');
    const age = (
      await db.query(
        `SELECT extract(epoch FROM (now() - created_at)) / 86400 AS d FROM newsletter_subscribers`,
      )
    ).rows[0].d;
    expect(Math.round(age)).toBe(6);
  });
});

describe('a script, and a sender that is down', () => {
  it('a filled trap stores NOTHING and sends nothing, with the same 200', async () => {
    const res = await subscribe('bot@example.eu', { leaveBlank: 'x' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('{"ok":true}');
    expect(await count()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('when the letter cannot be sent the answer is still 200, nothing is logged about the person, and a retry sends at once', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    failSend = true;
    const res = await subscribe('a@example.eu');
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('a@example.eu');
    warn.mockRestore();

    failSend = false;
    await subscribe('a@example.eu');
    expect(sent).toHaveLength(1);
    expect(await count()).toBe(1);
  });
});
