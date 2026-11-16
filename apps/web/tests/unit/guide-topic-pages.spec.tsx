import { expect, test } from "@playwright/test";
import corpus from "@/data/guide-slugs.json";
import GuideTopicView from "@/components/guide-topic-view";
import { byTopic, parsed, TOPICS } from "@/lib/guide-facets";
import { GUIDES_PER_PAGE, guidePageCount } from "@/lib/guide-pages";
import { renderComponent } from "./render-component";

// CAMP-443/5, 443/6 — тематичні сторінки гайдів поділено на сторінки, і
// 🔴 КОЖЕН гайд теми лишається досяжним посиланням із якоїсь із них.
//
// Корпус — справжні слаги з бази (`src/data/guide-slugs.json`), не
// вигадані: 463 «water» дають 20 сторінок. Рахуємо посилання в ВІДДАНІЙ
// розмітці, а не довжину зрізу в коді.

const guides = parsed(
  corpus.slugs.map((slug) => ({
    slug,
    category: "region",
    title: `Guide ${slug}`,
    summary: "Summary.",
    body: null,
    provenance: "data-generated" as const,
    generator: "region-facts@2",
    authorName: null,
    authorCredentials: null,
    readingMinutes: 1,
    factsCheckedAt: null,
    publishedAt: null,
  })),
);

/**
 * Посилання на окремі гайди в ВІДДАНІЙ розмітці: `/guides/<slug>` без
 * другого сегмента (тож `/guides/topic/x` і `/guides/country/x` не
 * рахуються). Одна картка = одне посилання (кнопка), тому число
 * збігається з числом гайдів лише тоді, коли картки справді є.
 */
const guideLinks = (html: string): string[] =>
  [...html.matchAll(/href="\/guides\/([^"/]+)"/g)].map((m) => m[1]);

test.describe("🔴 гайди теми досяжні посиланнями з пагінованих сторінок", () => {
  for (const t of byTopic(guides)) {
    test(`«${t.topic}»: ${t.guides.length} гайдів = ${t.guides.length} посилань на всіх сторінках`, () => {
      const pages = guidePageCount(t.guides.length);
      const seen: string[] = [];
      for (let n = 1; n <= pages; n++) {
        const html = renderComponent(GuideTopicView, {
          topic: t.topic,
          guides: t.guides,
          page: n,
        });
        const links = guideLinks(html);
        expect(links.length, `сторінка ${n}`).toBeLessThanOrEqual(
          GUIDES_PER_PAGE,
        );
        seen.push(...links);
      }
      // Знаменник названий: тема не порожня.
      expect(t.guides.length).toBeGreaterThan(0);
      expect(seen.length).toBe(t.guides.length);
      expect(new Set(seen).size, "гайд двічі").toBe(t.guides.length);
      expect([...seen].sort()).toEqual(t.guides.map((g) => g.slug).sort());
    });
  }

  test("усі теми разом дають весь корпус, і найбільша справді має кілька сторінок", () => {
    const total = byTopic(guides).reduce((n, t) => n + t.guides.length, 0);
    expect(total).toBe(corpus.count);
    const water = byTopic(guides).find((t) => t.topic === "water")!;
    expect(guidePageCount(water.guides.length)).toBeGreaterThan(5);
    expect(Object.keys(TOPICS).length).toBeGreaterThan(0);
  });

  test("сторінка 2 віддає пагінацію з rel і зворотним посиланням на першу без суфікса", () => {
    const water = byTopic(guides).find((t) => t.topic === "water")!;
    const html = renderComponent(GuideTopicView, {
      topic: "water",
      guides: water.guides,
      page: 2,
    });
    expect(html).toContain('href="/guides/topic/water"');
    expect(html).toContain('href="/guides/topic/water/page/3"');
    expect(html).toMatch(/rel="next"/);
    expect(html).toMatch(/rel="prev"/);
  });
});
