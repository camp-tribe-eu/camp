import type { Metadata } from 'next';
import Link from 'next/link';

import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { COMPANY, CONTACT_EMAIL } from '@/lib/legal';
import { buttonClasses } from '@/components/button';

// CAMP-209. Для бельгійської юрособи контакт — не ввічливість, а
// вимога (CAMP-188 про адресу в підвалі). І афіліат-мережа, яка
// розглядає заявку (CAMP-98), перевіряє саме цю сторінку.

export const metadata: Metadata = {
  title: 'Contact CampTribe',
  description: `How to reach ${COMPANY.name}: one address for corrections, licence questions and partnerships.`,
  alternates: alternatesFor('/contact'),
};

export default function Contact() {
  const crumbs = [
    { name: 'CampTribe', path: '/' },
    { name: 'Contact', path: '/contact' },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
        Contact
      </h1>

      <div className="mt-6 max-w-prose space-y-4 text-ink-2">
        <p>
          One address, read by a person:{' '}
          <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          . Write to us about a campsite we have wrong, a licence or attribution
          question, or working together.
        </p>

        {/* 🔴 Сказати, чого ми НЕ можемо, одразу — інакше людина
            напише й чекатиме на те, чого не буде. */}
        <p>
          <strong className="text-heading">Two things we cannot do.</strong> We
          do not take bookings and have no part in them: a campsite&rsquo;s own
          site or phone is the only place to reserve. And we cannot change what
          OpenStreetMap says about a place — that map is edited by its own
          community, and a correction made there reaches us with the next
          import. Tell us anyway, and we will say which of the two it is.
        </p>

        {/* 🔴 CAMP-318. Кнопка «You own this site? Add your photos» на
            сторінці кемпінга веде сюди, тож відповідь на неї мусить бути
            тут. Запросити фото й змовчати про умови означало б обіцянку,
            якої ми не стримаємо: без дозволу на публікацію знімок
            залишиться лежати в пошті. */}
        <p>
          <strong className="text-heading">
            If you run a campsite and want your photographs on its page
          </strong>
          , send them to the same address. Three things have to come with
          them: that the picture is yours to give, your permission for us to
          publish it here, and the month it was taken — we print that date
          beside every photograph. Uploads through the site do not exist yet,
          so email is the whole of it.
        </p>

        <p>
          {COMPANY.name}, {COMPANY.city}. Company details and the supervisory
          authority are on the{' '}
          <Link className="underline" href="/legal/notice">
            legal notice
          </Link>
          ; what we store and for how long is on the{' '}
          <Link className="underline" href="/legal/privacy">
            privacy page
          </Link>
          .
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a
          data-testid="contact-cta"
          href={`mailto:${CONTACT_EMAIL}`}
          className={buttonClasses('primary')}
        >
          Email {CONTACT_EMAIL}
        </a>
      </div>
    </main>
  );
}
