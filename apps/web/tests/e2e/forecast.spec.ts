import type { Page, Route } from '@playwright/test';
import { expect, test } from './api-request';
import { API_BASE } from '@/lib/api';

// CAMP-477 — the forecast section on a real campsite page, in a real browser.
//
// 🔴 THE ENDPOINT IS A STUB, THE PAGE IS NOT. The forecast is fetched by
// the browser from our API, so a test that must not depend on the weather
// (or on the bucket being up) answers that one request itself. Everything
// else — the built page, hydration, the observer that waits until the
// reader is near, the rendering — is the real thing.
//
// 🔴 EVERY "NOT THERE" ASSERTION WAITS FOR THE REQUEST FIRST. "No section"
// proved before the page has asked is proof of nothing: the section is
// absent for the first hundred milliseconds of every page that will show
// it. Each such test therefore waits for the forecast response to arrive
// and only then looks.

const FORECAST = '**/forecast?*';

const day = (n: number, over: Record<string, unknown> = {}) => ({
  date: `2026-11-${String(16 + n).padStart(2, '0')}`,
  tMax: 14 + n,
  tMin: 8 + n,
  precipMm: n === 2 ? 0 : n * 1.5,
  condition: n === 2 ? 'clear' : 'rain',
  ...over,
});
const SEVEN = Array.from({ length: 7 }, (_, n) => day(n));

const answer = (days: unknown[]) => ({ model: 'ecmwf_ifs025', runAt: '2026-11-16T00:00:00.000Z', days });

let path = '';
test.beforeAll(async ({ request }) => {
  const res = await request.get(`${API_BASE}/spots/map/points?bbox=-180,-85,180,85&limit=50`);
  expect(res.ok(), `the fixture list: ${res.status()}`).toBe(true);
  const markers = (await res.json()).markers as Array<{ path: string }>;
  expect(markers.length, 'the fixture holds no campsites').toBeGreaterThan(5);
  path = markers[0].path;
});

/** Open the campsite page with the forecast request answered by `reply`. */
async function open(page: Page, reply: (route: Route) => Promise<void>) {
  const asked: string[] = [];
  await page.route(FORECAST, async (route) => {
    asked.push(route.request().url());
    await reply(route);
  });
  const done = page.waitForResponse((r) => /\/forecast\?/.test(r.url()));
  await page.goto(path);
  // The request goes out when the reader is near the place; scroll there.
  await page.getByTestId('forecast-sentinel').scrollIntoViewIfNeeded();
  await done;
  return asked;
}

const json = (body: unknown, status = 200) => async (route: Route) => {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
};

test.describe('with a forecast', () => {
  test('seven rows, the sky in words, and the credit', async ({ page }) => {
    const asked = await open(page, json(answer(SEVEN)));
    const section = page.getByTestId('forecast');
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading', { level: 2, name: '7-day forecast' })).toBeVisible();
    await expect(section.getByTestId('forecast-day')).toHaveCount(7);
    // The first row, as a reader reads it: weekday and date, the word, high / low, rain.
    const first = section.getByTestId('forecast-day').first();
    await expect(first).toContainText('Mon 16 Nov');
    await expect(first).toContainText('Rain');
    await expect(first).toContainText('14° / 8°');
    await expect(first).toContainText('0 mm');
    await expect(section.getByTestId('forecast-day').nth(2)).toContainText('Clear');
    await expect(section.getByTestId('forecast-day').nth(2)).toContainText('0 mm');
    await expect(section).toContainText('Weather data by Open-Meteo.com (CC BY 4.0)');
    await expect(section.getByRole('link', { name: 'Weather data by Open-Meteo.com' })).toHaveAttribute(
      'href',
      'https://open-meteo.com/',
    );
    await expect(section).toContainText(
      'Based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF)',
    );
    // The page asked OUR API for this campsite by slug, once: no coordinate.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/\/forecast\?slug=[a-z0-9-]+$/);
  });

  test('one broken day costs one day: six rows, not none', async ({ page }) => {
    await open(page, json(answer(SEVEN.map((d, i) => (i === 3 ? { ...d, condition: 'tornado' } : d)))));
    await expect(page.getByTestId('forecast-day')).toHaveCount(6);
  });

  test('the table does not overflow the card at this width', async ({ page }) => {
    await open(page, json(answer(SEVEN)));
    const card = page.getByTestId('forecast').locator('table');
    await expect(card).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  });
});

// 🔴 THE MUTATION THE CARD ASKED FOR: the endpoint fails or says nothing,
// and the section is not there AT ALL — not a heading, not a card, not a
// sentence about a forecast being unavailable.
test.describe('without a forecast, there is no section', () => {
  const cases: Array<[string, (route: Route) => Promise<void>]> = [
    ['a 503', json({ message: 'forecast is not available' }, 503)],
    ['a 400', json({ message: 'no' }, 400)],
    ['a connection that fails', (route) => route.abort('failed')],
    ['an empty list of days', json(answer([]))],
    ['two days, which is too few', json(answer(SEVEN.slice(0, 2)))],
    ['a body that is not JSON', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>oops</html>' })],
    ['JSON of the wrong shape', json({ days: 'soon' })],
  ];
  for (const [name, reply] of cases) {
    test(name, async ({ page }) => {
      // Either the answer arrives or the request itself fails: both end the wait.
      const failed = Promise.race([
        page.waitForResponse((r) => /\/forecast\?/.test(r.url())),
        page.waitForEvent('requestfailed', (r) => /\/forecast\?/.test(r.url())),
      ]);
      await page.route(FORECAST, reply);
      await page.goto(path);
      await page.getByTestId('forecast-sentinel').scrollIntoViewIfNeeded();
      await failed;
      // Give the page the moment it would need to draw something, then look.
      await page.waitForTimeout(400);
      await expect(page.getByRole('heading', { name: /forecast/i })).toHaveCount(0);
      await expect(page.getByTestId('forecast')).toHaveCount(0);
      await expect(page.getByText(/forecast is not|not connected|unavailable/i)).toHaveCount(0);
      // What is left is one inert, wordless block.
      await expect(page.getByTestId('forecast-sentinel')).toHaveText('');
    });
  }
});

test('the browser talks to our API and to nobody else about the weather', async ({ page }) => {
  const hosts = new Set<string>();
  let forecastCalls = 0;
  page.on('request', (r) => {
    hosts.add(new URL(r.url()).host);
    if (/\/forecast\?/.test(r.url())) forecastCalls++;
  });
  await open(page, json(answer(SEVEN)));
  await expect(page.getByTestId('forecast')).toBeVisible();
  // Let the map and everything else settle so a late request is seen too.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  expect(forecastCalls, 'the page never asked for a forecast, so this proves nothing').toBe(1);
  const weatherHosts = [...hosts].filter((h) => /open-meteo\.com$|amazonaws\.com$/.test(h));
  expect(weatherHosts, `the browser reached ${weatherHosts.join(', ')}`).toEqual([]);
});
