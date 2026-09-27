// CAMP-4 / CAMP-54 — the rental section's data layer.
//
// 🔴 EVERY NUMBER ON A /camper-rental PAGE COMES FROM HERE, AND EVERY ONE
// OF THEM IS A COUNT OF OUR OWN RECORDS.
//
// There are no prices on these pages, no availability, no vehicles and no
// companies, because we hold none of those and the affiliate programmes
// do not exist yet (CAMP-98). What we do hold is 61 422 campsite records
// across the 27 member states, and a count of them is a fact we can put
// our name to. So the country pages lead with a measurement, and the
// measurement is computed here from a dated snapshot rather than typed
// into prose — a sentence nobody can recompute is a sentence nobody can
// check.
//
// 🔴 THE SNAPSHOT IS DATED, AND THE PAGES PRINT THE DATE.
//
// src/data/rental/measured.json is a point-in-time count, the same shape
// as src/data/fuel-prices.json and for the same reason: the database
// moves weekly with the OSM import, and a number without its date is a
// claim about today that nobody checked. `isStale()` below is what stops
// that quietly becoming untrue.
//
// Regenerate it by running this against the API's database, read-only,
// and writing the result to src/data/rental/measured.json:
//
//   MEASUREMENT_SQL (keep in step with the file it produces)
//
//   SELECT lower(country) AS country,
//          count(*)::int AS spots,
//          count(DISTINCT region)::int AS regions,
//          count(*) FILTER (WHERE amenities->>'electricity' = 'yes')::int AS electricity,
//          count(*) FILTER (WHERE amenities->>'shower' = 'yes')::int AS shower,
//          count(*) FILTER (WHERE amenities->>'toilets' = 'yes')::int AS toilets,
//          count(*) FILTER (WHERE amenities->>'water' = 'yes')::int AS water,
//          count(*) FILTER (WHERE amenities->>'greyWater' = 'yes')::int AS "greyWater",
//          count(*) FILTER (WHERE amenities->>'laundry' = 'yes')::int AS laundry,
//          count(*) FILTER (WHERE amenities->>'wifi' = 'yes')::int AS wifi,
//          count(*) FILTER (WHERE amenities->>'dogFriendly' = 'yes')::int AS "dogFriendly",
//          count(*) FILTER (WHERE amenities->>'wheelchair' = 'yes')::int AS wheelchair,
//          count(*) FILTER (WHERE type = 'camper_stop')::int AS "camperStop",
//          count(*) FILTER (WHERE type = 'rv_park')::int AS "rvPark",
//          count(*) FILTER (WHERE type = 'paid')::int AS paid,
//          count(*) FILTER (WHERE type = 'free')::int AS free,
//          count(*) FILTER (WHERE type = 'wild')::int AS wild,
//          count(*) FILTER (WHERE website IS NOT NULL AND website <> '')::int AS website,
//          count(*) FILTER (WHERE stars IS NOT NULL)::int AS stars,
//          count(*) FILTER (WHERE contact->>'phone' IS NOT NULL)::int AS phone
//     FROM camping_spots
//    WHERE region IS NOT NULL AND missing_since IS NULL
//    GROUP BY 1 ORDER BY 1;
//
// 🔴 The WHERE clause is copied from SpotsService.countries(), deliberately.
// If the rental pages counted a different set of rows from the /camping
// hubs, the same country would carry two different totals on one site and
// both of them would be defensible, which is the worst kind of wrong.

import measured from '@/data/rental/measured.json';
import placementData from '@/data/rental/placements.json';
import {
  RENTAL_COUNTRIES,
  rentalCountry,
  type RentalCountry,
} from '@/data/rental/countries';
import { ordinal } from './fuel';
import { offersFor, placementProblems, type Offer, type Placement } from './affiliate';

export type { RentalCountry };
export { RENTAL_COUNTRIES, rentalCountry };

/**
 * The country's name as a sentence wants it — "Germany", but "the
 * Netherlands".
 *
 * 🔴 Used in prose only. The breadcrumb and the schema.org `Place` keep
 * the bare `name`: "/ the Netherlands" reads wrong in a trail, and a
 * structured-data consumer wants the country, not an English phrase.
 */
export function inProse(c: RentalCountry): string {
  return c.definiteArticle ? `the ${c.name}` : c.name;
}

// ── The snapshot ────────────────────────────────────────────────────────

/** The columns the snapshot carries, per member state. */
export interface MeasuredCountry {
  spots: number;
  regions: number;
  electricity: number;
  shower: number;
  toilets: number;
  water: number;
  greyWater: number;
  laundry: number;
  wifi: number;
  dogFriendly: number;
  wheelchair: number;
  camperStop: number;
  rvPark: number;
  paid: number;
  free: number;
  wild: number;
  website: number;
  stars: number;
  phone: number;
}

export interface MeasuredData {
  measuredAt: string;
  about: string;
  query: string;
  filter: string;
  total: { spots: number; countries: number; regions: number };
  countries: Record<string, MeasuredCountry>;
}

export const MEASURED = measured as MeasuredData;

export const MEASURED_CODES = Object.keys(MEASURED.countries).sort();

export function measuredFor(code: string): MeasuredCountry | null {
  return MEASURED.countries[code.toLowerCase()] ?? null;
}

/**
 * How old the snapshot is, against a given "today".
 *
 * Takes `now` rather than reading the clock, so it can be tested — the
 * same rule lib/fuel.ts follows, and for the same reason: this guards a
 * published claim.
 */
export function ageInDays(now: Date, measuredAt = MEASURED.measuredAt): number {
  const then = Date.parse(`${measuredAt}T00:00:00Z`);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/**
 * Past this, the page says the count is old instead of merely dating it.
 *
 * Ninety days: the OSM import runs weekly, but campsite counts move
 * slowly and a country's total changing by a few dozen does not make a
 * sentence about a share untrue. A quarter is the point at which nobody
 * should assume anybody has looked.
 */
export const STALE_AFTER_DAYS = 90;

export const isStale = (now: Date) => ageInDays(now) > STALE_AFTER_DAYS;

// ── Metrics ─────────────────────────────────────────────────────────────

/**
 * What a country page can lead with.
 *
 * `vehicleOnly` is derived rather than stored: camper stops plus RV parks,
 * which is "places built for a vehicle rather than for a tent". It is the
 * only question on this list that our schema answers in two columns.
 */
export type MetricKey =
  | keyof MeasuredCountry
  | 'vehicleOnly';

/** How the sentence names the thing being counted. */
export const METRIC_LABEL: Record<MetricKey, string> = {
  spots: 'campsite records',
  regions: 'regions',
  electricity: 'record a mains electricity hook-up',
  shower: 'record showers',
  toilets: 'record toilets',
  water: 'record drinking water',
  greyWater: 'record grey-water disposal',
  laundry: 'record laundry',
  wifi: 'record Wi-Fi',
  dogFriendly: 'record that dogs are allowed',
  wheelchair: 'record some level of wheelchair access',
  camperStop: 'are camper stops',
  rvPark: 'are RV parks',
  paid: 'are commercial, paid campsites',
  free: 'are free campsites',
  wild: 'are wild camping spots',
  website: 'carry the operator’s own website',
  stars: 'carry an official national star rating',
  phone: 'carry a telephone number',
  vehicleOnly: 'are built for a vehicle rather than for a tent',
};

export function metricValue(row: MeasuredCountry, metric: MetricKey): number {
  if (metric === 'vehicleOnly') return row.camperStop + row.rvPark;
  return row[metric];
}

/** The share of a country's records that answer this question. */
export function shareOf(row: MeasuredCountry, metric: MetricKey): number {
  return row.spots === 0 ? 0 : metricValue(row, metric) / row.spots;
}

/** Records per region — how thinly a country's data is spread. */
export function perRegion(row: MeasuredCountry): number {
  return row.regions === 0 ? 0 : row.spots / row.regions;
}

export type LeadKind = 'share' | 'count' | 'per-region';

/**
 * 🔴 Which way each kind of claim is ranked, said out loud.
 *
 * `share` and `count` rank from the top — "the highest share". A thin
 * spread is the opposite: Slovenia's page leads with how FEW records sit
 * in each region, and calling that "the 26th-highest" would be technically
 * true and deliberately hard to read. So per-region ranks from the bottom
 * and the page says "thinnest".
 */
const DIRECTION: Record<LeadKind, 'desc' | 'asc'> = {
  share: 'desc',
  count: 'desc',
  'per-region': 'asc',
};

function scoreOf(row: MeasuredCountry, metric: MetricKey, kind: LeadKind): number {
  if (kind === 'per-region') return perRegion(row);
  if (kind === 'share') return shareOf(row, metric);
  return metricValue(row, metric);
}

/**
 * A country's position among all 27 on one metric.
 *
 * 🔴 Computed over every member state in the snapshot, never over the
 * twelve countries that happen to have a page. A rank measured against a
 * subset we chose ourselves would be a number dressed as a fact.
 */
export function rankOf(
  code: string,
  metric: MetricKey,
  kind: LeadKind,
): { position: number; of: number } | null {
  const row = measuredFor(code);
  if (!row) return null;
  const scored = MEASURED_CODES.map((c) => ({
    code: c,
    score: scoreOf(MEASURED.countries[c], metric, kind),
  })).sort((a, b) =>
    DIRECTION[kind] === 'desc' ? b.score - a.score : a.score - b.score,
  );
  const i = scored.findIndex((s) => s.code === code.toLowerCase());
  return i < 0 ? null : { position: i + 1, of: scored.length };
}

/** "the highest", "the third-highest", "the second-thinnest". */
export function placeText(position: number, kind: LeadKind): string {
  const superlative = kind === 'per-region' ? 'thinnest' : 'highest';
  if (position === 1) return `the ${superlative}`;
  return `the ${ordinal(position)}-${superlative}`;
}

/** Percentages are written to one decimal and never rounded upward for effect. */
export function percent(fraction: number): string {
  return `${(Math.floor(fraction * 1000) / 10).toFixed(1)}%`;
}

/** Thin spaces between thousands, as every other number on this site. */
export function count(n: number): string {
  return n.toLocaleString('en-GB').replace(/,/g, ' ');
}

export interface MeasuredLead {
  metric: MetricKey;
  kind: LeadKind;
  label: string;
  /** The count itself, or records-per-region for a `per-region` lead. */
  value: number;
  /** The country's total records — the denominator of a share. */
  total: number;
  share: number;
  position: number;
  of: number;
  /** "the highest", "the fourth-highest" — already in reading form. */
  place: string;
}

/**
 * The measured claim a country page leads with, computed rather than
 * written. Null only if the snapshot has no row for the country, which
 * would be a broken data file rather than a missing country.
 */
export function measuredLead(country: RentalCountry): MeasuredLead | null {
  const row = measuredFor(country.code);
  if (!row) return null;
  const { metric, kind } = country.data;
  const rank = rankOf(country.code, metric, kind);
  if (!rank) return null;
  return {
    metric,
    kind,
    label: METRIC_LABEL[metric],
    value: kind === 'per-region' ? perRegion(row) : metricValue(row, metric),
    total: row.spots,
    share: shareOf(row, metric),
    position: rank.position,
    of: rank.of,
    place: placeText(rank.position, kind),
  };
}

// ── The publication gate ────────────────────────────────────────────────

/**
 * 🔴 Below this, a country does not get a page.
 *
 * Not a round number for its own sake. A rental page's only original
 * content about a country, other than the rules, is what our records say
 * about it — and a share computed over a handful of records is noise
 * presented as a measurement. Cyprus (24 records) and Malta (14) are the
 * countries this excludes, and excluding them is the point.
 */
export const MIN_RECORDS_FOR_A_PAGE = 250;

/** Three sourced facts, because two is a paragraph and one is an opinion. */
export const MIN_FACTS = 3;

/**
 * Everything wrong with a country page's content, in words.
 *
 * 🔴 Same shape as `publishable()` in lib/guides.ts, and used the same
 * way: by a test over the whole file rather than by a page rendering one
 * country. The rule this enforces — that no page may be another page with
 * the name swapped — is invisible from inside any single page.
 */
export function countryProblems(c: RentalCountry): string[] {
  const problems: string[] = [];
  const row = measuredFor(c.code);

  if (!row) {
    problems.push(`${c.code}: no row in the measured snapshot`);
    return problems;
  }
  if (row.spots < MIN_RECORDS_FOR_A_PAGE) {
    problems.push(
      `${c.code}: only ${row.spots} records — below the ${MIN_RECORDS_FOR_A_PAGE} a page needs to say anything measured`,
    );
  }
  if (c.facts.length < MIN_FACTS) {
    problems.push(`${c.code}: ${c.facts.length} facts, needs ${MIN_FACTS}`);
  }
  for (const f of c.facts) {
    if (!f.title?.trim()) problems.push(`${c.code}: a fact with no title`);
    if (!f.body?.trim()) problems.push(`${c.code}: "${f.title}" has no body`);
    if (!f.source?.name?.trim()) {
      problems.push(`${c.code}: "${f.title}" names no source`);
    }
    // 🔴 An unsourced claim is the one thing this section may not publish.
    // Either an authority with an address, or one of our own pages.
    if (!/^https:\/\/|^\//.test(f.source?.url ?? '')) {
      problems.push(`${c.code}: "${f.title}" has no usable source link`);
    }
  }
  if (!c.angle?.trim()) problems.push(`${c.code}: no angle`);
  if (!c.intro?.trim()) problems.push(`${c.code}: no intro`);
  if (!c.dataIntro?.trim()) problems.push(`${c.code}: no lead-in to its data`);
  if (!measuredLead(c)) problems.push(`${c.code}: its measured lead does not compute`);
  return problems;
}

/** The countries that pass the gate. This is what the section publishes. */
export function publishableCountries(): RentalCountry[] {
  return RENTAL_COUNTRIES.filter((c) => countryProblems(c).length === 0);
}

// ── Affiliate placements ────────────────────────────────────────────────

interface PlacementFile {
  about: string;
  placements: Placement[];
}

export const PLACEMENTS = (placementData as PlacementFile).placements;

/**
 * The offers for one page — `hub`, or a country code.
 *
 * 🔴 This returns `[]` today, on every page, and that is the shipped
 * state. There are no affiliate accounts yet, so there is no id in the
 * environment and no programme in the file. Callers must render the empty
 * case as a visible, explained slot rather than hiding the section: the
 * disclosure belongs in the template from the first day, not from the day
 * somebody remembers to add it.
 */
export function rentalOffers(page: string): Offer[] {
  return offersFor(page, PLACEMENTS);
}

/** Everything wrong with the placement file. Empty means publishable. */
export function placementFileProblems(): string[] {
  return PLACEMENTS.flatMap(placementProblems);
}
