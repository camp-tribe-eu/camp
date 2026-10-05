import { createHash, randomBytes } from 'node:crypto';

/**
 * Session tokens: how a request proves which account it is.
 *
 * CAMP-50 part 2. `ownership.ts` decides whether a Viewer may have a
 * resource; this file is how a bare HTTP request becomes a Viewer at
 * all. Both are kept as plain functions so they can be exercised
 * without booting Nest — a guard that can only be tested through an
 * HTTP server is a guard that gets tested once.
 */

/** 256 bits. The token is the credential; nothing else guards a session. */
export const TOKEN_BYTES = 32;

/** How long a session is good for. Re-login after this, no sliding. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 🔴 WHY SHA-256 HERE AND scrypt FOR PASSWORDS — these look like the
 * same job and are not.
 *
 * A password is low entropy and chosen by a human, so an attacker who
 * steals the table can guess it. scrypt exists to make each guess
 * expensive. A session token is 32 bytes from the CSPRNG: there is
 * nothing to guess, so a slow hash buys no security and costs a hash
 * on EVERY authenticated request instead of once per login.
 *
 * What hashing still buys: a dump of `sessions` does not hand the
 * attacker working tokens, because the column holds the digest and the
 * digest cannot be sent as a bearer token.
 *
 * 🔴 This reasoning is the kind that was wrong once already in this
 * module (see the scrypt `maxmem` note in password.ts), so state the
 * claim narrowly: SHA-256 is right ONLY because the input is full-
 * entropy random. If anything ever lets a caller choose its own token,
 * this line stops being correct.
 */
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** A fresh token. Returned once, to the client, and never stored raw. */
export const newToken = (): string =>
  randomBytes(TOKEN_BYTES).toString('base64url');

/**
 * Is this session past its expiry?
 *
 * 🔴 At exactly `expiresAt` the session is EXPIRED. The boundary has to
 * be decided somewhere, and "expires at 12:00" reading as dead at 12:00
 * is the reading that cannot surprise anyone. An invalid date is also
 * expired: a row we cannot read the expiry of is a row we must not
 * honour.
 */
export function isExpired(
  expiresAt: Date | null | undefined,
  now: Date,
): boolean {
  const end = expiresAt?.getTime();
  if (typeof end !== 'number' || Number.isNaN(end)) return true;
  return now.getTime() >= end;
}

/** When a session created now should die. */
export const expiryFrom = (now: Date, ttlMs: number = SESSION_TTL_MS): Date =>
  new Date(now.getTime() + ttlMs);

/**
 * The token out of an `Authorization` header, or null.
 *
 * 🔴 Returns null rather than throwing, and null for every malformed
 * shape, because "no usable credential" and "a credential we refuse to
 * parse" must reach the caller as the same anonymous request. A thrown
 * 500 on a junk header is a way to probe the parser.
 *
 * The scheme is matched case-insensitively (RFC 7235 §2.1 makes it so),
 * but the token itself is taken verbatim: it is base64url, where case
 * carries meaning.
 */
export function parseBearer(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null;
  const space = header.indexOf(' ');
  if (space < 0) return null;
  if (header.slice(0, space).toLowerCase() !== 'bearer') return null;
  const token = header.slice(space + 1).trim();
  return token === '' ? null : token;
}
