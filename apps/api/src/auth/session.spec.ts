import {
  SESSION_TTL_MS,
  TOKEN_BYTES,
  expiryFrom,
  isExpired,
  newToken,
  parseBearer,
  tokenHash,
} from './session';

describe('tokenHash', () => {
  it('is deterministic', () => {
    expect(tokenHash('abc')).toBe(tokenHash('abc'));
  });

  it('separates two tokens that differ by one character', () => {
    expect(tokenHash('abc')).not.toBe(tokenHash('abd'));
  });

  it('is 64 hex characters, so the column width is known', () => {
    expect(tokenHash(newToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  // 🔴 The whole point of hashing: a dump of the table must not hand
  // the attacker something that works as a bearer token.
  it('never returns the token it was given', () => {
    const token = newToken();
    expect(tokenHash(token)).not.toBe(token);
  });
});

describe('newToken', () => {
  it('carries the full 32 bytes of entropy', () => {
    expect(Buffer.from(newToken(), 'base64url')).toHaveLength(TOKEN_BYTES);
  });

  // A generator that repeats is the one failure that looks fine in
  // every single-call test.
  it('does not repeat across 1000 calls', () => {
    const seen = new Set(Array.from({ length: 1000 }, newToken));
    expect(seen.size).toBe(1000);
  });

  it('is URL-safe, so it survives a header and a cookie unescaped', () => {
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('isExpired', () => {
  const now = new Date('2026-10-05T12:00:00Z');

  it('is alive a millisecond before the expiry', () => {
    expect(isExpired(new Date(now.getTime() + 1), now)).toBe(false);
  });

  // The boundary, stated once so it cannot drift.
  it('is expired AT the expiry, not after it', () => {
    expect(isExpired(new Date(now.getTime()), now)).toBe(true);
  });

  it('is expired a millisecond after', () => {
    expect(isExpired(new Date(now.getTime() - 1), now)).toBe(true);
  });

  // 🔴 A row whose expiry we cannot read must not be honoured. Each of
  // these is its own test: one guard per test, so a weakened check
  // cannot hide behind the others.
  it('treats a null expiry as expired', () => {
    expect(isExpired(null, now)).toBe(true);
  });

  it('treats a missing expiry as expired', () => {
    expect(isExpired(undefined, now)).toBe(true);
  });

  it('treats an unparseable date as expired', () => {
    expect(isExpired(new Date('not a date'), now)).toBe(true);
  });
});

describe('expiryFrom', () => {
  it('adds the default TTL', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(expiryFrom(now).getTime()).toBe(now.getTime() + SESSION_TTL_MS);
  });

  it('is immediately expired when asked for a zero TTL', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(isExpired(expiryFrom(now, 0), now)).toBe(true);
  });
});

describe('parseBearer', () => {
  it('reads an ordinary header', () => {
    expect(parseBearer('Bearer abc123')).toBe('abc123');
  });

  // RFC 7235 §2.1 makes the scheme case-insensitive.
  it('accepts the scheme in any case', () => {
    expect(parseBearer('bEaReR abc123')).toBe('abc123');
  });

  // …but the token is base64url, where case carries meaning.
  it('keeps the token verbatim', () => {
    expect(parseBearer('Bearer AbC-_123')).toBe('AbC-_123');
  });

  it('refuses another scheme carrying a token', () => {
    expect(parseBearer('Basic abc123')).toBeNull();
  });

  // 🔴 Every malformed shape must come back as the SAME anonymous
  // request. Separate tests, because one `return null` covering all of
  // them is exactly the line a mutation would delete.
  it('refuses a scheme with no token', () => {
    expect(parseBearer('Bearer')).toBeNull();
  });

  it('refuses a scheme followed only by spaces', () => {
    expect(parseBearer('Bearer    ')).toBeNull();
  });

  it('refuses a bare token with no scheme', () => {
    expect(parseBearer('abc123')).toBeNull();
  });

  it('refuses a missing header', () => {
    expect(parseBearer(undefined)).toBeNull();
  });

  it('refuses a null header', () => {
    expect(parseBearer(null)).toBeNull();
  });

  it('refuses a non-string header', () => {
    expect(parseBearer(['Bearer abc'] as unknown as string)).toBeNull();
  });
});
