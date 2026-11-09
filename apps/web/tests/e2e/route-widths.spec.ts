import { expect, test, type Page } from '@playwright/test';
import { getRoutes } from '@/lib/routes';

/**
 * CAMP-459 (2/2) — ширина сінгл-маршруту.
 *
 * Власник: «ширина не та; широкий текст тягнути на всю ширину, вузькі
 * таблиці ставити по центру — так класно і гармонійно». Картка вимагає
 * саме заміру: «вузькі блоки по центру — замір відступів, не око».
 *
 * 🔴 ЧОМУ ЦЕ E2E, А НЕ ЮНІТ. Юніт побачив би класи; питання ж не про
 * класи, а про ПІКСЕЛІ на широкому вікні. Заміряно на проді перед
 * правкою (вікно 1700, `main` 1652): усередині секції джерел блоки
 * скакали 840 → 1610 → 840, і всі притиснуті вліво — 812 px порожнечі
 * праворуч.
 *
 * 🔴 І ЧОМУ ПЕРЕВІРЯЄТЬСЯ СИМЕТРІЯ, А НЕ ШИРИНА. «Ширина 840» пройшла б
 * і для блока, прибитого до лівого краю, — тобто для самого дефекту.
 * Рівні відступи ліворуч і праворуч довести можна тільки різницею.
 */

const WIDE = { width: 1700, height: 900 };

/**
 * 🔴 СЛАГ БЕРЕТЬСЯ З ТОГО Ж ДЖЕРЕЛА, ЩО Й СТОРІНКА. Маршрути — не з API,
 * а з `lib/routes.ts`; вписаний сюди слаг одного дня перестане
 * існувати, тест почервоніє на 404 і скаже «ширина зламана» про
 * сторінку, якої немає.
 */
function firstRoute(): string {
  const routes = getRoutes();
  expect(routes.length, 'жодного маршруту в lib/routes.ts — замір сліпий').toBeGreaterThan(0);
  return `/routes/${routes[0].slug}`;
}

/** Відступи блока від лівого й правого краю `main`, у пікселях. */
async function gaps(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const main = document.querySelector('main')!;
    const el = document.querySelector(sel)!;
    const m = main.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left - m.left), right: Math.round(m.right - r.right), w: Math.round(r.width) };
  }, selector);
}

test.describe('CAMP-459: вузькі секції стоять по центру', () => {
  test.use({ viewport: WIDE });

  test('🔴 секція джерел центрована, а не притиснута вліво', async ({ page }) => {
    await page.goto(firstRoute());
    const g = await gaps(page, '[data-testid="route-sources"]');
    // Якір: вона справді вужча за `main`, інакше «центровано» нічого не
    // означає — блок на всю ширину симетричний за побудовою.
    expect(g.w, `секція джерел завширшки ${g.w} px`).toBeLessThan(1200);
    expect(
      Math.abs(g.left - g.right),
      `відступи: ліворуч ${g.left} px, праворуч ${g.right} px`,
    ).toBeLessThanOrEqual(2);
  });

  test('усередині секції джерел ширини не скачуть', async ({ page }) => {
    await page.goto(firstRoute());
    const widths = await page.evaluate(() => {
      const sec = document.querySelector('[data-testid="route-sources"]')!;
      return [...sec.children]
        .map((c) => Math.round(c.getBoundingClientRect().width))
        .filter((w) => w > 0);
    });
    expect(widths.length, 'у секції джерел немає дітей — замір сліпий').toBeGreaterThan(1);
    const span = Math.max(...widths) - Math.min(...widths);
    expect(span, `ширини всередині: ${widths.join(', ')}`).toBeLessThanOrEqual(2);
  });

  test('широкі блоки лишаються на всю ширину', async ({ page }) => {
    // 🔴 Протилежна половина правила, і без неї попередні два тести
    // пройшли б на сторінці, де ВСЕ звужене до 840 — тобто на іншому
    // дефекті.
    await page.goto(firstRoute());
    const stages = await gaps(page, '[aria-labelledby="stages-heading"]');
    expect(stages.w, `секція етапів завширшки ${stages.w} px`).toBeGreaterThan(1200);
  });

  test('горизонтального скролу немає', async ({ page }) => {
    await page.goto(firstRoute());
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(over, `сторінка ширша за вікно на ${over} px`).toBeLessThanOrEqual(0);
  });
});
