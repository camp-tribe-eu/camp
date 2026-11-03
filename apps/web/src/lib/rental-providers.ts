// CAMP-427 — каталог прокатних компаній на боці сайту.
//
// 🔴 ФІЛЬТР ЖИВЕ В ОДНОМУ МІСЦІ. Сайт статичний: усі ~10 компаній
// приїжджають у збірку одним запитом, а звуження робить браузер. Якби
// предикат був у компоненті, а в API — свій SQL, ми мали б ДВА описи
// одного правила, і розійшлися б вони тихо. Тому правило тут, а
// компонент його лише викликає; за SQL у `rental-providers.service.ts`
// стоїть свій тест, і обидва перевіряють ту саму поведінку:
// «сервіс є» означає `included` АБО `extra`, ніколи `unavailable`.

import { apiFetch } from "./api";

export interface ReviewProfile {
  source: string;
  profileUrl: string;
  /**
   * 🔴 ЗАВЖДИ `null`, доки немає письмового дозволу показувати цифру.
   * Тип лишає місце навмисно: коли дозвіл прийде, сторінка не
   * переписується — заповнюється поле. Умови Trustpilot забороняють і
   * збір, і показ TrustScore без дозволу; Google дозволяє лише через
   * платний Places API.
   */
  rating: string | null;
  reviewCount: number | null;
}

export interface Provider {
  slug: string;
  name: string;
  homeCountry: string;
  website: string | null;
  /** 🔴 ЗАЯВЛЕНІ компанією, не зміряні нами — сторінка це каже словами. */
  declaredDepotCount: number | null;
  declaredFleetSize: number | null;
  foundedYear: number | null;
  serviceCount: number;
  vehicleCount: number;
  reviewProfiles: ReviewProfile[];
  /** Коди сервісів, які компанія дає (`included` або `extra`). */
  serviceCodes: string[];
  /**
   * 🔴 Країни, де компанія ВИДАЄ МАШИНИ, а не де зареєстрована. Саме за
   * цим звужує фільтр: читачеві в Нідерландах байдуже, що компанія
   * німецька, якщо депо є в Амстердамі.
   */
  countries: string[];
}

export const SORT_KEYS = ["name", "depots", "fleet", "oldest"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABEL: Record<SortKey, string> = {
  name: "name",
  depots: "most depots",
  fleet: "largest fleet",
  oldest: "oldest first",
};

export interface CatalogueFilters {
  country: string | null;
  services: string[];
}

export const NO_FILTERS: CatalogueFilters = { country: null, services: [] };

/**
 * 🔴 КОЖЕН ОБРАНИЙ СЕРВІС МУСИТЬ БУТИ, А НЕ «ХОЧА Б ОДИН».
 *
 * `some` замість `every` дав би фільтр «з душем АБО велокріпленням» там,
 * де читач просив «і те, і те» — і він би цього не помітив, бо список
 * просто був би довшим, ніж має бути.
 */
export function matches(p: Provider, f: CatalogueFilters): boolean {
  if (f.country && !p.countries.includes(f.country)) return false;
  return f.services.every((code) => p.serviceCodes.includes(code));
}

/**
 * Порівняння для сортування. `null` завжди в кінець: компанія, про яку
 * ми не знаємо числа, не має опинятись попереду тієї, про яку знаємо —
 * це читалось би як «у неї нуль депо».
 */
export function compare(a: Provider, b: Provider, key: SortKey): number {
  const byName = a.name.localeCompare(b.name);
  const desc = (x: number | null, y: number | null) => {
    if (x === y) return byName;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  };
  switch (key) {
    case "depots":
      return desc(a.declaredDepotCount, b.declaredDepotCount);
    case "fleet":
      return desc(a.declaredFleetSize, b.declaredFleetSize);
    case "oldest": {
      const x = a.foundedYear;
      const y = b.foundedYear;
      if (x === y) return byName;
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y;
    }
    default:
      return byName;
  }
}

/**
 * Фільтри з рядка запиту — лише ті значення, які справді є в каталозі.
 *
 * 🔴 ЧУЖЕ ЗНАЧЕННЯ ІГНОРУЄТЬСЯ, А НЕ ЗВУЖУЄ СПИСОК ДО ПОРОЖНЬОГО.
 * `?country=ZZ` з чужого посилання або з друкарської помилки дав би
 * «0 із 10» без жодного пояснення, і читач вирішив би, що каталог
 * порожній. Показати все й не застосувати неіснуючу умову — чесніше.
 *
 * Правило тут, а не в компоненті, бо воно мусить мати тест: у
 * клієнтському компоненті з `useState` наш рендер його не виконує.
 */
export function filtersFromQuery(
  search: string,
  all: Provider[],
): CatalogueFilters {
  const q = new URLSearchParams(search);
  const country = (q.get("country") ?? "").toUpperCase();
  const known = new Set(all.flatMap((p) => p.countries));
  const codes = new Set(all.flatMap((p) => p.serviceCodes));
  return {
    country: known.has(country) ? country : null,
    services: (q.get("services") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => codes.has(c)),
  };
}

export function arrange(
  all: Provider[],
  f: CatalogueFilters,
  key: SortKey,
): Provider[] {
  return all.filter((p) => matches(p, f)).sort((a, b) => compare(a, b, key));
}

/** Країни, які справді є в каталозі — перелік не вигадується. */
export const countriesOf = (all: Provider[]): string[] =>
  [...new Set(all.flatMap((p) => p.countries))].sort();

/** Коди сервісів, які справді трапляються — так само. */
export const serviceCodesOf = (all: Provider[]): string[] =>
  [...new Set(all.flatMap((p) => p.serviceCodes))].sort();

export async function listProviders(): Promise<Provider[]> {
  const res = await apiFetch("/rental/providers", {
    next: { revalidate: 86_400 },
  });
  if (!res.ok) return [];
  return (await res.json()) as Provider[];
}
