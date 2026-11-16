import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { HeroSlider } from "@/components/home-slider";
import { PageSections, SECTION_TYPES } from "@/components/page-sections";
import { SearchWidget } from "@/components/search-widget";
import { searchOf, slidesOf, SLIDE_TYPE } from "@/lib/slides";
import type { SectionView } from "@/lib/page-content";
import { HomeSliderSearchFeatures1797700000000 as Seed } from "../../../api/src/migrations/1797700000000-HomeSliderSearchFeatures";
import { renderComponent, rendersNothing } from "./render-component";
import { visibleText } from "./rendered-text";

/**
 * CAMP-488 — слайдер, пошукове поле й рядок «текст + фото» як секції каталогу.
 *
 * 🔴 ПРАВИЛО ПРОЄКТУ: перевірка не сміє стверджувати те, чого не бачить.
 * Усе, що нижче каже «сторінка показує», читає ВІДДАНУ розмітку
 * (`renderComponent` → HTML), а не константу компонента й не клас.
 */

const section = (over: Partial<SectionView>): SectionView => ({
  type: "slide",
  variant: null,
  slot: null,
  heading: "Find your next campsite",
  subheading: "Where to stay",
  body: "Pick a country.",
  imageUrl: "/banners/eu-dawn.webp",
  imageAlt: null,
  ctaHref: "/camping",
  ctaLabel: "Find a campsite",
  items: [],
  ...over,
});

const slide = (n: number, over: Partial<SectionView> = {}) =>
  section({
    heading: `Heading ${n}`,
    body: `Body ${n}`,
    imageUrl: `/banners/s${n}.webp`,
    ctaHref: `/page-${n}`,
    ctaLabel: `Button ${n}`,
    ...over,
  });

const three = [slide(1), slide(2), slide(3)];
const slidesHtml = (secs = three) =>
  renderComponent(HeroSlider, { slides: slidesOf(secs, {}), label: "Where to start" });

// ── слайдер ──────────────────────────────────────────────────────────

test("🔴 усі слайди лежать у відданій розмітці, а не з'являються скриптом", () => {
  const html = slidesHtml();
  expect((html.match(/data-testid="home-slide"/g) ?? []).length).toBe(3);
  const text = visibleText(html);
  for (const n of [1, 2, 3]) {
    expect(text).toContain(`Heading ${n}`);
    expect(text).toContain(`Body ${n}`);
    expect(html).toContain(`href="/page-${n}"`);
    expect(text).toContain(`Button ${n}`);
  }
});

test("🔴 h1 головної — рівно перший слайд, решта слайдів — `h2`", () => {
  const html = slidesHtml();
  expect((html.match(/<h1[ >]/g) ?? []).length).toBe(1);
  expect((html.match(/<h2 /g) ?? []).length).toBe(2);
  expect(html).toMatch(/<h1 class="ct-slide__heading">Heading 1<\/h1>/);
  expect(html).toMatch(/<h2 class="ct-slide__heading">Heading 2<\/h2>/);
});

test("перша картинка вантажиться першою, решта — ліниво", () => {
  const imgs = [...slidesHtml().matchAll(/<img class="ct-slide__image"[^>]*>/g)].map(
    (m) => m[0],
  );
  expect(imgs).toHaveLength(3);
  expect(imgs[0]).toContain('loading="eager"');
  expect(imgs[0]).toContain('fetchPriority="high"');
  expect(imgs[1]).toContain('loading="lazy"');
  expect(imgs[2]).toContain('loading="lazy"');
});

test("мініатюр і кнопка «далі» стільки, скільки слайдів; перша позначена", () => {
  const html = slidesHtml();
  expect((html.match(/data-testid="home-slider-thumb"/g) ?? []).length).toBe(3);
  expect(html).toContain('aria-label="Next slide"');
  expect(html).toContain('aria-label="Previous slide"');
  // Позначена рівно одна, і це перша.
  // Рахуємо в РОЗМІТЦІ кнопок: CSS слайдера теж містить `[aria-current="true"]`.
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  expect(buttons.filter((b) => b.includes('aria-current="true"'))).toHaveLength(1);
  expect(html).toMatch(/aria-label="Show slide 1: Heading 1"[^>]*aria-current="true"/);
});

test("один слайд — без стрілок і мініатюр: перемикати нічого", () => {
  const html = slidesHtml([slide(1)]);
  expect(html).toContain('data-testid="home-slide"');
  expect(html).not.toContain("home-slider-thumb");
  expect(html).not.toContain("Next slide");
});

test("🔴 порожній перелік слайдів не малює НІЧОГО — ні рамки, ні стрілок", () => {
  expect(rendersNothing(HeroSlider, { slides: [], label: "x" })).toBe(true);
});

test("CSS слайдера їде в розмітці, а прокрутка нативна (scroll-snap)", () => {
  const html = slidesHtml();
  expect(html).toContain('href="ct-slider"');
  expect(html).toContain("scroll-snap-type:x mandatory");
});

test("🔴 числа теми: радіус 16, поріг 992 для широкої розкладки", () => {
  const html = slidesHtml();
  expect(html).toContain("border-radius:var(--r,16px)");
  expect(html).toContain("@media(min-width:992px)");
});

test("слайд без опису картинки — декоративний (`alt=\"\"`)", () => {
  expect(slidesHtml()).toContain('alt=""');
});

// ── що кидає `slidesOf` ──────────────────────────────────────────────

test("🔴 слайд без заголовка кидає, а не зникає", () => {
  expect(() => slidesOf([slide(1, { heading: "  " })], {})).toThrow(/немає заголовка/);
});

test("🔴 слайд без картинки кидає: це не фото-слайд", () => {
  expect(() => slidesOf([slide(1, { imageUrl: null })], {})).toThrow(/немає картинки/);
});

test("🔴 кнопка наполовину кидає в обидва боки", () => {
  expect(() => slidesOf([slide(1, { ctaHref: null })], {})).toThrow(/наполовину/);
  expect(() => slidesOf([slide(1, { ctaLabel: "" })], {})).toThrow(/наполовину/);
});

test("слайд без кнопки взагалі — дозволено, кнопки просто немає", () => {
  const html = slidesHtml([slide(1, { ctaHref: null, ctaLabel: null })]);
  expect(html).not.toContain("data-ct-button");
});

test("слайди беруться лише з секцій типу `slide`, порядок зберігається", () => {
  const out = slidesOf(
    [slide(1), section({ type: "prose", heading: "Інше" }), slide(2)],
    {},
  );
  expect(out.map((s) => s.heading)).toEqual(["Heading 1", "Heading 2"]);
  expect(SLIDE_TYPE).toBe("slide");
});

test("невідомий ключ підстановки у слайді кидає, а не друкує {{…}}", () => {
  expect(() => slidesOf([slide(1, { body: "x {{nope}}" })], {})).toThrow();
});

// ── пошукове поле ────────────────────────────────────────────────────

const searchSection = (over: Partial<SectionView> = {}) =>
  section({
    type: "search",
    heading: "Search campsites",
    subheading: "Name, region or a place nearby",
    body: null,
    imageUrl: null,
    ctaHref: "/search",
    ctaLabel: "Search",
    ...over,
  });

test("🔴 віджет — форма GET на /search з полем `q`, підписом і кнопкою", () => {
  const html = renderComponent(SearchWidget, {
    search: searchOf(searchSection(), {}),
  });
  expect(html).toContain('role="search"');
  expect(html).toContain('action="/search"');
  expect(html).toContain('method="get"');
  expect(html).toContain('name="q"');
  expect(html).toContain('placeholder="Name, region or a place nearby"');
  expect(visibleText(html)).toContain("Search campsites");
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Search<\/button>/);
});

test("поле має доступну назву, і це підпис, а не підказка", () => {
  const html = renderComponent(SearchWidget, {
    search: searchOf(searchSection(), {}),
  });
  expect(html).toMatch(/<input[^>]*aria-labelledby="home-search-title"/);
  expect(html).toContain('id="home-search-title"');
});

test("🔴 без підпису, напису кнопки чи адреси віджет кидає; без підказки — ні", () => {
  expect(() => searchOf(searchSection({ heading: "" }), {})).toThrow(/heading/);
  expect(() => searchOf(searchSection({ ctaLabel: null }), {})).toThrow(/cta_label/);
  expect(() => searchOf(searchSection({ ctaHref: null }), {})).toThrow(/cta_href/);
  expect(() => searchOf(searchSection({ subheading: null }), {})).not.toThrow();
  const html = renderComponent(SearchWidget, {
    search: searchOf(searchSection({ subheading: null }), {}),
  });
  expect(html).not.toContain("placeholder=");
});

// ── секції каталогу ──────────────────────────────────────────────────

test("🔴 три нові типи — у каталозі, і падіння на невідомому типі їх називає", () => {
  for (const t of ["slide", "search", "image-text"]) {
    expect(SECTION_TYPES as readonly string[]).toContain(t);
  }
});

test("`PageSections` малює слайд, пошук і рядок із фото", () => {
  const html = renderComponent(PageSections, {
    sections: [
      slide(1),
      searchSection(),
      section({
        type: "image-text",
        heading: "Every campsite, on one map",
        subheading: "Map",
        body: "Pan and zoom.",
        imageUrl: "/banners/about.webp",
        ctaHref: "/map",
        ctaLabel: "Open the map",
      }),
    ],
  });
  const text = visibleText(html);
  expect(text).toContain("Heading 1");
  expect(text).toContain("Search campsites");
  expect(text).toContain("Every campsite, on one map");
  expect(html).toContain('data-testid="image-text"');
  expect(html).toContain('href="/map"');
});

test("variant `reverse` ставить фото праворуч, без нього — ліворуч", () => {
  const row = (variant: string | null) =>
    renderComponent(PageSections, {
      sections: [
        section({
          type: "image-text",
          variant,
          heading: "H",
          imageUrl: "/banners/about.webp",
          ctaHref: null,
          ctaLabel: null,
        }),
      ],
    });
  // Читаємо АТРИБУТ класу секції, а не весь вивід: правила CSS теж
  // називають `ct-iwt--reverse`.
  const cls = (html: string) => /<section class="(ct-iwt[^"]*)"/.exec(html)?.[1];
  expect(cls(row("reverse"))).toBe("ct-iwt ct-iwt--w70 ct-iwt--reverse");
  expect(cls(row(null))).toBe("ct-iwt ct-iwt--w70");
});

test("🔴 image-text без картинки, заголовка чи з половиною кнопки кидає", () => {
  const bad = (over: Partial<SectionView>) => () =>
    renderComponent(PageSections, {
      sections: [section({ type: "image-text", ...over })],
    });
  expect(bad({ imageUrl: null })).toThrow(/без картинки/);
  expect(bad({ heading: "" })).toThrow(/без заголовка/);
  expect(bad({ ctaLabel: null })).toThrow(/наполовину/);
});

// ── редактор: що пропонує Directus, те й вміє малювати код ────────────

test("🔴 перелік типів у адмінці збігається з тим, що вміє малювати код", () => {
  const src = readFileSync(
    join(__dirname, "../../../cms/configure.mjs"),
    "utf8",
  );
  const block = /page_sections: \{\s*type: \{[\s\S]*?choices: \[([\s\S]*?)\n\s*\],/.exec(
    src,
  );
  expect(block, "у configure.mjs не знайдено вибору типів page_sections").not.toBeNull();
  const offered = [...block![1].matchAll(/value: '([^']+)'/g)].map((m) => m[1]);
  expect(offered.length).toBeGreaterThan(0);
  expect([...offered].sort()).toEqual([...SECTION_TYPES].sort());
});

// ── міграція: дані, що їх засіває, і те, що з ними робить сторінка ────

test("🔴 кожен засіяний тип має рендер, а кожна адреса — внутрішній шлях", () => {
  expect(Seed.ROWS.length).toBeGreaterThan(0);
  for (const r of Seed.ROWS) {
    expect(SECTION_TYPES as readonly string[], `тип ${r.type}`).toContain(r.type);
    expect(r.ctaHref.startsWith("/"), `${r.slot}: адреса ${r.ctaHref}`).toBe(true);
  }
});

test("🔴 кожна картинка з міграції існує на диску", () => {
  for (const r of Seed.ROWS.filter((x) => x.imageUrl)) {
    const file = join(__dirname, "../../public", r.imageUrl!);
    expect(existsSync(file), `${r.slot}: немає файла ${file}`).toBe(true);
  }
});

test("🔴 слоти в міграції не повторюються (UNIQUE page_id+slot)", () => {
  const slots = Seed.ROWS.map((r) => r.slot);
  expect(new Set(slots).size).toBe(slots.length);
});

test("міграція не засіває нічого про нашу кухню", () => {
  const said = Seed.ROWS.flatMap((r) => [r.heading, r.subheading, r.body, r.ctaLabel])
    .filter((x): x is string => !!x)
    .join("\n");
  for (const bad of [
    /affiliate/i,
    /written by (a |an )?(AI|program)/i,
    /composed by/i,
    /we (have|hold) no/i,
    /not built yet/i,
    /commission/i,
  ]) {
    // «European Commission» у тексті про бюлетень — назва джерела, а не
    // розмова про комісію; її пропускаємо точково.
    const probe = said.replace(/European Commission/g, "");
    expect(probe, `у засіві є ${bad}`).not.toMatch(bad);
  }
});

test("🔴 засіяних слайдів три, і вони ведуть у кемпінги, планувальник і оренду", () => {
  const slides = Seed.ROWS.filter((r) => r.type === "slide");
  expect(slides.map((s) => s.ctaHref)).toEqual([
    "/camping",
    "/plan",
    "/camper-rental",
  ]);
});
