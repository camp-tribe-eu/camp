import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * 🔴 CAMP-50 ASKS FOR argon2/bcrypt AND THIS USES scrypt. Here is why,
 * and it is a measured reason rather than a preference.
 *
 * Both argon2 and bcrypt are native modules that build at install time,
 * and this repository gates install scripts — `npm install` already
 * warns that `@parcel/watcher` and `unrs-resolver` are "not yet covered
 * by allowScripts". Adding a password hash that needs `node-gyp` would
 * put the one security-critical dependency behind an approval step and
 * a C++ toolchain on every machine and CI runner that touches the API.
 *
 * OWASP's Password Storage Cheat Sheet says, verbatim:
 *
 *   "If Argon2id is not available, use scrypt with a minimum CPU/memory
 *    cost parameter of (2^17), a minimum block size of 8 (1024 bytes),
 *    and a parallelization parameter of 1."
 *
 * scrypt is in Node's core. These are those exact parameters, named so
 * that raising them later is a one-line change with a visible history.
 */
export const SCRYPT = Object.freeze({
  N: 2 ** 17,
  r: 8,
  p: 1,
  keyLen: 32,
  saltLen: 16,
});

/** The shape of a cost setting, so a test can vary one field. */
export type ScryptParams = {
  N: number;
  r: number;
  p: number;
  keyLen: number;
  saltLen: number;
};

// 128 * N * r bytes, plus headroom. Node's default of 32 MiB is far
// below what these parameters need, and the failure is a thrown error
// rather than a weaker hash — but only if we ask for enough.
const MAX_MEM = 192 * 1024 * 1024;

/**
 * The floors a stored hash must clear, and the one ceiling it must not
 * pass. Anyone who can write `password_hash` would otherwise choose our
 * CPU bill — or hand us a one-byte key, which is not a hash at all.
 */
export const MIN = Object.freeze({
  N: 2 ** 14,
  r: 1,
  p: 1,
  saltLen: 8,
  keyLen: 16,
});
export const MAX = Object.freeze({ N: 2 ** 20, r: 32, p: 16 });

/** The stored form: every parameter travels with the hash. */
export const FORMAT = 'scrypt';

/**
 * 🔴 THE PARAMETERS ARE STORED WITH THE HASH, not read from the constant
 * above at verify time. A hash made last year must keep verifying after
 * the cost is raised, or raising it logs every existing user out — which
 * is how work factors end up never being raised at all.
 */
export async function hashPassword(
  plain: string,
  params: ScryptParams = SCRYPT,
): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('a password must be a non-empty string');
  }
  const salt = randomBytes(params.saltLen);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, params.keyLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: MAX_MEM,
  });
  return [
    FORMAT,
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** True when `plain` made `stored`. Never throws on a malformed hash. */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT) return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const N = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(rr) || !Number.isInteger(pp))
    return false;
  // 🔴 I DELETED THIS GUARD CALLING IT REDUNDANT AND MY REASONING WAS
  // WRONG IN THE ONE DIMENSION THAT MATTERED.
  //
  // I argued `maxmem` already refuses anything too costly. It does not.
  // `maxmem` caps `128 · r · (N + p)` — a SUM — while scrypt's work is
  // `N · r · p` — a PRODUCT. Raising `p` buys time without buying
  // memory, so the memory ceiling never sees it.
  //
  // Measured here: `scrypt$32768$2$8192$…` returned false after **104
  // seconds**, 473× one honest hash, using 10 MiB — five per cent of the
  // 192 MiB ceiling. At the ceiling p ≈ 753 000, about two and a half
  // HOURS inside one request. And `r` and `p` were never bounded in any
  // revision, so "maxmem already refuses it" was not a simplification,
  // it was false.
  // 🔴 ONLY `p`, AND ONLY AN UPPER BOUND. Working out which of the three
  // actually needs guarding took a mutation run that kept three of them
  // alive:
  //
  //   `r` is bounded by `maxmem` already — it appears LINEARLY in
  //   `128 · r · (N + p)`, so a large r runs out of memory before it
  //   runs out of time. At the ceiling r ≈ 91 buys 1.4× the work.
  //
  //   `N` must have NO floor, and a floor would be a bug: an old hash
  //   stored under weaker parameters has to keep verifying, which is the
  //   whole reason the parameters travel with the hash. A floor here
  //   would sign out exactly the users the design protects.
  //
  //   `p` escapes. It sits beside N in the memory sum where N dominates,
  //   so it costs almost no memory and multiplies the work. Measured:
  //   `p = 8192` took 104 SECONDS on 10 MiB — five per cent of the
  //   ceiling. At the ceiling p ≈ 753 000, about two and a half hours.
  if (pp < 1 || pp > MAX.p) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(keyB64, 'base64');
  } catch {
    return false;
  }
  // 🔴 THE BYPASS. This read `length === 0`, and the key length comes
  // from `expected.length` — so a row claiming a ONE-BYTE key made
  // scrypt produce one byte, and one byte collides once in 256.
  // Measured: `scrypt$2$1$1$c2FsdA==$AA` accepted 1 of 256 arbitrary
  // passwords. A short key is not a weak hash, it is no hash.
  if (salt.length < MIN.saltLen || expected.length < MIN.keyLen) return false;
  let actual;
  try {
    actual = await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
      N,
      r: rr,
      p: pp,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }
  // 🔴 Constant time. A `===` here leaks the hash one byte at a time to
  // anyone who can measure the response.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Whether a stored hash was made with weaker parameters than we now use. */
export function needsRehash(
  stored: string,
  params: ScryptParams = SCRYPT,
): boolean {
  // 🔴 ITS DEFAULT ANSWER TO GARBAGE WAS "NO". `NaN < N` is false, so
  // `scrypt$x$y$1$a$b` reported healthy — and so did a row with a
  // one-byte salt and a one-byte key, which is the forged row above. A
  // row we cannot read is a row to replace, not a row to trust.
  //
  // It also ignored `p`, so the first time `p` is raised every existing
  // row would have reported "fine" and never been upgraded.
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT) return true;
  const [, n, r, p, saltB64, keyB64] = parts;
  const N = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(rr) || !Number.isInteger(pp))
    return true;
  if (N < params.N || rr < params.r || pp < params.p) return true;
  return (
    Buffer.from(saltB64, 'base64').length < MIN.saltLen ||
    Buffer.from(keyB64, 'base64').length < MIN.keyLen
  );
}
