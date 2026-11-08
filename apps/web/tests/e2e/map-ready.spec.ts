import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { NOTE, waitForWildfireNote } from '../map-ready';

// 🔴 `waitForWildfireNote` ЧЕКАЄ НА КАДР, А НЕ ЛИШЕ НА СТАН.
//
// Нотатка про пожежі (`wildfire-panel.tsx`) каже про той самий `fresh`
// два різні речення: «recorded N burnt areas across the EU-27», поки мапа
// не назвала їй свої межі (`data-in-view=""`), і «None of the N … is in
// this view» після. Друге довше на рядок. Заміряно 08.11.2026 у CI (#471,
// перший прогін `phone › map`): знімок 3144 px проти еталона 3204 px, усе
// нижче нотатки зсунуто на 60 px, повтор зелений. `data-state` був `fresh`
// в обох знімках — тобто чекання на стан проходило чесно й зарано.
//
// 🔴 Фікстура не торкається мережі й сервера: `setContent`. Вона
// відтворює рівно ті два атрибути, що їх пише компонент, і міняє другий
// із затримкою — так, як це робить мапа, коли дізнається межі.

const fixture = (state: string, inView: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>wildfire note fixture</title></head>
<body><div role="status" data-testid="wildfire-note"
  data-state="${state}" data-in-view="${inView}">fixture</div></body></html>`;

/** Нотатка в стані `state`, яка дізнається межі через `afterMs`. */
async function noteThatLearnsBounds(page: Page, state: string, afterMs: number) {
  await page.setContent(fixture(state, ''));
  await page.evaluate(
    ([sel, ms]) => {
      setTimeout(() => {
        document.querySelector(sel as string)?.setAttribute('data-in-view', '0');
      }, ms as number);
    },
    [NOTE, afterMs],
  );
}

test.describe('🔴 waitForWildfireNote чекає, поки нотатка дізнається межі кадру', () => {
  test('стан уже fresh, межі приходять за 600 мс — чекання завершується ПІСЛЯ них', async ({
    page,
  }) => {
    await noteThatLearnsBounds(page, 'fresh', 600);
    // 🔴 Читаємо атрибут у мить, коли чекання відпустило. Мутація «не
    // чекати на data-in-view» відпускає одразу, і тут ще порожньо.
    await waitForWildfireNote(page, 5_000);
    expect(await page.getAttribute(NOTE, 'data-in-view')).toBe('0');
  });

  test('стан fresh, межі не приходять — падіння називає саме data-in-view', async ({
    page,
  }) => {
    await page.setContent(fixture('fresh', ''));
    await expect(waitForWildfireNote(page, 1_500)).rejects.toThrow(
      /data-in-view порожній/,
    );
  });

  test('шар вимкнено (off) — межі не потрібні, чекання не висить', async ({ page }) => {
    await page.setContent(fixture('off', ''));
    // Бюджет навмисно більший за межу тесту: якби чекання пішло по
    // data-in-view, воно висіло б усі 10 с і тест упав би за бюджетом.
    test.setTimeout(8_000);
    await waitForWildfireNote(page, 10_000);
  });

  test('стан ще loading — спершу падає чекання на стан, як і раніше', async ({ page }) => {
    await page.setContent(fixture('loading', '0'));
    await expect(waitForWildfireNote(page, 1_500)).rejects.toThrow(
      /не дійшло до стану/,
    );
  });
});
