import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './api-request';
import { axeViolations, settle, WCAG_TAGS } from './axe';
import type { Page } from '@playwright/test';

// 🔴 `axeViolations` СКАНУЄ ОСІЛУ СТОРІНКУ — сторож на це (CAMP-387).
//
// Фікстура відтворює рівно ту форму дефекту, що мигтіла на `/signup` і
// `/plan` у webkit: кнопка, колір якої на старті переходу НЕ проходить
// WCAG AA, а в кінці проходить. Ті самі кольори, що в `variant="accent"`
// (`#343d50` на `#dfe9f9`); `steps(1, end)` тримає початкове значення
// ВЕСЬ перехід, тож скан у будь-яку мить усередині нього бачить саме
// його — а не залежить від того, на якому відсотку кривої він потрапив.
//
// Це детермінований двійник вимірювання з опису PR, а не його заміна:
// там частота (3 із 200 → 0 із 200 без навантаження, 21 із 150 → 0 із 150
// з ним) на справжніх сторінках; тут — що вона не повернеться тихо.
//
// 🔴 Фікстура не торкається мережі й сервера: `setContent`. Тому спека
// біжить однаково в усіх браузерних проєктах і нічого не знає про збірку.

const fixture = (ms: number, extraCss = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>axe settle fixture</title>
<style>
  body{margin:0;background:#fff;color:#000;font:16px/1.4 sans-serif}
  main{padding:16px}
  #go{font:600 16px/1 sans-serif;padding:12px 16px;border:1px solid #7c92b7;
      background:#dfe9f9;color:#343d50;opacity:.2;
      transition:opacity ${ms}ms steps(1,end)}
  #go.on{opacity:1}
  ${extraCss}
</style></head><body><main><h1>Fixture</h1>
<button id="go" type="button">Go</button></main></body></html>`;

/** Сторінка з кнопкою, чий перехід щойно ПОЧАВСЯ. */
async function startTransition(page: Page, ms: number, extraCss = '') {
  await page.setContent(fixture(ms, extraCss));
  // Стиль «до» мусить бути пораховано, інакше зміна класу не дасть
  // переходу — просто нове значення.
  await page.evaluate(() => getComputedStyle(document.getElementById('go')!).opacity);
  await page.evaluate(() => document.getElementById('go')!.classList.add('on'));
}

const moving = (page: Page) =>
  page.evaluate(
    () => document.getAnimations().filter((a) => a.playState === 'running').length,
  );

test.describe('🔴 axe міряє осілу сторінку, а не кадр переходу', () => {
  test('контроль: без чекання фікстура ДАЄ порушення — інакше решта нічого не доводить', async ({
    page,
  }) => {
    // 8 с — з запасом на найповільніший скан: контроль не смів би
    // зелено проскочити, бо перехід устиг скінчитись.
    await startTransition(page, 8_000);
    expect(await moving(page), 'перехід мусить їхати під час скану').toBeGreaterThan(0);

    const raw = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    expect(raw.violations.map((v) => v.id)).toContain('color-contrast');
  });

  test('axeViolations дочекався кінця переходу й змірив осілу кнопку', async ({ page }) => {
    // 2 с, а не 0.2: скан без чекання встиг би закінчитись усередині
    // переходу на будь-якому залізі, тож мутація «прибрати settle» тут
    // червоніє завжди, а не коли пощастить із таймінгом.
    await startTransition(page, 2_000);
    expect(await axeViolations(page)).toEqual([]);

    // І що він справді дочекався, а не пощастило: рух скінчився, колір
    // — той, на який перехід вів.
    expect(await moving(page)).toBe(0);
    expect(
      await page.evaluate(() => getComputedStyle(document.getElementById('go')!).opacity),
    ).toBe('1');
  });

  test('🔴 чекання не ховає справжнього дефекту: осіла неконтрастна кнопка ЧЕРВОНІЄ', async ({
    page,
  }) => {
    // Той самий перехід, але КІНЕЦЬ неконтрастний: текст майже в колір
    // фону. Якби `settle` вчив тест не дивитись, тут було б `[]`.
    //
    // 🔴 «Майже», а не «рівно». Заміряно: коли колір тексту збігається з
    // фоном до біта, axe не дає порушення, а кладе вузол у `incomplete`
    // («1:1 contrast ratio with the background») — тобто мутація «колір =
    // фон» вийшла б ЗЕЛЕНОЮ, і про сторожа можна було б подумати, що він
    // осліп, хоча осліпла мутація.
    await startTransition(
      page,
      300,
      '#go{opacity:1;transition:color 300ms steps(1,end)} #go.on{color:#c9d6ee}',
    );
    const found = await axeViolations(page);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^color-contrast: .* — #go$/);
  });

  test('рух, що не скінчився за бюджет, — помилка з іменем, а не тихий скан', async ({
    page,
  }) => {
    await startTransition(page, 4_000);
    await expect(settle(page, 300)).rejects.toThrow(
      /не осіла за 300 мс.*opacity on button#go/,
    );
  });

  test('нескінченна анімація (спінер) не підвішує чекання', async ({ page }) => {
    await page.setContent(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x</title>
       <style>@keyframes spin{to{transform:rotate(1turn)}}
       #spin{width:20px;height:20px;animation:spin 1s linear infinite}</style></head>
       <body><main><h1>Fixture</h1><div id="spin"></div></main></body></html>`,
    );
    expect(await moving(page), 'фікстура мусить справді крутитись').toBe(1);
    await settle(page, 300);
  });
});
