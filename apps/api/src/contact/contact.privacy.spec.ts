import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededLegalPages } from '../pages/legal-seeded';
import { MAIL_LIMIT } from '../throttle';
import { MIN_FILL_MS } from './contact.rules';

// The privacy policy (3.1, «Writing to us») says what the contact form does.
// Each number and each «nothing is stored» in that text is read back against
// the code that does it, so the sentence cannot outlive a change to the code.
// The text is read from the registry of what the migrations leave in the
// database, not from a constant of this file.

const policy = seededLegalPages().find((p) => p.slug === 'privacy')!.body;
const section = (() => {
  const from = policy.indexOf('### Writing to us {#writing}');
  expect(from).toBeGreaterThan(-1);
  const to = policy.indexOf('\n### ', from + 10);
  return policy.slice(from, to === -1 ? undefined : to);
})();

const WORDS: Record<number, string> = { 3: 'three', 5: 'five', 10: 'ten' };

describe('«Writing to us» says what the code does', () => {
  it('the count per IP: the numbers in the text are MAIL_LIMIT’s', () => {
    expect(MAIL_LIMIT.limit).toBe(10);
    expect(MAIL_LIMIT.ttl).toBe(10 * 60_000);
    expect(section).toContain(
      `at most ${WORDS[MAIL_LIMIT.limit]} in ${WORDS[MAIL_LIMIT.ttl / 60_000]} minutes`,
    );
  });

  it('the minimum open time: the seconds in the text are MIN_FILL_MS', () => {
    expect(section).toContain(`within ${WORDS[MIN_FILL_MS / 1000]} seconds`);
  });

  it('🔴 «not written to our database» is true: nothing in the contact folder reaches a database or the disk', () => {
    const files = readdirSync(__dirname).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    );
    expect(files.sort()).toEqual([
      'contact.controller.ts',
      'contact.module.ts',
      'contact.rules.ts',
      'contact.service.ts',
    ]);
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const i of imports) {
        expect(i).not.toMatch(/typeorm|^pg$|node:fs|^fs$|\/entities\//);
      }
      expect(src).not.toMatch(/\.query\(|\.save\(|writeFile|appendFile/);
    }
  });

  it('the recipient the text names is the one the service reads', () => {
    expect(section).toContain('{{company.email}}');
    expect(
      readFileSync(join(__dirname, 'contact.service.ts'), 'utf8'),
    ).toContain('MAIL_REPLY_TO');
  });

  it('the page links to the section by the anchor the policy defines', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const component = readFileSync(
      join(root, 'apps/web/src/components/contact-form.tsx'),
      'utf8',
    );
    const anchor = /\/legal\/privacy#([a-z-]+)/.exec(component)?.[1];
    expect(anchor).toBe('writing');
    expect(section).toContain(`{#${anchor}}`);
  });
});
