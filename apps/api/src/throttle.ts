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
 * 1. The root route. A monitor polling it every few seconds is the one
 *    caller we WANT hitting us constantly (CAMP-59), and it is cheap.
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
  // 🔴 The root, and now `/health` — which CAMP-59 has made real.
  //
  // The first version of this exempted `/health` before the route
  // existed: measured, it 404d. An exemption for a route nobody serves
  // is a line that looks like a monitoring decision and is not one, so
  // it was removed with a note saying it returns when the route does.
  // It has: apps/api/src/health/health.controller.ts.
  //
  // A monitor polling every minute is the one caller we WANT hitting us
  // constantly, and it must not be the caller a rate limit silences —
  // an uptime check that gets 429d reports an outage that is not
  // happening, which is the fastest way to teach everyone to ignore it.
  //
  // 🔴 Compared after normalising, not as a raw string. Review pointed at
  // the obvious hole: `/health/`, `/HEALTH` and `/health?probe=1` are all
  // the same route to the router and none of them matched here. An uptime
  // monitor writes the URL however its form was filled in, and a trailing
  // slash is the single most common way — so the exemption would have
  // been absent for exactly the caller it was written for, and nobody
  // would have found out until the first 429 during an incident.
  // isBulkPath below has always normalised; this now does the same.
  const clean = path
    .split('?')[0]
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  if (clean === '' || clean === 'health') return true;
  if (!expected) return false;
  return typeof token === 'string' && token.length > 0 && token === expected;
}

/** The header the build identifies itself with. */
export const BUILD_TOKEN_HEADER = 'x-build-token';

/**
 * Does this path answer with the whole dataset?
 *
 * 🔴 Used for the BUCKET, while the decorator sets the NUMBER. Two
 * mechanisms for one idea is usually a smell; here it is deliberate and
 * each catches what the other cannot. The decorator is what
 * @nestjs/throttler reads for the limit, and throttle.spec.ts asserts it
 * is present by reading the controller. This function is what puts all
 * three expensive routes in ONE bucket per caller — without it the
 * library keys per handler, and six-a-minute silently becomes
 * eighteen-a-minute across the three.
 */
export function isBulkPath(path: string): boolean {
  const clean = path.split('?')[0].replace(/^\/+|\/+$/g, '');
  return BULK_ROUTES.some((r) => clean === r);
}

/**
 * The client this request is counted against.
 *
 * 🔴 Two things here were WRONG in the first version, both found by an
 * adversarial review rather than by CI, and both measured on the running
 * API before being believed.
 *
 * 1. THE HEADER WAS TRUSTED UNCONDITIONALLY.
 *
 *    `CF-Connecting-IP` is set by Cloudflare to the real visitor, and
 *    reading it is right *behind Cloudflare* — otherwise every reader in
 *    Europe shares one bucket and the limit becomes an outage we built
 *    ourselves. But anybody who reaches the origin directly can simply
 *    write it themselves. Measured: 40 rotating forged values pulled
 *    **62 MB** out of `/spots/search-index` in a few seconds, against a
 *    limit meant to cap that route at about 9 MB a minute.
 *
 *    The old comment waved at this — "the origin must not be reachable
 *    directly, that is a deployment property" — which is an unwritten
 *    assumption wearing a card number. Now it is a switch: the header is
 *    ignored unless `TRUST_PROXY_CLIENT_IP` is set, which is a thing
 *    somebody turns on *when* the origin is actually behind Cloudflare.
 *    Off by default, so a machine nobody configured is safe rather than
 *    open.
 *
 * 2. IPv6 WAS NOT NORMALISED, AND THAT ONE SURVIVES CLOUDFLARE.
 *
 *    @nestjs/throttler masks IPv6 to a /64 (`normalizeIp`, its
 *    DEFAULT_IPV6_SUBNET_PREFIX) precisely so one customer cannot be
 *    thousands of callers. Overriding getTracker threw that away.
 *
 *    A residential IPv6 line is routed a whole /64; cloud VMs get /64 to
 *    /48. Measured: twelve addresses inside one /64 got twelve 200s on a
 *    bulk route that allows six. And because Cloudflare reports each
 *    address faithfully, locking the origin down does not help at all —
 *    this is the more dangerous of the two.
 */
export function clientKey(
  headers: Record<string, unknown>,
  fallback: string,
  trustHeader = process.env.TRUST_PROXY_CLIENT_IP === '1',
): string {
  if (!trustHeader) return fallback;
  const cf = headers['cf-connecting-ip'];
  // 45 characters is the longest possible IPv6 text form; anything
  // longer is a payload, and an unbounded bucket key is a memory leak.
  if (typeof cf === 'string' && cf.length > 0 && cf.length <= 45) return cf;
  return fallback;
}
