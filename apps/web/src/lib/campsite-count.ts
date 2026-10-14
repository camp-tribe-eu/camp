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
  return printable(spots);
}

/**
 * A figure we can print, or `null` when the API's answer cannot be stood
 * behind.
 *
 * 🔴 THE SAME TEST, IN ONE PLACE, BECAUSE THE DEFECT HAD FOUR HOMES.
 * CAMP-308 was written about /routes, and /routes is where the typed
 * `61 422` lived. But the predicate "is this number worth printing" was
 * needed by three more surfaces that read the same endpoint, and each of
 * them printed `summary.spots` raw — so on a 429 or a 500 at build time
 * they stated, to a reader and to a crawler, that we hold `0` campsites:
 *
 *   apps/web/src/app/page.tsx:90       "0 campsites and motorhome parks
 *                                       across 0 regions"
 *   apps/web/src/app/search/page.tsx:67 "0 campsites across 27 countries"
 *   apps/web/src/app/search/page.tsx:51 the same 0, inside JSON-LD
 *
 * `getSummary` answers `{spots: 0, countries: 0, regions: 0}` for any
 * non-ok response, which is right for a hero that has an empty state and
 * wrong for a sentence. Zero is not "no data"; printed as a fact it is a
 * false one, and a static build bakes it in until the next deploy.
 */
export const printable = (n: unknown): number | null =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;

const en = (n: number): string => n.toLocaleString('en-GB');

/**
 * The home page's opening clause. The sentence continues ", each with the
 * distance to water…", so this ends without punctuation and starts a
 * sentence either way.
 */
export function heroLead(spots: number | null, regions: number | null): string {
  if (spots === null && regions === null)
    return 'Campsites and motorhome parks across Europe';
  if (regions === null) return `${en(spots as number)} campsites and motorhome parks`;
  if (spots === null)
    return `Campsites and motorhome parks across ${en(regions)} regions`;
  return `${en(spots)} campsites and motorhome parks across ${en(regions)} regions`;
}

/**
 * /search, above the box. `countries` is the length of a list we already
 * hold, not a figure from the summary, so it is never in doubt.
 */
export const searchLead = (spots: number | null, countries: number): string =>
  spots === null
    ? `Campsites across ${en(countries)} countries`
    : `${en(spots)} campsites across ${en(countries)} countries`;

/** /search, as a search result and an assistant read it. */
export const searchDescription = (spots: number | null): string =>
  spots === null
    ? 'Find a campsite by name, by region, or by somewhere near it.'
    : `Find a campsite among ${en(spots)} by name, by region, or by somewhere near it.`;

/** `/routes`, as a search result shows it. */
export function routesDescription(campsites: number | null): string {
  const head =
    'Twelve curated camping routes through the EU — the stages, what each one is for, and the real campsites near every stop';
  return campsites === null
    ? `${head}, from our own database.`
    : `${head}, drawn from the ${campsites.toLocaleString('en-GB')} campsites in our own database.`;
}
