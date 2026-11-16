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
 * CAMP-454. Привести шухляду налаштувань до потрібного стану ОДНИМ
 * зверненням до сторінки.
 *
 * 🔴 ЧОМУ ОДНЕ ЗВЕРНЕННЯ, А НЕ `isVisible` + `getAttribute` + `click` +
 * `waitFor`. Заміряно в траcі CI (прогін 43747398102, mobile-chrome): кожне
 * звернення до сторінки коштує там 0,3–0,5 с, клік — 1,5–2,1 с. Попередня
 * версія робила п'ять звернень (≈3,7 с) на КОЖНЕ відкриття й закриття, а
 * `photographMap` робить обидва. П'ять тестів `wildfire-layer` уже стояли
 * на 27 із 30 с бюджету (ланцюг із ~45 дій), і ці 4–8 с вивели їх за межу:
 * не зламаний вигляд, а час. Бюджет не піднімаємо — прибираємо зайві
 * звернення.
 *
 * Усе — всередині сторінки: дочекатись, поки з'явиться панель мапи
 * (вантажиться з `ssr: false`, інакше «кнопки ще нема» читалось би як
 * «кнопки нема»), натиснути кнопку, дочекатись, поки шухляда справді
 * з'явилась чи зникла в розмітці.
 *
 * Повертає, що сталось. 'stuck' — кнопку натиснули, а шухляда не
 * змінилась: це поломка, і виклик її кидає, а не мовчить.
 */
async function setDrawer(page: Page, open: boolean): Promise<void> {
  const outcome = await page.evaluate(async (want: boolean) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + 20_000;
    while (
      !document.querySelector('[data-testid="map-bar"],[data-testid="map-unsupported"]')
    ) {
      if (Date.now() > deadline) return 'no-map';
      await sleep(50);
    }
    const toggle = document.querySelector<HTMLElement>('[data-testid="map-settings-toggle"]');
    // На широкому екрані кнопки немає (`lg:hidden`): колонка завжди відкрита.
    if (!toggle || toggle.getClientRects().length === 0) return 'no-toggle';
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
    if (isOpen() === want) return 'already';
    toggle.click();
    const aside = document.getElementById('map-settings');
    while (Date.now() < deadline) {
      const shown = !!aside && aside.getClientRects().length > 0;
      if (isOpen() === want && shown === want) return 'done';
      await sleep(20);
    }
    return 'stuck';
  }, open);
  if (outcome === 'stuck') {
    throw new Error(
      `кнопка map-settings-toggle натиснута, а шухляда не ${open ? 'відкрилась' : 'закрилась'}`,
    );
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
 */
export async function openSettings(page: Page): Promise<void> {
  await setDrawer(page, true);
}

/**
 * CAMP-454. Зворотний бік `openSettings`: закрити шухляду, коли тест
 * читає ПІКСЕЛІ мапи. Шухляда лежить у потоці над полотном, тож її
 * висота зсуває мапу, і два знімки одного полотна розходяться.
 */
export async function closeSettings(page: Page): Promise<void> {
  await setDrawer(page, false);
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
