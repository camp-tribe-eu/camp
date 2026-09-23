// CAMP-92 — the rules an endpoint open to the whole internet needs.
//
// 🔴 Deliberately free of Nest and TypeORM imports, like spots/filters.ts.
// Not tidiness: @nestjs/typeorm ships ESM that this jest setup cannot
// parse, so a pure rule living next to a decorated class is a rule with
// no unit test. The rules are what an attacker meets first, so they are
// the part that must be testable in milliseconds.
//
// 🔴 This is a POST that anyone can call, with no authentication, by
// design: a browser that just broke cannot be asked to sign in. So every
// guard has to be on this side, and the two that matter are a size limit
// and a rate limit. Without them the table is a free write-anything
// database for whoever finds the URL, and the first person to notice
// fills the disk.

/** Anything longer is truncated rather than rejected — a report that is
 *  slightly too long is still a report. */
export const LIMITS = {
  message: 300,
  stack: 2000,
  path: 512,
  source: 512,
  userAgent: 512,
  kind: 16,
} as const;

const KINDS = new Set(['error', 'promise', 'boundary']);

/**
 * How many reports one caller may store in a window.
 *
 * 🔴 Keyed on the fingerprint and the path, NOT on the IP. Keying on the
 * IP would mean storing an IP, which is the one thing this feature must
 * not do (see the entity). The practical effect is the same: the abuse
 * this endpoint invites is a flood of identical or near-identical rows,
 * and that is exactly what a fingerprint key stops.
 */
export const RATE = { perWindow: 20, windowMs: 60_000 } as const;

export type IncomingReport = {
  kind?: unknown;
  message?: unknown;
  stack?: unknown;
  path?: unknown;
  source?: unknown;
  line?: unknown;
  userAgent?: unknown;
  sinceLoadMs?: unknown;
};

export type Accepted = {
  kind: string;
  message: string;
  stack: string | null;
  path: string;
  source: string | null;
  line: number | null;
  userAgent: string;
  sinceLoadMs: number;
  fingerprint: string;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function integer(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  if (n < 0) return null;
  return n > max ? max : n;
}

/**
 * Turn an untrusted body into a row, or into nothing.
 *
 * Pure, so the spec can drive every branch — including the ones a
 * well-behaved browser never produces, which are the only ones an
 * attacker will send.
 */
export function validate(body: IncomingReport): Accepted | null {
  const kind = text(body.kind, LIMITS.kind);
  if (!kind || !KINDS.has(kind)) return null;

  const message = text(body.message, LIMITS.message);
  if (!message) return null;

  const path = text(body.path, LIMITS.path) ?? '/';
  const stack = text(body.stack, LIMITS.stack);
  const frame = stack?.split('\n')[1]?.trim() ?? '';

  return {
    kind,
    message,
    stack,
    path,
    source: text(body.source, LIMITS.source),
    line: integer(body.line, 10_000_000),
    userAgent: text(body.userAgent, LIMITS.userAgent) ?? 'unknown',
    // A minute is already absurd for a page that has just loaded; the
    // cap stops a hand-crafted body storing a nine-digit integer.
    sinceLoadMs: integer(body.sinceLoadMs, 86_400_000) ?? 0,
    fingerprint: `${kind}|${message}|${frame}`.slice(0, LIMITS.path),
  };
}

/** The rate limiter, as data so it can be tested without a clock. */
export type Bucket = Map<string, number[]>;

export function allow(
  bucket: Bucket,
  key: string,
  now: number,
  rate = RATE,
): boolean {
  const hits = (bucket.get(key) ?? []).filter((t) => now - t < rate.windowMs);
  if (hits.length >= rate.perWindow) {
    // Keep the pruned list so a caller that keeps pushing does not also
    // keep growing the array it is being blocked by.
    bucket.set(key, hits);
    return false;
  }
  hits.push(now);
  bucket.set(key, hits);
  return true;
}

/**
 * Drop keys nobody has used in a while.
 *
 * 🔴 Without this the bucket IS the memory leak the rate limit was
 * supposed to prevent: one entry per distinct fingerprint, forever, on a
 * public endpoint where the fingerprint is attacker-controlled.
 */
export function prune(bucket: Bucket, now: number, rate = RATE): void {
  for (const [key, hits] of bucket) {
    const live = hits.filter((t) => now - t < rate.windowMs);
    if (live.length === 0) bucket.delete(key);
    else bucket.set(key, live);
  }
}
