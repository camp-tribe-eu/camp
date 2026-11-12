import type { Metadata } from "next";

import { Block, PageShell } from "@/components/layout";
import { BoxBanner } from "@/components/box-banner";
import { CountryTicker } from "@/components/country-ticker";
import FeatureRow from "@/components/feature-row";
import Faq from "@/components/faq";
import { GridBanner } from "@/components/grid-banner";
import { ImageWithText } from "@/components/image-with-text";
import { LayeredBanner } from "@/components/layered-banner";
import PostCards from "@/components/post-cards";
import ReviewCards from "@/components/review-cards";

/**
 * Вітрина каталогу секцій — CAMP-449, «Спосіб перевірки», пункт 1:
 * «Вітрина рендериться, знімок прикладений».
 *
 * 🔴 НАВІЩО ВОНА, А НЕ ПРОСТО ЮНІТ-ТЕСТИ. Юніт доводить, що секція віддає
 * потрібну розмітку на вигадані дані. Він НЕ показує, як сім секцій
 * виглядають поруч, на одній ширині, в одній темі — а саме це вирішує,
 * чи сайт перестав бути «сухим». Одна сторінка, де вони стоять поруч,
 * коштує менше, ніж сім разів відкрити сім різних сторінок сайту.
 *
 * 🔴 ВОНА ВНУТРІШНЯ, І ЦЕ ЗАХИЩЕНО ТРЬОМА РЕЧАМИ, А НЕ ОДНІЄЮ:
 *   1. `robots: { index: false, follow: false }` — ось тут, у метаданих;
 *   2. `Disallow: /internal/` у `robots-rules.ts` — щоб кравлер сюди не
 *      йшов узагалі;
 *   3. її немає в карті сайту — а правило `check-sitemap.mjs` вимагає
 *      «або в карті, або noindex», і noindex тут стоїть.
 * Одного заголовка було б замало: заборона в robots.txt зупиняє обхід,
 * і тоді `noindex` на самій сторінці ніхто не прочитає — тому обидва.
 *
 * 🔴 ДАНІ ТУТ ВИГАДАНІ, І ЦЕ НАВМИСНО. Вітрина не ходить в API: вона має
 * малюватись однаково щоразу, інакше знімок із неї не можна звіряти.
 * Числа в зразках — зразки, а не наш замір; жодне з них не доїде до
 * читача, бо сторінка закрита трьома замками вище.
 */

export const metadata: Metadata = {
  title: "Section catalogue",
  robots: { index: false, follow: false },
};

const SAMPLE_COUNTRIES = [
  { country: "hr", spots: 412, regions: 12 },
  { country: "fr", spots: 2810, regions: 18 },
  { country: "it", spots: 1644, regions: 20 },
  { country: "es", spots: 1207, regions: 17 },
];

const SAMPLE_FEATURES = [
  {
    key: "water",
    title: "Distance to water",
    text: "Metres to the nearest lake, river or sea, measured per campsite.",
  },
  {
    key: "town",
    title: "Distance to a town",
    text: "How far the nearest shop, bakery or pharmacy is.",
  },
  {
    key: "rail",
    title: "Nearest railway stop",
    text: "Whether you can arrive without a car at all.",
  },
];

const SAMPLE_FAQ = [
  {
    key: "where",
    question: "Where do the campsites come from?",
    answer: "OpenStreetMap, refreshed weekly, with every gap left as a gap.",
  },
  {
    key: "prices",
    question: "Why does a price sometimes carry a note?",
    answer:
      "Because the source gave no validity period for it. The note says so instead of hiding the figure.",
  },
];

const SAMPLE_REVIEWS = [
  {
    key: "one",
    quote: "Sample quote. The distance to water was right to the metre.",
    author: "Sample author",
    role: "Sample role",
    rating: 5,
  },
  {
    key: "two",
    quote: "Sample quote. Found a quiet site two hours from the ferry.",
    author: "Second sample author",
    role: "Sample role",
    rating: 4,
  },
  {
    key: "three",
    quote: "Sample quote without a rating, to show the card without stars.",
    author: "Third sample author",
  },
];

/** Один розділ вітрини: підпис і сама секція під ним. */
function Shelf({
  n,
  name,
  children,
}: {
  n: number;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-16" data-testid={`shelf-${n}`}>
      <h2 className="text-sm text-ink-2" data-testid={`shelf-${n}-label`}>
        {n}. {name}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SectionCatalogue() {
  return (
    <PageShell rhythm="tight">
      <h1 className="text-3xl text-heading">Section catalogue</h1>
      <Block as="p" measure="read" className="mt-2 text-ink-2">
        Every reusable section, on one width, with sample content.
      </Block>

      <Shelf n={1} name="Layered banner">
        <LayeredBanner
          background={{ src: "/banners/eu-dawn.webp" }}
          tickerText="Campsites across Europe"
          heading="Every campsite, and what is around it"
          description="Pick a country, then a region, then a site."
          cta={{ href: "/camping", label: "Browse countries" }}
          headingLevel={2}
          minHeight="420px"
        />
      </Shelf>

      <Shelf n={2} name="Ticker row">
        <CountryTicker countries={SAMPLE_COUNTRIES} />
      </Shelf>

      <Shelf n={3} name="Two banners side by side">
        <GridBanner
          headingLevel={3}
          items={[
            {
              image: { src: "/banners/camper.webp" },
              heading: "Rent a camper",
              text: "Licence classes, weights, tolls and insurance.",
              cta: { href: "/camper-rental", label: "Choose a country" },
            },
            {
              image: { src: "/banners/tent.webp" },
              heading: "Find a campsite",
              text: "Every campsite in the database on one map.",
              cta: { href: "/map", label: "Open the map" },
            },
          ]}
        />
      </Shelf>

      <Shelf n={4} name="Image with text, alternating">
        <ImageWithText
          image={{ src: "/banners/tent.webp" }}
          caption="Where to sleep"
          heading="Campsites, not guesses"
          text="Every site comes from OpenStreetMap, refreshed weekly, with the gaps shown as gaps rather than filled in."
          cta={{ href: "/map", label: "Open the map" }}
          headingLevel={3}
        />
        <ImageWithText
          className="mt-3"
          image={{ src: "/banners/camper.webp" }}
          imagePosition="right"
          imageWidth={50}
          caption="Getting there"
          heading="What the drive commits you to"
          text="Licence classes, weights, tolls and insurance, country by country."
          cta={{ href: "/camper-rental", label: "Choose a country" }}
          headingLevel={3}
        />
      </Shelf>

      <Shelf n={5} name="Icon, title, text in a row">
        <FeatureRow items={SAMPLE_FEATURES} />
      </Shelf>

      <Shelf n={8} name="FAQ accordion">
        <Faq items={SAMPLE_FAQ} />
      </Shelf>

      {/* 🔴 ЗРАЗКОВІ ЦИТАТИ, І ВОНИ НАЗВАНІ ЗРАЗКОВИМИ. Відгуків у нас
          немає жодного; картка просить секцію «не вигадувати, тримати в
          каталозі». Тут вона стоїть саме в каталозі — на сторінці,
          закритій `noindex` і `Disallow: /internal/`, — а імена в ній
          так і написані: Sample. */}
      <Shelf n={9} name="Review cards (sample text — we have no reviews)">
        <ReviewCards items={SAMPLE_REVIEWS} />
      </Shelf>

      {/* 🔴 ЗРАЗКОВІ МАТЕРІАЛИ, І ВОНИ НАЗВАНІ ЗРАЗКОВИМИ. Секція на
          вітрині має показати ФОРМУ, а не стан нашого блога; справжній
          перелік стоїть на /blog і на сторінках країн. */}
      <Shelf n={10} name="Post cards (sample)">
        <PostCards
          columns={3}
          items={[
            {
              key: 'one',
              href: '/blog',
              title: 'Sample post title that runs to two lines so the clamp is visible',
              excerpt:
                'Sample excerpt. Two lines of it, so the card shows how a real summary sits under the title.',
              meta: '1 October 2026 · CampTribe',
            },
            {
              key: 'two',
              href: '/blog',
              title: 'Sample post without an excerpt',
              meta: '20 September 2026 · CampTribe',
            },
            {
              key: 'three',
              href: '/blog',
              title: 'Sample post without a date either',
              excerpt: 'Sample excerpt, to show the card with no meta pill.',
            },
          ]}
        />
      </Shelf>

      <Shelf n={11} name="Box banner">
        <BoxBanner
          image={{ src: "/banners/about.webp" }}
          heading="About CampTribe"
          text="What this site is, and where every number on it comes from."
          cta={{ href: "/about", label: "Read about us" }}
          headingLevel={3}
          align="start"
        />
      </Shelf>
    </PageShell>
  );
}
