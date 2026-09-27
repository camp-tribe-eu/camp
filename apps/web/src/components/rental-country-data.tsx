import Link from 'next/link';
import {
  count,
  inProse,
  MEASURED,
  measuredFor,
  measuredLead,
  METRIC_LABEL,
  percent,
  shareOf,
  isStale,
  type RentalCountry,
} from '@/lib/rental';
import { longDate } from '@/lib/fuel';
import { AMENITY_LABEL } from '@/lib/api';

// CAMP-4 — the part of a country page that is ours.
//
// 🔴 The claim in the first sentence is COMPUTED, not written. The data
// file says which metric this country leads with; the rank, the share and
// the superlative are worked out from the snapshot at render time, and
// tests/unit/rental.spec.ts recomputes the whole set on every CI run. A
// re-import that makes "the highest share in the Union" untrue therefore
// breaks the build instead of quietly turning a page into a lie.
//
// 🔴 And the wording is precise about what was counted. Our records say
// how many campsites ANSWER a question, never how many have the thing:
// "3 627 German records note a mains hook-up" is true; "3 627 German
// campsites have electricity" is not, because an unrecorded amenity is
// unknown and not absent. The distinction is the same one the tri-state
// in lib/api.ts exists for, and it is why these sentences read the way
// they do.

/** The rows every country page shows, in the order a renter cares. */
const ROWS = [
  'electricity',
  'shower',
  'toilets',
  'water',
  'greyWater',
] as const;

export default function RentalCountryData({
  country,
  now = new Date(),
}: {
  country: RentalCountry;
  now?: Date;
}) {
  const row = measuredFor(country.code);
  const lead = measuredLead(country);
  if (!row || !lead) return null;

  const when = longDate(MEASURED.measuredAt);

  return (
    <section
      data-testid="rental-country-data"
      aria-labelledby="our-data-heading"
      className="mt-10 rounded-card border border-line-2 bg-surface p-5"
    >
      <h2 id="our-data-heading" className="text-xl font-semibold text-heading">
        What our own records say about {inProse(country)}
      </h2>

      <p className="mt-3 max-w-prose text-ink-2">{country.dataIntro}</p>

      <p className="mt-3 max-w-prose text-ink-2">
        {lead.kind === 'per-region' ? (
          <>
            We hold{' '}
            <strong className="text-ink" data-testid="lead-value">
              {count(row.spots)}
            </strong>{' '}
            campsite records for {inProse(country)}, spread across{' '}
            {count(row.regions)} regions — an average of{' '}
            <strong className="text-ink">{lead.value.toFixed(1)}</strong> records
            per region, {lead.place} spread of any of the {lead.of} member
            states we hold data for.
          </>
        ) : lead.kind === 'share' ? (
          <>
            Of the {count(lead.total)} campsite records we hold for{' '}
            {inProse(country)},{' '}
            <strong className="text-ink" data-testid="lead-value">
              {count(lead.value)}
            </strong>{' '}
            {METRIC_LABEL[lead.metric]} — {percent(lead.share)}, {lead.place}{' '}
            share among the {lead.of} member states in our data.
          </>
        ) : (
          // 🔴 A count and a share are different claims and the sentence
          // keeps them apart. Germany leads on the absolute number of RV
          // parks, not on the proportion — Ireland wins the proportion —
          // and "31.1%, the highest number" was a sentence that read as
          // though it claimed both.
          <>
            <strong className="text-ink" data-testid="lead-value">
              {count(lead.value)}
            </strong>{' '}
            of our {inProse(country)} records {METRIC_LABEL[lead.metric]}:{' '}
            {lead.place} number among the {lead.of} member states in our
            data, and {percent(lead.share)} of everything we hold there.
          </>
        )}
      </p>

      <table className="mt-5 w-full border-collapse text-sm">
        <caption className="sr-only">
          Campsite records for {inProse(country)}, by what each record answers
        </caption>
        <thead>
          <tr className="border-b border-line-2 text-left text-ink-2">
            <th scope="col" className="py-2 font-semibold">
              Records that answer
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              Count
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((key) => (
            <tr key={key} className="border-b border-line-2 last:border-0">
              {/* 🔴 `text-left` is not decoration: a `th` defaults to
                  centred, so the row labels sat in the middle of their
                  column while the header above them was left-aligned.
                  Caught by looking at the page, not by a test. */}
              <th scope="row" className="py-2 text-left font-normal text-ink-2">
                {/* 🔴 The same words the campsite pages and the map filters
                    use for these fields, from lib/api.ts. Two vocabularies
                    for one amenity is how a reader ends up believing they
                    are two different amenities. */}
                {AMENITY_LABEL[key]}
              </th>
              <td className="py-2 text-right tabular-nums text-ink">
                {count(row[key])}
              </td>
              <td className="py-2 text-right tabular-nums text-ink-2">
                {percent(shareOf(row, key))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-4 max-w-prose text-sm leading-6 text-ink-2">
        Counted in our own database on{' '}
        <time dateTime={MEASURED.measuredAt}>{when}</time>.{' '}
        {/* 🔴 The sentence that keeps the table honest. Everything above
            is "how many records answer the question", and the difference
            between that and "how many campsites have it" is the whole
            reason the amenity fields are tri-state. */}
        Each figure is how many of our records <em>answer</em> that question —
        an unrecorded shower means nobody has told us, not that there is no
        shower.
        {isStale(now) && (
          <strong className="text-heading">
            {' '}
            This count is more than three months old and nobody has refreshed
            it.
          </strong>
        )}{' '}
        <Link className="underline" href={`/camping/${country.code}`}>
          Browse them
        </Link>
        , or open{' '}
        <Link className="underline" href="/map">
          the map
        </Link>
        .
      </p>
    </section>
  );
}
