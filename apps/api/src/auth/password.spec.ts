import {
  FORMAT,
  MAX,
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

  // 🔴 EACH OF THESE ISOLATES ONE GUARD. The first version did not:
  // the bypass case used N=2, which the cost bound now rejects BEFORE
  // the length check runs, and the denial-of-service case carried a
  // 5-byte salt, which the salt check rejects before scrypt is called.
  // Four mutations survived on guards shadowing each other — the same
  // failure as `check-map-assets.mjs`, one file later.
  const okSalt = Buffer.from('saltsalt').toString('base64'); // 8 bytes
  const okKey = Buffer.alloc(32, 7).toString('base64'); // 32 bytes
  const row = (n: number, r: number, pp: number, salt = okSalt, key = okKey) =>
    `scrypt$${n}$${r}$${pp}$${salt}$${key}`;

  // Everything valid except the KEY, which is one byte. One byte
  // collides once in 256: measured, 1 of 256 arbitrary passwords.
  it('🔴 refuses a hash whose key is too short to be a hash', async () => {
    const shortKey = Buffer.alloc(1, 0).toString('base64');
    let accepted = 0;
    for (let i = 0; i < 64; i += 1) {
      if (
        await verifyPassword(
          `nothing-${i}`,
          row(SCRYPT.N, SCRYPT.r, SCRYPT.p, okSalt, shortKey),
        )
      ) {
        accepted += 1;
      }
    }
    expect(accepted).toBe(0);
  });

  // Everything valid except the SALT.
  it('…and one whose salt is too short', async () => {
    const shortSalt = Buffer.alloc(2, 0).toString('base64');
    expect(
      await verifyPassword(
        'x',
        row(SCRYPT.N, SCRYPT.r, SCRYPT.p, shortSalt, okKey),
      ),
    ).toBe(false);
  });

  it('…while a real hash has both at full length', async () => {
    const [, , , , salt, key] = (await hashPassword('x')).split('$');
    expect(Buffer.from(salt, 'base64').length).toBe(SCRYPT.saltLen);
    expect(Buffer.from(key, 'base64').length).toBe(SCRYPT.keyLen);
  });

  // 🔴 `maxmem` caps `128·r·(N+p)`, a SUM; the work is `N·r·p`, a
  // PRODUCT. Raising `p` buys time without buying memory. Measured
  // before the bound: 104 SECONDS for one call, using 5% of maxmem.
  // Everything here is valid except `p`.
  it('🔴 refuses a parallelism that buys time without buying memory, fast', async () => {
    const started = Date.now();
    expect(await verifyPassword('x', row(2 ** 15, 2, 8192))).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  // 🔴 A LOW `N` MUST STILL VERIFY. A floor here would sign out exactly
  // the users that storing the parameters is meant to protect.
  it('a hash made with a far weaker cost still verifies', async () => {
    const weak = { ...SCRYPT, N: 2 ** 13 };
    const stored = await hashPassword('old password', weak);
    expect(await verifyPassword('old password', stored)).toBe(true);
    expect(needsRehash(stored)).toBe(true);
  });

  it('…and the parallelism we write is inside the ceiling', () => {
    expect(SCRYPT.p).toBeLessThanOrEqual(MAX.p);
  });

  // 🔴 `NaN < N` is false, so garbage used to report "healthy".
  it('🔴 needsRehash says yes to a row it cannot read', () => {
    expect(needsRehash('scrypt$x$y$1$a$b')).toBe(true);
    expect(needsRehash('scrypt$131072$8$1$AA$AA')).toBe(true);
    expect(needsRehash('')).toBe(true);
    expect(needsRehash('bcrypt$131072$8$1$c2FsdA==$a2V5')).toBe(true);
  });

  it('…and notices a raised parallelism, not only a raised N', async () => {
    const stored = await hashPassword('x');
    expect(needsRehash(stored, { ...SCRYPT, p: SCRYPT.p + 1 })).toBe(true);
    expect(needsRehash(stored, { ...SCRYPT, r: SCRYPT.r + 1 })).toBe(true);
  });

  // 🔴 A one-byte salt would make the "two hashes differ" test fail only
  // about one run in 256 — a flaky guard reading as green.
  it('salts with the full length, not merely with something', async () => {
    const [, , , , salt] = (await hashPassword('x')).split('$');
    expect(Buffer.from(salt, 'base64').length).toBe(SCRYPT.saltLen);
  });

  it('a stored value with the wrong number of fields is refused either way', async () => {
    expect(
      await verifyPassword(
        'x',
        `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${okSalt}`,
      ),
    ).toBe(false);
    // 🔴 Seven fields whose first six are a hash that WOULD verify:
    // `parts.length < 6` lets it through and the trailing field is
    // silently ignored. Anything less than a real hash here leaves the
    // mutation alive, because a wrong password answers false anyway.
    const real = await hashPassword('the real password');
    expect(await verifyPassword('the real password', real)).toBe(true);
    expect(await verifyPassword('the real password', `${real}$extra`)).toBe(
      false,
    );
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
