import { expect, test } from './api-request';

/**
 * Шрифти не перевіряються заново на кожній сторінці — і подія `load`
 * через це не зависає у WebKit.
 *
 * 🔴 ЗВІДКИ ЦЕЙ ФАЙЛ. `main`, прогін 43405055548 (13.11.2026): два тести
 * persona.spec.ts у `webkit-desktop` вичерпали 30 с на `page.goto`, двічі
 * кожен. У трасах останнє, що прийшло, — `304 Not Modified` на обидва
 * шрифти з `<link rel="preload" as="font">`; далі жодного запиту.
 * Причина не в persona: `public/` віддавався з `max-age=0`, WebKit на
 * кожному переході перепитував шрифт, і після 304 на preload-шрифт
 * `load` час від часу не настає взагалі. Заміри й розбір за ресурсами —
 * біля заголовка в next.config.mjs.
 *
 * 🔴 ЧОМУ ЦЬОГО НЕ БАЧИВ ЖОДЕН PR. `webkit-desktop` іде лише на `main`
 * і за ручного запуску (FULL_MATRIX у playwright.config.ts), а більшість
 * тестів робить один перехід на свіжий контекст — кеш порожній, 304
 * немає. Тому другий тест нижче навмисно ходить багато разів в одному
 * контексті.
 *
 * 🔴 ЧОГО ЦЕЙ ФАЙЛ НЕ ДОВОДИТЬ. Що так само поводиться справжній Safari
 * у читача: заміряно рушій WebKit із Playwright, а не Safari.
 */

/** Адреси шрифтів, які називає САМА віддана сторінка і її стилі. */
async function fontUrls(page: import('@playwright/test').Page) {
  const res = await page.request.get('/');
  expect(res.status()).toBe(200);
  const html = await res.text();
  const preloaded = [
    ...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g),
  ]
    .map((m) => m[0])
    .filter((tag) => /\bas="font"/.test(tag))
    .map((tag) => /\bhref="([^"]+)"/.exec(tag)?.[1] ?? '');
  const sheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map(
    (m) => /\bhref="([^"]+)"/.exec(m[0])?.[1] ?? '',
  );
  const fromCss: string[] = [];
  for (const href of sheets) {
    const css = await (await page.request.get(href)).text();
    for (const m of css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g)) {
      fromCss.push(m[1]);
    }
  }
  return { preloaded, all: [...new Set([...preloaded, ...fromCss])] };
}

test.describe('кеш шрифтів', () => {
  test('🔴 кожен шрифт, який називає сторінка, кешується на рік без перевірки', async ({
    page,
  }) => {
    const { preloaded, all } = await fontUrls(page);
    // Знаменник: порожній перелік задовольнив би цикл нижче будь-чим.
    expect(preloaded.length, 'сторінка не оголошує жодного preload-шрифту').toBeGreaterThan(0);
    expect(all.length, 'у стилях не знайдено жодного шрифту').toBeGreaterThanOrEqual(
      preloaded.length,
    );
    for (const url of all) {
      const res = await page.request.get(url);
      expect(res.status(), url).toBe(200);
      const cc = res.headers()['cache-control'] ?? '';
      const maxAge = Number(/\bmax-age=(\d+)/.exec(cc)?.[1] ?? -1);
      expect(maxAge, `${url}: Cache-Control «${cc}»`).toBeGreaterThanOrEqual(31_536_000);
      expect(cc, `${url}: без immutable браузер перепитує при перезавантаженні`).toContain(
        'immutable',
      );
      // Заголовок кешу не сміє витіснити решту: X-Robots-Tag і nosniff
      // на шрифтах стоять навмисно (next.config.mjs, CAMP-90).
      expect(res.headers()['x-content-type-options'], url).toBe('nosniff');
    }
  });

  test('🔴 дванадцять переходів поспіль в одному контексті: кожен доходить до load', async ({
    page,
  }) => {
    // Без заголовка у WebKit: 6–9 серій із 10 зависали вже на восьми
    // переходах. Один контекст — щоб кеш був теплий і браузер мав що
    // перепитувати. Чергуємо сторінки, бо на `main` зависав і перехід на
    // ту саму адресу, і на іншу.
    const paths = ['/', '/about', '/legal/cookies'];
    for (let i = 0; i < 12; i++) {
      const path = paths[i % paths.length];
      await page.goto(path, { timeout: 10_000 });
      expect(await page.evaluate(() => document.readyState), `перехід ${i + 1} на ${path}`).toBe(
        'complete',
      );
    }
  });
});
