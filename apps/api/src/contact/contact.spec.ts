import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { MAILER } from '../auth/account.service';
import {
  CONTACT_SUBJECT_PREFIX,
  contactMessage,
  type MailMessage,
  type Mailer,
} from '../auth/mail';
import { DEFAULT_LIMIT, MAIL_LIMIT } from '../throttle';
import { ApiThrottlerGuard } from '../throttle.guard';
import { ContactController } from './contact.controller';
import { MIN_FILL_MS } from './contact.rules';
import { ContactService } from './contact.service';

// «Write to us» — through a real Nest application over a real socket, with
// the real guard and the real throttler. Only the SMTP transport is a
// stand-in: a sender that records what it was asked to send. What is read in
// every test is the LETTER (or its absence), not a return value.

const OWNER_BOX = 'hello@camptribe.eu';
const VISITOR = 'anna@example.eu';

const good = {
  name: 'Anna Novak',
  email: VISITOR,
  subject: 'A closed campsite',
  message: 'Camping du Lac has been closed since 2024, the gate is chained.',
  leaveBlank: '',
  elapsedMs: 9000,
};

let app: INestApplication;
let base: string;
let sent: MailMessage[];
const saved = process.env.MAIL_REPLY_TO;

type Sender = { send(m: MailMessage): Promise<void> };

async function boot(opts: { sender?: Sender | null } = {}) {
  sent = [];
  process.env.MAIL_REPLY_TO = OWNER_BOX;
  const sender: Sender | null =
    opts.sender === undefined
      ? {
          send: async (m) => {
            sent.push(m);
          },
        }
      : opts.sender;
  const mailer: Mailer | null = sender
    ? { sender, webBase: 'https://camptribe.eu' }
    : null;
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([DEFAULT_LIMIT])],
    controllers: [ContactController],
    providers: [
      ContactService,
      { provide: MAILER, useValue: mailer },
      { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  base = await app.getUrl();
}

async function post(body: unknown, raw?: string) {
  const res = await fetch(`${base}/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json: json as Record<string, unknown> | null };
}

afterEach(async () => {
  await app?.close();
  if (saved === undefined) delete process.env.MAIL_REPLY_TO;
  else process.env.MAIL_REPLY_TO = saved;
  jest.restoreAllMocks();
});

describe('POST /contact — the letter', () => {
  beforeEach(() => boot());

  it('a good message becomes ONE letter, to the project mailbox, answerable to the visitor', async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.to).toBe(OWNER_BOX);
    expect(m.replyTo).toBe(VISITOR);
    expect(m.kind).toBe('contact_message');
    expect(m.subject).toBe(`${CONTACT_SUBJECT_PREFIX}A closed campsite`);
    expect(m.text).toContain(good.message);
    expect(m.text).toContain('Anna Novak');
    expect(m.text).toContain(VISITOR);
  });

  it('the subject is optional, and the letter still has a prefixed subject', async () => {
    const res = await post({ ...good, subject: '' });
    expect(res.status).toBe(200);
    expect(sent[0].subject.startsWith(CONTACT_SUBJECT_PREFIX)).toBe(true);
    expect(sent[0].subject.length).toBeGreaterThan(
      CONTACT_SUBJECT_PREFIX.length,
    );
  });

  it('a message with line breaks keeps them, and is HTML-escaped in the html part', async () => {
    const message = 'line one\nline two <script>alert(1)</script> & "q"';
    const res = await post({ ...good, message });
    expect(res.status).toBe(200);
    expect(sent[0].text).toContain('line one\nline two');
    expect(sent[0].html).not.toContain('<script>');
    expect(sent[0].html).toContain('&lt;script&gt;');
    expect(sent[0].html).toContain('&amp;');
  });
});

describe('POST /contact — refusals send nothing', () => {
  beforeEach(() => boot());

  const long = (n: number) => 'x'.repeat(n);

  it.each([
    ['an empty body', {}],
    ['no name', { ...good, name: '' }],
    ['a blank name', { ...good, name: '   ' }],
    ['no email', { ...good, email: '' }],
    ['no message', { ...good, message: '' }],
    ['a too short message', { ...good, message: 'hi' }],
    ['a name over 100', { ...good, name: long(101) }],
    ['an email over 254', { ...good, email: `${long(250)}@e.eu` }],
    ['a subject over 150', { ...good, subject: long(151) }],
    ['a message over 5000', { ...good, message: long(5001) }],
    ['a name that is not text', { ...good, name: 5 }],
    ['an email that is not text', { ...good, email: ['a@b.eu'] }],
    ['an email without a domain dot', { ...good, email: 'anna@localhost' }],
    ['an email with no @', { ...good, email: 'anna.example.eu' }],
    ['an email with two addresses', { ...good, email: 'a@b.eu,c@d.eu' }],
    ['an email with a display name', { ...good, email: 'Anna <a@b.eu>' }],
    ['an unknown field', { ...good, bcc: 'x@y.eu' }],
  ])('%s → 400, no letter', async (_what, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.json?.code).toBe('invalid_message');
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['CRLF in the name', { ...good, name: 'Anna\r\nBcc: spy@evil.example' }],
    ['LF in the name', { ...good, name: 'Anna\nBcc: spy@evil.example' }],
    ['CR in the subject', { ...good, subject: 'Hi\rBcc: spy@evil.example' }],
    [
      'CRLF in the subject',
      { ...good, subject: 'Hi\r\nBcc: spy@evil.example' },
    ],
    [
      'CRLF in the email',
      { ...good, email: 'a@b.eu\r\nBcc: spy@evil.example' },
    ],
    ['LF inside the email', { ...good, email: 'a@b.eu\nBcc:x@y.eu' }],
    ['U+2028 in the subject', { ...good, subject: 'Hi\u2028Bcc: x' }],
    ['NUL in the name', { ...good, name: 'Anna\u0000' }],
    ['NUL in the message', { ...good, message: 'hello there\u0000 friend' }],
  ])('%s → 400, no letter', async (_what, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('every problem is listed at once, by field', async () => {
    const res = await post({ name: '', email: 'nope', message: 'x' });
    expect(res.status).toBe(400);
    const fields = (res.json?.errors as { field: string }[]).map(
      (e) => e.field,
    );
    expect(fields.sort()).toEqual(['email', 'message', 'name']);
  });

  it('a body that is not JSON, or not an object → 400', async () => {
    expect((await post(null, '{broken')).status).toBe(400);
    expect((await post([good])).status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe('POST /contact — scripts are told «thank you» and nothing is sent', () => {
  beforeEach(() => boot());

  it('a filled honeypot → 200 and no letter', async () => {
    const res = await post({ ...good, leaveBlank: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it('a honeypot holding only a space still counts', async () => {
    const res = await post({ ...good, leaveBlank: ' ' });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('a form open for less than the minimum → 200 and no letter; at the minimum → sent', async () => {
    const fast = await post({ ...good, elapsedMs: MIN_FILL_MS - 1 });
    expect(fast.status).toBe(200);
    expect(sent).toHaveLength(0);
    const ok = await post({ ...good, elapsedMs: MIN_FILL_MS });
    expect(ok.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('no elapsedMs at all (a script that never ran the page) → 200 and no letter', async () => {
    const { elapsedMs: _drop, ...noTime } = good;
    void _drop;
    const res = await post(noTime);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('a non-numeric or negative elapsedMs is a script too', async () => {
    for (const elapsedMs of ['9000', -5, null]) {
      const res = await post({ ...good, elapsedMs });
      expect(res.status).toBe(200);
    }
    expect(sent).toHaveLength(0);
  });
});

describe('POST /contact — the limit', () => {
  beforeEach(() => boot());

  it(`${MAIL_LIMIT.limit} are answered, the next is 429 and sends nothing`, async () => {
    const codes: number[] = [];
    for (let i = 0; i < MAIL_LIMIT.limit + 2; i++)
      codes.push((await post(good)).status);
    expect(codes).toEqual([
      ...Array<number>(MAIL_LIMIT.limit).fill(200),
      429,
      429,
    ]);
    expect(sent).toHaveLength(MAIL_LIMIT.limit);
  });

  it('a refused (400) message also spends the counter — a bot cannot probe for free', async () => {
    const codes: number[] = [];
    for (let i = 0; i < MAIL_LIMIT.limit + 1; i++)
      codes.push((await post({})).status);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('POST /contact — when mail cannot be sent', () => {
  afterEach(() => undefined);

  it('no sender configured → 503, honest code', async () => {
    await boot({ sender: null });
    const res = await post(good);
    expect(res.status).toBe(503);
    expect(res.json?.code).toBe('mail_unavailable');
  });

  it('a sender that fails → 503, and the log names the class only', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const err = Object.assign(
      new Error(`550 refused ${VISITOR} ${good.message}`),
      {
        name: 'SmtpSendFailed_ECONNECTION',
      },
    );
    await boot({
      sender: {
        send: async () => {
          throw err;
        },
      },
    });
    const res = await post(good);
    expect(res.status).toBe(503);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('SmtpSendFailed_ECONNECTION');
    expect(logged).not.toContain(VISITOR);
    expect(logged).not.toContain('Camping du Lac');
  });

  it('no usable MAIL_REPLY_TO → 503, never a letter to nowhere', async () => {
    await boot();
    process.env.MAIL_REPLY_TO = 'not an address';
    const res = await post(good);
    expect(res.status).toBe(503);
    expect(sent).toHaveLength(0);
  });

  it('a spam message is still «thanks» when mail is down (the bot learns nothing)', async () => {
    await boot({ sender: null });
    const res = await post({ ...good, leaveBlank: 'x' });
    expect(res.status).toBe(200);
  });
});

describe('contactMessage — the visitor is data, never a header (second wall)', () => {
  it('collapses a line break in the subject and the name, so no extra header line can be made', () => {
    const m = contactMessage(OWNER_BOX, {
      name: 'Anna\r\nBcc: spy@evil.example',
      email: VISITOR,
      subject: 'Hi\r\nBcc: spy@evil.example\u2028x',
      message: 'hello there, friend',
    });
    expect(m.subject).not.toMatch(/[\r\n\u2028]/);
    expect(m.subject.startsWith(CONTACT_SUBJECT_PREFIX)).toBe(true);
    // the first two lines of the text part are the header-like lines: one each
    const [from, subject] = m.text.split('\n');
    expect(from.startsWith('From: Anna')).toBe(true);
    expect(subject.startsWith('Subject: Hi')).toBe(true);
    expect(m.text.split('\n').some((l) => /^Bcc:/i.test(l))).toBe(false);
  });
});
