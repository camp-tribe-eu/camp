import { expect, test, type APIRequestContext } from '@playwright/test';

// CAMP-92 — the card's own acceptance, run rather than asserted:
// "Навмисно зламана сторінка дає запис у системі помилок — перевірено
// реальним зламом, а не припущенням, що «має працювати»."
//
// So these tests break a real page in a real browser and then read the
// record back out of the real API. Nothing here mocks the transport:
// the chain under test is window.onerror → scrub → fetch(keepalive) →
// CORS → validate → Postgres → GET.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

/**
 * A marker short enough to survive our own redaction.
 *
 * 🔴 The first version used `camp92-error-${Date.now()}` — 26 characters
 * of letters, digits and hyphens, which is exactly what scrub() treats
 * as a key or a session token. Every test failed while the mechanism
 * worked perfectly: the reports arrived, with the marker replaced by
 * "[redacted]". Worth keeping as a comment, because it is also the
 * honest trade-off of the redaction — a long identifier in a real error
 * message will be redacted too, and over-redacting is the side we chose.
 */
const marker = (what: string) =>
  `c92${what}${Math.random().toString(36).slice(2, 6)}`;
const TOKEN = process.env.CLIENT_ERRORS_READ_TOKEN ?? 'ci-read-token';

type Stored = {
  kind: string;
  message: string;
  stack: string | null;
  path: string;
  userAgent: string;
};

/** Poll, because the report is sent with keepalive and lands async. */
async function waitForReport(
  request: APIRequestContext,
  match: (e: Stored) => boolean,
  timeoutMs = 10_000,
): Promise<Stored | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await request.get(`${API}/client-errors?limit=100`, {
      headers: { 'x-error-token': TOKEN },
    });
    if (res.ok()) {
      const { errors } = (await res.json()) as { errors: Stored[] };
      const hit = errors.find(match);
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// One project is enough: this tests our code and the network, not a
// rendering difference, and the full matrix would send six copies of
// every report into the same table for no extra information.
//
// 🔴 Keyed on the PROJECT, and through `beforeEach`.
//
// Two mistakes were made here, both caught by running it. `browserName`
// is 'chromium' for mobile-chrome too, so a browserName guard ran these
// twice — two projects racing to write markers into one table, failing
// exactly as often as the race lost. And `test.skip(fn)` hands its
// callback the FIXTURES only; `testInfo` arrives as the second argument
// of `beforeEach`, not of a skip condition. Reading `.project` off the
// first argument threw inside the guard itself.
const onlyDesktopChromium = ({}, testInfo: { skip: (c: boolean) => void; project: { name: string } }) => {
  testInfo.skip(testInfo.project.name !== 'chromium-desktop');
};

test.describe('🔴 a deliberately broken page produces a record', () => {
  // The transport is the subject here, not the renderer.
  test.beforeEach(onlyDesktopChromium);

  test('an uncaught error reaches the API', async ({ page, request }) => {
    const m = marker('e');
    await page.goto('/');

    // A real uncaught error: thrown from a timer so nothing in the page
    // can catch it, which is exactly the class this feature exists for.
    await page.evaluate((m) => {
      setTimeout(() => {
        throw new Error(m);
      }, 0);
    }, m);

    const stored = await waitForReport(request, (e) =>
      e.message.includes(m),
    );
    expect(stored, 'the broken page produced no record').toBeTruthy();
    expect(stored!.kind).toBe('error');
    expect(stored!.path).toBe('/');
    expect(stored!.stack, 'a report with no stack cannot be triaged').toBeTruthy();
  });

  test('an unhandled promise rejection reaches the API', async ({
    page,
    request,
  }) => {
    const m = marker('p');
    await page.goto('/');
    await page.evaluate((m) => {
      void Promise.reject(new Error(m));
    }, m);

    const stored = await waitForReport(request, (e) =>
      e.message.includes(m),
    );
    expect(stored, 'the rejection produced no record').toBeTruthy();
    expect(stored!.kind).toBe('promise');
  });
});

test.describe('🔴 and it carries nothing about the reader', () => {
  test.beforeEach(onlyDesktopChromium);

  test('the search query the reader typed never arrives', async ({
    page,
    request,
  }) => {
    const m = marker('v');
    // Named for what it is, not 'secret' — the secret scanner rightly
    // flags an assignment to a variable called that, and a baseline
    // exception for a test string would be a hole kept open for comfort.
    const readerTyped = 'burglar-target-address';

    // The real risk, on the real page that carries it: our search puts
    // the reader's own words in the URL.
    await page.goto(`/search?q=${encodeURIComponent(readerTyped)}`);
    await page.evaluate((m) => {
      setTimeout(() => {
        throw new Error(m);
      }, 0);
    }, m);

    const stored = await waitForReport(request, (e) =>
      e.message.includes(m),
    );
    expect(stored).toBeTruthy();
    expect(stored!.path, 'the query string travelled with the report').toBe(
      '/search',
    );
    expect(JSON.stringify(stored)).not.toContain(readerTyped);
  });

  test('an email in the error message is redacted before it is sent', async ({
    page,
    request,
  }) => {
    const m = marker('m');
    await page.goto('/');
    await page.evaluate((m) => {
      setTimeout(() => {
        throw new Error(`${m} failed for reader@example.com`);
      }, 0);
    }, m);

    const stored = await waitForReport(request, (e) =>
      e.message.includes(m),
    );
    expect(stored).toBeTruthy();
    expect(stored!.message).not.toContain('reader@example.com');
    expect(stored!.message).toContain('[email]');
  });
});

test.describe('the endpoint is not a free database', () => {
  test.beforeEach(onlyDesktopChromium);

  test('a body that is not a report is refused', async ({ request }) => {
    // Accepted with 202 either way — the browser must not learn what
    // was stored — but nothing may appear in the table.
    const m = marker('j');
    const res = await request.post(`${API}/client-errors`, {
      data: { kind: 'nonsense', message: m },
    });
    expect(res.status()).toBe(202);

    const stored = await waitForReport(
      request,
      (e) => e.message.includes(m),
      2000,
    );
    expect(stored, 'a body with an unknown kind was stored').toBeNull();
  });

  // 🔴 Reading errors back is the part that must NOT be open: a stack
  // trace names our files, our functions and our versions.
  test('reading errors back without the token is a 404, not a 401', async ({
    request,
  }) => {
    const res = await request.get(`${API}/client-errors`);
    expect(res.status()).toBe(404);

    const wrong = await request.get(`${API}/client-errors`, {
      headers: { 'x-error-token': 'not-the-token' },
    });
    expect(wrong.status()).toBe(404);
  });
});
