/**
 * An email address, as this API stores and compares it (CAMP-228).
 *
 * 🔴 ONE FUNCTION FOR EVERY DOOR. Sign-up, sign-in, "forgot password" and
 * "resend the confirmation" all look an account up by address, and if any of
 * them spells the address differently from the others the account exists for
 * one door and not for the next. That is not a cosmetic bug here: a
 * recovery form that finds `Anna@Example.com` and a sign-in that does not is
 * a pair of answers that differ by whether an address is registered —
 * the existence oracle CAMP-228 is written against, reached by capital
 * letters instead of a stopwatch.
 *
 * The database holds the same rule as a CHECK (`users_email_normalised`), so
 * a row written by a path that forgot to call this is refused rather than
 * stored in a form no lookup will ever find.
 */
export const normalizeEmail = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().toLowerCase() : '';

/** RFC 5321 §4.5.3.1: 64 octets of local part, 254 in the whole path. */
export const MAX_EMAIL = 254;
export const MAX_LOCAL = 64;

/**
 * Is this worth sending a letter to?
 *
 * Deliberately shallow. The only real test of an address is the letter
 * arriving, which is what the confirmation link is for; a stricter regex
 * mostly refuses real people (new TLDs, `+` tags, IDN) and still passes
 * `a@b.c`. This refuses what cannot be an address at all — no `@`, two of
 * them, spaces, control characters, an empty side — and anything long
 * enough to be a payload rather than a name.
 *
 * Expects the output of `normalizeEmail`.
 */
export function isPlausibleEmail(email: string): boolean {
  if (typeof email !== 'string' || email.length === 0) return false;
  if (email.length > MAX_EMAIL) return false;
  // Control characters include CR and LF, which in a header is an injection.
  if (/[\u0000-\u001f\u007f\s]/u.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length === 0 || local.length > MAX_LOCAL) return false;
  // A dot inside the domain, with something on both sides of every dot.
  return /^[^.]+(\.[^.]+)+$/u.test(domain);
}
