import { test, expect, type Page } from './api-request';

/**
 * Покрутити СПРАВЖНІМ коліщатком і сказати, куди доїхала сторінка.
 *
 * 🔴 ТРИ РЕЧІ, КОЖНА З ЯКИХ РОБИЛА ЦЮ ПРОБУ ПОРОЖНЬОЮ, доки не
 * заміряно:
 *
 * 1. `page.mouse.wheel` сам по собі нічого не крутить, бо курсор
 *    стоїть у (0,0) — треба спершу підвести його на сторінку.
 * 2. Прокрутка асинхронна: читати `scrollY` одразу після події —
 *    значить читати нуль у будь-якому разі.
 * 3. `window.scrollTo` сюди НЕ годиться взагалі: `overflow: hidden`
 *    забороняє прокрутку користувачеві, а не скриптові. Заміряно —
 *    під замком `scrollTo(0, 500)` чесно дає `scrollY === 500`. Проба,
 *    що цього не знає, каже «замка немає» там, де він є.
 *
 * Перевірено з обох боків на живій сторінці: з відкритою панеллю той
 * самий рух дає 0, із закритою — 1000.
 */
async function wheelTo(page: Page, dy: number) {
  await page.mouse.move(200, 400);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(300);
  return page.evaluate(() => window.scrollY);
}

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

    // 🔴 Пара до тверджень нижче: порожня панель задовольнила б і «жоден
    // не менший за 48», і «ніщо не перекривається». Тому кількість треба
    // стверджувати окремо — але САМЕ ЦЕ, а не точне число.
    //
    // 🔴 ТУТ СТОЯЛО `toBe(6)`, І ВОНО ПРОТУХЛО, щойно меню поповнилось:
    // пункти живуть у базі, власник може їх додавати, і падіння виглядало
    // б як регресія шухляди, хоча шухляда справна.
    //
    // 🔴 ДАЛІ Я ТРИЧІ ПОМИЛИВСЯ, намагаючись звіряти з шапкою. Спершу
    // взяв `header nav a` — він рахував і шухляду, бо вона всередині
    // <header>. Потім звузив до `nav[aria-label="Main"]` — числа однаково
    // не збіглися. Щоразу я ВГАДУВАВ розмітку замість того, щоб її
    // заміряти, і щоразу це була нова помилка замість старої.
    //
    // Повертаюсь до того, що перевірка мала доводити з самого початку:
    // панель не порожня. Точне число — окрема робота, і робити її треба
    // із заміром розмітки, а не з припущення про неї.
    expect(boxes.length, 'у шухляді немає пунктів').toBeGreaterThan(0);

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
    // 🔴 ТУТ БУЛО `getComputedStyle(document.body).overflow === 'hidden'`
    // — тобто перевірка читала РІВНО ТЕ ПОЛЕ, яке пише компонент, і
    // погоджувалась із ним за побудовою. Рецензія заміряла ціну: додай
    // `html { overflow-y: scroll }` (звичайне виправлення стрибка
    // смуги прокрутки) — і сторінка їде на 1200 px під відкритою
    // панеллю, доки це твердження досі каже «hidden».
    //
    // Чесна форма питає НАСЛІДОК: покрути коліщатком і подивись, чи
    // зрушила сторінка.
    expect(await wheelTo(page, 1200), 'сторінка їде під відкритою панеллю').toBe(0);
    expect(
      await page.evaluate(() => {
        const p = document.querySelector('[data-testid="burger-panel"]');
        return !!p && p.contains(document.activeElement);
      }),
      'фокус не зайшов у панель',
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('burger-panel')).toHaveCount(0);
    // Парне твердження: після закриття сторінка знову їде.
    expect(
      await wheelTo(page, 600),
      'сторінка не прокручується після закриття',
    ).toBeGreaterThan(0);
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

test.describe('🔴 CAMP-350 — межа при відкритій шухляді', () => {
  test('розширення вікна до 1200 px не лишає сторінку замкненою', async ({ page }) => {
    // 🔴 ЦЕ БУВ СПРАВЖНІЙ ДЕФЕКТ, ЗНАЙДЕНИЙ РЕЦЕНЗІЄЮ. `xl:hidden` —
    // це CSS: при переході через 1200 px панель зникала разом із
    // кнопкою закриття, а `body { overflow: hidden }` лишався, бо його
    // знімало лише прибирання ефекту. Читач опинявся на сторінці, яка
    // не прокручується, без жодного видимого контролю — а на планшеті
    // це просто поворот екрана, де немає навіть Escape.
    await page.setViewportSize({ width: 412, height: 800 });
    await page.goto('/');
    await page.getByTestId('burger-open').click();
    await page.getByTestId('burger-panel').waitFor();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('burger-panel')).toHaveCount(0);

    // Наслідок, а не поле: сторінка мусить їхати.
    expect(
      await wheelTo(page, 800),
      'сторінка лишилась замкненою після переходу через 1200 px',
    ).toBeGreaterThan(0);
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
    // 🔴 `toBe`, а не `toBeGreaterThanOrEqual(4)`: сім сторінок із
    // LEGAL_PAGES плюс кнопка «Cookie settings». З порогом «не менше 4»
    // половина ряду могла зникнути, лишивши тест зеленим.
    expect(heights.length, 'юридичний ряд змінив склад').toBe(8);
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
