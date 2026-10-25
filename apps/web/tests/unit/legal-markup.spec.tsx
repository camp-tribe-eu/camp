import { expect, test } from "@playwright/test";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";
import { LegalProse } from "@/components/legal-prose";
import { PAGE_VALUES } from "@/lib/page-content";
import { SEEDED, seededBody } from "./legal-cms";

// 🔴 CAMP-365 — РОЗМІТКА НЕСЕ ПРАВОВІ ДОКУМЕНТИ БЕЗ ВТРАТ.
//
// Картка називає це пасткою номер один: «будь-яка втрата слова — це
// неправда в юридичному документі. Звіряти посимвольно, а не оком».
//
// 🔴 ЩО ЦЕЙ ФАЙЛ ДОВОДИТЬ, А ЩО НІ. Раніше тут стояло порівняння двох
// рендерів: компонента JSX, який малював сторінку, і розмітки. Компонентів
// більше немає — вони видалені в тому самому PR, який перемкнув сторінку
// на базу, і порівнювати нема з чим. Дослівна рівність ТОДІШНЬОГО рендеру
// і нинішнього доведена на збірці (до і після, усі сім сторінок), а не
// цим тестом.
//
// Лишається те, що можна довести й без другого боку: ЗАКОН ЗБЕРЕЖЕННЯ.
// Рендер не може ні загубити, ні вигадати текст, посилання чи якір, яких
// не було в розмітці. Очікування виводяться з САМОЇ розмітки окремим,
// написаним руками розбором — не з `parseBlocks`, бо порівнювати розбірник
// із собою означало б довести, що він збігається з власним виходом.
//
// 🔴 КОРПУС — ТЕКСТ ІЗ МІГРАЦІЇ (`legal-cms.ts`), тобто те, що лежить у базі
// після засівання. Правка в CMS цим тестам невидима.

/**
 * Видимий текст розмітки, виведений без розбірника.
 *
 * Правила грамматики (див. `lib/rich-text.ts`) переписані тут окремо: якби
 * я викликав `parseBlocks`, закон збереження перевіряв би розбір самим
 * розбором.
 */
function plainOf(markup: string): string {
  return markup
    .replace(/\{\{([a-z0-9_.]+)\}\}/gi, (_, k: string) => {
      const v = PAGE_VALUES[k];
      if (v === undefined) throw new Error(`немає значення для {{${k}}}`);
      return v;
    })
    .replace(/^(#{2,3}) (.*?)(?:\s*\{#[a-z0-9][a-z0-9-]*\})?\s*$/gm, "$2")
    .replace(/^>\s?/gm, "")
    .replace(/^-\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\\([*[\]\\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Якорі, які розмітка обіцяє: `## Назва {#id}` і `### Назва {#id}`. */
const anchorsOf = (markup: string): string[] =>
  [...markup.matchAll(/^#{2,3} .*\{#([a-z0-9][a-z0-9-]*)\}\s*$/gm)].map(
    (m) => m[1],
  );

/** Посилання розмітки в порядку появи, з підстановками. */
const linksOf = (markup: string): string[] =>
  [
    ...markup
      .replace(/\{\{([a-z0-9_.]+)\}\}/gi, (_, k: string) => PAGE_VALUES[k])
      .matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g),
  ].map((m) => m[2]);

const htmlLinks = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );
const htmlIds = (html: string): string[] =>
  [...html.matchAll(/<h[23]\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);

const blocksOf = (markup: string): string[] =>
  markup.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

const htmlOf = (slug: string) =>
  renderComponent(LegalProse, { text: seededBody(slug) });

test.describe("🔴 CAMP-365 — розмітка несе правові сторінки без втрат", () => {
  // 🔴 ПЕРЕЛІК БЕРЕТЬСЯ З МІГРАЦІЇ, А НЕ ВПИСАНИЙ. Восьмий документ,
  // доданий туди, потрапляє в усі випадки нижче без правки цього файла.
  for (const { slug } of SEEDED) {
    test(`${slug}: видимий текст дорівнює тексту розмітки без службових знаків`, () => {
      const want = plainOf(seededBody(slug));
      const got = visibleText(htmlOf(slug));
      // Довжини першими: розбіжність у 9000 символів без них нечитабельна.
      expect(
        got.length,
        `${slug}: розмітка дає ${want.length} символів, сторінка ${got.length}`,
      ).toBe(want.length);
      expect(got).toBe(want);
    });

    test(`${slug}: кожен якір розмітки є в сторінці рівно раз, і нічого зайвого`, () => {
      expect(htmlIds(htmlOf(slug))).toEqual(anchorsOf(seededBody(slug)));
    });

    test(`${slug}: посилання ті самі, в тому самому порядку`, () => {
      expect(htmlLinks(htmlOf(slug))).toEqual(linksOf(seededBody(slug)));
    });

    // 🔴 РАМКИ Й СПИСКИ — ОКРЕМО, бо їх не бачить жодне порівняння тексту:
    // рамка, що стала абзацом, і список, що злився в речення, мають той
    // самий видимий текст. Рецензія #309 довела це на рамці про ODbL.
    test(`${slug}: рамок і списків стільки, скільки в розмітці`, () => {
      const markup = seededBody(slug);
      const html = htmlOf(slug);
      const callouts = blocksOf(markup).filter((b) => b.startsWith("> "));
      const lists = blocksOf(markup).filter((b) => b.startsWith("- "));
      const items = lists.reduce((n, b) => n + b.split("\n").length, 0);

      expect((html.match(/accent-surface/g) ?? []).length).toBe(callouts.length);
      expect((html.match(/<ul\b/g) ?? []).length).toBe(lists.length);
      expect((html.match(/<li\b/g) ?? []).length).toBe(items);
      // Рамка з кількох абзаців: розрив між ними — `<br><br>`, і його
      // кількість теж закон. Саме його втрата зливала три умови ODbL в
      // одну стіну тексту при всіх зелених випадках.
      const breaks = callouts.reduce(
        (n, b) =>
          n +
          Math.max(
            0,
            b.split("\n").filter((l) => /^>\s*$/.test(l)).length,
          ),
        0,
      );
      expect((html.match(/<br\s*\/?>/g) ?? []).length).toBe(breaks * 2);
    });
  }

  // 🔴 ВИДІЛЕННЯ — ТЕЖ ЗМІСТ, І ЙОГО НЕ БАЧИТЬ ЖОДНЕ ПОРІВНЯННЯ ТЕКСТУ.
  // `*from*` у «something produced *from* the data» протиставляє похідний
  // твір адаптованій базі — саме там, де ODbL вимагає різного; курсив, що
  // став звичайним текстом, зрівняв би два юридичні наслідки при
  // побуквено однаковому тексті.
  for (const { slug } of SEEDED) {
    test(`${slug}: жирного й курсиву стільки, скільки в розмітці`, () => {
      const markup = seededBody(slug);
      const html = htmlOf(slug);
      const bold = [...markup.matchAll(/\*\*([^*]+)\*\*/g)].length;
      const italic = [
        ...markup.replace(/\*\*([^*]+)\*\*/g, "").matchAll(/\*([^*]+)\*/g),
      ].length;
      expect((html.match(/<strong\b/g) ?? []).length).toBe(bold);
      expect((html.match(/<i\b|<em\b/g) ?? []).length).toBe(italic);
    });
  }

  // 🔴 Пара до всього вище: закон збереження істинний і над порожнечею.
  // Документи мусять бути НЕ порожні, і то суттєво.
  test("жоден документ не порожній", () => {
    expect(SEEDED.length).toBeGreaterThan(0);
    for (const { slug } of SEEDED) {
      expect(visibleText(htmlOf(slug)).length, `${slug} порожній`).toBeGreaterThan(
        1000,
      );
    }
  });

  // 🔴 І сам розбір очікувань мусить уміти знаходити: якщо він нічого не
  // бачить, усі порівняння вище — порівняння порожнього з порожнім.
  test("очікування справді щось знаходять у розмітці", () => {
    const terms = seededBody("terms");
    expect(anchorsOf(terms).length).toBeGreaterThan(5);
    expect(linksOf(terms).length).toBeGreaterThan(3);
    expect(blocksOf(terms).filter((b) => b.startsWith("> ")).length).toBeGreaterThan(0);
    expect(plainOf(terms).length).toBeGreaterThan(3000);
    // Закон про виділення теж мусить бачити виділене: серед семи документів
    // є і жирне, і курсив (одне місце в attribution).
    const all = SEEDED.map((d) => d.body).join("\n");
    expect([...all.matchAll(/\*\*([^*]+)\*\*/g)].length).toBeGreaterThan(10);
    expect(
      [...all.replace(/\*\*([^*]+)\*\*/g, "").matchAll(/\*([^*]+)\*/g)].length,
    ).toBeGreaterThan(0);
  });
});

// 🔴 D3 З РЕЦЕНЗІЇ #309: ЯКІР НА `###` ЗНИКАВ МОВЧКИ.
//
// Розбірник приймає `{#anchor}` на підзаголовку так само, як на
// заголовку, і `assertUniqueAnchors` це імʼя ЗАЙМАЄ — тобто повтор
// відхиляється. А рендер викидав його без жодного сигналу: редактор
// CMS написав би якір, отримав заборону на повтор, і дістав посилання
// в нікуди. Живих випадків нуль (14 підзаголовків, жоден без якоря) —
// саме тому це й пастка: спрацює на першому, хто спробує.
test.describe("🔴 якір на підзаголовку", () => {
  test("`###` із якорем віддає id, а не ковтає його", () => {
    const html = renderComponent(LegalProse, {
      text: "## A {#a}\n\n### B {#sub}\n\nText.\n",
    });
    expect(html, "якір підзаголовка зник із розмітки").toContain('id="sub"');
    expect(html).toContain('id="a"');
  });

  // 🔴 ТВЕРДЖЕННЯ ПРО АТРИБУТ, А НЕ ПРО ВМІСТ. Перша редакція шукала
  // `<h3…>B</h3>` і падала, бо рендер обгортає текст у `<span>`: шаблон
  // описував розмітку, якої ніхто не обіцяв. Питання тут одне — чи
  // стоїть `id` там, де якоря не просили.
  test("підзаголовок без якоря лишається без id", () => {
    const html = renderComponent(LegalProse, {
      text: "## A {#a}\n\n### B\n\nText.\n",
    });
    const h3 = /<h3[^>]*>/.exec(html)?.[0] ?? "";
    expect(h3, "підзаголовка взагалі немає в розмітці").not.toBe("");
    expect(h3, "id зʼявився там, де якоря не просили").not.toContain("id=");
  });
});
