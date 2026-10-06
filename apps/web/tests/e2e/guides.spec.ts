import { expect, test, type APIRequestContext } from './api-request';

// CAMP-66 — the guides section, on real pages.
//
// 🔴 What is actually being defended here is a legal obligation and a
// promise. Article 50(2) of the EU AI Act requires machine-made text to
// be marked; our own positioning requires that we never state what we do
// not know. A generated page is where both are easiest to break quietly,
// because nobody re-reads thirty-six of them.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

type Guide = {
  slug: string;
  title: string;
  provenance: string;
  generator: string | null;
};

async function guides(request: APIRequestContext): Promise<Guide[]> {
  const res = await request.get(`${API}/guides`);
  expect(res.ok(), 'the guides endpoint is not answering').toBe(true);
  return res.json();
}

test.describe('the section the header points at', () => {
  test('Guides is in the header and leads somewhere', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('navigation').getByRole('link', { name: 'Guides' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/guides$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Guides');
  });

  // 🔴 THE PROPERTY, NOT THE LAYOUT. This asserted that `/guides` links
  // every guide by title, which was true while the index was a flat list
  // and stopped being true when 1 268 guides made a flat list useless
  // (CAMP-210). The thing worth protecting was never "all on one page" —
  // it is that a guide the API publishes is a guide somebody can reach.
  //
  // 🔴 AND THE FIRST REWRITE WALKED HALF THE CATALOGUE. It followed only
  // `/guides/country/*`, so review could empty all five topic pages —
  // measured, `/guides/topic/water` rendering zero links — and this test
  // stayed green while the hub advertised "466 regions" over nothing.
  // Every facet the hub offers is walked now, and each one has to carry
  // guides rather than merely exist.
  test('every published guide is reachable from the index', async ({
    page,
    request,
  }) => {
    const list = await guides(request);
    expect(list.length, 'no guides are published').toBeGreaterThan(0);

    const hrefsOn = async (pattern: RegExp) =>
      page
        .getByRole('link')
        .evaluateAll(
          (links, source) =>
            links
              .map((l) => (l as HTMLAnchorElement).getAttribute('href') ?? '')
              .filter((h) => new RegExp(source).test(h)),
          pattern.source,
        );

    await page.goto('/guides');
    const facets = [...new Set(await hrefsOn(/^\/guides\/(country|topic)\//))];
    expect(facets.length, 'the index links no facet pages').toBeGreaterThan(0);

    // 🔴 A guide the parser cannot file is linked from the hub itself, in
    // "Not filed anywhere". Counting those here is what stops this test
    // and that block contradicting each other: review found the two
    // guards disagreeing, so a deliberate choice read as a product bug.
    const reachable = new Set(
      (await hrefsOn(/^\/guides\/[^/]+$/)).map((h) => h.replace('/guides/', '')),
    );

    const empty: string[] = [];
    for (const href of facets) {
      await page.goto(href);
      const found = await hrefsOn(/^\/guides\/[^/]+$/);
      if (found.length === 0) empty.push(href);
      for (const h of found) reachable.add(h.replace('/guides/', ''));
    }
    expect(empty, 'the index offers these facets and they list nothing').toEqual([]);

    const unreachable = list
      .map((g) => g.slug)
      .filter((slug) => !reachable.has(slug));
    expect(
      unreachable,
      'these guides are published and no catalogue page links them',
    ).toEqual([]);
  });

  test('every guide in the index is reachable', async ({ page, request }) => {
    const list = await guides(request);
    // A sample: enough to catch a broken path shape, cheap enough to run.
    const step = Math.max(1, Math.floor(list.length / 6));
    for (let i = 0; i < list.length; i += step) {
      const res = await page.request.get(`/guides/${list[i].slug}`);
      expect(res.status(), `/guides/${list[i].slug}`).toBe(200);
    }
  });
});

test.describe('🔴 the disclosure the AI Act requires', () => {
  test('a generated guide says so, above the text', async ({ page, request }) => {
    const list = await guides(request);
    const generated = list.find((g) => g.provenance !== 'human');
    test.skip(!generated, 'no machine-made guide in this build');

    await page.goto(`/guides/${generated!.slug}`);
    const block = page.getByTestId('provenance');
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute('data-provenance', generated!.provenance);

    // 🔴 Above the body. A mark a reader meets after they have read and
    // believed the text is a mark in form only.
    const blockBox = await block.boundingBox();
    const body = page.locator('main p').last();
    const bodyBox = await body.boundingBox();
    expect(
      blockBox!.y,
      'the disclosure sits below the text it describes',
    ).toBeLessThan(bodyBox!.y);
  });

  test('it names the program, not merely "a machine"', async ({
    page,
    request,
  }) => {
    const list = await guides(request);
    const generated = list.find((g) => g.provenance !== 'human' && g.generator);
    test.skip(!generated, 'no machine-made guide with a generator');

    await page.goto(`/guides/${generated!.slug}`);
    await expect(page.getByTestId('provenance')).toContainText(
      generated!.generator!,
    );
  });

  // The structured data has to agree with the page. A crawler that is
  // told an organisation authored text a program produced has been
  // misled just as surely as a reader would be.
  test('the structured data names the machine as the author', async ({
    page,
    request,
  }) => {
    const list = await guides(request);
    const generated = list.find((g) => g.provenance !== 'human' && g.generator);
    test.skip(!generated, 'no machine-made guide with a generator');

    const html = await (await page.request.get(`/guides/${generated!.slug}`)).text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]));
    const article = blocks.find((b) => b['@type'] === 'Article');
    expect(article, 'no Article block on a guide page').toBeTruthy();
    expect(article.author['@type']).toBe('SoftwareApplication');
    expect(article.author.name).toBe(generated!.generator);
  });
});

test.describe('🔴 a generated page still shows gaps as gaps', () => {
  test('it says how many campsites have nothing recorded', async ({
    page,
    request,
  }) => {
    const list = await guides(request);
    const g = list.find((x) => x.provenance === 'data-generated');
    test.skip(!g, 'no data-generated guide in this build');

    await page.goto(`/guides/${g!.slug}`);
    const text = await page.locator('main').innerText();
    // The sentence that makes the rest trustworthy: an absence is not a
    // "no". If this ever disappears, the page has started implying
    // knowledge we do not have.
    expect(text).toContain('never that the answer is no');
    expect(text).toContain('Nobody from CampTribe has visited');
  });
});

test.describe('the section is in the sitemap', () => {
  test('the index and the guides are listed', async ({ request }) => {
    const hubs = await (await request.get('/sitemaps/hubs.xml')).text();
    expect(hubs).toContain('/guides</loc>');

    const list = await guides(request);
    if (list.length > 0) {
      expect(
        hubs,
        'a published guide is missing from the sitemap',
      ).toContain(`/guides/${list[0].slug}</loc>`);
    }
  });
});
