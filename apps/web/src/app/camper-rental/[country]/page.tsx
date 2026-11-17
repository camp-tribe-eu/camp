import { pagePhoto } from "@/lib/page-photos";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button";
import FeatureRow from "@/components/feature-row";
import { LayeredBanner } from "@/components/layered-banner";
import { Block } from "@/components/layout";
import { RentalProviderCards, RentalStories } from "@/components/rental-blocks";
import RentalCountryData from "@/components/rental-country-data";
import RentalDisclosure from "@/components/rental-disclosure";
import RentalOfferSlot from "@/components/rental-offer-slot";
import { getCountryBanner } from "@/lib/country-banner";
import { listCamperTypes, listProviders } from "@/lib/rental-providers";
import { abs, breadcrumbList, jsonLdProps } from "@/lib/jsonld";
import { alternatesFor } from "@/lib/i18n";
import { countryFuel, euros, longDate, FUEL } from "@/lib/fuel";
import { pageContent } from "@/lib/page-content";
import { claimSlots, withButton } from "@/lib/slots";
import {
  count,
  inProse,
  measuredFor,
  publishableCountries,
  rentalCountry,
  rentalOffers,
} from "@/lib/rental";

// CAMP-4 / CAMP-54 / CAMP-461 — the country template of the rental section.
//
// 🔴 ЦЕ ШАБЛОН ДЛЯ ВСІХ ДВАНАДЦЯТИ КРАЇН (CAMP-444/1–6), І ВІН ЗМІНИВСЯ З
// «ІНФОРМАЦІЙНОЇ СТОРІНКИ» НА СТОРІНКУ З ЗАКЛИКОМ. Власник: «сумна, просто
// інформаційна… банер нагорі, красиві секції, заманити на цінніші сторінки:
// блоги, маршрути, оренда». Тепер: банер країни, вибір компанії одразу під
// ним, три факти зі значками, власні заміри, паливо, і два рядки «фото +
// текст», що ведуть на маршрути й блог.
//
// 🔴 МЕЖА МІЖ CMS І КОДОМ — та сама, що на хабі. Текст, спільний для всіх
// країн (заклик, «Before you book», рядки «фото + текст»), лежить у CMS у
// рядку `camper-rental-country`; текст ОДНІЄЇ країни — у її власному рядку
// (`/rental/countries/:code`). Речення, що рахують (кількість компаній,
// записів, ціна пального), лишаються з генератором. Підстановки на кшталт
// `{{country}}` у спільному тексті не використані навмисно: `applyValues`
// кидає на невідомому ключі, а шаблон без назви країни читається добре.

const SLOTS = {
  one: ["cta", "before"],
  many: /^story:\d+$/,
} as const;

interface Params {
  country: string;
}

export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  return (await publishableCountries()).map((c) => ({ country: c.code }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { country } = await params;
  const c = await rentalCountry(country);
  if (!c) return {};
  return {
    title: `Renting a camper in ${inProse(c)}`,
    description: c.angle,
    alternates: alternatesFor(`/camper-rental/${c.code}`),
  };
}

const RULE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M12 3 4.5 6v5.5c0 4.4 3.1 8 7.5 9.5 4.4-1.5 7.5-5.1 7.5-9.5V6L12 3Z" strokeLinejoin="round" />
    <path d="m8.8 12.2 2.3 2.3 4.2-4.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default async function RentalCountryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { country } = await params;
  const c = await rentalCountry(country);
  // 🔴 `publishableCountries()` rather than a bare lookup: a country whose
  // content stopped passing the gate must 404 rather than render a page
  // that no longer meets the standard the section is built on.
  if (!c || !(await publishableCountries()).some((x) => x.code === c.code))
    notFound();

  const path = `/camper-rental/${c.code}`;
  const offers = rentalOffers(c.code);
  const row = measuredFor(c.code);
  const fuel = countryFuel(c.code);

  // 🔴 Лічимо на ЗБІРЦІ, а не в браузері: сторінка статична, і рішення
  // «показувати звужене посилання чи ні» мусить бути вже у відданому
  // HTML. Інакше читач побачить обіцянку, яка розвалиться після
  // монтування.
  const [providers, types, template, countryPhoto] = await Promise.all([
    listProviders(),
    listCamperTypes(),
    pageContent("camper-rental-country"),
    getCountryBanner(c.code),
  ]);
  if (!template) throw new Error("camper-rental-country: the page is missing from the CMS");
  const slots = claimSlots(template.sections, SLOTS, "camper-rental-country");
  const cta = withButton(slots.one.cta, "camper-rental-country");
  const before = slots.one.before;

  const providerCount = providers.length;
  // 🔴 ХТО ТУТ ВИДАЄ МАШИНИ, А НЕ ХТО ТУТ ЗАРЕЄСТРОВАНИЙ. За пропискою
  // двадцять три з двадцяти семи країн давали б нуль; за місцем роботи
  // покрито двадцять, і Нідерланди мають сім компаній замість жодної.
  const here = providers
    .filter((p) => p.countries.includes(c.code.toUpperCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rentHere = here.length;

  // Кнопка веде туди, де є що показати: у звужений каталог, якщо тут хтось
  // видає машини, і в повний — якщо ні (порожній звужений каталог був би
  // обіцянкою без вмісту).
  const catalogue = cta.ctaHref;
  const compareHref =
    rentHere > 0
      ? `${catalogue}${catalogue.includes("?") ? "&" : "?"}country=${c.code.toUpperCase()}`
      : catalogue;

  return (
    <main className="mx-auto max-w-wrap px-4 pb-12 pt-4 xl:px-6">
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

      {/* 1. БАНЕР КРАЇНИ НЕСЕ `h1`. Фон — інший, ніж на хабі (`eu-dawn`);
          власне фото країни, якщо власник його поставив у CMS (CAMP-469),
          стає переднім планом. Кнопка — той самий перший заклик, що й під
          банером. */}
      <LayeredBanner
        className="mt-3"
        headingLevel={1}
        background={
          pagePhoto("rental", c.code) ?? pagePhoto("country", c.code) ?? { src: "/banners/eu-dawn.webp" }
        }
        foreground={countryPhoto ?? undefined}
        tickerText={c.name.toUpperCase()}
        heading={`Renting a camper in ${inProse(c)}`}
        description={c.angle}
        cta={{ href: "#choose", label: cta.ctaLabel }}
        minHeight="min(56svh, 460px)"
        textSize={{ desktop: "120px", mobile: "48px" }}
      />

      <Block as="p" measure="read" className="mx-auto mt-10 text-ink-2 md:text-center">
        {c.intro}
      </Block>

      <RentalDisclosure offers={offers.length} />

      {/* 2. ВИБІР КОМПАНІЇ — одразу під банером: це те, по що прийшов
          читач (CAMP-444/4, 443/37). Кнопка — первинна, одна. */}
      <section
        id="choose"
        aria-labelledby="choose-heading"
        className="mt-12 scroll-mt-20"
        data-testid="rental-country-companies"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 id="choose-heading" className="text-2xl text-heading">
              {cta.heading}
            </h2>
            <Block as="p" measure="read" className="mt-2 text-ink-2">
              {cta.body}{" "}
              {rentHere > 0
                ? `${rentHere} of the ${providerCount} companies we list hand over vehicles in ${inProse(c)}.`
                : `We list ${providerCount} rental companies across the EU.`}
            </Block>
          </div>
          <ButtonLink
            href={compareHref}
            variant="primary"
            data-testid="country-compare-cta"
          >
            {cta.ctaLabel}
          </ButtonLink>
        </div>
        <div className="mt-6">
          <RentalProviderCards
            providers={here.slice(0, 3)}
            types={types}
            columns={3}
            testId="country-provider-cards"
          />
        </div>
      </section>

      {/* 3. ПРАВИЛА КРАЇНИ — три факти зі значками, кожен із джерелом.
          Раніше: три картки на всю ширину з абзацом у лівій третині. */}
      <section aria-labelledby="rules-heading" className="mt-12">
        <h2 id="rules-heading" className="text-2xl text-heading">
          Three things that are true here and not next door
        </h2>
        <div className="mt-6">
          <FeatureRow
            testId="country-facts"
            iconSide="left"
            titleAs="h3"
            items={c.facts.map((fact) => ({
              key: fact.title,
              icon: RULE_ICON,
              title: fact.title,
              text: (
                <>
                  <span className="font-normal">{fact.body}</span>
                  <span className="mt-3 block text-sm font-normal">
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
                  </span>
                </>
              ),
            }))}
          />
        </div>
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
          <h2 id="fuel-heading" className="text-xl text-heading">
            What the driving costs
          </h2>
          <Block as="p" measure="read" className="mt-3 text-ink-2">
            Diesel in {inProse(c)} costs{" "}
            <strong className="text-ink">{euros(fuel.diesel, 3)}</strong> a
            litre in the week of {longDate(FUEL.bulletinDate)}, including taxes,
            as published by the European Commission
            {fuel.petrol !== null && <> — petrol {euros(fuel.petrol, 3)}</>}. A
            rental camper is heavier and thirstier than the car you are used to,
            and fuel will be the largest variable line in the budget.
          </Block>
          <p className="mt-4">
            <ButtonLink
              href={`/tools/camper-trip-cost/${c.code}`}
              variant="secondary"
            >
              Price a trip in {inProse(c)}
            </ButtonLink>
          </p>
        </section>
      )}

      <RentalOfferSlot offers={offers} where={inProse(c)} />

      <section
        aria-labelledby="next-heading"
        className="mt-12 border-t border-line-2 pt-8"
      >
        <h2 id="next-heading" className="text-xl text-heading">
          {before.heading}
        </h2>
        <Block as="p" measure="read" className="mt-3 text-ink-2">
          The questions that decide what a hire actually costs are the same in
          every member state, and none of them is on the price page:{" "}
          <Link className="underline" href="/camper-rental#faq-heading">
            the excess, the mileage cap, the one-way fee and the plated mass
          </Link>
          . For {inProse(c)} specifically, our{" "}
          <Link className="underline" href={`/camping/${c.code}`}>
            {count(row?.spots ?? 0)} campsite records
          </Link>{" "}
          are the other half of the plan.
        </Block>
      </section>

      <RentalStories
        sections={slots.many}
        where="camper-rental-country"
      />
    </main>
  );
}
