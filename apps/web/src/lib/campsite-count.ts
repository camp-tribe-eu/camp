import { getSummary } from './api';

// CAMP-308 — a campsite count in a sentence that a search engine reads.
//
// 🔴 `61 422` was typed into the `description` of /routes. It was true
// on 27.09.2026 and went on being printed, to readers and to Google,
// after it stopped being true: the import runs weekly, so a typed copy
// is wrong for half a week on average, and the copies drift apart from
// each other before they drift from the database. So the number is
// asked for at build time, from the same endpoint the home page uses,
// and a sentence is built around it here — where a test can read it.
//
// 🔴 THERE ARE THREE NUMBERS AND THEY ARE NOT INTERCHANGEABLE (CAMP-253,
// CAMP-133). Measured 14.10.2026 on `camptribe_dev`, to show how far
// apart they are, not as a claim about today:
//
//   63 031   rows in `camping_spots` — everything ever imported,
//            including 5 949 the OSM import has stamped `missing_since`
//            and the secondary copies of campsites already counted;
//   52 633   campsites on the map — not missing, not a secondary copy.
//            A campsite with no region IS here (the location is real);
//   52 501   campsites with a page — the same, and with a region,
//            because the URL is built from it.
//
// The first overstates the third by a fifth. It is also the one that is
// easiest to reach for, because it is the one `SELECT count(*)` gives.
//
// 🔴 THE THIRD IS THE ONE HERE, and the reason is on the page itself:
// /routes shows the campsites near each stop, and the query that finds
// them (`RoutesService.near`) filters on exactly `region IS NOT NULL`,
// `missing_since IS NULL` and not-a-secondary. "The campsites in our
// database" on that page means the population its stops are drawn from.
// The map's number would be one a stop can never reach.
//
// `/spots/summary` (this), `/spots/countries` (llms.txt, /camping, the
// country list under /map) and `/spots/index` (the sitemap, and the pages
// that are generated) each spell out that predicate in their own SQL, so
// they agree by measurement and not by construction. 14.10.2026, on a copy
// of `camptribe_dev`: summary.spots, the sum of countries[].spots and
// len(index) were all 52 501, and `/spots/map/regions` summed to 52 633.
// If they ever part, /routes and llms.txt will print different numbers
// and nothing in the build will say so: campsite-count.spec.ts pins how
// each surface READS its endpoint, not that the endpoints agree.

/**
 * The number of campsites that have a page, or `null` when we cannot say.
 *
 * 🔴 `null`, not `0`. `getSummary` answers zeros when the API replies
 * with an error, which is right for a hero that has its own empty state
 * and wrong for a sentence: "from our own database of 0" would be
 * printed as a fact, to a crawler, on the strength of a 429. No number
 * is better than a made-up one, so the caller leaves the figure out.
 */
export async function publishableCampsiteCount(): Promise<number | null> {
  const { spots } = await getSummary();
  return Number.isInteger(spots) && spots > 0 ? spots : null;
}

/** `/routes`, as a search result shows it. */
export function routesDescription(campsites: number | null): string {
  const head =
    'Twelve curated camping routes through the EU — the stages, what each one is for, and the real campsites near every stop';
  return campsites === null
    ? `${head}, from our own database.`
    : `${head}, drawn from the ${campsites.toLocaleString('en-GB')} campsites in our own database.`;
}
