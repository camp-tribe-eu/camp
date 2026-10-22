import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// CAMP-383 — сторож на ФОРМУ, бо вивід однаковий.
//
// 🔴 ЧОМУ ЦЕ ЧИТАЄ КОД, А НЕ РЕНДЕР. `<noscript><style>…</style>` і
// `<noscript dangerouslySetInnerHTML>` дають БАЙТ У БАЙТ той самий
// HTML. Різниця існує лише в дереві, яке React тримає для гідратації:
// у першому випадку там елемент, а браузер при увімкненому скрипті
// бачить текст — і це була помилка #418, що мигтіла в CI на кожній
// сторінці.
//
// Отже жоден тест на вивід відкату не спіймає. Тому тут читається сам
// конструкт.

const RAW = readFileSync(
  join(__dirname, "..", "..", "src", "components", "site-chrome.tsx"),
  "utf8",
);

/**
 * 🔴 КОМЕНТАРІ ЗНЯТО, І ЦЕ НЕ ОХАЙНІСТЬ. Перша редакція цього сторожа
 * ловила згадку `<noscript>` у докблоці поруч — тобто читала розповідь
 * про код замість коду. Те саме правило я вже записував і знову
 * порушив, тож тепер воно виконується механічно.
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// 🔴 І ПЕРШИЙ МІЙ ШАБЛОН ЧИТАВ КОМЕНТАР. Він брав перший `<noscript`
// у файлі, а це була ЗГАДКА в докблоці поруч. Сторож на текст мусить
// читати код, а не розповідь про нього — правило, яке я вже записував
// і знову порушив. Тепер шукається сам конструкт.
test.describe("noscript у каркасі", () => {
  test("вміст віддається рядком, а не елементом", () => {
    expect(
      /<noscript\s+dangerouslySetInnerHTML/.test(SRC),
      "вміст <noscript> більше не віддається рядком — це повертає #418",
    ).toBe(true);
    expect(
      /<noscript\s*>\s*\{?\s*<style/.test(SRC),
      "усередині <noscript> знову стоїть елемент <style>",
    ).toBe(false);
  });

  test("правила, без яких навігація без JS зникає, лишились на місці", () => {
    for (const rule of [
      "header nav[aria-label='Main'] { display: block !important }",
      "header [data-testid='burger-open'] { display: none !important }",
    ]) {
      expect(SRC.includes(rule), `правило зникло: ${rule}`).toBe(true);
    }
  });
});
