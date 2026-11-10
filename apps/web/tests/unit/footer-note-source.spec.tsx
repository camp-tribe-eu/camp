import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { SiteFooter } from "@/components/site-chrome";
import { renderComponent } from "./render-component";

/**
 * CAMP-481 — речення в підвалі приходить із CMS, а не з коду.
 *
 * 🔴 ЦЕЙ ФАЙЛ ІСНУЄ ТОМУ, ЩО E2E ТУТ НЕ ДОВОДИТЬ НІЧОГО.
 *
 * Тест «підвал містить те саме, що віддав API» виглядає переконливо і
 * лишається ЗЕЛЕНИМ, якщо хтось поверне речення в код дослівно: на
 * сторінці буде потрібний текст, API віддасть той самий текст, збіг
 * зійдеться. Перевіряється наявність слів, а питання стоїть про
 * ДЖЕРЕЛО слів — а джерело по готовому HTML не відрізнити.
 *
 * Тому доказ розділений на два, і кожен міряє своє:
 *   1. компонент малює те, що йому ДАЛИ, і нічого свого;
 *   2. речення фізично відсутнє у вихідному коді вебу.
 *
 * Другий і є той, що червоніє від повернення хардкоду.
 */

const SENTENCE_HEAD = "Campsites across the EU-27";

const SRC = join(process.cwd(), "src");

/** Усі `.ts`/`.tsx` під `src`, крім згенерованих. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...sources(p));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

test("підвал малює те речення, яке йому дали", async () => {
  const html = await renderComponent(SiteFooter, {
    nav: [],
    footerNote: "Речення, якого немає в коді жодного разу.",
  });
  expect(html).toContain("Речення, якого немає в коді жодного разу.");
});

test("без речення підвал живий, але абзацу немає", async () => {
  const html = await renderComponent(SiteFooter, { nav: [], footerNote: null });

  // Підвал лишається підвалом: назва на місці.
  expect(
    html,
    "Відсутній підпис не має прибирати підвал — лише абзац під назвою.",
  ).toContain("CampTribe");

  expect(
    html,
    "Порожній абзац читається як поломка верстки, а не як порожнеча, " +
      "тому його не має бути зовсім.",
  ).not.toContain(SENTENCE_HEAD);
});

test("речення підвалу не лежить у коді жодного файла", () => {
  const files = sources(SRC);
  const guilty = files.filter((f) =>
    readFileSync(f, "utf8").includes(SENTENCE_HEAD),
  );

  // 🔴 ЗНАМЕННИК ДРУКУЄТЬСЯ. «Нуль знахідок» нічого не вартий, якщо
  // перелік файлів виявиться порожнім через помилку в обході теки.
  expect(
    files.length,
    "Обхід `src` не знайшов жодного файла — тоді й нуль знахідок нижче " +
      "нічого не доводить.",
  ).toBeGreaterThan(200);

  expect(
    guilty.map((f) => f.replace(SRC, "src")),
    `Переглянуто ${files.length} файлів. Речення підвалу мусить жити в ` +
      `CMS: власник міняє його сам, без розробника. Файл у цьому ` +
      `переліку означає, що копія повернулась у код — і тоді e2е, який ` +
      `звіряє сторінку з API, лишиться зеленим, бо слова збігатимуться.`,
  ).toEqual([]);
});
