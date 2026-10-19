import type { Page, Locator } from '@playwright/test';

/**
 * Головна навігація сайту, якою б не була ширина (CAMP-350).
 *
 * 🔴 ЦЕЙ ФАЙЛ ІСНУЄ ЧЕРЕЗ ПОМИЛКУ, ЯКУ Я ЗРОБИВ ДВІЧІ. Нижче 1200 px
 * горизонтального меню в шапці більше немає — там бургер-шухляда. Тести,
 * що брали `getByRole('navigation')` і клікали пункт, почали падати на
 * `mobile-chrome` (Pixel 7, 412 px): landmark `Main` там `display: none`,
 * тож для дерева доступності його не існує.
 *
 * Першого разу я полагодив `plan.spec.ts` окремим рядком і вирішив, що це
 * все — бо рецензія назвала саме його. CI показав другий, `guides.spec.ts`.
 * Тобто я латав ВИПАДОК, а не правило: доки спосіб дістатись меню живе
 * копіями по файлах, наступний такий тест напишуть так само й він впаде
 * так само.
 *
 * Тепер спосіб один і названий. Якщо межа колись зміниться, міняти
 * доведеться тут, а не шукати всіх, хто здогадався про неї сам.
 */
export async function openHeaderNav(page: Page): Promise<Locator> {
  const burger = page.getByTestId('burger-open');
  // 🔴 `aria-expanded`, а не просто «видима». Кнопка лишається в DOM під
  // затемненням, коли шухляда вже відкрита, тож повторний клік по ній
  // Playwright не доведе до кінця: затемнення перехоплює вказівник, і
  // виклик крутиться до таймауту. Саме так воно й упало, коли в
  // `plan.spec.ts` на мить лишились і вбудований фікс, і цей помічник.
  if (
    (await burger.isVisible()) &&
    (await burger.getAttribute('aria-expanded')) !== 'true'
  ) {
    await burger.click();
  }
  if (await page.getByTestId('burger-panel').count()) {
    await page.getByTestId('burger-panel').waitFor();
  }
  return page.getByRole('navigation', { name: 'Main' });
}
