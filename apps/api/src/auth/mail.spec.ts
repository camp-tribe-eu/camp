import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DevMailbox,
  LINK_PATH,
  LINK_TTL_MS,
  linkFor,
  mailBootLine,
  mailerFrom,
  resetPasswordMessage,
  verifyEmailMessage,
  webBaseFrom,
} from './mail';

// CAMP-228 — the mail seam, and the two letters.
//
// 🔴 There is no real provider yet (CAMP-110), so what is checked here is the
// part that exists: which environments may send at all, that the dev mailbox
// can never be the quiet default of a deployment, and what the letters say.

const ENV = { MAIL_PROVIDER: 'dev', WEB_BASE_URL: 'https://site.example' };

describe('which environment may send mail', () => {
  it('sends in dev, linking to the configured site', () => {
    const r = mailerFrom(ENV);
    expect(r.mailer?.webBase).toBe('https://site.example');
    expect(r.why).toBeUndefined();
  });

  // 🔴 The whole reason `dev` is opt-in: a default that fell back to a
  // mailbox in a deployment nobody configured would eat every reset link
  // and answer 200.
  it('is NOT configured by default, however much else is set', () => {
    for (const env of [
      {},
      { WEB_BASE_URL: 'https://site.example' },
      { WEB_BASE_URL: 'https://site.example', NODE_ENV: 'test' },
      { WEB_BASE_URL: 'https://site.example', NODE_ENV: 'development' },
      { MAIL_PROVIDER: '', WEB_BASE_URL: 'https://site.example' },
      { MAIL_PROVIDER: '   ', WEB_BASE_URL: 'https://site.example' },
    ]) {
      const r = mailerFrom(env);
      expect(r.mailer).toBeNull();
      expect(r.why).toBe('MAIL_PROVIDER is not set');
    }
  });

  it('refuses the dev mailbox in production, even when asked for it', () => {
    const r = mailerFrom({ ...ENV, NODE_ENV: 'production' });
    expect(r.mailer).toBeNull();
    expect(r.why).toBe('MAIL_PROVIDER=dev is refused when NODE_ENV=production');
  });

  it('refuses a provider this build has no sender for, and names CAMP-110', () => {
    for (const provider of ['resend', 'smtp2go', 'DEV', 'devv']) {
      const r = mailerFrom({ ...ENV, MAIL_PROVIDER: provider });
      expect(r.mailer).toBeNull();
      expect(r.why).toBe(
        `MAIL_PROVIDER=${provider} has no sender in this build (CAMP-110)`,
      );
    }
  });

  it('tolerates stray spaces around the provider name', () => {
    expect(
      mailerFrom({ ...ENV, MAIL_PROVIDER: ' dev ' }).mailer,
    ).not.toBeNull();
  });

  it('is not configured without a site to link to', () => {
    for (const WEB_BASE_URL of [
      undefined,
      '',
      'not a url',
      'ftp://x.example',
    ]) {
      const r = mailerFrom({ MAIL_PROVIDER: 'dev', WEB_BASE_URL });
      expect(r.mailer).toBeNull();
      expect(r.why).toBe('WEB_BASE_URL is missing or is not an http(s) URL');
    }
  });

  it('hands letters to the sender it was given', async () => {
    const box = new DevMailbox(() => undefined);
    const r = mailerFrom(ENV, box);
    await r.mailer!.sender.send(verifyEmailMessage('a@b.co', 'https://x/y'));
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0].to).toBe('a@b.co');
  });
});

describe('the origin letters link to', () => {
  it.each([
    ['https://site.example', 'https://site.example'],
    ['https://site.example/', 'https://site.example'],
    ['https://site.example/some/path?x=1#h', 'https://site.example'],
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['  https://site.example  ', 'https://site.example'],
    // Credentials and paths cannot reshape a link.
    ['https://user:pw@site.example/x', 'https://site.example'],
  ])('%s → %s', (raw, origin) => {
    expect(webBaseFrom(raw)).toBe(origin);
  });

  it.each([
    undefined,
    '',
    '  ',
    'site.example',
    'javascript:alert(1)',
    'ftp://x',
  ])('is null for %p', (raw) => {
    expect(webBaseFrom(raw)).toBeNull();
  });
});

describe('the links in the letters', () => {
  it('are the base, the page, and the token', () => {
    expect(linkFor('https://site.example', 'reset_password', 'TOKEN-1_x')).toBe(
      'https://site.example/reset-password?t=TOKEN-1_x',
    );
    expect(linkFor('https://site.example', 'verify_email', 'TOKEN-1_x')).toBe(
      'https://site.example/verify-email?t=TOKEN-1_x',
    );
  });

  it('encode a token that is not URL-safe, rather than splice it', () => {
    expect(linkFor('https://s.example', 'verify_email', 'a&b=c d')).toBe(
      'https://s.example/verify-email?t=a%26b%3Dc%20d',
    );
  });

  // 🔴 A link in an email that 404s is a broken flow that nobody sees: the
  // letter is sent, the person clicks, and the site has no such page. The two
  // paths live here and the pages live in apps/web — two lists of one fact.
  it.each(Object.entries(LINK_PATH))(
    '%s points at a page that exists in the site',
    (_kind, path) => {
      const page = join(__dirname, '../../../web/src/app', path, 'page.tsx');
      expect(existsSync(page)).toBe(true);
    },
  );

  it('live for 60 minutes', () => {
    expect(LINK_TTL_MS).toBe(3_600_000);
  });
});

describe('the letters', () => {
  const LINK = 'https://site.example/reset-password?t=abc';

  it('confirmation: says what it is, carries the link, says how long it lives', () => {
    const m = verifyEmailMessage('anna@example.com', LINK);
    expect(m.kind).toBe('verify_email');
    expect(m.to).toBe('anna@example.com');
    expect(m.subject).toBe('Confirm your email for CampTribe');
    expect(m.text).toContain(`Confirm email: ${LINK}`);
    expect(m.text).toContain('The link works once and for 60 minutes.');
    expect(m.text).toContain(
      'If you did not create a CampTribe account, you can ignore this letter.',
    );
  });

  it('reset: tells the person nothing has changed if it was not them', () => {
    const m = resetPasswordMessage('anna@example.com', LINK);
    expect(m.kind).toBe('reset_password');
    expect(m.subject).toBe('Reset your CampTribe password');
    expect(m.text).toContain(`Set a new password: ${LINK}`);
    expect(m.text).toContain('The link works once and for 60 minutes.');
    expect(m.text).toContain(
      'If it was not you, just delete this letter — nothing has changed.',
    );
  });

  it('carry the same link in the HTML part, as a button', () => {
    for (const m of [
      verifyEmailMessage('a@b.co', LINK),
      resetPasswordMessage('a@b.co', LINK),
    ]) {
      expect(m.html).toContain(`<a href="${LINK}"`);
      expect(m.html).toContain('The link works once and for 60 minutes.');
    }
  });

  it('escape what they put in HTML', () => {
    const nasty = 'https://x.example/?a=1&b="><script>alert(1)</script>';
    const m = resetPasswordMessage('a@b.co', nasty);
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&amp;b=&quot;&gt;&lt;script&gt;');
    // The plain-text part is text: nothing to escape, and nothing altered.
    expect(m.text).toContain(nasty);
  });
});

describe('the boot line', () => {
  it('says when mail is off, and why', () => {
    const line = mailBootLine(mailerFrom({}), undefined);
    expect(line).toContain('NOT CONFIGURED');
    expect(line).toContain('MAIL_PROVIDER is not set');
    expect(line).toContain('503');
  });

  it('says when it is on, and which provider', () => {
    expect(mailBootLine(mailerFrom(ENV), 'dev')).toBe(
      '[mail] provider: dev — sign-up, confirmation and reset letters are sent',
    );
  });
});

describe('DevMailbox', () => {
  it('keeps what it was sent and prints it', async () => {
    const printed: string[] = [];
    const box = new DevMailbox((l) => printed.push(l));
    await box.send(verifyEmailMessage('a@b.co', 'https://x/y'));
    expect(box.sent).toHaveLength(1);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('to=a@b.co kind=verify_email');
    expect(printed[0]).toContain('https://x/y');
  });
});
