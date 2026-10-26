import { expect, test } from "@playwright/test";
import { applyValues, PAGE_VALUES, type PageView } from "@/lib/page-content";

// CAMP-365 — шлях «дані з CMS → розмітка». Цей файл існує тому, що
// рецензія PR #303 довела: жоден із моїх тодішніх сторожів не ловив
// ЖОДНОГО з трьох дефектів цього шляху.

const page = (over: Partial<PageView> = {}): PageView => ({
  slug: "x",
  title: "Заголовок",
  metaTitle: null,
  metaDescription: null,
  noindex: false,
  sections: [],
  ...over,
});

const withCta = (ctaHref: string | null) =>
  page({
    sections: [
      {
        type: "cta",
        variant: null,
        slot: null,
        heading: null,
        subheading: null,
        body: null,
        imageUrl: null,
        imageAlt: null,
        ctaHref,
        ctaLabel: "Туди",
        items: [],
      },
    ],
  });

test.describe("🔴 адреси з CMS", () => {
  // 🔴 ЗАМІРЯНО РЕЦЕНЗІЄЮ: раніше з десяти входів рендерились УСІ
  // десять, бо `CtaButton` не перевіряв нічого, а правило «що таке
  // внутрішня адреса» було написане вдруге й іншими словами.
  for (const bad of [
    "javascript:alert(1)",
    "vbscript:x",
    "data:text/html,<script>",
    "//evil.example",
    "/\\evil.example",
    "http://insecure.example",
  ]) {
    test(`«${bad}» у cta_href відхиляється`, () => {
      expect(
        () => applyValues(withCta(bad)),
        `адресу «${bad}» пропущено`,
      ).toThrow(/не дозволена/);
    });
  }

  for (const good of [
    "/legal/notice",
    "https://example.org",
    "mailto:a@b.eu",
  ]) {
    test(`«${good}» проходить`, () => {
      expect(() => applyValues(withCta(good))).not.toThrow();
    });
  }

  test("🔴 підстановка в cta_href РОЗГОРТАЄТЬСЯ, а не їде дослівно", () => {
    // Рецензія прибрала цю підстановку мутацією — і всі шість тестів
    // лишились зеленими, бо вони читали посилання з абзацу, а не
    // кнопку, і дивились на видимий текст, а не на атрибут.
    const out = applyValues(withCta("mailto:{{contact.email}}"));
    expect(out.sections[0].ctaHref).toBe(
      `mailto:${PAGE_VALUES["contact.email"]}`,
    );
    expect(out.sections[0].ctaHref).not.toContain("{{");
  });
});

test.describe("🔴 порожнє і відсутнє — одне й те саме", () => {
  // Заміряно рецензією: `meta_title=""` давав ПОРОЖНІЙ <title>, а
  // `null` — запасний. Тобто «стерли в CMS» і «не заповнювали»
  // поводились по-різному, і нічого про це не казало.
  for (const [name, value] of [
    ["порожній рядок", ""],
    ["самі пробіли", "   "],
  ] as const) {
    test(`${name} у meta_title читається як відсутній`, () => {
      expect(applyValues(page({ metaTitle: value })).metaTitle).toBeNull();
    });
  }

  test("непорожній meta_title лишається", () => {
    expect(applyValues(page({ metaTitle: "Свій" })).metaTitle).toBe("Свій");
  });
});
