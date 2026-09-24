import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import TripCostCalculator from '@/components/trip-cost-calculator';
import FuelPriceTable from '@/components/fuel-price-table';
import {
  borderPrices,
  budget,
  countryFuel,
  euros,
  FUEL,
  FUEL_COUNTRIES,
  longDate,
  placeText,
  rankOf,
  TANK_LITRES,
  VEHICLES,
} from '@/lib/fuel';
import { abs, breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import { getCountries } from '@/lib/api';

// CAMP-55 — one page per member state.
//
// 🔴 Why 27 pages and not one calculator with a dropdown.
//
// "Camper trip cost in Germany" and "…in Croatia" are different searches
// with different answers, and the answers here are genuinely different:
// diesel spans roughly a factor of two across the Union, which on a
// 1,500 km trip is a couple of hundred euro. A single page with a
// dropdown would rank for none of them and would be right about all of
// them, which is the worst of both.
//
// 🔴 And these are NOT the thin, parameterised pages CAMP-71 warns
// about. Each carries a figure nobody else publishes for that country
// this week, a worked total, and its rank among the 27. The test of a
// generated page is whether it says something a reader could not get
// from the page above it, and a country's own price does.
//
// The shareable calculator results, by contrast, stay on query strings
// with no separate URL, because an unbounded set of ?km=… pages is a
// crawl trap and exactly the duplicate-page problem CAMP-37 measures.

interface Params {
  country: string;
}

export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  return FUEL_COUNTRIES.map((code) => ({ country: code.toLowerCase() }));
}

/** The worked example every one of these pages leads with. */
const EXAMPLE_KM = 1500;
const EXAMPLE = VEHICLES[1]; // motorhome, the shape most readers mean

function model(code: string) {
  const c = countryFuel(code);
  if (!c) return null;
  const rank = rankOf(code, 'diesel');
  const worked =
    c.diesel === null
      ? null
      : budget({
          km: EXAMPLE_KM,
          litresPer100: EXAMPLE.start,
          pricePerLitre: c.diesel,
          nights: 0,
          campsitePerNight: 0,
          people: 2,
        });
  return { c, rank, worked };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { country } = await params;
  const m = model(country);
  if (!m) return {};
  const path = `/tools/camper-trip-cost/${country.toLowerCase()}`;
  return {
    title: `Camper trip costs in ${m.c.name}`,
    description:
      m.c.diesel === null
        ? `Fuel prices and a trip cost calculator for ${m.c.name}.`
        : `Diesel in ${m.c.name} is €${m.c.diesel.toFixed(3)} a litre this week. Work out what a camper trip there costs, with prices published by the European Commission.`,
    alternates: alternatesFor(path),
  };
}

export default async function CountryTripCostPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { country } = await params;
  const m = model(country);
  if (!m) notFound();

  const code = country.toUpperCase();
  const { c, rank, worked } = m;
  const hasCampsites = (await getCountries()).some(
    (x) => x.country === country.toLowerCase(),
  );
  const borders = borderPrices(code, 'diesel');
  const cheaperAcross = borders.filter((b) => b.difference < 0);

  // 🔴 Which of the two fuels is cheaper HERE, and by how much. Tax
  // policy differs enough across the Union that the answer flips: diesel
  // is 51 cents a litre dearer than petrol in Sweden and 13 cents
  // cheaper in Malta, on the same week. It is the question a reader
  // faces when choosing between two rental vehicles, and it is another
  // fact about this country that is true of no other page.
  const spread =
    c.petrol !== null && c.diesel !== null
      ? Math.round((c.diesel - c.petrol) * 1000) / 1000
      : null;
  const path = `/tools/camper-trip-cost/${country.toLowerCase()}`;
  const week = longDate(FUEL.bulletinDate);
  const cheaper = rank ? rank.position - 1 : 0;

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'Tools', path: '/tools' },
            { name: 'Camper trip cost', path: '/tools/camper-trip-cost' },
            { name: c.name, path },
          ]),
        )}
      />
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          '@id': `${abs(path)}#app`,
          name: `Camper trip cost calculator — ${c.name}`,
          url: abs(path),
          applicationCategory: 'TravelApplication',
          operatingSystem: 'Any',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
          isAccessibleForFree: true,
        })}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link className="underline" href="/tools/camper-trip-cost">
          Camper trip cost
        </Link>{' '}
        / {c.name}
      </nav>

      <h1 className="mt-2 text-3xl font-bold leading-tight md:text-[42px]">
        Camper trip costs in {c.name}
      </h1>

      {c.diesel === null ? (
        <p className="mt-4 max-w-prose text-ink-2">
          The European Commission&rsquo;s bulletin reports no diesel price for{' '}
          {c.name} in the week of {week}. Rather than estimate one, the
          calculator below is set to whatever you choose.
        </p>
      ) : (
        <>
          <p className="mt-4 max-w-prose text-ink-2">
            Diesel in {c.name} costs{' '}
            <strong className="text-ink">{euros(c.diesel, 3)}</strong> a litre
            this week, including taxes
            {c.petrol !== null && (
              <> — petrol {euros(c.petrol, 3)}</>
            )}
            .{' '}
            {rank && (
              <>
                That makes it the{' '}
                <strong className="text-ink">
                  {placeText(rank.position, rank.of)}
                </strong>{' '}
                of the {rank.of} EU countries the Commission reports on
                {cheaper > 0 && FUEL.euAverage.diesel !== null && (
                  <>
                    , {c.diesel < FUEL.euAverage.diesel ? 'below' : 'above'} the
                    EU average of {euros(FUEL.euAverage.diesel, 3)}
                  </>
                )}
                .
              </>
            )}
          </p>

          {worked && (
            <p className="mt-3 max-w-prose text-ink-2">
              In practice: a {EXAMPLE.label.toLowerCase()} doing{' '}
              {EXAMPLE.start} litres per 100 km over{' '}
              {EXAMPLE_KM.toLocaleString('en-GB')} km burns{' '}
              {worked.litres.toLocaleString('en-GB')} litres, which is{' '}
              <strong className="text-ink">{euros(worked.fuel)}</strong> of
              diesel. Change any of those below — especially the consumption,
              which is a starting point and not a measurement of your vehicle.
            </p>
          )}
        </>
      )}

      {spread !== null && (
        <p className="mt-3 max-w-prose text-ink-2">
          {Math.abs(spread) < 0.02 ? (
            <>
              Petrol and diesel cost almost the same in {c.name} this week —{' '}
              {euros(c.petrol!, 3)} against {euros(c.diesel!, 3)} — so the
              engine in the vehicle you hire makes little difference to the
              fuel bill here.
            </>
          ) : spread > 0 ? (
            <>
              Diesel is <strong className="text-ink">{euros(spread, 3)}</strong>{' '}
              a litre <strong className="text-ink">dearer</strong> than petrol
              in {c.name}, which is {euros(Math.abs(spread) * TANK_LITRES)} on a{' '}
              {TANK_LITRES}-litre tank. Worth knowing before choosing between
              two hire vehicles.
            </>
          ) : (
            <>
              Diesel is{' '}
              <strong className="text-ink">{euros(Math.abs(spread), 3)}</strong>{' '}
              a litre <strong className="text-ink">cheaper</strong> than petrol
              in {c.name} — {euros(Math.abs(spread) * TANK_LITRES)} on a{' '}
              {TANK_LITRES}-litre tank.
            </>
          )}
        </p>
      )}

      <p className="mt-3 max-w-prose text-ink-2">
        Campsite prices are not on this page because{' '}
        <strong className="text-ink">we do not hold any</strong>. Enter what you
        expect a pitch to cost and the total will keep the two apart.
      </p>

      {/* 🔴 The section that makes these 27 pages worth existing
          separately — and the only thing on them that none of
          park4night, Campercontact or Pitchup publishes. Every number is
          measured and the subtraction is arithmetic: what a litre costs
          on the other side of each land border, and what that is worth
          on a tank. It is also the most practical sentence we are in a
          position to write for somebody actually driving. */}
      {borders.length > 0 ? (
        <section className="mt-10" aria-labelledby="borders-heading">
          <h2 id="borders-heading" className="text-2xl font-bold text-heading">
            Across the border from {c.name}
          </h2>
          <p className="mt-2 max-w-prose text-ink-2">
            {cheaperAcross.length === 0 ? (
              <>
                Diesel is dearer in every country {c.name} has a land border
                with, so there is nothing to gain by waiting to fill up.
              </>
            ) : (
              <>
                Diesel is cheaper in{' '}
                {cheaperAcross.length === 1
                  ? cheaperAcross[0].name
                  : `${cheaperAcross.length} of the neighbouring countries`}
                . On a {TANK_LITRES}-litre tank, crossing into{' '}
                {cheaperAcross[0].name} saves{' '}
                <strong className="text-ink">
                  {euros(Math.abs(cheaperAcross[0].perTank))}
                </strong>
                .
              </>
            )}
          </p>

          <ul className="mt-4 max-w-prose space-y-2">
            {borders.map((b) => (
              <li
                key={b.code}
                data-border={b.code}
                className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line py-2"
              >
                <span className="text-ink">{b.name}</span>
                <span className="text-ink-2 tabular-nums">
                  {euros(b.price, 3)}{' '}
                  <span
                    className={b.difference < 0 ? 'text-ok' : 'text-ink-3'}
                  >
                    ({b.difference < 0 ? '−' : '+'}
                    {euros(Math.abs(b.difference), 3)} a litre,{' '}
                    {b.difference < 0 ? '−' : '+'}
                    {euros(Math.abs(b.perTank))} a tank)
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-prose text-sm text-ink-3">
            A tank is taken as {TANK_LITRES} litres to keep the arithmetic
            plain — scale it to your own. Border prices move every week, and
            these are from {week}.
          </p>
        </section>
      ) : (
        <p className="mt-10 max-w-prose text-ink-2">
          {c.name} has no land border with another EU country, so there is no
          cheaper tank to reach by driving — the ferry decides.
        </p>
      )}

      <TripCostCalculator country={code} />

      <FuelPriceTable highlight={code} />

      <p className="mt-10 text-ink-2">
        {/* 🔴 Linked only where campsites exist. These 27 pages come from
            the fuel bulletin, which covers the whole Union; our own
            coverage does not, and `dynamicParams = false` means a link to
            a country we hold nothing for is a 404 in the navigation of a
            page we asked Google to index. */}
        {hasCampsites && (
          <>
            <Link className="underline" href={`/camping/${country.toLowerCase()}`}>
              Campsites in {c.name}
            </Link>{' '}
            ·{' '}
          </>
        )}
        <Link className="underline" href="/tools/camper-packing-list">
          What to pack
        </Link>
      </p>
    </main>
  );
}

