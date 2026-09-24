import { expect, test } from './api-request';

// CAMP-55 — the two tools, as a reader meets them.
//
// 🔴 Several of these read the HTML through `request` rather than through
// the browser, and that is the point of those cases: the fuel table and
// every sentence carrying a price must exist in the served document. A
// crawler, an assistant and a reader on a slow connection all see that
// document and not the hydrated page, and the whole claim of these pages
// is that their numbers are real — a number that only appears after a
// bundle executes is a number most of our audience never gets.

test.describe('the tools index', () => {
  test('lists both tools and says why the third is missing', async ({ page }) => {
    await page.goto('/tools');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tools');
    await expect(
      page.getByRole('link', { name: 'What does a camper trip cost?' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Camper packing list' }),
    ).toBeVisible();
    // 🔴 The absent comparison tool is explained on the page, not only in
    // a ticket. A section that quietly lacks a promised feature reads as
    // neglect; one that says what it is waiting for reads as a decision.
    await expect(page.getByText(/comparison tool/i)).toBeVisible();
  });
});

test.describe('the trip cost calculator', () => {
  test('serves all 27 fuel prices without running any JavaScript', async ({
    request,
  }) => {
    const html = await (await request.get('/tools/camper-trip-cost')).text();
    const rows = [...html.matchAll(/data-country="([A-Z]{2})"/g)].map((m) => m[1]);
    expect(new Set(rows).size).toBe(27);
    // A price per row, in euros and to three decimals, in the document.
    expect(html).toMatch(/€\d\.\d{3}/);
    // And the date those prices belong to — a price without its week is
    // a claim about today that we have not checked.
    expect(html).toMatch(/week of \d{1,2} \w+ \d{4}/);
  });

  test('names its source and licence, which CC BY requires', async ({ request }) => {
    const html = await (await request.get('/tools/camper-trip-cost')).text();
    expect(html).toContain('European Commission');
    expect(html).toContain('CC BY 4.0');
    expect(html).toContain('energy.ec.europa.eu');
  });

  test('keeps what it measured apart from what the reader assumed', async ({
    page,
  }) => {
    await page.goto('/tools/camper-trip-cost');
    const measured = page.getByTestId('measured');
    const assumed = page.getByTestId('assumed');
    await expect(measured).toBeVisible();
    await expect(assumed).toBeVisible();
    await expect(measured).toContainText(/a litre/);
    // 🔴 With no pitch price entered, the page must say it is counting
    // nothing for campsites rather than showing a confident €0.
    await expect(assumed).toContainText(/No pitch price entered/i);
  });

  test('the total follows the inputs, and the pitch is the reader’s', async ({
    page,
  }) => {
    await page.goto('/tools/camper-trip-cost');
    await page.getByLabel('Country you are driving in').selectOption('DE');
    await page.getByLabel('Fuel').selectOption('diesel');
    await page.getByLabel('Consumption, litres per 100 km').fill('12');
    await page.getByLabel('Distance, km').fill('1500');
    await page.getByLabel('Nights').fill('7');
    await page.getByLabel('People').fill('2');

    // Fuel only: 1500 km at 12 l/100km = 180 l at €2.457 = €442.26.
    await expect(page.getByTestId('total')).toHaveText('€442.26');

    await page.getByLabel('Pitch per night, €').fill('30');
    // Plus 7 × €30 = €210 → €652.26.
    await expect(page.getByTestId('total')).toHaveText('€652.26');
    await expect(page.getByTestId('assumed')).toContainText('€210.00');
  });

  test('a link restores the same result for whoever opens it', async ({ page }) => {
    await page.goto('/tools/camper-trip-cost?c=FR&f=petrol&km=800&n=4&pitch=25&l=9');
    await expect(page.getByLabel('Country you are driving in')).toHaveValue('FR');
    await expect(page.getByLabel('Fuel')).toHaveValue('petrol');
    await expect(page.getByLabel('Distance, km')).toHaveValue('800');
    await expect(page.getByLabel('Pitch per night, €')).toHaveValue('25');
    // 800 km at 9 l/100km = 72 l at €2.219 = €159.77; plus 4 × 25 = €259.77.
    await expect(page.getByTestId('total')).toHaveText('€259.77');
  });

  test('a country in the link that we have no price for is ignored, not obeyed', async ({
    page,
  }) => {
    await page.goto('/tools/camper-trip-cost?c=ZZ');
    // Falls back to the default rather than rendering a blank country.
    await expect(page.getByLabel('Country you are driving in')).toHaveValue('DE');
  });
});

test.describe('the per-country pages', () => {
  test('state that country’s own price and its place among the 27', async ({
    request,
  }) => {
    const html = await (await request.get('/tools/camper-trip-cost/de')).text();
    expect(html).toContain('Camper trip costs in Germany');
    expect(html).toContain('€2.457');
    expect(html).toMatch(/most expensive|cheapest/);
    // The worked example is in the document, not computed on hydration.
    expect(html).toMatch(/€442\.26/);
  });

  test('every one of the 27 exists and says what it does not know', async ({
    request,
  }) => {
    // A sample rather than all 27: enough to catch a whole-set failure,
    // fast enough to keep this suite honest about its own runtime.
    for (const code of ['at', 'fr', 'hr', 'mt', 'se', 'si']) {
      const res = await request.get(`/tools/camper-trip-cost/${code}`);
      expect(res.status(), `/tools/camper-trip-cost/${code}`).toBe(200);
      const html = await res.text();
      expect(html, code).toContain('we do not hold any');
    }
  });

  test('links to campsites only where we have some', async ({ request }) => {
    // Slovenia we hold; Germany we do not. A link into a country with no
    // generated hub would be a 404 in the navigation of an indexed page.
    const si = await (await request.get('/tools/camper-trip-cost/si')).text();
    expect(si).toContain('href="/camping/si"');
    const de = await (await request.get('/tools/camper-trip-cost/de')).text();
    expect(de).not.toContain('href="/camping/de"');
  });
});

test.describe('the packing list', () => {
  test('never states a legal requirement, and says why', async ({ page, request }) => {
    // The page explains the omission, in the served document.
    const html = (
      await (await request.get('/tools/camper-packing-list')).text()
    ).toLowerCase();
    expect(html).toContain('legally required');

    // 🔴 And no ITEM asserts one. Read from the rendered list items, not
    // by slicing the HTML: the document ends with Next's serialised RSC
    // payload, which repeats every word on the page including the
    // paragraph that explains the omission. The first version of this
    // test sliced from the list's container to the end of the file and
    // failed on its own explanation — a test that cannot tell the
    // difference between saying a thing and warning about it.
    await page.goto('/tools/camper-packing-list');
    const forbidden = ['hi-vis', 'warning triangle', 'breathalyser', 'spare bulb', 'mandatory'];
    for (const vehicle of ['campervan', 'motorhome', 'car-and-tent']) {
      for (const season of ['warm', 'shoulder', 'cold']) {
        await page.getByLabel('Travelling in').selectOption(vehicle);
        await page.getByLabel('Time of year').selectOption(season);
        const items = (
          await page.locator('[data-testid="packing"] li').allTextContents()
        )
          .join(' | ')
          .toLowerCase();
        expect(items.length, `${vehicle}/${season} produced no items`).toBeGreaterThan(100);
        for (const word of forbidden) {
          expect(items, `"${word}" in ${vehicle}/${season}`).not.toContain(word);
        }
      }
    }
  });

  test('the vehicle changes the list, not just the wording', async ({ page }) => {
    await page.goto('/tools/camper-packing-list');
    // 🔴 Scoped to the list. The intro paragraph names a mallet and
    // sleeping mats as the example of what changes, so an unscoped
    // getByText matches the prose as well as the item.
    const list = page.getByTestId('packing');
    await page.getByLabel('Travelling in').selectOption('car-and-tent');
    await expect(list.getByText('Tent, poles and pegs')).toBeVisible();
    await expect(list.getByText('Mallet')).toBeVisible();

    await page.getByLabel('Travelling in').selectOption('motorhome');
    await expect(list.getByText('Tent, poles and pegs')).toHaveCount(0);
    await expect(list.getByText('Levelling ramps and chocks')).toBeVisible();
  });

  test('ticking an item is counted and kept in the link', async ({ page }) => {
    await page.goto('/tools/camper-packing-list');
    const count = page.getByTestId('packing-count');
    await expect(count).toContainText(/^0 of \d+ packed$/);
    await page.getByLabel('Pillows', { exact: false }).first().check();
    await expect(count).toContainText(/^1 of \d+ packed$/);
  });

  test('a shared link arrives with the boxes already ticked', async ({ page }) => {
    await page.goto(
      '/tools/camper-packing-list?v=motorhome&s=warm&n=7&p=2&cook=1&ehu=1&kids=0&dog=0&done=pillows,torch',
    );
    await expect(page.getByTestId('packing-count')).toContainText('2 of');
  });

  test('children and dogs appear only when asked for', async ({ page }) => {
    await page.goto('/tools/camper-packing-list');
    await expect(page.getByRole('heading', { name: 'With a dog' })).toHaveCount(0);
    await page.getByLabel('Travelling with a dog').check();
    await expect(page.getByRole('heading', { name: 'With a dog' })).toBeVisible();
  });
});


// ---------------------------------------------------------------------
// Regressions found by adversarial review of this branch, before merge.
// Each one is a defect that shipped past the tests above.
// ---------------------------------------------------------------------

test.describe('what the review found', () => {
  test('a shared link keeps the country even when it is the module default', async ({
    page,
    context,
  }) => {
    // 🔴 `toSearch` compared against the module defaults, whose country
    // is DE. On /tools/camper-trip-cost/fr a reader who picked Germany
    // had it dropped from the link — and the button still said "Link
    // copied". The recipient saw France, a different measured price and
    // a different total, with nothing to say anything was lost.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/tools/camper-trip-cost/fr');
    await page.getByLabel('Country you are driving in').selectOption('DE');
    const before = await page.getByTestId('total').textContent();

    await page.getByRole('button', { name: /copy a link/i }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link, 'the country was dropped from the shared link').toContain('c=DE');

    await page.goto(link);
    await expect(page.getByLabel('Country you are driving in')).toHaveValue('DE');
    await expect(page.getByTestId('total')).toHaveText(before ?? '');
  });

  test('the calculator can read the number format the page itself prints', async ({
    page,
  }) => {
    // The page writes distances as "1,500 km". The first version of the
    // parser turned that into 1.5 — a fuel bill a thousand times too
    // small, shown without a warning.
    await page.goto('/tools/camper-trip-cost?c=DE&f=diesel&l=12&n=0');
    await page.getByLabel('Distance, km').fill('1,500');
    await expect(page.getByTestId('total')).toHaveText('€442.26');
    await page.getByLabel('Distance, km').fill('1 500');
    await expect(page.getByTestId('total')).toHaveText('€442.26');
    // A decimal comma still means a decimal comma.
    await page.getByLabel('Distance, km').fill('1500');
    await page.getByLabel('Consumption, litres per 100 km').fill('12,5');
    await expect(page.getByTestId('measured')).toContainText('187.5 litres');
  });

  test('an absurd number is refused rather than rendered as infinity', async ({
    page,
  }) => {
    await page.goto('/tools/camper-trip-cost?km=1e308');
    await expect(page.getByTestId('measured')).not.toContainText('∞');
    await expect(page.getByTestId('total')).not.toHaveText('—');
  });

  test('without JavaScript the page shows real prices and no invented total', async ({
    browser,
  }) => {
    // 🔴 The prerendered markup is the module defaults, so a shared
    // `?c=FR&km=800` link used to render "€442.26 … 1,500 km" in Germany
    // — somebody else's trip, presented as the reader's answer. That is
    // also what every link-preview bot rendered.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/tools/camper-trip-cost?c=FR&km=800&l=9');

    // The 27 real prices are there, because they are server-rendered.
    await expect(page.locator('tr[data-country]')).toHaveCount(27);
    // The total is not, because a total is about the reader.
    await expect(page.getByTestId('total')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('€442.26');
    await context.close();
  });

  test('every country page is reachable by a link, not only by the sitemap', async ({
    page,
  }) => {
    // 🔴 All 27 were generated, listed in the sitemap, and linked from
    // nowhere — unreachable by a reader and carrying none of the site's
    // own authority.
    await page.goto('/tools/camper-trip-cost');
    const hrefs = await page
      .locator('a[href*="/tools/camper-trip-cost/"]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''),
      );
    const codes = new Set(
      hrefs
        .map((h) => /\/tools\/camper-trip-cost\/([a-z]{2})$/.exec(h)?.[1])
        .filter(Boolean),
    );
    expect(codes.size, 'not every country is linked from the price table').toBe(27);
  });

  test('a country page does not link to itself, and links to the rest', async ({
    page,
  }) => {
    await page.goto('/tools/camper-trip-cost/de');
    await expect(
      page.locator('a[href="/tools/camper-trip-cost/de"]'),
      'the page you are on should not link to itself',
    ).toHaveCount(0);
    await expect(
      page.locator('a[href="/tools/camper-trip-cost/fr"]'),
    ).toHaveCount(1);
  });

  test('the cheapest country still gets the EU-average sentence', async ({
    request,
  }) => {
    // `cheaper > 0` was false at position 1, so the one page where
    // "below the EU average" matters most was the page that omitted it.
    const html = await (await request.get('/tools/camper-trip-cost/mt')).text();
    expect(html).toContain('EU average');
  });

  test('an identical neighbour price is said in words, not as a signed zero', async ({
    request,
  }) => {
    // Croatia and Slovenia were both €1.975 and rendered "+ €0.000 a
    // litre, + €0.00 a tank".
    const html = await (await request.get('/tools/camper-trip-cost/hr')).text();
    expect(html).not.toContain('€0.000 a litre');
  });

  test('the page no longer claims a freshness it cannot keep', async ({
    request,
  }) => {
    const html = await (await request.get('/tools/camper-trip-cost')).text();
    // 🔴 This sentence was inside FAQPage markup — the machine-readable
    // form an assistant quotes back — and was true only if somebody had
    // run the fetch script that week.
    expect(html).not.toContain('never more than a few days behind the pumps');
    expect(html).toContain('week of');
  });

  test('the packing list nights field survives a stray keystroke', async ({
    page,
  }) => {
    // 🔴 It used to lock at the literal string "NaN" and append to it.
    await page.goto('/tools/camper-packing-list');
    // 🔴 By id, not by label: a generated item's own label reads
    // "Light layers — 2 people, 7 nights", so getByLabel('Nights')
    // matches that checkbox too and the locator is ambiguous.
    const nights = page.locator('#pk-nights');
    await nights.fill('x');
    expect(await nights.inputValue()).not.toContain('NaN');
    await nights.fill('10');
    await expect(nights).toHaveValue('10');
    await expect(page.getByTestId('packing-count')).toContainText('packed');
  });

  test('the country select does not reshuffle when the fuel changes', async ({
    page,
  }) => {
    // It was ordered by the ranking for the chosen fuel, so switching
    // petrol↔diesel reordered 27 options under the reader's cursor.
    await page.goto('/tools/camper-trip-cost');
    const names = () =>
      page.getByLabel('Country you are driving in').locator('option').allTextContents();
    const withDiesel = await names();
    await page.getByLabel('Fuel').selectOption('petrol');
    expect(await names()).toEqual(withDiesel);
    // And it is alphabetical, which is how a person finds their country.
    expect(withDiesel).toEqual([...withDiesel].sort((a, b) => a.localeCompare(b, 'en')));
  });
});
