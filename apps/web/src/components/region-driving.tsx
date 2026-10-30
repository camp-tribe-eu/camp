import { getRegionInsights } from '@/lib/api';
import { regionDrivingLines, regionInsightDates } from '@/lib/region-insights';

// "Driving a camper here" (CAMP-404) — the second paragraph of the text
// "Camping in <region>" begins: what a driver of a motorhome can be told
// about a region from the same counted rows, in the same voice and under
// the same rules. What is printable, and the threshold that decides it,
// lives in lib/region-insights.ts (`regionDrivingLines`); this file only
// lays it out.
//
// 🔴 A REGION WITH NOTHING TO SAY GETS NO BLOCK. Not a heading over "no
// motorhome parks", not "no data": nothing. A missing record is not a
// "no" (survey §4) and a heading over an empty list would say it is.
//
// 🔴 THE ROUTE PLANNER IS NOT PROMISED HERE. The mock's paragraph about
// width limits and cols is editorial text we have no data for: height and
// terrain are on 2.0 % of rows (survey §1).
//
// 🔴 Static, and on the base first page only — the caller decides that
// (`baseFirstPage` in region-listing.tsx). `getRegionInsights` is the same
// URL "Camping in" reads, so the build asks the API once for both.

export default async function RegionDriving({
  country,
  region,
}: {
  country: string;
  region: string;
}) {
  const counts = await getRegionInsights(country, region);
  if (!counts) return null;
  const lines = regionDrivingLines(counts);
  if (lines.length === 0) return null;

  return (
    <section
      data-testid="region-driving"
      aria-labelledby="region-driving-heading"
      className="mt-6 max-w-prose"
    >
      <h2
        id="region-driving-heading"
        className="text-xl font-bold md:text-[25px]"
      >
        Driving a camper here
      </h2>
      <p
        className="mt-2 text-sm text-ink-2"
        data-boilerplate="region-driving-intro"
      >
        Distances are in a straight line, not by road. A campsite listed as
        something else may take a motorhome too; only the sites
        OpenStreetMap lists as motorhome parks or camper stops are counted.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
        {lines.map((l) => (
          <li key={l.key} data-driving={l.key}>
            {l.text}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-ink-3">{regionInsightDates(lines)}</p>
    </section>
  );
}
