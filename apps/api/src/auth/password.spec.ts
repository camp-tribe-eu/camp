import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  FORMAT,
  MAX,
  MAX_MEM,
  MIN,
  SCRYPT,
  hashPassword,
  isWorkable,
  looksLikeStoredHash,
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

// CAMP-223 — the database and this module must refuse the same shape.
describe('the stored-hash shape is one pattern, not two', () => {
  const MIGRATION = join(
    __dirname,
    '../migrations/1791100000000-PasswordHashShape.ts',
  );

  // 🔴 The failure this prevents is silent and one-directional: someone
  // "tidies" the migration by pasting the regex in as a literal, the
  // pattern here is later tightened, and the database quietly stops
  // refusing what the code still believes it refuses. The constraint is
  // worth having precisely when the code was bypassed, so a constraint
  // that has drifted is worse than none — it reads as cover.
  it('the migration interpolates the constants rather than copying them', () => {
    const source = readFileSync(MIGRATION, 'utf8');
    expect(source).toContain(
      "import { MAX_MEM, STORED_SHAPE } from '../auth/password'",
    );
    expect(source).toContain("CHECK (password_hash ~ '${STORED_SHAPE}')");
    expect(source).toContain('<= ${MAX_MEM}');
    // And no second copy of either hiding anywhere in the file.
    expect(source).not.toContain('^scrypt');
    expect(source).not.toContain(String(MAX_MEM));
  });

  it('every hash this module makes satisfies the shape', async () => {
    for (const params of [
      SCRYPT,
      {
        ...SCRYPT,
        N: MIN.N,
        r: MIN.r,
        p: MIN.p,
        saltLen: MIN.saltLen,
        keyLen: MIN.keyLen,
      },
    ]) {
      expect(looksLikeStoredHash(await hashPassword('x', params))).toBe(true);
    }
  });

  it.each([
    ['empty', ''],
    ['the format name alone', 'scrypt'],
    ['too few fields', 'scrypt$131072$8$1'],
    ['N of zero', 'scrypt$0$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA=='],
    [
      'a leading zero in N',
      'scrypt$016384$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==',
    ],
    [
      'a salt below MIN.saltLen',
      'scrypt$131072$8$1$AA==$AAAAAAAAAAAAAAAAAAAAAA==',
    ],
    ['a key below MIN.keyLen', 'scrypt$131072$8$1$AAAAAAAAAAA=$AA=='],
    [
      'another algorithm',
      'bcrypt$131072$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==',
    ],
    [
      'a seventh field',
      'scrypt$131072$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==$x',
    ],
    [
      'leading whitespace',
      ' scrypt$131072$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==',
    ],
    [
      'non-base64 in the salt',
      'scrypt$131072$8$1$AAAA!AAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==',
    ],
  ])('%s is refused', (_what, value) => {
    expect(looksLikeStoredHash(value)).toBe(false);
  });

  // 🔴 A newline is its own case because POSIX regex engines differ on
  // what `$` means. Measured in this project's Postgres: it is end of
  // STRING, so a trailing newline is refused there too — but JavaScript's
  // `$` without the `m` flag behaves the same way only because the flag
  // is absent, and someone adding `m` later would open exactly this.
  it('a trailing newline does not slip past the anchor', () => {
    const real =
      'scrypt$131072$8$1$1p9NrNR97KnftFn2mmawjA==$f/Kq2ubnqjqgwRQ//zrtX5sQsSxiCXJSCuWRWZwTHlg=';
    expect(looksLikeStoredHash(real)).toBe(true);
    expect(looksLikeStoredHash(`${real}\n`)).toBe(false);
    expect(looksLikeStoredHash(`${real}\nDROP TABLE users`)).toBe(false);
  });
});

// CAMP-223, second round — the half I shipped without.
//
// 🔴 Closing `''` moved the gate; it did not close the oracle. Review
// measured four values that pass the SHAPE and still refuse instantly,
// because Node throws on the parameters before scrypt does any work:
//
//   honest hash                      202.7 ms
//   scrypt$1$1$1$…   N not 2^k         0.1 ms   ← 2 000×
//   N = 2^30         past Node         0.3 ms
//   N = 2^20, r = 32 past maxmem       0.0 ms
//   N = 2^20, r = 1  N < 2^16r         0.0 ms
//   p = 16 (MAX.p)                  3 495.3 ms  ← 17× the other way
//
// The timing cases live in `auth.spec.ts`, where they are measured end
// to end. These pin the decision itself, which is cheap enough to cover
// exhaustively.
describe('parameters scrypt can actually evaluate', () => {
  // 🔴 THE NAME WAS RIGHT AND THE FIXTURE WAS NOT. This said "accepts
  // everything hashPassword can produce" while trying four parameter
  // sets I had written down, and review found what those four missed:
  // `{...SCRYPT, p: 5}` hashes fine, verifies fine, and the check
  // refused it — a silent, permanent lockout for that account.
  //
  // A claim about EVERYTHING is tested over a grid. Node is the only
  // authority on what it will evaluate, so the grid asks Node: anything
  // `hashPassword` did not throw on must pass `isWorkable`.
  it('🔴 accepts everything hashPassword can produce — a grid, not a list', async () => {
    const lockedOut: string[] = [];
    for (const N of [2 ** 10, 2 ** 12, 2 ** 14, 2 ** 16]) {
      for (const r of [1, 2, 8]) {
        for (const p of [1, 2, 3, 5, 8, 16, 32]) {
          let made: string;
          try {
            made = await hashPassword('x', { ...SCRYPT, N, r, p });
          } catch {
            continue; // Node refused these parameters; so may we.
          }
          // Node made it and can read it back. Refusing it here would
          // send this account to the decoy for ever.
          if (!looksLikeStoredHash(made))
            lockedOut.push(`N=${N} r=${r} p=${p}`);
        }
      }
    }
    // Each entry is a parameter set that hashes, verifies, and is
    // refused — in other words, an account that can never sign in.
    expect(lockedOut).toEqual([]);
  }, 180_000);

  // 🔴 THE BOUNDARY IS ASKED OF NODE, FROM THE CHEAP SIDE. I first wrote
  // this with numbers typed from the review report and got one wrong —
  // I carried an r = 1 pair onto an r = 2 case. A boundary test whose
  // expected value I typed is a test of my typing.
  //
  // The first fix binary-searched Node for the largest acceptable `p`,
  // which was honest and unusably slow: Node REFUSES invalid parameters
  // synchronously and for free, but ACCEPTING them means computing, and
  // the accepted points near this boundary are millions of work units
  // each. The suite ran for minutes.
  //
  // So it asks only the free side. For each (N, r) it takes the largest
  // `p` this module would allow and requires Node to refuse `p + 1` and
  // `p + 2` — and requires `isWorkable` to refuse them too. That is
  // exactly where the missing `+ 2` showed: without it this module
  // allowed two values past Node, and both of them answered in a tenth
  // of a millisecond against an honest 203.
  //
  // The accepted side is covered by the grid above, which is the
  // property that actually matters: nothing hashPassword can make is
  // refused here.
  it('…and stops exactly where Node stops', () => {
    const nodeRefuses = (N: number, r: number, p: number) => {
      try {
        scryptSync('x', 's', 16, { N, r, p, maxmem: MAX_MEM });
        return false;
      } catch {
        return true;
      }
    };

    for (const [N, r] of [
      [2, 1],
      [2, 2],
      [4, 1],
    ]) {
      const pMax = Math.floor(MAX_MEM / (128 * r)) - N - 2;
      for (const over of [1, 2]) {
        const where = `N=${N} r=${r} p=${pMax + over}`;
        expect([where, nodeRefuses(N, r, pMax + over)]).toEqual([where, true]);
        expect([where, isWorkable(N, r, pMax + over)]).toEqual([where, false]);
      }
      // And the last value this module allows is one Node does not
      // refuse — measured by hand on 06.10.2026 at 1 572 860, 786 428
      // and 1 572 858, which is why `pMax` is computed and not typed.
      expect([`N=${N} r=${r}`, isWorkable(N, r, pMax)]).toEqual([
        `N=${N} r=${r}`,
        true,
      ]);
    }
  });

  // 🔴 NO FLOOR. A hash made under weaker parameters has to keep
  // verifying — `verifyPassword` says why, and a floor here would sign
  // out exactly the users the design protects. It is a ceiling only.
  it('accepts parameters weaker than the ones we ship today', () => {
    expect(isWorkable(2 ** 10, 1, 1)).toBe(true);
    expect(isWorkable(2, 1, 1)).toBe(true);
  });

  it.each([
    ['N of 1', 1, 1, 1],
    ['N of 0', 0, 1, 1],
    ['N that is not a power of two', 131071, 8, 1],
    ['N past what Node accepts', 2 ** 30, 8, 1],
    ['N past the N < 2^16r rule', 2 ** 20, 1, 1],
    // 🔴 ISOLATED TO ONE RULE. The first version of this case used
    // r = 32, which the work ceiling also refuses — so removing the
    // memory check left every test green, and a mutation run said so.
    // At r = 2 the shape is a power of two, inside N < 2^16r and inside
    // the work ceiling: `128 · r · (N + p)` is the only thing that
    // refuses it.
    ['N and r past the memory ceiling, and nothing else', 2 ** 20, 2, 1],
    ['N and r past both the memory and work ceilings', 2 ** 20, 32, 1],
    ['r of 0', 2 ** 17, 0, 1],
    ['p of 0', 2 ** 17, 8, 0],
    ['a fractional N', 2 ** 17 + 0.5, 8, 1],
  ])('refuses %s', (_what, N, r, p) => {
    expect(isWorkable(N as number, r as number, p as number)).toBe(false);
  });

  // 🔴 WHAT USED TO BE HERE WAS A TAUTOLOGY, and review named it:
  // `expect(WORK_CEILING).toBe(SCRYPT.N * SCRYPT.r * SCRYPT.p * 4)`
  // restated the line that defined the constant, so it could not fail
  // for ANY value of SCRYPT — including the value that locked every
  // existing user out. The constant is gone; what replaces it is the
  // grid above, which asks Node rather than restating me.
});
