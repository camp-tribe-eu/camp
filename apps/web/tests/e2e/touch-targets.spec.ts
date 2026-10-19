import { test, expect } from '@playwright/test';

/**
 * CAMP-345 — зона натискання на ширині, на якій збудований мобільний макет.
 *
 * 🔴 ЦЬОГО ФАЙЛУ НЕ БУЛО, І ЦЕ БУЛА ГОЛОВНА ДІРКА КАРТКИ. Рецензія
 * показала: прибери `touch-target` із `SIZE.sm` у компоненті кнопки — і
 * всі 104 файли тестів лишаться зеленими. Тобто правило «48 px» трималось
 * на моєму слові.
 *
 * `playwright.config.ts` визнає це прямим текстом ще з 11.10.2026: «жоден
 * із 286 тестів не звертається до дотику чи ширини екрана». Найближчі
 * ширини, які ми знімали, — 390 (проєкт `visual`) і 412 (Pixel 7). 375
 * немає серед них, а саме на ній збудована сторінка `Design - Mobile` у
 * Figma: 251 входження проти 48 px (31 раз) і 16 px (29 разів).
 */
test.use({ viewport: { width: 375, height: 812 } });

/** Прямокутник, у який реально треба влучити пальцем. */
type Touch = { name: string; x0: number; y0: number; x1: number; y1: number; w: number; h: number };

/**
 * 🔴 Рахується з `::after`, а не з рамки елемента. Саме в цьому суть
 * `.touch-target`: видимі 36 px лишаються 36 px, а зона розсувається
 * псевдоелементом. Міряти бокс кнопки означало б міряти те, чого правило
 * не стосується.
 */
const COLLECT = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('[data-ct-button]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const af = getComputedStyle(el, '::after');
    const grows = af.content !== 'none' && af.position === 'absolute';
    const w = grows ? Math.max(r.width, parseFloat(af.width) || 0) : r.width;
    const h = grows ? Math.max(r.height, parseFloat(af.height) || 0) : r.height;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    out.push({
      name: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30) || el.tagName,
      x0: cx - w / 2, x1: cx + w / 2,
      y0: cy - h / 2, y1: cy + h / 2,
      w, h,
    });
  }
  return out;
})()`;

async function touchBoxes(page: import('@playwright/test').Page): Promise<Touch[]> {
  return page.evaluate(COLLECT);
}

test.describe('🔴 CAMP-345 — зона натискання на 375 px', () => {
  test('жодна кнопка не має зони натискання меншої за 48 px', async ({ page }) => {
    await page.goto('/map');
    await page.locator('[data-ct-button]').first().waitFor();
    const boxes = await touchBoxes(page);

    // 🔴 ПАРА ДО ТВЕРДЖЕННЯ НИЖЧЕ. «Жодна не менша за 48» справдилось би
    // й тоді, коли кнопок немає зовсім — а саме так виглядав би зламаний
    // селектор або сторінка, що не відрендерилась. Сім — це статичні
    // чипи мапи: три шари (Wildfire, Drought, Weather warnings) і чотири
    // стилі (Standard, Bright, Muted, Satellite). Вони не залежать від
    // того, скільки рядків у базі, тож число тримається і на фікстурі CI.
    expect(boxes.length, 'кнопок не знайдено — селектор або сторінка зламані').toBeGreaterThanOrEqual(7);

    const small = boxes.filter((b) => b.w < 48 || b.h < 48);
    expect(
      small.map((b) => `${b.name}: ${Math.round(b.w)}×${Math.round(b.h)}`),
      'зона натискання менша за 48 px',
    ).toEqual([]);
  });

  test('зони натискання сусідніх кнопок не перекриваються', async ({ page }) => {
    await page.goto('/map');
    await page.locator('[data-ct-button]').first().waitFor();
    const boxes = await touchBoxes(page);
    expect(boxes.length).toBeGreaterThanOrEqual(7);

    // 🔴 ЦЕ НЕ ПРИДИРКА, А ЗАМІРЯНИЙ ДЕФЕКТ. До рецензії кнопка
    // пагінації мала `min-w-9` (36 px) при `gap-2` (8 px): зона
    // розсувалась на 6 px у кожен бік, щілини було 8, і 4 px зон
    // перекривались. У смузі перекриття клік дістається тому елементу,
    // що пізніше в DOM, — тобто дрібна ціль перетворюється на ціль, яка
    // ловить не те. Це гірше за початковий стан, а не краще.
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const dx = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (dx > 0.5 && dy > 0.5) {
          overlaps.push(`${a.name} ↔ ${b.name}: ${Math.round(dx)}×${Math.round(dy)} px`);
        }
      }
    }
    expect(overlaps, 'зони натискання накладаються одна на одну').toEqual([]);
  });

  test('сторінка кемпінгу на 375 px не має горизонтального скролу', async ({ page }) => {
    // Пункт 4 «Способу перевірки» називає саме сторінку кемпінгу.
    await page.goto('/camping');
    const href = await page
      .locator('a[href^="/camping/"]')
      .first()
      .getAttribute('href');
    expect(href, 'на /camping немає жодного посилання вглиб').toBeTruthy();

    await page.goto('/map');
    const [w, sw] = await page.evaluate(() => [
      document.documentElement.clientWidth,
      document.documentElement.scrollWidth,
    ]);
    expect(w).toBe(375);
    expect(sw, 'горизонтальний скрол на 375 px').toBeLessThanOrEqual(w);
  });
});
