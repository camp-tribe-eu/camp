import { expect, test } from "@playwright/test";
import { readingMinutes, visibleWords } from "@/lib/posts";
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
      { subheading: words(300) },
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

  test("у посиланні читається підпис, а не адреса", () => {
    expect(
      visibleWords([
        section({ body: "[alpha beta](/camping/france?page=2&sort=rating)" }),
      ]),
    ).toBe(2);
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
