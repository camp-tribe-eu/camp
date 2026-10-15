import { expect, test } from './api-request';

// CAMP-240 — /routes, /tools and /search as a crawler is served them.
//
// 🔴 READ OFF THE SERVED DOCUMENT, NOT OFF A COMPONENT. The unit spec
// (tests/unit/thin-pages.spec.tsx) renders the components; what Google
// receives also has a `<link rel="canonical">` and a `<meta name="robots">`
// that Next writes from the page's `metadata`, and a `robots.txt` that is
// a different file again. The card's verification is about those three
// things, and none of them is in what a component renders.
//
// 🔴 CONSISTENT WITH THE BUILD MODE, NOT PINNED TO ONE. While the site is
// closed every page carries `noindex` and robots.txt disallows everything;
// launched, only /search keeps its `noindex`. A test fixed to either mode
// would fail on launch day, for the best possible reason, and be deleted —
// the same position tests/e2e/indexing.spec.ts takes.

const CLOSED = process.env.NEXT_PUBLIC_SITE_MODE !== 'public';

const PAGES = [
  { path: '/routes', last: 'Routes', type: 'CollectionPage', indexable: true },
  { path: '/tools', last: 'Tools', type: 'CollectionPage', indexable: true },
  { path: '/search', last: 'Search', type: 'SearchResultsPage', indexable: false },
] as const;

function blocks(html: string): Record<string, unknown>[] {
  return [
    ...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
}

const metaRobots = (html: string): string | undefined =>
  /<meta name="robots" content="([^"]+)"/i.exec(html)?.[1];

for (const p of PAGES) {
  test.describe(`${p.path}, as served`, () => {
    test('🔴 canonical is the page itself', async ({ request }) => {
      const res = await request.get(p.path);
      expect(res.status()).toBe(200);
      const html = await res.text();
      const canonical = /<link rel="canonical" href="([^"]+)"/i.exec(html)?.[1];
      expect(canonical, `no canonical on ${p.path}`).toBeDefined();
      expect(new URL(canonical!).pathname).toBe(p.path);
    });

    test('🔴 JSON-LD: the page, and a breadcrumb from home to it', async ({ request }) => {
      const html = await (await request.get(p.path)).text();
      const all = blocks(html);
      const types = all.map((b) => b['@type']);
      expect(types, `JSON-LD on ${p.path}`).toContain(p.type);
      expect(types).toContain('BreadcrumbList');

      const list = all.find((b) => b['@type'] === 'BreadcrumbList') as {
        itemListElement: { position: number; name: string; item: string }[];
      };
      list.itemListElement.forEach((it, i) => expect(it.position).toBe(i + 1));
      const names = list.itemListElement.map((i) => i.name);
      expect(names[0]).toBe('CampTribe');
      expect(names[names.length - 1]).toBe(p.last);
      expect(new URL(list.itemListElement[list.itemListElement.length - 1].item).pathname).toBe(
        p.path,
      );
    });

    test('🔴 a breadcrumb the reader can see, and it is the one in the JSON-LD', async ({
      page,
    }) => {
      await page.goto(p.path);
      const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect(nav).toBeVisible();
      // `toHaveText` on the whole nav: names, in order, with the page
      // itself last and not a link.
      await expect(nav).toHaveText(new RegExp(`^CampTribe\\s*/\\s*${p.last}$`));
      await expect(nav.getByRole('link')).toHaveCount(1);
      await expect(nav.getByRole('link', { name: 'CampTribe' })).toHaveAttribute('href', '/');
      await expect(nav.locator('[aria-current="page"]')).toHaveText(p.last);
    });

    test('🔴 robots meta: an indexable page follows the build mode, /search is noindex+follow in both', async ({
      request,
    }) => {
      const html = await (await request.get(p.path)).text();
      const robots = metaRobots(html);
      expect(robots, `no robots meta on ${p.path}`).toBeDefined();
      if (p.indexable) {
        expect(/noindex/i.test(robots!)).toBe(CLOSED);
      } else {
        expect(robots).toMatch(/noindex/i);
        // `follow`, so the links out of it still carry weight — and not
        // `nofollow`, which contains the word `follow`.
        expect(robots).toMatch(/(?:^|,\s*)follow(?:\s*,|$)/i);
        expect(robots).not.toMatch(/nofollow/i);
      }
    });
  });
}

test.describe('/search and robots.txt', () => {
  // 🔴 The card's own sentence: a path closed in robots.txt is never
  // fetched, so a `noindex` on it is never read, and the URL can still be
  // listed as a bare link. `/search` must carry the `noindex` AND be
  // crawlable. Only meaningful once the site is open — while it is
  // closed, `Disallow: /` covers everything and that is the point.
  test('🔴 is not disallowed — a closed path cannot show its noindex', async ({ request }) => {
    test.skip(CLOSED, 'Only meaningful once the site is open.');
    const robots = await (await request.get('/robots.txt')).text();

    // The rules of the `*` group, read as a crawler reads them.
    const group = robots
      .split(/\n\s*\n/)
      .find((g) => /^\s*user-agent:\s*\*\s*$/im.test(g));
    expect(group, 'no rules for every crawler').toBeDefined();
    const disallowed = [...group!.matchAll(/^\s*disallow:\s*(\S*)\s*$/gim)]
      .map((m) => m[1])
      .filter((d) => d !== '');
    expect(disallowed.length, 'robots.txt closes nothing at all — was it read?').toBeGreaterThan(0);

    for (const rule of disallowed) {
      expect('/search'.startsWith(rule), `robots.txt disallows ${rule}, which covers /search`).toBe(
        false,
      );
    }
  });
});
