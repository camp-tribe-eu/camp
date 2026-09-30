// CAMP-113: the services beside a route's stages — fuel, charging,
// water, a dump point, a shop, a meal and a roof.
//
// 🔴 THE SCOPE IS OPENSTREETMAP, AND THAT IS NARROWER THAN THE CARD.
//
// CAMP-113 depends on CAMP-111 (which sources, which licences), which is
// not done. Rather than wait, this is built on the one source already
// imported and already licence-cleared here: OpenStreetMap under ODbL, a
// curated page being a Produced Work under §4.5(a). Open Charge Map,
// the national fuel portals and per-station prices belong to CAMP-111
// and are not here. The card is narrowed, not closed.
//
// 🔴 A LIST PER STAGE, AND NOTHING ON THE MAP. ALSO A DECISION.
//
// The card asks for "a layer on the map and a list along the route", and
// its own first open question is how many types the map can take before
// it turns to soup. The map already carries 7 stage pins and up to 28
// campsites; 49 more markers in seven colours is the soup, and it would
// bury the campsites, which are what the page is for.
//
// The list answers the question a driver actually asks — "is there fuel
// near tonight's stop, and how far" — and answers it in words that
// survive having no JavaScript, which the map does not. If a layer is
// ever added it needs its own card, its own toggle and its own argument
// about which one or two kinds earn a pin.
//
// 🔴 NO RATING AND NO PHOTOGRAPH, AND NOT BY OVERSIGHT.
//
// Neither exists in open data. Google's terms exclude directories, so
// its reviews and its pictures are not available to us at any price we
// are willing to pay. Reviews arrive with CAMP-53 and photographs with
// CAMP-52, from our own community and from operators — not from
// somebody else's site. Nothing in this module has a field for either,
// which is the only reliable way to keep one from appearing.

import { apiFetch } from './api';
import { countryFuel, FUEL } from './fuel';
import type { CuratedRoute } from './route-types';

/** The closed list of kinds, in the order a stage lists them. */
export const SERVICE_KINDS = [
  'fuel',
  'charging',
  'water',
  'dump',
  'groceries',
  'food',
  'shelter',
] as const;

export type ServiceKind = (typeof SERVICE_KINDS)[number];

/**
 * 🔴 The labels say what the OSM tag actually means, not what we wish it
 * meant.
 *
 * "Drinking water" rather than "Water", because `amenity=drinking_water`
 * is a claim about potability and `man_made=water_well` — which we
 * deliberately do not import — is not. "Somewhere to sleep" rather than
 * "Hotels", because the kind also holds hostels and guest houses.
 */
export const SERVICE_LABEL: Record<ServiceKind, string> = {
  fuel: 'Fuel',
  charging: 'Charging',
  water: 'Drinking water',
  dump: 'Chemical toilet disposal',
  groceries: 'Groceries',
  food: 'Somewhere to eat',
  shelter: 'Somewhere to sleep',
};

/**
 * What an unnamed one is called.
 *
 * 🔴 A noun per kind, not the label lower-cased. The label is a column
 * heading and several of them are phrases: lower-casing gave "Unnamed
 * charging" and would have given "Unnamed somewhere to sleep". The
 * unnamed case is not an edge — the nearest drinking-water point is
 * unnamed at 65 of the library's 67 stages — so it is the wording most
 * readers see.
 */
export const SERVICE_UNNAMED: Record<ServiceKind, string> = {
  fuel: 'Unnamed fuel station',
  charging: 'Unnamed charging point',
  water: 'Unnamed drinking-water point',
  dump: 'Unnamed disposal point',
  groceries: 'Unnamed shop',
  food: 'Unnamed café or restaurant',
  shelter: 'Unnamed place to stay',
};

/**
 * What the reader is told when a kind has nothing within the radius.
 *
 * 🔴 "Our database holds none" — never "there is none". They are
 * different statements and we can only make the first. This is the same
 * sentence the campsite list beside a stage already uses, for the same
 * reason.
 *
 * 🔴 Every line is of the form "no X", because it reads into "Our
 * database holds ___ within 25 km of this stop". One that did not would
 * produce a sentence saying the opposite of what it means, so there is a
 * unit test on the shape and not only on the presence.
 */
export const SERVICE_ABSENT: Record<ServiceKind, string> = {
  fuel: 'no fuel station',
  charging: 'no charging point',
  water: 'no drinking-water point',
  dump: 'no chemical-toilet disposal point',
  groceries: 'no supermarket or convenience shop',
  food: 'no restaurant, café or takeaway',
  shelter: 'no hotel, motel, hostel or guest house',
};

/** How far from a stage we will look. The same radius as the campsites. */
export const SERVICE_RADIUS_M = 25_000;

/**
 * 🔴 ONE OF EACH KIND PER STAGE, AND THE NUMBER IS THE LICENCE.
 *
 * A route page is a Produced Work under ODbL §4.5(a) because it shows a
 * handful of objects picked on our own criteria. `ODBL_SUBSTANTIAL_FLOOR`
 * in lib/routes.ts puts our own line at 100 objects; the longest route
 * has 7 stages already showing 4 campsites each, which is 28. Seven
 * kinds at ONE each adds 49, for 77. At two each it would be 126 — over
 * our own line, on the page that prints the claim. tests/unit/routes.spec
 * fails if a route or a kind is added that would cross it.
 *
 * It is also the right amount of information. "The nearest charger is
 * 4 km away" is what a driver needs; the nearest six is the soup the
 * card warns about — park4night's problem, where half the points are
 * water taps.
 */
export const SERVICES_PER_KIND = 1;

export interface RouteServicePoint {
  kind: ServiceKind;
  /** The OpenStreetMap object, so a reader can check or fix it. */
  osmRef: string;
  /**
   * 🔴 Null at most stops for most kinds, and rendered as "unnamed".
   * Measured across the 67 published stages: the nearest drinking water
   * is unnamed at 65 of them, the nearest disposal point at 49 of 51,
   * the nearest charger at 28. Dropping the unnamed ones would delete
   * the answer nearly everywhere it matters.
   */
  name: string | null;
  lat: number;
  lon: number;
  /** 🔴 Straight-line metres. There is no road distance on this site. */
  metres: number;
  phone: string | null;
  website: string | null;
  /** OSM's own syntax, verbatim. See the note in ServiceHours. */
  openingHours: string | null;
  /**
   * CAMP-154 — the price of a litre ON THIS FORECOURT. Absent far more
   * often than present, and only ever on `kind: 'fuel'`. See the block
   * at the foot of this file.
   */
  prices?: RouteFuelStationPrice[];
}

export interface StageServices {
  lat: number;
  lon: number;
  services: RouteServicePoint[];
}

interface ServicesAnswer {
  groups: StageServices[];
  radiusMetres: number;
  perKind: number;
  returned: number;
  truncated?: boolean;
}

/**
 * 🔴 THREE STATES, NOT TWO, AND THE THIRD IS THE ONE REVIEW FOUND
 * MISSING.
 *
 * This used to return `StageServices[]`, with an empty `services` array
 * per stage on any failure. `serviceOf` then returned null for every
 * kind and the page rendered, seven times per stage, **"Our database
 * holds no fuel station within 25 km of this stop."** On a seven-stage
 * route that is 49 false statements about the ground, printed because a
 * fetch failed — the exact thing the header of this file and of
 * route-services.tsx both promise not to do. The component had no way to
 * say "we could not look", because nothing told it.
 *
 * So the answer carries whether we actually looked. `looked: false`
 * means the page says so in one line instead of inventing 49 absences.
 */
export interface RouteServicesResult {
  looked: boolean;
  groups: StageServices[];
}

/**
 * The services beside every stage of one route, in one request.
 *
 * 🔴 One request for the whole page, like `getRouteNeighbours`. The
 * build renders every route page and the API throttles per caller;
 * per-stage calls would be 84 requests where this is 12.
 *
 * Returns an empty group per stage on failure rather than throwing. A
 * route page without its services block is a page with less on it; a
 * route page that throws is a build that produces nothing, and this
 * project has shipped one silent build truncation already (CAMP-69).
 */
export async function getRouteServices(
  route: CuratedRoute,
): Promise<RouteServicesResult> {
  const unlooked: RouteServicesResult = {
    looked: false,
    groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, services: [] })),
  };
  const points = route.stages.map((s) => `${s.lat},${s.lon}`).join(';');

  try {
    const res = await apiFetch(
      `/routes/services?points=${encodeURIComponent(points)}` +
        `&radius=${SERVICE_RADIUS_M}`,
      // The OSM import runs weekly (CAMP-28); daily is already far more
      // often than a fuel station moves.
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return unlooked;
    const answer = (await res.json()) as ServicesAnswer;
    // 🔴 Never merged by index when the count is wrong. Pairing stage 3
    // with stage 4's fuel station is the "anchored to the wrong town"
    // failure this whole section is supposed to have learned from, and
    // here it would put a refuelling stop in another valley.
    if (
      !Array.isArray(answer?.groups) ||
      answer.groups.length !== route.stages.length
    ) {
      return unlooked;
    }
    // 🔴 A short answer is not an empty area. The API says when its own
    // cap stopped it; a page that printed those stages as "we hold
    // nothing" would be describing the ground from a number in our code.
    if (answer.truncated) return unlooked;
    // 🔴 THE RADIUS WE ASKED FOR IS THE RADIUS WE PRINT.
    //
    // The page says "within 25 km" in three places. The API clamps
    // `radius` to MAX_RADIUS_M, so raising SERVICE_RADIUS_M above that
    // ceiling would leave every one of those sentences false while
    // everything still rendered. The answer carries what was actually
    // applied, so we compare rather than assume — and a mismatch is a
    // failure to look, not something to paper over.
    if (answer.radiusMetres !== SERVICE_RADIUS_M) return unlooked;
    return {
      looked: true,
      groups: answer.groups.map((g) => ({
        lat: g.lat,
        lon: g.lon,
        services: Array.isArray(g.services) ? g.services : [],
      })),
    };
  } catch {
    return unlooked;
  }
}

/** The service of one kind at a stage, or null. */
export function serviceOf(
  group: StageServices | undefined,
  kind: ServiceKind,
): RouteServicePoint | null {
  return group?.services.find((s) => s.kind === kind) ?? null;
}

export interface RouteFuelPrice {
  code: string;
  name: string;
  petrol: number | null;
  diesel: number | null;
}

/**
 * This week's pump prices for the countries the route crosses.
 *
 * 🔴 A NATIONAL AVERAGE FOR A WEEK, NOT THIS STATION'S PRICE, AND THE
 * DIFFERENCE IS THE WHOLE REASON THIS IS NOT RENDERED BESIDE THE PUMP.
 *
 * The European Commission publishes one consumer price per country per
 * Thursday (CAMP-55). Printing it next to "Diskonttank, 614 m" would
 * read as what that station charges, which we do not know and cannot
 * find out from open data. So it sits at route level, against the
 * country, labelled with the week it was measured — which is the claim
 * we can actually support, and is still the thing park4night does not
 * have.
 *
 * Countries come from `route.countries`, which is curated and hand
 * checked, rather than from a point-in-polygon lookup: measured
 * 28.09.2026, Natural Earth's simplified admin-1 polygons place 6 of the
 * library's 67 stages in no country at all, because a coastal stop sits
 * just outside the coastline. A derived country that is wrong or absent
 * at one stop in nine is worse than the curated one that is neither.
 */
export function routeFuelPrices(route: CuratedRoute): RouteFuelPrice[] {
  return route.countries
    .map((code) => {
      const c = countryFuel(code);
      if (!c) return null;
      // A country with neither price is omitted rather than shown empty:
      // this block is about numbers we have.
      if (c.petrol === null && c.diesel === null) return null;
      return {
        code: code.toUpperCase(),
        name: c.name,
        petrol: c.petrol,
        diesel: c.diesel,
      };
    })
    .filter((c): c is RouteFuelPrice => c !== null);
}

/** The Thursday those prices were published, as the page prints it. */
export const FUEL_BULLETIN_DATE = FUEL.bulletinDate;
export const FUEL_SOURCE = FUEL.source;

/**
 * 🔴 The attribution string, re-exported rather than rewritten.
 *
 * The bulletin is CC BY 4.0, and attribution is a condition of reuse, not
 * a courtesy. components/fuel-price-table.tsx already prints
 * `FUEL.attribution` verbatim; a second, shorter wording on the route
 * pages would be a second thing to keep correct and the first one to go
 * stale.
 */
export const FUEL_ATTRIBUTION = FUEL.attribution;

// ── CAMP-154: THE PRICE OF A LITRE ON ONE FORECOURT ─────────────────────
//
// 🔴 THE LINE THIS WHOLE SECTION DEFENDS.
//
// Everything above this comment is about a NATIONAL AVERAGE FOR A WEEK
// (CAMP-55). Everything below is about ONE FORECOURT AT ONE MOMENT.
// They are different claims, they are wrong in different directions,
// and a reader who mistakes one for the other has been misled by us.
//
// The averages do not go away — they are still the only fuel figure we
// have for 24 of the 27 member states — but from this card on they are
// labelled ON THE PAGE as averages. `AVERAGE_BADGE` is the word that
// does it, and `route-fuel.spec.tsx` asserts a reader can see it.
//
// 🔴 WHERE THE STATION PRICES COME FROM, AND WHERE THEY DO NOT.
//
// Three countries publish per station on terms that permit commercial
// reuse; `docs/road-hazard-sources.md` §6 holds the quotations. Austria
// is NOT among them — its endpoint answers 200 with no key and no rate
// limit, and no consumer licence exists for it at all. Portugal and
// Hungary forbid commercial use in their own words. Belgium, Greece and
// Poland do not publish per station. None of them can reach this page:
// the only source ids that render are the three in `SOURCE_ATTRIBUTION`,
// and a price arriving from anything else is dropped rather than shown
// with a shrug.

/** One grade's price on one forecourt, as the API sends it. */
export interface RouteFuelStationPrice {
  grade: 'diesel' | 'petrol';
  /** The source's own product name — `Gazole`, `SP95`, `Gasolio`… */
  product: string;
  /**
   * 🔴 A STRING, all the way from `numeric(6,3)` to the page.
   *
   * Never parsed into a float. `spot_tariffs` records what happens when
   * money meets a 32-bit float: the DATAtourisme feed contains
   * `"2.7999999523162841796875"` for €2.80 because somebody upstream
   * did exactly that. The ministry published `1.849`; the reader sees
   * `1.849`; nothing in between has an opinion.
   */
  price: string;
  /** ISO 8601 — when the SOURCE says the price was set. */
  measuredAt: string;
  source: string;
}

/**
 * 🔴 The three sources, and the closed list that keeps the rest out.
 *
 * A price whose `source` is not a key here is DROPPED, not rendered
 * with a shrug. That is the mechanical half of "refused countries must
 * not creep in": if an import ever wrote an Austrian row, the page
 * would still not print it, because there would be no attribution to
 * print beside it — and a price we cannot attribute is not something
 * this site publishes.
 */
export const SOURCE_ATTRIBUTION: Record<string, { name: string; href: string }> = {
  'es-minetur': {
    name: 'Ministerio para la Transición Ecológica y el Reto Demográfico',
    href: 'https://geoportalgasolineras.es/',
  },
  'fr-data-economie': {
    name: 'Ministère de l’Économie et des Finances',
    href: 'https://www.prix-carburants.gouv.fr/',
  },
  'it-mimit': {
    name: 'Ministero delle Imprese e del Made in Italy',
    href: 'https://carburanti.mise.gov.it/ospzSearch/',
  },
};

/**
 * 🔴 These two numbers are `PRICE_STALE_AFTER_DAYS` and
 * `PRICE_DROP_AFTER_DAYS` in `apps/api/src/fuel/stations.ts`, and
 * `route-fuel.spec.tsx` reads that file off disk and fails if they have
 * drifted apart.
 *
 * Two copies of a staleness rule is one copy that will be wrong, and it
 * fails in the worst direction: the importer keeping a price the page
 * believes it has already discarded.
 *
 * Seven days, because the feeds refresh between every thirty minutes
 * and once a day — a price a week old is a forecourt that has stopped
 * filing, not a slow refresh. Thirty days, because past that the number
 * is history, and printing it beside a date does not repair it: the
 * number is what gets read.
 */
export const PRICE_STALE_AFTER_DAYS = 7;
export const PRICE_DROP_AFTER_DAYS = 30;

export type PriceFreshness = 'fresh' | 'stale' | 'expired';

/**
 * How old a price is, and therefore how the page may present it.
 *
 * 🔴 Takes `now` rather than reading the clock, for the reason
 * `lib/fuel.ts:ageInDays` gives: a function that reads the clock cannot
 * be tested, and this one guards a published claim. The site is a
 * static export, so "now" at render time is the build — which is
 * precisely the moment the reader needs told.
 */
export function priceFreshness(
  measuredAt: string,
  now: Date,
): { state: PriceFreshness; days: number } {
  const then = Date.parse(measuredAt);
  // 🔴 An unparsable date is `expired`, never `fresh`. The one direction
  // a date bug must not fail in is "treat an unknown age as current".
  if (Number.isNaN(then)) {
    return { state: 'expired', days: Number.POSITIVE_INFINITY };
  }
  const days = (now.getTime() - then) / 86_400_000;
  if (days > PRICE_DROP_AFTER_DAYS) return { state: 'expired', days };
  if (days > PRICE_STALE_AFTER_DAYS) return { state: 'stale', days };
  return { state: 'fresh', days };
}

export interface DisplayPrice extends RouteFuelStationPrice {
  state: Exclude<PriceFreshness, 'expired'>;
  days: number;
  attribution: { name: string; href: string };
}

/**
 * The prices a fuel row may actually print, in the order it prints them.
 *
 * 🔴 Returns an EMPTY ARRAY rather than null when everything is filtered
 * out, and the component turns that into a sentence. "Never render
 * empty when data is missing" has been broken twice in this codebase
 * and caught both times; the shape that makes a third time hard is one
 * where the absent case is a value the renderer must handle, not the
 * absence of a value it can forget.
 */
export function displayPrices(
  point: RouteServicePoint | null,
  now: Date,
): DisplayPrice[] {
  if (!point?.prices) return [];
  const out: DisplayPrice[] = [];
  for (const p of point.prices) {
    const attribution = SOURCE_ATTRIBUTION[p.source];
    if (!attribution) continue;
    // 🔴 The shape is checked, not assumed. A number here rather than a
    // string means something between the column and this line converted
    // it, which is the defect this whole chain is built to prevent — so
    // it is dropped and the row says we have no price, rather than
    // printing `1.8489999771118164`.
    if (typeof p.price !== 'string' || !/^\d+(?:\.\d+)?$/.test(p.price)) continue;
    const { state, days } = priceFreshness(p.measuredAt, now);
    if (state === 'expired') continue;
    out.push({ ...p, state, days, attribution });
  }
  // Diesel first. The API orders it; this orders it again, because two
  // stages of one route listing the grades the other way round reads as
  // a difference between the stations rather than between the queries.
  return out.sort((a, b) =>
    a.grade === b.grade ? 0 : a.grade === 'diesel' ? -1 : 1,
  );
}

/**
 * 🔴 THE WORD THAT KEEPS A COUNTRY AVERAGE FROM READING AS A PUMP PRICE.
 *
 * A constant so the badge on the route block and the assertion in the
 * spec print the same string. A second wording would be a second thing
 * to keep right, and this is the one piece of text on the page the card
 * names as a hard requirement.
 */
export const AVERAGE_BADGE = 'Country average';

/** What a fuel row says when we hold no usable price for that forecourt. */
export const NO_STATION_PRICE = 'We hold no price for this station';
