import { expect, test } from "@playwright/test";

import ProviderCatalogue from "@/components/provider-catalogue";
import {
  arrange,
  countriesOf,
  hiddenByUnknownType,
  NO_FILTERS,
  type CamperType,
  type CatalogueFilters,
  type Provider,
} from "@/lib/rental-providers";
import { renderClient } from "./render-component";

// 🔴 CAMP-427, дірка в пункті 2 «Способу перевірки» — і CAMP-428.
//
// Доведено було лише те, що звужує ПРЕДИКАТ (`matches`, `arrange` —
// десять випадків у `rental-providers.spec.ts`). Чого доведено не було:
// що компонент показує САМЕ його результат. Компонент із власним
// переліком поруч пройшов би всі десять і показував би свій.
//
// Донедавна юніт цього не міг: харнес кликав компонент звичайною
// функцією, і `useState` падав. Межа була про `renderComponent`, а не
// про харнес — див. `renderClient`. Клік у справжньому браузері лишається
// в `tests/e2e/provider-catalogue.spec.ts`: тут перший кадр, там дія.

const P = (
  slug: string,
  countries: string[],
  serviceCodes: string[] = [],
): Provider => ({
  slug,
  name: slug.toUpperCase(),
  homeCountry: countries[0] ?? "DE",
  website: null,
  declaredDepotCount: null,
  declaredFleetSize: null,
  foundedYear: null,
  serviceCount: serviceCodes.length,
  vehicleCount: 0,
  reviewProfiles: [],
  serviceCodes,
  countries,
  camperTypeSlugs: [],
  untypedVehicleCount: 0,
});

// 🔴 CAMP-371. Таксономія для рендера — дві з пʼяти, і цього досить: тест
// перевіряє, що селект бере перелік із ПРОПСА, а не з константи. Якби
// компонент мав власний список, тут зʼявились би зайві три.
const TYPES: CamperType[] = [
  { slug: "van", name: "Campervan", position: 10 },
  { slug: "caravan", name: "Caravan", position: 50 },
];

// 🔴 КРАЇНА ПРОПИСКИ НАВМИСНО НЕ ЗБІГАЄТЬСЯ З КРАЇНАМИ ВИДАЧІ.
//
// Перша редакція цієї фікстури давала `homeCountry = countries[0]`, і
// множина країн прописки виходила ТОТОЖНОЮ множині країн видачі. Мутація
// «брати країну прописки замість країн видачі» пройшла повз: обидва
// вирази давали той самий перелік. Тепер `alfa` прописана в AT, а машини
// видає в DE і NL — і підміна стає видимою.
const ALL = [
  { ...P("alfa", ["DE", "NL"], ["unlimited_km"]), homeCountry: "AT" },
  P("bravo", ["FR"], ["unlimited_km", "bike_rack"]),
  P("charlie", ["NL"], ["bike_rack"]),
];

const render = (providers: Provider[], initial?: CatalogueFilters) =>
  renderClient(ProviderCatalogue, { all: providers, types: TYPES, initial });

/** Назви рядків у тому порядку, у якому їх віддає розмітка. */
function rowsIn(html: string): string[] {
  return [...html.matchAll(/data-testid="provider-row"[\s\S]*?<\/li>/g)]
    .map((m) => m[0].match(/>([A-Z]+)<\/a>/)?.[1] ?? "")
    .filter(Boolean);
}

test.describe("каталог показує саме те, що віддає предикат", () => {
  test("🔴 рядки на екрані дорівнюють arrange() на тих самих даних", () => {
    const expected = arrange(ALL, NO_FILTERS, "name").map((p) => p.name);
    // Щоб порожнє читання не пройшло за збіг.
    expect(expected.length).toBe(ALL.length);
    expect(rowsIn(render(ALL))).toEqual(expected);
  });

  test("знаменник надрукований — але СКІЛЬКИ відсіялось, доводить e2e", () => {
    // 🔴 МЕЖА, НАЗВАНА ВГОЛОС. Перший кадр рендериться БЕЗ фільтрів
    // (`useEffect` у статичному рендері не виконується), тому показане
    // й усе — те саме число. Мутація «знаменник = довжина показаного»
    // цей тест НЕ червонить, і я це заміряв, а не припустив.
    //
    // Тобто тут доводиться лише, що число друкується з даних, а не
    // зашите. Що знаменник лишається цілим, коли чисельник падає,
    // доводить `tests/e2e/provider-catalogue.spec.ts` справжнім кліком.
    expect(render(ALL)).toContain(`${ALL.length} of ${ALL.length}`);
    expect(render(ALL.slice(0, 2))).toContain("2 of 2");
  });

  test("🔴 селект пропонує країни ВИДАЧІ, а не країну прописки", () => {
    const html = render(ALL);
    // alfa прописана в AT і там машин НЕ видає.
    expect(countriesOf(ALL)).toEqual(["DE", "FR", "NL"]);
    for (const code of countriesOf(ALL)) {
      expect(html, code).toContain(`value="${code}"`);
    }
    // 🔴 І країни прописки в селекті бути не може: саме цим відрізняються
    // «компанія німецька» і «компанія видає машини в Німеччині».
    expect(html).not.toContain('value="AT"');
  });

  // 🔴 Підпис селекта й підписи сервісів тут НЕ перевіряються навмисно:
  // обидва змінює PR #425, якого ще немає в main. Твердження про них
  // живе там, разом зі зміною, а не тут — інакше цей файл був би зелений
  // на одному дереві й червоний на іншому, і причина була б невидима.
  test("порожній каталог не вдає, що щось показав", () => {
    const html = render([]);
    expect(rowsIn(html)).toEqual([]);
    expect(html).toContain("0 of 0");
  });
});

// 🔴 CAMP-371, пункт 3. Фільтр за типом і число схованих — У ВІДДАНІЙ
// РОЗМІТЦІ, а не в предикаті. Предикат доведений у
// `rental-providers.spec.ts`; тут — що компонент друкує саме його число.
//
// Пораховано руками:
//   alfa    — van, 2 машини без типу
//   bravo   — van + caravan, 0 без типу
//   charlie — жодного типу, 3 без типу
// «ван» → alfa і bravo; сховано 2 + 0 + 3 = 5.
const TYPED = [
  {
    ...ALL[0],
    vehicleCount: 3,
    camperTypeSlugs: ["van"],
    untypedVehicleCount: 2,
  },
  { ...ALL[1], vehicleCount: 2, camperTypeSlugs: ["van", "caravan"] },
  { ...ALL[2], vehicleCount: 3, untypedVehicleCount: 3 },
];
const VAN: CatalogueFilters = { ...NO_FILTERS, camperType: "van" };

test.describe("фільтр за типом у розмітці", () => {
  test("🔴 селект пропонує рівно типи з пропса, назвами, і жодного зайвого", () => {
    const html = render(TYPED);
    for (const t of TYPES) {
      expect(html, t.slug).toContain(`value="${t.slug}"`);
      expect(html, t.name).toContain(`>${t.name}<`);
    }
    // Три інші типи таксономії в пропсі НЕ передані — і в розмітці їх
    // бути не може: інакше перелік іде з константи, а не з бази.
    for (const absent of ["lowprofile", "coachbuilt", "aclass"]) {
      expect(html, absent).not.toContain(`value="${absent}"`);
    }
  });

  test("🔴 обраний тип: на екрані лише ті, хто його назвав", () => {
    const html = render(TYPED, VAN);
    expect(rowsIn(html)).toEqual(["ALFA", "BRAVO"]);
    expect(html).toContain("2 of 3");
  });

  test("🔴 число схованих через невідомий тип надруковане, і воно дорівнює підрахунку", () => {
    const html = render(TYPED, VAN);
    const m = html.match(
      /data-testid="hidden-by-type"[^>]*>(\d+) vehicles are not shown because their rental company does not state a type/,
    );
    expect(m, "рядок про сховані машини").not.toBeNull();
    expect(Number(m![1])).toBe(5);
    expect(hiddenByUnknownType(TYPED, VAN)).toBe(5);
    // І назва обраного типу — з таксономії, не слаг.
    expect(html).toContain("may be a campervan");
  });

  test("число йде з даних: інші дані — інше число", () => {
    const html = render(TYPED.slice(0, 2), VAN);
    expect(html).toMatch(/hidden-by-type"[^>]*>2 vehicles are not shown/);
  });

  test("нуль схованих — теж сказано словами, а не мовчанням", () => {
    const html = render([TYPED[1]], VAN);
    expect(html).toMatch(/hidden-by-type"[^>]*>No vehicle is hidden/);
  });

  test("без обраного типу рядка про сховані немає: ховати нічого", () => {
    expect(render(TYPED)).not.toContain('data-testid="hidden-by-type"');
  });

  test("рядок компанії каже, які типи вона назвала і скільки моделей без типу", () => {
    const html = render(TYPED);
    expect(html).toContain("types stated: campervan · 2 without a stated type");
    expect(html).toContain("types stated: campervan, caravan");
    expect(html).toContain("no vehicle type stated for its 3 models");
  });
});
