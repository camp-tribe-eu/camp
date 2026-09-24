import { expect, request as playwrightRequest, test } from '@playwright/test';

// CAMP-69 — the rate limit, on the running API.
//
// 🔴 Every other spec imports `test` from ./api-request, whose `request`
// fixture carries the build token — they resolve their subjects from the
// API and would otherwise throttle themselves. This file imports the
// plain @playwright/test on purpose: its subject is what happens WITHOUT
// a token, and a file asking that question must not be handed one
// invisibly.
//
// That is the whole point. A limit only the configuration knows about is
// not a limit — this is the test that would fail if somebody "fixed a
// flaky build" by raising the numbers until nothing ever 429s.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

/**
 * A caller with no token, like anybody on the internet — and with an
 * address nobody else is using.
 *
 * 🔴 The address is randomised, and that is not decoration.
 *
 * The limiter keeps its counts in memory for a minute. Running this
 * suite twice inside that minute left the previous run's twelve refused
 * calls still in the bucket, so the second run saw 429 on its very first
 * request and failed with "nothing succeeded at all" — a red build
 * caused by the test, not by the code.
 *
 * A fresh address per run gives a fresh bucket. It also proves something
 * worth proving: the API counts against `CF-Connecting-IP`, not against
 * the socket, which is the difference between limiting one visitor and
 * limiting everyone behind Cloudflare at once.
 */
async function stranger() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return playwrightRequest.newContext({
    extraHTTPHeaders: {
      // 198.51.100.0/24 is TEST-NET-2 (RFC 5737): reserved for
      // documentation, so it can never collide with a real visitor.
      'cf-connecting-ip': `198.51.100.${octet()}`,
    },
  });
}

/**
 * A caller that identifies itself, like the build and like the rest of
 * this suite.
 *
 * 🔴 Built here rather than taken from the `request` fixture, because
 * this file deliberately imports the plain `@playwright/test` — every
 * other spec uses api-request.ts, which adds the token, and a file whose
 * subject is "what happens without a token" must not have one handed to
 * it invisibly.
 */
async function insider() {
  return playwrightRequest.newContext({
    extraHTTPHeaders: { 'x-build-token': process.env.API_BUILD_TOKEN ?? '' },
  });
}

test.describe('🔴 the API is not a free buffet', () => {
  // One project: this is about the server, and six browsers asking the
  // same question would only mean six times the requests against one
  // shared bucket — they would throttle each other and the result would
  // depend on which finished first.
  //
  // 🔴 Through `beforeEach`, not `test.skip(fn)`. A skip condition gets
  // the FIXTURES as its first argument; `testInfo` only arrives as the
  // second argument of beforeEach. Reading `.project` off the first one
  // throws inside the guard itself — which error-reporting.spec.ts
  // already learned and wrote down, and I repeated anyway.
  test.beforeEach(({}, testInfo) => {
    testInfo.skip(
      testInfo.project.name !== 'chromium-desktop',
      'server behaviour, not a rendering difference',
    );
  });

  test('a whole-dataset route stops answering an unauthenticated flood', async () => {
    const anon = await stranger();
    const codes: number[] = [];
    // Comfortably past the bulk limit, small enough to stay quick.
    for (let i = 0; i < 12; i++) {
      codes.push((await anon.get(`${API}/spots/index`)).status());
    }
    await anon.dispose();

    expect(
      codes.filter((c) => c === 200).length,
      'nothing succeeded at all — the API may be down rather than limiting',
    ).toBeGreaterThan(0);
    expect(
      codes.filter((c) => c === 429).length,
      `twelve unauthenticated calls to /spots/index were all allowed: ${codes.join(',')}`,
    ).toBeGreaterThan(0);
    // 🔴 And the limit must bite EARLY, not on the twelfth. A bulk route
    // that allows eleven whole-dataset downloads before objecting is a
    // limit in name only.
    expect(codes.indexOf(429)).toBeLessThan(10);
  });

  test('the build token lifts it, which is why the suite can run at all', async () => {
    test.skip(
      !process.env.API_BUILD_TOKEN,
      'no build token configured in this environment',
    );
    const build = await insider();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await build.get(`${API}/spots/index`)).status());
    }
    await build.dispose();
    expect(
      codes.every((c) => c === 200),
      `a tokened caller was throttled: ${codes.join(',')}`,
    ).toBe(true);
  });

  test('an ordinary read is far more generous than a whole-dataset one', async () => {
    const anon = await stranger();
    const codes: number[] = [];
    // Above the bulk limit, well below the default.
    for (let i = 0; i < 15; i++) {
      codes.push((await anon.get(`${API}/spots/countries`)).status());
    }
    await anon.dispose();
    expect(
      codes.every((c) => c === 200),
      `a cheap route was throttled at 15 calls: ${codes.join(',')}`,
    ).toBe(true);
  });
});
