import type { Metadata } from 'next';
import Link from 'next/link';

import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { COMPANY, CONTACT_EMAIL } from '@/lib/legal';

// CAMP-209. Сторінка була в карті сайту й не була замовлена жодною
// карткою — тобто існувала як намір і не існувала як адреса.
//
// 🔴 ТУТ НЕМАЄ ЖОДНОГО ЧИСЛА, і це рішення, а не недогляд. По сайту
// розсипане `61 422`, заміряне 27.09.2026 і зашите в текст, який читає
// людина, та в метадані, які читає пошуковик. Ставити сюди ще одну
// копію означало б завести четверту, яка застаріє своїм темпом. Числа
// належать сторінкам, які їх рахують.

export const metadata: Metadata = {
  title: 'About CampTribe',
  description:
    'What CampTribe is, where its campsite data comes from, and — just as plainly — what it does not know.',
  alternates: alternatesFor('/about'),
};

export default function About() {
  const crumbs = [
    { name: 'CampTribe', path: '/' },
    { name: 'About', path: '/about' },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
        About CampTribe
      </h1>

      <div className="mt-6 max-w-prose space-y-4 text-ink-2">
        <p>
          CampTribe is a directory of campsites, motorhome parks and camper
          stops across the twenty-seven member states of the European Union. It
          is built from OpenStreetMap and from official open data published by
          national and European bodies, and every page says which source a fact
          came from.
        </p>

        {/* 🔴 Найважливіший абзац сторінки. Конкурент на цьому місці
            обіцяє «перевірені місця»; ми кажемо, чого не знаємо, бо
            зелена іконка без джерела — це штраф, виписаний читачеві від
            нашого імені. */}
        <p>
          <strong className="text-heading">What we do not know, we say.</strong>{' '}
          Open data is uneven: a campsite may have no recorded opening hours, no
          price and no answer to whether you may legally spend the night there.
          Where that is the case the page says so instead of guessing. An empty
          field is a fact about our data, not a fact about the place.
        </p>

        <p>
          Alongside the directory we show conditions that change by the hour —
          official weather warnings, wildfire reports, bathing-water quality and
          fuel prices — each from the body that issues it, with the time it was
          issued. Where a reading is older than its source allows, the page says
          that too rather than showing a stale number as current.
        </p>

        <p>
          CampTribe is operated by {COMPANY.name}, {COMPANY.city}. The legal
          notice, the licences of every data source and what we do and do not
          store are set out in full under{' '}
          <Link className="underline" href="/legal/notice">
            Legal notice
          </Link>
          .
        </p>
      </div>

      {/* Своя CTA: кожна глибока сторінка це окремий лендинг. */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          data-testid="about-cta"
          href="/map"
          className="inline-flex h-11 items-center rounded-sm border border-line-blue bg-surface px-4 text-sm font-semibold text-heading hover:border-line-2"
        >
          Open the campsite map
        </Link>
        <a className="text-sm underline text-ink-2" href={`mailto:${CONTACT_EMAIL}`}>
          Or write to us
        </a>
      </div>
    </main>
  );
}
