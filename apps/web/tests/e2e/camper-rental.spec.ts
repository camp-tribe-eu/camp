import { expect, test } from "./api-request";
import { COUNTRY_CONFIG } from "../../src/data/rental/country-config";
import type { RentalCountry } from "../../src/lib/rental";
// 🔴 CAMP-479: перелік країн береться з API, а не з коду — текст
// переїхав у базу, і копія в репозиторії стерегла б саме копію.
const RENTAL_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * 🔴 ТИП БЕРЕТЬСЯ З БІБЛІОТЕКИ, А НЕ ОГОЛОШУЄТЬСЯ ТУТ ЗАНОВО.
 *
 * Перша редакція описала свій `ApiCountry` із трьох полів — і цим
 * розірвала б звʼязок: якби API перестав віддавати `facts`, тест лишився
 * б зеленим, бо його власний тип про них не знає. `inProse()` приймає
 * повну країну, і саме повну ми й перевіряємо.
 *
 * `definiteArticle` API не віддає (він лишився в коді), тож домішуємо
 * його з того самого конфігу, яким користується сайт.
 */
async function rentalCountriesFromApi(): Promise<RentalCountry[]> {
  const res = await fetch(`${RENTAL_API}/rental/countries`);
  if (!res.ok) throw new Error(`GET /rental/countries → ${res.status}`);
  const body = (await res.json()) as {
    countries?: Array<Omit<RentalCountry, "data" | "definiteArticle">>;
  };
  const list = body.countries ?? [];
  if (list.length === 0) {
    throw new Error("жодної країни оренди — перевіряти нема на чому");
  }
  return list.map((c) => {
    const cfg = COUNTRY_CONFIG[c.code];
    if (!cfg) throw new Error(`країна «${c.code}» без рядка в COUNTRY_CONFIG`);
    return {
      ...c,
      data: { metric: cfg.metric, kind: cfg.kind },
      ...(cfg.definiteArticle ? { definiteArticle: true as const } : {}),
    };
  });
}

async function rentalCountryCount(): Promise<number> {
  const res = await fetch(`${RENTAL_API}/rental/countries`);
  if (!res.ok) throw new Error(`GET /rental/countries → ${res.status}`);
  const body = (await res.json()) as { countries?: unknown[] };
  const n = body.countries?.length ?? 0;
  if (n === 0) {
    throw new Error("жодної країни оренди — перевіряти нема на чому");
  }
  return n;
}
import { inProse } from "../../src/lib/rental";

// CAMP-4 / CAMP-54 — the rental section as a reader meets it.
//
// 🔴 Several cases read the served HTML through `request` rather than
// through the browser, on purpose. Every number on these pages is a count
// of our own records, and the whole argument of the section is that those
// numbers are real — a number that only appears after a bundle executes
// is a number a crawler, an assistant and a reader on a bad connection
// never see.
//
// 🔴 And two cases assert the ABSENCE of things: no invented price, and
// no outbound commission link while we have no affiliate account. Those
// are the failures that would cost the most and would look like nothing.

test.describe("the rental hub", () => {
  test("leads with what it is, not with what it lacks", async ({ page }) => {
    await page.goto("/camper-rental");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Renting a camper in the EU",
    );
    await expect(
      page.getByText("Every number on these pages is either a count"),
    ).toBeVisible();
    await expect(page.getByText("no prices and no vehicles")).toHaveCount(0);
    await expect(page.getByTestId("rental-thresholds")).toBeVisible();
    await expect(page.getByTestId("rental-checklist")).toBeVisible();
  });

  test("says nothing about how it is funded while it has no commission link", async ({
    page,
  }) => {
    // 🔴 CAMP-463. Розкриття звʼязку стоїть ТАМ, ДЕ ВІН Є (UCPD ст. 7(2));
    // коли посилань немає, розкривати нічого, і блок не малюється.
    await page.goto("/camper-rental");
    await expect(page.getByTestId("rental-disclosure")).toHaveCount(0);
    await expect(page.getByTestId("rental-offer-slot")).toHaveCount(0);
  });

  test("links to exactly the countries that have a page", async ({ page }) => {
    await page.goto("/camper-rental");
    const links = page.getByTestId("rental-country-index").getByRole("link");
    const count = await rentalCountryCount();
    await expect(links).toHaveCount(count);
    // Ten to fifteen, never two hundred. The number is the deliverable.
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(15);
  });
});

test.describe("a country page", () => {
  test("carries three sourced facts and a measured claim, without JavaScript", async ({
    request,
  }) => {
    const html = await (await request.get("/camper-rental/de")).text();
    expect(html).toContain("Renting a camper in Germany");
    // The three authorities named on the German page, in the served HTML.
    expect(html).toContain("Toll Collect");
    expect(html).toContain("Umweltbundesamt");
    expect(html).toContain("gesetze-im-internet.de");
    // The measured lead, and the date it was measured on — a count without
    // its date is a claim about today that nobody checked.
    expect(html).toMatch(/Counted in our own database on/);
    expect(html).toMatch(/\d{1,2} \w+ \d{4}/);
  });

  test("every country page says something different about its own data", async ({
    request,
  }) => {
    // 🔴 The set is keyed on the SENTENCE, not on the country — keying it
    // on the code would make it unique by construction and prove nothing.
    // Two pages whose measured paragraph reads the same are two pages with
    // a name swapped, which is the failure this whole section is arranged
    // to avoid.
    const sentences = new Set<string>();
    for (const c of await rentalCountriesFromApi()) {
      const html = await (await request.get(`/camper-rental/${c.code}`)).text();
      expect(html).toContain(`Renting a camper in ${inProse(c)}`);
      const m = /data-testid="lead-value"[^>]*>([^<]+)</.exec(html);
      expect(m, `${c.code} renders no measured lead`).not.toBeNull();
      // The whole paragraph, with the country's own name taken out of it.
      const para =
        /<p[^>]*>((?:(?!<\/p>)[\s\S])*?data-testid="lead-value"[\s\S]*?)<\/p>/.exec(
          html,
        );
      expect(para, `${c.code} has no measured paragraph`).not.toBeNull();
      const normalised = para![1]
        .replace(/<[^>]+>/g, " ")
        .replaceAll(inProse(c), "COUNTRY")
        .replaceAll(c.name, "COUNTRY")
        .replace(/\s+/g, " ")
        .trim();
      expect(
        sentences.has(normalised),
        `${c.code} says the same thing as another country`,
      ).toBe(false);
      sentences.add(normalised);
    }
    expect(sentences.size).toBe(await rentalCountryCount());
  });

  test("sends a reader on to the campsites and the fuel prices", async ({
    page,
  }) => {
    await page.goto("/camper-rental/hr");
    await expect(
      page.getByRole("link", { name: "Browse them" }),
    ).toHaveAttribute("href", "/camping/hr");
    await expect(
      page.getByRole("link", { name: "Price a trip in Croatia" }),
    ).toHaveAttribute("href", "/tools/camper-trip-cost/hr");
  });
});

test.describe("the commercial slot, while there is no partner", () => {
  test("is not drawn at all, and the page does not explain its absence", async ({
    page,
  }) => {
    await page.goto("/camper-rental/fr");
    await expect(page.getByTestId("rental-offer-slot")).toHaveCount(0);
    await expect(page.getByText("no rental partner")).toHaveCount(0);
  });

  test("contains no affiliate link anywhere in the section", async ({
    request,
  }) => {
    // 🔴 There are no affiliate accounts yet (CAMP-98), so a `sponsored`
    // link on any of these pages means a link was hard-coded past the
    // configuration layer — which is the one thing lib/affiliate.ts exists
    // to make impossible.
    for (const path of [
      "/camper-rental",
      ...(await rentalCountriesFromApi()).map(
        (c) => `/camper-rental/${c.code}`,
      ),
    ]) {
      const html = await (await request.get(path)).text();
      expect(html, `${path} carries a commission link`).not.toContain(
        'rel="sponsored',
      );
      expect(html, `${path} carries an affiliate mark`).not.toContain(
        'data-testid="affiliate-link"',
      );
    }
  });

  test("invents no price, no rate and no availability", async ({ request }) => {
    // The exact shapes a made-up rental offer takes. None of them may
    // appear while we hold no prices — and we hold none.
    const forbidden = [
      /from\s*€/i,
      /€\s*\d+\s*(?:\/|per\s+)day/i,
      /per\s+night\s+from/i,
      /available\s+from\s+€/i,
    ];
    for (const path of [
      "/camper-rental",
      "/camper-rental/de",
      "/camper-rental/es",
    ]) {
      const html = await (await request.get(path)).text();
      for (const re of forbidden) {
        expect(html, `${path} matched ${re}`).not.toMatch(re);
      }
    }
  });
});

test("the section is in the sitemap, and only the pages that exist", async ({
  request,
}) => {
  const xml = await (await request.get("/sitemaps/hubs.xml")).text();
  expect(xml).toContain("/camper-rental</loc>");
  for (const c of await rentalCountriesFromApi()) {
    expect(xml, `${c.code} missing from the sitemap`).toContain(
      `/camper-rental/${c.code}</loc>`,
    );
  }
  // A country without a page must not be listed. Cyprus and Malta hold too
  // few records to say anything measured, which is why they have none.
  expect(xml).not.toContain("/camper-rental/cy<");
  expect(xml).not.toContain("/camper-rental/mt<");
});

test("a country without a page is a 404, not a thin page", async ({
  request,
}) => {
  expect((await request.get("/camper-rental/cy")).status()).toBe(404);
});

/**
 * CAMP-478 — вступ хаба приходить із CMS, а не з коду.
 *
 * 🔴 ЗВІРЯЄМО З ТИМ САМИМ API, З ЯКОГО СТОРІНКУ БУДУЄ СЕРВЕР. Рядок,
 * переписаний у тест, довів би лише те, що хтось двічі набрав ті самі
 * слова — а питання стоїть про джерело слів.
 */
test("вступ хаба оренди приходить із CMS", async ({ page, request }) => {
  const url = `${RENTAL_API}/pages/camper-rental`;
  const res = await request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()}`).toBeTruthy();

  const body = (await res.json()) as {
    sections?: Array<{ slot?: string | null; body?: string | null }>;
  };
  const intro = (body.sections ?? []).find((s) => s.slot === "intro")?.body;
  expect(
    intro,
    "у CMS немає секції `intro` для `camper-rental` — сій її міграцією",
  ).toBeTruthy();

  await page.goto("/camper-rental");
  await expect(
    page.locator("main"),
    "вступ на сторінці не збігається з тим, що віддав API — отже він " +
      "малюється з коду, і власник не може його змінити",
  ).toContainText(intro!);
});
