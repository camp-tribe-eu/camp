import {
  FORMAT,
  SCRYPT,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password';

// CAMP-50 — password storage. OWASP: "If Argon2id is not available, use
// scrypt with a minimum CPU/memory cost parameter of (2^17), a minimum
// block size of 8 (1024 bytes), and a parallelization parameter of 1."
describe('password', () => {
  // Each hash costs ~180 ms by design, so the suite keeps them few.
  jest.setTimeout(30_000);

  it('🔴 uses at least the parameters OWASP names', () => {
    expect(SCRYPT.N).toBeGreaterThanOrEqual(2 ** 17);
    expect(SCRYPT.r).toBeGreaterThanOrEqual(8);
    expect(SCRYPT.p).toBeGreaterThanOrEqual(1);
  });

  it('verifies the password it was made from', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(
      true,
    );
  });

  it('…and refuses any other', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(
      false,
    );
    expect(await verifyPassword('', stored)).toBe(false);
  });

  // 🔴 Two users with one password must not share a hash, or the column
  // becomes a map of who reused what.
  it('salts, so one password hashed twice gives two different rows', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toEqual(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('carries its parameters with it, so the cost can be raised later', async () => {
    const stored = await hashPassword('x');
    const [format, n, r, p] = stored.split('$');
    expect(format).toBe(FORMAT);
    expect(Number(n)).toBe(SCRYPT.N);
    expect(Number(r)).toBe(SCRYPT.r);
    expect(Number(p)).toBe(SCRYPT.p);
  });

  // 🔴 A hash made under weaker parameters must keep verifying, or
  // raising the work factor signs every existing user out — which is how
  // work factors come never to be raised.
  it('still verifies a hash made with weaker parameters', async () => {
    const weak = { ...SCRYPT, N: 2 ** 14 };
    const stored = await hashPassword('old password', weak);
    expect(await verifyPassword('old password', stored)).toBe(true);
    expect(needsRehash(stored)).toBe(true);
    expect(needsRehash(await hashPassword('new password'))).toBe(false);
  });

  it('refuses an empty password rather than storing one', async () => {
    await expect(hashPassword('')).rejects.toThrow(/non-empty/);
  });

  // 🔴 A malformed row must answer "no", never throw: a thrown verify is
  // a 500 that tells an attacker the row is special.
  it.each([
    ['', 'empty'],
    ['not-a-hash', 'no separators'],
    ['scrypt$a$b$c$d$e', 'non-numeric parameters'],
    ['bcrypt$131072$8$1$c2FsdA==$a2V5', 'a format we do not write'],
    ['scrypt$131072$8$1$$a2V5', 'no salt'],
    ['scrypt$131072$8$1$c2FsdA==$', 'no key'],
  ])('answers false for a stored value with %s', async (stored) => {
    expect(await verifyPassword('anything', stored)).toBe(false);
  });

  // 🔴 A row claiming an absurd cost must answer false, not hang or
  // throw. `maxmem` is what refuses it — see the note in the source.
  it('refuses a hash claiming an impossible cost, without throwing', async () => {
    expect(
      await verifyPassword('x', 'scrypt$1073741824$8$1$c2FsdA==$a2V5'),
    ).toBe(false);
    expect(await verifyPassword('x', 'scrypt$131072$32$16$c2FsdA==$a2V5')).toBe(
      false,
    );
    expect(await verifyPassword('x', 'scrypt$1024$8$1$c2FsdA==$a2V5')).toBe(
      false,
    );
  });

  // The same password typed on two keyboards is the same password.
  // 🔴 BOTH DIRECTIONS. Checking only one lets the normalisation be
  // deleted from `hashPassword` alone and stay green, because `verify`
  // folds the input anyway — a mutation proved exactly that.
  it('normalises so one accent spelled two ways still verifies', async () => {
    const nfc = await hashPassword('passé'); // é as one code point
    expect(await verifyPassword('passé', nfc)).toBe(true); // e + acute
    const nfd = await hashPassword('passé');
    expect(await verifyPassword('passé', nfd)).toBe(true);
  });

  it('…and a password that differs by more than spelling still fails', async () => {
    const stored = await hashPassword('passé');
    expect(await verifyPassword('passe', stored)).toBe(false);
  });
});
