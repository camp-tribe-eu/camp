import type { Metadata } from "next";
import Faq, { type FaqItem } from "@/components/faq";
import { Flag } from "@/components/flag";
import { LayeredBanner } from "@/components/layered-banner";
import MediaCards from "@/components/media-card";
import { termsOf } from "@/components/page-sections";
import RentalChecklist from "@/components/rental-checklist";
import RentalDisclosure from "@/components/rental-disclosure";
import RentalOfferSlot from "@/components/rental-offer-slot";
import RentalPicker from "@/components/rental-picker";
import {
  CompactBannerStyle,
  MassLine,
  RentalProviderCards,
  RentalStories,
} from "@/components/rental-blocks";
import { RentalShapes, RentalThresholds } from "@/components/rental-thresholds";
import { ButtonLink } from "@/components/button";
import { Block } from "@/components/layout";
import { abs, collectionGraph, jsonLdProps } from "@/lib/jsonld";
import { alternatesFor } from "@/lib/i18n";
import { longDate } from "@/lib/fuel";
import { pageContent } from "@/lib/page-content";
import { claimSlots, withButton } from "@/lib/slots";
import { pickerChoices } from "@/lib/rental-picker";
import { listCamperTypes, listProviders } from "@/lib/rental-providers";
import { SHAPES, THRESHOLDS } from "@/data/rental/thresholds";
import {
  count,
  MEASURED,
  inProse,
  publishableCountries,
  rentalOffers,
} from "@/lib/rental";

// CAMP-4 / CAMP-54 / CAMP-461 — the camper rental landing page.
//
// 🔴 WHAT THIS PAGE IS FOR. A reader who lands here wants one thing first:
// to choose a company to rent from. So the first screen is a banner and a
// picker that lead to the company catalogue, the companies come straight
// after, and the rest — the licence line, the contract questions — is
// reference, which is what an accordion is for.
//
// 🔴 CAMP-461: ПЕРША РЕДАКЦІЯ ЦІЄЇ СТОРІНКИ БУЛА ДОКУМЕНТОМ. Власник
// (CAMP-443/28–37): «Я не розумію що це за сторінка… головна річ — вибрати,
// в кого орендувати, а все інше можна вниз у FAQ». 7 493 px тексту, перехід
// до компаній — рядок на шостому екрані. Тепер: банер, віджет, компанії,
// чергування «фото + текст», країни з прапорами, FAQ.
//
// 🔴 ТЕКСТ — У CMS, МАКЕТ — ТУТ. Кожен слот сторінки `camper-rental`
// (`banner`, `picker`, `providers`, `mass-line`, `countries`, `story:N`,
// `faq`, `intro`) читається за іменем, а `claimSlots` падає на слоті, якого
// сторінка не знає: секція, додана в адмінці й не намальована, не зникає
// мовчки. Те, що РАХУЄ згенероване (число країн, число записів, дата заміру,
// два питання з числами порогів), лишається з генератором.

const SLOTS = {
  one: [
    "intro",
    "banner",
    "picker",
    "providers",
    "mass-line",
    "countries",
    "faq",
  ],
  many: /^story:\d+$/,
} as const;

/**
 * The two FAQ answers that quote numbers.
 *
 * 🔴 THE NUMBERS ARE READ FROM THE DATA, NOT TYPED HERE, and review is the
 * reason. The first version copied "3 500 kg" and the caravan sentence as
 * prose. Changing `thresholds.ts` to 4 250 kg then left the page showing
 * 4 250 in the threshold table and 3 500 in the FAQ — with 815 unit tests
 * green, because nothing tied the two together. A wrong number inside
 * FAQPage markup is the one mistake here that gets quoted back at scale
 * rather than seen once.
 *
 * The caravan answer is `why` verbatim from SHAPES rather than a paraphrase
 * of it, for the same reason. The other FAQ answers carry no number from
 * the data, so they live in the CMS.
 */
function dataQuestions(): Array<{ q: string; a: string }> {
  const mass = THRESHOLDS.find((t) => t.id === "mass");
  const caravan = SHAPES.find((s) => s.id === "caravan");
  // 🔴 Loudly, not silently. An answer built from `undefined` would read
  // as a confident sentence with a hole in it, in machine-readable form.
  if (!mass || !caravan)
    throw new Error("rental FAQ: the data it quotes is missing");

  return [
    {
      q: "Is an ordinary category B licence enough to hire a motorhome?",
      a: `Up to a maximum authorised mass of ${mass.value}, yes. Above it you need C1, which is a separate test — not an endorsement you can arrange at the counter. The figure that matters is the plated MAM on the contract: ${mass.what.replace(/^Maximum authorised mass \(MAM\) — /, "")}. The line is drawn by ${mass.source.name}.`,
    },
    {
      q: "What if it is a caravan rather than a motorhome?",
      a: `Then the licence question is about the combination, not about either vehicle. ${caravan.why}`,
    },
  ];
}

export const metadata: Metadata = {
  title: "Renting a camper in the EU",
  description:
    "Choose a camper rental company in the EU and know what the hire commits you to: the 3.5 tonne licence line, toll classes set by height, payload, cross-border rules and the questions that decide the bill.",
  alternates: alternatesFor("/camper-rental"),
};

export default async function CamperRentalHub() {
  const [countries, page, providers, types] = await Promise.all([
    publishableCountries(),
    pageContent("camper-rental"),
    listProviders(),
    listCamperTypes(),
  ]);
  // 🔴 Страницю без її тексту не малюємо навпіл: макет тримається на
  // слотах, і порожній хаб оренди гірший за відмову збірки.
  if (!page) throw new Error("camper-rental: the page is missing from the CMS");
  const slots = claimSlots(page.sections, SLOTS, "camper-rental");

  const banner = withButton(slots.one.banner, "camper-rental");
  const picker = withButton(slots.one.picker, "camper-rental");
  const providersBlock = withButton(slots.one.providers, "camper-rental");
  const massLine = slots.one["mass-line"];
  const countriesBlock = slots.one.countries;
  const faqSection = slots.one.faq;
  const intro = slots.one.intro.body;
  const stories = slots.many;

  const offers = rentalOffers("hub");

  // 🔴 Перелік у віджеті — лише з того, що є в каталозі, без Кіпру і без
  // типів, яких жодна компанія не назвала: див. `lib/rental-picker.ts`.
  const choices = pickerChoices(providers, types);

  // Нейтральний порядок — за назвою; порядок за заявленим парком читався б
  // як рейтинг, якого ми не складали.
  const teaser = [...providers]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 4);

  // FAQ: питання з числами з даних, питання з CMS, і довідка-вузли.
  const textual = [
    ...dataQuestions().map((d) => ({ key: d.q, question: d.q, answer: d.a })),
    ...termsOf(faqSection.items, "camper-rental: faq").map((t) => ({
      key: t.term,
      question: t.term,
      answer: t.text,
    })),
  ];
  const faqItems: FaqItem[] = [
    ...textual,
    {
      key: "numbers",
      question: "Which four numbers on the contract decide the trip?",
      answer: <RentalThresholds />,
    },
    {
      key: "shapes",
      question: "What shapes of camper will I be offered?",
      answer: <RentalShapes />,
    },
    {
      key: "checklist",
      question: "Which eight questions should I ask before I sign?",
      answer: <RentalChecklist />,
    },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 pb-12 pt-4 xl:px-6">
      <script
        {...jsonLdProps({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "@id": `${abs("/camper-rental")}#faq`,
          // 🔴 Лише текстові відповіді: розмітка читається машиною, а
          // таблиця порогів у ній — не відповідь, а вузол.
          mainEntity: textual.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        })}
      />
      <script
        {...jsonLdProps(
          collectionGraph({
            name: "Renting a camper in the EU",
            description:
              "Licence classes, vehicle dimensions, tolls, insurance and cross-border rules for hiring a camper in the European Union, with country pages for twelve member states.",
            path: "/camper-rental",
            items: countries.map((c) => ({
              name: `Renting a camper in ${inProse(c)}`,
              path: `/camper-rental/${c.code}`,
            })),
          }),
        )}
      />

      {/* 1. БАНЕР НЕСЕ `h1` (CAMP-461). Власник: «нагорі точно проситься
          банер той багатошаровий наш». Заголовок усередині банера, а не
          продубльований під ним — два `h1` це зламаний обрис. Кнопка
          банера веде до вибору компанії: це перший заклик сторінки. */}
      <CompactBannerStyle />
      <LayeredBanner
        className="ct-rental-banner"
        headingLevel={1}
        background={{ src: "/banners/camper.webp" }}
        tickerText={banner.subheading ?? banner.heading.toUpperCase()}
        heading={banner.heading}
        description={banner.body}
        cta={{ href: banner.ctaHref, label: banner.ctaLabel }}
        minHeight="min(52svh, 420px)"
        textSize={{ desktop: "160px", mobile: "56px" }}
      />

      {/* 2. ВІДЖЕТ. Не обіцяє пошуку дат: див. components/rental-picker.tsx. */}
      <div className="mt-4">
        <RentalPicker
          heading={picker.heading}
          hint={picker.body}
          submitLabel={picker.ctaLabel}
          action={picker.ctaHref}
          countries={choices.countries}
          types={choices.types}
        />
      </div>

      {intro && (
        <Block as="p" measure="read" className="mx-auto mt-10 text-ink-2 md:text-center">
          {intro}
        </Block>
      )}

      {/* 🔴 Розкриття звʼязку стоїть ТАМ, ДЕ ВІН Є (CAMP-463; UCPD ст. 7(2)):
          над вмістом, який воно стосується, і лише коли є що розкривати. */}
      <RentalDisclosure offers={offers.length} />

      {/* 3. КОМПАНІЇ — одразу після віджета, а не на шостому екрані
          (CAMP-427 вимагав, щоб на каталог вело ВИДИМЕ посилання; CAMP-461 —
          щоб воно було кнопкою). */}
      <section
        aria-labelledby="providers-heading"
        className="mt-12"
        data-testid="rental-providers-block"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 id="providers-heading" className="text-2xl text-heading">
              {providersBlock.heading}
            </h2>
            {providersBlock.body && (
              <Block as="p" measure="read" className="mt-2 text-ink-2">
                {providersBlock.body}
              </Block>
            )}
          </div>
          <ButtonLink
            href={providersBlock.ctaHref}
            variant="primary"
            data-testid="providers-cta"
          >
            {providersBlock.ctaLabel}
            {providers.length > 0 ? ` (${providers.length})` : ""}
          </ButtonLink>
        </div>
        <div className="mt-6">
          <RentalProviderCards
            providers={teaser}
            types={types}
            columns={2}
            testId="rental-provider-cards"
          />
        </div>
      </section>

      <RentalOfferSlot offers={offers} where="Europe" />

      {/* 4. «УСЕ МІНЯЄТЬСЯ НА 3 500 КГ» — чотири коротких картки зі значками
          замість шести абзаців; довгий текст — у питанні акордеона нижче. */}
      <section
        aria-labelledby="mass-line-heading"
        className="mt-12"
        data-testid="rental-mass-line"
      >
        <h2 id="mass-line-heading" className="text-2xl text-heading">
          {massLine.heading}
        </h2>
        {massLine.body && (
          <Block as="p" measure="read" className="mt-2 text-ink-2">
            {massLine.body}
          </Block>
        )}
        <div className="mt-6">
          <MassLine section={massLine} where="camper-rental: mass-line" />
        </div>
      </section>

      <RentalStories
        sections={stories.slice(0, 1)}
        where="camper-rental"
      />

      {/* 5. КРАЇНИ — картки в єдиному форматі: прапор зліва, назва, текст,
          кнопка (CAMP-443/2, 443/35). Рівно одне посилання на країну: цей
          перелік — і єдиний вхід на сторінки країн, і те, що перелічує
          розмітка `CollectionPage`. */}
      <section
        aria-labelledby="countries-heading"
        className="mt-12"
        data-testid="rental-country-index"
      >
        <h2 id="countries-heading" className="text-2xl text-heading">
          {countriesBlock.heading}
        </h2>
        {/* 🔴 Число країн — із генератора (CAMP-130: перелік свідомо
            короткий і читач має право знати, що він не згенерований
            сотнями). Речення, що рахує, живе з тим, що воно рахує. */}
        <Block as="p" measure="read" className="mt-2 text-ink-2">
          {countriesBlock.body}{" "}
          {countries.length} member states have a page of their own.
        </Block>
        <div className="mt-6">
          <MediaCards
            columns={3}
            items={countries.map((c) => ({
              key: c.code,
              media: <Flag code={c.code} />,
              title: c.name,
              text: c.angle,
              cta: {
                href: `/camper-rental/${c.code}`,
                label: `Rules for ${c.name}`,
              },
            }))}
          />
        </div>
      </section>

      <RentalStories sections={stories.slice(1)} where="camper-rental" />

      {/* 6. FAQ — довгий текст сторінки, у акордеоні теми. */}
      <section
        aria-labelledby="faq-heading"
        className="mt-16"
        data-testid="rental-faq"
      >
        <h2 id="faq-heading" className="text-2xl text-heading">
          {faqSection.heading}
        </h2>
        <Faq items={faqItems} testId="rental-faq-list" />
        <Block as="p" measure="read" className="mt-6 text-sm text-ink-2">
          Every number on these pages is either a count of our own{" "}
          {count(MEASURED.total.spots)} campsite records — measured on{" "}
          <time dateTime={MEASURED.measuredAt}>
            {longDate(MEASURED.measuredAt)}
          </time>{" "}
          — or a limit somebody with the authority to set it wrote down, cited
          where it appears.
        </Block>
      </section>
    </main>
  );
}
