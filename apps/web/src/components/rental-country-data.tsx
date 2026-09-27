import Link from 'next/link';
import {
  count,
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
        What our own records say about {country.name}
      </h2>

      <p className="mt-3 max-w-prose text-ink-2">{country.dataIntro}</p>

      <p className="mt-3 max-w-prose text-ink-2">
        {lead.kind === 'per-region' ? (
          <>
            We hold{' '}
            <strong className="text-ink" data-testid="lead-value">
              {count(row.spots)}
            </strong>{' '}
            campsite records for {country.name}, spread across{' '}
            {count(row.regions)} regions — an average of{' '}
            <strong className="text-ink">{lead.value.toFixed(1)}</strong> records
            per region, {lead.place} spread of any of the {lead.of} member
            states we hold data for.
          </>
        ) : (
          <>
            <strong className="text-ink" data-testid="lead-value">
              {count(lead.value)}
            </strong>{' '}
            of our {count(lead.total)} {country.name} records{' '}
            {METRIC_LABEL[lead.metric]} — {percent(lead.share)}, {lead.place}{' '}
            {lead.kind === 'share' ? 'share' : 'number'} of the {lead.of} member
            states in our data.
          </>
        )}
      </p>

      <table className="mt-5 w-full border-collapse text-sm">
        <caption className="sr-only">
          Campsite records for {country.name}, by what each record answers
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
              <th scope="row" className="py-2 font-normal text-ink-2">
                {/* Sentence case, because the label completes a sentence
                    the column header started. */}
                {METRIC_LABEL[key].replace(/^record /, '')}
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
