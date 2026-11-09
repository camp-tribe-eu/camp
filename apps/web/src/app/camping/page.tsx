import type { Metadata } from 'next';
import { countryName, getCountries } from '@/lib/api';
import { campingLead, memberStateCount, printable } from '@/lib/campsite-count';
import { EU_MEMBER_STATES } from '@/lib/eu-countries';
import { collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import { Block, PageShell } from '@/components/layout';
import { LayeredBanner } from '@/components/layered-banner';
import { CountryTiles } from '@/components/country-tiles';
import { CountryTicker } from '@/components/country-ticker';
import { GridBanner } from '@/components/grid-banner';
import { BoxBanner } from '@/components/box-banner';

// CAMP-71, level 0. The root of the crawl path: home → here → country →
// region → campsite is four clicks, which is the card's criterion, and
// every one of them is a plain <a>. The map does not count — it renders
// client-side, so a crawler that does not run our JavaScript sees nothing.
//
// CAMP-450, перша частина. Склад сторінки — словами власника: «мапа ЄС …
// далі секцію із картками країн у вигляді плиток … нижче тікер … нижче
// два банери … і нижче банер про нас». Інтерактивна мапа — окремий крок
// (геометрія, підказки, навігація); угорі поки багатошаровий банер.
//
// 🔴 КЛІК ПО КРАЇНІ ВЕДЕ НА СТОРІНКУ КРАЇНИ, не фільтрує на місці: фільтр
// на місці не має URL, а органіка — наш єдиний канал.
//
// 🔴 ПОРОЖНЄ НЕ МАЛЮЄМО, АЛЕ Й НУЛЬ НЕ ДРУКУЄМО. `getCountries` віддає `[]`
// на будь-яку не-ok відповідь API. Для плиток це означає «No campsites
// listed yet» на кожній із 27 — чесно. Для речення в банері це означало б
// «0 campsites … across 0 countries» як факт, надрукований для читача й
// для пошуковика на силу одного 429 (CAMP-308) — тому число йде через
// `printable`, і без нього речення просто не називає числа.

export const metadata: Metadata = {
  title: 'Campsites in Europe',
  description:
    'Browse campsites, motorhome parks and camper stops across Europe by country and region.',
  alternates: alternatesFor('/camping'),
};

export default async function CampingIndex() {
  const countries = await getCountries();
  const total = printable(countries.reduce((n, c) => n + c.spots, 0));
  // 🔴 CAMP-240. `memberStateCount`, not `countries.length`:
  // `/spots/countries` answers with the codes the rows carry, and `ax`
  // (Åland, a region of Finland) is one of them. A count of COUNTRIES on
  // a site scoped to the EU-27 cannot say 28. And when the API answered
  // nothing, the sentence says 27 — the Union's size, not our data's.
  const memberStates =
    countries.length > 0
      ? memberStateCount(countries.map((c) => c.country))
      : EU_MEMBER_STATES.length;

  return (
    <PageShell rhythm="tight">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: 'Campsites in Europe',
            description:
              total === null
                ? `Campsites across ${memberStates} countries.`
                : `${total} campsites across ${memberStates} countries.`,
            path: '/camping',
            items: countries.map((c) => ({
              name: countryName(c.country),
              path: `/camping/${c.country}`,
            })),
          }),
        )}
      />

      {/* 1. Багатошаровий банер. `h1` сторінки живе тут. Висота — не
          95svh, як у демо теми: під ним ще чотири секції, і банер на весь
          екран ховав би їх усі за згином. */}
      <LayeredBanner
        headingLevel={1}
        background={{ src: '/banners/eu-dawn.svg' }}
        tickerText="EUROPE"
        heading="Campsites in Europe"
        description={campingLead(total, memberStates)}
        cta={{ href: '#countries', label: 'Pick a country' }}
        minHeight="min(70svh, 560px)"
        textSize={{ desktop: '160px', mobile: '56px' }}
      />

      {/* 2. Плитки країн — усі 27, не лише ті, де є дані. */}
      <section aria-labelledby="countries" className="mt-10">
        <h2 id="countries" className="scroll-mt-20 text-xl md:text-[25px]">
          Countries
        </h2>
        {countries.length === 0 ? (
          <Block as="p" measure="read" className="mt-2 text-ink-2">
            No countries have been imported yet.
          </Block>
        ) : null}
        <CountryTiles countries={countries} className="mt-4" />
      </section>

      {/* 3. Тікер: до шести країн, прапор + назва + кількість. Без даних
          не рендериться зовсім. */}
      <CountryTicker countries={countries} className="mt-10" />

      {/* 4. Два банери поруч. Ведуть на наші ж сторінки вибору. */}
      <GridBanner
        className="mt-10"
        items={[
          {
            image: { src: '/banners/camper.svg' },
            heading: 'Rent a camper',
            text: 'Licence classes, weights, tolls and insurance — what hiring a camper commits you to, country by country.',
            cta: { href: '/camper-rental', label: 'Choose a country' },
          },
          {
            image: { src: '/banners/tent.svg' },
            heading: 'Find a campsite',
            text: 'Every campsite in our database on one map, with what is around it.',
            cta: { href: '/map', label: 'Open the map' },
          },
        ]}
      />

      {/* 5. Банер «про нас». */}
      <BoxBanner
        className="mt-10"
        image={{ src: '/banners/about.svg' }}
        heading="About CampTribe"
        text="What this site is, who makes it, and where every number on it comes from."
        cta={{ href: '/about', label: 'Read about us' }}
        align="start"
      />
    </PageShell>
  );
}
