// CAMP-431 (пункт 4) — розмітка сторінки прокатної компанії.
//
// 🔴 ЧОМУ САМЕ ТУТ ЦЕ ВАРТО НАЙБІЛЬШЕ. Сторінка компанії — єдине місце
// в проєкті, де про ЧУЖИЙ бізнес сказано з джерелом і датою перевірки.
// Відповідна машина цитує те, що має джерело; розмітка — це те, чим
// вона розуміє, що перед нею компанія, а не стаття про неї.
//
// 🔴 І ЧОМУ ТУТ НЕМАЄ ТОГО, ЧОГО ХОЧЕТЬСЯ. Ні `aggregateRating`, ні
// `priceRange`, ні `Offer.price`. Цифр рейтингу ми не маємо права
// показувати (дозволу від Trustpilot немає), цін не тримаємо навмисно.
// Правило CAMP-431 дослівне: додаємо лише ту розмітку, під якою є
// справжні дані з джерелом. Розмітка, що розходиться зі сторінкою,
// зруйнує те єдине, чим ми відрізняємось, і зробить це тихо.

import { abs, breadcrumbList, publisherNode, websiteNode } from "./jsonld";
import { DEFAULT_LOCALE } from "./i18n";
import { serviceLabel, type ProviderPage } from "./rental-providers";

/** Адреса сторінки компанії — одна формула на весь проєкт. */
export const providerPath = (slug: string) =>
  `/camper-rental/providers/${slug}`;

/**
 * 🔴 Кожен `@type`, який ця сторінка має право надрукувати, і факт, який
 * мусить бути істинним, щоб він зʼявився.
 *
 * Це пункт «Спосіб перевірки» картки у вигляді, який падає. Тест обходить
 * граф, який файл справді віддає, і тип, якого тут немає ключем, валить
 * його. Коментар, що обіцяє те саме, збірку не валить — у нас такий уже
 * був.
 */
export const PROVIDER_TYPE_EVIDENCE: Record<
  string,
  (p: ProviderPage) => boolean
> = {
  // Сторінка, сайт і видавець — істинні про кожну сторінку, яку ми
  // віддаємо.
  WebPage: () => true,
  WebSite: () => true,
  Organization: () => true,
  BreadcrumbList: () => true,
  ListItem: () => true,
  // Компанія: вона має назву, і це все, що тут безумовне.
  AutoRental: (p) => p.name.length > 0,
  // Сервіс стає вузлом, лише якщо компанія його СПРАВДІ дає.
  // `unavailable` не стає ні `Offer`, ні `Service`: «не дає» у розмітці
  // не кодується мовчанням, воно просто не кодується.
  Offer: (p) => p.services.some((s) => s.availability !== "unavailable"),
  Service: (p) => p.services.some((s) => s.availability !== "unavailable"),
  // Машина — лише коли модель є в парку.
  Vehicle: (p) => p.vehicles.length > 0,
  // Реєстраційний номер — єдине, що ми загортаємо в `PropertyValue`.
  PropertyValue: (p) => p.registrationNumber !== null,
};

/** Чотиризначний рік → дата за ISO, як вимагає `foundingDate`. */
function foundingDate(year: number | null): string | undefined {
  return year !== null && Number.isInteger(year) && year > 1000 && year < 3000
    ? String(year)
    : undefined;
}

export function providerGraph(p: ProviderPage, path: string) {
  const id = `${abs(path)}#company`;

  const offers = p.services
    .filter((s) => s.availability !== "unavailable")
    .map((s) => ({
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: serviceLabel(s.code),
        provider: { "@id": id },
      },
      // 🔴 Ціни немає — і `price` тут не зʼявиться нізащо. Відомо лише
      // те, ВХОДИТЬ сервіс у ціну чи коштує окремо, і це не ціна.
      ...(s.availability === "included"
        ? { description: "included in the price" }
        : { description: "costs extra" }),
    }));

  const fleet = p.vehicles.map((v) => ({
    "@type": "Vehicle",
    name: v.name,
    // Спальних місць у словнику немає окремим полем, а видавати їх за
    // `vehicleSeatingCapacity` не можна: це різні числа, і в кемпері
    // вони розходяться майже завжди.
    ...(v.belted_seats !== null
      ? { vehicleSeatingCapacity: v.belted_seats }
      : {}),
  }));

  const company = {
    "@type": "AutoRental",
    "@id": id,
    name: p.name,
    ...(p.legalName ? { legalName: p.legalName } : {}),
    ...(p.intro ? { description: p.intro } : {}),
    ...(p.website ? { url: p.website } : {}),
    ...(p.email ? { email: p.email } : {}),
    ...(p.phone ? { telephone: p.phone } : {}),
    ...(foundingDate(p.foundedYear)
      ? { foundingDate: foundingDate(p.foundedYear) }
      : {}),
    ...(p.registrationNumber
      ? {
          identifier: {
            "@type": "PropertyValue",
            name: "registration number",
            value: p.registrationNumber,
          },
        }
      : {}),
    // 🔴 `sameAs` — це «та сама компанія там», а не «ось її оцінка».
    // Профіль на Trustpilot ідентифікує компанію; цифри з нього ми не
    // беремо й не будемо, доки немає письмового дозволу.
    ...(p.reviewProfiles.length > 0
      ? { sameAs: p.reviewProfiles.map((r) => r.profileUrl) }
      : {}),
    ...(offers.length > 0 ? { makesOffer: offers } : {}),
    ...(fleet.length > 0 ? { owns: fleet } : {}),
  };

  const page = {
    "@type": "WebPage",
    "@id": `${abs(path)}#page`,
    url: abs(path),
    name: p.name,
    inLanguage: DEFAULT_LOCALE,
    isPartOf: websiteNode(),
    publisher: publisherNode(),
    breadcrumb: { "@id": `${abs(path)}#breadcrumb` },
    mainEntity: { "@id": id },
  };

  const crumbs = breadcrumbList(
    [
      { name: "Renting a camper", path: "/camper-rental" },
      { name: "Companies", path: "/camper-rental/providers" },
      { name: p.name, path },
    ],
    path,
  );
  // `breadcrumbList` віддає самостійний документ зі своїм `@context`;
  // усередині графа контекст один на всіх.
  const breadcrumb: Record<string, unknown> = { ...crumbs };
  delete breadcrumb["@context"];

  return {
    "@context": "https://schema.org",
    "@graph": [page, company, breadcrumb],
  };
}
