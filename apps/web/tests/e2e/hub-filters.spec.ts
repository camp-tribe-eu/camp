import { expect, test, type APIRequestContext } from './api-request';
import { AMENITY_KEYS, API_BASE } from '@/lib/api';

// The region hub's filters, on the built site, with the API as the
// outside arbiter: every number the page prints is compared with the
// count the API gives for the same question, never with the page itself.
//
// Regions are resolved from the database, never named — as in hubs.spec.
// What is chosen is the first region, in any country, for which some type
// is a real subset (0 < n < total); the fixture holds several.

interface Hub {
  country: string;
  slug: string;
  spots: number;
}

interface Listing {
  total: number;
  matched: number;
  unknownExcluded: number;
  facets: { types: Record<string, number>; amenities: Record<string, number> };
  dropOne: { kind: string; key: string; matched: number }[];
  items: { slug: string }[];
}

const listing = async (
  request: APIRequestContext,
  h: Hub,
  search = '',
): Promise<Listing> =>
  (await request.get(`${API_BASE}/spots/${h.country}/${h.slug}?page=1${search}`)).json();

/** A hub and a type that narrows it: 0 < n < total. */
async function narrowable(request: APIRequestContext) {
  const countries: { country: string }[] = await (
    await request.get(`${API_BASE}/spots/countries`)
  ).json();
  for (const { country } of countries) {
    const regions: Omit<Hub, 'country'>[] = await (
      await request.get(`${API_BASE}/spots/${country}/regions`)
    ).json();
    for (const r of regions) {
      const h = { ...r, country };
      const l = await listing(request, h);
      const t = Object.entries(l.facets.types).find(
        ([, n]) => n > 0 && n < l.total,
      );
      if (t) return { hub: h, type: t[0], all: l };
    }
  }
  throw new Error('No region in the data has a type that is a strict subset of it');
}

const hubPath = (h: Hub) => `/camping/${h.country}/${h.slug}`;

test.describe('hub filters, no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('🔴 a type chip is a plain link, and the page prints the API\'s count for it', async ({
    page,
    request,
  }) => {
    const { hub, type, all } = await narrowable(request);
    const filtered = await listing(request, hub, `&types=${type}`);
    // The arbiter, before anything is looked at: the filter narrows.
    expect(filtered.matched).toBeGreaterThan(0);
    expect(filtered.matched).toBeLessThan(all.total);

    await page.goto(hubPath(hub));
    await expect(page.getByText(/sites match/)).toHaveCount(0);
    await page.locator(`a[href="${hubPath(hub)}/filter?types=${type}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${hubPath(hub)}/filter\\?types=${type}$`));

    // The number on the page is the API's, not the length of the list.
    await expect(page.locator('[data-hub-match]')).toHaveText(
      new RegExp(`^${filtered.matched} sites? match`),
    );
    const cards = page.locator('main ul.grid li a');
    expect(await cards.count()).toBe(Math.min(filtered.matched, 24));
    // And every card is one the API listed for that filter.
    const listed = new Set(filtered.items.map((s) => `${hubPath(hub)}/${s.slug}`));
    for (const href of await cards.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
      expect(listed.has(href ?? '')).toBe(true);
    }
    // "clear filters" is the region's own address.
    await page.getByRole('link', { name: 'clear filters' }).click();
    await expect(page).toHaveURL(new RegExp(`${hubPath(hub)}$`));
  });

  test('🔴 a combination nothing matches is a 200 with a reason and three actions', async ({
    page,
    request,
  }) => {
    const { hub } = await narrowable(request);
    // Every facility at once. The fixture has no such site; if it ever
    // does, this must say so rather than pass over something else.
    const search = `&amenities=${AMENITY_KEYS.join(',')}`;
    const empty = await listing(request, hub, search);
    expect(empty.matched, 'the fixture grew a site with every facility').toBe(0);

    const res = await page.goto(`${hubPath(hub)}/filter?amenities=${AMENITY_KEYS.join(',')}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('[data-hub-match]')).toHaveText(/^0 sites match/);
    await expect(page.getByText(`Nothing matches all ${AMENITY_KEYS.length} filters`)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /is recorded with/ })).toBeVisible();
    expect(await page.locator('main ul.grid li').count()).toBe(0);

    const actions = page.locator('[data-hub-empty-actions] a');
    await expect(actions).toHaveCount(3);
    await expect(actions.nth(0)).toHaveText(/^Remove “/);
    await expect(actions.nth(1)).toHaveText('Clear all filters');
    await expect(actions.nth(1)).toHaveAttribute('href', hubPath(hub));
    await expect(actions.nth(2)).toHaveAttribute('href', `/camping/${hub.country}`);
    // "Remove X" names the filter the API says gives the most back.
    const best = empty.dropOne.reduce((b, d) => (d.matched > b.matched ? d : b));
    const removeHref = (await actions.nth(0).getAttribute('href')) ?? '';
    const left = new URL(removeHref, 'http://x').searchParams.get('amenities')?.split(',') ?? [];
    expect(left).toHaveLength(AMENITY_KEYS.length - 1);
    expect(left).not.toContain(best.key);
    // Following it lands on a real list — one plain click, no scripts —
    // and the page prints the count the API gives for what is left.
    await actions.nth(0).click();
    const after = await listing(request, hub, `&amenities=${left.join(',')}`);
    expect(after.matched).toBe(best.matched);
    await expect(page.locator('[data-hub-match]')).toHaveText(
      new RegExp(`^${after.matched} sites? match`),
    );
  });
});

test.describe('hub filters, every chip predicts its click', () => {
  test.use({ javaScriptEnabled: false });

  test('🔴 on the plain hub and on a filtered view, chip count == "N sites match" after the click', async ({
    page,
    request,
  }) => {
    const { hub, type } = await narrowable(request);
    for (const start of [hubPath(hub), `${hubPath(hub)}/filter?types=${type}`]) {
      await page.goto(start);
      const chips = await page
        .locator('nav[aria-label="Filter campsites"] a')
        .evaluateAll((as) =>
          as
            .map((a) => ({ href: a.getAttribute('href') ?? '', text: a.textContent ?? '' }))
            .filter((c) => /\d+\s*$/.test(c.text))
            .map((c) => ({ href: c.href, count: Number(/(\d+)\s*$/.exec(c.text)![1]) })),
        );
      expect(chips.length, start).toBe(15);
      for (const chip of chips) {
        // React leaves `<!-- -->` between adjacent text children, so the
        // served markup reads `<b>23</b> <!-- -->sites match` and
        // `30<!-- --> <!-- -->sites<!-- --> in`. Read it without them.
        const html = (await (await request.get(chip.href)).text()).replace(/<!--\s*-->/g, '');
        const said = chip.href.includes('/filter?')
          ? /(\d+)<\/b> sites? match/.exec(html)?.[1]
          : /(\d+) sites? in /.exec(html)?.[1];
        expect({ start, href: chip.href, count: chip.count }).toEqual({
          start,
          href: chip.href,
          count: Number(said),
        });
      }
    }
  });
});

test.describe('hub filters, indexing', () => {
  test('a filtered view is noindex, follow, with the region as canonical', async ({ request }) => {
    const { hub, type } = await narrowable(request);
    const res = await request.get(`${hubPath(hub)}/filter?types=${type}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<meta name="robots" content="noindex[,\s]*follow/i);
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${hubPath(hub)}"`));
  });

  test('/filter with nothing to filter is one 308 to the static address', async ({ request }) => {
    const { hub } = await narrowable(request);
    const res = await request.get(`${hubPath(hub)}/filter`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()['location']).toMatch(new RegExp(`${hubPath(hub)}$`));
  });

  test('another spelling of a state is one 308 to its canonical address', async ({ request }) => {
    const { hub, type } = await narrowable(request);
    for (const spelling of [`types=${type}&page=1`, `types=${type}&sort=name`, `sort=name&types=${type}`]) {
      const res = await request.get(`${hubPath(hub)}/filter?${spelling}`, { maxRedirects: 0 });
      expect(res.status(), spelling).toBe(308);
      expect(res.headers()['location'], spelling).toMatch(new RegExp(`${hubPath(hub)}/filter\\?types=${type}$`));
    }
  });

  test('page=1e20 and a page past the set are not a 500', async ({ request }) => {
    const { hub, type } = await narrowable(request);
    const huge = await request.get(`${hubPath(hub)}/filter?types=${type}&page=1e20`, { maxRedirects: 0 });
    expect(huge.status()).toBe(308);
    const past = await request.get(`${hubPath(hub)}/filter?types=${type}&page=999`);
    expect(past.status()).toBe(404);
  });

  test('an unknown region under /filter is a real 404 page, not a blank shell', async ({ request }) => {
    const res = await request.get('/camping/si/no-such-region/filter?types=free');
    expect(res.status()).toBe(404);
    expect(await res.text()).toMatch(/Browse by country/);
  });
});
