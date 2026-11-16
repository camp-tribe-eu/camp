import { expect, test } from "@playwright/test";
import CampsitePage from "@/app/camping/[country]/[region]/[slug]/page";
import { renderAsyncComponent } from "./render-component";
import { visibleText } from "./rendered-text";
import { CLIENT_ISLANDS } from "./client-islands";

// CAMP-524 — «If it's full here», read from the HTML the real page serves.
//
// 🔴 КОЖНЕ ТВЕРДЖЕННЯ ЧИТАЄ ВІДДАНУ РОЗМІТКУ `CampsitePage`, а не
// константу. Фікстура дає речення про ранжування, бо його будує API (див.
// apps/api/src/spots/plan-b.ts); те, що перевіряється ТУТ, — що сторінка
// його друкує, що без нього блок не малюється, і що ні блок, ні його текст
// ніколи не обіцяють вільних місць.

type Fetcher = (url: string) => Response | Promise<Response>;

async function withFetch(impl: Fetcher, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const spot = {
  slug: "camping-test",
  name: "Camping Test",
  country: "fr",
  region: "Charente-Maritime",
  type: "paid",
  lat: 46.1,
  lon: -1.2,
  amenities: {
    electricity: "yes",
    water: "unknown",
    shower: "yes",
    toilets: "unknown",
    dogFriendly: "unknown",
    wifi: "unknown",
    greyWater: "unknown",
    laundry: "unknown",
    wheelchair: "unknown",
    wheelchairFull: "unknown",
  },
  ownerOverrides: {},
  lastSeenAt: "2026-10-12T05:00:00.000Z",
  missingSince: null,
  context: {},
  description: null,
  descriptionLang: null,
  stars: null,
  website: null,
  contact: {},
  sources: [
    {
      id: "osm",
      ref: "w1",
      updatedAt: "2026-10-12",
      fields: ["name", "location", "amenities"],
    },
  ],
  warningAreas: null,
  tariffs: [],
};

const RANKING =
  "Ranked by, in this order: A; B; C. Nothing else moves a place up.";

const ITEMS = [
  {
    slug: "aire-la-haute",
    name: "Aire de la Haute",
    path: "/camping/fr/charente-maritime/aire-la-haute",
    type: "camper_stop",
    metres: 8_400,
    elevation: 245,
    elevationDelta: 240,
  },
  {
    slug: "ferme-du-bois",
    name: "Ferme du Bois",
    path: "/camping/fr/charente-maritime/ferme-du-bois",
    type: "free",
    metres: 950,
    elevation: null,
    elevationDelta: null,
  },
  {
    slug: "camping-bas",
    name: null,
    path: "/camping/fr/charente-maritime/camping-bas",
    type: "paid",
    metres: 12_000,
    elevation: 2,
    elevationDelta: -40,
  },
];

async function html(planB: unknown): Promise<string> {
  let out = "";
  await withFetch(
    (url) =>
      url.includes("/spots/fr/charente-maritime/camping-test")
        ? json({ spot, nearby: [], ...(planB === undefined ? {} : { planB }) })
        : json({}, 404),
    async () => {
      out = await renderAsyncComponent(
        CampsitePage,
        {
          params: Promise.resolve({
            country: "fr",
            region: "charente-maritime",
            slug: "camping-test",
          }),
        },
        { omit: CLIENT_ISLANDS },
      );
    },
  );
  return out;
}

const blockOf = (page: string): string => {
  const m = page.match(/<section[^>]*data-testid="plan-b"[\s\S]*?<\/section>/);
  return m ? m[0] : "";
};

test.describe("План Б на сторінці кемпінгу", () => {
  test("без кандидатів блоку немає: ні відсутнє поле, ні null, ні порожній список", async () => {
    for (const planB of [
      undefined,
      null,
      { ranking: RANKING, radiusM: 15_000, items: [] },
    ]) {
      const page = await html(planB);
      expect(page).not.toContain('data-testid="plan-b"');
      expect(visibleText(page)).not.toContain("If it’s full here");
    }
  });

  test("без речення про ранжування блок не малюється, хоч кандидати є", async () => {
    const page = await html({ ranking: "", radiusM: 15_000, items: ITEMS });
    expect(page).not.toContain('data-testid="plan-b"');
  });

  test("з кандидатами: заголовок, три посилання, відстань, висота й різниця", async () => {
    const page = await html({
      ranking: RANKING,
      radiusM: 15_000,
      items: ITEMS,
    });
    const block = blockOf(page);
    expect(block).not.toBe("");
    const text = visibleText(block);
    expect(text).toContain("If it’s full here");
    expect([...block.matchAll(/data-testid="plan-b-item"/g)]).toHaveLength(3);
    for (const i of ITEMS) {
      expect(block).toContain(`href="${i.path}"`);
    }
    expect(text).toContain("Aire de la Haute");
    expect(text).toContain("8.4 km");
    expect(text).toContain("245 m above sea level (+240 m higher)");
    expect(text).toContain("950 m away");
    // Висота невідома — поля немає, а не «0 m» чи «unknown».
    const ferme = block.split('data-testid="plan-b-item"')[2];
    expect(visibleText(ferme)).not.toContain("above sea level");
    expect(text).toContain("2 m above sea level (40 m lower)");
    // Без назви — тип місця, а не порожнє посилання.
    expect(text).toContain("Campsite · 12.0 km away");
  });

  test("речення про ранжування — у відданому HTML, видиме, поруч із блоком", async () => {
    const page = await html({
      ranking: RANKING,
      radiusM: 15_000,
      items: ITEMS,
    });
    const block = blockOf(page);
    expect(visibleText(block)).toContain(RANKING);
    expect(block).toMatch(/data-testid="plan-b-ranking"/);
  });

  test("походження цифр названо; кредит висоти є лише коли висота надрукована", async () => {
    const withHeights = visibleText(
      blockOf(await html({ ranking: RANKING, radiusM: 15_000, items: ITEMS })),
    );
    expect(withHeights).toContain("straight lines");
    expect(withHeights).toContain("not driving distances");
    expect(withHeights).toContain("Copernicus elevation model");
    const noHeights = visibleText(
      blockOf(
        await html({
          ranking: RANKING,
          radiusM: 15_000,
          items: [{ ...ITEMS[1] }],
        }),
      ),
    );
    expect(noHeights).toContain("straight lines");
    expect(noHeights).not.toContain("Copernicus");
  });

  test("блок не обіцяє місць: жодного available / free spots / vacancy, і каже, що не знає", async () => {
    const page = await html({
      ranking: RANKING,
      radiusM: 15_000,
      items: ITEMS,
    });
    const text = visibleText(blockOf(page));
    expect(text).not.toMatch(/\bavailab/i);
    expect(text).not.toMatch(/free (spots?|pitch|places)/i);
    expect(text).not.toMatch(/vacanc/i);
    expect(text).not.toMatch(/guarantee|book/i);
    expect(text).toContain("We do not know whether any of these has room");
  });
});
