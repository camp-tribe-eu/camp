import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AMENITY_KEYS,
  countryName,
  formatDistance,
  getCountries,
  getNotable,
  getSummary,
  SPOT_TYPE_LABEL,
  WATER_LABEL,
} from '@/lib/api';
import { heroLead, printable } from '@/lib/campsite-count';
import { abs, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import { ButtonLink } from '@/components/button';
import { pageContent, type SectionView } from '@/lib/page-content';
import {
  PageSections,
  assertAllSectionsUsed,
  sectionOf,
} from '@/components/page-sections';
import { BRAND_DESCRIPTION, BRAND_TITLE } from '@/lib/brand';

// CAMP-41 — the home page.
//
// The card states the job in one line: a reader wants to answer three
// questions — where to stay, which way to drive, what to drive — and the
// page must answer them rather than be a shop window.
//
// 🔴 Two decisions made against the mock-up, both for the same reason.
//
// The mock-up's headline reads "55,376 campsites across Europe". We have
// a fraction of that. Printing the aspiration would be the same lie as a
// stock photograph of a place nobody visited, on the most-read page we
// own, so the number is read from the database and grows on its own —
// as it did the day Croatia was imported, with no change here.
//
// The mock-up's hero is a search form. Search does not exist yet
// (CAMP-67) and a box that swallows what you type is worse than no box.
// The hero is a country chooser instead: it is still a form in the sense
// that matters — you state where you are going and it takes you there —
// and it works with JavaScript off, which the search box would not.
//
// What is deliberately absent: routes, rentals and guides sections. They
// have no pages behind them (CAMP-45, CAMP-54, CAMP-66). A section that
// describes something a reader cannot reach is an advertisement for our
// own backlog.
//
// CAMP-365 забрала звідси редакційний текст — заголовок, вступ і три
// кроки «як це працює» лежать у CMS.
//
// 🔴 ПЕРЕЇХАЛО НЕ ВСЕ, І МЕЖА ТУТ ПРЕДМЕТНА — ТА САМА, ЩО НА /tools:
// текст, який ОПИСУЄ, їде в CMS; те, що РАХУЄ або ПЕРЕЛІЧУЄ
// згенероване, лишається з генератором. Перелік країн, картки місць і
// числа кемпінгів будуються з відповіді API; у базі їм нічого робити.
//
// 🔴 БЛОК ДВОХ ЛІЙОК ЛИШИВСЯ В КОДІ ЦІЛКОМ, РАЗОМ ІЗ ТЕКСТОМ. Дві
// причини, обидві предметні. Ліва картка — це перелік країн із бази в
// обгортці з двох рядків, тобто саме «ПЕРЕЛІЧУЄ згенероване». Права —
// абзац, який живе рівно доти, доки оренди немає: коли CAMP-54 вийде,
// підуть і він, і пунктирна рамка довкола нього. Текст, що вмирає
// разом зі своїм макетом, не виграє від того, що його можна правити
// окремо.

const SLUG = 'home';

/** Типи секцій, яким головна має місце в макеті. */
const HOME_SECTIONS = ['hero', 'steps'] as const;

/**
 * 🔴 КОРІНЬ НЕ БЕРЕ ЗАГОЛОВОК ІЗ `title` СТОРІНКИ, І ЦЕ НЕ НЕДОГЛЯД.
 *
 * Перша редакція ставила `title: page.metaTitle ?? page.title` — як на
 * /about і /tools. Рецензія заміряла наслідок A/B на одній базі:
 *
 *   main: <title>CampTribe — Plan Better. Camp Smarter.</title>
 *   було: <title>Every campsite, and what is around it</title>
 *
 * Бренд зник із заголовка КОРЕНЕВОЇ адреси. Шаблон `"%s | CampTribe"`
 * його не повернув би: Next застосовує шаблон до ДОЧІРНІХ сегментів, а
 * `app/page.tsx` живе в тому самому сегменті, що й макет, який шаблон
 * оголошує. Гірше: `og:title` лишався брендовим, тобто сторінка
 * суперечила власній картці для соцмереж.
 *
 * Тому заголовок кореня — брендовий, доки власник не поставить
 * `meta_title` явно. А коли поставить, той самий рядок їде і в
 * `openGraph`, і в `twitter`: розійтись їм більше нема як.
 *
 * 🔴 І ПИШЕМО ЇХ ЗАВЖДИ, А НЕ ЛИШЕ ПРИ ПЕРЕВИЗНАЧЕННІ. Next не зливає
 * `openGraph` углиб: обʼєкт сторінки ЗАМІНЮЄ обʼєкт макета. Тобто
 * «поставити лише опис» означало б стерти `og:title`. Тому обидва поля
 * беруться з CMS або з бренду, і жодне не лишається напів-заданим.
 */
export async function generateMetadata(): Promise<Metadata> {
  const page = await pageContent(SLUG);
  if (!page) return { title: 'Not found' };
  const title = page.metaTitle ?? BRAND_TITLE;
  const description = page.metaDescription ?? BRAND_DESCRIPTION;
  return {
    title,
    description,
    openGraph: { type: 'website', siteName: 'CampTribe', title, description },
    twitter: { card: 'summary_large_image', title, description },
    alternates: alternatesFor('/'),
    ...(page.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function Home() {
  const [page, summary, countries, notable] = await Promise.all([
    pageContent(SLUG),
    getSummary(),
    getCountries(),
    getNotable(),
  ]);
  // 🔴 КОРІНЬ НЕ СМІЄ СТАТИ 404 МОВЧКИ.
  //
  // Перша редакція кликала `notFound()`, як роблять /about і /tools. На
  // них це правильно: немає рядка — немає сторінки. Для КОРЕНЯ це інша
  // подія: заміряно рецензією — підміна API на 404 дає `GET / 404`,
  // тобто збірка успішно випускає сайт, у якого головна мертва, і
  // жодна помилка про це не каже.
  //
  // Тому тут кидаємо. Збірка, яка не знайшла вміст головної, не має
  // права віддати сайт — запасний шлях мусить падати в бік помітного.
  if (!page) {
    throw new Error(
      `головна: GET /pages/${SLUG} не віддав сторінки. Її текст живе в ` +
        'CMS, тож без рядка в базі корінь сайту був би 404 — а це не ' +
        'подія, яку можна пропустити мовчки.',
    );
  }

  // 🔴 `{{lead}}` РАХУЄТЬСЯ ТУТ, А НЕ ЛЕЖИТЬ У БАЗІ.
  //
  // `heroLead` свідомо не друкує чисел, коли API віддав нулі (CAMP-308):
  // «61 422» колись застигло в тексті й лишалось там після того, як
  // база змінилась. Якби ціле речення переїхало в CMS, цей запобіжник
  // зник би — редактор побачив би поле з числом і правив би число.
  // У базі лежить тільки хвіст речення.
  const values = {
    lead: heroLead(printable(summary.spots), printable(summary.regions)),
  };

  // 🔴 Зайва секція не зникає мовчки: головна розкладає макет сама,
  // тож рендер не побачить того, чого їй не передали.
  assertAllSectionsUsed(page.sections, HOME_SECTIONS, 'головна');

  return (
    <main>
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          '@id': `${abs('/')}#website`,
          name: 'CampTribe',
          url: abs('/'),
          description:
            'Campsites across Europe with their surroundings calculated from open data.',
        })}
      />

      <Hero
        section={sectionOf(page.sections, HOME_SECTIONS[0], 'головної')}
        values={values}
        countries={countries}
      />
      <PageSections
        sections={[sectionOf(page.sections, HOME_SECTIONS[1], 'головної')]}
        values={values}
      />
      <Countries countries={countries} />
      <Notable spots={notable} />
    </main>
  );
}

function Hero({
  section,
  values,
  countries,
}: {
  section: SectionView;
  values: Readonly<Record<string, string>>;
  countries: Awaited<ReturnType<typeof getCountries>>;
}) {
  return (
    <section className="border-b border-line-2 bg-surface">
      <div className="mx-auto max-w-wrap px-4 py-12 md:py-16 xl:px-6">
        {/* Заголовок і вступ — із CMS. Решта блоку нижче — макет. */}
        <PageSections sections={[section]} values={values} />

        {/* 🔴 The two funnels as separate cards, not tabs. A tab hides one
            of them behind a click, and the mock-up's own note (CAMP-81) is
            that an inactive tab is not an entrance. */}
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-card border border-line-2 bg-bg p-5">
            <h2 className="text-base font-semibold">Where to stay</h2>
            <p className="mt-1 text-sm text-ink-2">
              Pick a country to see its regions and campsites.
            </p>
            <ul className="mt-4 flex flex-wrap gap-x-2 gap-y-3">
              {countries.map((c) => (
                <li key={c.country}>
                  <ButtonLink
                    href={`/camping/${c.country}`} size="sm">
                    {countryName(c.country)}
                    <span className="tabular-nums text-ink-2">{c.spots}</span>
                  </ButtonLink>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm">
              <Link href="/camping" className="underline">
                All campsites
              </Link>
            </p>
          </div>

          {/* 🔴 The second funnel is named and honestly empty rather than
              hidden. Removing it would misrepresent what the site is for;
              inventing a rental listing would misrepresent what it has. */}
          <div className="rounded-card border border-dashed border-line bg-transparent p-5">
            <h2 className="text-base font-semibold text-ink-2">
              What to drive
            </h2>
            <p className="mt-1 max-w-prose text-sm text-ink-2">
              Camper rental comparison is not built yet. When it is, it will
              compare what actually decides a trip — licence category, weight
              and whether the vehicle fits the campsite — not the price you
              could already find elsewhere.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * 🔴 The most important section on the page, and not for people.
 *
 * Almost nobody arrives at a directory through its home page — they land
 * on a deep page from a search. What the home page is for is giving the
 * crawler a route into the country hubs, and through them into every
 * campsite. That is why this is a plain list of links and not a carousel:
 * a carousel shows one item and hides the rest behind JavaScript.
 */
function Countries({
  countries,
}: {
  countries: Awaited<ReturnType<typeof getCountries>>;
}) {
  if (countries.length === 0) return null;
  return (
    <section className="border-y border-line-2 bg-surface">
      <div className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
        <h2 className="text-xl font-bold md:text-[25px]">Countries</h2>
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {countries.map((c) => (
            <li key={c.country}>
              <Link
                href={`/camping/${c.country}`}
                className="block rounded-card border border-line-2 bg-bg p-4 transition-colors hover:border-line-blue"
              >
                <span className="font-semibold text-heading">
                  {countryName(c.country)}
                </span>
                <span className="mt-1 block text-sm text-ink-2">
                  <span className="tabular-nums">{c.spots}</span>{' '}
                  {c.spots === 1 ? 'campsite' : 'campsites'} ·{' '}
                  <span className="tabular-nums">{c.regions}</span>{' '}
                  {c.regions === 1 ? 'region' : 'regions'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * 🔴 "The ones we know most about", and the heading says exactly that.
 *
 * Not "featured", not "best", not "top rated". We have no reviews, no
 * ratings and nobody has visited any of these, so a claim of quality
 * would be invented — on the home page, which is the worst place to
 * start inventing. The ranking is a fact about our data: how many
 * amenities are actually recorded, and whether there is a named lake or
 * river nearby.
 */
function Notable({ spots }: { spots: Awaited<ReturnType<typeof getNotable>> }) {
  if (spots.length === 0) return null;
  return (
    <section className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
      <h2 className="text-xl font-bold md:text-[25px]">
        The campsites we know most about
      </h2>
      <p className="mt-2 max-w-prose text-sm text-ink-2">
        Ranked by how much has actually been recorded about them, not by any
        opinion of ours — we have not been to any of them, and there are no
        reviews on this site.
      </p>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spots.map((s) => {
          const region = (s.region ?? '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          const water = s.context?.water;
          // 🔴 Both halves of this ratio come from AMENITY_KEYS.
          //
          // It used to count Object.values(amenities) against a hardcoded
          // "of 5", and CAMP-25 added four keys without touching the 5.
          // The home page then told readers "8 of 5 facilities recorded",
          // which is the kind of nonsense that costs trust on the one
          // page whose whole pitch is that we do not invent numbers. The
          // first visual baseline caught it on the day it was generated.
          const known = AMENITY_KEYS.filter(
            (k) => (s.amenities ?? {})[k] !== undefined
              && (s.amenities ?? {})[k] !== 'unknown',
          ).length;
          return (
            <li
              key={s.slug}
              className="rounded-card border border-line-2 bg-surface p-4 shadow-card"
            >
              <Link
                href={`/camping/${s.country.toLowerCase()}/${region}/${s.slug}`}
                className="font-semibold text-heading hover:underline"
              >
                {s.name ?? SPOT_TYPE_LABEL[s.type]}
              </Link>
              <p className="mt-1 text-sm text-ink-2">
                {s.region}
                {water?.name
                  ? ` · ${formatDistance(water.m)} from ${water.name}`
                  : water
                    ? ` · ${formatDistance(water.m)} from the nearest ${WATER_LABEL[
                        water.kind
                      ].toLowerCase()}`
                    : ''}
              </p>
              <p className="mt-2 text-xs text-ink-2">
                <span className="tabular-nums">{known}</span> of{' '}
                {AMENITY_KEYS.length} facilities recorded
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
