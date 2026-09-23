// The security headers, in one place, for both emitters.
//
// 🔴 Two emitters, one list — the same reason gen-headers.mjs already
// exists. Cloudflare Pages serves the built files and never runs Next's
// `headers()`, so a policy written only in next.config.mjs is absent in
// production; a policy written only in public/_headers is absent from
// `next start`, which is what our own server and every preview run. The
// audit that found this had X-Content-Type-Options on Cloudflare and
// nothing at all locally.
//
// 🔴 The tile origins come from the same environment variables the map
// reads (lib/map-sources.ts). A CSP that names a different host than the
// map requests is a CSP that silently blanks the map — and it would look
// exactly like a tile provider being down.

const OFM = process.env.NEXT_PUBLIC_TILES_URL ?? 'https://tiles.openfreemap.org';
const SELF_TILES = process.env.NEXT_PUBLIC_SELF_TILES_URL ?? '';
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

// 🔴 CAMP-92. The error reporter POSTs from the reader's browser, so its
// host has to be in connect-src or the CSP blocks it — which is exactly
// what happened the first time this was run: the endpoint worked when
// called with curl and every browser-side report was silently dropped.
//
// It is read from the same variable the reporter reads, and only the
// ORIGIN is taken, so the allowance is the one host we configured and
// nothing else. Unset means nothing is added, which is also why a build
// with no error endpoint has no wider policy than before.
const ERROR_ENDPOINT = process.env.NEXT_PUBLIC_ERROR_ENDPOINT ?? '';

const connectOrigins = [OFM, SELF_TILES, API, ERROR_ENDPOINT]
  .filter(Boolean)
  .map((u) => {
    try {
      return new URL(u).origin;
    } catch {
      return '';
    }
  })
  .filter(Boolean)
  // The API and the error endpoint are normally the same host, and a
  // policy that names it twice is a policy nobody reads.
  .filter((origin, i, all) => all.indexOf(origin) === i);

/**
 * 🔴 `'unsafe-inline'` for scripts, stated plainly rather than hidden.
 *
 * Next puts the RSC payload and its bootstrap in inline <script> tags.
 * The strict alternative is a per-request nonce, which cannot be used by
 * a page that is prerendered once and served from a CDN — the nonce
 * would be baked into the cached HTML and be worth nothing. So this CSP
 * is a real reduction in attack surface (no foreign script origins, no
 * objects, no framing, no base-tag hijack) and NOT protection against
 * injected inline script. Anything that renders untrusted text must
 * still do it as text: the map popup builds DOM nodes for exactly this
 * reason, because campsite names come from OpenStreetMap.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  // MapLibre injects its control styles at runtime; Tailwind ships a
  // stylesheet but Next also inlines critical CSS.
  "style-src 'self' 'unsafe-inline'",
  // blob: and data: are MapLibre's sprites, glyph atlases and canvas.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // 🔴 blob: is not optional here. MapLibre creates its tile-parsing
  // worker from a blob URL when it cannot use a same-origin module
  // worker, and without this the map loses every vector layer while
  // still looking alive — the failure CAMP-31 spent hours on.
  "worker-src 'self' blob:",
  `connect-src 'self' ${connectOrigins.join(' ')}`.trim(),
  "manifest-src 'self'",
  // 🔴 No `upgrade-insecure-requests`, and the reason is measured.
  //
  // It rewrites every subresource request to https://. Chromium and
  // Firefox exempt localhost; WebKit does not — so on any origin served
  // over plain HTTP (local runs, previews, our own `next start` behind a
  // terminating proxy) Safari turned every asset into "A TLS error
  // caused the secure connection to fail". 33 of 384 e2e tests failed,
  // all three WebKit profiles, none of the others. It buys us nothing
  // either: every subresource is same-origin or an https tile URL, and
  // Strict-Transport-Security already covers the downgrade case for our
  // own domain.
].join('; ');

/**
 * Header name → value. `X-Robots-Tag` is added separately by the caller,
 * because it depends on the build mode rather than on security.
 */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': csp,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // We ask for none of these. Naming them denies them to anything
  // embedded on the page as well.
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  // Cloudflare sets HSTS itself, but our own server does not, and a
  // preview served over plain HTTP is exactly where a downgrade goes
  // unnoticed. Two years, the value Cloudflare's own docs recommend.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};
