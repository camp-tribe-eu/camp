import type { Metadata } from 'next';
import Link from 'next/link';
import PlanForm from '@/components/plan-form';
import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { Block } from '@/components/layout';

// CAMP-205 — /plan: форма планувальника маршруту.
// CAMP-391 — і планувальник за нею: `POST /plan` (apps/api/src/plan/).
//
// 🔴 ЦЯ СТОРІНКА КАЖЕ ПРЯМО, ЩО ВОНА РОБИТЬ І ЧОГО НІ. Вона ріже пряму лінію
// між двома точками на дні й обирає кемпінг на кожну ніч; вона не знає
// доріг (маршрутизатора немає — `corridor-source.ts` віддає пряму), тож
// усі відстані тут по прямій і годин за кермом немає; вона не знає
// розміру вашого транспорту (даних про розміри майданчиків немає,
// CAMP-247) і не знає, чи кемпінг відкритий у ваші дати (колонки сезону
// немає). Назв місць вона теж не шукає: газетира немає, тож приймає
// координати. Одне пряме речення про кожне, а не слово «скоро» й не
// мовчання.
//
// Тон — як у решти сайту: «Nothing is drawn here, and that is a gap in
// what we hold» на мапі, «we do not know, and we do not publish a number
// we have not got» у калькуляторі.
//
// 🔴 `noindex`, і це рішення, а не недогляд: доки планувальник не дає
// доріг, він не для пошуку. Перше, що побачила б людина з видачі, — план
// без дороги, і вона вирішила б, що це маршрут. Так само поводиться /search
// (CAMP-67), і так само сторінка лишається повністю доступною для обходу.
// Тому ж її немає в карті сайту й у llms.txt: «карта сайту не містить
// noindex» — правило check-sitemap.mjs.
//
// ⚠️ Коли з'явиться маршрутизатор (CAMP-42), ТРИ речі міняються разом, і
// всі три на цій сторінці чи поруч: прибрати `robots` нижче, додати
// /plan до STATIC_HUBS у lib/sitemap.ts і до llms.txt, і переписати блок
// `planner-status`, який тоді стане неправдою.

export const metadata: Metadata = {
  title: 'Trip planner',
  description:
    'Plan a trip between places in the EU, day by day: a campsite for each night and the reason it was chosen. Search by name, add stops, come back to the start. Distances are straight lines, not roads.',
  alternates: alternatesFor('/plan'),
  robots: { index: false, follow: true },
};

export default function PlanPage() {
  const crumbs = [
    { name: 'CampTribe', path: '/' },
    { name: 'Trip planner', path: '/plan' },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <h1 className="text-3xl leading-tight md:text-[42px]">
        Trip planner
      </h1>

      {/* 🔴 Перед формою, а не під нею, і в виданому HTML, а не після
          гідратації: це перше, що має дізнатись і читач, і краулер, і
          асистент, який перечитує сторінку. Жовта рамка — з повідомлення
          про застарілі ціни пального (CAMP-55): та сама мова для «це
          працює не так, як можна подумати». */}
      <Block
        measure="read"
        data-testid="planner-status"
        className="mt-6 rounded-card border border-amber bg-surface-2 p-4 text-ink"
      >
        <p>
          <strong>This planner cuts a straight line into days.</strong> Give it
          a start, a destination, any stops on the way and a number of days,
          and it picks a campsite from our database for each night, near where
          that day should end, and says why.
        </p>
        <p className="mt-3">
          <strong>What it does not know:</strong> the roads, so every distance
          is a straight line and there are no driving times; the size of your
          vehicle, so the height, length and weight you enter are saved with
          the trip and change nothing in the plan; and whether a campsite is open on your dates.
          Place names are looked up in our own data only, as they are written
          locally.
        </p>
        {/* 🔴 Застереження — у виданому HTML, а не після гідратації, і воно
            стоїть тут, перед формою, а не в підвалі: юридично воно потрібне,
            а не бажане (CAMP-456, п. 8; слова власника — «дані наведені для
            вашої інформації й можуть відрізнятись від реальних умов»). Тест
            читає саме цей вузол у виданому документі. */}
        <p data-testid="plan-disclaimer" className="mt-3">
          <strong>For your information only.</strong> Everything here may
          differ from real conditions. CampTribe is not a navigation app. The
          data can be wrong or out of date, so you use this at your own
          discretion and risk. More in{' '}
          <Link className="underline" href="/legal/disclaimer">
            What we do and do not know
          </Link>
          .
        </p>
      </Block>

      <PlanForm />

      <section className="mt-12" aria-labelledby="plan-today-heading">
        <h2 id="plan-today-heading" className="text-2xl text-heading">
          Also on the site
        </h2>
        <Block as="ul" measure="read" className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
          <li>
            <Link className="underline" href="/routes">
              The route library
            </Link>
            : routes written by hand, each with its stages and the campsites
            our database holds near them.
          </li>
          <li>
            <Link className="underline" href="/map">
              The map
            </Link>
            : every campsite we hold, to look over and plan around yourself.
          </li>
          <li>
            <Link className="underline" href="/tools/camper-trip-cost">
              The trip cost calculator
            </Link>
            : fuel for a drive, from the European Commission&rsquo;s published
            prices.
          </li>
        </Block>
      </section>
    </main>
  );
}
