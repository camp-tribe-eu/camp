"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  NO_FILTERS,
  SORT_KEYS,
  SORT_LABEL,
  arrange,
  countriesOf,
  filtersFromQuery,
  serviceCodesOf,
  serviceLabel,
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

export default function ProviderCatalogue({ all }: { all: Provider[] }) {
  const [filters, setFilters] = useState<CatalogueFilters>(NO_FILTERS);
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
    const next = filtersFromQuery(window.location.search, all);
    if (next.country || next.services.length) setFilters(next);
  }, [all]);

  const countries = useMemo(() => countriesOf(all), [all]);
  const services = useMemo(() => serviceCodesOf(all), [all]);
  const shown = useMemo(
    () => arrange(all, filters, sort),
    [all, filters, sort],
  );

  return (
    <div data-testid="provider-catalogue">
      <div className="flex flex-wrap items-end gap-4">
        {/* 🔴 «Hands over vehicles in», а не «home country».
            Підпис казав «країна компанії», а фільтр читав `p.countries` —
            країни, де компанія ВИДАЄ МАШИНИ. Читач у Нідерландах обирав
            NL, очікуючи голландські компанії, і отримував німецьку з депо
            в Амстердамі — тобто саме те, що йому й потрібно, але не те,
            що йому пообіцяли. Рішення вже записане в CAMP-421
            («зареєстрована в» → «видає машини в»); сюди воно не дійшло. */}
        <label className="flex flex-col gap-1 text-sm">
          <span>Hands over vehicles in</span>
          <select
            data-testid="filter-country"
            className="rounded border border-neutral-300 bg-white px-3 py-2"
            value={filters.country ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, country: e.target.value || null }))
            }
          >
            <option value="">all</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Sort by</span>
          <select
            data-testid="sort"
            className="rounded border border-neutral-300 bg-white px-3 py-2"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm">Must offer</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {services.map((code) => {
            const on = filters.services.includes(code);
            return (
              <label
                key={code}
                className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
                  on
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  data-testid={`service-${code}`}
                  checked={on}
                  onChange={() =>
                    setFilters((f) => ({
                      ...f,
                      services: on
                        ? f.services.filter((c) => c !== code)
                        : [...f.services, code],
                    }))
                  }
                />
                {serviceLabel(code)}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* 🔴 Знаменник поруч із чисельником: «6 із 10» відповідає на
          питання «а скільки відсіялось», якого інакше ніхто не поставить. */}
      <p className="mt-6 text-sm" data-testid="result-count">
        {shown.length} of {all.length}
      </p>

      {shown.length === 0 ? (
        <p className="mt-4">
          No company in the catalogue meets these conditions. Drop some of them
          — or write to us if you think a company belongs here.
        </p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {shown.map((p) => (
            <li
              key={p.slug}
              data-testid="provider-row"
              className="rounded border border-neutral-200 p-4"
            >
              <h3 className="text-lg font-semibold">
                <Link href={`/camper-rental/providers/${p.slug}`}>
                  {p.name}
                </Link>
              </h3>
              <p className="mt-1 text-sm">
                {p.homeCountry}
                {p.declaredDepotCount !== null && (
                  <> · depots: {p.declaredDepotCount} (company’s own figure)</>
                )}
                {p.declaredFleetSize !== null && (
                  <> · fleet: {p.declaredFleetSize} (company’s own figure)</>
                )}
                {p.foundedYear !== null && <> · since {p.foundedYear}</>}
              </p>
              <p className="mt-1 text-sm">
                services listed: {p.serviceCount} · models: {p.vehicleCount}
              </p>
              {p.reviewProfiles.length > 0 && (
                <p className="mt-2 text-sm" data-testid="review-links">
                  Reviews:{" "}
                  {p.reviewProfiles.map((r, i) => (
                    <span key={r.source}>
                      {i > 0 && ", "}
                      <a
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
