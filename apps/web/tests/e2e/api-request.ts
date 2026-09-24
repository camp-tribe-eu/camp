import { test as base, type APIRequestContext } from '@playwright/test';

// CAMP-69 — the `request` fixture, carrying the build token.
//
// 🔴 Why this file exists instead of one line in playwright.config.ts.
//
// The obvious fix was `use.extraHTTPHeaders`, and it broke four tests in
// a way worth remembering: that setting applies to the BROWSER as well as
// to the test runner. A page then sends `x-build-token` on its
// cross-origin POST to /client-errors, which turns a simple request into
// a preflighted one — and our CORS allowlist is deliberately narrow
// (`allowedHeaders: ['Content-Type']`). The preflight was refused, the
// error reports never arrived, and the failure read as "the error
// reporter is broken" rather than "the test harness added a header".
//
// Widening CORS to fix a test harness would be the wrong trade, and
// main.ts says so in as many words: a wider allowance needs its own
// reasoning, not a borrowed one. So the token goes on the test runner's
// requests only, where it belongs — the browser never sends it, in tests
// or in production.
//
// ⚠️ The header goes on every request this context makes, which in this
// suite means our own site and our own API — both on localhost. It is
// not scoped per host, and it should not be pointed at a third party.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const TOKEN = process.env.API_BUILD_TOKEN;

/**
 * A `request` that identifies itself to our API as an internal caller.
 *
 * Specs import `test` and `expect` from here instead of
 * `@playwright/test`; nothing else changes at the call sites.
 */
export const test = base.extend<{ request: APIRequestContext }>({
  request: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({
      // 🔴 Carried over from the project config. Half this suite asks for
      // relative paths — `request.get('/legal/privacy')` — and a fresh
      // context without it turns every one of those into an invalid URL.
      baseURL,
      extraHTTPHeaders: TOKEN ? { 'x-build-token': TOKEN } : {},
    });
    await use(context);
    await context.dispose();
  },
});

export { expect } from '@playwright/test';

// Re-exported so a spec needs one import line, not two. Anything else
// Playwright exports can be added here when a spec first needs it.
export type { APIRequestContext, Page, Locator } from '@playwright/test';

/** The API base, so specs stop each spelling their own default. */
export const API_BASE = API;
