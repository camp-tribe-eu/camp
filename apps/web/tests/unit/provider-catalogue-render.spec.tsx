import { expect, test } from "@playwright/test";

import ProviderCatalogue from "@/components/provider-catalogue";
import {
  arrange,
  countriesOf,
  NO_FILTERS,
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
});

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

const render = (providers: Provider[]) =>
  renderClient(ProviderCatalogue, { all: providers });

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
