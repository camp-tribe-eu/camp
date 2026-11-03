import { expect, test } from "@playwright/test";
import {
  arrange,
  filtersFromQuery,
  compare,
  countriesOf,
  matches,
  serviceCodesOf,
  type Provider,
} from "@/lib/rental-providers";

const p = (over: Partial<Provider>): Provider => ({
  slug: "x",
  name: "X",
  homeCountry: "DE",
  website: null,
  declaredDepotCount: null,
  declaredFleetSize: null,
  foundedYear: null,
  serviceCount: 0,
  vehicleCount: 0,
  reviewProfiles: [],
  serviceCodes: [],
  countries: ["DE"],
  ...over,
});

test.describe("звуження каталогу", () => {
  // 🔴 `some` замість `every` дав би «з душем АБО велокріпленням» там, де
  // читач просив «і те, і те», і він би цього не помітив: список просто
  // був би довшим, ніж має бути.
  test("🔴 обрані сервіси мусять бути ВСІ, а не хоча б один", () => {
    const both = p({ slug: "both", serviceCodes: ["one_way", "bike_rack"] });
    const one = p({ slug: "one", serviceCodes: ["bike_rack"] });
    const f = { country: null, services: ["one_way", "bike_rack"] };
    expect(matches(both, f)).toBe(true);
    expect(matches(one, f)).toBe(false);
  });

  test("країна звужує, порожня — ні", () => {
    const de = p({ homeCountry: "DE" });
    expect(matches(de, { country: "FR", services: [] })).toBe(false);
    expect(matches(de, { country: null, services: [] })).toBe(true);
  });

  test("перелік країн і сервісів береться з даних, а не з константи", () => {
    const all = [
      p({
        slug: "a",
        homeCountry: "FR",
        countries: ["FR"],
        serviceCodes: ["gps"],
      }),
      p({
        slug: "b",
        homeCountry: "DE",
        countries: ["DE"],
        serviceCodes: ["gps", "awning"],
      }),
    ];
    expect(countriesOf(all)).toEqual(["DE", "FR"]);
    expect(serviceCodesOf(all)).toEqual(["awning", "gps"]);
  });
});

test.describe("сортування", () => {
  // 🔴 Невідоме число не має ставати попереду відомого: це читалось би як
  // «у неї нуль депо», тобто як твердження про чужий бізнес.
  test("🔴 null завжди в кінці, і при спаданні, і при зростанні", () => {
    const known = p({
      slug: "k",
      name: "K",
      declaredDepotCount: 3,
      foundedYear: 1990,
    });
    const unknown = p({ slug: "u", name: "A" });
    expect(compare(unknown, known, "depots")).toBeGreaterThan(0);
    expect(compare(unknown, known, "oldest")).toBeGreaterThan(0);
  });

  test("рівні значення впорядковуються назвою, а не випадково", () => {
    const b = p({ slug: "b", name: "B", declaredFleetSize: 10 });
    const a = p({ slug: "a", name: "A", declaredFleetSize: 10 });
    expect(
      arrange([b, a], { country: null, services: [] }, "fleet").map(
        (x) => x.name,
      ),
    ).toEqual(["A", "B"]);
  });

  test("більше депо — вище", () => {
    const big = p({ slug: "big", name: "Big", declaredDepotCount: 50 });
    const small = p({ slug: "small", name: "Small", declaredDepotCount: 5 });
    expect(
      arrange([small, big], { country: null, services: [] }, "depots").map(
        (x) => x.slug,
      ),
    ).toEqual(["big", "small"]);
  });
});

test.describe("фільтр з адреси", () => {
  const all = [
    p({ slug: "de", homeCountry: "DE", serviceCodes: ["one_way", "gps"] }),
    p({ slug: "fr", homeCountry: "FR", serviceCodes: ["gps"] }),
  ];

  test("країна й сервіси з адреси застосовуються", () => {
    expect(filtersFromQuery("?country=de&services=gps", all)).toEqual({
      country: "DE",
      services: ["gps"],
    });
  });

  // 🔴 `?country=ZZ` із чужого посилання або з друкарської помилки дав би
  // «0 із 10» без пояснення, і читач вирішив би, що каталог порожній.
  test("🔴 країни, якої немає в каталозі, не існує для фільтра", () => {
    expect(filtersFromQuery("?country=ZZ", all).country).toBeNull();
  });

  test("🔴 код сервісу, якого немає, відкидається, а решта лишається", () => {
    expect(filtersFromQuery("?services=gps,nonsense", all).services).toEqual([
      "gps",
    ]);
  });

  test("порожня адреса — порожній фільтр", () => {
    expect(filtersFromQuery("", all)).toEqual({ country: null, services: [] });
  });
});
