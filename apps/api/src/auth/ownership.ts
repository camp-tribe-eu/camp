/**
 * Who may touch a saved resource.
 *
 * 🔴 CAMP-50'S ACCEPTANCE CRITERION IS THIS FILE: "an attempt to open
 * someone else's trip by direct ID returns 403, not data." That is
 * OWASP's broken object level authorisation — the single most common
 * API flaw — and it is not caught by any amount of testing the happy
 * path, because the happy path is the owner reading their own trip.
 *
 * The decision is kept apart from Nest so it can be exercised directly:
 * a guard that can only be tested by booting an HTTP server is a guard
 * that will be tested once.
 */

/** What a caller is. `null` means nobody is signed in. */
export type Viewer = { id: string; roles?: readonly string[] } | null;

/** What is being opened. Only the owner matters here. */
export type Owned = { userId?: string | null } | null | undefined;

export const ADMIN = 'admin';

/**
 * 🔴 ROLES ARE A GRANT OVER AN ORDINARY ACCOUNT, not a second kind of
 * user — the structural lesson CAMP-50 carries from the usabmx.com
 * review. So this asks "does this viewer hold the grant", never "is
 * this viewer an admin object".
 */
export const holds = (viewer: Viewer, role: string): boolean =>
  Array.isArray(viewer?.roles) && viewer.roles.includes(role);

/**
 * Why this viewer may not have this resource, or `null` when they may.
 *
 * Returns a REASON rather than a boolean so the caller can tell apart
 * the two cases that must produce different HTTP codes: nobody is
 * signed in (401, and signing in might help) from signed in but not
 * yours (403, and it never will).
 */
export function denyReason(
  viewer: Viewer,
  resource: Owned,
): 'anonymous' | 'not-yours' | 'missing' | null {
  if (!viewer || typeof viewer.id !== 'string' || viewer.id === '')
    return 'anonymous';
  // 🔴 A missing resource answers the same as someone else's. Telling an
  // attacker "404" for ids that do not exist and "403" for ids that do
  // turns the endpoint into a directory of which ids are real.
  // 🔴 `Object.hasOwn`, not a plain read: `Object.create({userId: 'x'})`
  // answers from the PROTOTYPE, and a polluted `Object.prototype` would
  // turn every "missing" 403 into 200-plus-data — exactly the
  // enumeration leak this file exists to prevent.
  if (
    !resource ||
    // `Object.hasOwn` needs lib es2022; this is the same test and
    // changes no compiler setting for one line.
    !Object.prototype.hasOwnProperty.call(resource, 'userId') ||
    typeof resource.userId !== 'string' ||
    resource.userId === ''
  )
    return 'missing';
  if (resource.userId !== viewer.id && !holds(viewer, ADMIN))
    return 'not-yours';
  return null;
}

/** The HTTP status a denial must produce. */
export const statusFor = (reason: ReturnType<typeof denyReason>): number =>
  reason === null ? 200 : reason === 'anonymous' ? 401 : 403;

/**
 * 🔴 ONE SENTENCE FOR EVERY DENIAL. Varying the message by cause is the
 * same leak as varying the status: "no such trip" and "not your trip"
 * together tell an attacker which ids exist.
 */
export const DENIED = 'Not found, or not yours.';
