import { timingSafeEqual } from 'node:crypto';

/**
 * CAMP-522 — who may read the data-quality report.
 *
 * 🔴 NOT THE PUBLIC. The report runs a dozen aggregate queries over the
 * whole campsite table, and it says how many duplicates and stale rows
 * we hold — an internal page's material, not an open endpoint's. The
 * site's own server already identifies itself to this API with the
 * build token (throttle.ts); the same token opens this, and nothing
 * else does.
 *
 * 🔴 FAILS CLOSED. No token configured means nobody may read, not
 * everybody: an empty `expected` never matches an empty header.
 *
 * Pure, so the spec drives every branch without a request.
 */
export function mayReadQuality(
  token: unknown,
  expected: string | undefined = process.env.API_BUILD_TOKEN,
): boolean {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof token !== 'string' || token.length === 0) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on unequal lengths; compare b with itself so
  // the refusal costs the same either way.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
