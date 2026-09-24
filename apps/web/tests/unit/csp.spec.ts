import { expect, test } from '@playwright/test';

// CAMP-122, found while trying to verify the map controls locally.
//
// 🔴 `next dev` served every page with a 200 and executed none of our
// client JavaScript. The CSP forbids 'unsafe-eval'; Next's dev compiler
// needs it. The page looked complete — SSR markup, no error state — and
// the only evidence was one console line. Nothing interactive on this
// site worked in development, and nothing said so.
//
// The exception exists for `next dev` alone. These tests are the reason
// it can be trusted: they assert that the relaxation is exactly one
// token, in exactly one directive, and that what Cloudflare serves never
// carries it.

let SECURITY_HEADERS: Record<string, string>;
let cspForDevServer: () => string;

test.beforeAll(async () => {
  ({ SECURITY_HEADERS, cspForDevServer } = await import(
    '../../scripts/security-headers.mjs'
  ));
});

const directives = (csp: string) =>
  new Map(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...rest] = d.split(/\s+/);
        return [name, rest] as [string, string[]];
      }),
  );

test('production forbids unsafe-eval', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  expect(csp).not.toContain('unsafe-eval');
  expect(directives(csp).get('script-src')).toEqual([
    "'self'",
    "'unsafe-inline'",
  ]);
});

test('the dev server allows it, and nothing else changes', () => {
  const prod = directives(SECURITY_HEADERS['Content-Security-Policy']);
  const dev = directives(cspForDevServer());

  // 🔴 Exactly one token, in exactly one directive. A "development CSP"
  // that quietly drifted from the real one would make dev a place where
  // things work that will not work in production — which is worse than
  // no CSP in dev at all.
  expect(dev.get('script-src')).toEqual([
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
  ]);
  expect([...dev.keys()]).toEqual([...prod.keys()]);
  for (const [name, value] of prod) {
    if (name === 'script-src') continue;
    expect(dev.get(name), `${name} differs in development`).toEqual(value);
  }
});

test('the CSP still says the things the map needs', () => {
  // Guarding the guard: these were each learned the hard way (CAMP-31),
  // and a careless edit to script-src must not take them with it.
  const d = directives(SECURITY_HEADERS['Content-Security-Policy']);
  expect(d.get('worker-src')).toContain('blob:');
  expect(d.get('img-src')).toContain('blob:');
  expect(d.get('object-src')).toEqual(["'none'"]);
  expect(d.get('frame-ancestors')).toEqual(["'none'"]);
});
