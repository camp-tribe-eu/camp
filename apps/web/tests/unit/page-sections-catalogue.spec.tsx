import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { renderComponent } from "./render-component";
import {
  FEATURE_ICON_NAMES,
  PageSections,
  SECTION_TYPES,
  featuresOf,
} from "@/components/page-sections";
import type { SectionView } from "@/lib/page-content";
import { sectionsBySlot } from "@/lib/page-layout";
import { normalizePost, type PostSummary } from "@/lib/posts";
import PostCards from "@/components/post-cards";

// CAMP-464 — секції каталогу для /about і /contact.
//
// 🔴 УСЕ ТУТ ЧИТАЄ ВІДДАНИЙ HTML, а не константу чи клас: твердження «секція
// малює значок/фото/відповідь» доводиться рядком у розмітці, яку побачить
// читач.

const section = (over: Partial<SectionView>): SectionView => ({
  type: "prose",
  variant: null,
  slot: null,
  heading: null,
  subheading: null,
  body: null,
  imageUrl: null,
  imageAlt: null,
  ctaHref: null,
  ctaLabel: null,
  items: [],
  ...over,
});

const render = (s: Partial<SectionView>) =>
  renderComponent(PageSections, { sections: [section(s)] });

test.describe("features", () => {
  const items = [
    { icon: "mail", title: "Email", text: "a@b.eu", href: "mailto:a@b.eu" },
    { title: "Plain", text: "No icon, no link" },
  ];

  test("малює назву, текст, значок і лист звичайним якорем", () => {
    const html = render({ type: "features", items });
    expect(html).toContain("Email");
    expect(html).toContain("a@b.eu");
    expect(html).toContain('<a class="ct-feat__link" href="mailto:a@b.eu"');
    expect(html).toContain("<svg"); // значок поштової скриньки
    expect(html).toContain("No icon, no link");
  });

  test("🔴 невідомий значок кидає й називає відомі", () => {
    expect(() =>
      render({ type: "features", items: [{ icon: "emial", title: "x", text: "y" }] }),
    ).toThrow(/значок «emial».*mail/s);
  });

  test("🔴 чужий https у картці кидає: картка веде лише на нас або на лист", () => {
    expect(() =>
      render({
        type: "features",
        items: [{ title: "x", text: "y", href: "https://evil.example" }],
      }),
    ).toThrow(/веде на «https:\/\/evil.example»/);
  });

  test("🔴 порожній рядок у полі — поломка, а не відсутнє поле", () => {
    expect(() => featuresOf([{ title: "x", text: "y", icon: "" }], "t")).toThrow(
      /порожнє або не рядкове «icon»/,
    );
    expect(() => featuresOf([{ title: "x" }], "t")).toThrow(/не має поля «text»/);
    expect(() => featuresOf({ 0: {} }, "t")).toThrow(/не масив/);
  });

  test("підстановка доходить у текст і в адресу картки", () => {
    const html = render({
      type: "features",
      items: [
        {
          title: "Email",
          text: "{{contact.email}}",
          href: "mailto:{{contact.email}}",
        },
      ],
    });
    expect(html).toContain('href="mailto:hello@camptribe.eu"');
    expect(html).not.toContain("{{");
  });

  test("кожне ім'я значка справді малює svg", () => {
    for (const icon of FEATURE_ICON_NAMES) {
      expect(
        render({ type: "features", items: [{ icon, title: "t", text: "x" }] }),
        icon,
      ).toContain("<svg");
    }
  });
});

test.describe("image-with-text", () => {
  const base = {
    type: "image-with-text",
    imageUrl: "/banners/lake.webp",
    imageAlt: "A lake",
    subheading: "Caption here",
    heading: "Big heading",
    body: "First para.\n\nSecond [link](/legal/notice).",
  };

  test("малює фото, надзаголовок, заголовок і обидва абзаци", () => {
    const html = render(base);
    expect(html).toContain('src="/banners/lake.webp"');
    expect(html).toContain('alt="A lake"');
    expect(html).toContain("Caption here");
    expect(html).toMatch(/<h2 class="ct-iwt__heading">Big heading<\/h2>/);
    expect(html).toContain("First para.");
    expect(html).toContain('href="/legal/notice"');
  });

  test("🔴 абзаци не вкладені в `<p>`: обгортка тексту — div", () => {
    const html = render(base);
    expect(html).toContain('<div class="ct-iwt__text">');
    expect(html).not.toMatch(/<p class="ct-iwt__text">/);
  });

  test("variant image-right ставить фото праворуч, типово — ліворуч", () => {
    // Клас дивимось в атрибуті, а не в тексті: рядок із CSS секції теж
    // містить `ct-iwt--reverse`.
    const cls = (h: string) => /<section class="([^"]*)"/.exec(h)?.[1] ?? "";
    expect(cls(render({ ...base, variant: "image-right" }))).toContain("ct-iwt--reverse");
    expect(cls(render(base))).not.toContain("ct-iwt--reverse");
  });

  test("🔴 чуже фото, відсутнє фото й відсутній заголовок кидають", () => {
    expect(() => render({ ...base, imageUrl: "https://x.example/a.jpg" })).toThrow(
      /не наш шлях/,
    );
    expect(() => render({ ...base, imageUrl: null })).toThrow(/не наш шлях/);
    expect(() => render({ ...base, heading: null })).toThrow(/без заголовка/);
  });
});

test.describe("faq і card", () => {
  test("faq: питання й відповіді лежать у відданому HTML (details без JS)", () => {
    const html = render({
      type: "faq",
      heading: "Quick",
      items: [
        { term: "Q one?", text: "Answer one." },
        { term: "Q two?", text: "Answer two." },
      ],
    });
    expect((html.match(/<details/g) ?? []).length).toBe(2);
    expect(html).toContain("Q one?");
    expect(html).toContain("Answer two.");
  });

  test("🔴 faq: питання без відповіді кидає", () => {
    expect(() =>
      render({ type: "faq", items: [{ term: "Q?", text: "" }] }),
    ).toThrow(/не має поля «text»/);
  });

  test("card: заголовок, текст і кнопка-лист", () => {
    const html = render({
      type: "card",
      heading: "Before you write",
      body: "Some **bold** words.",
      // Підстановка в `cta_href` робиться в `applyValues`, не тут: її
      // доводить e2e контактів на відданій сторінці.
      ctaHref: "mailto:a@b.eu",
      ctaLabel: "Email us",
    });
    expect(html).toContain("Before you write");
    expect(html).toContain("<strong");
    expect(html).toMatch(/data-ct-button="primary"/);
    expect(html).toContain('href="mailto:a@b.eu"');
  });
});

test("🔴 перелік типів у коді збігається з вибором у Directus", () => {
  // Інакше редактор не зможе обрати тип, який код уміє малювати, або обере
  // такий, якого код не знає (секція зникне зі сторінки).
  const cfg = readFileSync(
    join(__dirname, "..", "..", "..", "cms", "configure.mjs"),
    "utf8",
  );
  // Береться блок ПОЛЯ `type` колекції `page_sections` у FIELD_META, а не
  // перше входження імені колекції: воно стоїть ще й у списках колекцій.
  const meta = cfg.indexOf("const FIELD_META");
  const from = cfg.indexOf("page_sections: {", meta);
  const block = cfg.slice(from, cfg.indexOf("visible:", from));
  expect(block.length, "блок типів не знайдено").toBeGreaterThan(100);
  const offered = [...block.matchAll(/value: '([a-z-]+)'/g)].map((m) => m[1]);
  expect(offered.sort()).toEqual([...SECTION_TYPES].sort());
});

test.describe("sectionsBySlot", () => {
  const s = (slot: string | null, type = "prose") => section({ slot, type });

  test("розкладає по місцях, решта — без місця", () => {
    const r = sectionsBySlot([s("intro"), s(null), s("aside", "card")], ["intro", "aside"], "t");
    expect(r.bySlot.intro).toHaveLength(1);
    expect(r.bySlot.aside[0].type).toBe("card");
    expect(r.rest).toHaveLength(1);
  });

  test("🔴 невідоме місце кидає, а не губить секцію", () => {
    expect(() => sectionsBySlot([s("sidebar")], ["intro"], "/contact")).toThrow(
      /«sidebar».*Відомі: intro/s,
    );
  });
});

test.describe("normalizePost: один зіпсований запис — один запис", () => {
  const post = (over: Partial<PostSummary>): PostSummary => ({
    slug: "a",
    title: "A",
    summary: null,
    publishedAt: "2026-01-01T00:00:00Z",
    authorName: null,
    coverUrl: "/banners/lake.webp",
    coverAlt: "Lake",
    tags: ["One", "Two"],
    ...over,
  });

  test("справний запис лишається як є", () => {
    expect(normalizePost(post({}))).toEqual(post({}));
  });

  test("🔴 чужа адреса обкладинки → без обкладинки й без її alt", () => {
    for (const bad of ["https://x.example/a.jpg", "javascript:alert(1)", "//x.example/a.jpg", ""]) {
      const n = normalizePost(post({ coverUrl: bad }));
      expect(n.coverUrl, bad).toBeNull();
      expect(n.coverAlt, bad).toBeNull();
    }
  });

  test("🔴 теги не-масив або з не-рядками не валять запис", () => {
    expect(normalizePost(post({ tags: { 0: "x" } as unknown as string[] })).tags).toEqual([]);
    expect(normalizePost(post({ tags: ["ok", 5, "", "  "] as unknown as string[] })).tags).toEqual(["ok"]);
  });
});

test.describe("теги на картці", () => {
  const html = (tags?: string[]) =>
    renderComponent(PostCards, {
      items: [{ key: "a", href: "/blog/a", title: "T", image: { src: "/banners/lake.webp", alt: "x" }, tags }],
    });

  test("теги стоять у відданому HTML і ПОЗА посиланням під aria-hidden", () => {
    const out = html(["Rules", "Costs"]);
    expect(out).toContain(">Rules<");
    expect(out).toContain(">Costs<");
    const link = out.slice(out.indexOf("<a"), out.indexOf("</a>"));
    expect(link).not.toContain("Rules");
  });

  test("без тегів немає й списку", () => {
    // `data-testid`, а не клас: клас є й у рядку CSS, що їде з секцією.
    expect(html()).not.toContain('data-testid="post-tags"');
    expect(html([])).not.toContain('data-testid="post-tags"');
    expect(html(["x"])).toContain('data-testid="post-tags"');
  });
});
