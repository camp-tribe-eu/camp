import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_BASE } from '@/lib/api';
import { axeViolations } from './axe';

/**
 * CAMP-471 — axe на hub-сторінках.
 *
 * 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. `axeViolations()` викликався у пʼяти наборах
 * (`account`, `campsite`, `drought-layer`, `legal`, `plan`) і ЖОДНОГО
 * разу на `/camping`, `/camping/{country}`, `/camping/{country}/{region}`
 * — тобто рівно на тих сторінках, про які все ревю власника
 * CAMP-441…445. Дефект `color-contrast` жив там із самого початку й
 * показався лише тоді, коли Lighthouse випадково глянув на регіон.
 *
 * 🔴 І ЦЕЙ НАБІР ДОДАНО ПІСЛЯ ПРАВКИ КОЛЬОРУ, А НЕ ДО НЕЇ. Доданий
 * раніше, він почервонів би на вже відомому дефекті й не сказав би
 * нічого нового — сторож, який із дня народження червоний, перестає
 * бути сигналом за тиждень.
 *
 * 🔴 АДРЕСИ БЕРУТЬСЯ З API, А НЕ ВПИСАНІ СЮДИ. Вписаний `/camping/si/bled`
 * одного дня перестане існувати, тест почервоніє на 404 і скаже
 * «доступність зламана» про сторінку, якої немає.
 */

async function hubPaths(request: APIRequestContext): Promise<string[]> {
  const countries: Array<{ country: string }> = await (
    await request.get(`${API_BASE}/spots/countries`)
  ).json();
  expect(countries.length, 'API не віддав жодної країни — замір сліпий').toBeGreaterThan(0);

  const country = countries[0].country;
  const regions: Array<{ slug: string; indexable: boolean }> = await (
    await request.get(`${API_BASE}/spots/${country}/regions`)
  ).json();
  expect(regions.length, `у ${country} жодного регіону — замір сліпий`).toBeGreaterThan(0);

  // 🔴 Товстий регіон, а не перший-ліпший: на тонкому немає ні плиток,
  // ні пагінації, тож половина розмітки hub-сторінки лишилась би
  // непереглянутою, а набір виглядав би зеленим.
  const fat = regions.find((r) => r.indexable) ?? regions[0];
  return [`/camping`, `/camping/${country}`, `/camping/${country}/${fat.slug}`];
}

test.describe('CAMP-471: hub-сторінки проходять axe', () => {
  test('🔴 /camping, країна і регіон — жодного порушення WCAG', async ({
    page,
    request,
  }) => {
    const paths = await hubPaths(request);
    // Якір: три адреси, а не нуль. Порожній перелік задовольнив би цикл
    // мовчки — і це рівно та форма сліпоти, через яку картку й заведено.
    expect(paths, `перевіряємо: ${paths.join(' ')}`).toHaveLength(3);

    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} віддала ${res?.status()}`).toBeLessThan(400);
      expect(await axeViolations(page), `порушення на ${path}`).toEqual([]);
    }
  });
});
