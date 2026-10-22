import { expect, test } from './api-request';

// CAMP-383 — `<noscript>` у каркасі: що віддає сервер і як це бачить
// браузер.
//
// 🔴 ЧОМУ ЦЕЙ НАБІР ІСНУЄ. Тут стояв `<style>` ЕЛЕМЕНТОМ усередині
// `<noscript>`. Коли скрипт увімкнено, браузер розбирає вміст
// `<noscript>` як ОДИН ТЕКСТОВИЙ ВУЗОЛ — і React, що віддав там
// елемент, бачить два різні дерева в одному місці. Це й була
// переривчаста помилка #418, що мигтіла в CI на /login, /plan,
// /routes/…, /account і /camping: каркас спільний, тож на кожній.
//
// Виправлення — віддати React той самий РЯДОК. Але CSS при цьому не
// сміє змінитись ні на символ: без JS саме він повертає навігацію
// нижче 1200 px (CAMP-350). Тому тут дві перевірки, і вони різні:
// перша про те, що бачить читач БЕЗ скрипта, друга — про форму, яку
// бачить React.

const CSS =
  "<style>\n" +
  "            header nav[aria-label='Main'] { display: block !important }\n" +
  "            header [data-testid='burger-open'] { display: none !important }\n" +
  '          </style>';

test('сервер віддає той самий CSS, посимвольно', async ({ page }) => {
  const res = await page.context().request.get('/login');
  const html = await res.text();
  const m = /<noscript>([\s\S]*?)<\/noscript>/.exec(html);
  expect(m, 'у виданому HTML немає <noscript>').not.toBeNull();
  // 🔴 Посимвольно, а не «містить»: зайвий пробіл у селекторі зламає
  // правило мовчки, і меню без JS знову зникне.
  expect(m![1]).toBe(CSS);
});

test('браузер розбирає цей вміст ОДНИМ текстовим вузлом', async ({ page }) => {
  await page.goto('/login');
  const shape = await page.evaluate(() => {
    const ns = document.querySelector('noscript');
    return {
      elements: ns?.childElementCount ?? -1,
      nodes: ns?.childNodes.length ?? -1,
      firstType: ns?.childNodes[0]?.nodeType ?? -1,
      text: (ns?.textContent ?? '').trim(),
    };
  });
  // Саме це робить елемент усередині `<noscript>` непридатним: браузер
  // віддає текст, скільки б розмітки там не стояло.
  expect(shape.elements, 'браузер раптом розбирає noscript як розмітку').toBe(0);
  expect(shape.nodes).toBe(1);
  expect(shape.firstType, 'перший вузол не текстовий').toBe(3);
  expect(shape.text).toBe(CSS.trim());
});
