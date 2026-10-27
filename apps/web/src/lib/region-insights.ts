import { formatDistance } from './api';
import { formatOvernightDay } from './overnight';

// "Camping in <region>" — the sentences a region page may say about its
// campsites, from counts the API took over OUR rows
// (apps/api/src/spots/region-insights.ts). The survey the card stands on is
// docs/region-insight-survey.md (27.10.2026).
//
// 🔴 THE DENOMINATOR IS WHAT IS KNOWN, NEVER THE REGION. "Of the 6 sites
// where OpenStreetMap records whether there is electricity, 4 have it and
// 2 do not" — the 6 is yes + no, added up HERE from the two figures the
// API sends, so a site nobody tagged is in neither. A share over all the
// campsites of a region would be a share over the 73 % nobody tagged
// (survey §1), and it would move with whoever tagged last.
//
// 🔴 FIVE KNOWN VALUES OR NOTHING. A claim with fewer is not printed as
// "not enough data" — it is not printed at all, so a region whose
// campsites nobody tagged shows the listing and no block. This is the one
// lock on the threshold; the API sends raw counts. Removing it is the
// mutation region-insights.spec.tsx exists to catch.
//
// 🔴 NO PERCENTAGES, and every sentence carries the day its figures were
// read — the same two rules as OvernightCoverage (CAMP-255).

export const INSIGHT_MIN_KNOWN = 5;

export const INSIGHT_AMENITIES = ['electricity', 'toilets', 'shower'] as const;
export type InsightAmenity = (typeof INSIGHT_AMENITIES)[number];
export const INSIGHT_SPOT_TYPES = ['paid', 'rv_park', 'camper_stop', 'free', 'wild'] as const;
export type InsightSpotType = (typeof INSIGHT_SPOT_TYPES)[number];

export interface RegionInsights {
  region: string;
  spots: number;
  readAt: string | null;
  types: Record<InsightSpotType, number>;
  amenities: Record<InsightAmenity, { yes: number; no: number }>;
  surroundings: {
    computedAt: string | null;
    supermarket: { known: number; within: number };
    station: { known: number; within: number };
    water: {
      named: number;
      top: { name: string; sites: number; nearestM: number; farthestM: number } | null;
    };
  };
}

export interface InsightLine {
  /** What the sentence is about: the key a test can pick it out by. */
  key: string;
  text: string;
  /** `YYYY-MM-DD`: the day the figures in `text` are a reading of. */
  asOf: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

const day = (v: unknown): string | null =>
  typeof v === 'string' && DAY.test(v) ? v : null;

/**
 * An API payload → the counts the page may use, or null.
 *
 * Every figure must be a non-negative integer and every day a day: a
 * payload that disagrees with that shape — an older API, a field renamed —
 * yields NO block rather than a sentence with "undefined" in it.
 */
export function readRegionInsights(raw: unknown): RegionInsights | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.region !== 'string' || r.region === '') return null;
  const spots = count(r.spots);
  if (spots === null) return null;

  const types = {} as Record<InsightSpotType, number>;
  const t = (r.types ?? {}) as Record<string, unknown>;
  for (const k of INSIGHT_SPOT_TYPES) {
    const v = count(t[k]);
    if (v === null) return null;
    types[k] = v;
  }

  const amenities = {} as Record<InsightAmenity, { yes: number; no: number }>;
  const a = (r.amenities ?? {}) as Record<string, unknown>;
  for (const k of INSIGHT_AMENITIES) {
    const pair = (a[k] ?? {}) as Record<string, unknown>;
    const yes = count(pair.yes);
    const no = count(pair.no);
    if (yes === null || no === null) return null;
    amenities[k] = { yes, no };
  }

  const s = (r.surroundings ?? {}) as Record<string, unknown>;
  const pair = (o: unknown) => {
    const p = (o ?? {}) as Record<string, unknown>;
    const known = count(p.known);
    const within = count(p.within);
    return known === null || within === null ? null : { known, within };
  };
  const supermarket = pair(s.supermarket);
  const station = pair(s.station);
  const w = (s.water ?? {}) as Record<string, unknown>;
  const named = count(w.named);
  if (!supermarket || !station || named === null) return null;
  let top: RegionInsights['surroundings']['water']['top'] = null;
  if (w.top !== null && w.top !== undefined) {
    const tp = w.top as Record<string, unknown>;
    const sites = count(tp.sites);
    const nearestM = count(tp.nearestM);
    const farthestM = count(tp.farthestM);
    if (
      typeof tp.name !== 'string' ||
      tp.name.trim() === '' ||
      sites === null ||
      nearestM === null ||
      farthestM === null
    ) {
      return null;
    }
    top = { name: tp.name, sites, nearestM, farthestM };
  }

  return {
    region: r.region,
    spots,
    readAt: day(r.readAt),
    types,
    amenities,
    surroundings: {
      computedAt: day(s.computedAt),
      supermarket,
      station,
      water: { named, top },
    },
  };
}

const n = (v: number) => v.toLocaleString('en-GB');

/** The words of SPOT_TYPE_LABEL, as a sentence needs them. */
const TYPE_WORDS: Record<InsightSpotType, [string, string]> = {
  paid: ['a paid campsite', 'paid campsites'],
  rv_park: ['a motorhome park', 'motorhome parks'],
  camper_stop: ['a camper stop', 'camper stops'],
  free: ['a free campsite', 'free campsites'],
  wild: ['a wild camping spot', 'wild camping spots'],
};

const AMENITY_WORDS: Record<InsightAmenity, { records: string; it: string }> = {
  electricity: { records: 'whether there is electricity', it: 'it' },
  toilets: { records: 'whether there are toilets', it: 'them' },
  shower: { records: 'whether there are showers', it: 'them' },
};

/** "a, b and c" */
const list = (parts: string[]) =>
  parts.length <= 1
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/**
 * The sentences, in reading order. Each is printed only when the figure it
 * rests on has at least INSIGHT_MIN_KNOWN known values AND a day to be
 * read as of; a region with fewer gets no sentence for it, and a region
 * with none gets an empty list and no block.
 */
export function regionInsightLines(i: RegionInsights): InsightLine[] {
  const out: InsightLine[] = [];

  // Type is recorded for every row (survey: 100 %), so here — and only
  // here — the region's own count is the denominator.
  if (i.readAt && i.spots >= INSIGHT_MIN_KNOWN) {
    const present = INSIGHT_SPOT_TYPES.filter((t) => i.types[t] > 0);
    const sum = present.reduce((acc, t) => acc + i.types[t], 0);
    if (sum === i.spots && present.length > 0) {
      const text =
        present.length === 1
          ? `All ${n(i.spots)} sites we list in ${i.region} are ${TYPE_WORDS[present[0]][1]}.`
          : `Of the ${n(i.spots)} sites we list in ${i.region}, ${list(
              present.map((t) =>
                i.types[t] === 1
                  ? `1 is ${TYPE_WORDS[t][0]}`
                  : `${n(i.types[t])} are ${TYPE_WORDS[t][1]}`,
              ),
            )}.`;
      out.push({ key: 'types', text, asOf: i.readAt });
    }
  }

  if (i.readAt) {
    for (const k of INSIGHT_AMENITIES) {
      const { yes, no } = i.amenities[k];
      const known = yes + no;
      if (known < INSIGHT_MIN_KNOWN) continue;
      const w = AMENITY_WORDS[k];
      const head = `Of the ${n(known)} sites where OpenStreetMap records ${w.records}, `;
      const tail =
        no === 0
          ? `all ${n(known)} have ${w.it}.`
          : yes === 0
            ? `none has ${w.it}.`
            : `${yes === 1 ? '1 has' : `${n(yes)} have`} ${w.it} and ${
                no === 1 ? '1 does not' : `${n(no)} do not`
              }.`;
      out.push({ key: k, text: head + tail, asOf: i.readAt });
    }
  }

  const s = i.surroundings;
  if (s.computedAt) {
    const computed = 'sites whose surroundings we have computed';
    if (s.supermarket.known >= INSIGHT_MIN_KNOWN) {
      out.push({
        key: 'supermarket',
        text: `A supermarket is within 2 km for ${n(s.supermarket.within)} of the ${n(
          s.supermarket.known,
        )} ${computed}.`,
        asOf: s.computedAt,
      });
    }
    if (s.station.known >= INSIGHT_MIN_KNOWN) {
      out.push({
        key: 'station',
        text: `A railway stop is within 2 km for ${n(s.station.within)} of the ${n(
          s.station.known,
        )} ${computed}.`,
        asOf: s.computedAt,
      });
    }
    const top = s.water.top;
    if (top && top.sites >= INSIGHT_MIN_KNOWN && top.sites <= s.water.named) {
      const span =
        top.nearestM === top.farthestM
          ? `${formatDistance(top.nearestM)} away`
          : `${formatDistance(top.nearestM)} to ${formatDistance(top.farthestM)} away`;
      out.push({
        key: 'water',
        text: `Of the ${n(s.water.named)} sites whose nearest water has a name in OpenStreetMap, for ${n(
          top.sites,
        )} it is ${top.name}, ${span}.`,
        asOf: s.computedAt,
      });
    }
  }

  return out;
}

/** `2026-10-16` → "16 October 2026". */
export const formatInsightDay = formatOvernightDay;
