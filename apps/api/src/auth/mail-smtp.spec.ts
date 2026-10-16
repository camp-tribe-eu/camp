import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import tls from 'node:tls';
import { parse as parseDotenv } from 'dotenv';
import { createTransport } from 'nodemailer';
import {
  DevMailbox,
  mailBootLine,
  mailerFrom,
  resetPasswordMessage,
  verifyEmailMessage,
  type MailMessage,
} from './mail';
import {
  DEFAULT_FROM_NAME,
  SMTP_REQUIRED_VARS,
  SmtpMailer,
  SmtpSendFailed,
  smtpConfigFrom,
  smtpSenderFrom,
  smtpTransportOptions,
  type SmtpConfig,
  type SmtpTransport,
} from './mail-smtp';

// CAMP-110 — the real sender, SMTP through nodemailer.
//
// 🔴 NO LETTER IS SENT BY ANYTHING HERE. The password is not in this file and
// is not available to it: where a test needs "a password" it is a random
// string made fresh each run, which also makes it a canary — if it turns up in
// a reason, a log line or an error, something printed what it must not.
//
// Two kinds of transport are used. `fake` records what it is given. A real
// nodemailer `streamTransport` composes the actual message and hands back the
// raw MIME, so what is checked about a letter is what nodemailer would put on
// the wire, not a copy of what this code meant to say.

const CANARY = `pw-${randomBytes(12).toString('hex')}`;

const SMTP_ENV: Record<string, string> = {
  MAIL_PROVIDER: 'smtp',
  WEB_BASE_URL: 'https://site.example',
  SMTP_HOST: 'smtp.test.example',
  SMTP_PORT: '587',
  SMTP_USER: 'login-for-tests',
  SMTP_PASSWORD: CANARY,
  MAIL_FROM: 'noreply@camptribe.eu',
  MAIL_FROM_NAME: 'CampTribe',
  MAIL_REPLY_TO: 'hello@camptribe.eu',
};

// 🔴 THE CORPUS IS WRITTEN OUT HERE, NOT IMPORTED. Iterating the code's own
// `SMTP_REQUIRED_VARS` would shrink the test together with the code: drop a
// variable from that list and its three cases would silently not exist.
const REQUIRED = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'MAIL_REPLY_TO',
] as const;

const without = (name: string): Record<string, string> => {
  const env = { ...SMTP_ENV };
  delete env[name];
  return env;
};

function configOf(env: Record<string, string> = SMTP_ENV): SmtpConfig {
  const r = smtpConfigFrom(env);
  if (!r.config) throw new Error(`test setup: ${r.why}`);
  return r.config;
}

type Recorded = { sent: unknown[] };
// `failure` is wrapped so that "fail with undefined" can be told from "do not fail".
const fake = (failure?: { with: unknown }): SmtpTransport & Recorded => ({
  sent: [],
  async sendMail(data) {
    this.sent.push(data);
    if (failure) throw failure.with;
    return {};
  },
});

describe('MAIL_PROVIDER=smtp: the settings', () => {
  it('is configured when everything is set, and sends through SmtpMailer', () => {
    const r = mailerFrom(SMTP_ENV);
    expect(r.why).toBeUndefined();
    expect(r.mailer?.sender).toBeInstanceOf(SmtpMailer);
    expect(r.mailer?.webBase).toBe('https://site.example');
  });

  // 🔴 ONE CASE PER VARIABLE, THREE WAYS OF BEING ABSENT. Through
  // `mailerFrom`, so it is the `if` in mail.ts that is exercised and not only
  // the helper behind it. `why` must be exactly one name: a reason that
  // listed all six would hide which one is wrong.
  describe.each(REQUIRED)('%s missing', (name) => {
    it.each([
      ['not set at all', (env: Record<string, string>) => env],
      [
        'set to an empty string',
        (env: Record<string, string>) => ({ ...env, [name]: '' }),
      ],
      [
        'set to blanks only',
        (env: Record<string, string>) => ({ ...env, [name]: '   ' }),
      ],
    ])('%s: NOT configured, and the reason names it', (_how, shape) => {
      const r = mailerFrom(shape(without(name)));
      expect(r.mailer).toBeNull();
      expect(r.why).toBe(`MAIL_PROVIDER=smtp needs these set: ${name}`);
    });
  });

  it('requires exactly these six, and no more', () => {
    expect([...SMTP_REQUIRED_VARS]).toEqual([...REQUIRED]);
  });

  it('lists every missing variable at once, in a fixed order', () => {
    const r = mailerFrom({
      MAIL_PROVIDER: 'smtp',
      WEB_BASE_URL: 'https://site.example',
    });
    expect(r.mailer).toBeNull();
    expect(r.why).toBe(
      'MAIL_PROVIDER=smtp needs these set: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM, MAIL_REPLY_TO',
    );
  });

  it('never falls back to the dev mailbox, whatever is missing', () => {
    const box = new DevMailbox(() => undefined);
    for (const name of REQUIRED) {
      const r = mailerFrom(without(name), box);
      expect(r.mailer).toBeNull();
    }
    expect(box.sent).toHaveLength(0);
  });

  it('keeps MAIL_FROM_NAME optional: absent, it is CampTribe', () => {
    expect(configOf(without('MAIL_FROM_NAME')).fromName).toBe(
      DEFAULT_FROM_NAME,
    );
    expect(configOf({ ...SMTP_ENV, MAIL_FROM_NAME: '  ' }).fromName).toBe(
      DEFAULT_FROM_NAME,
    );
    expect(
      configOf({ ...SMTP_ENV, MAIL_FROM_NAME: 'Camp Tribe' }).fromName,
    ).toBe('Camp Tribe');
  });

  // The site address is checked before the provider is looked at, as for
  // `dev`; this pins that `smtp` did not slip in above that check.
  it('still needs the site to link to', () => {
    const r = mailerFrom({ ...SMTP_ENV, WEB_BASE_URL: '' });
    expect(r.mailer).toBeNull();
    expect(r.why).toBe('WEB_BASE_URL is missing or is not an http(s) URL');
  });

  // Only `dev` is refused in production; the real sender is what production
  // is for.
  it('is configured under NODE_ENV=production', () => {
    const r = mailerFrom({ ...SMTP_ENV, NODE_ENV: 'production' });
    expect(r.mailer?.sender).toBeInstanceOf(SmtpMailer);
  });

  it('is matched exactly, like the provider names around it', () => {
    for (const provider of ['SMTP', 'Smtp', 'smtps']) {
      const r = mailerFrom({ ...SMTP_ENV, MAIL_PROVIDER: provider });
      expect(r.mailer).toBeNull();
      expect(r.why).toBe(
        `MAIL_PROVIDER=${provider} has no sender in this build (CAMP-110)`,
      );
    }
    expect(
      mailerFrom({ ...SMTP_ENV, MAIL_PROVIDER: ' smtp ' }).mailer,
    ).not.toBeNull();
  });
});

describe('MAIL_PROVIDER=smtp: values that are present but wrong', () => {
  it.each([
    ['SMTP_HOST', 'smtp://smtp.test.example', /SMTP_HOST must be a bare host/],
    ['SMTP_HOST', 'smtp.test.example:587', /SMTP_HOST must be a bare host/],
    ['SMTP_HOST', 'user:pw@smtp.test.example', /SMTP_HOST must be a bare host/],
    ['SMTP_HOST', 'smtp.test.example/x', /SMTP_HOST must be a bare host/],
    ['SMTP_HOST', 'two words', /SMTP_HOST must be a bare host/],
    ['SMTP_PORT', '25', /SMTP_PORT must be 465/],
    ['SMTP_PORT', '2525', /SMTP_PORT must be 465/],
    ['SMTP_PORT', '587x', /SMTP_PORT must be 465/],
    ['SMTP_PORT', '0587', /SMTP_PORT must be 465/],
    ['SMTP_PORT', '465.0', /SMTP_PORT must be 465/],
    ['SMTP_PORT', 'abc', /SMTP_PORT must be 465/],
    // Names every object has: a lookup table would call these ports.
    ['SMTP_PORT', 'constructor', /SMTP_PORT must be 465/],
    ['SMTP_PORT', 'toString', /SMTP_PORT must be 465/],
    ['SMTP_PORT', '__proto__', /SMTP_PORT must be 465/],
    [
      'MAIL_FROM',
      'CampTribe <noreply@camptribe.eu>',
      /MAIL_FROM must be one plain address/,
    ],
    [
      'MAIL_FROM',
      'a@camptribe.eu, b@camptribe.eu',
      /MAIL_FROM must be one plain address/,
    ],
    ['MAIL_FROM', 'noreply', /MAIL_FROM must be one plain address/],
    [
      'MAIL_REPLY_TO',
      'Hello <hello@camptribe.eu>',
      /MAIL_REPLY_TO must be one plain address/,
    ],
    [
      'MAIL_REPLY_TO',
      'hello@camptribe.eu;x@y.eu',
      /MAIL_REPLY_TO must be one plain address/,
    ],
  ])('%s=%j is NOT configured', (name, value, reason) => {
    const r = mailerFrom({ ...SMTP_ENV, [name]: value });
    expect(r.mailer).toBeNull();
    expect(r.why).toMatch(reason);
  });

  it.each([['465'], ['587'], [' 587 ']])('accepts port %j', (value) => {
    expect(mailerFrom({ ...SMTP_ENV, SMTP_PORT: value }).mailer).not.toBeNull();
  });

  // 🔴 A value pasted into the wrong line must not come out in the boot log.
  // The canary is put in the wrong place of every variable that is checked.
  it.each([
    ['SMTP_HOST', `smtp://${CANARY}@h.example`],
    ['SMTP_PORT', CANARY],
    ['MAIL_FROM', `${CANARY} <noreply@camptribe.eu>`],
    ['MAIL_REPLY_TO', `${CANARY} <hello@camptribe.eu>`],
  ])('%s: the reason does not quote the value', (name, value) => {
    const r = mailerFrom({ ...SMTP_ENV, [name]: value });
    expect(r.mailer).toBeNull();
    expect(r.why).toContain(name);
    expect(r.why).not.toContain(CANARY);
  });
});

describe('the password', () => {
  // The canary is SMTP_PASSWORD in every environment below, and none of the
  // things this code prints may contain it.
  const bad: Record<string, string>[] = [
    ...REQUIRED.filter((n) => n !== 'SMTP_PASSWORD').map(without),
    { ...SMTP_ENV, SMTP_PORT: '25' },
    { ...SMTP_ENV, SMTP_HOST: 'smtp://x' },
    { ...SMTP_ENV, MAIL_FROM: 'not an address' },
    { ...SMTP_ENV, WEB_BASE_URL: '' },
    { ...SMTP_ENV, MAIL_PROVIDER: 'resend' },
  ];

  it('is not in the reason or the boot line of any misconfiguration', () => {
    for (const env of bad) {
      expect(env.SMTP_PASSWORD).toBe(CANARY);
      const r = mailerFrom(env);
      expect(r.mailer).toBeNull();
      expect(r.why).not.toContain(CANARY);
      expect(mailBootLine(r, env.MAIL_PROVIDER)).not.toContain(CANARY);
    }
  });

  it('is not in the boot line of a working configuration either', () => {
    const line = mailBootLine(mailerFrom(SMTP_ENV), 'smtp');
    expect(line).toContain('provider: smtp');
    expect(line).not.toContain(CANARY);
  });

  it('is kept as typed, spaces included, but blanks alone are "not set"', () => {
    expect(configOf({ ...SMTP_ENV, SMTP_PASSWORD: ' a b ' }).pass).toBe(
      ' a b ',
    );
    expect(smtpConfigFrom({ ...SMTP_ENV, SMTP_PASSWORD: '   ' }).why).toBe(
      'MAIL_PROVIDER=smtp needs these set: SMTP_PASSWORD',
    );
  });
});

describe('the boot line for a missing setting', () => {
  it('says NOT CONFIGURED and names the variable', () => {
    const env = without('SMTP_USER');
    const line = mailBootLine(mailerFrom(env), 'smtp');
    expect(line).toContain('NOT CONFIGURED');
    expect(line).toContain('SMTP_USER');
    expect(line).toContain('503');
  });
});

describe('starting up', () => {
  // 🔴 Building the sender must not open a connection and must not throw: a
  // wrong `.env` is a line in the boot log, not an API that will not start.
  it('opens no socket when the sender is built', async () => {
    const spies = [
      jest.spyOn(net, 'connect'),
      jest.spyOn(net, 'createConnection'),
      jest.spyOn(tls, 'connect'),
    ];
    try {
      // An address, so that a connection attempt would not wait on DNS; and
      // a pause, so that one started in the background would be seen.
      const r = mailerFrom({ ...SMTP_ENV, SMTP_HOST: '127.0.0.1' });
      expect(r.mailer?.sender).toBeInstanceOf(SmtpMailer);
      await new Promise((resolve) => setTimeout(resolve, 150));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('does not throw for any combination of the variables', () => {
    const values: (string | undefined)[] = [
      undefined,
      '',
      ' ',
      'x',
      '465',
      '587',
    ];
    for (const a of values)
      for (const b of values)
        for (const c of values)
          expect(() =>
            mailerFrom({
              MAIL_PROVIDER: 'smtp',
              WEB_BASE_URL: 'https://site.example',
              SMTP_HOST: a,
              SMTP_PORT: b,
              SMTP_USER: c,
            }),
          ).not.toThrow();
  });

  it('turns a transport that refuses its options into a reason, not a crash', () => {
    const r = smtpSenderFrom(SMTP_ENV, () => {
      throw new Error(`refused ${CANARY}`);
    });
    expect(r.sender).toBeNull();
    expect(r.why).toBe('the SMTP transport could not be created');
    expect(r.why).not.toContain(CANARY);
  });
});

describe('what nodemailer is told', () => {
  const opts = (port: string) =>
    smtpTransportOptions(configOf({ ...SMTP_ENV, SMTP_PORT: port }));

  it('465 is TLS from the first byte', () => {
    const o = opts('465');
    expect(o.secure).toBe(true);
    expect(o.requireTLS).toBe(false);
  });

  // 🔴 `requireTLS` is what makes 587 safe: without it a server that does not
  // offer STARTTLS gets the password in plain text.
  it('587 is STARTTLS, and refuses to go on without it', () => {
    const o = opts('587');
    expect(o.secure).toBe(false);
    expect(o.requireTLS).toBe(true);
  });

  it.each(['465', '587'])(
    'on %s: certificate checked, modern TLS, the login',
    (port) => {
      const o = opts(port);
      expect(o.host).toBe('smtp.test.example');
      expect(o.port).toBe(Number(port));
      expect(o.tls.rejectUnauthorized).toBe(true);
      expect(o.tls.minVersion).toBe('TLSv1.2');
      expect(o.auth).toEqual({ user: 'login-for-tests', pass: CANARY });
    },
  );

  // 🔴 nodemailer's SMTP debug output contains the AUTH exchange.
  it.each(['465', '587'])('on %s: nothing is logged', (port) => {
    const o = opts(port);
    expect(o.logger).toBe(false);
    expect(o.debug).toBe(false);
    expect(o.transactionLog).toBe(false);
  });

  it.each(['465', '587'])(
    'on %s: no way into plain text, no URL, no pool',
    (port) => {
      const o: Record<string, unknown> = opts(port);
      for (const key of [
        'ignoreTLS',
        'opportunisticTLS',
        'url',
        'pool',
        'service',
      ])
        expect(key in o).toBe(false);
    },
  );

  it('gives up in seconds, not minutes', () => {
    const o = opts('587');
    for (const ms of [
      o.connectionTimeout,
      o.greetingTimeout,
      o.socketTimeout,
      o.dnsTimeout,
    ]) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(60_000);
    }
  });

  it('reads no file and no URL from a message, and sends to one recipient', () => {
    const o = opts('587');
    expect(o.disableFileAccess).toBe(true);
    expect(o.disableUrlAccess).toBe(true);
    expect(o.maxRecipients).toBe(1);
  });

  it('is what smtpSenderFrom hands to the transport factory', () => {
    const seen: unknown[] = [];
    smtpSenderFrom(SMTP_ENV, (o) => {
      seen.push(o);
      return fake();
    });
    expect(seen).toEqual([smtpTransportOptions(configOf())]);
  });

  // The real library accepts every option above: building it does not throw.
  it.each(['465', '587'])(
    'is accepted by the real nodemailer on %s',
    (port) => {
      expect(
        () => new SmtpMailer(configOf({ ...SMTP_ENV, SMTP_PORT: port })),
      ).not.toThrow();
    },
  );
});

// ── what leaves, read from nodemailer's own output ─────────────────────────

type Part = { headers: Map<string, string>; body: string };

function headersOf(block: string): Map<string, string> {
  const map = new Map<string, string>();
  let last = '';
  for (const line of block.split('\n')) {
    if (/^[ \t]/.test(line) && last)
      map.set(last, `${map.get(last)} ${line.trim()}`);
    else {
      const i = line.indexOf(':');
      last = line.slice(0, i).toLowerCase();
      map.set(last, line.slice(i + 1).trim());
    }
  }
  return map;
}

function decode(body: string, encoding: string | undefined): string {
  switch ((encoding ?? '7bit').toLowerCase()) {
    case 'base64':
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    case 'quoted-printable': {
      const bytes: number[] = [];
      const joined = body.replace(/=\n/g, '');
      for (let i = 0; i < joined.length; i++) {
        if (
          joined[i] === '=' &&
          /^[0-9A-F]{2}$/.test(joined.slice(i + 1, i + 3))
        ) {
          bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
          i += 2;
        } else bytes.push(...Buffer.from(joined[i], 'utf8'));
      }
      return Buffer.from(bytes).toString('utf8');
    }
    default:
      return body;
  }
}

function parseMime(raw: string): {
  headers: Map<string, string>;
  parts: Part[];
} {
  const split = (s: string): [string, string] => {
    const i = s.indexOf('\n\n');
    return [s.slice(0, i), s.slice(i + 2)];
  };
  const [head, body] = split(raw);
  const headers = headersOf(head);
  const boundary = /boundary="?([^";\s]+)"?/.exec(
    headers.get('content-type') ?? '',
  )?.[1];
  if (!boundary) throw new Error('not a multipart message');
  const parts = body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const [h, b] = split(chunk.replace(/^\n/, ''));
      const ph = headersOf(h);
      return {
        headers: ph,
        body: decode(b, ph.get('content-transfer-encoding')),
      };
    });
  return { headers, parts };
}

async function onTheWire(message: MailMessage, config = configOf()) {
  const stream = createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  let envelope: unknown;
  const capture: SmtpTransport = {
    async sendMail(data) {
      const info = await stream.sendMail(data);
      envelope = info.envelope;
      raw = info.message.toString('utf8');
      return info;
    },
  };
  let raw = '';
  await new SmtpMailer(config, capture).send(message);
  return { envelope, ...parseMime(raw), raw };
}

describe('the letter, as nodemailer composes it', () => {
  const LINK = 'https://site.example/verify-email?t=abc-DEF_123';
  const letters: [string, MailMessage][] = [
    ['verify_email', verifyEmailMessage('anna@example.eu', LINK)],
    ['reset_password', resetPasswordMessage('anna@example.eu', LINK)],
  ];

  it.each(letters)(
    '%s: from the project mailbox, replies to hello@',
    async (_k, message) => {
      const { headers, envelope } = await onTheWire(message);
      expect(headers.get('from')).toBe('CampTribe <noreply@camptribe.eu>');
      expect(headers.get('reply-to')).toBe('hello@camptribe.eu');
      expect(headers.get('to')).toBe('anna@example.eu');
      expect(headers.get('subject')).toBe(message.subject);
      expect(envelope).toEqual({
        from: 'noreply@camptribe.eu',
        to: ['anna@example.eu'],
      });
    },
  );

  it.each(letters)('%s: no copy goes anywhere else', async (_k, message) => {
    const { headers } = await onTheWire(message);
    for (const h of ['cc', 'bcc', 'sender']) expect(headers.has(h)).toBe(false);
  });

  it.each(letters)(
    '%s: the text and the html parts are the letter, link included',
    async (_k, message) => {
      const { parts } = await onTheWire(message);
      const text = parts.find((p) =>
        /text\/plain/.test(p.headers.get('content-type') ?? ''),
      );
      const html = parts.find((p) =>
        /text\/html/.test(p.headers.get('content-type') ?? ''),
      );
      expect(text?.body.trimEnd()).toBe(message.text);
      expect(html?.body.trimEnd()).toBe(message.html);
      expect(text?.body).toContain(LINK);
      expect(html?.body).toContain(LINK);
    },
  );

  it('follows the configured addresses, not constants in the class', async () => {
    const config = configOf({
      ...SMTP_ENV,
      MAIL_FROM: 'sender@other.example',
      MAIL_FROM_NAME: 'Other Name',
      MAIL_REPLY_TO: 'answers@other.example',
    });
    const { headers, envelope } = await onTheWire(letters[0][1], config);
    expect(headers.get('from')).toBe('Other Name <sender@other.example>');
    expect(headers.get('reply-to')).toBe('answers@other.example');
    expect(envelope).toEqual({
      from: 'sender@other.example',
      to: ['anna@example.eu'],
    });
  });

  it.each([
    ['anna+tag@example.eu', 'anna+tag@example.eu'],
    ["o'brien@example.ie", "o'brien@example.ie"],
    ['a.b-c_d@sub.example.eu', 'a.b-c_d@sub.example.eu'],
    ['anna@jõgeva.ee', 'anna@xn--jgeva-dua.ee'],
  ])('a real address, %s, is sent to as %s', async (to, on) => {
    const { envelope } = await onTheWire(verifyEmailMessage(to, LINK));
    expect(envelope).toEqual({ from: 'noreply@camptribe.eu', to: [on] });
  });
});

describe('an address that is not one plain address', () => {
  // 🔴 The recipient was typed by a person, and nodemailer's address parser is
  // where its advisories have been. Each of these must stop in SmtpMailer —
  // the transport must never see it — and none may add a recipient.
  const hostile = [
    'anna@example.eu\r\nBcc: victim@example.eu',
    'anna@example.eu\nBcc: victim@example.eu',
    'anna@example.eu,victim@example.eu',
    'anna@example.eu;victim@example.eu',
    // One `@`, so only the separator itself can stop these.
    'anna,victim@example.eu',
    'anna;victim@example.eu',
    'anna@example.eu,',
    'Anna <anna@example.eu>',
    '<anna@example.eu>',
    'foo<anna@example.eu>',
    '"anna"@example.eu',
    'anna@example.eu>',
    // The characters an address parser reads as structure. Comments in
    // particular are where nodemailer's `GHSA-g57g-f23g-4646` was.
    'anna(comment)@example.eu',
    'anna@[127.0.0.1]',
    'group:anna@example.eu',
    'anna\\x@example.eu',
    'anna@example.eu\u0000',
    'anna@example.eu\u007f',
    'an na@example.eu',
    'anna@@example.eu',
    'anna',
    '@example.eu',
    'anna@',
    '',
    `${'a'.repeat(250)}@example.eu`,
  ];

  it.each(hostile)('%j is refused before the transport', async (to) => {
    const transport = fake();
    const mailer = new SmtpMailer(configOf(), transport);
    await expect(
      mailer.send(verifyEmailMessage(to, 'https://x.example/y')),
    ).rejects.toMatchObject({
      name: 'SmtpSendFailed_EADDRESS',
    });
    expect(transport.sent).toHaveLength(0);
  });

  it('is refused when it is not even a string', async () => {
    const transport = fake();
    const mailer = new SmtpMailer(configOf(), transport);
    for (const to of [undefined, null, 42, ['a@b.eu'], { address: 'a@b.eu' }]) {
      const message = {
        ...verifyEmailMessage('a@b.eu', 'https://x.example/y'),
        to,
      } as unknown as MailMessage;
      await expect(mailer.send(message)).rejects.toBeInstanceOf(SmtpSendFailed);
    }
    expect(transport.sent).toHaveLength(0);
  });

  it('hands the transport a single address as an object, never a string to parse', async () => {
    const transport = fake();
    await new SmtpMailer(configOf(), transport).send(
      verifyEmailMessage('anna@example.eu', 'https://x.example/y'),
    );
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      to: { name: '', address: 'anna@example.eu' },
      from: { name: 'CampTribe', address: 'noreply@camptribe.eu' },
      replyTo: { name: '', address: 'hello@camptribe.eu' },
    });
  });
});

describe('a send that fails', () => {
  const RECIPIENT = 'anna.privacy-canary@example.eu';
  const letter = verifyEmailMessage(RECIPIENT, 'https://x.example/y');

  const attempt = async (failure: unknown): Promise<Error> => {
    try {
      await new SmtpMailer(configOf(), fake({ with: failure })).send(letter);
    } catch (e) {
      return e as Error;
    }
    throw new Error('send() did not fail');
  };

  // 🔴 The raw error the way nodemailer builds it: the server's own words, the
  // recipient and the credentials' neighbours all inside it.
  const raw = (code: string) =>
    Object.assign(
      new Error(`Invalid login: 535 5.7.8 ${RECIPIENT} ${CANARY}`),
      {
        code,
        command: 'AUTH PLAIN',
        response: `535 5.7.8 Authentication failed for ${RECIPIENT} ${CANARY}`,
        responseCode: 535,
      },
    );

  it('keeps the code in the NAME — the only thing the service logs', async () => {
    const e = await attempt(raw('EAUTH'));
    expect(e).toBeInstanceOf(SmtpSendFailed);
    expect(e.name).toBe('SmtpSendFailed_EAUTH');
  });

  it.each([
    'ECONNECTION',
    'ETIMEDOUT',
    'ESOCKET',
    'EENVELOPE',
    'EDNS',
    'ETLS',
    'ECONNREFUSED',
  ])('%s', async (code) => {
    expect((await attempt(raw(code))).name).toBe(`SmtpSendFailed_${code}`);
  });

  it("carries nothing of the server's reply, the recipient or the password", async () => {
    const e = await attempt(raw('EAUTH'));
    const everything = JSON.stringify({
      name: e.name,
      message: e.message,
      stack: e.stack,
      own: Object.getOwnPropertyNames(e).map((k) => String((e as never)[k])),
    });
    for (const secret of [
      RECIPIENT,
      CANARY,
      'Invalid login',
      '535 5.7.8',
      'AUTH PLAIN',
    ])
      expect(everything).not.toContain(secret);
    expect('cause' in e).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['a string', `boom ${RECIPIENT}`],
    ['null', null],
    ['no code', new Error(RECIPIENT)],
    ['a lower-case code', Object.assign(new Error('x'), { code: 'eauth' })],
    [
      'a code with a newline',
      Object.assign(new Error('x'), { code: 'EAUTH\nX' }),
    ],
    [
      'a code that is a sentence',
      Object.assign(new Error('x'), { code: `EVIL ${RECIPIENT}` }),
    ],
    ['a non-string code', Object.assign(new Error('x'), { code: 535 })],
  ])('%s becomes EUNKNOWN', async (_label, failure) => {
    const e = await attempt(failure);
    expect(e.name).toBe('SmtpSendFailed_EUNKNOWN');
    expect(`${e.name} ${e.message}`).not.toContain(RECIPIENT);
  });

  // The error shape above is what a stub believes nodemailer does. This is
  // what it does: a real connection refused by a port nobody listens on.
  it('is classified from a real nodemailer failure', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const real = createTransport({
      ...smtpTransportOptions(configOf()),
      host: '127.0.0.1',
      port,
      requireTLS: false,
      secure: false,
    });
    const e = await new SmtpMailer(configOf(), real)
      .send(letter)
      .catch((x: Error) => x);
    expect(e).toBeInstanceOf(SmtpSendFailed);
    expect((e as Error).name).toMatch(/^SmtpSendFailed_E[A-Z]+$/);
    expect((e as Error).name).not.toBe('SmtpSendFailed_EUNKNOWN');
    expect(`${(e as Error).message} ${(e as Error).stack}`).not.toContain(
      RECIPIENT,
    );
    expect(`${(e as Error).message} ${(e as Error).stack}`).not.toContain(
      CANARY,
    );
  });
});

// ── the real library, against a server that cannot do TLS ──────────────────
//
// 🔴 The option checks above say what was ASKED of nodemailer. This says what
// it DOES, on a local socket, with a server that speaks only plain text — the
// situation `requireTLS` and `secure` exist for. What is read is what the
// SERVER received, byte for byte: if the password ever left in the clear it
// is in `raw`, and so is the `AUTH` verb.

type PlainServer = {
  port: number;
  raw: () => string;
  close: () => Promise<void>;
};

async function plainServer(): Promise<PlainServer> {
  let received = '';
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => undefined);
    sock.write('220 plain.test ESMTP\r\n');
    sock.on('data', (chunk) => {
      const text = chunk.toString('latin1');
      received += text;
      for (const line of text.split('\r\n')) {
        if (/^EHLO/i.test(line))
          sock.write('250-plain.test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^STARTTLS/i.test(line))
          sock.write('502 5.5.1 no STARTTLS here\r\n');
        else if (/^AUTH PLAIN/i.test(line)) sock.write('235 ok\r\n');
        else if (/^(MAIL|RCPT|RSET|NOOP)/i.test(line)) sock.write('250 ok\r\n');
        else if (/^QUIT/i.test(line)) sock.end('221 bye\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    raw: () => received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const sock of sockets) sock.destroy();
        server.close(() => resolve());
      }),
  };
}

describe('the real nodemailer, against a server that speaks only plain text', () => {
  const password64 = Buffer.from(`\0login-for-tests\0${CANARY}`).toString(
    'base64',
  );
  const letter = verifyEmailMessage('anna@example.eu', 'https://x.example/y');

  const tryPort = async (configured: '465' | '587') => {
    const server = await plainServer();
    try {
      const config = configOf({ ...SMTP_ENV, SMTP_PORT: configured });
      // Only WHERE to connect is replaced; every other option is the one
      // `smtpTransportOptions` produced for this port.
      const real = createTransport({
        ...smtpTransportOptions(config),
        host: '127.0.0.1',
        port: server.port,
      });
      const failure = await new SmtpMailer(config, real).send(letter).then(
        () => null,
        (e: Error) => e,
      );
      return { failure, raw: server.raw() };
    } finally {
      await server.close();
    }
  };

  // 🔴 587 without `requireTLS` is the quiet failure: the server does not
  // offer STARTTLS, nodemailer carries on in plain text, and the login goes
  // over the wire as base64. Measured: that is exactly what happens.
  it('587: refuses to go on without STARTTLS, and the login never leaves', async () => {
    const { failure, raw } = await tryPort('587');
    expect(failure).toBeInstanceOf(SmtpSendFailed);
    expect(raw).toContain('EHLO');
    expect(raw).not.toMatch(/^AUTH/im);
    expect(raw).not.toContain(password64);
    expect(raw).not.toContain(CANARY);
    expect(raw).not.toMatch(/^(MAIL|RCPT|DATA)/im);
  });

  it('465: does not fall back to plain text either', async () => {
    const { failure, raw } = await tryPort('465');
    expect(failure).toBeInstanceOf(SmtpSendFailed);
    expect(raw).not.toMatch(/AUTH/i);
    expect(raw).not.toContain(password64);
    expect(raw).not.toContain(CANARY);
    expect(raw).not.toMatch(/^(EHLO|MAIL|RCPT|DATA)/im);
  });
});

describe('.env.example, read as written', () => {
  const text = readFileSync(join(__dirname, '../../.env.example'), 'utf8');
  const example = parseDotenv(text);

  it.each([...REQUIRED, 'MAIL_FROM_NAME'])('declares %s once', (name) => {
    const lines = text.split('\n').filter((l) => l.startsWith(`${name}=`));
    expect(lines).toHaveLength(1);
  });

  // 🔴 The repository is public. Whatever else is in this file, the password
  // line is empty, and a test is what keeps it empty.
  it('has an empty password', () => {
    expect(example.SMTP_PASSWORD).toBe('');
  });

  it('is a configuration that is complete except for the two values only the owner has', () => {
    const r = smtpConfigFrom({ ...example, MAIL_PROVIDER: 'smtp' });
    expect(r.config).toBeNull();
    expect(r.why).toBe(
      'MAIL_PROVIDER=smtp needs these set: SMTP_USER, SMTP_PASSWORD',
    );
  });

  it('becomes a working configuration once those two are filled', () => {
    const config = configOf({
      ...example,
      MAIL_PROVIDER: 'smtp',
      WEB_BASE_URL: 'https://site.example',
      SMTP_USER: 'login-for-tests',
      SMTP_PASSWORD: CANARY,
    });
    expect(config.host).toBe('www784.your-server.de');
    expect([465, 587]).toContain(config.port);
    expect(config.from).toBe('noreply@camptribe.eu');
    expect(config.replyTo).toBe('hello@camptribe.eu');
  });
});
