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
  /**
   * 🔴 CAMP-371. Слаги типів, які прокатник САМ назвав хоча б для однієї
   * машини. Фільтр за типом звужує саме по цьому полю.
   */
  camperTypeSlugs: string[];
  /**
   * 🔴 CAMP-371. Машини, де прокатник ніде не написав тип, — порахованe в
   * SQL (`rental-providers.service.ts`). Коли читач обирає тип, сума
   * цього поля — те, що він МУСИТЬ побачити: інакше «0 of 36» читається
   * як «таких машин немає», а правда — «про 48 ми не знаємо».
   */
  untypedVehicleCount: number;
}

/** Відповідь `/rental/camper-types` — пʼять типів таксономії, з бази. */
export interface CamperType {
  slug: string;
  name: string;
  position: number;
}

export const SERVICE_LABEL: Record<string, string> = {
  unlimited_km: "unlimited mileage",
  one_way: "one way",
  pets_allowed: "pets allowed",
  bedding: "bedding",
  bike_rack: "bike rack",
  winter_tyres: "winter tyres",
  excess_reduction: "excess reduction",
  additional_driver: "additional driver",
  airport_transfer: "airport transfer",
  awning: "awning",
  camping_table_chairs: "table and chairs",
  gps: "sat nav",
  child_seat: "child seat",
  cleaning_service: "cleaning",
  young_driver: "young driver",
};

/**
 * 🔴 ОДИН ПІДПИС НА ВЕСЬ ПРОЄКТ.
 *
 * Донедавна їх було два: каталог читав цю таблицю, а сторінка однієї
 * компанії друкувала `code.replace(/_/g, " ")` — тобто «unlimited km»
 * там, де в каталозі стояло «unlimited mileage». Дві назви однієї речі
 * на двох сторінках одного сайту — і розійшлись вони мовчки. Тепер
 * формула одна, і розмітка бере її ж, щоб граф і текст не сказали
 * різного.
 */
export const serviceLabel = (code: string) =>
  SERVICE_LABEL[code] ?? code.replace(/_/g, " ");

/** Відповідь `/rental/providers/{slug}` — сторінка однієї компанії. */
export interface ServiceRow {
  code: string;
  availability: "included" | "extra" | "unavailable";
  note: string | null;
  source_url: string | null;
  source_checked_on: string | null;
}

export interface VehicleRow {
  name: string;
  slug: string;
  berths: number | null;
  belted_seats: number | null;
  length_cm: number | null;
  /**
   * 🔴 CAMP-371. ТИП — ЦЕ ТВЕРДЖЕННЯ ПРОКАТНИКА, А НЕ НАШ ВИСНОВОК.
   *
   * Тому поруч їде `camper_type_said` — його дослівні слова — і власна
   * дата: парк прочитаний 02.11.2026, типи 03.11. Тип є у 30 машин зі
   * 115; решта лишаються без нього, бо довжина підказала б майже завжди
   * правильно, а майже-завжди-правильно про чужу машину це вигадка.
   */
  camper_type_slug: string | null;
  camper_type_name: string | null;
  camper_type_said: string | null;
  camper_type_checked_on: string | null;
  /**
   * 🔴 CAMP-371: ДАТА ПРОЧИТАННЯ — ЧАСТИНА ТВЕРДЖЕННЯ, А НЕ МЕТАДАНІ.
   *
   * «У них є Hymer B-Class» без дати — це твердження про СЬОГОДНІ, якого
   * ми не перевіряли: машину могли продати минулого місяця. Умова
   * картки дослівно: «кожен запис несе дату прочитання, і вона показана
   * читачеві».
   *
   * API віддавав ці два поля від самого початку
   * (`rental-providers.service.ts:219`) — їх просто ніхто не читав.
   */
  source_url: string | null;
  source_checked_on: string | null;
}

export interface ProviderPage {
  slug: string;
  name: string;
  intro: string | null;
  whatToKnow: string | null;
  legalName: string | null;
  registrationNumber: string | null;
  homeCountry: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  declaredDepotCount: number | null;
  declaredFleetSize: number | null;
  foundedYear: number | null;
  sourceUrl: string | null;
  sourceCheckedOn: string | null;
  services: ServiceRow[];
  vehicles: VehicleRow[];
  reviewProfiles: { source: string; profileUrl: string }[];
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
  /** Слаг типу з таксономії (`CamperType.slug`) або `null` — без фільтра. */
  camperType: string | null;
}

export const NO_FILTERS: CatalogueFilters = {
  country: null,
  services: [],
  camperType: null,
};

/**
 * 🔴 КОЖЕН ОБРАНИЙ СЕРВІС МУСИТЬ БУТИ, А НЕ «ХОЧА Б ОДИН».
 *
 * `some` замість `every` дав би фільтр «з душем АБО велокріпленням» там,
 * де читач просив «і те, і те» — і він би цього не помітив, бо список
 * просто був би довшим, ніж має бути.
 *
 * Тип — «компанія має хоча б одну машину цього типу, названого нею
 * самою». Машина без типу не проходить і не має проходити: ми не знаємо,
 * що вона таке. Скільки таких — каже `hiddenByUnknownType`.
 */
export function matches(p: Provider, f: CatalogueFilters): boolean {
  if (f.country && !p.countries.includes(f.country)) return false;
  if (f.camperType && !p.camperTypeSlugs.includes(f.camperType)) return false;
  return f.services.every((code) => p.serviceCodes.includes(code));
}

/**
 * 🔴 CAMP-371. СКІЛЬКИ МАШИН СХОВАНО НЕ ТОМУ, ЩО ВОНИ НЕ ТОГО ТИПУ, А
 * ТОМУ, ЩО ТИП НЕВІДОМИЙ.
 *
 * Тип відомий у 67 машин зі 115 (замір `seed-camper-types.mjs --dry-run`,
 * 04.11.2026). Решта 48 — ті, де прокатник ніде не написав тип, і
 * вигадувати його заборонено. Читач, що обрав «ван» і побачив 15 компаній,
 * мусить бачити й це число: інакше він вирішить, що решти машин у нас
 * просто немає, і це буде брехня мовчанням.
 *
 * Рахується по компаніях, що проходять РЕШТУ фільтрів (країна, сервіси),
 * а тип не береться до уваги: саме серед них машини без типу й могли б
 * виявитись шуканими. Без обраного типу число — нуль: ховати нічого.
 */
export function hiddenByUnknownType(
  all: Provider[],
  f: CatalogueFilters,
): number {
  if (!f.camperType) return 0;
  const others: CatalogueFilters = { ...f, camperType: null };
  return all
    .filter((p) => matches(p, others))
    .reduce((n, p) => n + p.untypedVehicleCount, 0);
}

/** Назва типу з таксономії; слаг, якого там немає, віддається як є. */
export const camperTypeName = (types: CamperType[], slug: string): string =>
  types.find((t) => t.slug === slug)?.name ?? slug;

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
  types: CamperType[] = [],
): CatalogueFilters {
  const q = new URLSearchParams(search);
  const country = (q.get("country") ?? "").toUpperCase();
  const known = new Set(all.flatMap((p) => p.countries));
  const codes = new Set(all.flatMap((p) => p.serviceCodes));
  // Тип — лише з таксономії, а не «будь-який слаг, що трапляється»: тип,
  // якого ще ніхто не назвав, усе одно законний і дає «0 of N» із
  // поясненням, скільки машин без типу.
  const type = q.get("type") ?? "";
  return {
    country: known.has(country) ? country : null,
    services: (q.get("services") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => codes.has(c)),
    camperType: types.some((t) => t.slug === type) ? type : null,
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

/**
 * 🔴 ТАКСОНОМІЯ З БАЗИ, А НЕ З КОНСТАНТИ. Пʼять типів засіяні з
 * `camper-types.seed.json`, де кожен несе джерело; перелік у коді був би
 * другим описом того самого, і розійшлися б вони тихо. Порожня
 * відповідь — порожній селект, і сторінка так і каже.
 */
export async function listCamperTypes(): Promise<CamperType[]> {
  const res = await apiFetch("/rental/camper-types", {
    next: { revalidate: 86_400 },
  });
  if (!res.ok) return [];
  return (await res.json()) as CamperType[];
}

/**
 * 🔴 CAMP-463: ДАТА ДЛЯ ЧИТАЧА, А НЕ ISO. База віддає `2026-11-03T00:00:00.000Z`
 * (колонка `date`, що пройшла через JSON), і сторінка друкувала це
 * слово в слово — 16 разів на одній сторінці компанії. Тепер:
 * `3 November 2026`. Машині дата лишається в `datetime` елемента
 * `<time>` (див. `Day` на сторінці компанії).
 *
 * Значення, яке не схоже на дату, повертається як є: краще бачити, що
 * база віддала щось дивне, ніж написати вигадану дату. Саме це й
 * ловить сторож `check-no-internal-disclosure` — ISO-формат у видимому
 * тексті.
 */
export function readableDay(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value);
  if (!m) return value;
  const d = new Date(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The day to put in a `datetime` attribute: date only, no clock. */
export function isoDay(value: string): string | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value);
  return m ? m[1] : undefined;
}

/**
 * 🔴 CAMP-463: ЗАЯВЛЕНИЙ МАСШТАБ — ПЕРЕЛІК ТОГО, ЩО Є, А НЕ РЯДОК ІЗ
 * РОЗДІЛЮВАЧЕМ ПІСЛЯ КОЖНОЇ ЧАСТИНИ. Раніше сторінка компанії друкувала
 * `depots: 1 · fleet: 3 · ` — крапка стоїть, значення немає, бо року
 * заснування не було. Роздільник ставить той, хто зʼєднує (`.join(' · ')`),
 * тож обірвати його нікому.
 *
 * Слова, а не ключі: «1 depot», «fleet of 3», а не `depots: 1`.
 */
export function scaleParts(p: {
  declaredDepotCount: number | null;
  declaredFleetSize: number | null;
  foundedYear: number | null;
}): string[] {
  const parts: string[] = [];
  if (p.declaredDepotCount !== null) {
    parts.push(
      `${p.declaredDepotCount} ${p.declaredDepotCount === 1 ? 'depot' : 'depots'}`,
    );
  }
  if (p.declaredFleetSize !== null) {
    parts.push(`fleet of ${p.declaredFleetSize}`);
  }
  if (p.foundedYear !== null) parts.push(`trading since ${p.foundedYear}`);
  return parts;
}
