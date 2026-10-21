import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COUNTED_SECTION_FIELDS,
  readingMinutes,
  visibleWords,
} from "@/lib/posts";
import type { SectionView } from "@/lib/page-content";

// CAMP-364 — час читання.
//
// 🔴 ЦЕЙ НАБІР НАВМИСНО НЕ ПЕРЕКАЗУЄ ОЗНАЧЕННЯ. `expect(minutes)
// .toBe(Math.ceil(words / 200))` було б зелене й тоді, коли функція
// рахує не ті слова — бо обидві сторони рівності рахували б їх
// однаково. Тому нижче перевіряються ВЛАСТИВОСТІ, яких хибна
// реалізація задовольнити не може: що саме входить у лічбу, що з неї
// випадає, і де проходить межа.

function section(over: Partial<SectionView> = {}): SectionView {
  return {
    type: "text",
    variant: null,
    heading: null,
    subheading: null,
    body: null,
    imageUrl: null,
    imageAlt: null,
    ctaHref: null,
    ctaLabel: null,
    items: null,
    ...over,
  };
}

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

test.describe("час читання", () => {
  test("порожній допис це 1 хв, а не 0", () => {
    expect(readingMinutes([])).toBe(1);
    expect(readingMinutes([section({ body: "  " })])).toBe(1);
  });

  test("межа 200/201 слова", () => {
    expect(readingMinutes([section({ body: words(200) })])).toBe(1);
    expect(readingMinutes([section({ body: words(201) })])).toBe(2);
  });

  // 🔴 Головна властивість: текст лежить у ЧОТИРЬОХ полях, і пропуск
  // будь-якого з них дає «1 хв» на довгому дописі.
  test("лічаться всі чотири місця, де живе текст", () => {
    const parts: Array<Partial<SectionView>> = [
      { heading: words(300) },
      { ctaLabel: words(300) },
      { body: words(300) },
      { items: [{ text: words(300) }] },
    ];
    for (const p of parts) {
      expect(visibleWords([section(p)]), JSON.stringify(Object.keys(p))).toBe(
        300,
      );
    }
    expect(visibleWords([section(Object.assign({}, ...parts))])).toBe(1200);
  });

  test("вкладені items теж читаються", () => {
    const nested = { groups: [{ rows: [{ label: words(50) }] }] };
    expect(visibleWords([section({ items: nested })])).toBe(50);
  });

  test("розмітка не є словами", () => {
    const plain = visibleWords([section({ body: "alpha beta gamma" })]);
    expect(
      visibleWords([section({ body: "**alpha** *beta* `gamma`" })]),
    ).toBe(plain);
    expect(visibleWords([section({ body: "- alpha\n- beta\n- gamma" })])).toBe(
      plain,
    );
    expect(visibleWords([section({ body: "> alpha beta gamma" })])).toBe(plain);
  });

  // 🔴 ЦЕЙ ТЕСТ РАНІШЕ НАЗИВАВСЯ «у посиланні читається підпис, а не
  // адреса» — і це була неправда про реалізацію. Заміряно рецензією
  // #311: `[alpha beta](/a/b)` дає дві лексеми за БУДЬ-ЯКОЇ
  // реалізації, бо в адресі немає пробілу. Зеленим його робила
  // токенізація, а не виключення адрес, тож на цій властивості він
  // почервоніти не міг.
  //
  // Нижче — те, що реалізація СПРАВДІ обіцяє: довга адреса не роздуває
  // лічбу, бо це одна лексема, скільки б сегментів у ній не було.
  test("довга адреса це одна лексема, а не десять", () => {
    const short = visibleWords([section({ body: "see https://a.io/x" })]);
    const long = visibleWords([
      section({
        body: "see https://example.com/camping/france/provence/verdon?page=2&sort=rating",
      }),
    ]);
    expect(short).toBe(2);
    expect(long, "сегменти адреси порахувались як окремі слова").toBe(short);
  });

  // 🔴 D2 З РЕЦЕНЗІЇ: половина предиката слова не була покрита. Мутація
  // `\p{L}|\p{N}` → `\p{L}` лишала всі 33 випадки зеленими, бо кожне
  // слово у фікстурах було літеральним «word». А наша проза числова:
  // «48 970», «27», «2026».
  test("суто числові лексеми це теж слова", () => {
    expect(visibleWords([section({ body: "48970 27 2026" })])).toBe(3);
    expect(visibleWords([section({ body: "alpha 2026 beta" })])).toBe(3);
  });

  // 🔴 D3 З РЕЦЕНЗІЇ: перелік полів звіряється з КОДОМ РЕНДЕРА, а не з
  // моєю памʼяттю. Перша редакція лічила `subheading`, якого не читає
  // жоден рендер, і не лічила `ctaLabel`, який читає `page-sections`.
  test("лічаться рівно ті поля, які малює page-sections.tsx", () => {
    // `__dirname`, а не `import.meta.url`: набір unit збирається в CJS,
    // і `import.meta` там взагалі не компілюється. Так само читає
    // чужий код `account.spec.ts:331`.
    const renderer = readFileSync(
      join(__dirname, "../../src/components/page-sections.tsx"),
      "utf8",
    );
    for (const f of COUNTED_SECTION_FIELDS) {
      expect(
        new RegExp(`\\.${f}\\b`).test(renderer),
        `лічимо «${f}», але page-sections.tsx його не малює`,
      ).toBe(true);
    }
    expect(
      /\.subheading\b/.test(renderer),
      "subheading почали малювати — його треба додати в лічбу",
    ).toBe(false);
  });

  test("адреса й іконка в items не є текстом", () => {
    expect(
      visibleWords([
        section({
          items: [
            { text: "alpha", href: "/camping/france", icon: "tent" },
            { text: "beta", url: "https://example.com/a/b/c" },
          ],
        }),
      ]),
    ).toBe(2);
  });

  test("секції складаються, а не замінюють одна одну", () => {
    const one = section({ body: words(150) });
    expect(readingMinutes([one])).toBe(1);
    expect(readingMinutes([one, one])).toBe(2);
  });
});
