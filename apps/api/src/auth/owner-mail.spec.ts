import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTROLLER,
  OWNER_LINK_PATH,
  PRIVACY_EMAIL,
  UNCONFIRMED_KEPT,
  claimOwnerLinkMessage,
  ownerLinkFor,
} from './mail';

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
  const PRIVACY = 'https://site.example/legal/privacy';
  const m = claimOwnerLinkMessage(
    'chef@camp.de',
    LINK,
    'Camping Alpenblick',
    60,
    PRIVACY,
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
    // Ані адреси заявника, ані будь-якої іншої, крім адреси для питань про
    // дані (ст. 14): без неї в тексті немає жодної «@».
    expect(m.text.replaceAll(PRIVACY_EMAIL, '')).not.toContain('@');
    expect(m.html.replaceAll(PRIVACY_EMAIL, '')).not.toContain('@');
  });

  it('🔴 назва кемпінгу з даних не ламає розмітку', () => {
    const nasty = claimOwnerLinkMessage(
      'a@b.de',
      LINK,
      '<script>alert(1)</script> & "co"',
      60,
      PRIVACY,
    );
    expect(nasty.html).not.toContain('<script>');
    expect(nasty.html).toContain('&lt;script&gt;');
  });
});

describe('🔴 ст. 14 GDPR: лист для того, хто не давав нам адреси', () => {
  const PRIVACY = 'https://site.example/legal/privacy';
  const m = claimOwnerLinkMessage(
    'chef@camp.de',
    'https://site.example/account/claim/confirm?t=abc',
    'Camping Alpenblick',
    60,
    PRIVACY,
  );
  const both = (needle: string) => {
    expect(m.text).toContain(needle);
    // У html — те саме слово, крім символів, які він екранує.
    expect(m.html).toContain(needle);
  };

  it('називає контролера з назвою й адресою', () => {
    both(CONTROLLER.name);
    both(CONTROLLER.street);
    both(CONTROLLER.city);
    both(CONTROLLER.country);
  });

  it('🔴 контролер у листі — той самий, що на правовій сторінці сайту (legal.ts)', () => {
    const src = readFileSync(
      join(__dirname, '../../../web/src/lib/legal.ts'),
      'utf8',
    );
    for (const [k, v] of Object.entries(CONTROLLER))
      expect(src).toContain(`${k}: '${v}'`);
    expect(src).toContain(`PRIVACY_EMAIL = '${PRIVACY_EMAIL}'`);
  });

  it('каже, чому пишемо, і звідки адреса', () => {
    both('Somebody asked to manage the page for Camping Alpenblick');
    both('typed this email address into our form');
  });

  it('🔴 підстава — законний інтерес, ст. 6(1)(f), а не договір', () => {
    both('legitimate interest (Article 6(1)(f) GDPR)');
    expect(m.text).not.toContain('6(1)(b)');
    expect(m.html).not.toContain('6(1)(b)');
  });

  it('каже, що адреса не зберігається, і строк — той самий, що в сторожі строків', () => {
    both('We do not keep the address itself');
    both(`deleted after ${UNCONFIRMED_KEPT}`);
    const purge = readFileSync(
      join(__dirname, '../../../../scripts/ops/retention-purge.mjs'),
      'utf8',
    );
    const from = purge.indexOf("table: 'spot_claims'");
    const next = purge.indexOf('table:', from + 10);
    const rule = purge.slice(from, next > 0 ? next : undefined);
    expect(rule).toMatch(/months:\s*1\b/);
    expect(UNCONFIRMED_KEPT).toBe('one month');
  });

  it('дає право заперечити чи стерти, адресу для цього, скаргу й посилання на політику', () => {
    both('object or ask us to erase it');
    both('replying to this letter');
    both(PRIVACY_EMAIL);
    both('Belgian Data Protection Authority');
    expect(m.text).toContain(PRIVACY);
    expect(m.html).toContain(`href="${PRIVACY}"`);
  });

  it('🔴 вийшло з-за списку: абзац стоїть ПІСЛЯ вказівок щодо посилання, а не замість них', () => {
    expect(m.text.indexOf('do nothing')).toBeLessThan(
      m.text.indexOf('Why you are getting this letter'),
    );
  });
});
