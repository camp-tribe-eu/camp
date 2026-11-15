import { expect, test } from "./api-request";
import { scanPage } from "../../../../scripts/ci/disclosure-rules.mjs";

// CAMP-461 — оренда, як її бачить читач: банер, віджет, видимий перехід до
// компаній, єдина картка, бокова панель фільтрів, чистота від внутрішньої
// кухні.
//
// 🔴 КОЖНЕ ТВЕРДЖЕННЯ ТУТ — ПРО ВІДДАНУ СТОРІНКУ: елемент, який бачить
// браузер, або HTML, який віддав сервер. Жодного `sr-only`, класу чи
// константи як доказу. Очікувані числа беруться з ТОГО Ж API, що годує
// сторінку, а не переписані в тест.

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface ApiProvider {
  slug: string;
  name: string;
  countries: string[];
  camperTypeSlugs: string[];
}

async function apiProviders(): Promise<ApiProvider[]> {
  const res = await fetch(`${API}/rental/providers`);
  if (!res.ok) throw new Error(`GET /rental/providers → ${res.status}`);
  const body = (await res.json()) as ApiProvider[] | { providers: ApiProvider[] };
  const list = Array.isArray(body) ? body : body.providers;
  if (list.length < 3) throw new Error("провайдерів замало, щоб щось довести");
  return list;
}

for (const vp of [
  { name: "desktop 1440×900", width: 1440, height: 900 },
  { name: "mobile 375×812", width: 375, height: 812 },
]) {
  test.describe(`хаб оренди на першому екрані — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("🔴 банер із фото несе h1 і кнопку до вибору компанії", async ({ page }) => {
      await page.goto("/camper-rental");
      const banner = page.locator("section.ct-banner").first();
      await expect(banner.getByRole("heading", { level: 1 })).toHaveText(
        "Renting a camper in the EU",
      );
      // Фото справді завантажилось: порожній src або 404 дали б naturalWidth 0.
      const bg = banner.locator("img.ct-banner__background");
      await expect(bg).toBeVisible();
      expect(
        await bg.evaluate((el: HTMLImageElement) => el.naturalWidth),
      ).toBeGreaterThan(0);
      // Рівно один h1 на сторінці: заголовок усередині банера, а не двічі.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      const cta = banner.getByRole("link", { name: "Choose a rental company" });
      await expect(cta).toHaveAttribute("href", "/camper-rental/providers");
      const box = (await cta.boundingBox())!;
      expect(box.y + box.height, "кнопка банера на першому екрані").toBeLessThan(
        vp.height,
      );
    });

    test("🔴 віджет вибору починається на першому екрані", async ({ page }) => {
      await page.goto("/camper-rental");
      const picker = page.getByTestId("rental-picker");
      await expect(picker).toBeVisible();
      const box = (await picker.boundingBox())!;
      expect(box.y, "початок віджета").toBeLessThan(vp.height);
      if (vp.width >= 1200) {
        // На широкому екрані віджет вміщається ЦІЛКОМ, разом із кнопкою.
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      }
    });

    test("🔴 перехід до компаній — кнопка, а не рядок на шостому екрані", async ({
      page,
    }) => {
      await page.goto("/camper-rental");
      const cta = page.getByTestId("providers-cta");
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute("href", "/camper-rental/providers");
      // Кнопка, а не посилання-текст: той самий `data-ct-button`, що в теми.
      await expect(cta).toHaveAttribute("data-ct-button", "primary");
      const y = (await cta.boundingBox())!.y;
      // Раніше: «See the companies →» на шостому екрані (~5 400 px).
      expect(y, "положення кнопки від верху сторінки").toBeLessThan(
        3 * vp.height,
      );
    });
  });
}

test.describe("віджет веде в каталог, звужений за вибором", () => {
  test("🔴 обрана країна дає у каталозі рівно стільки компаній, скільки каже API", async ({
    page,
  }) => {
    const all = await apiProviders();
    await page.goto("/camper-rental");
    const select = page.getByTestId("picker-country");
    const values = (
      await select.locator("option").evaluateAll((os) =>
        os.map((o) => (o as HTMLOptionElement).value),
      )
    ).filter(Boolean);
    expect(values.length).toBeGreaterThan(1);
    // Країна, де є й не всі компанії: інакше «звузило» не відрізнити від
    // «показало все».
    const code = values.find((c) => {
      const n = all.filter((p) => p.countries.includes(c)).length;
      return n > 0 && n < all.length;
    });
    expect(code, "країна, що відсіює частину компаній").toBeTruthy();
    const expected = all.filter((p) => p.countries.includes(code!)).length;

    await select.selectOption(code!);
    await page.getByTestId("picker-submit").click();
    await expect(page).toHaveURL(new RegExp(`/camper-rental/providers\\?.*country=${code}`));
    await expect(page.getByTestId("provider-catalogue")).toBeVisible();
    await expect(page.getByTestId("result-count")).toHaveText(
      `${expected} of ${all.length}`,
    );
    await expect(page.getByTestId("filter-country")).toHaveValue(code!);
  });

  test("🔴 у віджеті немає Кіпру, і немає поля дати", async ({ page }) => {
    await page.goto("/camper-rental");
    const picker = page.getByTestId("rental-picker");
    await expect(picker.locator('option[value="CY"]')).toHaveCount(0);
    await expect(picker.locator('input[type="date"]')).toHaveCount(0);
  });
});

test.describe("хаб: прапори, довідка у FAQ", () => {
  test("🔴 кожна країна в переліку має прапор і одне посилання", async ({ page }) => {
    await page.goto("/camper-rental");
    const index = page.getByTestId("rental-country-index");
    const cards = index.getByTestId("media-card");
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(10);
    await expect(index.locator("img.ct-flag")).toHaveCount(n);
    await expect(index.getByRole("link")).toHaveCount(n);
    for (const src of await index
      .locator("img.ct-flag")
      .evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))) {
      expect(src).toMatch(/\/flags\/[a-z]{2}\.svg$/);
    }
  });

  test("🔴 «усе міняється на 3 500 кг» — чотири картки зі значками, з тими словами, що дав CMS", async ({
    page,
    request,
  }) => {
    const res = await request.get(`${API}/pages/camper-rental`);
    const body = (await res.json()) as {
      sections: Array<{
        slot: string | null;
        heading: string | null;
        items: Array<{ term: string; text: string }>;
      }>;
    };
    const cms = body.sections.find((s) => s.slot === "mass-line")!;
    expect(cms.items.length).toBe(4);

    await page.goto("/camper-rental");
    const block = page.getByTestId("rental-mass-line");
    await expect(block.getByRole("heading", { level: 2 })).toHaveText(cms.heading!);
    const cards = block.getByTestId("mass-line").locator("li");
    await expect(cards).toHaveCount(4);
    for (const [i, item] of cms.items.entries()) {
      await expect(cards.nth(i)).toContainText(item.term);
      await expect(cards.nth(i)).toContainText(item.text);
      await expect(cards.nth(i).locator(".ct-feat__icon svg")).toHaveCount(1);
    }
  });

  test("🔴 довга довідка живе в акордеоні й відкривається кліком", async ({ page }) => {
    await page.goto("/camper-rental");
    const faq = page.getByTestId("rental-faq-list");
    const item = faq.locator("details", {
      hasText: "Which four numbers on the contract decide the trip?",
    });
    // Закрита: таблиця порогів у DOM є (краулер читає), але читач її не бачить.
    await expect(item.getByTestId("rental-thresholds")).toBeHidden();
    await item.locator("summary").click();
    await expect(item.getByTestId("rental-thresholds")).toBeVisible();
    // Те саме для двох інших вузлів-відповідей.
    for (const [q, id] of [
      ["What shapes of camper will I be offered?", "rental-shapes"],
      ["Which eight questions should I ask before I sign?", "rental-checklist"],
    ] as const) {
      const d = faq.locator("details", { hasText: q });
      await d.locator("summary").click();
      await expect(d.getByTestId(id)).toBeVisible();
    }
  });
});

test.describe("сторінка країни оренди", () => {
  test("🔴 банер країни, кнопка в звужений каталог і картки компаній цієї країни", async ({
    page,
  }) => {
    const all = await apiProviders();
    const here = all.filter((p) => p.countries.includes("DE"));
    expect(here.length, "фікстура має компанії з DE").toBeGreaterThan(0);

    await page.goto("/camper-rental/de");
    const banner = page.locator("section.ct-banner").first();
    await expect(banner.getByRole("heading", { level: 1 })).toHaveText(
      "Renting a camper in Germany",
    );
    await expect(page.getByTestId("country-compare-cta")).toHaveAttribute(
      "href",
      "/camper-rental/providers?country=DE",
    );
    await expect(page.getByTestId("country-compare-cta")).toHaveAttribute(
      "data-ct-button",
      "primary",
    );
    const cards = page.getByTestId("country-provider-cards").getByTestId("media-card");
    await expect(cards).toHaveCount(Math.min(3, here.length));
    // Кожна картка — компанія, що справді видає машини в DE.
    const names = await cards.locator(".ct-mc__title").allTextContents();
    for (const n of names) {
      expect(here.map((p) => p.name), n).toContain(n);
    }
  });

  test("🔴 два спільні рядки «фото + текст» і три факти зі значками й джерелом", async ({
    page,
  }) => {
    await page.goto("/camper-rental/de");
    await expect(page.getByTestId("image-text")).toHaveCount(2);
    const facts = page.getByTestId("country-facts").locator("li");
    await expect(facts).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(facts.nth(i).locator(".ct-feat__icon svg")).toHaveCount(1);
      await expect(facts.nth(i).getByText(/^Source:/)).toBeVisible();
    }
  });
});

test.describe("каталог компаній", () => {
  test("🔴 банер, видима бокова панель фільтрів і квадратики замість пігулок", async ({
    page,
  }) => {
    await page.goto("/camper-rental/providers");
    await expect(
      page.locator("section.ct-banner").first().getByRole("heading", { level: 1 }),
    ).toHaveText("Camper rental companies");
    const filters = page.getByTestId("catalogue-filters");
    await expect(filters).toBeVisible();
    // Фільтри з іконками (за кожним підписом — svg).
    expect(await filters.locator("label svg").count()).toBeGreaterThanOrEqual(3);

    // «Must offer» — квадратик із галочкою, а не пігулка: видимий `.ct-cb__box`
    // на кожну галочку, і клік змінює лічильник.
    const boxes = filters.locator(".ct-cb__box");
    const n = await boxes.count();
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) await expect(boxes.nth(i)).toBeVisible();
    const total = (await apiProviders()).length;
    const first = filters.locator("label.ct-cb").first();
    await first.click();
    await expect(first.locator("input")).toBeChecked();
    const text = (await page.getByTestId("result-count").textContent())!.trim();
    const m = /^(\d+) of (\d+)$/.exec(text);
    expect(m, text).not.toBeNull();
    expect(Number(m![2])).toBe(total);
    expect(Number(m![1])).toBeLessThan(total);
  });

  test("🔴 на вузькому екрані фільтри над списком, а не за кнопкою", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/camper-rental/providers");
    const filters = page.getByTestId("catalogue-filters");
    await expect(filters).toBeVisible();
    const f = (await filters.boundingBox())!;
    const firstRow = (await page.getByTestId("provider-row").first().boundingBox())!;
    expect(f.y + f.height).toBeLessThanOrEqual(firstRow.y + 1);
    expect(f.width).toBeLessThanOrEqual(375);
  });

  test("🔴 картка компанії: прапор, назва, одна кнопка, що називає компанію", async ({
    page,
  }) => {
    await page.goto("/camper-rental/providers");
    const row = page.getByTestId("provider-row").first();
    await expect(row.locator("img.ct-flag, .ct-flag--none")).toHaveCount(1);
    const name = (await row.locator(".ct-mc__title").textContent())!.trim();
    const links = row.getByRole("link", { name: new RegExp(`^View ${name}`) });
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute(
      "data-ct-button",
      "secondary",
    );
  });
});

test.describe("сторінки оренди без внутрішньої кухні", () => {
  const PATHS = ["/camper-rental", "/camper-rental/de", "/camper-rental/providers"];

  // Фрази, які власник назвав дослівно (CAMP-443): жодна не має дійти до
  // читача, а `check-no-internal-kitchen` (він читає ЗІБРАНІ сторінки й
  // не імпортується в тест: у ньому `import.meta`) цих сполук не знає.
  const OWNER = [
    /we hold no\b/i,
    /not going to guess/i,
    /we have no (rental )?partner/i,
    /how .{0,20}(makes?|earns?) money/i,
    /commission for bookings/i,
    /affiliate applications?/i,
  ];

  for (const path of PATHS) {
    test(`🔴 ${path}: жодного збігу з переліком сторожа розкриття і з фразами власника`, async ({
      request,
    }) => {
      const html = await (await request.get(path)).text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/g, " ")
        .replace(/<style[\s\S]*?<\/style>/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/\s+/g, " ");
      // Сторож повинен справді прочитати щось: порожній текст дав би нуль збігів.
      expect(text.length).toBeGreaterThan(2000);

      expect(
        scanPage(path, html).map((f: { phrase: string }) => f.phrase),
        "перелік check-no-internal-disclosure",
      ).toEqual([]);
      for (const re of OWNER) {
        expect(text, `${path} matched ${re}`).not.toMatch(re);
      }
    });
  }
});

test.describe("слоти CMS доходять до сторінки", () => {
  test("🔴 заголовок і підпис кнопки банера — ті, що віддає API", async ({ page, request }) => {
    const res = await request.get(`${API}/pages/camper-rental`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      sections: Array<{
        slot: string | null;
        heading: string | null;
        ctaLabel: string | null;
        body: string | null;
      }>;
    };
    const slot = (s: string) => body.sections.find((x) => x.slot === s)!;
    await page.goto("/camper-rental");
    await expect(page.locator("section.ct-banner").first()).toContainText(
      slot("banner").ctaLabel!,
    );
    await expect(page.locator("main")).toContainText(slot("providers").heading!);
    await expect(page.locator("main")).toContainText(slot("picker").ctaLabel!);
    // Кожне story-слово з CMS — на сторінці: секція, додана в адмінці, не
    // зникає мовчки.
    const stories = body.sections.filter((s) => s.slot?.startsWith("story:"));
    expect(stories.length).toBeGreaterThanOrEqual(3);
    for (const s of stories) {
      await expect(page.getByTestId("image-text").filter({ hasText: s.heading! })).toHaveCount(1);
    }
  });
});
