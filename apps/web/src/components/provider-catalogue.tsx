"use client";

import { useEffect, useMemo, useState } from "react";
import Checkbox from "./checkbox";
import { SELECT_CHEVRON_ROOM, SelectChevron } from "./select-chevron";
import { Flag } from "./flag";
import MediaCards from "./media-card";
import { countryName } from "@/lib/api";
import { isUnpublishedCountry } from "@/lib/unpublished-countries";
import {
  NO_FILTERS,
  SORT_KEYS,
  SORT_LABEL,
  arrange,
  camperTypeName,
  countriesOf,
  filtersFromQuery,
  hiddenByUnknownType,
  scaleParts,
  serviceCodesOf,
  serviceLabel,
  type CamperType,
  type CatalogueFilters,
  type Provider,
  type SortKey,
} from "@/lib/rental-providers";

// CAMP-427 — вибір провайдера: селекти, сортування, список.
//
// 🔴 НІЧОГО НЕ ХОВАЄТЬСЯ НА ВУЗЬКОМУ ЕКРАНІ, і це рішення, а не лінощі.
// Та сама причина, що в `map-filters.tsx`: фільтр за кнопкою, яка не
// відкрилась, — це фільтр, якого немає, і помітити це нікому. Усі
// контролі в документі на будь-якій ширині й просто переносяться.
//
// 🔴 ЦИФР РЕЙТИНГУ ТУТ НЕМАЄ НАВМИСНО. Умови Trustpilot забороняють і
// збір, і показ TrustScore без їхнього письмового дозволу; Google
// дозволяє лише через платний Places API. Тому показуємо НАЗВУ джерела
// як підпис посилання — назва це вказівник, куди веде лінк, а не їхній
// контент. Коли дозвіл прийде, цифра стане доданим полем, а не
// переробкою цього файлу.

const SOURCE_LABEL: Record<string, string> = {
  trustpilot: "Trustpilot",
  google: "Google",
};

export default function ProviderCatalogue({
  all,
  types,
  initial = NO_FILTERS,
}: {
  all: Provider[];
  /** 🔴 CAMP-371. Таксономія з бази (`/rental/camper-types`), не константа. */
  types: CamperType[];
  /**
   * Фільтри першого кадру. Сторінка їх не передає (статична збірка не
   * знає адреси); існує, щоб юніт міг прочитати ВІДДАНУ розмітку з
   * обраним типом — число схованих машин, а не константу чи клас.
   */
  initial?: CatalogueFilters;
}) {
  const [filters, setFilters] = useState<CatalogueFilters>(initial);
  const [sort, setSort] = useState<SortKey>("name");

  // 🔴 ПОЧАТКОВИЙ ФІЛЬТР ІЗ АДРЕСИ — ПІСЛЯ МОНТУВАННЯ, А НЕ В useState.
  //
  // Сторінка статична: сервер рендерить її БЕЗ параметрів запиту, бо на
  // момент збірки їх не існує. Прочитати `location.search` в ініціалізаторі
  // `useState` означало б віддати клієнтом інше дерево, ніж прийшло з
  // сервера, — класична розбіжність гідратації, яку React 19 у продакшні
  // навіть не пояснює (CAMP-349). Тому читаємо в ефекті: один зайвий кадр
  // без фільтра чесніший за зламану гідратацію.
  //
  // Значення з адреси проходить ті самі перевірки, що й клік: країна
  // мусить бути серед тих, що справді є в каталозі, сервіс — серед кодів,
  // які справді трапляються. Чуже значення з адреси просто ігнорується,
  // а не звужує список до порожнього без пояснення.
  useEffect(() => {
    const next = filtersFromQuery(window.location.search, all, types);
    if (next.country || next.services.length || next.camperType)
      setFilters(next);
  }, [all, types]);

  // 🔴 Кіпр не показуємо (рішення власника 26.10.2026): у даних компаній
  // він є, у переліку для читача — ні.
  const countries = useMemo(
    () => countriesOf(all).filter((c) => !isUnpublishedCountry(c)),
    [all],
  );
  const services = useMemo(() => serviceCodesOf(all), [all]);
  const shown = useMemo(
    () => arrange(all, filters, sort),
    [all, filters, sort],
  );
  // 🔴 CAMP-371. Сума порахованих у SQL `untypedVehicleCount` по компаніях,
  // що проходять решту фільтрів. Правило — в `lib/rental-providers.ts`,
  // де в нього є тест; тут лише виклик.
  const hidden = useMemo(
    () => hiddenByUnknownType(all, filters),
    [all, filters],
  );

  return (
    <div data-testid="provider-catalogue">
      {/* 🔴 CAMP-461: ФІЛЬТРИ — БОКОВА ПАНЕЛЬ ІЗ ЗНАЧКАМИ, ВИДИМА ЗАВЖДИ.
          Власник (CAMP-444/10, 11, 20): «сортування збоку з іконками… я не
          хотів би, щоб воно було сховане за замовчуванням». На вузькому
          екрані панель стає блоком НАД списком, а не шухлядою за кнопкою:
          та сама причина, що вище («фільтр за кнопкою, яка не відкрилась,
          — це фільтр, якого немає»). */}
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <aside
          aria-label="Filters"
          data-testid="catalogue-filters"
          className="flex flex-col gap-5 rounded-card border border-line-2 bg-surface p-5 lg:sticky lg:top-24"
        >
          {/* 🔴 «Hands over vehicles in», а не «home country».
              Підпис казав «країна компанії», а фільтр читав `p.countries` —
              країни, де компанія ВИДАЄ МАШИНИ. Читач у Нідерландах обирав
              NL, очікуючи голландські компанії, і отримував німецьку з депо
              в Амстердамі — тобто саме те, що йому й потрібно, але не те,
              що йому пообіцяли. Рішення вже записане в CAMP-421. */}
          <label className="flex flex-col gap-2 text-sm font-semibold text-heading">
            <span className="inline-flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
              Hands over vehicles in
            </span>
            <div className="relative">
              <select
                data-testid="filter-country"
                className={`h-12 w-full rounded border border-line bg-surface ps-3 text-base font-normal text-ink ${SELECT_CHEVRON_ROOM}`}
                value={filters.country ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, country: e.target.value || null }))
                }
              >
                <option value="">all</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {countryName(c)}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </label>

          {/* 🔴 CAMP-371. «Vehicle type the company states», і це не стиль.
              Тип стоїть лише там, де прокатник сам його написав
              (`camper_type_said` поруч із кожним). Машина без типу не
              проходить фільтр — і скільки їх, сторінка каже числом нижче,
              а не мовчить. Перелік типів — із бази, не з константи. */}
          <label className="flex flex-col gap-2 text-sm font-semibold text-heading">
            <span className="inline-flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M2.5 16.5V8A1.5 1.5 0 0 1 4 6.5h10.5a2 2 0 0 1 1.6.8l3.4 4.4a2 2 0 0 1 .4 1.2v3.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2.5 16.5h2M9 16.5h6M20 16.5h1.5M14.5 6.5v5.5h5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6.8" cy="16.7" r="2" />
                <circle cx="17.2" cy="16.7" r="2" />
              </svg>
              Vehicle type the company states
            </span>
            <div className="relative">
              <select
                data-testid="filter-type"
                className={`h-12 w-full rounded border border-line bg-surface ps-3 text-base font-normal text-ink ${SELECT_CHEVRON_ROOM}`}
                value={filters.camperType ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    camperType: e.target.value || null,
                  }))
                }
              >
                <option value="">any</option>
                {types.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-heading">
            <span className="inline-flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sort by
            </span>
            <div className="relative">
              <select
                data-testid="sort"
                className={`h-12 w-full rounded border border-line bg-surface ps-3 text-base font-normal text-ink ${SELECT_CHEVRON_ROOM}`}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                {SORT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </label>

          {/* 🔴 CAMP-461: ГАЛОЧКА З КВАДРАТИКОМ, А НЕ ПІГУЛКА. Власник
              (443/19): «не зрозуміло, що це чекбокси, поки я не натиснув!
              Додай квадратик, і як клікаєш — чекбокс із V». Той самий
              `Checkbox`, що на /routes і в темі. */}
          <fieldset>
            <legend className="text-sm font-semibold text-heading">
              Must offer
            </legend>
            <div className="mt-3 flex flex-col gap-3">
              {services.map((code) => {
                const on = filters.services.includes(code);
                return (
                  <Checkbox
                    key={code}
                    checked={on}
                    weight="plain"
                    testId={`service-${code}`}
                    onChange={() =>
                      setFilters((f) => ({
                        ...f,
                        services: on
                          ? f.services.filter((c) => c !== code)
                          : [...f.services, code],
                      }))
                    }
                  >
                    {serviceLabel(code)}
                  </Checkbox>
                );
              })}
            </div>
          </fieldset>
        </aside>

        <div id="companies" className="min-w-0 scroll-mt-20">
          {/* 🔴 Знаменник поруч із чисельником: «6 із 10» відповідає на
              питання «а скільки відсіялось», якого інакше ніхто не поставить. */}
          <p className="text-sm" data-testid="result-count">
            {shown.length} of {all.length}
          </p>

          {/* 🔴 CAMP-371. ГОЛОВНА ВИМОГА, І ВОНА НЕ ОБГОВОРЮЄТЬСЯ. Тип
              відомий у 67 машин зі 115; решта — ті, де прокатник ніде його
              не написав. Читач, що обрав тип, мусить бачити, скільки машин
              сховано саме через невідомий тип, — справжнім числом, не
              «деякими». Інакше він вирішить, що таких машин у нас немає, і
              це буде брехня, зроблена мовчанням. Нуль теж друкується:
              «none hidden» — це твердження, а відсутність рядка — ні. */}
          {filters.camperType && (
            <p className="mt-2 text-sm text-ink-2" data-testid="hidden-by-type">
              {hidden === 0
                ? "No vehicle is hidden for want of a type: every company here states one for each vehicle."
                : `${hidden} ${hidden === 1 ? "vehicle is" : "vehicles are"} not shown because their rental company does not state a type. Some of them may be a ${camperTypeName(types, filters.camperType).toLowerCase()} — ask the company.`}
            </p>
          )}

          {shown.length === 0 ? (
            <p className="mt-4">
              No company in the catalogue meets these conditions. Drop some of
              them — or write to us if you think a company belongs here.
            </p>
          ) : (
            <div className="mt-4">
              <MediaCards
                columns={1}
                titleAs="h2"
                items={shown.map((p) => ({
                  key: p.slug,
                  testId: "provider-row",
                  media: <Flag code={p.homeCountry} />,
                  title: p.name,
                  // 🔴 CAMP-463: «(company’s own figure)» ПІСЛЯ КОЖНОГО ЧИСЛА
                  // БУЛО ДВІЧІ НА РЯДОК ×10 КОМПАНІЙ; те саме, один раз, вже
                  // сказано над каталогом й на сторінці компанії з джерелом
                  // і датою.
                  text: [countryName(p.homeCountry), ...scaleParts(p)].join(
                    " · ",
                  ),
                  details: (
                    <>
                      <p>
                        services listed: {p.serviceCount} · models:{" "}
                        {p.vehicleCount}
                      </p>
                      {/* 🔴 CAMP-371. Типи — лише ті, що компанія НАЗВАЛА
                          сама; і поруч скільки моделей без типу, щоб
                          «types: campervan» не читалось як «усе інше — не
                          вани». */}
                      {p.vehicleCount > 0 && (
                        <p data-testid="row-types">
                          {p.camperTypeSlugs.length > 0 ? (
                            <>
                              types stated:{" "}
                              {p.camperTypeSlugs
                                .map((s) =>
                                  camperTypeName(types, s).toLowerCase(),
                                )
                                .join(", ")}
                              {p.untypedVehicleCount > 0 && (
                                <>
                                  {" "}
                                  · {p.untypedVehicleCount} without a stated
                                  type
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              no vehicle type stated for its{" "}
                              {p.untypedVehicleCount}{" "}
                              {p.untypedVehicleCount === 1 ? "model" : "models"}
                            </>
                          )}
                        </p>
                      )}
                      {p.reviewProfiles.length > 0 && (
                        <p data-testid="review-links">
                          Reviews:{" "}
                          {p.reviewProfiles.map((r, i) => (
                            <span key={r.source}>
                              {i > 0 && ", "}
                              <a
                                className="underline"
                                href={r.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                              >
                                {SOURCE_LABEL[r.source] ?? r.source}
                              </a>
                            </span>
                          ))}
                        </p>
                      )}
                    </>
                  ),
                  cta: {
                    href: `/camper-rental/providers/${p.slug}`,
                    label: `View ${p.name}`,
                    variant: "secondary" as const,
                  },
                }))}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
