import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import TripCostCalculator from '@/components/trip-cost-calculator';
import FuelPriceTable from '@/components/fuel-price-table';
import FeatureRow from '@/components/feature-row';
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
  unionComparison,
  VEHICLES,
} from '@/lib/fuel';
import { abs, breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import { getCountries } from '@/lib/api';
import { Block } from '@/components/layout';

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

/**
 * 🔴 ЗНАЧКИ ЛЕЖАТЬ ТУТ, А НЕ В СПІЛЬНОМУ НАБОРІ, бо спільного набору в
 * проєкті немає: кожен компонент малює свої вбудованим `<svg>`. Заводити
 * його заради двох значків означало б вирішити це питання мимохідь.
 */
function TentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M12 3.5 3 19.5h18L12 3.5Z" strokeLinejoin="round" />
      <path d="M12 9.5 7.5 19.5h9L12 9.5Z" strokeLinejoin="round" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H16" />
      <rect x="8" y="2.5" width="8" height="4" rx="1.2" />
      <path d="m8.5 11.5 1.6 1.6 3.2-3.2M8.5 16.5l1.6 1.6 3.2-3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  const union = borders.length === 0 ? unionComparison(code, 'diesel') : [];
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

      <h1 className="mt-2 text-3xl leading-tight md:text-[42px]">
        Camper trip costs in {c.name}
      </h1>

      {c.diesel === null ? (
        <Block as="p" measure="read" className="mt-4 text-ink-2">
          The European Commission&rsquo;s bulletin reports no diesel price for{' '}
          {c.name} in the week of {week}. Rather than estimate one, the
          calculator below is set to whatever you choose.
        </Block>
      ) : (
        <>
          <Block as="p" measure="read" className="mt-4 text-ink-2">
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
                {/* 🔴 Was `cheaper > 0`, which is false at position 1 —
                    so the single country where "below the EU average" is
                    most worth saying was the one page that omitted it.
                    The clause depends on having an average, not on rank. */}
                {FUEL.euAverage.diesel !== null && (
                  <>
                    , {c.diesel < FUEL.euAverage.diesel ? 'below' : 'above'} the
                    EU average of {euros(FUEL.euAverage.diesel, 3)}
                  </>
                )}
                .
              </>
            )}
          </Block>

          {worked && (
            <Block as="p" measure="read" className="mt-3 text-ink-2">
              In practice: a {EXAMPLE.label.toLowerCase()} doing{' '}
              {EXAMPLE.start} litres per 100 km over{' '}
              {EXAMPLE_KM.toLocaleString('en-GB')} km burns{' '}
              {worked.litres.toLocaleString('en-GB')} litres, which is{' '}
              <strong className="text-ink">{euros(worked.fuel)}</strong> of
              diesel. Change any of those below — especially the consumption,
              which is a starting point and not a measurement of your vehicle.
            </Block>
          )}
        </>
      )}

      {spread !== null && (
        <Block as="p" measure="read" className="mt-3 text-ink-2">
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
        </Block>
      )}

      <Block as="p" measure="read" className="mt-3 text-ink-2">
        Campsite prices are not on this page because{' '}
        <strong className="text-ink">we do not hold any</strong>. Enter what you
        expect a pitch to cost and the total will keep the two apart.
      </Block>

      {/* 🔴 The section that makes these 27 pages worth existing
          separately — and the only thing on them that none of
          park4night, Campercontact or Pitchup publishes. Every number is
          measured and the subtraction is arithmetic: what a litre costs
          on the other side of each land border, and what that is worth
          on a tank. It is also the most practical sentence we are in a
          position to write for somebody actually driving. */}
      {borders.length > 0 ? (
        <section className="mt-10" aria-labelledby="borders-heading">
          <h2 id="borders-heading" className="text-2xl text-heading">
            Across the border from {c.name}
          </h2>
          <Block as="p" measure="read" className="mt-2 text-ink-2">
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
          </Block>

          <Block as="ul" measure="narrow" className="mt-4 space-y-2">
            {borders.map((b) => (
              <li
                key={b.code}
                data-border={b.code}
                className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line py-2"
              >
                <span className="text-ink">{b.name}</span>
                <span className="text-ink-2 tabular-nums">
                  {euros(b.price, 3)}{' '}
                  {/* 🔴 An equal price is said in words, not as
                      "+ €0.000 a litre, + €0.00 a tank" — which is what
                      Croatia and Slovenia rendered, being identical this
                      week. A signed zero is not a comparison. */}
                  {b.difference === 0 ? (
                    <span className="text-ink-2">(the same)</span>
                  ) : (
                    <span className={b.difference < 0 ? 'text-ok' : 'text-ink-2'}>
                      ({b.difference < 0 ? '−' : '+'}
                      {euros(Math.abs(b.difference), 3)} a litre,{' '}
                      {b.difference < 0 ? '−' : '+'}
                      {euros(Math.abs(b.perTank))} a tank)
                    </span>
                  )}
                </span>
              </li>
            ))}
          </Block>
          <Block as="p" measure="read" className="mt-3 text-sm text-ink-2">
            A tank is taken as {TANK_LITRES} litres to keep the arithmetic
            plain — scale it to your own. Border prices move every week, and
            these are from {week}.
          </Block>
        </section>
      ) : (
        <section className="mt-10" aria-labelledby="borders-heading">
          <h2 id="borders-heading" className="text-2xl text-heading">
            {c.name} against the rest of the Union
          </h2>
          <Block as="p" measure="read" className="mt-2 text-ink-2">
            {c.name} has no land border with another EU country, so there is no
            cheaper tank to reach by driving — you fill up at the price here.
            What that price is worth is a comparison rather than a decision:
          </Block>
          <Block as="ul" measure="narrow" className="mt-4 space-y-2">
            {union.map((u) => (
              <li
                key={u.code}
                data-union={u.code}
                className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line py-2"
              >
                <span className="text-ink">{u.name}</span>
                <span className="text-ink-2 tabular-nums">
                  {euros(u.price, 3)}{' '}
                  {u.difference === 0 ? (
                    <span className="text-ink-2">(the same)</span>
                  ) : (
                    <span className={u.difference < 0 ? 'text-ok' : 'text-ink-2'}>
                      ({u.difference < 0 ? '−' : '+'}
                      {euros(Math.abs(u.difference), 3)} a litre,{' '}
                      {u.difference < 0 ? '−' : '+'}
                      {euros(Math.abs(u.perTank))} a tank)
                    </span>
                  )}
                </span>
              </li>
            ))}
          </Block>
          <Block as="p" measure="read" className="mt-3 text-sm text-ink-2">
            A tank is taken as {TANK_LITRES} litres to keep the arithmetic
            plain. Figures from {week}, and they move every week.
          </Block>
        </section>
      )}

      <TripCostCalculator country={code} />

      <FuelPriceTable highlight={code} />

      {/* 🔴 ДВА ПЕРЕХОДИ — КАРТКАМИ, А НЕ ПІДКРЕСЛЕНИМИ СЛОВАМИ (CAMP-458).
          Власник сказав прямо: «посилання майже не видно, а вони важливі».
          Ціль у 16 px тексту й ціль у картці — різні речі для пальця й
          для ока, а ширину сторінки тут і так не використано.

          🔴 Перехід на країну — лише там, де в нас є кемпінги. Ці 27
          сторінок ростуть із паливного бюлетеня, що покриває весь Союз;
          наше покриття — ні, а `dynamicParams = false` означає, що
          посилання на країну, по якій ми нічого не тримаємо, буде 404 у
          навігації сторінки, яку ми попросили Google індексувати. */}
      <nav className="mt-10" aria-label="Where to go next">
        <FeatureRow
          iconSide="left"
          testId="next-steps"
          items={[
            ...(hasCampsites
              ? [
                  {
                    key: 'campsites',
                    href: `/camping/${country.toLowerCase()}`,
                    icon: <TentIcon />,
                    title: `Campsites in ${c.name}`,
                    text: `What we hold for ${c.name}, region by region, with the distance to water and to the nearest town for each site.`,
                  },
                ]
              : []),
            {
              key: 'packing',
              href: '/tools/camper-packing-list',
              icon: <ListIcon />,
              title: 'What to pack',
              text: 'A list built from how you travel — the vehicle, the season, the nights and the people — with the ticks kept in the link you share.',
            },
          ]}
        />
      </nav>
    </main>
  );
}

