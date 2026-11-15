import { randomBytes } from 'node:crypto';
import { mayReadQuality } from './data-quality.access';

// CAMP-522 — the report is the site's own server's to read, nobody else's.

// 🔴 Made up per run, never written down: a literal here is a string
// shaped like a credential in a public repository, and the secret scan
// is right to refuse it.
const TOKEN = randomBytes(18).toString('hex');

describe('who may read the data-quality report', () => {
  it('the caller that presents the configured build token', () => {
    expect(mayReadQuality(TOKEN, TOKEN)).toBe(true);
  });

  it('nobody with another token, a prefix of it, or a longer one', () => {
    // the same length, so only the comparison itself can refuse it
    const other = randomBytes(18).toString('hex');
    expect(other).toHaveLength(TOKEN.length);
    expect(mayReadQuality(other, TOKEN)).toBe(false);
    expect(mayReadQuality(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(mayReadQuality(`${TOKEN}x`, TOKEN)).toBe(false);
  });

  it('nobody without a token', () => {
    expect(mayReadQuality(undefined, TOKEN)).toBe(false);
    expect(mayReadQuality('', TOKEN)).toBe(false);
    expect(mayReadQuality(['x'], TOKEN)).toBe(false);
  });

  it('🔴 nobody at all when no token is configured — empty never matches empty', () => {
    expect(mayReadQuality('', '')).toBe(false);
    expect(mayReadQuality(undefined, undefined)).toBe(false);
    expect(mayReadQuality('anything', '')).toBe(false);
    expect(mayReadQuality('undefined', undefined)).toBe(false);
  });

  it('reads the configured token from the environment by default', () => {
    const before = process.env.API_BUILD_TOKEN;
    try {
      process.env.API_BUILD_TOKEN = TOKEN;
      expect(mayReadQuality(TOKEN)).toBe(true);
      delete process.env.API_BUILD_TOKEN;
      expect(mayReadQuality(TOKEN)).toBe(false);
    } finally {
      if (before === undefined) delete process.env.API_BUILD_TOKEN;
      else process.env.API_BUILD_TOKEN = before;
    }
  });
});
