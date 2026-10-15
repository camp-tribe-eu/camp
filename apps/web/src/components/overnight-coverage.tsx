import {
  formatOvernightDay,
  overnightCoverage,
  type RegionOvernightCounts,
} from '@/lib/overnight';

// CAMP-255 — what a country page says about overnight stays.
//
// 🔴 A COUNTRY WITH NO ANSWERS IS NOT AN EMPTY BLOCK. Malta and Cyprus are
// where this matters most: nothing in the open data answers the question
// for any campsite there, and a page that said nothing — or showed a count
// of zero with no sentence — would be read as "no overnight places" or
// "nobody thought of it". The page says what is true: we do not know, for
// any of them, and we show none rather than guess.
//
// 🔴 THE NUMBERS ARE COUNTED FROM OUR OWN CAMPSITES, with the day they are
// a reading of. No percentage: "2%" of a denominator that moves every
// Monday is a figure that is wrong by next week, and "12 of 612" is
// checkable by anybody who counts. And no number from anywhere else —
// an earlier version of this card quoted a share whose numerator was
// counted over a different kind of place than its denominator.
//
// 🔴 `unknown` is spots - allowed - forbidden and is never added to either
// answer (`overnightCoverage`).

export default function OvernightCoverage({
  countryName,
  regions,
}: {
  countryName: string;
  regions: readonly RegionOvernightCounts[];
}) {
  const c = overnightCoverage(regions);
  const n = (v: number) => v.toLocaleString('en-GB');
  const asOf = c.readAt ? formatOvernightDay(c.readAt) : null;

  return (
    <section
      data-testid="overnight-coverage"
      aria-labelledby="overnight-coverage-heading"
      className="mt-6 max-w-prose"
    >
      <h2
        id="overnight-coverage-heading"
        className="text-base font-semibold text-heading"
      >
        Staying the night in a motorhome
      </h2>
      {c.allowed + c.forbidden === 0 ? (
        <p className="mt-1 text-sm text-ink-2" data-testid="overnight-coverage-none">
          We do not know whether a motorhome may stay the night at any of the{' '}
          {n(c.spots)} campsites we list in {countryName}. No source we use
          says either way, so we show no answer rather than guess. Check the
          signs at the place and the municipality&rsquo;s rules before you
          go.
          {asOf && <> Counted from our listings as of {asOf}.</>}
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-2" data-testid="overnight-coverage-some">
          For{' '}
          <strong className="font-semibold text-heading">{n(c.allowed)}</strong>{' '}
          of the {n(c.spots)} campsites we list in {countryName}, OpenStreetMap
          says an overnight stay in a motorhome is allowed
          {c.forbidden > 0 && (
            <>
              {' '}
              and for{' '}
              <strong className="font-semibold text-heading">
                {n(c.forbidden)}
              </strong>{' '}
              that it is not
            </>
          )}
          . For the other{' '}
          <strong className="font-semibold text-heading">{n(c.unknown)}</strong>{' '}
          we do not know, which is not the same as not allowed — each of those
          pages says what to check.
          {asOf && <> Counted from our listings as of {asOf}.</>}
        </p>
      )}
    </section>
  );
}
