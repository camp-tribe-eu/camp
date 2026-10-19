import { test, expect, type Page } from '@playwright/test';

/**
 * CAMP-344 — медіаслот сторінки кемпінгу.
 *
 * 🔴 ГОЛОВНЕ ТУТ — ПУНКТ 4 КАРТКИ: «жодного стокового чи згенерованого
 * зображення: мутація „підставити ілюстрацію замість мапи“ мусить
 * червонити перевірку». Макет (`Design/01-campsite.html`) формулює це
 * як обіцянку читачеві: «We don't publish pictures we haven't verified.
 * No stock shots, no AI-generated scenery».
 *
 * Обіцянка, яку ніщо не стереже, тримається рівно до першого, хто
 * захоче «щоб не було порожньо».
 */

async function anySpot(page: Page, request: Page['request']) {
  const spots: { country: string; region: string; slug: string }[] = await (
    await request.get(
      `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/spots/index`,
    )
  ).json();
  expect(spots.length, 'API не віддав жодного кемпінгу').toBeGreaterThan(0);
  const s = spots[0];
  await page.goto(`/camping/${s.country}/${s.region}/${s.slug}`);
  return s;
}

test.describe('🔴 CAMP-344 — що стоїть у медіаслоті', () => {
  test('без фото показано мапу, і в слоті НЕМАЄ жодного зображення', async ({
    page,
    request,
  }) => {
    await anySpot(page, request);

    const media = page.getByTestId('campsite-media');
    await expect(media).toBeVisible();

    // Сьогодні фото немає в жодного кемпінгу (канал власника CAMP-233/232
    // і реєстр прав CAMP-342 ще не зроблені), тож очікуваний стан — мапа.
    await expect(media).toHaveAttribute('data-kind', 'map');

    // 🔴 ОСЬ ЦЕ І Є СТОРОЖ ОБІЦЯНКИ. Будь-яка ілюстрація, стокове фото
    // чи згенерована «природа», підставлені замість мапи, зʼявляться тут
    // як <img> — і цей рядок почервоніє.
    expect(
      await media.locator('img').count(),
      'у слоті зʼявилось зображення там, де має бути мапа',
    ).toBe(0);

    // І пара до нього: мапа справді є, а не слот порожній. Без цього
    // «нуль зображень» справдилось би й над дірою.
    const map = media.getByTestId('site-map');
    const fallback = media.getByTestId('site-map-fallback');
    expect(
      (await map.count()) + (await fallback.count()),
      'ні мапи, ні її запасного тексту',
    ).toBe(1);
  });

  test('підпис називає походження і не обіцяє контуру', async ({ page, request }) => {
    await anySpot(page, request);
    const caption = page.getByTestId('campsite-media').locator('figcaption');

    // Умова ліцензії: атрибуція мусить бути видимою на самій сторінці.
    await expect(caption).toContainText('OpenStreetMap');

    // 🔴 І ЧОГО ПІДПИС КАЗАТИ НЕ МУСИТЬ. Макет писав «the real site
    // outline from OpenStreetMap», але заміряно 19.10.2026 по всіх
    // 63 159 кемпінгах: контур існує лише для 55,1% (area/way), а для
    // 31,1% це вузол, у якого обрису немає в першоджерелі. Обіцяти
    // «outline» на кожній сторінці означало б збрехати майже половині —
    // саме на тій сторінці, яка пояснює, чому ми не показуємо чужих фото.
    await expect(caption).not.toContainText(/outline/i);
  });
});

test.describe('🔴 CAMP-344 — розкладка', () => {
  test('на десктопі дві колонки і медіа ШИРШЕ за опис', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await anySpot(page, request);

    const sizes = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="campsite-media"]');
      const grid = m?.closest('div.grid') as HTMLElement | null;
      if (!grid) return null;
      const [left, right] = [...grid.children] as HTMLElement[];
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        left: left.getBoundingClientRect().width,
        right: right.getBoundingClientRect().width,
        mediaInRight: right.contains(m),
      };
    });

    expect(sizes, 'сітки навколо медіаслота немає').not.toBeNull();
    expect(sizes!.columns, 'на десктопі не дві колонки').toBe(2);
    expect(sizes!.mediaInRight, 'медіа не в правій колонці').toBe(true);
    expect(
      sizes!.right,
      `медіа (${Math.round(sizes!.right)}) не ширше за опис (${Math.round(sizes!.left)})`,
    ).toBeGreaterThan(sizes!.left);
  });

  test('на телефоні одна колонка, і медіа не займає перший екран', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await anySpot(page, request);

    const m = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="campsite-media"]')!;
      const grid = el.closest('div.grid') as HTMLElement;
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        height: el.getBoundingClientRect().height,
        viewport: window.innerHeight,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      };
    });

    expect(m.columns, 'на телефоні більше ніж одна колонка').toBe(1);
    // 🔴 Картка: «медіа НЕ займає перший екран цілком». Половина — межа,
    // за якою під ним уже не лишається тексту.
    expect(
      m.height / m.viewport,
      `медіа займає ${Math.round((100 * m.height) / m.viewport)}% екрана`,
    ).toBeLessThan(0.5);
    expect(m.scrollW, 'горизонтальна прокрутка на 375 px').toBeLessThanOrEqual(m.clientW);
  });
});
