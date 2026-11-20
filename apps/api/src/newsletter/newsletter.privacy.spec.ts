import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededLegalPages } from '../pages/legal-seeded';
import {
  CONFIRM_TTL_HOURS,
  PENDING_KEPT_DAYS,
  RESEND_GAP_MINUTES,
} from './newsletter.service';

// Політика приватності (3.2, «Our letters, if you ask for them») каже, що
// робить підписка. Кожне число й кожне «не» в тому тексті звіряється тут з
// кодом, який це робить, — тож речення не переживе зміни коду. Текст береться
// з реєстру того, що міграції лишають у базі, а не з константи цього файлу.

const root = join(__dirname, '..', '..', '..', '..');
const policy = seededLegalPages().find((p) => p.slug === 'privacy')!.body;
const section = (() => {
  const from = policy.indexOf(
    '### Our letters, if you ask for them {#newsletter}',
  );
  expect(from).toBeGreaterThan(-1);
  const to = policy.indexOf('\n### ', from + 10);
  return policy.slice(from, to === -1 ? undefined : to);
})();
const keep = (() => {
  const from = policy.indexOf('## How long we keep it {#keep}');
  expect(from).toBeGreaterThan(-1);
  const to = policy.indexOf('\n## ', from + 10);
  return policy.slice(from, to === -1 ? undefined : to);
})();

const migration = readFileSync(
  join(__dirname, '..', 'migrations', '1798040000000-NewsletterSubscribers.ts'),
  'utf8',
);

describe('«Our letters» says what the code does', () => {
  it('the numbers: «7 days» is PENDING_KEPT_DAYS and «48 hours» is CONFIRM_TTL_HOURS', () => {
    expect(PENDING_KEPT_DAYS).toBe(7);
    expect(CONFIRM_TTL_HOURS).toBe(48);
    expect(section).toContain(
      `deleted ${PENDING_KEPT_DAYS} days after the first request`,
    );
    expect(section).toContain(`${CONFIRM_TTL_HOURS} hours after we sent it`);
    expect(keep).toContain(`${PENDING_KEPT_DAYS} days from the first request`);
  });

  it('🔴 the row holds exactly what the section lists, and the table has no column for anything else', () => {
    const create =
      /CREATE TABLE IF NOT EXISTS newsletter_subscribers \(([\s\S]*?)\n      \)\n    `\);/.exec(
        migration,
      );
    expect(create).not.toBeNull();
    const columns = create![1]
      .split('\n')
      .map((l) => /^\s{8}([a-z_]+) (?:uuid|text|timestamptz)\b/.exec(l)?.[1])
      .filter(Boolean)
      .sort();
    expect(columns).toEqual([
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
    // One line of the policy for each thing the columns carry.
    expect(section).toContain('your email address, in lower case');
    expect(section).toContain(
      'its state: waiting for confirmation, confirmed, or unsubscribed',
    );
    expect(section).toContain(
      'the date of your request, the date you confirmed, and the date you unsubscribed',
    );
    expect(section).toContain('two one-way hashes');
    expect(section).toContain('the time the confirmation link stops working');
    // And what the policy says is NOT stored really has no column.
    expect(section).toContain(
      'We do not store your IP address, your browser or an account',
    );
    for (const c of columns)
      expect(c).not.toMatch(/ip|agent|browser|user|account|cookie/);
  });

  it('🔴 «only us» and «our own database»: the table is NOT registered in Directus, and no mailing-list service is a dependency', () => {
    for (const f of [
      'apps/cms/directus-config.json',
      'apps/cms/configure.mjs',
    ]) {
      expect(readFileSync(join(root, f), 'utf8')).not.toContain('newsletter');
    }
    const deps = readFileSync(join(root, 'apps/api/package.json'), 'utf8');
    expect(deps).not.toMatch(
      /mailchimp|sendgrid|mailgun|brevo|sendinblue|mailerlite|postmark|resend|convertkit|klaviyo/i,
    );
    expect(section).toContain('only us');
  });

  it('🔴 «a confirmation letter, and nothing else is sent»: the only letter this folder composes is newsletter_confirm', () => {
    const files = readdirSync(__dirname).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    );
    expect(files.sort()).toEqual([
      'newsletter.controller.ts',
      'newsletter.module.ts',
      'newsletter.rules.ts',
      'newsletter.service.ts',
    ]);
    const src = readFileSync(join(__dirname, 'newsletter.service.ts'), 'utf8');
    expect(src.match(/sender\.send\(/g)).toHaveLength(1);
    expect(src).toContain('newsletterConfirmMessage');
  });

  it('the basis is consent, Art. 6(1)(a), and the policy does not also claim a second one for this', () => {
    expect(section).toContain('Article 6(1)(a) GDPR');
    expect(section).not.toContain('legitimate interest');
    expect(section).not.toContain('6(1)(f)');
  });

  it('the footer links to the section by the anchor the policy defines', () => {
    const footer = readFileSync(
      join(root, 'apps/web/src/components/newsletter-form.tsx'),
      'utf8',
    );
    const anchor = /\/legal\/privacy#([a-z-]+)/.exec(footer)?.[1];
    expect(anchor).toBe('newsletter');
    expect(section).toContain(`{#${anchor}}`);
  });

  it('the letter links to the same section', () => {
    const svc = readFileSync(join(__dirname, 'newsletter.service.ts'), 'utf8');
    expect(svc).toContain('/legal/privacy#newsletter');
  });

  it('🔴 the gap between two letters to one address is the number the register states, and the register is read, not the constant alone', () => {
    // The db spec derives its boundary FROM `RESEND_GAP_MINUTES`, so a change
    // of that constant would move the test with it. The number is a decision,
    // and it is written down in the register (§15): this pins the two together.
    const register = readFileSync(join(root, 'docs/GDPR-REGISTER.md'), 'utf8');
    expect(register).toContain(
      `не частіше одного листа на адресу за ${RESEND_GAP_MINUTES} хв`,
    );
    expect(RESEND_GAP_MINUTES).toBe(10);
  });
});
