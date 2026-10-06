/**
 * What a 404 is allowed to record, and what must never reach the table.
 *
 * 🔴 WHY THIS LOG EXISTS AND NOTHING ELSE WILL DO. The OSM import runs
 * weekly and rebuilds slugs; dead URLs are guaranteed, and the 301 that
 * saves the accumulated links has to KNOW WHERE TO POINT. The list of
 * most-requested dead paths is that answer. Without it we learn about a
 * lost link when the ranking has already gone.
 *
 * 🔴 IT MUST NOT MAKE THE CONSENT BANNER A LIE. The banner says, today
 * and truthfully, "no analytics or advertising cookies". So: no cookie,
 * no identifier, no IP, no user agent, nothing that joins two requests
 * into one person. A path, where the link was, and a date. That is a
 * register of broken links, not a record of visitors — and the
 * difference is not a matter of intent, it is a matter of what the
 * columns can express.
 *
 * The neighbouring `client_errors` table made the same choice for the
 * same reason, and its entity says so; this is that discipline applied
 * to a second table rather than re-argued.
 */

export const LIMITS = {
  /** Our own paths are slugs; anything longer is not one of ours. */
  path: 512,
  /** A referrer we keep is scheme + host + path, which fits easily. */
  referrer: 512,
} as const;

/**
 * The referrer, stripped to what is useful and nothing more.
 *
 * 🔴 THE QUERY STRING IS DROPPED, ALWAYS. A referrer arrives from
 * somebody else's site, and their query string is their business: a
 * search someone typed, a session token, an email address in a tracking
 * parameter. We want to know WHICH PAGE sent the reader, and the path
 * answers that completely. Keeping the query would mean storing personal
 * data we did not ask for, cannot use and would have to defend.
 *
 * The fragment never reaches a server at all, but it is removed anyway:
 * a referrer can be set by a client, so "browsers do not send it" is not
 * the same as "it cannot be there".
 *
 * Credentials in the authority (`https://user:pass@host/`) are dropped
 * for the obvious reason.
 *
 * Returns null — not a partial string — for anything unparseable. A
 * referrer we cannot read is one we do not record, and the row is kept
 * with an empty referrer rather than dropped: "arrived with no usable
 * referrer" is itself worth counting, because that is what a crawler
 * and a typed URL look like.
 */
export function cleanReferrer(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Only the two schemes a browser can navigate from. `javascript:`,
  // `data:` and friends are not referrers, they are payloads.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname === '') return null;
  const cleaned = `${url.protocol}//${url.host}${url.pathname}`;
  return cleaned.length > LIMITS.referrer
    ? cleaned.slice(0, LIMITS.referrer)
    : cleaned;
}

/**
 * Our own path, without its query.
 *
 * 🔴 Ours is dropped too, and that is the less obvious half. A visitor
 * who lands on `/search?q=...` has typed something, and a 404 log is not
 * a place to keep what people type. The path is what a 301 needs.
 */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const bare = raw.split('#')[0].split('?')[0];
  if (bare === '' || !bare.startsWith('/')) return null;
  return bare.length > LIMITS.path ? bare.slice(0, LIMITS.path) : bare;
}

export type Hit = { path: string; referrer: string | null };

/**
 * A row, or null when there is nothing worth recording.
 *
 * 🔴 A bad PATH means no row: without it there is nothing to redirect
 * and nothing to count. A bad REFERRER does not — the hit still happened
 * and still belongs in the report.
 */
export function toRow(path: unknown, referrer: unknown): Hit | null {
  const p = cleanPath(path);
  if (p === null) return null;
  return { path: p, referrer: cleanReferrer(referrer) };
}
