import { test, expect, type Page } from '@playwright/test';

/**
 * CAMP-350 — навігація нижче 1200 px.
 *
 * 🔴 МЕЖА 1200 px НЕ ВИГАДАНА. В архіві теми Fuse
 * (`assets/main.build.css`) перемикач стоїть рівно там: вісім правил
 * меню під `(min-width: 1200px)`, чотири під `(max-width: 1199.98px)`,
 * і кнопка бургера має два окремі втілення — `--desktop` під максимумом,
 * `--mobile` під мінімумом.
 *
 * 🔴 ЦЕЙ ФАЙЛ ІСНУЄ ТОМУ, ЩО БЕЗ НЬОГО МЕЖА — ЦЕ ОДИН КЛАС `xl:hidden`,
 * який ніхто не перевіряє. `hidden xl:block` і `xl:hidden` легко
 * переплутати місцями: обидва компілюються, обидва виглядають
 * правдоподібно, і результат — сторінка без жодного меню або з двома.
 */

const WIDE = 1200;
const NARROW = 1199;

async function widthOf(page: Page, w: number) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.goto('/');
  return page.evaluate(() => {
    const burger = document.querySelector('[data-testid="burger-open"]') as HTMLElement | null;
    const menu = document.querySelector('header nav[aria-label="Main"]') as HTMLElement | null;
    return {
      burger: burger ? burger.offsetParent !== null : false,
      menu: menu ? menu.offsetParent !== null : false,
    };
  });
}

test.describe('🔴 CAMP-350 — межа 1200 px', () => {
  test('1199 — бургер і жодного горизонтального меню; 1200 — навпаки', async ({ page }) => {
    // 🔴 ДВА ЗАМІРИ ПО РІЗНІ БОКИ, А НЕ ОДИН. Перевірка лише на 375
    // справдилась би й тоді, коли меню зникло на ВСІХ ширинах — тобто
    // коли `xl:` переплутано з чимось іншим. Межу доводить різниця.
    const narrow = await widthOf(page, NARROW);
    expect(narrow, `на ${NARROW} px має бути бургер і не має бути меню`).toEqual({
      burger: true,
      menu: false,
    });

    const wide = await widthOf(page, WIDE);
    expect(wide, `на ${WIDE} px має бути меню і не має бути бургера`).toEqual({
      burger: false,
      menu: true,
    });
  });
});

test.describe('🔴 CAMP-350 — шухляда', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('пункти не менші за 48 px і не перекриваються', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('burger-open').click();
    await page.getByTestId('burger-panel').waitFor();

    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="burger-panel"] a')].map((a) => {
        const r = a.getBoundingClientRect();
        return { t: (a.textContent || '').trim(), top: r.top, bottom: r.bottom, h: r.height };
      }),
    );

    // 🔴 Пара до тверджень нижче: шість — це всі пункти `NAV`. Порожня
    // панель задовольнила б і «жоден не менший за 48», і «ніщо не
    // перекривається».
    expect(boxes.length, 'у шухляді немає пунктів').toBe(6);

    expect(
      boxes.filter((b) => b.h < 48).map((b) => `${b.t}: ${Math.round(b.h)}px`),
      'пункт нижчий за 48 px',
    ).toEqual([]);

    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length - 1; i++) {
      if (boxes[i].bottom > boxes[i + 1].top + 0.5) {
        overlaps.push(`${boxes[i].t} ↔ ${boxes[i + 1].t}`);
      }
    }
    expect(overlaps, 'сусідні пункти накладаються').toEqual([]);
  });

  test('Escape закриває, прокрутка повертається, фокус — на кнопку', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('burger-open').click();
    await page.getByTestId('burger-panel').waitFor();

    // 🔴 ТРИ РЕЧІ РАЗОМ, БО ПООДИНЦІ КОЖНА ЛИШАЄ ПАНЕЛЬ НАПІВМОДАЛЬНОЮ.
    // Відкрита панель, під якою сторінка їде від коліщатка, це накладка,
    // а не панель; а той, хто ходить клавіатурою, після закриття має
    // опинитись там, звідки прийшов, інакше він губиться на початку
    // сторінки.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
    expect(
      await page.evaluate(() => {
        const p = document.querySelector('[data-testid="burger-panel"]');
        return !!p && p.contains(document.activeElement);
      }),
      'фокус не зайшов у панель',
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('burger-panel')).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
      'фокус не повернувся на кнопку',
    ).toBe('burger-open');
  });

  test('перехід за пунктом закриває шухляду', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('burger-open').click();
    await page.getByTestId('burger-panel').getByRole('link', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByTestId('burger-panel')).toHaveCount(0);
  });
});

test.describe('🔴 CAMP-350 — підвал', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('юридичний ряд не нижчий за 48 px', async ({ page }) => {
    await page.goto('/');
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('footer nav[aria-label="Legal"] a, footer nav[aria-label="Legal"] button')].map(
        (e) => e.getBoundingClientRect().height,
      ),
    );
    // Пара: порожній ряд задовольнив би заборону.
    expect(heights.length, 'юридичного ряду немає').toBeGreaterThanOrEqual(4);
    expect(
      heights.filter((h) => h < 48).length,
      `${heights.filter((h) => h < 48).length} із ${heights.length} нижчі за 48 px`,
    ).toBe(0);
  });
});

test.describe('🔴 CAMP-350 — жодної горизонтальної прокрутки', () => {
  for (const w of [320, 375, 1199]) {
    test(`${w} px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto('/');
      const [cw, sw] = await page.evaluate(() => [
        document.documentElement.clientWidth,
        document.documentElement.scrollWidth,
      ]);
      expect(sw, `горизонтальна прокрутка на ${w} px`).toBeLessThanOrEqual(cw);
    });
  }
});
