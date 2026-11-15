import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OWNER_LINK_PATH, claimOwnerLinkMessage, ownerLinkFor } from './mail';

// CAMP-505 — лист власника й сторінка, на яку він веде.

const WEB_APP = join(__dirname, '../../../web/src/app');

describe('посилання з листа власника', () => {
  it('🔴 веде на сторінку, яка існує в сайті', () => {
    // Лист, посилання з якого дає 404, — зламаний потік, який ніхто не бачить.
    expect(existsSync(join(WEB_APP, OWNER_LINK_PATH, 'page.tsx'))).toBe(true);
  });

  it('🔴 будується з налаштованого походження, шляху й одного параметра — без `next`', () => {
    const link = ownerLinkFor('https://site.example', 'abc-DEF_123');
    expect(link).toBe(
      'https://site.example/account/claim/confirm?t=abc-DEF_123',
    );
    const url = new URL(link);
    expect([...url.searchParams.keys()]).toEqual(['t']);
  });

  it('кодує токен, а не вклеює', () => {
    expect(ownerLinkFor('https://s.example', 'a&b=c d')).toBe(
      'https://s.example/account/claim/confirm?t=a%26b%3Dc%20d',
    );
  });

  it('🔴 сторінка, на яку веде лист, не індексується й не віддає токен у Referer', () => {
    const src = readFileSync(
      join(WEB_APP, OWNER_LINK_PATH, 'page.tsx'),
      'utf8',
    );
    expect(src).toMatch(
      /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/,
    );
    expect(src).toMatch(/referrer:\s*'no-referrer'/);
  });
});

describe('лист власника', () => {
  const LINK = 'https://site.example/account/claim/confirm?t=abc';
  const m = claimOwnerLinkMessage(
    'chef@camp.de',
    LINK,
    'Camping Alpenblick',
    60,
  );

  it('іде тим видом, який лічильник і сторож листів упізнають', () => {
    expect(m.kind).toBe('claim_owner_link');
    expect(m.to).toBe('chef@camp.de');
  });

  it('🔴 «нічого не робіть» стоїть до посилання', () => {
    const doNothing = m.text.indexOf('do nothing');
    expect(doNothing).toBeGreaterThan(-1);
    expect(doNothing).toBeLessThan(m.text.indexOf(LINK));
  });

  it('несе посилання, строк і одноразовість, і каже, що працює лише в акаунті заявника', () => {
    expect(m.text).toContain(LINK);
    expect(m.text).toContain('works once, for 60 minutes');
    expect(m.text).toContain(
      'only in the CampTribe account that started the request',
    );
    expect(m.html).toContain(`href="${LINK}"`);
  });

  it('🔴 не просить пароля і не називає, хто питав', () => {
    expect(m.text).toContain('never ask for a password');
    // Ані адреси заявника, ані будь-якої іншої: у тексті немає жодної «@».
    expect(m.text).not.toContain('@');
    expect(m.html).not.toContain('@');
  });

  it('🔴 назва кемпінгу з даних не ламає розмітку', () => {
    const nasty = claimOwnerLinkMessage(
      'a@b.de',
      LINK,
      '<script>alert(1)</script> & "co"',
      60,
    );
    expect(nasty.html).not.toContain('<script>');
    expect(nasty.html).toContain('&lt;script&gt;');
  });
});
