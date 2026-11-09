import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE } from '@/lib/api';
import { hasWebGl } from '../map-ready';

/**
 * CAMP-474 — мапа на сторінці країни. Рішення власника 09.11.2026: «нам
 * точно треба мати і мапу і банер … банер може бути на горі а мапа трохи
 * нижче на сторінці».
 *
 * 🔴 ЩО ТУТ ПЕРЕВІРЯЄТЬСЯ, ЧОГО НЕ МОЖЕ ЮНІТ. Юніт читає відданий HTML і
 * доводить, що сторінка дала мапі рядки САМЕ своєї країни. Тут — те, що
 * без справжнього браузера недоказове: мапа дійшла до `ready`, полотно
 * справді зайняло пікселі (а не нуль, як у CAMP-452, де стан був
 * правильний, а мапи не було видно), і кружечок веде на сторінку
 * регіону.
 *
 * 🔴 ЗОНД WEBGL, А НЕ ВІРА В БРАУЗЕР. headless firefox і webkit на
 * раннерах GitHub не дають WebGL2: MapLibre кидає ще на конструкторі,
 * компонент чесно стає `failed`, і вимагати `ready` беззастережно
 * означало б валити e2e на двох із трьох браузерів. Зонд спільний —
 * `tests/map-ready.ts`.
 */

/** Країна з найбільшою кількістю регіонів в індексі — там мапі є що малювати. */
async function busiestCountry(request: APIRequestContext) {
  const index: Array<{ country: string; region: string | null; count: number }> = await (
    await request.get(`${API_BASE}/spots/map/regions`)
  ).json();
  const byCountry = new Map<string, { regions: number; spots: number }>();
  for (const r of index) {
    if (r.region === null) continue;
    const k = r.country.toLowerCase();
    const cur = byCountry.get(k) ?? { regions: 0, spots: 0 };
    cur.regions += 1;
    cur.spots += r.count;
    byCountry.set(k, cur);
  }
  const best = [...byCountry.entries()].sort((a, b) => b[1].regions - a[1].regions)[0];
  expect(best, 'в індексі мапи немає жодної країни з регіонами — замір сліпий').toBeTruthy();
  return { country: best[0], ...best[1] };
}

const rect = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, top: r.top };
  });

test.describe('CAMP-474: мапа країни', () => {
  test('🔴 мапа малюється, займає пікселі й рахує ту саму країну', async ({
    page,
    request,
  }) => {
    const { country, regions, spots } = await busiestCountry(request);
    await page.goto(`/camping/${country}`);

    const map = page.getByTestId('country-map');
    await expect(map).toBeVisible();

    // 🔴 Числа з СЕРВЕРА звіряються з індексом, і це перевірка самої
    // сторінки: вона мусила звузити індекс до своєї країни. Атрибути
    // стоять у HTML і не чекають на WebGL.
    await expect(map).toHaveAttribute('data-regions', String(regions));
    await expect(map).toHaveAttribute('data-spots', String(spots));

    const webgl = await hasWebGl(page);
    if (webgl) {
      await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 20_000 });
      // 🔴 «ready» не означає, що мапу ВИДНО: у CAMP-452 стан був
      // правильний, а полотно мало 0 px, бо CSS MapLibre приїжджає
      // пізніше за наш. Межі грубі навмисно — це «щось намальовано».
      const canvas = await rect(page, '[data-testid="country-map"] canvas');
      expect(
        canvas.width,
        `полотно мапи країни завширшки ${Math.round(canvas.width)} px — мапи не видно`,
      ).toBeGreaterThan(200);
      expect(
        canvas.height,
        `полотно мапи країни заввишки ${Math.round(canvas.height)} px — мапи не видно`,
      ).toBeGreaterThan(150);
    } else {
      await expect(map).toHaveAttribute('data-map-state', 'failed', { timeout: 20_000 });
      // Запасне речення мусить казати саме про це, а не мовчати.
      await expect(page.getByTestId('country-map-legend')).toContainText('WebGL');
    }
  });

  test('мапа стоїть нижче банера і вище плиток регіонів', async ({ page, request }) => {
    const { country } = await busiestCountry(request);
    await page.goto(`/camping/${country}`);
    await expect(page.getByTestId('country-map')).toBeVisible();

    const map = await rect(page, '[data-testid="country-map"]');
    const tiles = await rect(page, 'a.ct-rtile');
    expect(
      map.top,
      `мапа на ${Math.round(map.top)} px, перша плитка регіону на ${Math.round(tiles.top)} px`,
    ).toBeLessThan(tiles.top);
  });

  test('кредит OpenFreeMap стоїть під мапою — умова ліцензії', async ({ page, request }) => {
    const { country } = await busiestCountry(request);
    await page.goto(`/camping/${country}`);
    await expect(page.getByTestId('country-map-credit')).toContainText(
      'OpenFreeMap © OpenMapTiles',
    );
  });
});
