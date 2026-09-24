import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_BASE } from '@/lib/api';

// CAMP-34. Two fixtures on purpose: a campsite where OSM knows plenty,
// and one where it knows almost nothing. The second is the page that
// actually needs testing — the card's criterion is that the empty state
// "looks finished, not broken".
//
// 🔴 Both are resolved from the database at run time, never hard-coded.
// They were hard-coded once and broke twice: a dedup change elected a
// different winner and the slugs moved. A fixture pinned to a slug tests
// the dataset, not the behaviour, and it fails for reasons that have
// nothing to do with the thing under test.

interface Fixtures {
  rich: string;
  richWater: { m: number; name?: string };
  empty: string;
}

let fx: Fixtures;

async function resolveFixtures(request: APIRequestContext): Promise<Fixtures> {
  let rich: Fixtures['rich'] | null = null;
  let richWater: Fixtures['richWater'] | null = null;
  let empty: string | null = null;

  // 🔴 Two list requests, not one request per campsite.
  //
  // This used to walk the index asking for each campsite in turn, which
  // was fine at 3 147 entries. CAMP-107 took it to 10 519, and the index
  // is ordered by country: all 9 441 French campsites come first, none of
  // them carry amenities or surroundings, so the walk to the first
  // well-described one had to get through every one of them. Sixteen
  // tests failed on a 30 s beforeAll timeout, for a reason that had
  // nothing to do with campsite pages. Batching the requests did not
  // help either — the problem was how many, not how fast.
  //
  // So the candidates are narrowed with two whole-list endpoints the API
  // already has, and only the chosen ones are fetched in full. Nothing
  // is named: both subjects are still whatever the data happens to
  // contain, and the first in list order wins so the choice is stable.
  const markers: {
    slug: string;
    country: string;
    region: string;
    name: string | null;
    amenities: Record<string, string>;
    /**
     * 🔴 The page's URL as the API builds it, which is not
     * `/camping/${country}/${region}/${slug}`.
     *
     * The database stores a region's NAME ("Finistère") and the URL
     * carries its slug ("finistere"). Building the path here from the
     * name produced a 404 and four tests reading "That page is not
     * here" — a URL-shape bug in the test, wearing the costume of a
     * missing page. The API already exposes the path from the same
     * function the pages use; there is no reason for a second one.
     */
    path: string;
  }[] = (
    await (
      await request.get(
        `${API_BASE}/spots/map/points?bbox=-180,-85,180,85&limit=20000`,
      )
    ).json()
  ).markers;

  // Campsites that have surroundings recorded — `near` is built from the
  // same context the page renders.
  const withNear = new Set<string>(
    (
      (await (await request.get(`${API_BASE}/spots/search-index`)).json()) as {
        slug: string;
        near: unknown[];
      }[]
    )
      .filter((r) => r.near?.length)
      .map((r) => r.slug),
  );

  const known = (a: Record<string, string>) =>
    Object.values(a ?? {}).filter((v) => v !== 'unknown').length;

  // 🔴 `electricity === 'yes'` is part of the contract, not an extra.
  //
  // The test below asserts that the page shows Electricity: Yes. The old
  // walk asked only for "two known amenities" and happened to land on a
  // campsite whose electricity was one of them — luck, holding for as
  // long as the data did not move. It moved: the first campsite meeting
  // the loose condition now has electricity "unknown", and the test read
  // as a rendering bug. 83 campsites meet the strict one, measured
  // 24.09.2026, so asking for it costs nothing and removes the luck.
  const richCandidate = markers.find(
    (m) =>
      m.name &&
      withNear.has(m.slug) &&
      known(m.amenities) >= 2 &&
      m.amenities?.electricity === 'yes',
  );
  const emptyCandidate = markers.find((m) => !m.name && known(m.amenities) === 0);

  if (richCandidate) {
    const { spot } = await (
      await request.get(
        `${API_BASE}/spots/${richCandidate.country}/${richCandidate.region}/${richCandidate.slug}?nearby=0`,
      )
    ).json();
    // Confirmed on the record the page actually renders, not inferred
    // from the list: `near` says something is close, the page needs a
    // named body of water.
    if (spot.context?.water?.name) {
      rich = richCandidate.path;
      richWater = spot.context.water;
    }
  }
  if (emptyCandidate) {
    empty = emptyCandidate.path;
  }

  if (!rich || !richWater || !empty) {
    throw new Error(
      'Could not find both a well-described and an empty campsite in the ' +
        'database. Import data first: see scripts/osm-pipeline/.',
    );
  }
  return { rich, richWater, empty };
}

test.beforeAll(async ({ request }) => {
  fx = await resolveFixtures(request);
});

test.describe('campsite page', () => {
  test('renders a named campsite with its facilities', async ({ page }) => {
    await page.goto(fx.rich);
    const name = await page.getByRole('heading', { level: 1 }).textContent();
    // A named site must show its own name, not the generic type label.
    expect(name?.trim()).toBeTruthy();
    expect(name).not.toMatch(/^Campsite near /);
    await expect(page.getByRole('listitem').filter({ hasText: 'Electricity' }))
      .toContainText('Yes');
  });

  test('an unnamed campsite still gets a real heading', async ({ page }) => {
    await page.goto(fx.empty);
    // Never the bare type, and never empty: it must agree with <title>.
    // Never the bare type and never empty — and it must agree with
    // <title>, whichever region the fixture happens to land in.
    const h1 = (await page.getByRole('heading', { level: 1 }).textContent())!.trim();
    expect(h1).toMatch(/^(Campsite|Free campsite|Wild camping spot|Camper stop|Motorhome park) near .+/);
    await expect(page).toHaveTitle(new RegExp(h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('🔴 an unrecorded amenity never reads as absent', async ({ page }) => {
    await page.goto(fx.empty);
    const facilities = page.getByRole('listitem').filter({
      hasText: 'Drinking water',
    });
    await expect(facilities).toContainText('Not recorded');
    // The whole point of the tri-state: "no" is a claim about the campsite,
    // "not recorded" is a claim about our data. Printing the first when we
    // mean the second is a false statement about a real business.
    await expect(facilities).not.toContainText(/\bNo\b/);
  });

  test('🔴 no stock photography, and the owner is asked instead', async ({
    page,
  }) => {
    await page.goto(fx.empty);
    await expect(
      page.getByText(/don’t publish pictures we haven’t verified/i),
    ).toBeVisible();
    // If an <img> ever appears here without a verified source, this fails.
    await expect(page.locator('main img')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /add your photos/i })).toBeVisible();
  });

  test('ODbL attribution names the licence, not just the project', async ({
    page,
  }) => {
    await page.goto(fx.rich);
    // One licence notice per page, in the site footer — not repeated per
    // template, where it eventually gets left off one of them.
    const footer = page.locator('body > footer');
    await expect(footer).toContainText('OpenStreetMap contributors');
    await expect(
      footer.getByRole('link', { name: /Open Database License/i }),
    ).toBeVisible();
    // The page keeps only what is true of it alone: how fresh it is.
    await expect(page.locator('main')).toContainText(/Last checked against/i);
  });

  test('page fits the viewport with no horizontal scroll', async ({ page }) => {
    await page.goto(fx.empty);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto(fx.empty);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('what is around it (CAMP-33)', () => {
  test('🔴 states the surroundings as a sentence, not a table of numbers', async ({
    page,
  }) => {
    await page.goto(fx.rich);
    const section = page.locator('section', {
      has: page.getByRole('heading', { name: /around it/i }),
    });
    // The prose line is the part an assistant can quote and a person can
    // read. A bare list of figures would satisfy neither.
    await expect(section).toContainText(/sits at \d+ m above sea level/i);
    await expect(section).toContainText(fx.richWater.name!);
  });

  test('🔴 the nearest water is a real one, not the nearest ditch', async ({
    page,
  }) => {
    // The nearest water must be the named lake, reservoir, river or
    // coastline — never the unnamed drainage stream that is usually
    // closer. Slovenia has 26,654 streams against 338 lakes, so without
    // the filter half the country would look waterfront.
    await page.goto(fx.rich);
    const section = page.locator('section', {
      has: page.getByRole('heading', { name: /around it/i }),
    });
    const shown = fx.richWater.m < 1000
      ? `${fx.richWater.m} m`
      : `${(fx.richWater.m / 1000).toFixed(1)} km`;
    await expect(section).toContainText(shown);
    await expect(section).toContainText(fx.richWater.name!);
  });

  test('the search description carries a distinguishing fact', async ({
    page,
  }) => {
    await page.goto(fx.rich);
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute('content');
    // Not the same sentence 291 times with a swapped name.
    expect(description).toMatch(
      new RegExp(`${fx.richWater.name!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|above sea level`),
    );
  });

  test('a site with no computed context still renders', async ({ page }) => {
    // Nothing here may depend on the context existing: a newly imported
    // campsite has none until the next compute run.
    await page.goto(fx.empty);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('structured data (CAMP-37)', () => {
  const graphs = async (page: import('@playwright/test').Page) =>
    page.$$eval('script[type="application/ld+json"]', (nodes) =>
      nodes.map((n) => JSON.parse(n.textContent ?? '{}')),
    );

  test('🔴 a campsite is a Campground, not a CampingPitch', async ({ page }) => {
    await page.goto(fx.rich);
    const docs = await graphs(page);
    const camp = docs.find((d) => d['@type'] === 'Campground');
    expect(camp, 'no Campground block on the page').toBeTruthy();
    // CampingPitch is one pitch inside a campsite. Using it here would
    // tell every consumer we are describing a single pitch.
    expect(docs.some((d) => d['@type'] === 'CampingPitch')).toBe(false);
    expect(typeof camp.geo.latitude).toBe('number');
    expect(camp.address.addressCountry).toMatch(/^[A-Z]{2}$/);
  });

  test('🔴 an unknown amenity is absent, never marked up as false', async ({
    page,
  }) => {
    await page.goto(fx.empty);
    const docs = await graphs(page);
    const camp = docs.find((d) => d['@type'] === 'Campground');
    // This site has nothing recorded. Emitting `value: false` would put a
    // false claim about a real business into every consumer of the graph.
    expect(camp.amenityFeature ?? []).toHaveLength(0);
  });

  test('breadcrumbs are numbered from 1 without gaps', async ({ page }) => {
    await page.goto(fx.rich);
    const docs = await graphs(page);
    const crumbs = docs.find((d) => d['@type'] === 'BreadcrumbList');
    expect(crumbs).toBeTruthy();
    const positions = crumbs.itemListElement.map(
      (i: { position: number }) => i.position,
    );
    // Google drops the whole list on one wrong position, silently.
    expect(positions).toEqual([1, 2, 3, 4]);
  });

  test('🔴 no rating markup while we have no reviews', async ({ page }) => {
    await page.goto(fx.rich);
    const html = await page.content();
    expect(html).not.toMatch(/aggregateRating|ratingValue/);
  });

  test('a hub describes itself as a CollectionPage with its items', async ({
    page,
    request,
  }) => {
    // The list must hold exactly what the page links to. Asserting "more
    // than ten" was a claim about how much data happened to be loaded —
    // it passed locally on 102 regions and failed in CI on 5.
    const regions = await (
      await request.get(`${API_BASE}/spots/si/regions`)
    ).json();

    await page.goto('/camping/si');
    const docs = await graphs(page);
    const collection = docs.find((d) => d['@type'] === 'CollectionPage');
    expect(collection).toBeTruthy();
    expect(collection.mainEntity['@type']).toBe('ItemList');
    expect(collection.mainEntity.itemListElement).toHaveLength(regions.length);
    expect(collection.mainEntity.numberOfItems).toBe(regions.length);
  });
});
