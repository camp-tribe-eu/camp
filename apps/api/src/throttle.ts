// CAMP-69: how many requests one caller may make, and why those numbers.
//
// 🔴 The API is public and unauthenticated. Every route below can be
// called by anyone who knows the hostname, and two of them return the
// whole dataset. Without a limit, "give me every campsite in Europe" in
// a loop is free, and the cost is ours.
//
// 🔴 What this is NOT. It is not a defence against a determined attacker
// with a botnet — that is Cloudflare's job, in front of us, and the card
// says so. This is the floor: a single misbehaving client, a runaway
// script of our own, or someone scraping politely-but-quickly gets a 429
// rather than a bill.
//
// 🔴 Per process, not per cluster. The storage is in-memory, so two API
// instances allow twice as much. That is a real limit of this design and
// it is written down rather than discovered: the day the API runs on
// more than one node, these numbers are per node until a shared store
// (Redis) is put behind them.

/** Seconds, as @nestjs/throttler wants them: milliseconds. */
const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * The default every route inherits.
 *
 * 120 a minute is two a second sustained — far above what a person
 * browsing produces, and far below what a scraper wants. Chosen so that
 * the site's own build never comes near it: the build asks for
 * `/spots/index` once and a page per campsite, but it does that from one
 * process in sequence, and CI showed 9 830 pages built well inside the
 * job's time budget.
 */
export const DEFAULT_LIMIT = { ttl: MINUTE, limit: 120 };

/**
 * 🔴 The whole-dataset routes, which are a different question.
 *
 * `/spots/map/points?bbox=whole-world` returns 9 830 markers and
 * `/spots/search-index` returns every document — 2.4 MB and 1.1 MB of
 * work per call, measured 24.09.2026. A hundred of those a minute is not
 * "a busy reader", it is a bill.
 *
 * Six a minute is generous for the only legitimate caller we have: the
 * build, which asks for each of them once. A human never calls them at
 * all — the browser reads the static file the build produced.
 */
export const BULK_LIMIT = { ttl: MINUTE, limit: 6 };

/**
 * Routes that carry the bulk limit, by controller path.
 *
 * Exported as data so the test can assert the list rather than trusting
 * that a decorator was not forgotten — the failure mode here is silent:
 * an expensive route added later simply inherits the generous default
 * and nobody notices until the traffic bill.
 */
export const BULK_ROUTES = [
  'spots/map/points',
  'spots/search-index',
  'spots/index',
] as const;

/**
 * Is this request exempt from throttling?
 *
 * Two cases, and the second one was learned the hard way.
 *
 * 1. The health check. A monitor polling it every few seconds is the one
 *    caller we WANT hitting us constantly (CAMP-59).
 *
 * 2. 🔴 The build, which is by far our heaviest legitimate client.
 *
 *    The site is generated statically: `next build` asks the API for
 *    every one of 9 830 campsites, plus the index, the search documents
 *    and the map points. Measured 24.09.2026, that is roughly 5 000
 *    requests a minute — forty times the default limit.
 *
 *    The first version of this had no exemption, and the result was the
 *    worst possible shape of failure: the build EXITED 0 and produced
 *    580 campsite pages instead of 9 830. `getSpot` returns null rather
 *    than throwing (deliberately — a missing campsite is a 404, not a
 *    broken build), so every throttled page simply vanished in silence.
 *
 *    The answer is not a bigger number. A limit raised until the build
 *    fits is not a limit. It is a token: the build knows it, the public
 *    does not.
 *
 * 🔴 Fails CLOSED. With no token configured, nothing is exempt — an
 * unconfigured deployment is throttled, not open. And an empty or
 * missing header never matches, so `undefined === undefined` cannot
 * accidentally let the world through.
 *
 * Pure, so the test can drive every branch without a request object.
 */
export function isExempt(
  path: string,
  token?: string | null,
  expected = process.env.API_BUILD_TOKEN,
): boolean {
  if (path === '/' || path === '/health') return true;
  if (!expected) return false;
  return typeof token === 'string' && token.length > 0 && token === expected;
}

/** The header the build identifies itself with. */
export const BUILD_TOKEN_HEADER = 'x-build-token';

/**
 * The client this request is counted against.
 *
 * 🔴 Behind Cloudflare, `req.ip` is Cloudflare's address, and every
 * reader in Europe would share one bucket — the limit would then be a
 * denial of service we built ourselves. `CF-Connecting-IP` is the header
 * Cloudflare sets to the real client, and it is set by Cloudflare rather
 * than by the caller.
 *
 * ⚠️ It IS forgeable by anyone reaching the origin directly, which is
 * why the origin must not be reachable directly in production. That is a
 * deployment property (CAMP-61), not something this file can enforce, so
 * it is named here rather than assumed.
 */
export function clientKey(
  headers: Record<string, unknown>,
  fallback: string,
): string {
  const cf = headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0 && cf.length <= 45) return cf;
  return fallback;
}
