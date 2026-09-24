import { expect, test } from '@playwright/test';

// 🔴 The same flag the build was made with. These assertions are about
// the sitemap agreeing with the pages, and what "agreeing" means flips
// with the mode — so the test flips too rather than being skipped.
// A test that only runs in one mode stops running the day we launch.
const CLOSED = process.env.NEXT_PUBLIC_SITE_MODE !== 'public';

// CAMP-39. The card's criteria, as tests: a new page in the database
// appears in the sitemap without a code change, the sitemap is valid, and
// llms.txt is served at its correct path.

test.describe('sitemap', () => {
  test('the index points at children that exist', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('xml');

    const xml = await res.text();
    expect(xml).toContain('<sitemapindex');

    const children = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      const childRes = await request.get(new URL(child).pathname);
      expect(childRes.status(), child).toBe(200);
      expect(await childRes.text()).toContain('<urlset');
    }
  });

  test('🔴 the sitemap and the pages never disagree', async ({ request }) => {
    // A sitemap says "index this"; a noindex meta says the opposite.
    // Which one wins is Google's choice, not ours, so they must agree —
    // both indexable in a public build, both noindex in a closed one.
    const hubs = await (await request.get('/sitemaps/hubs.xml')).text();
    const urls = [...hubs.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);

    for (const url of urls.slice(0, 20)) {
      const html = await (await request.get(new URL(url).pathname)).text();
      const noindex = /<meta name="robots"[^>]*content="[^"]*noindex/i.test(html);
      expect(noindex, url).toBe(CLOSED);
    }
  });

  test('🔴 a thin hub is absent from the sitemap but still reachable', async ({
    request,
  }) => {
    const all: { slug: string; indexable: boolean }[] = await (
      await request.get(
        `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/spots/si/regions`,
      )
    ).json();
    const thin = all.find((r) => !r.indexable)!;

    const hubs = await (await request.get('/sitemaps/hubs.xml')).text();
    // Below the threshold it is noindex (CAMP-71), so it must not be in
    // the sitemap...
    expect(hubs).not.toContain(`/camping/si/${thin.slug}<`);
    // ...but the page is alive, because it is the only path down to its
    // campsite without the map.
    expect((await request.get(`/camping/si/${thin.slug}`)).status()).toBe(200);
  });

  test('every campsite page is listed', async ({ request }) => {
    const index = await request.get(
      `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/spots/index`,
    );
    const spots = await index.json();

    // 🔴 Across every chunk, not just the first.
    //
    // This read campsites-0.xml alone and was right until CAMP-107 took
    // the dataset past URLS_PER_SITEMAP (10 000), at which point the
    // sitemap did exactly what it was designed to do — split — and the
    // test reported 10 000 of 10 519 as a missing-pages failure. The
    // chunking was never the thing being tested; "every campsite has a
    // URL somewhere in the sitemap" was.
    const chunks = await request.get('/sitemap.xml');
    const locs = (await chunks.text()).match(/<loc>([^<]+)<\/loc>/g) ?? [];
    const campsiteFiles = locs
      .map((l) => l.replace(/<\/?loc>/g, ''))
      .filter((u) => /campsites-\d+\.xml$/.test(u))
      .map((u) => new URL(u).pathname);
    expect(
      campsiteFiles.length,
      'the sitemap index lists no campsite chunks',
    ).toBeGreaterThan(0);

    let listed = 0;
    for (const path of campsiteFiles) {
      const xml = await (await request.get(path)).text();
      listed += (xml.match(/<loc>/g) ?? []).length;
    }

    // No code change was needed for any of them: the list comes from the
    // database, which is the card's acceptance criterion.
    expect(listed).toBe(spots.length);
  });

  test('robots.txt points at the sitemap only when it should', async ({
    request,
  }) => {
    const robots = await (await request.get('/robots.txt')).text();
    if (CLOSED) {
      // Advertising a page list while blocking the crawl is two
      // contradictory instructions about the same URLs.
      expect(robots).not.toMatch(/^\s*Sitemap:/im);
    } else {
      expect(robots).toMatch(/Sitemap:\s*\S+\/sitemap\.xml/i);
    }
  });
});

test.describe('llms.txt', () => {
  test('is served as plain text at the conventional path', async ({
    request,
  }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
  });

  test('has the shape llmstxt.org describes', async ({ request }) => {
    const body = await (await request.get('/llms.txt')).text();
    expect(body).toMatch(/^# CampTribe/m);
    expect(body).toMatch(/^> /m);
    expect(body).toMatch(/^## /m);
    expect(body).toContain('/sitemap.xml');
  });

  test('🔴 states what the site does NOT have', async ({ request }) => {
    // An agent told plainly that we have no photographs and no ratings
    // will not invent them. Being explicit about gaps is the point.
    const body = await (await request.get('/llms.txt')).text();
    expect(body).toMatch(/No photographs/i);
    expect(body).toMatch(/No reviews and no ratings/i);
    expect(body).toMatch(/not recorded/i);
  });
});
