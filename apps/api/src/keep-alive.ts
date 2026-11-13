/**
 * How long the HTTP server keeps an idle connection open, in ms — or
 * `undefined` to leave Node's own default (5 s) in place.
 *
 * 🔴 WHY THIS IS CONFIGURABLE AT ALL. A keep-alive client that reuses an
 * idle socket at the very moment the server closes it gets `ECONNRESET`
 * instead of an answer. Browsers and Caddy retry that silently; the
 * Playwright request context the e2e suite uses does not.
 *
 * Measured 13.11.2026 against this API (Node 24, default settings; the
 * server advertises `Keep-Alive: timeout=5` and closes about a second
 * later), two GETs on one context with the stated idle time between
 * them, 40 contexts per row:
 *
 *   3.0 s   0 of 40      5.98–6.02 s   1 of 40
 *   5.0 s   0 of 40      6.00–6.04 s   1 of 40
 *   8.0 s   0 of 40
 *
 * And `map-filters.spec.ts › the browser and the API agree on what
 * matches` asks the API once per filter with the map settling in
 * between — in CI run 43375812001 at 0.0 s, 6.4 s and 12.8 s, i.e. an
 * idle gap of about 6.3 s every time. The third request died with
 * `read ECONNRESET`, and `check-flaky` turned the run red.
 *
 * The CI fixture sets this above the longest per-test timeout (90 s),
 * so a context that lives for one test can never reach the expiry.
 * Production does not set it and keeps Node's default: Caddy retries a
 * reset on a reused upstream connection, and holding idle sockets for
 * two minutes there is a decision nobody has measured.
 *
 * 🔴 A value that is not a positive whole number of ms is REFUSED, not
 * guessed at: `0` means "never time out" to Node, and a typo that
 * silently became that would be a slow leak with no symptom.
 */
export function keepAliveTimeoutMs(
  raw: string | undefined,
): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  if (!/^[1-9]\d*$/.test(raw.trim())) {
    throw new Error(
      `HTTP_KEEP_ALIVE_TIMEOUT_MS must be a positive whole number of milliseconds, got ${JSON.stringify(raw)}`,
    );
  }
  return Number(raw.trim());
}
