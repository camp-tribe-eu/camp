import { expect, test, type APIRequestContext } from '@playwright/test';

// CAMP-101 — the attribution, asserted on real pages.
//
// 🔴 This is a licence condition, so it gets a test rather than a habit.
// Licence Ouverte 2.0 requires the attribution to name the source AND the
// date the reused information was last updated, and forbids misleading
// anyone about either. Our records carry dates from January 2022 to this
// week, so the failure mode is not "the credit is missing" — it is "the
// credit is there and says nothing about freshness", which looks fine.
//
// Nothing here names a campsite. Every subject is resolved from the data
// the site ships, so a re-import cannot make the suite fail for the wrong
// reason.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

type Spot = {
  slug: string;
  country: string;
  region: string;
  sources: { id: string; updatedAt: string; fields: string[] }[];
};

/**
 * A campsite page whose data really carries the given source.
 *
 * 🔴 Verified, not assumed — but over a handful of candidates rather than
 * all 3 147, which the first version of this did and which made the suite
 * take minutes. The index gives country/region/slug; which source a
 * country's campsites came from is exactly what we must not hard-code, so
 * candidates are sampled across countries and each one is checked.
 */
async function pathWithSource(
  request: APIRequestContext,
  sourceId: string,
): Promise<string | null> {
  const res = await request.get(`${API}/spots/index`);
  if (!res.ok()) return null;
  const items = (await res.json()) as {
    country: string;
    region: string;
    slug: string;
  }[];

  // One candidate per country, then a few more, so a source that only
  // exists in one country is still found without walking the whole index.
  const seen = new Set<string>();
  const candidates = [
    ...items.filter((i) => {
      if (seen.has(i.country)) return false;
      seen.add(i.country);
      return true;
    }),
    ...items.slice(0, 40),
  ];

  for (const item of candidates) {
    const page = await request.get(
      `${API}/spots/${item.country}/${item.region}/${item.slug}`,
    );
    if (!page.ok()) continue;
    const { spot } = (await page.json()) as { spot: Spot };
    if (spot.sources?.some((s) => s.id === sourceId)) {
      return `/camping/${item.country}/${item.region}/${item.slug}`;
    }
  }
  return null;
}

test.describe('🔴 every campsite page says where its data came from', () => {
  test('the block names the source, its licence and a date', async ({
    page,
    request,
  }) => {
    const path = await pathWithSource(request, 'osm');
    expect(path, 'no campsite carries an OpenStreetMap source').toBeTruthy();

    await page.goto(path!);
    const note = page.getByTestId('source-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('OpenStreetMap');
    await expect(note).toContainText('ODbL');
    // A date, in a <time> element so a machine can read it too.
    await expect(note.locator('time')).toHaveCount(1);
    await expect(note.locator('time').first()).toHaveAttribute(
      'datetime',
      /^\d{4}-\d{2}-\d{2}/,
    );
  });

  // 🔴 The statement that used to be printed on 478 pages that are not in
  // OpenStreetMap at all.
  test('a campsite not in OpenStreetMap does not claim to be', async ({
    page,
    request,
  }) => {
    const path = await pathWithSource(request, 'datatourisme');
    test.skip(!path, 'no open-data campsite in this build');

    await page.goto(path!);
    const note = page.getByTestId('source-note');
    await expect(note).toContainText('DATAtourisme');
    await expect(note).toContainText('Licence Ouverte');

    const body = await page.locator('body').innerText();
    const fromOsm = await page
      .getByTestId('source-note')
      .innerText()
      .then((t) => t.includes('OpenStreetMap'));
    if (!fromOsm) {
      expect(
        body,
        'the page claims to have been checked against a source it never came from',
      ).not.toContain('Last checked against');
    }
  });

  test('the date the licence asks for is on the page, not only in the footer', async ({
    page,
    request,
  }) => {
    const path = await pathWithSource(request, 'datatourisme');
    test.skip(!path, 'no open-data campsite in this build');

    await page.goto(path!);
    await expect(page.getByTestId('updated-datatourisme')).toContainText(
      'Last updated by the source on',
    );
  });
});

test.describe('the description is quoted, never passed off as ours', () => {
  test('it is a blockquote, marked with its own language', async ({
    page,
    request,
  }) => {
    const path = await pathWithSource(request, 'datatourisme');
    test.skip(!path, 'no open-data campsite in this build');

    await page.goto(path!);
    const quote = page.getByTestId('source-description');
    // Not every record has a description; when one does, it must be a
    // quotation with a language and a caption saying whose words they are.
    if ((await quote.count()) === 0) test.skip();

    await expect(quote.locator('blockquote')).toHaveAttribute('lang', /^[a-z]{2}/);
    await expect(quote.locator('figcaption')).toContainText('quoted as published');
  });
});

test.describe('the attribution page lists what the site actually uses', () => {
  test('DATAtourisme and its licence are named', async ({ request }) => {
    const html = await (await request.get('/legal/attribution')).text();
    expect(html).toContain('DATAtourisme');
    expect(html).toContain('Licence Ouverte');
    expect(html).toContain('etalab.gouv.fr');
    // And the reason the per-page date exists, so the rule survives a
    // rewrite of this page by somebody who did not read the licence.
    expect(html).toMatch(/date of last update|date that source last changed/i);
  });

  test('OpenStreetMap and ODbL are still named', async ({ request }) => {
    const html = await (await request.get('/legal/attribution')).text();
    expect(html).toContain('OpenStreetMap');
    expect(html).toContain('Open Database License');
  });
});
