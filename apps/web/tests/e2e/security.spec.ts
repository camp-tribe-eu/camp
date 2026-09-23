import { expect, test } from '@playwright/test';
import { SECURITY_HEADERS } from '../../scripts/security-headers.mjs';

// The security headers, asserted on real responses.
//
// 🔴 Why a test and not trust in the config. Before this, the only
// `headers()` entry in next.config.mjs was X-Robots-Tag, and the actual
// security headers lived exclusively in public/_headers — which
// Cloudflare reads and `next start` does not. So the headers were
// present in production and absent everywhere we ever looked, and no
// check anywhere noticed. The reverse is just as easy: a policy in the
// config and nothing in _headers means production has none.
//
// Both now come from one module, and this asserts what actually arrives
// over HTTP.
//
// 🔴 The module derives some of the policy from the environment — the
// tile origins have always worked this way, and CAMP-92 added the error
// endpoint's origin to connect-src. So this test only holds when the
// test process is given the SAME environment the build was given. In CI
// that is one value, `CI_ERROR_ENDPOINT`, passed to both; locally it
// means building and testing in one shell. Getting it wrong shows up as
// a CSP mismatch that reads like a security regression and is not one —
// which is why it is written down here rather than learned twice.

/** Paths that must all carry the policy, not just the HTML pages. */
const PATHS = ['/', '/camping', '/map', '/data/spots.geojson', '/robots.txt'];

test.describe('security headers', () => {
  for (const path of PATHS) {
    test(`${path} carries every security header`, async ({ page }) => {
      const res = await page.request.get(path);
      expect(res.status()).toBe(200);
      const got = res.headers();
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(got[name.toLowerCase()], `${path} is missing ${name}`).toBe(
          value,
        );
      }
    });
  }

  test('the framework is not announced', async ({ page }) => {
    // X-Powered-By tells an attacker which advisory list to read and
    // tells a reader nothing.
    const res = await page.request.get('/');
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });

  test('🔴 the CSP allows exactly what the map needs, and no more', async ({
    page,
  }) => {
    const csp = (await page.request.get('/map')).headers()[
      'content-security-policy'
    ];
    expect(csp).toBeTruthy();

    // Each of these is load-bearing for the map, and each failure looks
    // like something else: no worker-src blob: and every vector layer
    // silently disappears; no connect-src for the tile host and the map
    // reports the provider as down.
    expect(csp, 'MapLibre builds its parser worker from a blob').toContain(
      "worker-src 'self' blob:",
    );
    expect(csp, 'sprites and glyph atlases are data:/blob:').toContain(
      "img-src 'self' data: blob:",
    );
    expect(csp, 'the tile origin must be reachable').toMatch(
      /connect-src [^;]*tiles\.openfreemap\.org/,
    );

    // And the parts that are the actual protection.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");

    // 🔴 Measured, not assumed: this directive upgrades every subresource
    // request to https, Chromium and Firefox exempt localhost and WebKit
    // does not, and adding it failed 33 tests across all three WebKit
    // profiles. It must not come back without that being reconsidered.
    expect(csp, 'upgrade-insecure-requests breaks WebKit on plain HTTP').not.toContain(
      'upgrade-insecure-requests',
    );
  });

  test('the API is not reachable cross-origin by default', async ({
    request,
  }) => {
    // CORS is an allowlist read from CORS_ORIGINS and empty unless set,
    // so an unconfigured machine answers no preflight at all. A wildcard
    // here would be the same as having no CORS.
    const base = process.env.API_BASE_URL ?? 'http://localhost:3001';
    const res = await request.fetch(`${base}/spots/summary`, {
      method: 'GET',
      headers: { Origin: 'https://evil.example' },
    });
    const allow = res.headers()['access-control-allow-origin'];
    expect(allow === undefined || allow === '').toBeTruthy();
  });

  // 🔴 CAMP-60, debt #4. The test above, alone, is worth very little:
  // it passes just as happily when CORS is switched off entirely, when
  // the API is not running, and when the allowlist is empty. Every
  // negative assertion needs its positive twin, or it is only asserting
  // that nothing happened.
  test('and it IS reachable from the origin we allowed', async ({
    request,
  }) => {
    const base = process.env.API_BASE_URL ?? 'http://localhost:3001';
    const site = 'http://localhost:3000';
    const res = await request.fetch(`${base}/spots/summary`, {
      method: 'GET',
      headers: { Origin: site },
    });
    expect(res.status()).toBe(200);
    const allow = res.headers()['access-control-allow-origin'];
    expect(
      allow,
      'the allowlisted origin was refused — CORS is not configured at all',
    ).toBe(site);
    // 🔴 And never the wildcard. `*` would make the allowlist decorative.
    expect(allow).not.toBe('*');
  });
});
