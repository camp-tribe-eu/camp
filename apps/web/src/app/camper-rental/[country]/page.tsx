import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import RentalCountryData from "@/components/rental-country-data";
import RentalDisclosure from "@/components/rental-disclosure";
import RentalOfferSlot from "@/components/rental-offer-slot";
import { listProviders } from "@/lib/rental-providers";
import { abs, breadcrumbList, jsonLdProps } from "@/lib/jsonld";
import { alternatesFor } from "@/lib/i18n";
import { countryFuel, euros, longDate, FUEL } from "@/lib/fuel";
import {
  count,
  inProse,
  measuredFor,
  publishableCountries,
  rentalCountry,
  rentalOffers,
} from "@/lib/rental";

// CAMP-4 / CAMP-54 — one page per member state, and only where it earns
// one.
//
// 🔴 TWELVE PAGES, NOT TWO HUNDRED AND FIFTY.
//
// The card asked for 200–300 city pages. That is scaled content abuse by
// Google's own March 2024 definition the moment the pages differ only by
// a place name, and the penalty is applied to the domain rather than to
// the section — on a domain with no age and no trust, and a plan that is
// entirely organic. CAMP-130 refused 951 templated guides for the same
// reason and this follows it.
//
// The list lives in src/data/rental/countries.ts and every entry passes a
// gate enforced by tests/unit/rental.spec.ts: three facts about this
// country that are not true of its neighbour, each with a named authority
// behind it, and one measured statement from our own database that is
// true of no other page. A country that could not meet both does not have
// a page. Twelve could.
//
// 🔴 Nothing here is a price, a vehicle, a company or an availability.
// See lib/affiliate.ts — the commercial slot renders an explained empty
// state until CAMP-98 produces an account.

interface Params {
  country: string;
}

export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  return publishableCountries().map((c) => ({ country: c.code }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { country } = await params;
  const c = rentalCountry(country);
  if (!c) return {};
  return {
    title: `Renting a camper in ${inProse(c)}`,
    description: c.angle,
    alternates: alternatesFor(`/camper-rental/${c.code}`),
  };
}

export default async function RentalCountryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { country } = await params;
  const c = rentalCountry(country);
  // 🔴 `publishableCountries()` rather than a bare lookup: a country whose
  // content stopped passing the gate must 404 rather than render a page
  // that no longer meets the standard the section is built on.
  if (!c || !publishableCountries().some((x) => x.code === c.code)) notFound();

  const path = `/camper-rental/${c.code}`;
  const offers = rentalOffers(c.code);
  const row = measuredFor(c.code);
  const fuel = countryFuel(c.code);

  // 🔴 Лічимо на ЗБІРЦІ, а не в браузері: сторінка статична, і рішення
  // «показувати звужене посилання чи ні» мусить бути вже у відданому
  // HTML. Інакше читач побачить обіцянку, яка розвалиться після
  // монтування.
  const providers = await listProviders();
  const providerCount = providers.length;
  // 🔴 ХТО ТУТ ВИДАЄ МАШИНИ, А НЕ ХТО ТУТ ЗАРЕЄСТРОВАНИЙ. За пропискою
  // двадцять три з двадцяти семи країн давали б нуль; за місцем роботи
  // покрито двадцять, і Нідерланди мають сім компаній замість жодної.
  const rentHere = providers.filter((p) =>
    p.countries.includes(c.code.toUpperCase()),
  ).length;

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: "Camper rental", path: "/camper-rental" },
            { name: c.name, path },
          ]),
        )}
      />
      <script
        {...jsonLdProps({
          "@context": "https://schema.org",
          "@type": "WebPage",
          "@id": `${abs(path)}#page`,
          name: `Renting a camper in ${inProse(c)}`,
          description: c.angle,
          url: abs(path),
          inLanguage: "en",
          about: { "@type": "Place", name: c.name },
        })}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link className="underline" href="/camper-rental">
          Camper rental
        </Link>{" "}
        / {c.name}
      </nav>

      <h1 className="mt-2 text-3xl font-bold leading-tight md:text-[42px]">
        Renting a camper in {inProse(c)}
      </h1>

      <p className="mt-4 max-w-prose text-ink-2">{c.intro}</p>

      <RentalDisclosure offers={offers.length} />

      <section aria-labelledby="rules-heading" className="mt-12">
        <h2 id="rules-heading" className="text-2xl font-bold text-heading">
          Three things that are true here and not next door
        </h2>
        <ul className="mt-6 space-y-6">
          {c.facts.map((fact) => (
            <li
              key={fact.title}
              className="rounded-card border border-line-2 bg-surface p-5"
            >
              <h3 className="text-lg font-semibold text-heading">
                {fact.title}
              </h3>
              <p className="mt-2 max-w-prose text-ink-2">{fact.body}</p>
              <p className="mt-3 text-sm text-ink-2">
                Source:{" "}
                {fact.source.url.startsWith("/") ? (
                  <Link className="underline" href={fact.source.url}>
                    {fact.source.name}
                  </Link>
                ) : (
                  <a
                    className="underline"
                    href={fact.source.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {fact.source.name}
                  </a>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <RentalCountryData country={c} />

      {/* 🔴 The one cost on this page we can actually price, and it is not
          ours: the European Commission publishes it weekly for all 27
          member states. Fuel is the largest volatile line in a camper
          budget and the campsite fee is the reader's own number — the
          same split lib/fuel.ts is built around. */}
      {fuel?.diesel !== null && fuel !== null && (
        <section
          aria-labelledby="fuel-heading"
          className="mt-10 rounded-card border border-line-2 bg-surface-2 p-5"
        >
          <h2 id="fuel-heading" className="text-xl font-semibold text-heading">
            What the driving costs
          </h2>
          <p className="mt-3 max-w-prose text-ink-2">
            Diesel in {inProse(c)} costs{" "}
            <strong className="text-ink">{euros(fuel.diesel, 3)}</strong> a
            litre in the week of {longDate(FUEL.bulletinDate)}, including taxes,
            as published by the European Commission
            {fuel.petrol !== null && <> — petrol {euros(fuel.petrol, 3)}</>}. A
            rental camper is heavier and thirstier than the car you are used to,
            and fuel will be the largest variable line in the budget.{" "}
            <Link
              className="underline"
              href={`/tools/camper-trip-cost/${c.code}`}
            >
              Price a trip in {inProse(c)}
            </Link>
            .
          </p>
        </section>
      )}

      {/* 🔴 CAMP-427: ПОСИЛАННЯ ЛИШЕ ТУДИ, ДЕ Є ЩО ПОКАЗАТИ.
          У каталозі десять компаній і лише ЧОТИРИ країни прописки
          (DE 6, FR 2, PT 1, FI 1). Перша редакція цього блоку вела з
          кожної з 27 сторінок у звужений каталог — тобто 23 сторінки
          обіцяли б список і віддавали «0 із 10» без пояснення.
          Тому лічимо на збірці й пишемо те, що є.

          🔴 І формулювання чесне: ми знаємо, де компанія ЗАРЕЄСТРОВАНА,
          а не в яких країнах вона видає машини. Сказати «хто здає в
          Іспанії» означало б пообіцяти знання, якого в моделі ще немає. */}
      <section
        aria-labelledby="providers-heading"
        className="mt-12 border-t border-line-2 pt-8"
      >
        <h2
          id="providers-heading"
          className="text-xl font-semibold text-heading"
        >
          Rental companies
        </h2>
        <p className="mt-3 max-w-prose text-ink-2">
          {rentHere > 0 ? (
            <>
              <Link
                className="underline"
                href={`/camper-rental/providers?country=${c.code.toUpperCase()}`}
              >
                {rentHere === 1
                  ? "One company we have read hands over vehicles"
                  : `${rentHere} of the companies we have read hand over vehicles`}{" "}
                in {inProse(c)}
              </Link>
              . Each is listed with where it is registered, how many depots it
              states, what it includes in the price and what it charges extra
              for — with the source and the date beside every figure.
            </>
          ) : (
            <>
              None of the companies we have read so far hands over vehicles in{" "}
              {inProse(c)}. That is a gap in our list, not a statement about the
              market: we have read {providerCount} companies, and more are being
              added country by country.{" "}
              <Link className="underline" href="/camper-rental/providers">
                All {providerCount} companies
              </Link>{" "}
              are listed with their services and fleet.
            </>
          )}
        </p>
      </section>

      <RentalOfferSlot offers={offers} where={inProse(c)} />

      <section
        aria-labelledby="next-heading"
        className="mt-12 border-t border-line-2 pt-8"
      >
        <h2 id="next-heading" className="text-xl font-semibold text-heading">
          Before you book
        </h2>
        <p className="mt-3 max-w-prose text-ink-2">
          The questions that decide what a hire actually costs are the same in
          every member state, and none of them is on the price page:{" "}
          <Link className="underline" href="/camper-rental">
            the excess, the mileage cap, the one-way fee and the plated mass
          </Link>
          . For {inProse(c)} specifically, our{" "}
          <Link className="underline" href={`/camping/${c.code}`}>
            {count(row?.spots ?? 0)} campsite records
          </Link>{" "}
          are the other half of the plan.
        </p>
      </section>
    </main>
  );
}
