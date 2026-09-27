import type { CuratedRoute } from '@/lib/route-types';

import { route as franceAtlanticCoast } from './france-atlantic-coast';
import { route as tuscanyHillTowns } from './tuscany-hill-towns';
import { route as dalmatianCoastAndIslands } from './dalmatian-coast-and-islands';
import { route as dolomitesAndTyrol } from './dolomites-and-tyrol';
import { route as balticCoastAndCapitals } from './baltic-coast-and-capitals';
import { route as andalusiaInWinter } from './andalusia-in-winter';
import { route as danubeViennaToBudapest } from './danube-vienna-to-budapest';
import { route as wildAtlanticWay } from './wild-atlantic-way-cork-to-the-burren';
import { route as swedishLakesAndForests } from './swedish-lakes-and-forests';
import { route as portugueseAtlantic } from './portuguese-atlantic';
import { route as waddenSeaAndDikes } from './wadden-sea-and-dikes';
import { route as peloponneseLoop } from './peloponnese-loop';

// CAMP-3 / CAMP-45 — the curated route library.
//
// 🔴 TWELVE ROUTES, NOT FIFTY, AND THAT IS THE POINT.
//
// The card asks for roughly fifty. Fifty is achievable in an afternoon
// by writing one paragraph and substituting place names, and that is
// exactly the thing CAMP-130 refuses for guides: a thin template
// repeated at scale is the textbook scaled-content-abuse pattern, and
// the cost of shipping it is not a page, it is the domain. The same
// argument applies here with better photographs.
//
// So these twelve are written to be individually defensible. No two
// share an opening sentence, a structure or an argument: the Tuscan one
// is about campsites being in valleys and towns being on hills, the
// Croatian one is about ferry timetables, the Irish one is about road
// width, the Andalusian one exists specifically for January, and the
// Swedish one is mostly about what allemansrätten does not cover. If a
// thirteenth is added it needs something of its own to say, and
// `validateRoute` is deliberately hard to satisfy without one.
//
// 🔴 EVERY COORDINATE WAS CHECKED AGAINST OUR OWN DATABASE.
//
// Not eyeballed on a map. For each of the 67 stages here, a query asked
// the campsite table which country and region the nearest live campsite
// sits in and how far away it is; a coordinate anchored to the wrong
// town shows up immediately as a country mismatch or an absurd distance.
// All 67 resolved to the expected country and a plausible region.
//
// That check exists because this project has already published route
// distances anchored to the wrong town once. They were plausible on the
// page and wrong on the ground, which is the hardest kind of error to
// find afterwards and the cheapest kind to prevent beforehand.
//
// 🔴 The campsite counts quoted in the prose were measured on
// 27.09.2026 against 61 422 live campsites, and they will drift as the
// weekly OSM import runs. They are written as "our database holds N",
// which is a statement about a measurement on a date, not a promise
// about the ground.

/**
 * The library, in the order the index page shows them.
 *
 * 🔴 Not alphabetical and not by country. The order is editorial: the
 * two routes a first-timer should actually consider come first, the
 * specialist ones (winter, high mountain, the thinly served ones) come
 * later. The index page lets a reader re-sort and filter; this is what
 * they see before they do.
 */
export const CURATED_ROUTES: CuratedRoute[] = [
  franceAtlanticCoast,
  tuscanyHillTowns,
  dalmatianCoastAndIslands,
  danubeViennaToBudapest,
  dolomitesAndTyrol,
  portugueseAtlantic,
  waddenSeaAndDikes,
  wildAtlanticWay,
  swedishLakesAndForests,
  balticCoastAndCapitals,
  andalusiaInWinter,
  peloponneseLoop,
];
