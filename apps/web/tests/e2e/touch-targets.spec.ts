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
type Touch = { name: string; group: string; x0: number; y0: number; x1: number; y1: number; w: number; h: number };

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
      // 🔴 Хто батько — щоб порівнювати СУСІДІВ, а не все з усім.
      group: el.parentElement
        ? [...el.parentElement.children].indexOf(el) >= 0
          ? (el.parentElement.closest('[data-ct-row]') || el.parentElement).tagName +
            ':' + ((el.parentElement.className || '') + '').slice(0, 40)
          : 'x'
        : 'x',
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

/**
 * Сторінки, на яких міряємо.
 *
 * 🔴 МАПА — НЕ ЄДИНА, І ЦЕ ВИПРАВЛЕННЯ ПІСЛЯ CI. Перша редакція міряла
 * лише `/map`, і на `firefox-desktop` усі три тести впали за таймаутом:
 * headless Firefox на раннері без GPU не має контексту WebGL2, тож
 * MapLibre не стартує, а разом із ним не зʼявляються й перемикачі шарів
 * і стилів. Репозиторій знає про це давно — `map.spec.ts:189`,
 * `skipWithoutWebGL`.
 *
 * 🔴 Але просто пропустити на Firefox означало б лишити сторожа без
 * роботи на цілому рушії, а пропущений тест виглядає так само зелено, як
 * пройдений. Тому мапа вимагає WebGL, а дві сторінки нижче — ні: їхні
 * кнопки приходять уже в HTML із сервера. На будь-якому рушії
 * перевіряється щонайменше щось.
 */
const PAGES = [
  { path: '/camping', needsWebGL: false },
  { path: '/', needsWebGL: false },
  { path: '/map', needsWebGL: true },
];

/** Чи є в цього рушія WebGL2 — те саме питання, що в `map.spec.ts`. */
async function hasWebGL(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
}

/**
 * Зібрати зони з усіх доступних сторінок.
 *
 * 🔴 ЧЕКАТИ ТРЕБА НА ЧИП МАПИ, А НЕ НА «ПЕРШУ КНОПКУ». Перша редакція
 * робила саме так — і CI знайшов 4 кнопки замість 7, бо першою на
 * сторінці стоїть банер згоди, що рендериться з сервера. Умова
 * справджувалась ще до того, як перемикачі мапи змонтувались.
 */
async function collectAll(page: import('@playwright/test').Page) {
  const perPage: { path: string; boxes: Touch[] }[] = [];
  for (const spec of PAGES) {
    await page.goto(spec.path);
    if (spec.needsWebGL) {
      if (!(await hasWebGL(page))) continue;
      await page.locator('[data-source]').first().waitFor();
      await page.locator('[data-layer]').first().waitFor();
    } else {
      await page.locator('[data-ct-button]').first().waitFor();
    }
    perPage.push({ path: spec.path, boxes: await touchBoxes(page) });
  }
  return perPage;
}

/**
 * 🔴 ПАРА ДО КОЖНОГО ТВЕРДЖЕННЯ НИЖЧЕ. «Жодна не менша за 48» і «ніщо не
 * перекривається» справдились би й над порожнечею — а саме так виглядав
 * би зламаний селектор або сторінка, що не відрендерилась.
 *
 * Чотири — це мінімум, який тримається на фікстурі CI у 72 кемпінги:
 * дві країни в переліку плюс дві кнопки банера згоди. На повній базі їх
 * десятки, але поріг має бути правдою в найгіршому випадку, а не в
 * типовому.
 */
function assertNotEmpty(perPage: { path: string; boxes: Touch[] }[]) {
  expect(perPage.length, 'жодної сторінки не виміряно').toBeGreaterThanOrEqual(2);
  for (const p of perPage) {
    expect(p.boxes.length, `${p.path}: кнопок не знайдено`).toBeGreaterThanOrEqual(1);
  }
  const total = perPage.reduce((n, p) => n + p.boxes.length, 0);
  expect(total, 'разом замало кнопок, щоб це щось доводило').toBeGreaterThanOrEqual(4);
}

test.describe('🔴 CAMP-345 — зона натискання на 375 px', () => {
  // 🔴 ПОТРІЙНИЙ БЮДЖЕТ, БО ТУТ ЧОТИРИ ПОВНІ НАВІГАЦІЇ, А НЕ ОДНА.
  //
  // На `main` 19.10.2026 тест про горизонтальний скрол упав на
  // webkit-desktop: `page.goto('/')` не вклався в 30 секунд, чекаючи
  // `load`. Він пройшов із другої спроби, і сторож `check-flaky`
  // правильно завалив прогін — зелене лише на повторі це не зелене.
  //
  // Причина не в коді сторінки, а в арифметиці: кожен тест цього файла
  // відкриває три-чотири сторінки ЦІЛКОМ, бо горизонтальний скрол
  // залежить і від зображень, що вантажаться останніми. Тридцяти секунд
  // на чотири такі навігації webkit не вистачає під навантаженням.
  //
  // `test.slow()` потроює бюджет і нічого не послаблює: жодне
  // твердження нижче не змінилось. Альтернатива — чекати лише
  // `domcontentloaded` — зробила б перевірку сліпою саме до того, що
  // вона шукає: завелике зображення розсуває сторінку вже після нього.
  test.beforeEach(() => {
    test.slow();
  });

  test('жодна кнопка не має зони натискання меншої за 48 px', async ({ page }) => {
    const perPage = await collectAll(page);
    assertNotEmpty(perPage);

    const small = perPage.flatMap((p) =>
      p.boxes
        .filter((b) => b.w < 48 || b.h < 48)
        .map((b) => `${p.path} ${b.name}: ${Math.round(b.w)}×${Math.round(b.h)}`),
    );
    expect(small, 'зона натискання менша за 48 px').toEqual([]);
  });

  test('зони натискання сусідніх кнопок не перекриваються', async ({ page }) => {
    const perPage = await collectAll(page);
    assertNotEmpty(perPage);

    // 🔴 ЦЕ НЕ ПРИДИРКА, А ЗАМІРЯНІ ДЕФЕКТИ — ТРИ ШТУКИ, І ВСІ ТРИ
    // ЗНАЙДЕНІ САМЕ ЦИМ ТЕСТОМ, А НЕ ОКОМ:
    //   пагінація   `min-w-9` (36 px) при `gap-2` → 4 px по горизонталі;
    //   чипи країн  36 px при `gap-2` між рядками → 4 px по вертикалі;
    //   фільтри     36 px при `gap-1.5` (6 px)    → 6 px, 12 пар.
    // У смузі перекриття клік дістається тому елементу, що пізніше в
    // DOM, тобто дрібна ціль перетворюється на ціль, яка ловить не те.
    const overlaps: string[] = [];
    for (const { path, boxes } of perPage) {
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          // 🔴 ЛИШЕ СУСІДИ В ОДНОМУ КОНТЕЙНЕРІ. Банер згоди —
          // `position: fixed`, він лежить ПОВЕРХ вмісту навмисно, і його
          // зона законно накриває те, що під ним: клік дістається
          // банеру, бо він вище. Порівнювати все з усім означало б звати
          // це дефектом. Правило стосується сусідів у ряду, де обидва
          // мають лишатись досяжними.
          if (a.group !== b.group) continue;
          const dx = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          if (dx > 0.5 && dy > 0.5) {
            overlaps.push(`${path} ${a.name} ↔ ${b.name}: ${Math.round(dx)}×${Math.round(dy)} px`);
          }
        }
      }
    }
    expect(overlaps, 'зони натискання накладаються одна на одну').toEqual([]);
  });

  test('сторінки на 375 px не мають горизонтального скролу', async ({ page }) => {
    // Пункт 4 «Способу перевірки» називає сторінку кемпінгу, тож шлях до
    // неї починається з переліку — і те, що перелік не порожній, теж
    // твердження, а не припущення.
    await page.goto('/camping');
    const href = await page.locator('a[href^="/camping/"]').first().getAttribute('href');
    expect(href, 'на /camping немає жодного посилання вглиб').toBeTruthy();

    for (const path of [href as string, '/camping', '/']) {
      await page.goto(path);
      const [w, sw] = await page.evaluate(() => [
        document.documentElement.clientWidth,
        document.documentElement.scrollWidth,
      ]);
      expect(w, `${path}: ширина вікна`).toBe(375);
      expect(sw, `${path}: горизонтальний скрол на 375 px`).toBeLessThanOrEqual(w);
    }
  });
});
