import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import RentalCountryData from '@/components/rental-country-data';
import RentalDisclosure from '@/components/rental-disclosure';
import RentalOfferSlot from '@/components/rental-offer-slot';
import { abs, breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import { countryFuel, euros, longDate, FUEL } from '@/lib/fuel';
import {
  count,
  measuredFor,
  publishableCountries,
  rentalCountry,
  rentalOffers,
} from '@/lib/rental';

// CAMP-4 / CAMP-54 — one page per member state, and only where it earns
// one.
//
// 🔴 TWELVE PAGES, NOT TWO HUNDRED AND FIFTY.
//
// The card asked for 200–300 city pages. That is scaled content abuse by
// Google's own March 2024 definition the moment the pages differ only by
// a place name, and the penalty is applied to the domain rather than to
// the section — on a domain with no age and no trust, and a plan that is
// entirely organic. CAMP-130 refused 951 templated guides for the same
// reason and this follows it.
//
// The list lives in src/data/rental/countries.ts and every entry passes a
// gate enforced by tests/unit/rental.spec.ts: three facts about this
// country that are not true of its neighbour, each with a named authority
// behind it, and one measured statement from our own database that is
// true of no other page. A country that could not meet both does not have
// a page. Twelve could.
//
// 🔴 Nothing here is a price, a vehicle, a company or an availability.
// See lib/affiliate.ts — the commercial slot renders an explained empty
// state until CAMP-98 produces an account.

interface Params {
  country: string;
}

export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  return publishableCountries().map((c) => ({ country: c.code }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { country } = await params;
  const c = rentalCountry(country);
  if (!c) return {};
  return {
    title: `Renting a camper in ${c.name}`,
    description: c.angle,
    alternates: alternatesFor(`/camper-rental/${c.code}`),
  };
}

export default async function RentalCountryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { country } = await params;
  const c = rentalCountry(country);
  // 🔴 `publishableCountries()` rather than a bare lookup: a country whose
  // content stopped passing the gate must 404 rather than render a page
  // that no longer meets the standard the section is built on.
  if (!c || !publishableCountries().some((x) => x.code === c.code)) notFound();

  const path = `/camper-rental/${c.code}`;
  const offers = rentalOffers(c.code);
  const row = measuredFor(c.code);
  const fuel = countryFuel(c.code);

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'Camper rental', path: '/camper-rental' },
            { name: c.name, path },
          ]),
        )}
      />
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          '@id': `${abs(path)}#page`,
          name: `Renting a camper in ${c.name}`,
          description: c.angle,
          url: abs(path),
          inLanguage: 'en',
          about: { '@type': 'Place', name: c.name },
        })}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link className="underline" href="/camper-rental">
          Camper rental
        </Link>{' '}
        / {c.name}
      </nav>

      <h1 className="mt-2 text-3xl font-bold leading-tight md:text-[42px]">
        Renting a camper in {c.name}
      </h1>

      <p className="mt-4 max-w-prose text-ink-2">{c.intro}</p>

      <RentalDisclosure offers={offers.length} />

      <section aria-labelledby="rules-heading" className="mt-12">
        <h2 id="rules-heading" className="text-2xl font-bold text-heading">
          Three things that are true here and not next door
        </h2>
        <ul className="mt-6 space-y-6">
          {c.facts.map((fact) => (
            <li
              key={fact.title}
              className="rounded-card border border-line-2 bg-surface p-5"
            >
              <h3 className="text-lg font-semibold text-heading">
                {fact.title}
              </h3>
              <p className="mt-2 max-w-prose text-ink-2">{fact.body}</p>
              <p className="mt-3 text-sm text-ink-2">
                Source:{' '}
                {fact.source.url.startsWith('/') ? (
                  <Link className="underline" href={fact.source.url}>
                    {fact.source.name}
                  </Link>
                ) : (
                  <a
                    className="underline"
                    href={fact.source.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {fact.source.name}
                  </a>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <RentalCountryData country={c} />

      {/* 🔴 The one cost on this page we can actually price, and it is not
          ours: the European Commission publishes it weekly for all 27
          member states. Fuel is the largest volatile line in a camper
          budget and the campsite fee is the reader's own number — the
          same split lib/fuel.ts is built around. */}
      {fuel?.diesel !== null && fuel !== null && (
        <section
          aria-labelledby="fuel-heading"
          className="mt-10 rounded-card border border-line-2 bg-surface-2 p-5"
        >
          <h2 id="fuel-heading" className="text-xl font-semibold text-heading">
            What the driving costs
          </h2>
          <p className="mt-3 max-w-prose text-ink-2">
            Diesel in {c.name} costs{' '}
            <strong className="text-ink">{euros(fuel.diesel, 3)}</strong> a
            litre in the week of {longDate(FUEL.bulletinDate)}, including
            taxes, as published by the European Commission
            {fuel.petrol !== null && <> — petrol {euros(fuel.petrol, 3)}</>}.
            A rental camper is heavier and thirstier than the car you are
            used to, and fuel will be the largest variable line in the
            budget.{' '}
            <Link
              className="underline"
              href={`/tools/camper-trip-cost/${c.code}`}
            >
              Price a trip in {c.name}
            </Link>
            .
          </p>
        </section>
      )}

      <RentalOfferSlot offers={offers} where={c.name} />

      <section
        aria-labelledby="next-heading"
        className="mt-12 border-t border-line-2 pt-8"
      >
        <h2 id="next-heading" className="text-xl font-semibold text-heading">
          Before you book
        </h2>
        <p className="mt-3 max-w-prose text-ink-2">
          The questions that decide what a hire actually costs are the same
          in every member state, and none of them is on the price page:{' '}
          <Link className="underline" href="/camper-rental">
            the excess, the mileage cap, the one-way fee and the plated mass
          </Link>
          . For {c.name} specifically, our{' '}
          <Link className="underline" href={`/camping/${c.code}`}>
            {count(row?.spots ?? 0)} campsite records
          </Link>{' '}
          are the other half of the plan.
        </p>
      </section>
    </main>
  );
}
