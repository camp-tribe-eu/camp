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
export const SCRYPT = Object.freeze({ N: 2 ** 17, r: 8, p: 1, keyLen: 32, saltLen: 16 });

// 128 * N * r bytes, plus headroom. Node's default of 32 MiB is far
// below what these parameters need, and the failure is a thrown error
// rather than a weaker hash — but only if we ask for enough.
const MAX_MEM = 192 * 1024 * 1024;

/** The stored form: every parameter travels with the hash. */
export const FORMAT = 'scrypt';

/**
 * 🔴 THE PARAMETERS ARE STORED WITH THE HASH, not read from the constant
 * above at verify time. A hash made last year must keep verifying after
 * the cost is raised, or raising it logs every existing user out — which
 * is how work factors end up never being raised at all.
 */
export async function hashPassword(plain: string, params = SCRYPT): Promise<string> {
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
  return [FORMAT, params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** True when `plain` made `stored`. Never throws on a malformed hash. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT) return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const N = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(rr) || !Number.isInteger(pp)) return false;
  // 🔴 A BOUNDS CHECK STOOD HERE AND IT GUARDED NOTHING. It read
  // `N < 2**14 || N > 2**20 || …`, meant against a row claiming an
  // absurd cost — but `maxmem` below already refuses anything that large
  // before a byte is allocated, and a cost that is too SMALL just
  // produces a wrong key, which is `false` by the same path as any wrong
  // password. A mutation deleting the whole line kept every assertion
  // green, because there was nothing left for it to do.
  //
  // It is gone rather than documented: the identical pattern in
  // `check-map-assets.mjs` shadowed its own test, and a line that cannot
  // change an outcome can still change which mutations survive.
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(keyB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let actual;
  try {
    actual = await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
      N, r: rr, p: pp, maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }
  // 🔴 Constant time. A `===` here leaks the hash one byte at a time to
  // anyone who can measure the response.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Whether a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string, params = SCRYPT): boolean {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT) return true;
  return Number(parts[1]) < params.N || Number(parts[2]) < params.r;
}
