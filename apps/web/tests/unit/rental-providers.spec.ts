import { expect, test } from "@playwright/test";
import {
  arrange,
  filtersFromQuery,
  compare,
  countriesOf,
  hiddenByUnknownType,
  matches,
  NO_FILTERS,
  serviceCodesOf,
  type CamperType,
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
  camperTypeSlugs: [],
  untypedVehicleCount: 0,
  ...over,
});

const TYPES: CamperType[] = [
  { slug: "van", name: "Campervan", position: 10 },
  { slug: "caravan", name: "Caravan", position: 50 },
];

test.describe("звуження каталогу", () => {
  // 🔴 `some` замість `every` дав би «з душем АБО велокріпленням» там, де
  // читач просив «і те, і те», і він би цього не помітив: список просто
  // був би довшим, ніж має бути.
  test("🔴 обрані сервіси мусять бути ВСІ, а не хоча б один", () => {
    const both = p({ slug: "both", serviceCodes: ["one_way", "bike_rack"] });
    const one = p({ slug: "one", serviceCodes: ["bike_rack"] });
    const f = {
      country: null,
      services: ["one_way", "bike_rack"],
      camperType: null,
    };
    expect(matches(both, f)).toBe(true);
    expect(matches(one, f)).toBe(false);
  });

  test("країна звужує, порожня — ні", () => {
    const de = p({ homeCountry: "DE" });
    expect(matches(de, { country: "FR", services: [], camperType: null })).toBe(
      false,
    );
    expect(matches(de, { country: null, services: [], camperType: null })).toBe(
      true,
    );
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
      arrange(
        [b, a],
        { country: null, services: [], camperType: null },
        "fleet",
      ).map((x) => x.name),
    ).toEqual(["A", "B"]);
  });

  test("більше депо — вище", () => {
    const big = p({ slug: "big", name: "Big", declaredDepotCount: 50 });
    const small = p({ slug: "small", name: "Small", declaredDepotCount: 5 });
    expect(
      arrange(
        [small, big],
        { country: null, services: [], camperType: null },
        "depots",
      ).map((x) => x.slug),
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
      camperType: null,
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
    expect(filtersFromQuery("", all)).toEqual({
      country: null,
      services: [],
      camperType: null,
    });
  });
});

// 🔴 CAMP-371, пункт 3: фільтр «який вен чи причеп шукаєте» і число машин,
// схованих через невідомий тип.
//
// Кожне число нижче пораховане руками з трьох компаній:
//   alpha  — типи van+caravan, 2 машини без типу, DE
//   bravo  — тип van, 0 без типу, FR
//   charlie — жодного типу, 3 без типу, DE
test.describe("фільтр за типом", () => {
  const alpha = p({
    slug: "alpha",
    countries: ["DE"],
    vehicleCount: 4,
    camperTypeSlugs: ["van", "caravan"],
    untypedVehicleCount: 2,
  });
  const bravo = p({
    slug: "bravo",
    countries: ["FR"],
    vehicleCount: 1,
    camperTypeSlugs: ["van"],
    untypedVehicleCount: 0,
  });
  const charlie = p({
    slug: "charlie",
    countries: ["DE"],
    vehicleCount: 3,
    camperTypeSlugs: [],
    untypedVehicleCount: 3,
  });
  const all = [alpha, bravo, charlie];
  const van = { ...NO_FILTERS, camperType: "van" };

  test("🔴 обрав «ван» — лишаються лише ті, у кого ван названий; без типу не проходять", () => {
    expect(arrange(all, van, "name").map((x) => x.slug)).toEqual([
      "alpha",
      "bravo",
    ]);
    expect(matches(charlie, van)).toBe(false);
  });

  test("тип, якого ніхто не назвав, дає порожньо, а не всіх", () => {
    expect(
      arrange(all, { ...NO_FILTERS, camperType: "aclass" }, "name"),
    ).toEqual([]);
  });

  test("без обраного типу машини без типу нікого не ховають: нуль", () => {
    expect(hiddenByUnknownType(all, NO_FILTERS)).toBe(0);
  });

  // 🔴 Головна вимога картки: число, а не «деякі». 2 + 0 + 3 = 5, і
  // charlie рахується, хоч на екрані її немає — саме її машини й сховано.
  test("🔴 обрав «ван» — сховано 5 машин без типу, разом із тими, чиїх компаній не видно", () => {
    expect(hiddenByUnknownType(all, van)).toBe(5);
  });

  // 🔴 Число — по компаніях, що проходять РЕШТУ фільтрів: читачеві в FR
  // байдуже, скільки машин без типу в Німеччині.
  test("🔴 країна звужує і число схованих: у FR їх нуль, у DE — 5", () => {
    expect(hiddenByUnknownType(all, { ...van, country: "FR" })).toBe(0);
    expect(hiddenByUnknownType(all, { ...van, country: "DE" })).toBe(5);
  });

  test("число не залежить від того, який саме тип обрано", () => {
    expect(
      hiddenByUnknownType(all, { ...NO_FILTERS, camperType: "caravan" }),
    ).toBe(5);
  });

  test("тип з адреси береться лише з таксономії", () => {
    expect(filtersFromQuery("?type=van", all, TYPES).camperType).toBe("van");
    expect(filtersFromQuery("?type=lorry", all, TYPES).camperType).toBeNull();
    // Без таксономії тип з адреси не існує — а не вгадується зі слагів.
    expect(filtersFromQuery("?type=van", all).camperType).toBeNull();
  });
});
