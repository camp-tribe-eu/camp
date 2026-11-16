import type { Metadata } from 'next';
import OpeningHours from '@/components/opening-hours';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AMENITY_KEYS,
  AMENITY_LABEL,
  countryName,
  getSpot,
  getSpotIndex,
  NearbySpot,
  Spot,
  formatDistance,
  SPOT_TYPE_LABEL,
  TERRAIN_LABEL,
  WATER_LABEL,
  withOwnerOverrides,
} from '@/lib/api';
import {
  campsiteFaq,
  campsitePageGraph,
  jsonLdProps,
  officialStars,
} from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import { RAILWAY_STOP, RAILWAY_STOP_TITLE } from '@/lib/railway-stop';
import TravelNotice from '@/components/travel-notice';
import Faq from '@/components/faq';
import AmenityList from '@/components/amenity-list';
import OvernightStay from '@/components/overnight-stay';
import RecordEdited from '@/components/record-edited';
import SourceNote from '@/components/source-note';
import TariffTable from '@/components/tariff-table';
import BathingWaterNote from '@/components/bathing-water';
import CampServices from '@/components/camp-services';
import CampDisturbance from '@/components/camp-disturbance';
import { DISTURBANCE_PAGE, disturbanceView } from '@/lib/disturbance';
import { CAMP_SERVICES_PAGE, servicesView } from '@/lib/camp-services';
import { pageContent } from '@/lib/page-content';
import AirQualityNote from '@/components/air-quality';
import { DroughtPanel } from '@/components/drought-panel';
import { WarningsForSpot } from '@/components/warnings-for-spot';
import { settingParagraph } from '@/lib/setting';
import { droughtAtBuild } from '@/lib/drought-build';
import { WebcamNote } from '@/components/webcam-panel';
import PlanBBlock from '@/components/plan-b';
import { ButtonLink } from '@/components/button';
import { CampsiteMedia, type Photo } from '@/components/campsite-media';
import { ScaleTrack, SpotFactsLine } from '@/components/spot-facts';
import { aroundRows, cleanContext, spotFacts } from '@/lib/spot-facts';
import ReportProblem from '@/components/report-problem';
import SpotEvents from '@/components/spot-events';
import { websiteHref } from '@/lib/events';
import { Block } from '@/components/layout';
import { TrustLegend } from '@/components/trust';
import { TRUST_PAGE, amenityTrust, trustLegend } from '@/lib/trust';
import SpotTabs from '@/components/spot-tabs';
import { spotTabs } from '@/lib/spot-tabs';
import { absence } from '@/lib/webcams';

// CAMP-34 — the campsite page.
//
// The point of this page is not the layout, it is the honesty of it. We
// have no photographs and, for most sites, no idea whether there is a
// shower. Two temptations follow, and the card rejects both:
//
//   stock imagery   — a picture of "a campsite" for a place nobody has
//                     seen is a misleading commercial practice under
//                     UCPD art. 6(1). The owner rejected it outright.
//   a tidy "no"     — printing "no shower" because a tag is absent turns
//                     a gap in OpenStreetMap into a false statement about
//                     a real business. Hence the tri-state (CAMP-27).
//
// What is left is genuinely ours: an honest gap is a reason for the owner
// to claim the listing (CAMP-86), which is the whole content strategy.

type Params = { country: string; region: string; slug: string };

// 🔴 CAMP-73: false, and the reason is what a reader without JavaScript
// sees.
//
// With `true`, a campsite URL that is not in the build is rendered on
// demand, calls notFound(), and Next answers with its client-side error
// shell — `<html id="__next_error__">` carrying the 404 content inside
// the RSC payload rather than as markup. It looks perfect in a browser
// and is completely blank to anyone without JavaScript, including a
// crawler that does not run it. That is the exact page where being
// readable without JavaScript matters most: dead campsite URLs are
// guaranteed here, because the weekly OSM import rebuilds slugs.
//
// With `false`, an unknown campsite falls through to the prerendered
// 404, which is real HTML. Nothing is lost: we know every campsite at
// build time, and one that appears between builds is not ours to serve
// until the next one anyway.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  const index = await getSpotIndex();
  return index.map(({ country, region, slug }) => ({ country, region, slug }));
}

export async function generateMetadata(
  props: {
    params: Promise<Params>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const data = await getSpot(params.country, params.region, params.slug);
  if (!data) return { title: 'Campsite not found' };

  const spot = withOwnerOverrides(data.spot);
  const name = spot.name ?? `${SPOT_TYPE_LABEL[spot.type]} near ${spot.region}`;
  const where = [spot.region, spot.country.toUpperCase()]
    .filter(Boolean)
    .join(', ');

  return {
    title: `${name} — ${where}`,
    // No superlatives and no invented detail: the description carries the
    // computed facts (CAMP-33) because those are the part that differs
    // from site to site and the part a person is actually choosing on.
    // A description built only from the template would be the same
    // sentence 291 times with the name swapped.
    description: describe(spot, where),
    alternates: alternatesFor(
      `/camping/${params.country}/${params.region}/${params.slug}`,
    ),
    // A campsite OSM has dropped is kept reachable but must stop ranking
    // until it comes back (the four-import rule, CAMP-87).
    //
    // 🔴 Spread, never `robots: undefined`. Next merges child metadata
    // over the root, and a key that is present with an undefined value
    // still overwrites — which silently cancelled the site-wide noindex
    // from CAMP-90 on 326 of 401 pages. Omitting the key is the only way
    // to mean "do not narrow this".
    // 🔴 CAMP-105. And a page that has nothing on it but a name.
    //
    // 2 354 of 9 830 campsites (24%, measured 24.09.2026) carry no
    // amenity, no computed surroundings, no description and no star
    // rating. The page is honest — it says what is not recorded, which is
    // the whole promise — but two such pages differ only by the name, and
    // that is what kept pushing the near-duplicate guard towards its
    // ceiling.
    //
    // `follow`, and never a 404: the page is reachable from the map and
    // from its region hub, somebody looking for that campsite should find
    // it, and the crawl path through it has to survive. It simply should
    // not compete in a result list against a page with something to say.
    //
    // It lifts by itself the day anything is recorded — the rule is a SQL
    // expression over the row, not a list anybody maintains.
    ...(spot.missingSince || spot.indexable === false
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

/**
 * CAMP-141: the contact block.
 *
 * 🔴 Two websites, one link. `spot.website` comes from DATAtourisme, an
 * official tourism register; `spot.contact.website` is whatever a mapper
 * typed in OpenStreetMap. The register wins where both exist — the same
 * precedence the structured data uses, decided in one place rather than
 * twice.
 *
 * Every value here is open data typed by a stranger, so the URL was
 * already checked at import (`cleanWebsite`, http and https only) and
 * `rel="nofollow ugc"` says what it is to a crawler: user-generated,
 * not an endorsement.
 */
/**
 * Чи є в `Contact` що показати.
 *
 * 🔴 ВИНЕСЕНО, БО ЦЕ ПИТАННЯ СТАВИТЬ НЕ ЛИШЕ САМ `Contact`. Розкладка в
 * дві колонки має сенс тільки тоді, коли в лівій щось є; інакше читач
 * бачить 426 px порожнечі поруч із мапою. Два окремі переліки полів
 * розійшлись би першого ж дня, коли до контактів додадуть ще одне.
 */
// 🔴 БЕЗ `export`. `page.tsx` у Next приймає лише свій перелік
// експортів (`default`, `metadata`, `generateStaticParams` і далі), і
// зайвий валить збірку — але `tsc` мовчить про це, доки немає
// `.next/types`. Я на це вже наступав.
function hasContact(spot: Spot): boolean {
  const contact = spot.contact ?? {};
  const site = spot.website ?? contact.website ?? null;
  const { phone, email, openingHours, operator, address } = contact;
  const city = [address?.postcode, address?.city].filter(Boolean).join(' ');
  return Boolean(
    site || phone || email || openingHours || operator || address?.street || city,
  );
}

/**
 * CAMP-51, CAMP-505 — «Це мій кемпінг», і лише там, де самоверифікація
 * може спрацювати.
 *
 * 🔴 ПОКАЗУЄМО ЛИШЕ ТАМ, ДЕ Є ЩО ПОРІВНЯТИ: сайт кемпінгу або пошта в
 * контактах. Без жодного з двох домен порівняти нема з чим, і людину
 * вели б у форму, яка заздалегідь не має шансу. Це не обіцянка, що
 * домен збіжиться: сайт може стояти на Facebook, а пошта бути на Gmail,
 * і тоді форма скаже це прямо й назве, куди писати.
 *
 * Нічого нового про кемпінг це не видає: і сайт, і пошту сторінка вже
 * показує в блоці «Getting in touch».
 *
 * 🔴 Звичайне посилання, не острівець. Сторінки кемпінгів будуються один
 * раз на всі 63 тисячі; форма живе за /account/claim, за сесією.
 */
function ClaimListing({ spot }: { spot: Spot }) {
  const contact = spot.contact ?? {};
  if (!spot.website && !contact.website && !contact.email) return null;
  return (
    <p className="mt-6 text-sm text-ink-2">
      Is this your campsite?{' '}
      <Link className="underline" href={`/account/claim?spot=${spot.slug}`}>
        This is my campsite
      </Link>{' '}
      — confirm with an email address on the campsite’s own website domain.
    </p>
  );
}

function Contact({ spot }: { spot: Spot }) {
  const contact = spot.contact ?? {};
  const site = spot.website ?? contact.website ?? null;
  const { phone, email, openingHours, operator, address } = contact;
  const city = [address?.postcode, address?.city].filter(Boolean).join(' ');
  const street = address?.street;
  if (!hasContact(spot)) {
    // 🔴 `capacity` is deliberately NOT in this test.
    //
    // It was, and review found the result: 306 campsites rendered a
    // section headed "Getting in touch" whose entire content was
    // "Pitches 2", under a note about contact details that applied to
    // nothing on it. The number of pitches is a fact about the site, not
    // a way to reach anybody — it belongs with the other facts, below.
    return null;
  }
  return (
    <Section title="Getting in touch" card>
      <Block as="dl" measure="narrow" className="mt-1 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        {site && (
          <>
            <dt className="text-sm text-ink-2">Website</dt>
            <dd className="text-sm">
              {/* CAMP-504: через наш редирект, який веде лише на адресу з
                  бази за slug (`/out/<slug>`); без налаштованого API — прямо. */}
              <a
                href={websiteHref(spot.slug, site)}
                rel="nofollow ugc noopener"
                target="_blank"
                className="underline underline-offset-2"
              >
                {site.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            </dd>
          </>
        )}
        {phone && (
          <>
            <dt className="text-sm text-ink-2">Phone</dt>
            <dd className="text-sm">
              {/* 🔴 One number in the href, whatever the tag holds.
                  OSM separates several with ';' and the import now keeps
                  only the first — this split is the second belt, because
                  a `tel:` with two numbers glued together dials neither,
                  and review found 157 live rows doing that. */}
              <a
                href={`tel:${phone.split(';')[0].replace(/[^+\d]/g, '')}`}
                data-ct-event="phone_click"
                className="underline underline-offset-2"
              >
                {phone}
              </a>
            </dd>
          </>
        )}
        {email && (
          <>
            <dt className="text-sm text-ink-2">Email</dt>
            <dd className="text-sm">
              <a href={`mailto:${email}`} className="underline underline-offset-2">
                {email}
              </a>
            </dd>
          </>
        )}
        {(street || city) && (
          <>
            <dt className="text-sm text-ink-2">Address</dt>
            <dd className="text-sm text-ink-2">
              {[street, city].filter(Boolean).join(', ')}
            </dd>
          </>
        )}
        {openingHours && (
          <>
            <dt className="text-sm text-ink-2">Open</dt>
            {/* CAMP-463: словами, коли розбір точний; інакше «Opening
                hours as recorded» під спойлером. Сезонні й умовні форми
                НЕ переписуються — див. lib/opening-hours.ts. */}
            <dd className="text-sm text-ink-2">
              <OpeningHours value={openingHours} />
            </dd>
          </>
        )}
        {operator && (
          <>
            <dt className="text-sm text-ink-2">Operated by</dt>
            <dd className="text-sm text-ink-2">{operator}</dd>
          </>
        )}
      </Block>
      <Block as="p" measure="read" className="mt-3 text-xs text-ink-2">
        Contact details come from OpenStreetMap and are only as current as
        the last person to edit them. Check with the site before you set off.
      </Block>
    </Section>
  );
}

export default async function CampsitePage(props: { params: Promise<Params> }) {
  const params = await props.params;
  const data = await getSpot(params.country, params.region, params.slug);
  if (!data) notFound();

  const spot = withOwnerOverrides(data.spot);
  // 🔴 CAMP-503: the block's words. A CMS that cannot answer costs the block,
  // not the campsite page (the fault's reach stays the size of the fault).
  const servicesPage = await pageContent(CAMP_SERVICES_PAGE).catch(() => null);
  // CAMP-502: the same for the disturbance block; a missing page costs the block.
  const disturbancePage = await pageContent(DISTURBANCE_PAGE).catch(() => null);
  const disturbance = disturbanceView(spot.disturbance, disturbancePage?.sections ?? null);
  // CAMP-521: what the status words MEAN is prose and lives in the CMS. A CMS
  // that cannot answer costs the legend; the words on the values stay.
  const trustPage = await pageContent(TRUST_PAGE).catch(() => null);
  const facts = spotFacts(spot);
  const amenitiesTrust = amenityTrust(spot, spot.amenities, AMENITY_KEYS);
  const legend = trustLegend(
    [...facts.map((f) => f.trust), ...Object.values(amenitiesTrust)],
    trustPage?.sections ?? null,
  );
  const name = spot.name;
  const setting = settingParagraph(spot.context);
  const known = Object.values(spot.amenities).filter(
    (v) => v !== 'unknown',
  ).length;

  const path = `/camping/${params.country}/${params.region}/${params.slug}`;
  const faq = campsiteFaq(spot);
  const crumbs = [
    { name: 'Camping', path: '/camping' },
    { name: countryName(spot.country), path: `/camping/${params.country}` },
    { name: spot.region ?? '', path: `/camping/${params.country}/${params.region}` },
    { name: name ?? SPOT_TYPE_LABEL[spot.type], path },
  ];


  // Поки джерела фото немає (CAMP-342, CAMP-233, CAMP-232), це завжди
  // порожньо — але умова стоїть в одному місці, а не в двох.
  const photos: Photo[] = [];
  const hasPhotos = photos.length > 0;
  const mapLabel = name ?? `${SPOT_TYPE_LABEL[spot.type]} near ${spot.region}`;

  // 🔴 ОДИН ГОДИННИК НА ВСЮ СТОРІНКУ. Кожен `new Date()` у JSX давав
  // свою мілісекунду; камери й повітря судять свіжість за тим самим
  // моментом збірки.
  const renderedAt = new Date().toISOString();

  // 🔴 CAMP-453: ТАБ ІСНУЄ ЛИШЕ ТАМ, ДЕ Є ЩО ПОКАЗАТИ.
  //
  // Камери — коли хоч одна може бути показана (`absence` == null).
  // «Немає камер у радіусі» і «усі застарілі» — це ВІДПОВІДІ про
  // покриття, а не вміст для таба; вони йдуть окремим реченням у блоці
  // умов нижче, на виду (їх не ховаємо за кліком — див. нижче).
  //
  // Тривоги — коли відомі зони цього кемпінгу (`null` — «не знаємо», і
  // панель мовчить, тож таба теж немає).
  //
  // Погода — джерела прогнозу в коді немає (CAMP-477), тож не передаємо.
  const cameraState = absence(spot.webcams, new Date(renderedAt));
  const hasWebcamTab = cameraState === null;
  const hasAlertsTab = Array.isArray(spot.warningAreas);
  const tabs = spotTabs({ webcams: hasWebcamTab, alerts: hasAlertsTab });
  const site = spot.website ?? spot.contact?.website ?? null;

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      {/* CAMP-37. Separate blocks rather than one @graph: Google reads
          them all, and a breakage in one does not take the others down
          with it.

          🔴 CAMP-114: the list comes from `campsitePageGraph` and is not
          assembled here. A <script> added straight into this JSX would
          be invisible to the test that enforces "no type without data
          behind it", which is the one rule this card cannot break. */}
      {campsitePageGraph({ spot, path, crumbs, faq }).map((doc, i) => (
        <script key={i} {...jsonLdProps(doc)} />
      ))}

      <Breadcrumbs spot={spot} params={params} />

      {/* 🔴 CAMP-453 — СТОРІНКА ТОВАРУ ТЕМИ (PDP), А НЕ СТЕК СЕКЦІЙ.
          Еталон — Fuse: ліворуч вузька колонка білих карток на всю
          висоту, праворуч одне стікі-медіа, яке лишається на екрані,
          поки читач гортає картки (знімок `f-product-1440-t00`; 480 px
          з 1416, відступ 12 px, радіус 16 px — `docs/design-system-from-theme.md`).

          🔴 ТРИ ДІТИ СІТКИ Й ПОРЯДОК У DOM: заголовок → медіа → решта
          карток. На телефоні це й є порядок, який бачить око (мапа йде
          одразу під назвою, а не через три екрани карток), і порядок,
          яким ходить клавіатура — без `order`, який їх розводив би. На
          десктопі заголовок і решта стоять в одній колонці (`col-start-1`,
          рядки 1 і 2), а медіа займає обидва рядки правої (`row-span-2`).

          🔴 СТІКІ ЖИВЕ ВСЕРЕДИНІ ЕЛЕМЕНТА, ЩО РОЗТЯГНУТИЙ НА ОБИДВА
          РЯДКИ, а не на самому грід-елементі з `items-start`: такий
          елемент рівно по висоті власного вмісту, і стікі нікуди
          рухатись. Мутація «прибрати `sticky`» червонить e2e. */}
      <div
        data-testid="campsite-hero"
        className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]"
      >
        <header
          data-testid="campsite-title"
          className="min-w-0 rounded-card bg-surface p-5 shadow-card lg:col-start-1 lg:row-start-1"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-2">
            {SPOT_TYPE_LABEL[spot.type]}
          </p>
          <h1 className="mt-2 text-3xl leading-tight">
            {/* An unnamed site still needs a heading a person can read and a
                search engine can rank. "Campsite" alone is neither, and it
                would also disagree with the <title>. */}
            {name ?? `${SPOT_TYPE_LABEL[spot.type]} near ${spot.region}`}
          </h1>
          <p className="mt-2 text-ink-2">
            {[spot.region, spot.country.toUpperCase()].filter(Boolean).join(', ')}
            {/* 🔴 The official national classification, where a source
                publishes one — France does, OpenStreetMap does not carry
                it at all. Said as what it is: somebody else's rating, not
                ours.

                🔴 The same reading as the graph, not a looser one. This
                checked only `!== null`, so a payload without the field
                printed "undefined-star official classification" while the
                JSON-LD correctly carried nothing. Found in review. */}
            {officialStars(spot) !== undefined && (
              <>
                {' · '}
                <span data-testid="official-stars">
                  {officialStars(spot)}-star official classification
                </span>
              </>
            )}
          </p>
          {!name && (
            // 26% of campsites in OSM carry no name at all (measured on 448
            // Slovenian sites). Dropping them would remove a quarter of the
            // map; inventing a name would be worse.
            <Block as="p" measure="read" className="mt-3 text-sm text-ink-2">
              This site has no name in OpenStreetMap. The location is real — the
              name simply has not been recorded by anyone yet.
            </Block>
          )}
          {/* 🔴 CAMP-199: what WE measured about this place, in words —
              how far the water is, the nearest town and shop. It varies
              with the campsite (NOT `data-boilerplate`), and it is the
              part of the page nobody else publishes. The measured
              figures behind it live in `lib/setting.ts` and are enforced
              by `tests/unit/setting.spec.ts`; they are not repeated here,
              because two copies of a measurement drift. */}
          {setting && (
            <Block as="p" measure="read" className="mt-4 text-ink-1" data-testid="setting">
              {setting}
            </Block>
          )}
          {/* 🔴 CAMP-FACTS: built from what THIS campsite has, prints
              nothing for what it has not, absent under two facts — rules
              in `lib/spot-facts.ts`. */}
          <SpotFactsLine facts={facts} />
          {spot.missingSince && <MissingNotice since={spot.missingSince} />}
        </header>

        {/* МЕДІА. Пріоритет — рішення власника 18.10.2026: фото власника,
            інакше фото користувачів, інакше мапа (`photos` поки порожній:
            CAMP-233/232/342 ще не зроблені). Таби: мапа / камери /
            тривоги (погода — після CAMP-477). */}
        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div
            data-testid="campsite-sticky"
            className="rounded-card bg-surface p-3 shadow-card lg:sticky lg:top-20 lg:p-4"
          >
            <SpotTabs
              label="Map, webcams and alerts for this campsite"
              tabs={tabs}
              panels={{
                map: (
                  <CampsiteMedia
                    photos={photos}
                    lat={spot.lat}
                    lon={spot.lon}
                    type={spot.type}
                    label={mapLabel}
                    outline={spot.outline ?? null}
                    disturbance={disturbance?.markers ?? []}
                  />
                ),
                webcams: hasWebcamTab ? (
                  <WebcamNote webcams={spot.webcams} renderedAt={renderedAt} />
                ) : undefined,
                alerts: hasAlertsTab ? (
                  // 🔴 CAMP-287 крок 4: єдина панель, що приходить У БРАУЗЕР,
                  // а не в збірку (бюджет свіжості — десять хвилин, клаузула
                  // 5.6 ліцензії MeteoAlarm; доведено в CAMP-302).
                  <WarningsForSpot country={spot.country} codes={spot.warningAreas ?? null} />
                ) : undefined,
              }}
            />
          </div>
        </div>

        {/* 🔴 КОЛОНКА КАРТОК — І ЦЕ ЗОНА ПЕРСОНИ (CAMP-501). Вибір
            «власник кемпера / орендар» піднімає в ній свій блок (служби
            чи «як дістатися»); заголовок стоїть окремо вище й не
            рухається. Колонка завжди flex, тож `order` з CSS діє й без
            вибору (там усі 0).

            🔴 `[&>*]:mt-0!`: компоненти всередині мають власні `mt-6/8`
            із часів стека секцій. Відстань тепер задає `gap-3`, а
            подвійний відступ — це дірки між картками. */}
        <div
          data-persona-zone
          data-testid="campsite-cards"
          className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-2 [&>*]:mt-0!"
        >
          {/* 🔴 ЗРУЧНОСТІ — ПЕРШИМ ПІСЛЯ ЗАГОЛОВКА (рішення власника,
              441/64: «опції кемпінгу нагорі, загальне внизу»). Три стани
              лишаються трьома: «не записано» — не «немає», і на цьому
              стоять наші умови й кожен фільтр. Порядок ключів — із
              `AMENITY_KEYS`, санітарні поруч навмисно. */}
          <Section title="Facilities" card>
            {known === 0 ? (
              <Block as="p" measure="read" className="text-sm text-ink-2">
                Nothing has been recorded about this site&rsquo;s facilities. That
                is a gap in the data, not a statement that it has none.
              </Block>
            ) : null}
            <div className="mt-1">
              <AmenityList
                testId="spot-amenities"
                keys={AMENITY_KEYS}
                labels={AMENITY_LABEL}
                values={spot.amenities}
                trust={amenitiesTrust}
              />
            </div>
            {/* 🔴 CAMP-256: when a mapper last touched the entry these
                facilities come from. Always rendered — "Not known" is an
                answer. Reads `osmRecordEditedAt` and, where there is none,
                the `updatedAt` of a source the registry marks `edited` —
                and NOTHING ELSE (`lastSeenAt` is the day our importer
                found the place, this week for almost every campsite).
                `record-edited.spec.ts` renders this page with those dates
                years apart and reads what it says. */}
            <RecordEdited osmEditedAt={spot.osmRecordEditedAt} sources={spot.sources} />
          </Section>

          {/* CAMP-147: ціна — і лише там, де вона є (57 236 із 58 436
              сторінок не мають жодної датованої ціни). Компонент не
              малює нічого без неї: порожній заголовок «What it costs» —
              обіцянка, якої сторінка не тримає. */}
          <TariffTable tariffs={spot.tariffs} />

          {/* 🔴 CAMP-255. ALWAYS rendered — it says "not known" and what to
              check where we have no answer. "May I sleep here" is asked
              before "is there a shower". */}
          <OvernightStay overnight={spot.overnight} />

          {/* 🔴 CAMP-503: пальне, зарядка, вода, злив, газ — на території
              й поруч; UNLIKE the sections around it this draws NOTHING
              when no point lies in range, and nothing when the CMS words
              are missing. Слова — з CMS, не з JSX. CAMP-501: власник
              кемпера питає насамперед про злив, газ, струм. CAMP-502:
              «можливий дискомфорт» стоїть у ТІЙ САМІЙ обгортці, одразу
              після служб. `empty:hidden`: обидва блоки можуть не
              намалюватись, і порожня біла картка — це дефект. */}
          <div
            data-persona-first="owner"
            data-testid="campsite-services-card"
            className="rounded-card bg-surface p-5 shadow-card empty:hidden [&>section+section]:mt-6!"
          >
            <CampServices
              view={servicesView(
                spot.campServices,
                spot.hookup,
                servicesPage?.sections ?? null,
              )}
            />
            <CampDisturbance view={disturbance} />
          </div>

          {/* Кнопки дій (Fuse: темна широка основна, дві світлі під нею). */}
          <div data-testid="spot-actions" className="rounded-card bg-surface p-5 shadow-card">
            <div className="flex flex-col gap-2">
              {site && (
                <ButtonLink
                  href={websiteHref(spot.slug, site)}
                  variant="primary"
                  target="_blank"
                  rel="nofollow ugc noopener"
                >
                  Visit website
                </ButtonLink>
              )}
              <div className="grid grid-cols-2 gap-2">
                <ButtonLink href="/map" variant="secondary">
                  Open on map
                </ButtonLink>
                <ButtonLink href="/plan" variant="secondary">
                  Plan a trip
                </ButtonLink>
              </div>
            </div>
          </div>

          {/* 🔴 CAMP-141: how to reach the place. Shown only where
              something exists: a heading with nothing under it tells a
              reader we lost their data. */}
          <Contact spot={spot} />

          <Section title="Getting there" personaFirst="renter" card>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {spot.context.station && (
                <>
                  {/* 🔴 CAMP-325: a STOP, not a station. The field is
                      `railway=station` AND `railway=halt`; the words come
                      from `lib/railway-stop.ts`, the same ones the markup
                      and the prose paragraph use. */}
                  <dt className="text-ink-2">{`Nearest ${RAILWAY_STOP}`}</dt>
                  <dd>
                    {spot.context.station.name ?? RAILWAY_STOP_TITLE}
                    {', '}
                    <span className="tabular-nums">
                      {formatDistance(spot.context.station.m)}
                    </span>
                  </dd>
                </>
              )}
              {spot.context.town && (
                <>
                  <dt className="text-ink-2">Nearest town</dt>
                  <dd>
                    {spot.context.town.name ?? 'Town'}
                    {', '}
                    <span className="tabular-nums">
                      {formatDistance(spot.context.town.m)}
                    </span>
                  </dd>
                </>
              )}
              {/* 🔴 Pitches, in the unit OSM actually records — not
                  schema.org's `maximumAttendeeCapacity`, which counts
                  PEOPLE. */}
              {spot.contact?.capacity !== undefined && (
                <>
                  <dt className="text-ink-2">Pitches</dt>
                  <dd>{spot.contact.capacity}</dd>
                </>
              )}
              <dt className="text-ink-2">Coordinates</dt>
              <dd className="tabular-nums">
                {spot.lat.toFixed(5)}, {spot.lon.toFixed(5)}
              </dd>
            </dl>
            <p className="mt-4 text-xs text-ink-2">
              Distances are straight-line, measured from the centre of the site —
              the road will always be longer.
            </p>
          </Section>

          {/* 🔴 CAMP-56 item 4: the warning where it counts — in the flow,
              visible at the moment somebody decides to drive here; a
              footer link is legally weaker. */}
          <TravelNotice />

          {/* 🔴 The operator's own description, as a quotation and in
              their own language. Not paraphrased, not translated, and
              not presented as ours: it is promotional text, and passing
              it off as a neutral description would be exactly the
              invention this site is built not to do. `lang` is set so a
              screen reader pronounces it correctly. */}
          {spot.description && (
            <figure
              data-testid="source-description"
              className="rounded-card bg-surface p-5 shadow-card"
            >
              <Block
                as="blockquote"
                measure="read"
                lang={spot.descriptionLang ?? undefined}
                cite={spot.sources?.find((s) => s.fields.includes('description'))?.ref}
                className="border-l-2 border-line-2 pl-4 text-ink-2"
              >
                {spot.description}
              </Block>
              <Block as="figcaption" measure="read" className="mt-2 text-xs text-ink-2">
                Written by the campsite or its local tourist office, quoted as
                published — see where this comes from, below.
              </Block>
            </figure>
          )}

          {/* 🔴 УМОВНО, А НЕ ЗАВЖДИ: коли приїде CAMP-233, сторінка з
              фотографією показувала б під нею прохання надіслати
              фотографію. Власник (441/62): «перенести в інфо-частину
              вниз» — тут вона, у кінці колонки, а не на всю ширину під
              мапою. */}
          {!hasPhotos && <NoPhotos />}

          {/* «Report a problem» — the first step of the arbitration the
              owner asked for. A client island on a static page: renders
              closed into the build and talks to the API only from the
              reader's browser (report-problem.spec.tsx walks the import
              graph). Always rendered, photos or not. */}
          <ReportProblem slug={spot.slug} />

          {/* CAMP-504: перегляд картки й клік на телефон. Нічого не малює. */}
          <SpotEvents slug={spot.slug} />

          <ClaimListing spot={spot} />
        </div>
      </div>

      <Around spot={spot} />

      {/* 🔴 CAMP-453: ВТОРИННИЙ БЛОК — умови навколо. Вода для купання,
          якість повітря, посуха: усе це відповіді про довкілля, а не про
          сам кемпінг, тому вони нижче за зручності, ціну й служби.

          🔴 УСІ — БЕЗУМОВНІ, як і були. Кожен компонент сам вирішує, що
          сказати, і одна з відповідей — «жодної купальної води в межах
          2 км» (42 953 кемпінги з 61 558). Вони не ховаються за табом:
          таб ховає такі відповіді за кліком, а e2e на них вимагає
          видимості. Тож вони стоять відкритими, в одному ряду.

          🔴 CAMP-164: `renderedAt` — годинник першого рендеру (збірка на
          сервері); браузер підміняє його своїм при монтуванні, і показник
          старший за чотири години стає «no fresh data» на сторінці, яку
          ніхто не перезбирав. CAMP-163: посуха береться ТУТ, у збірці,
          з гріда 1 280 × 889, що в браузер не потрапляє; друкується
          навіть «no drought» — це вимір, а не порожнеча.

          Камери: коли таба немає, відповідь «немає камер у радіусі» /
          «усі мовчать понад добу» стоїть тут, відкрито (`WebcamNote`
          сам вирішує; для «каталог не імпортовано» не малює нічого). */}
      <div
        data-testid="spot-conditions"
        className="mt-8 grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:mt-0!"
      >
        <BathingWaterNote bathingWater={spot.bathingWater} />
        <AirQualityNote airQuality={spot.airQuality} renderedAt={renderedAt} />
        <DroughtPanel state={droughtAtBuild()} lat={spot.lat} lon={spot.lon} />
        {!hasWebcamTab && <WebcamNote webcams={spot.webcams} renderedAt={renderedAt} />}
      </div>

      <PlanBBlock planB={data.planB} />

      {data.nearby.length > 0 && (
        <Section title="Campsites nearby">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.nearby.map((n) => (
              <NearbyCard key={n.slug} spot={n} />
            ))}
          </ul>
        </Section>
      )}

      {/* 🔴 One attribution block, not two. The per-source block says
          where our information came from, accurately, for each source,
          with the phrasing each licence needs. */}
      {faq.length > 0 && (
        <Section title="Questions we can answer">
          {/* 🔴 Visible, and identical to the JSON-LD: Google's FAQ policy
              requires the answer on the page, and the honest reason is
              the same — we do not tell machines anything we are
              unwilling to tell a reader. CAMP-449: акордеон (`<details>`),
              відповіді лишаються у відданому HTML і без JS. */}
          <Faq
            items={faq.map((f) => ({ key: f.q, question: f.q, answer: f.a }))}
            testId="spot-faq"
          />
        </Section>
      )}

      {/* CAMP-521: the meaning of each status word used above, right before
          the list of sources those words point at. */}
      <TrustLegend
        heading={trustPage?.sections.find((s) => s.slot === 'intro')?.heading ?? null}
        rows={legend}
      />
      <SourceNote sources={spot.sources} />
    </main>
  );
}

/** Search-result description, built from what this site actually has. */
function describe(spot: Spot, where: string): string {
  const c = spot.context ?? {};
  const bits: string[] = [];
  if (c.water) {
    bits.push(
      `${formatDistance(c.water.m)} from ${
        c.water.name ?? WATER_LABEL[c.water.kind].toLowerCase()
      }`,
    );
  }
  if (c.elevation !== undefined) bits.push(`${c.elevation} m above sea level`);
  if (c.town) {
    bits.push(`${formatDistance(c.town.m)} from ${c.town.name ?? 'town'}`);
  }

  const head = `${SPOT_TYPE_LABEL[spot.type]} in ${where}`;
  // Under ~155 characters is where Google stops showing it; the facts are
  // ordered so the most distinguishing one survives a truncation.
  return bits.length
    ? `${head} — ${bits.join(', ')}. Facilities and nearby sites, from OpenStreetMap.`
    : `${head}. Location, facilities and nearby campsites — from OpenStreetMap, with gaps shown as gaps.`;
}

/**
 * 🔴 CAMP-33 — the section that justifies the page existing.
 *
 * Without photographs and with two thirds of amenities unrecorded, this
 * is the only thing here that a reader cannot get from Park4Night,
 * Campercontact or ACSI: none of them publish how far the lake is, how
 * high the site sits, or whether a train stops within walking distance.
 * It is also the shape of fact an assistant quotes when someone asks for
 * "a campsite by a lake near Bled".
 *
 * The prose line first, the numbers under it. A reader takes the
 * sentence; a machine takes the list. Writing only the list would make
 * the page a spreadsheet, and writing only the sentence would lose the
 * precision that makes it worth quoting.
 */
function Around({ spot }: { spot: Spot }) {
  const c = cleanContext(spot.context);
  const rows = aroundRows(c);
  const usedElevation = c.elevation !== undefined || c.terrain !== undefined;
  const scaled = rows.some((r) => r.scale);

  if (rows.length === 0) {
    return (
      <Section title="What&rsquo;s around it">
        <Block as="p" measure="read" className="text-sm text-ink-2">
          The surroundings of this site have not been calculated yet.
        </Block>
      </Section>
    );
  }

  return (
    <Section title="What&rsquo;s around it">
      <Block as="p" measure="read">{summarise({ ...spot, context: c })}</Block>
      {/* 🔴 EACH TRACK IS A FIXED SCALE, written at its right-hand end,
          and never the farthest of the other rows: normalised to its
          neighbours a bar would say "far" in a village and "near" in a
          remote valley. A row with no distance has no track and no row.
          Constants and why: `SCALE_MAX_M` in `lib/spot-facts.ts`. */}
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.key}
            data-row={r.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 border-b border-line-2 py-2 text-sm"
          >
            <dt className="text-ink-2">{r.label}</dt>
            <dd className="tabular-nums text-heading">{r.value}</dd>
            {r.scale && (
              <dd className="col-span-2">
                <ScaleTrack row={r} />
              </dd>
            )}
          </div>
        ))}
      </dl>
      {scaled && (
        <p className="mt-2 text-xs text-ink-2" data-testid="scale-legend">
          Each bar runs from 0 to the distance at its right-hand end; a full
          bar means that far or farther.
        </p>
      )}
      {/* 🔴 Credit the elevation model only where it was used.
          
          This said "from OpenStreetMap geometry and the Copernicus
          elevation model" on every page carrying this section. Measured
          25.09.2026: 9 523 campsites have computed surroundings and NO
          elevation — the DEM was never reached for them, because
          Open-Meteo's free tier is exhausted (CAMP-99). On those pages
          the sentence credited a source that contributed nothing.
          
          Attribution is a factual claim like any other on this page.

          🔴 І ЦЕ МУСИТЬ БУТИ ПОСИЛАННЯ, А НЕ НАЗВА. Заміряно 10.11.2026:
          умови Open-Meteo вимагають дослівно «You must include a link
          next to any location Open-Meteo data are displayed». Тут речення
          називало Copernicus словами й не мало жодного посилання, а
          `open-meteo` не траплявся в усьому `apps/web/src` жодного разу —
          атрибуція жила лише на сторінці джерел. Умова вимагає її поруч
          із місцем показу, і це місце — тут.

          Обидва джерела названі навмисно: висота походить із Copernicus,
          а доходить до нас через Open-Meteo, і їхня ж сторінка ліцензії
          вказує обох. */}
      <p
        className="mt-3 text-xs text-ink-2"
        data-testid="surroundings-credit"
      >
        Calculated by us from OpenStreetMap geometry
        {usedElevation ? (
          <>
            {' and the '}
            <a
              href="https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model"
              className="underline"
              rel="noopener"
            >
              Copernicus elevation model
            </a>
            {', reached through '}
            <a href="https://open-meteo.com/" className="underline" rel="noopener">
              Open-Meteo
            </a>
          </>
        ) : null}
        . Straight-line distances.
      </p>
    </Section>
  );
}

/**
 * One sentence built from whatever is actually known.
 *
 * Deliberately not a template with slots: a sentence that reads "is 2.6 km
 * from and 412 m from" when two facts are missing is worse than a shorter
 * sentence. Clauses are assembled only for the facts that exist.
 */
function summarise(spot: Spot): string {
  const c = spot.context ?? {};
  const what = SPOT_TYPE_LABEL[spot.type].toLowerCase();
  const parts: string[] = [];

  if (c.terrain && c.elevation !== undefined) {
    parts.push(
      `This ${what} sits at ${c.elevation} m above sea level in ${TERRAIN_LABEL[
        c.terrain.type
      ].toLowerCase()} country`,
    );
  } else if (c.elevation !== undefined) {
    parts.push(`This ${what} sits at ${c.elevation} m above sea level`);
  } else {
    parts.push(`This ${what}`);
  }

  if (c.water) {
    const named = c.water.name
      ? `${c.water.name}`
      : `the nearest ${WATER_LABEL[c.water.kind].toLowerCase()}`;
    parts.push(`${formatDistance(c.water.m)} from ${named}`);
  }
  if (c.town) {
    parts.push(
      `${formatDistance(c.town.m)} from ${c.town.name ?? 'the nearest town'}`,
    );
  }
  if (c.station) {
    parts.push(
      `${formatDistance(c.station.m)} from ${
        c.station.name ? `${c.station.name} ${RAILWAY_STOP}` : `a ${RAILWAY_STOP}`
      }`,
    );
  }

  const [head, ...rest] = parts;
  if (rest.length === 0) return `${head}.`;
  const last = rest.pop() as string;
  return rest.length
    ? `${head}, ${rest.join(', ')} and ${last}.`
    : `${head}, ${last}.`;
}

function Breadcrumbs({ spot, params }: { spot: Spot; params: Params }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
      <ol className="flex flex-wrap items-center gap-x-2">
        <li>
          <Link href="/camping" className="hover:text-heading">
            Camping
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          {/* 🔴 The country's NAME, not its code.
              
              The BreadcrumbList a few lines up already emits
              `countryName(spot.country)` — so the structured data said
              "Croatia" while the reader saw "HR" on the same page. A
              breadcrumb that disagrees with the breadcrumb we publish is
              the one kind of mismatch this project cannot afford, since
              the whole plan rests on those pages being trusted. And
              "HR" is not a word most readers can expand anyway. */}
          <Link
            href={`/camping/${params.country}`}
            className="hover:text-heading"
          >
            {countryName(spot.country)}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link
            href={`/camping/${params.country}/${params.region}`}
            className="hover:text-heading"
          >
            {spot.region}
          </Link>
        </li>
      </ol>
    </nav>
  );
}

/**
 * 🔴 The honest empty state, and the outreach funnel in one block.
 *
 * It says what we will not do and why, then asks the one person who can
 * fix it. Free photo sources cover 0.4% of campsites; roughly 10,000
 * operators have an email address sitting in OSM
 * (Facts/photo-content-strategy.md).
 */
function NoPhotos() {
  return (
    <section className="mt-6 rounded-card border border-line-2 bg-surface p-5 shadow-card">
      <h2 className="text-base">
        We don&rsquo;t publish pictures we haven&rsquo;t verified
      </h2>
      <Block as="p" measure="read" className="mt-2 text-sm text-ink-2">
        No stock photography and no AI-generated images of places nobody has
        visited. When a photograph appears here, someone stood there and took
        it, and the date it was taken is shown next to it.
      </Block>
      <p className="mt-4 text-sm">
        <ButtonLink
          href="/contact" variant="primary">
          You own this site? Add your photos
        </ButtonLink>
      </p>
    </section>
  );
}

function MissingNotice({ since }: { since: string }) {
  const date = new Date(since);
  return (
    <p
      role="status"
      className="mt-6 rounded border border-warn/40 bg-warn/5 p-4 text-sm text-ink-2"
    >
      This campsite has stopped appearing in OpenStreetMap since{' '}
      <time dateTime={date.toISOString()}>
        {date.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </time>
      . It may have closed, or the entry may have been removed by mistake — we
      keep the page until several weekly imports agree it is gone.
    </p>
  );
}

function NearbyCard({ spot }: { spot: NearbySpot }) {
  const km = spot.metres >= 1000;
  const region = (spot.region ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (
    <li className="flex gap-3 rounded-card border border-line-2 bg-surface p-4 shadow-card">
      {/* 🔴 ЗОБРАЖЕННЯ ЗЛІВА, А ЗА ВІДСУТНОСТІ ФОТО — НАШЕ ЛОГО
          (CAMP-453, пункт 6; знімок 441/71).

          Фотографій кемпінгів у нас НЕМАЄ жодної — ні в цій відповіді
          API, ні в репозиторії (CAMP-469). Тож плейсхолдер тут не
          «поки що», а поточний стан справ, і він свідомо той самий
          файл для всіх карток: `public/logo.svg`. Підміна одного файлу
          міняє його скрізь — рівно те, чого просить картка.

          `alt` порожній: поруч стоїть назва кемпінгу, і диктор, який
          прочитав би «CampTribe logo Le Clarys Plage», сказав би зайве. */}
      <span className="size-12 shrink-0 overflow-hidden rounded-sm">
        {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
        <img
          src="/logo.svg"
          alt=""
          width={64}
          height={64}
          loading="lazy"
          className="size-full object-cover"
          data-testid="nearby-placeholder"
        />
      </span>
      <span className="min-w-0">
      <Link
        href={`/camping/${spot.country.toLowerCase()}/${region}/${spot.slug}`}
        className="font-semibold text-heading hover:underline"
      >
        {spot.name ?? SPOT_TYPE_LABEL[spot.type]}
      </Link>
      <p className="mt-1 text-sm text-ink-2">
        {SPOT_TYPE_LABEL[spot.type]} ·{' '}
        <span className="tabular-nums">
          {km
            ? `${(spot.metres / 1000).toFixed(1)} km`
            : `${spot.metres} m`}
        </span>{' '}
        away
      </p>
      </span>
    </li>
  );
}

/**
 * How fresh this particular page is.
 *
 * 🔴 The ODbL licence line lives in the site footer (CAMP-41), once, so
 * it cannot be forgotten on a template. What stays here is the part that
 * is true of this page and no other: the last time OpenStreetMap still
 * contained this campsite. A directory that does not say how fresh it is
 * invites the reader to assume the worst.
 */
function Section({
  title,
  children,
  personaFirst,
  card = false,
}: {
  title: string;
  children: React.ReactNode;
  /** CAMP-501: кому цей блок підіймається першим (див. globals.css). */
  personaFirst?: 'owner' | 'renter';
  /** CAMP-453: біла картка колонки PDP замість секції на тлі сторінки. */
  card?: boolean;
}) {
  return (
    <section
      className={card ? 'rounded-card bg-surface p-5 shadow-card' : 'mt-8'}
      data-persona-first={personaFirst}
    >
      <h2 className={card ? 'text-xl' : 'text-xl md:text-[25px]'}>{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
