import { test, expect, type Page } from './api-request';

/**
 * CAMP-453 — сторінка кемпінгу як сторінка товару теми (PDP).
 *
 * 🔴 ЩО САМЕ ДОВОДИТЬСЯ, і чим.
 *
 *   зручності в першому екрані на 1440   → позиції елементів у браузері
 *   таби перемикаються                    → клік і клавіатура, видимість панелей
 *   таб без даних не малюється            → сторінки БЕЗ камер і зон: жодного `tab`
 *   мапа видима при прокрутці             → прокрутка й позиція стікі-картки
 *   жодної порожньої картки               → усі діти колонки мають текст
 *
 * 🔴 КОЖНА ПЕРЕВІРКА ПАРНА. «На сторінці без камер табу немає» нічого не
 * каже, поки не доведено, що на сторінці З камерою він є, — інакше
 * однаково зелено, коли таби зламано взагалі. Обидві гілки беруться з API
 * за даними кемпінгу, а не за іменем: «тест, що називає слаг, — це тест
 * про той слаг».
 *
 * Сторінки не називаються. Кемпінг із свіжою камерою, без камер і з
 * відомими зручностями шукається в API, і число переглянутих — у тексті
 * помилки (знаменник).
 */

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

type Index = { country: string; region: string; slug: string }[];
type Detail = {
  spot: {
    amenities: Record<string, string>;
    webcams?: { lastFrameAt: string | null; metres: number }[] | null;
    warningAreas?: string[] | null;
  };
};

// Свіжість камери — той самий поріг, що в `lib/webcams.ts`, але ЗАПИСАНИЙ
// ТУТ, а не імпортований: очікуване не береться з предмета перевірки.
// Доба; а для вибору «свіжої» беремо запас: не старше шести годин.
const FRESH_MS = 6 * 3_600_000;
const STALE_MS = 26 * 3_600_000;

let cache: Promise<{ path: string; d: Detail['spot'] }[]> | null = null;
function allSpots(request: Page['request']) {
  cache ??= (async () => {
    const res = await request.get(`${API}/spots/index`);
    expect(res.status(), `API відмовив: ${res.status()}`).toBe(200);
    const idx = (await res.json()) as Index;
    expect(Array.isArray(idx) && idx.length > 0, 'індекс порожній').toBe(true);
    const out: { path: string; d: Detail['spot'] }[] = [];
    for (const s of idx) {
      const r = await request.get(`${API}/spots/${s.country}/${s.region}/${s.slug}`);
      if (r.status() !== 200) continue;
      out.push({
        path: `/camping/${s.country}/${s.region}/${s.slug}`,
        d: ((await r.json()) as Detail).spot,
      });
    }
    return out;
  })();
  return cache;
}

const known = (d: Detail['spot']) =>
  Object.values(d.amenities).filter((v) => v !== 'unknown').length;
const age = (iso: string | null) => (iso ? Date.now() - Date.parse(iso) : Infinity);

/** Кемпінг із камерою, свіжою за шість годин, у межах 25 км. Зручності відомі. */
async function withLiveCamera(request: Page['request']) {
  const spots = await allSpots(request);
  const hit = spots.find(
    ({ d }) =>
      known(d) >= 3 &&
      !Array.isArray(d.warningAreas) &&
      (d.webcams ?? []).some((c) => age(c.lastFrameAt) < FRESH_MS && c.metres <= 25_000),
  );
  expect(hit, `з ${spots.length} кемпінгів жодного зі свіжою камерою й ≥3 відомими зручностями`).toBeTruthy();
  return hit!.path;
}

/** Кемпінг без жодної придатної камери і без зон тривог. */
async function withoutAnything(request: Page['request']) {
  const spots = await allSpots(request);
  const hit = spots.find(
    ({ d }) =>
      !Array.isArray(d.warningAreas) &&
      !(d.webcams ?? []).some((c) => age(c.lastFrameAt) < STALE_MS),
  );
  expect(hit, `з ${spots.length} кемпінгів усі мають свіжу камеру або зони тривог`).toBeTruthy();
  return hit!.path;
}

async function hydrated(page: Page) {
  await expect(page.getByTestId('spot-tabs')).toHaveAttribute('data-mode', 'tabs');
}

test.describe('🔴 CAMP-453 — розкладка PDP на 1440 px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('зручності й значок статусу — у першому екрані, без прокрутки', async ({ page, request }) => {
    await page.goto(await withLiveCamera(request));
    const h = await page.getByRole('heading', { name: 'Facilities', exact: true }).boundingBox();
    expect(h, 'заголовка Facilities немає на сторінці').not.toBeNull();
    expect(h!.y + h!.height, `Facilities закінчується на ${Math.round(h!.y + h!.height)} px, екран 900`).toBeLessThan(900);

    // Не лише заголовок: самі значки зручностей. Три перші мусять бути
    // видимими цілком, інакше «у першому екрані» — порожній заголовок.
    const items = page.locator('[data-testid="spot-amenities"] li');
    const total = await items.count();
    expect(total, 'у списку зручностей менше трьох рядків').toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i++) {
      await expect(items.nth(i), `зручність №${i + 1} поза першим екраном`).toBeInViewport({ ratio: 1 });
    }

    // Походження значення (CAMP-521) не загубилось: рядок кажучи словом.
    const row = await items.first().innerText();
    expect(row, 'рядок зручності без статусу походження').toMatch(/Imported|Reported|Not recorded|Owner|Verified|Calculated/i);
  });

  test('дві колонки на кожній сторінці: картки ≈480 px ліворуч, медіа ширше праворуч', async ({ page, request }) => {
    for (const path of [await withLiveCamera(request), await withoutAnything(request)]) {
      await page.goto(path);
      const m = await page.evaluate(() => {
        const grid = document.querySelector('[data-testid="campsite-hero"]') as HTMLElement;
        const title = document.querySelector('[data-testid="campsite-title"]')!.getBoundingClientRect();
        const cards = document.querySelector('[data-testid="campsite-cards"]')!.getBoundingClientRect();
        const media = document.querySelector('[data-testid="campsite-sticky"]')!.getBoundingClientRect();
        return {
          tracks: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          titleW: title.width,
          cardsW: cards.width,
          mediaW: media.width,
          mediaLeft: media.left,
          cardsRight: cards.right,
          cardsTop: cards.top,
          titleBottom: title.bottom,
        };
      });
      expect(m.tracks, `${path}: доріжок ${m.tracks}`).toBe(2);
      // Fuse: 480 px з 1416. Допуск — на смугу прокрутки й поля.
      expect(m.cardsW, `${path}: колонка карток ${Math.round(m.cardsW)} px`).toBeGreaterThan(440);
      expect(m.cardsW).toBeLessThan(500);
      expect(m.titleW).toBeCloseTo(m.cardsW, 0);
      expect(m.mediaW, `${path}: медіа ${Math.round(m.mediaW)} не ширше за картки ${Math.round(m.cardsW)}`).toBeGreaterThan(m.cardsW * 1.5);
      expect(m.mediaLeft).toBeGreaterThan(m.cardsRight);
      // Заголовок і решта карток — одна колонка, одна під одною.
      expect(m.cardsTop).toBeGreaterThanOrEqual(m.titleBottom);
    }
  });

  test('🔴 мапа лишається видимою, коли читач гортає картки', async ({ page, request }) => {
    await page.goto(await withLiveCamera(request));
    const sticky = page.getByTestId('campsite-sticky');
    const before = await sticky.boundingBox();
    expect(before).not.toBeNull();

    const room = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="campsite-hero"]') as HTMLElement;
      return Math.round(grid.getBoundingClientRect().bottom + window.scrollY - window.innerHeight);
    });
    // Знаменник: гортати є куди. Якщо сітка вміщається в екран, стікі
    // нічого не доводить — тож це падіння, а не пропуск.
    expect(room, `сітка вміщається в екран (запас ${room} px): стікі не перевірити`).toBeGreaterThan(300);

    const by = 300;
    await page.mouse.wheel(0, by);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(by - 5);

    const after = await sticky.boundingBox();
    expect(after).not.toBeNull();
    // Без стікі верх картки поїхав би на `before.y - by` (< 0). Зі стікі
    // він стоїть під шапкою.
    expect(after!.y, `верх медіа на ${Math.round(after!.y)} px після прокрутки на ${by}`).toBeGreaterThanOrEqual(0);
    expect(after!.y).toBeLessThan(120);
    // І мапа справді в екрані, а не лише її рамка.
    await expect(page.locator('[data-panel="map"]')).toBeInViewport();
    await expect(page.getByTestId('campsite-media')).toBeInViewport();
  });

  test('жодної порожньої білої картки в колонці', async ({ page, request }) => {
    for (const path of [await withLiveCamera(request), await withoutAnything(request)]) {
      await page.goto(path);
      const empties = await page.evaluate(() => {
        const col = document.querySelector('[data-testid="campsite-cards"]')!;
        return [...col.children]
          .filter((el) => getComputedStyle(el).display !== 'none')
          .filter((el) => ((el as HTMLElement).innerText ?? '').trim() === '')
          .map((el) => el.getAttribute('data-testid') ?? el.tagName);
      });
      expect(empties, `${path}: порожні картки видно читачеві`).toEqual([]);
      // Знаменник: колонка не порожня сама.
      const kids = await page.locator('[data-testid="campsite-cards"] > *').count();
      expect(kids).toBeGreaterThan(4);
    }
  });
});

test.describe('🔴 CAMP-453 — таби', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('де є свіжа камера: Map і Webcams, перемикання кліком і стрілками', async ({ page, request }) => {
    await page.goto(await withLiveCamera(request));
    await hydrated(page);

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText(['Map', 'Webcams']);
    await expect(page.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-panel="map"]')).toBeVisible();
    await expect(page.locator('[data-panel="webcams"]')).toBeHidden();

    await page.getByRole('tab', { name: 'Webcams' }).click();
    await expect(page.getByRole('tab', { name: 'Webcams' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-panel="webcams"]')).toBeVisible();
    await expect(page.getByTestId('webcam-note')).toBeVisible();
    await expect(page.locator('[data-panel="map"]')).toBeHidden();

    // Назад: панель мапи знову має розмір (а не нуль після display:none).
    await page.getByRole('tab', { name: 'Map' }).click();
    await expect(page.locator('[data-panel="map"]')).toBeVisible();
    const box = await page.getByTestId('campsite-media').boundingBox();
    expect(box!.width, 'мапа після повернення без ширини').toBeGreaterThan(300);
    expect(box!.height, 'мапа після повернення без висоти').toBeGreaterThan(300);

    // Клавіатура: стрілка вправо переходить і переносить фокус.
    await page.getByRole('tab', { name: 'Map' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Webcams' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Webcams' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Map' })).toBeFocused();
  });

  test('🔴 де камер немає: ні табів, ні панелі камер; відповідь про покриття стоїть відкрито', async ({ page, request }) => {
    await page.goto(await withoutAnything(request));
    await hydrated(page).catch(() => undefined);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByTestId('spot-tablist')).toHaveCount(0);
    await expect(page.locator('[data-panel="webcams"]')).toHaveCount(0);
    await expect(page.locator('[data-panel="alerts"]')).toHaveCount(0);
    // Мапа — єдине медіа, і вона видима, а не сховане за відсутнім табом.
    await expect(page.getByTestId('campsite-media')).toBeVisible();
    // Погоди нема ніде: ні табу, ні рядка-заглушки.
    await expect(page.getByText(/forecast is not connected|weather on site/i)).toHaveCount(0);
  });

  test('без JavaScript: усі панелі в розмітці, таби — посилання на них', async ({ browser, request }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(await withLiveCamera(request));
      await expect(page.getByTestId('spot-tabs')).toHaveAttribute('data-mode', 'static');
      for (const id of ['map', 'webcams']) {
        await expect(page.locator(`a[href="#spot-panel-${id}"]`)).toHaveCount(1);
        await expect(page.locator(`#spot-panel-${id}`)).toBeVisible();
      }
      await expect(page.getByTestId('webcam-note')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

test.describe('🔴 CAMP-453 — телефон', () => {
  test('на 375 px одна колонка: назва → мапа → картки, без горизонтальної прокрутки', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(await withLiveCamera(request));
    const m = await page.evaluate(() => {
      const y = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top + window.scrollY;
      const grid = document.querySelector('[data-testid="campsite-hero"]') as HTMLElement;
      return {
        tracks: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        title: y('campsite-title'),
        sticky: y('campsite-sticky'),
        cards: y('campsite-cards'),
        position: getComputedStyle(document.querySelector('[data-testid="campsite-sticky"]')!).position,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      };
    });
    expect(m.tracks).toBe(1);
    expect(m.title).toBeLessThan(m.sticky);
    expect(m.sticky).toBeLessThan(m.cards);
    // На телефоні нічого не липне: стікі-картка на екрані 812 px з'їла б його.
    expect(m.position).not.toBe('sticky');
    expect(m.scrollW, 'горизонтальна прокрутка на 375 px').toBeLessThanOrEqual(m.clientW);
  });
});
