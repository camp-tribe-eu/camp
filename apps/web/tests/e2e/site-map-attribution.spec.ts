import { CURATED_ROUTES } from '../../src/data/routes';
import { LEGAL_PAGES } from '../../src/lib/legal';
import { MAP_SOURCES } from '../../src/lib/map-sources';
import { expect, test, type Page } from './api-request';
import { openMapRetryingThrottle } from './open-map';

/**
 * Кредит провайдера плиток і кнопки стилів — на ЖИВИХ сторінках, не в
 * вихідному коді.
 *
 * 🔴 ЧОМУ ЦЕ E2E. Сторінка «Cookies» 1.1 стверджує дві речі про мапи:
 * кожна мапа називає провайдера (на самій мапі й рядком під нею), а кнопки
 * зміни стилю є лише на `/map`. Перша половина була неправдою для мапи
 * кемпінгу: `site-map.tsx` мав `attributionControl: false` і не додавав
 * власного контролу, тож кредит стояв лише в підписі, який малює ІНШИЙ
 * компонент (`campsite-media.tsx`). Вказання джерела плиток — умова ліцензії,
 * за якою ми їх показуємо; воно не повинно залежати від того, чи
 * батьківський компонент пам'ятає дописати підпис.
 *
 * Тут читається DOM, який віддав браузер: контрол `.maplibregl-ctrl-attrib`
 * усередині мапи, його текст і підпис під нею. Не константа й не клас.
 */

/**
 * 🔴 Чи вміє цей браузер малювати мапу взагалі (headless Firefox на раннері
 * без GPU — ні, і сторінка чесно показує запасний текст). Питання
 * ставиться ДИФЕРЕНЦІЙНО, а не `test.skip`: там, де мапи бути не може,
 * перевіряється запасний стан, і тест не стає пропуском (`check-skips`).
 */
async function hasWebGl(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
}

async function anySpotPath(request: Page['request']): Promise<string> {
  const res = await request.get(
    `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/spots/index`,
  );
  expect(res.status(), `API відмовив: ${res.status()} ${res.statusText()}`).toBe(200);
  const body = (await res.json()) as { country: string; region: string; slug: string }[];
  expect(Array.isArray(body) && body.length > 0, 'індекс кемпінгів порожній').toBe(true);
  const s = body[0];
  return `/camping/${s.country}/${s.region}/${s.slug}`;
}

/** Текст кредиту, який MapLibre зібрав зі стилю, — чекаємо, поки стиль доїде. */
async function creditOn(page: Page, scope: string): Promise<string> {
  const control = page.locator(`${scope} .maplibregl-ctrl-attrib`);
  await expect(control, `на мапі «${scope}» немає контролу кредиту`).toHaveCount(1);
  await expect(control).toBeVisible();
  await expect
    .poll(async () => (await control.textContent()) ?? '', { message: 'кредит на мапі порожній' })
    .toContain('OpenStreetMap');
  return (await control.textContent()) ?? '';
}

const styleButtons = (page: Page) => page.getByRole('group', { name: 'Map style' });

test.describe('🔴 кожна мапа називає провайдера, а кнопки стилів — лише на /map', () => {
  test('мапа кемпінгу: кредит на самій мапі (контрол) і рядком під нею, кнопок стилів немає', async ({
    page,
    request,
  }) => {
    await page.goto(await anySpotPath(request));
    await expect(page.getByTestId('campsite-media')).toBeVisible();

    // Підпис під мапою — друга, незгортна половина гарантії.
    await expect(page.getByTestId('campsite-media').locator('figcaption')).toContainText('OpenFreeMap');

    if (await hasWebGl(page)) {
      const credit = await creditOn(page, '[data-testid="site-map"]');
      expect(credit).toContain('OpenFreeMap');
    } else {
      await expect(page.getByTestId('site-map-fallback')).toBeVisible();
    }
    await expect(styleButtons(page)).toHaveCount(0);
  });

  test('мапа маршруту: кредит на мапі й рядком під нею, кнопок стилів немає', async ({ page }) => {
    expect(CURATED_ROUTES.length, 'немає жодного маршруту').toBeGreaterThan(0);
    await page.goto(`/routes/${CURATED_ROUTES[0].slug}`);
    await expect(page.locator('[data-boilerplate="map-attribution"]')).toContainText('OpenFreeMap');

    if (await hasWebGl(page)) {
      const credit = await creditOn(page, '[data-testid="route-map"]');
      expect(credit).toContain('OpenFreeMap');
    } else {
      await expect(page.getByTestId('route-map-unsupported')).toBeVisible();
    }
    await expect(styleButtons(page)).toHaveCount(0);
  });

  test('/map: кредит під мапою називає провайдера, і кнопки стилів тут ЄДИНІ', async ({ page }) => {
    await openMapRetryingThrottle(page, { mapSelector: '[data-testid="map"]' });
    await expect(page.getByTestId('map-attribution')).toContainText('OpenFreeMap');
    if (await hasWebGl(page)) {
      await expect(styleButtons(page)).toBeVisible();
      // Стилів стільки, скільки в MAP_SOURCES (сторінка кукі називає це число
      // словом, і `legal-cookies-claims.spec.ts` звіряє його з тим самим масивом).
      // (Кнопка супутника стоїть у тій самій групі й теж має `data-source`, тож
      // рахуються кнопки з id зі списку, а не всі.)
      await expect(
        styleButtons(page).locator(MAP_SOURCES.map((m) => `button[data-source="${m.id}"]`).join(', ')),
      ).toHaveCount(MAP_SOURCES.length);
    }
  });
});

test.describe('🔴 сторінки, змінені правками 02.11.2026, віддають нову версію вгорі', () => {
  // «The version and the date it took effect are printed at the top of this
  // page» (терміни §6) — тут читається віддана сторінка: версія з реєстру
  // стоїть у DOM ПЕРЕД текстом документа.
  for (const slug of ['terms', 'cookies', 'database', 'notice']) {
    test(`${slug}: версія з реєстру надрукована над текстом`, async ({ page }) => {
      const reg = LEGAL_PAGES.find((p) => p.slug === slug)!;
      await page.goto(`/legal/${slug}`);
      const version = page.getByTestId('legal-version');
      await expect(version).toContainText(`Version ${reg.version}`);
      const above = await page.evaluate(() => {
        const v = document.querySelector('[data-testid="legal-version"]');
        const a = document.querySelector('article');
        return !!v && !!a && !!(v.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(above, 'версія надрукована НЕ над текстом документа').toBe(true);
    });
  }
});
