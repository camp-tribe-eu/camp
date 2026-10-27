import { getRegionInsights } from '@/lib/api';
import { regionInsightDates, regionInsightLines } from '@/lib/region-insights';

// "Camping in <region>" — the one thing on a region page a competitor
// cannot copy from the same OpenStreetMap rows: a context COUNTED from
// our listings. Everything printable, and the threshold that decides what
// is, lives in lib/region-insights.ts; this file only lays it out.
//
// 🔴 A REGION WITH NOTHING TO SAY GETS NO BLOCK. Not an empty heading, not
// "no data": nothing. The listing above it already says how many sites
// there are, and a heading over an empty list would read as "nothing is
// known about camping here", which is not what a missing tag means.
//
// 🔴 Static. One cached read at build time (`revalidate: 86400`, as every
// other read on this page) — no headers, no cookies, no search params.

export default async function RegionInsights({
  country,
  region,
}: {
  country: string;
  region: string;
}) {
  const counts = await getRegionInsights(country, region);
  if (!counts) return null;
  const lines = regionInsightLines(counts);
  if (lines.length === 0) return null;

  return (
    <section
      data-testid="region-insights"
      aria-labelledby="region-insights-heading"
      className="mt-6 max-w-prose"
    >
      <h2
        id="region-insights-heading"
        className="text-xl font-bold md:text-[25px]"
      >
        Camping in {counts.region}
      </h2>
      <p
        className="mt-2 text-sm text-ink-2"
        data-boilerplate="region-insights-intro"
      >
        Counted from our own listings. Where OpenStreetMap has not recorded
        something, it is left out of the count rather than read as a no.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
        {lines.map((l) => (
          <li key={l.key} data-insight={l.key}>
            {l.text}
          </li>
        ))}
      </ul>
      {/* The day, once: every line above was read on one of these two. */}
      <p className="mt-2 text-sm text-ink-3">{regionInsightDates(lines)}</p>
    </section>
  );
}
