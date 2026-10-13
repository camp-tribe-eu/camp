import type { Metadata } from 'next';

import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { COMPANY, CONTACT_EMAIL } from '@/lib/legal';

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

        <p>
          {COMPANY.name}, {COMPANY.city}. Company details and the supervisory
          authority are on the{' '}
          <a className="underline" href="/legal/notice">
            legal notice
          </a>
          ; what we store and for how long is on the{' '}
          <a className="underline" href="/legal/privacy">
            privacy page
          </a>
          .
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a
          data-testid="contact-cta"
          href={`mailto:${CONTACT_EMAIL}`}
          className="inline-flex h-11 items-center rounded-sm border border-line-blue bg-surface px-4 text-sm font-semibold text-heading hover:border-line-2"
        >
          Email {CONTACT_EMAIL}
        </a>
      </div>
    </main>
  );
}
