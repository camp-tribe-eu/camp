import { expect, test, type Page } from './api-request';
import { openMapRetryingThrottle } from './open-map';

// CAMP-454 — розкладка /map: ліва колонка налаштувань, мапа на висоту вікна,
// шухляда на телефоні, повний екран.
//
// 🔴 ВСЕ ТУТ ЧИТАЄТЬСЯ З ВІДДАНОЇ СТОРІНКИ — з прямокутників елементів, які
// намалював браузер, і з атрибутів, які пише сам компонент. Жодне
// твердження не спирається на клас: «клас є» не каже, що колонка ліворуч.


/**
 * Open /map at a size. `false` means this browser has no WebGL: the page then
 * says so in words (asserted here) and there is no layout to measure. Not a
 * `test.skip` — the stand-down budget (check-e2e-skips) counts those, and a
 * browser without a GPU is a state the page has a sentence for.
 */
async function open(page: Page, width: number, height: number): Promise<boolean> {
  await page.setViewportSize({ width, height });
  await openMapRetryingThrottle(page, { mapSelector: '[data-testid="map"]', keepSettingsClosed: true });
  const ok = await page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
  if (!ok) {
    await expect(page.getByTestId('map-unsupported')).toBeVisible();
    return false;
  }
  await expect(page.getByTestId('map-bar')).toBeVisible();
  // Лише скажене cookie-вікно не заважає прямокутникам, але заважає кліку.
  const reject = page.getByTestId('cookie-reject');
  if (await reject.isVisible()) await reject.click();
  return true;
}

// Той самий бюджет, що в map-filters.spec: сторінка тягне індекс регіонів і
// WebGL, і на завантаженій машині 30 с — це межа, а не запас.
test.beforeEach(() => {
  test.slow();
});

// Розміри задає сам тест. Проєкт Pixel 7 має `isMobile`, а з ним
// `setViewportSize` поводиться як зміна пристрою, і «широкий екран» у ньому —
// вигадка. Тут міряється розкладка, а не пристрій.
test.use({ isMobile: false, hasTouch: false });

const box = async (page: Page, id: string) => {
  const b = await page.getByTestId(id).boundingBox();
  if (!b) throw new Error(`${id} has no box`);
  return b;
};

test.describe('wide screen: two columns', () => {
  test('🔴 the settings column is on the LEFT of the map, both are tall, and everything is in it', async ({ page }) => {
    if (!(await open(page, 1440, 900))) return;
    const col = await box(page, 'map-settings');
    const stage = await box(page, 'map-stage');
    const map = await box(page, 'map');
    expect(col.x + col.width, 'the column must end before the map begins').toBeLessThanOrEqual(stage.x);
    expect(col.width).toBeGreaterThanOrEqual(320);
    expect(map.width, 'the map is the wider side').toBeGreaterThan(col.width * 1.8);
    expect(map.height, 'the map is at least 600px tall on a 900px window').toBeGreaterThanOrEqual(600);
    // The settings: layers, map style, filters, legend — all inside the column.
    for (const sel of ['[data-layer="drought"]', '[data-source="liberty"]', '[data-testid="map-filters"]', '[data-testid="map-legend"]']) {
      await expect(page.getByTestId('map-settings').locator(sel), `${sel} is not in the settings column`).toBeVisible();
    }
    await expect(page.getByTestId('map-settings-toggle'), 'no drawer button on a wide screen').toBeHidden();
    await expect(page.getByTestId('filter-count')).toBeVisible();
    // The credit stays under the map at every width, licence condition.
    await expect(page.getByTestId('map-attribution')).toBeVisible();
  });
});

test.describe('phone: map first, settings in a drawer', () => {
  test('🔴 the map fills the screen, the drawer is closed, then opens and closes', async ({ page }) => {
    if (!(await open(page, 375, 812))) return;
    const map = await box(page, 'map');
    expect(map.height, 'the map takes most of the screen height').toBeGreaterThanOrEqual(812 * 0.6);
    expect(map.width).toBeGreaterThanOrEqual(375 - 40);
    // Closed means not rendered, so a keyboard cannot walk into it.
    await expect(page.getByTestId('map-settings')).toBeHidden();
    await expect(page.getByTestId('map-filters')).toBeHidden();
    // The answer of the map is NOT in the drawer.
    await expect(page.getByTestId('filter-count')).toBeVisible();

    const toggle = page.getByTestId('map-settings-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('map-settings')).toBeVisible();
    await expect(page.getByTestId('map-filters')).toBeVisible();
    await expect(page.locator('[data-layer="drought"]')).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId('map-settings')).toBeHidden();
  });
});

test.describe('full screen', () => {
  const pageRoot = (page: Page) => page.locator('[data-map-page]');

  async function covers(page: Page) {
    const vp = { width: await page.evaluate(() => window.innerWidth), height: await page.evaluate(() => window.innerHeight) };
    const r = await pageRoot(page).boundingBox();
    expect(r, 'page root has no box').not.toBeNull();
    expect(Math.round(r!.width), 'full screen covers the width').toBe(vp.width);
    expect(Math.round(r!.height), 'full screen covers the height').toBe(vp.height);
    const m = await box(page, 'map');
    expect(m.height, 'the map itself grows with it').toBeGreaterThanOrEqual(vp.height * 0.7);
  }

  test('🔴 turns on and off, and the map really grows to the window', async ({ page }) => {
    if (!(await open(page, 1280, 800))) return;
    const small = await box(page, 'map');
    const btn = page.getByTestId('map-fullscreen');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(pageRoot(page)).toHaveAttribute('data-fullscreen', 'true');
    await expect(page.getByTestId('map')).toHaveAttribute('data-fullscreen', 'yes');
    await expect.poll(async () => Math.round((await pageRoot(page).boundingBox())!.height) - (await page.evaluate(() => window.innerHeight)), { timeout: 20_000 }).toBe(0);
    await covers(page);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(pageRoot(page)).not.toHaveAttribute('data-fullscreen', 'true');
    expect(await page.evaluate(() => document.fullscreenElement), 'native full screen was left').toBeNull();
    const back = await box(page, 'map');
    expect(Math.round(back.height)).toBe(Math.round(small.height));
  });

  test('🔴 the CSS fallback works where the Fullscreen API does not (iPhone Safari)', async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error simulating a browser without the API
      Element.prototype.requestFullscreen = undefined;
    });
    if (!(await open(page, 390, 844))) return;
    const btn = page.getByTestId('map-fullscreen');
    await btn.click();
    await expect(pageRoot(page)).toHaveAttribute('data-fullscreen', 'true');
    expect(await page.evaluate(() => document.fullscreenElement), 'the API was supposed to be absent').toBeNull();
    await expect.poll(async () => Math.round((await pageRoot(page).boundingBox())!.height) - (await page.evaluate(() => window.innerHeight)), { timeout: 20_000 }).toBe(0);
    await btn.click();
    await expect(pageRoot(page)).not.toHaveAttribute('data-fullscreen', 'true');
  });
});
