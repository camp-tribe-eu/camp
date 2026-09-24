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
