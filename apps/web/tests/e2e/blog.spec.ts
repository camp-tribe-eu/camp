import { expect, test } from "./api-request";

// CAMP-364 — блог і сторінка допису.
//
// 🔴 ДОПИСИ ТУТ — ФІКСТУРА, А НЕ ПРОДАКШН. `apps/api/test/fixtures/
// blog-post.sql` саджає рівно два: один опублікований 01.10.2026 і один
// із датою 2099 року. Другий існує саме для того, щоб заборона
// «запланованого допису не видно» мала на чому спрацювати: над порожнім
// блогом вона була б істинною ні про що.

const LIVE = "what-the-data-does-not-say";
const SCHEDULED = "scheduled-and-not-yet-due";

test.describe("🔴 CAMP-364 — перелік дописів", () => {
  test("показує опублікований допис із датою й автором", async ({ page }) => {
    await page.goto("/blog");

    const card = page.locator(`main a[href="/blog/${LIVE}"]`);
    await expect(card, "допису немає в переліку").toHaveCount(1);
    await expect(card).toHaveText("What the data does not say");

    const text = await page.locator("main").innerText();
    expect(text, "немає дати допису").toContain("1 October 2026");
    expect(text, "немає автора").toContain("CampTribe");
    expect(text, "немає короткого опису").toContain(
      "A campsite record is never complete",
    );
  });

  test("🔴 запланований допис не показується", async ({ page }) => {
    await page.goto("/blog");
    await expect(
      page.locator(`main a[href="/blog/${SCHEDULED}"]`),
      "допис із датою 2099 року вже видно",
    ).toHaveCount(0);
    // Пара: перелік не порожній, інакше заборона вище нічого не варта.
    await expect(page.locator(`main a[href="/blog/${LIVE}"]`)).toHaveCount(1);
  });

  test("порожнього стану немає, коли дописи є", async ({ page }) => {
    await page.goto("/blog");
    await expect(page.getByTestId("blog-empty")).toHaveCount(0);
  });
});

test.describe("🔴 CAMP-364 — сторінка допису", () => {
  test("заголовок, дата, автор і текст із CMS", async ({ page }) => {
    await page.goto(`/blog/${LIVE}`);

    await expect(page.locator("main h1")).toHaveText(
      "What the data does not say",
    );
    await expect(page.locator("main time")).toHaveAttribute(
      "datetime",
      /^2026-10-01T/,
    );
    await expect(page.locator("main time")).toHaveText("1 October 2026");

    // `## ` з тіла секції мусить стати справжнім заголовком, а не абзацом.
    await expect(
      page.getByRole("heading", { name: "Why a gap beats a guess", level: 2 }),
      "підзаголовок із CMS намальовано не заголовком",
    ).toHaveCount(1);

    const text = await page.locator("main").innerText();
    expect(text).toContain("A guess looks exactly like a fact once it is printed.");
    expect(text, "у видимому тексті лишилось {{…}}").not.toMatch(/\{\{|\}\}/);
  });

  test("🔴 запланований допис віддає 404, а не порожню сторінку", async ({
    page,
  }) => {
    const res = await page.goto(`/blog/${SCHEDULED}`);
    expect(res?.status(), "сторінка запланованого допису доступна").toBe(404);
  });

  test("розмітка несе BlogPosting із датою публікації", async ({ page }) => {
    await page.goto(`/blog/${LIVE}`);
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const nodes = raw.flatMap((t) => {
      const parsed = JSON.parse(t) as Record<string, unknown>;
      return ((parsed["@graph"] as unknown[]) ?? [parsed]) as Array<
        Record<string, unknown>
      >;
    });
    const post = nodes.find((n) => n["@type"] === "BlogPosting");
    expect(post, "немає вузла BlogPosting").toBeTruthy();
    expect(post!.headline).toBe("What the data does not say");
    expect(String(post!.datePublished)).toMatch(/^2026-10-01T/);
    expect(post!.author).toMatchObject({ name: "CampTribe" });
    expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
  });
});

// 🔴 КАРТА САЙТУ — ТРЕТЄ МІСЦЕ, ЯКЕ МУСИТЬ БАЧИТИ ТУ САМУ МНОЖИНУ.
// Перелік, сторінка і карта розійдуться — дістанемо або мертву адресу,
// або ранній допис в індексі.
test.describe("🔴 CAMP-364 — блог у карті сайту", () => {
  test("опублікований допис є, запланований — ні", async ({ request }) => {
    const index = await request.get("/sitemap.xml");
    expect(index.ok(), "карта сайту недосяжна").toBe(true);
    const files = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => m[1],
    );
    expect(files.length, "карта сайту порожня").toBeGreaterThan(0);

    let all = "";
    for (const file of files) {
      const res = await request.get(new URL(file).pathname);
      expect(res.ok(), `підкарта ${file} недосяжна`).toBe(true);
      all += await res.text();
    }

    expect(all, "допису немає в карті сайту").toContain(`/blog/${LIVE}`);
    expect(all, "блогу немає в карті сайту").toMatch(/<loc>[^<]*\/blog<\/loc>/);
    expect(all, "запланований допис потрапив у карту сайту").not.toContain(
      `/blog/${SCHEDULED}`,
    );
  });
});
