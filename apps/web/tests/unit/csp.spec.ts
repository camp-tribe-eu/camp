import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

// 🔴 Asked of Node, not of the bundler.
//
// The first version used `await import(...)`. Playwright compiles these
// specs to CommonJS and transformed the .mjs along with them, so Node
// then loaded a CJS body as an ES module: "ReferenceError: exports is
// not defined in ES module scope". It passed locally and failed in CI,
// which is the worst of both.
//
// A child process reads the module exactly as `next.config.mjs` and
// `gen-headers.mjs` do — the same loader, the same file, no transform in
// between. That is also the only reading that can prove anything about
// what ships.
function fromNode(): { prod: string; dev: string } {
  // __dirname, because Playwright compiles these specs to CommonJS —
  // the same reading the other specs in this repo use.
  const module = pathToFileURL(
    path.join(__dirname, '..', '..', 'scripts', 'security-headers.mjs'),
  ).href;
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { SECURITY_HEADERS, cspForDevServer } from ${JSON.stringify(module)};
       process.stdout.write(JSON.stringify({
         prod: SECURITY_HEADERS['Content-Security-Policy'],
         dev: cspForDevServer(),
       }));`,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(out) as { prod: string; dev: string };
}

const { prod: PROD_CSP, dev: DEV_CSP } = fromNode();

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
  const csp = PROD_CSP;
  expect(csp).not.toContain('unsafe-eval');
  expect(directives(csp).get('script-src')).toEqual([
    "'self'",
    "'unsafe-inline'",
  ]);
});

test('the dev server allows it, and nothing else changes', () => {
  const prod = directives(PROD_CSP);
  const dev = directives(DEV_CSP);

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
  const d = directives(PROD_CSP);
  expect(d.get('worker-src')).toContain('blob:');
  expect(d.get('img-src')).toContain('blob:');
  expect(d.get('object-src')).toEqual(["'none'"]);
  expect(d.get('frame-ancestors')).toEqual(["'none'"]);
});

// ── the build-mode guard, which was only ever proved by hand ───────────
//
// 🔴 Review's point, and it was fair: "Доведено втрьох" was a session I
// ran once, not something that re-runs. Deleting the whole block left
// every test green. These assert it.

function genHeaders(env: Record<string, string>) {
  const script = path.join(__dirname, '..', '..', 'scripts', 'gen-headers.mjs');
  // 🔴 Both names are removed first, so a value in the ambient shell
  // cannot decide the result of a test about those very values.
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => k !== 'NODE_ENV' && k !== 'npm_lifecycle_event',
    ),
  );
  const res = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    // The repo types NODE_ENV as required; here its ABSENCE is the case
    // under test, which is exactly what the cast is for.
    env: { ...base, ...env } as NodeJS.ProcessEnv,
  });
  return { code: res.status, err: res.stderr ?? '' };
}

test('a build made in development mode is refused', () => {
  // next.config.mjs adds 'unsafe-eval' in that mode, and `next start`
  // serves whatever the build baked into routes-manifest.json — so this
  // would ship a production site with unsafe-eval allowed.
  const { code, err } = genHeaders({ NODE_ENV: 'development' });
  expect(code).toBe(1);
  expect(err).toContain('unsafe-eval');
});

test('and no lifecycle name talks its way past it', () => {
  // 🔴 The first version exempted `npm_lifecycle_event === 'predev'`,
  // for a script that did not exist — a one-word bypass of a security
  // check, documented in the source.
  for (const event of ['predev', 'prebuild', 'build', 'dev', 'anything']) {
    const { code } = genHeaders({ NODE_ENV: 'development', npm_lifecycle_event: event });
    expect(code, `npm_lifecycle_event=${event} got through`).toBe(1);
  }
});

test('a normal build is not refused', () => {
  expect(genHeaders({}).code).toBe(0);
  expect(genHeaders({ NODE_ENV: 'production' }).code).toBe(0);
});
