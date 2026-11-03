import { expect, test } from "@playwright/test";

import {
  PROVIDER_TYPE_EVIDENCE,
  providerGraph,
  providerPath,
} from "@/lib/provider-jsonld";
import { SERVICE_LABEL, type ProviderPage } from "@/lib/rental-providers";

// 🔴 CAMP-431 (пункт 4). ПРАВИЛО КАРТКИ ДОСЛІВНО: «додаємо лише ту
// розмітку, під якою є справжні дані з джерелом».
//
// Тому тут перевіряється не «граф валідний» — цього мало. Перевіряється,
// що КОЖЕН тип у графі має факт, який його виправдовує, і що типу, під
// яким факту немає, у графі НЕМАЄ. Різниця між цими двома твердженнями —
// це вся цінність файлу: валідний граф із вигаданим `aggregateRating`
// пройшов би словник бездоганно.

// Playwright компілює ці специфікації в CommonJS, тож ESM-перевіряльник
// не може бути статичним імпортом — він підтягується динамічно. Копія
// його правил тут розійшлася б із оригіналом, і розійшлася б саме та,
// якій вірять тести.
let validateHtml: (
  html: string,
  label: string,
) => { count: number; errors: string[] };

test.beforeAll(async () => {
  ({ validateHtml } =
    await import("../../../../scripts/seo/check-structured-data.mjs"));
});

const FULL: ProviderPage = {
  slug: "nordic-campers",
  name: "Nordic Campers",
  intro: "A Finnish company that hands over vehicles at four depots.",
  whatToKnow: "Winter tyres are fitted from October to April.",
  legalName: "Nordic Campers Oy",
  registrationNumber: "FI12345678",
  homeCountry: "FI",
  website: "https://example.test",
  email: "hello@example.test",
  phone: "+358 40 000 0000",
  declaredDepotCount: 4,
  declaredFleetSize: 60,
  foundedYear: 2011,
  sourceUrl: "https://example.test/about",
  sourceCheckedOn: "2026-11-03",
  services: [
    {
      code: "unlimited_km",
      availability: "included",
      note: null,
      source_url: null,
      source_checked_on: null,
    },
    {
      code: "bike_rack",
      availability: "extra",
      note: null,
      source_url: null,
      source_checked_on: null,
    },
    {
      code: "one_way",
      availability: "unavailable",
      note: null,
      source_url: null,
      source_checked_on: null,
    },
  ],
  vehicles: [
    {
      name: "Compact 540",
      slug: "compact-540",
      berths: 4,
      belted_seats: 4,
      length_cm: 540,
      source_url: "https://example.test/fleet",
      source_checked_on: "2026-11-03",
    },
  ],
  reviewProfiles: [
    { source: "trustpilot", profileUrl: "https://example.test/review" },
  ],
};

/** Компанія, про яку ми не знаємо нічого, крім назви. */
const BARE: ProviderPage = {
  ...FULL,
  slug: "bare",
  intro: null,
  whatToKnow: null,
  legalName: null,
  registrationNumber: null,
  website: null,
  email: null,
  phone: null,
  declaredDepotCount: null,
  declaredFleetSize: null,
  foundedYear: null,
  sourceUrl: null,
  sourceCheckedOn: null,
  services: [],
  vehicles: [],
  reviewProfiles: [],
};

/** Усі `@type`, що справді стоять у графі. */
function typesIn(doc: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec["@type"] === "string") found.push(rec["@type"] as string);
    Object.values(rec).forEach(walk);
  };
  walk(doc);
  return found;
}

function htmlFor(p: ProviderPage): string {
  const doc = providerGraph(p, providerPath(p.slug));
  return `<script type="application/ld+json">${JSON.stringify(doc).replace(
    /</g,
    "\\u003c",
  )}</script>`;
}

test.describe("CAMP-431: граф сторінки компанії", () => {
  test("🔴 проходить той самий словник, що й решта сайту", () => {
    for (const p of [FULL, BARE]) {
      const { count, errors } = validateHtml(htmlFor(p), p.slug);
      // Знаменник названий: один блок, і він справді прочитаний.
      expect(count, p.slug).toBe(1);
      expect(errors, p.slug).toEqual([]);
    }
  });

  test("🔴 перевіряльник НЕ сліпий — зламаний граф він валить", () => {
    const broken = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "AutoRental",
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.7" },
      inventedProperty: "x",
    })}</script>`;
    const { errors } = validateHtml(broken, "broken");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toContain("inventedProperty");
  });

  test("🔴 кожен тип у графі має факт, що його виправдовує", () => {
    for (const p of [FULL, BARE]) {
      const types = new Set(typesIn(providerGraph(p, providerPath(p.slug))));
      expect(types.size, p.slug).toBeGreaterThan(3);
      for (const t of types) {
        const evidence = PROVIDER_TYPE_EVIDENCE[t];
        expect(
          evidence,
          `${p.slug}: тип ${t} нічим не оголошений`,
        ).toBeTruthy();
        expect(evidence(p), `${p.slug}: тип ${t} стоїть без факту`).toBe(true);
      }
    }
  });

  test("🔴 типу без факту в графі немає", () => {
    const types = new Set(typesIn(providerGraph(BARE, providerPath("bare"))));
    // Нема сервісів і машин — нема ні Offer, ні Service, ні Vehicle.
    for (const t of ["Offer", "Service", "Vehicle"]) {
      expect(types.has(t), t).toBe(false);
    }
    // І навпаки: там, де дані є, вони є.
    const full = new Set(typesIn(providerGraph(FULL, providerPath("x"))));
    for (const t of ["Offer", "Service", "Vehicle", "AutoRental"]) {
      expect(full.has(t), t).toBe(true);
    }
  });

  test("🔴 ні оцінки, ні ціни — у жодному вигляді", () => {
    const text = JSON.stringify(providerGraph(FULL, providerPath("x")));
    for (const forbidden of [
      "aggregateRating",
      "ratingValue",
      "reviewCount",
      "priceRange",
      '"price"',
      "priceCurrency",
      "Review",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // Щоб відсутність щось означала: рядок справді не порожній.
    expect(text.length).toBeGreaterThan(400);
  });

  test("🔴 сервіс, якого компанія не дає, у граф не потрапляє", () => {
    const doc = JSON.stringify(providerGraph(FULL, providerPath("x")));
    expect(doc).toContain(SERVICE_LABEL.unlimited_km);
    expect(doc).toContain(SERVICE_LABEL.bike_rack);
    // `one_way` стоїть як `unavailable` — у розмітці його бути не може.
    expect(doc).not.toContain(SERVICE_LABEL.one_way);
  });

  test("підпис сервісу в графі той самий, що на сторінці", () => {
    const doc = JSON.stringify(providerGraph(FULL, providerPath("x")));
    // Саме «unlimited mileage», а не «unlimited km»: два підписи однієї
    // речі вже розійшлись одного разу, тому тут названо точний рядок.
    expect(doc).toContain("unlimited mileage");
    expect(doc).not.toContain("unlimited km");
  });

  test("профіль відгуків стоїть як sameAs, а не як оцінка", () => {
    const g = providerGraph(FULL, providerPath("x")) as {
      "@graph": Record<string, unknown>[];
    };
    const company = g["@graph"].find((n) => n["@type"] === "AutoRental");
    expect(company?.sameAs).toEqual(["https://example.test/review"]);
  });
});
