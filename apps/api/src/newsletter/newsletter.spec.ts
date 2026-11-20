import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MAILER } from '../auth/account.service';
import {
  newsletterConfirmMessage,
  type MailMessage,
  type Mailer,
} from '../auth/mail';
import { DEFAULT_LIMIT, MAIL_LIMIT } from '../throttle';
import { ApiThrottlerGuard } from '../throttle.guard';
import { NewsletterController } from './newsletter.controller';
import { MIN_FILL_MS } from './newsletter.rules';
import { CONFIRM_TTL_HOURS, NewsletterService } from './newsletter.service';

// Підписка на листи — крізь справжній Nest-застосунок, справжній сокет і
// справжній throttler. Бази тут НЕМАЄ навмисно: `db` — заглушка, яка ЛІЧИТЬ
// звернення й нічого не повертає, бо те, що доводять ці тести, — це відмови й
// відповіді, які до бази не доходять. Усе, що залежить від рядків, —
// `newsletter.db.spec.ts` на справжньому Postgres.

const good = { email: 'anna@example.eu', leaveBlank: '', elapsedMs: 9000 };

let app: INestApplication;
let base: string;
let sent: MailMessage[];
let dbCalls: string[];

async function boot(opts: { mailer?: Mailer | null } = {}) {
  sent = [];
  dbCalls = [];
  const mailer: Mailer | null =
    opts.mailer === undefined
      ? {
          sender: {
            send: async (m) => {
              sent.push(m);
            },
          },
          webBase: 'https://camptribe.eu',
        }
      : opts.mailer;
  const db = {
    query: async (sql: string) => {
      dbCalls.push(sql);
      return [];
    },
  };
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([DEFAULT_LIMIT])],
    controllers: [NewsletterController],
    providers: [
      NewsletterService,
      { provide: MAILER, useValue: mailer },
      { provide: getDataSourceToken(), useValue: db },
      { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  base = await app.getUrl();
}

async function post(body: unknown) {
  const res = await fetch(`${base}/newsletter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

const get = (path: string) => fetch(`${base}${path}`, { redirect: 'manual' });

afterEach(async () => {
  await app?.close();
});

describe('POST /newsletter — what never reaches the database', () => {
  beforeEach(() => boot());

  it('a script (filled trap) gets the same 200 as a person, and NOTHING happens', async () => {
    const res = await post({ ...good, leaveBlank: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(dbCalls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('a script (too fast) gets the same 200, and nothing happens', async () => {
    const res = await post({ ...good, elapsedMs: MIN_FILL_MS - 1 });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(dbCalls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('a bad address is a 400 with a field error, and touches nothing', async () => {
    const res = await post({ ...good, email: 'not-an-address' });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({
      code: 'invalid_subscription',
      errors: [{ field: 'email', code: 'invalid' }],
    });
    expect(dbCalls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('an unknown field is a 400, not silently dropped', async () => {
    const res = await post({ ...good, name: 'Anna' });
    expect(res.status).toBe(400);
    expect(dbCalls).toEqual([]);
  });
});

describe('POST /newsletter — no sender', () => {
  it('is 503 for EVERY address (it depends on configuration only), and touches nothing', async () => {
    await boot({ mailer: null });
    const a = await post(good);
    const b = await post({ ...good, email: 'someone-else@example.eu' });
    expect(a.status).toBe(503);
    expect(b.status).toBe(503);
    expect(a.json).toMatchObject({ code: 'mail_unavailable' });
    expect(dbCalls).toEqual([]);
  });
});

describe('the mail bucket (a letter to an address the caller typed)', () => {
  beforeEach(() => boot());

  it(`${MAIL_LIMIT.limit} are answered, the next is 429`, async () => {
    const codes: number[] = [];
    for (let i = 0; i < MAIL_LIMIT.limit + 2; i++)
      codes.push((await post(good)).status);
    expect(codes).toEqual([
      ...Array<number>(MAIL_LIMIT.limit).fill(200),
      429,
      429,
    ]);
  });
});

const postLink = (which: 'confirm' | 'unsubscribe', body: unknown) =>
  fetch(`${base}/newsletter/${which}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('the links in the letter open a PAGE; only a POST changes anything', () => {
  beforeEach(() => boot());

  it.each(['confirm', 'unsubscribe'] as const)(
    '🔴 GET /newsletter/%s does not exist: 404, and the database is never asked',
    async (which) => {
      const res = await get(`/newsletter/${which}?token=${'a'.repeat(43)}`);
      expect(res.status).toBe(404);
      expect(dbCalls).toEqual([]);
    },
  );

  it.each(['confirm', 'unsubscribe'] as const)(
    'POST /newsletter/%s with junk is a 400 invalid_link and never asks the database',
    async (which) => {
      for (const body of [
        {},
        { token: '' },
        { token: 'abc' },
        { token: `${'a'.repeat(43)}!` },
        { token: ['a'.repeat(43)] },
        { token: 'a'.repeat(43), extra: 1 },
        [],
      ]) {
        const res = await postLink(which, body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'invalid_link' });
      }
      expect(dbCalls).toEqual([]);
    },
  );

  it('the token is read from the BODY: the same token in the query string does nothing', async () => {
    const res = await fetch(
      `${base}/newsletter/confirm?token=${'a'.repeat(43)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );
    expect(res.status).toBe(400);
    expect(dbCalls).toEqual([]);
  });

  it('a well-formed but unknown token is a 400 (the stub finds no row)', async () => {
    const res = await postLink('confirm', { token: 'a'.repeat(43) });
    expect(res.status).toBe(400);
    expect(dbCalls.length).toBeGreaterThan(0);
  });
});

describe('the confirmation letter', () => {
  const confirm = 'https://camptribe.eu/newsletter/confirm?token=AAA';
  const unsub = 'https://camptribe.eu/newsletter/unsubscribe?token=BBB';
  const privacy = 'https://camptribe.eu/legal/privacy#newsletter';
  const m = newsletterConfirmMessage(
    'anna@example.eu',
    confirm,
    unsub,
    privacy,
    CONFIRM_TTL_HOURS,
  );

  it('carries both links, the privacy section and the lifetime, in text AND html', () => {
    for (const part of [m.text, m.html]) {
      expect(part).toContain(confirm);
      expect(part).toContain(unsub);
      expect(part).toContain(privacy);
      expect(part).toContain(`${CONFIRM_TTL_HOURS} hours`);
    }
  });

  it('says «do nothing» before it says «confirm», and says nothing is subscribed yet', () => {
    expect(m.text.indexOf('do nothing')).toBeGreaterThan(-1);
    expect(m.text.indexOf('do nothing')).toBeLessThan(m.text.indexOf(confirm));
    expect(m.text).toContain('you are not subscribed');
    // …and says that opening the link is not enough.
    expect(m.text).toContain('Opening the link changes nothing by itself');
    expect(m.text).toContain('“Confirm my subscription”');
    expect(m.text).toContain('press “Unsubscribe”');
  });

  it('is its own kind, goes to the one address, and does not set a reply-to', () => {
    expect(m.kind).toBe('newsletter_confirm');
    expect(m.to).toBe('anna@example.eu');
    expect(m.replyTo).toBeUndefined();
  });

  it('escapes the links in html: a token with a quote cannot end the attribute', () => {
    const evil = newsletterConfirmMessage(
      'a@example.eu',
      'https://x.example/?t="><script>',
      unsub,
      privacy,
      48,
    );
    expect(evil.html).not.toContain('"><script>');
    expect(evil.html).toContain('&quot;&gt;&lt;script&gt;');
  });
});
