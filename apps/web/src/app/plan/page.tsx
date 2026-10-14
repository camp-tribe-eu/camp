import type { Metadata } from 'next';
import Link from 'next/link';
import PlanForm from '@/components/plan-form';
import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, jsonLdProps } from '@/lib/jsonld';

// CAMP-205 — /plan: каркас планувальника маршруту, без алгоритму.
//
// 🔴 ЦЯ СТОРІНКА СКАЗАНА ПРЯМО: планувальник ще не рахує маршрути. Картка
// (CAMP-205) прямо дозволяє зробити каркас, стани порожнечі, помилки й
// форму до алгоритму (CAMP-46) і роутингу (CAMP-42). Те, що не можна:
// малювати результат, якого ніхто не рахує, або словом «скоро» замінити
// речення про те, чого немає.
//
// Тон — як у решти сайту: «Nothing is drawn here, and that is a gap in
// what we hold» на мапі, «we do not know, and we do not publish a number
// we have not got» у калькуляторі. Одне пряме речення, без вибачень.
//
// 🔴 `noindex`, і це рішення, а не недогляд. Сторінка, яка нічого не
// рахує, не має ранжуватись: вона була б тонкою за означенням, а перше,
// що побачить людина з пошуку, — «не працює». Так само поводиться
// /search (CAMP-67), і так само сторінка лишається повністю доступною
// для обходу. Тому ж її немає в карті сайту й у llms.txt: «карта сайту
// не містить noindex» — правило check-sitemap.mjs.
//
// ⚠️ Коли планувальник справді рахуватиме, ТРИ речі міняються разом, і
// всі три на цій сторінці чи поруч: прибрати `robots` нижче, додати
// /plan до STATIC_HUBS у lib/sitemap.ts і до llms.txt, і переписати
// блок `planner-status`, який тоді стане неправдою.

export const metadata: Metadata = {
  title: 'Trip planner',
  description:
    'The CampTribe trip planner does not calculate routes yet. This page says what it will show and points to what works today.',
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

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
        Trip planner
      </h1>

      {/* 🔴 Перед формою, а не під нею, і в виданому HTML, а не після
          гідратації: це перше, що має дізнатись і читач, і краулер, і
          асистент, який перечитує сторінку. Жовта рамка — з повідомлення
          про застарілі ціни пального (CAMP-55): та сама мова для «це
          працює не так, як можна подумати». */}
      <div
        data-testid="planner-status"
        className="mt-6 max-w-prose rounded-card border border-amber bg-surface-2 p-4 text-ink"
      >
        <p>
          <strong>This planner does not calculate routes yet.</strong> The
          form below takes a start, a destination, a number of days and a
          vehicle, and checks that they make sense. It does nothing more:
          there is no route, no distance and no list of stops behind it.
        </p>
        <p className="mt-3">
          When it works, this page will show your route drawn on a map, and
          the stops along it. Until then we would rather say so than draw
          something that looks like one.
        </p>
      </div>

      <PlanForm />

      <section className="mt-12" aria-labelledby="plan-today-heading">
        <h2 id="plan-today-heading" className="text-2xl font-bold text-heading">
          What works today
        </h2>
        <ul className="mt-4 max-w-prose list-disc space-y-2 pl-5 text-ink-2">
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
        </ul>
      </section>
    </main>
  );
}
