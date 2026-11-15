import type { Page } from '@playwright/test';

/**
 * Відкрити `/map`, перепитуючи, поки API відмовляє в регіональному
 * індексі через обмеження частоти.
 *
 * 🔴 ВІКНО ПОВТОРІВ ЗВ'ЯЗАНЕ ЧАСОМ, А НЕ КІЛЬКІСТЮ СПРОБ, І ЦЕ
 * ВИПРАВЛЕННЯ РЕЦЕНЗІЇ CAMP-304.
 *
 * Було вісім спроб із наростаючим сном: 3+6+9+12+15+18+21 = 84 секунди.
 * Поки бюджет тесту був 30 або 90 секунд, цикл не встигав дійти до
 * кінця — тест падав, і це було правильно: «API вісім разів відмовив»
 * означає, що щось зламане.
 *
 * Коли CAMP-304 підняв бюджет webkit до 90 секунд, рецензія виміряла
 * наслідок: сторінка, яка рендериться лише з восьмої спроби, тепер
 * **проходить** на webkit за 100 034 мс. Тобто кидок нижче з мертвого
 * коду став досяжним тільки на одному рушії, а на інших зник зовсім.
 * Рівно те, про що картка попереджала: більший бюджет ховає справжнє
 * зависання.
 *
 * Цикл, обмежений кількістю спроб, росте разом із бюджетом. Цикл,
 * обмежений часом, не росте ніколи — хоч би яким став бюджет завтра.
 *
 * 🔴 ШІСТДЕСЯТ СЕКУНД — ЦЕ НЕ КРУГЛЕ ЧИСЛО. Коментар у
 * `wildfire-layer.spec.ts` називає причину повторів прямо: «ліміт
 * поповнюється протягом хвилини». Вікно дорівнює періоду поповнення:
 * коротше ламало б законне відновлення, довше знову ховало б поломку.
 */
export const RETRY_WINDOW_MS = 60_000;

/** Текст сторінки, яку віддає застосунок, коли API відмовив. */
const DID_NOT_LOAD = 'This page did not load properly';

export async function openMapRetryingThrottle(
  page: Page,
  opts: {
    mapSelector: string;
    afterGoto?: (p: Page) => Promise<void>;
    /** CAMP-454: лишити шухляду налаштувань закритою (тест самої шухляди). */
    keepSettingsClosed?: boolean;
  },
): Promise<void> {
  const deadline = Date.now() + RETRY_WINDOW_MS;
  let wait = 3_000;
  for (;;) {
    await page.goto('/map');
    if (opts.afterGoto) await opts.afterGoto(page);
    if ((await page.locator(opts.mapSelector).count()) > 0) {
      if (!opts.keepSettingsClosed) await openSettings(page);
      return;
    }
    // Щось інше зламалось — хай тест скаже про це сам, а не про ліміт.
    if ((await page.getByText(DID_NOT_LOAD).count()) === 0) {
      // CAMP-454: мапа з `ssr: false` може ще не зʼявитись у цю мить —
      // тоді шухляду теж відкриває `openSettings`, що сама дочекається.
      if (!opts.keepSettingsClosed) await openSettings(page);
      return;
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `/map не відрендерився за ${RETRY_WINDOW_MS / 1000} с: API раз за разом відмовляв у регіональному індексі`,
      );
    }
    await page.waitForTimeout(Math.min(wait, left));
    wait += 3_000;
  }
}

/**
 * CAMP-454. Нижче `lg` налаштування мапи лежать у шухляді, закритій за
 * замовчуванням (мапа на весь екран). Тест, що тягнеться до шарів чи
 * фільтрів, спершу відкриває її — рівно як читач натиснув би кнопку.
 *
 * 🔴 НА ШИРОКОМУ ЕКРАНІ ЦЕ НІЧОГО НЕ РОБИТЬ, бо кнопки там немає: колонка
 * завжди відкрита. Тож десктопні проєкти й далі стверджують те саме, що й
 * раніше, а телефонні — те саме ПІСЛЯ натискання.
 *
 * Чекає, поки клієнтський компонент з'явиться (мапа вантажиться з
 * `ssr: false`), інакше «кнопки ще нема» читалось би як «кнопки нема».
 */
export async function openSettings(page: Page): Promise<void> {
  await page
    .locator('[data-testid="map-bar"],[data-testid="map-unsupported"]')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => {});
  const toggle = page.getByTestId('map-settings-toggle');
  if (!(await toggle.isVisible())) return;
  if ((await toggle.getAttribute('aria-expanded')) === 'true') return;
  await toggle.click();
  await page.getByTestId('map-settings').waitFor({ state: 'visible' });
}

/**
 * CAMP-454. Зворотний бік `openSettings`: закрити шухляду, щоб вона не
 * лежала на полотні, коли тест читає ПІКСЕЛІ мапи. Відкрита шухляда
 * накриває нижні 42% екрана, і точка вибірки під нею — це пиксель шухляди,
 * а не мапи.
 */
export async function closeSettings(page: Page): Promise<void> {
  const toggle = page.getByTestId('map-settings-toggle');
  if (!(await toggle.isVisible())) return;
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') return;
  await toggle.click();
  await page.getByTestId('map-settings').waitFor({ state: 'hidden' });
}

/**
 * CAMP-454. Знімок полотна мапи, який не залежить від шухляди. На телефоні
 * шухляда лежить НАД мапою в потоці сторінки, і її висота міняється зі
 * станом шару (нотатка про посуху чи пожежі) — мапа зміщується під
 * липкою шапкою, і два знімки одного полотна розходяться.
 *
 * Тож: закрити, сфотографувати, відкрити назад (наступний крок тесту
 * зазвичай тисне на чип). На широкому екрані обидва виклики порожні.
 */
export async function photographMap(page: Page): Promise<Buffer> {
  await closeSettings(page);
  const shot = await page.locator('[data-testid="map"]').screenshot();
  await openSettings(page);
  return shot;
}
