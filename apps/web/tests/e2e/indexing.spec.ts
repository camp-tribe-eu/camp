import { expect, test } from './api-request';

// CAMP-90. The tests read the mode the build declares and then assert
// the whole site agrees with it — the same shape as the CI checker, but
// against a running server rather than files, so the headers are real.
//
// 🔴 Deliberately NOT "assert closed". A test pinned to one mode would
// fail on the day we launch for the best possible reason, and somebody
// would delete it. It asserts consistency instead, which is true in
// both modes and worth keeping for ever.

const CLOSED = process.env.NEXT_PUBLIC_SITE_MODE !== 'public';

test.describe('indexing posture', () => {
  test('robots.txt matches the build mode', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    if (CLOSED) {
      expect(robots).toMatch(/Disallow:\s*\/\s*$/m);
      // No sitemap line: advertising a page list while blocking the
      // crawl is two contradictory instructions about the same URLs.
      expect(robots).not.toMatch(/^\s*Sitemap:/im);
    } else {
      expect(robots).not.toMatch(/Disallow:\s*\/\s*$/m);
      expect(robots).toMatch(/^\s*Sitemap:/im);
    }
  });

  test('🔴 pages and robots.txt never disagree', async ({ request }) => {
    // The failure mode this catches is a half-closed site: blocked from
    // crawling but still listed as a bare URL, which is the worst of
    // both worlds and looks fine from either side alone.
    const html = await (await request.get('/camping')).text();
    const noindex = /<meta name="robots"[^>]*content="[^"]*noindex/i.test(html);
    expect(noindex).toBe(CLOSED);
  });

  test('a closed build says so on every kind of response', async ({
    request,
  }) => {
    test.skip(!CLOSED, 'Only meaningful while the site is closed.');
    // A meta tag is inside HTML and does nothing for XML, text or fonts.
    // These three are all indexable on their own.
    for (const url of ['/', '/sitemap.xml', '/llms.txt']) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(200);
      expect(res.headers()['x-robots-tag'] ?? '', url).toMatch(/noindex/i);
    }
  });
});
