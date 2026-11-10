import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { countryName, getCountries, getHubStats, getRegions, mapRegions } from '@/lib/api';
import { countedAsOf, countryFaq, countryTiles, hubStatsReadAt } from '@/lib/hub-stats';
import Faq from '@/components/faq';
import { HubStatTiles } from '@/components/hub-stats';
import { ButtonLink } from '@/components/button';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import OvernightCoverage from '@/components/overnight-coverage';
import { Block, PageShell } from '@/components/layout';
import PostCards from '@/components/post-cards';
import { postDate, postList } from '@/lib/posts';
import { BLOG_PATH } from '@/components/blog-index';
import { LayeredBanner } from '@/components/layered-banner';
import { RegionTicker } from '@/components/region-ticker';
import { readRegionCard, readRegionCards, RegionTiles } from '@/components/region-tiles';
import { GridBanner } from '@/components/grid-banner';
import { BoxBanner } from '@/components/box-banner';
import CountryMap from '@/components/country-map';

// CAMP-71, level 1: the country hub.
//
// 🔴 Every region is listed here, including the ones with a single
// campsite. Those region pages carry `noindex`, but they must still be
// linked: if the country page hid them, their campsites would be
// reachable only from the sitemap, and the four-click path in the card
// would be a claim about 80% of the data rather than all of it.
//
// CAMP-451. The page is composed from the section catalogue (CAMP-449/450)
// in the owner's words (screens 441/42, 441/46, 441/52, 441/59): «банер
// нагорі, картки регіонів із фото, … і внизу інформаційні секції».
// Top to bottom: breadcrumb → layered banner with the h1 → ticker of the
// largest regions → key figures on the theme's card → the two calls to
// action, one loud and one quiet → overnight coverage → region cards →
// two banners → the box banner about us.
//
// 🔴 THE REGION CARDS CARRY THE COUNTRY'S FLAG, NOT A PHOTO. There is no
// region photography in this repository (zero images), and a placeholder
// would be a promise of one. Same decision as the country tiles.
//
// 🔴 ONE BAD ROW COSTS ONE ROW. `readRegionCards` drops a row that cannot
// become a card (no name, no slug) and keeps a row whose count did not
// arrive, printing "Campsite count not recorded" in its place. The sums
// below are taken over the counts that DID arrive.

type Params = { country: string };

// 🔴 CAMP-73. Without this, a URL that is not in the build is rendered
// on demand, calls notFound(), and Next answers with its client-side
// error shell: the 404 content travels inside the RSC payload instead of
// as markup, so the page is perfect in a browser and blank to anyone
// without JavaScript — a crawler included. `false` sends unknown params
// to the prerendered 404, which is real HTML.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  return (await getCountries()).map((c) => ({ country: c.country }));
}

const en = (n: number): string => n.toLocaleString('en-GB');

/** The sum of the counts that arrived as counts. */
const countedSpots = (cards: ReadonlyArray<{ spots: number | null }>): number =>
  cards.reduce((n, r) => n + (r.spots ?? 0), 0);

export async function generateMetadata(
  props: {
    params: Promise<Params>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const name = countryName(params.country);
  const regions = readRegionCards(await getRegions(params.country));
  const spots = countedSpots(regions);

  return {
    title: `Campsites in ${name}`,
    description: `${en(spots)} campsites and motorhome parks across ${regions.length} regions of ${name}. Facilities, locations and nearby sites.`,
    alternates: alternatesFor(`/camping/${params.country}`),
  };
}

export default async function CountryHub(props: { params: Promise<Params> }) {
  const params = await props.params;
  const [rows, stats, allMapRegions, posts] = await Promise.all([
    getRegions(params.country),
    getHubStats(params.country),
    // 🔴 CAMP-474. Той самий індекс, що й у великої мапи, прочитаний на
    // СЕРВЕРІ й звужений до цієї країни: мапа не робить жодного запиту з
    // браузера, а число в її підписі видно у відданому HTML.
    //
    // Збій індексу не має класти сторінку країни: без рядків мапа себе
    // не малює, а решта сторінки лишається цілою.
    mapRegions().catch(() => []),
    // 🔴 СПИСОК МАТЕРІАЛІВ НЕ СМІЄ КЛАСТИ СТОРІНКУ КРАЇНИ. Він тут
    // прикраса внизу, а не зміст: збій CMS має прибрати секцію, а не
    // сторінку. Той самий `.catch(() => [])`, що вже стоїть над мапою.
    postList().catch(() => []),
  ]);
  const regions = readRegionCards(rows);
  if (regions.length === 0) notFound();
  // 🔴 Rows the overnight sentence may add up: those that became a card
  // AND whose count arrived as a count. `overnightCoverage` does
  // `spots += r.spots` — a `null` row would throw and a `spots: "many"`
  // would concatenate, and either would take the whole page down for
  // one bad record.
  const countedRows = rows.filter((r) => {
    const c = readRegionCard(r);
    return c !== null && c.spots !== null;
  });

  const name = countryName(params.country);
  const spots = countedSpots(regions);
  const tiles = countryTiles(stats);
  const faq = countryFaq(stats, name);
  // Рядки індексу цієї країни. Код у індексі — ISO у верхньому регістрі,
  // у шляху сторінки — у нижньому; порівнюємо зведеними.
  const mapRows = allMapRegions.filter(
    (r) => r.country.toLowerCase() === params.country.toLowerCase() && r.region !== null,
  );
  const lead =
    `${en(spots)} campsites, motorhome parks and camper stops across ` +
    `${regions.length} ${regions.length === 1 ? 'region' : 'regions'}. ` +
    'Facilities come from OpenStreetMap, and where nobody has recorded them ' +
    'we say so rather than guessing.';

  return (
    <PageShell rhythm="tight">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: `Campsites in ${name}`,
            description: `${en(spots)} campsites across ${regions.length} regions of ${name}.`,
            path: `/camping/${params.country}`,
            items: regions.map((r) => ({
              name: r.region,
              path: `/camping/${params.country}/${r.slug}`,
            })),
          }),
        )}
      />
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'Camping', path: '/camping' },
            { name, path: `/camping/${params.country}` },
          ]),
        )}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link href="/camping" className="hover:text-heading">
              Camping
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{name}</li>
        </ol>
      </nav>

      {/* 1. The layered banner carries the page's h1. Shorter than the
          theme's 95vh: six sections follow it, and a full-screen banner
          would hide every one of them below the fold. The background is
          the same drawing /camping uses — we hold no country photography. */}
      <LayeredBanner
        className="mt-4"
        headingLevel={1}
        background={{ src: '/banners/eu-dawn.svg' }}
        tickerText={name.toUpperCase()}
        heading={`Campsites in ${name}`}
        description={lead}
        cta={{ href: '#regions', label: 'Browse regions' }}
        minHeight="min(60svh, 480px)"
        textSize={{ desktop: '120px', mobile: '48px' }}
      />

      {/* 2. Ticker of the largest regions. Renders nothing without a
          region that has a count above zero. */}
      <RegionTicker
        country={params.country}
        countryName={name}
        regions={regions}
        className="mt-8"
      />

      {/* 3. Design-audit §11, screen 1: the figures, on the theme's card.
          Which figures are printed is decided in lib/hub-stats.ts — a
          price appears only where enough sites carry one. */}
      <HubStatTiles tiles={tiles} asOf={countedAsOf(hubStatsReadAt(stats))} />

      {/* 4. Two ways on, with a hierarchy: the map is the main action
          (filled), planning a trip the quiet one (outlined). */}
      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink href="/map" variant="primary">
          Open on map
        </ButtonLink>
        <ButtonLink href="/plan" variant="secondary">
          Plan a trip
        </ButtonLink>
      </div>

      {/* 🔴 CAMP-255. Always rendered: a country where nothing is known
          says so in a sentence instead of saying nothing. */}
      <OvernightCoverage countryName={name} regions={countedRows} />

      {/* 5. Region cards — every region, including the single-site ones,
          introduced by the map of where they are. */}
      <section aria-labelledby="regions" className="mt-10">
        <h2 id="regions" className="scroll-mt-20 text-xl md:text-[25px]">
          Regions
        </h2>
        <Block as="p" measure="read" className="mt-2 text-ink-2">
          {regions.length} {regions.length === 1 ? 'region' : 'regions'} of {name},
          each with its campsites, motorhome parks and camper stops.
        </Block>
        <div className="mt-4">
          <CountryMap country={params.country} countryName={name} regions={mapRows} />
        </div>
        <RegionTiles country={params.country} regions={regions} className="mt-4" />
      </section>

      {/* 6. Питання, на які сторінка вже має відповідь у своїх числах
          (CAMP-451, пункт 6). Стоїть ВНИЗУ, під картками регіонів: це не
          вступ, а довідка для того, хто дочитав — і для ШІ-асистента,
          який цитує те, що має джерело й дату.

          🔴 ТЕКСТ НЕ ПИШЕТЬСЯ ТУТ. Відповіді будує `countryFaq` із тих
          самих рядків, із яких зроблені плитки вгорі, і тими самими
          формулюваннями, що на сторінці регіону. Країна без жодного
          кемпінга не дістає секції зовсім: перелік порожній, а `Faq` на
          порожньому не малює нічого — ні заголовка, ні рамки. */}
      {faq.length > 0 && (
        <section className="mt-12" aria-labelledby="country-faq-heading">
          <h2 id="country-faq-heading" className="text-xl md:text-[25px]">
            Questions about camping in {name}
          </h2>
          <Faq
            testId="country-faq"
            items={faq.map((f) => ({
              key: f.key,
              question: f.question,
              answer: f.answer,
            }))}
          />
        </section>
      )}

      {/* 🔴 СЕКЦІЯ МАТЕРІАЛІВ — ТА САМА, ЩО НА /blog (CAMP-465, пункт 3).
          Власник просив, щоб картки матеріалів можна було класти на
          будь-яку сторінку, бо внизу сторінок він хоче чергувати то
          блог-пости, то інші наші фічі.

          🔴 ПОРОЖНІЙ БЛОГ НЕ ЛАМАЄ СТОРІНКУ: `PostCards` на порожньому
          переліку не малює нічого, тож і заголовок секції стоїть під
          тією самою умовою — заголовок над порожнечею читається як
          поломка. Беремо три найсвіжіші: більше тут нема куди. */}
      {posts.length > 0 && (
        <section className="mt-12" aria-labelledby="from-the-blog">
          <h2 id="from-the-blog" className="text-xl md:text-[25px]">
            From the blog
          </h2>
          <div className="mt-4">
            <PostCards
              testId="country-posts"
              columns={3}
              items={posts.slice(0, 3).map((p) => ({
                key: p.slug,
                href: `${BLOG_PATH}/${p.slug}`,
                title: p.title,
                excerpt: p.summary ?? undefined,
                meta: p.publishedAt ? postDate(p.publishedAt) : undefined,
              }))}
            />
          </div>
        </section>
      )}

      {/* 7. Two banners: the other things this site does for a trip here. */}
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
            heading: 'Guides',
            text: 'Packing, driving, overnight rules and the small print of camping in Europe — written from our data, not from brochures.',
            cta: { href: '/guides', label: 'Read the guides' },
          },
        ]}
      />

      {/* 8. The box banner about us. */}
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
