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
// 🔴 AND THE UNKNOWN ARE COUNTED TOO, IN THE SAME SENTENCE. "Of the 6
// sites where OpenStreetMap records whether there are toilets, all 6 have
// them" is honest about its 6 and silent about the 105 other sites of
// Greater Poland — and a reader finishes the sentence for us as "toilets
// everywhere". Review measured 57 regions like it. So whenever known <
// spots the sentence ends with the number nobody has recorded: not a
// percentage, not "no data" — the number.
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

/** The words of SPOT_TYPE_LABEL, as a list needs them. */
const TYPE_WORDS: Record<InsightSpotType, [string, string]> = {
  paid: ['paid campsite', 'paid campsites'],
  rv_park: ['motorhome park', 'motorhome parks'],
  camper_stop: ['camper stop', 'camper stops'],
  free: ['free campsite', 'free campsites'],
  wild: ['wild camping spot', 'wild camping spots'],
};

const AMENITY_WORDS: Record<InsightAmenity, { label: string; it: string }> = {
  electricity: { label: 'Electricity', it: 'it' },
  toilets: { label: 'Toilets', it: 'them' },
  shower: { label: 'Showers', it: 'them' },
};

const SURROUNDINGS_KEYS = new Set(['supermarket', 'station', 'water']);

/**
 * The lines, in reading order, SHORT: the block's intro says how the
 * counting works once, and the date is said once at the foot
 * (`regionInsightDates`), so a line carries its label and its numbers and
 * nothing else. Review measured the first wording at 117–169 characters a
 * line, six of them on the same frame with the same date three times over.
 *
 * Each is printed only when the figure it rests on has at least
 * INSIGHT_MIN_KNOWN known values AND a day to be read as of; a region with
 * fewer gets no line for it, and a region with none gets an empty list and
 * no block.
 *
 * 🔴 EACH AMENITY KEEPS ITS OWN NUMBER OF UNRECORDED SITES. 96, 105 and
 * 104 are three different numbers; one shared "the rest of the 111" would
 * be tidier and false. The counted context is the one thing here a
 * competitor does not have, and it is worth exactly its precision.
 */
export function regionInsightLines(i: RegionInsights): InsightLine[] {
  const out: InsightLine[] = [];

  // Type is recorded for every row (survey: 100 %), so here — and only
  // here — the region's own count is the denominator.
  if (i.readAt && i.spots >= INSIGHT_MIN_KNOWN) {
    const present = INSIGHT_SPOT_TYPES.filter((t) => i.types[t] > 0);
    const sum = present.reduce((acc, t) => acc + i.types[t], 0);
    if (sum === i.spots && present.length > 0) {
      const parts = present.map(
        (t) => `${n(i.types[t])} ${TYPE_WORDS[t][i.types[t] === 1 ? 0 : 1]}`,
      );
      const text =
        present.length === 1
          ? `${n(i.spots)} sites, all ${TYPE_WORDS[present[0]][1]}.`
          : `${n(i.spots)} sites: ${parts.join(', ')}.`;
      out.push({ key: 'types', text, asOf: i.readAt });
    }
  }

  if (i.readAt) {
    for (const k of INSIGHT_AMENITIES) {
      const { yes, no } = i.amenities[k];
      const known = yes + no;
      if (known < INSIGHT_MIN_KNOWN) continue;
      const w = AMENITY_WORDS[k];
      const where = `of the ${n(known)} sites where this is recorded`;
      const answer =
        no === 0
          ? `all ${n(known)} ${where}`
          : yes === 0
            ? `none ${where}`
            : `${n(yes)} ${where} ${yes === 1 ? 'has' : 'have'} ${w.it}, ${n(no)} ${
                no === 1 ? 'does' : 'do'
              } not`;
      const unknown = i.spots - known;
      const rest =
        unknown <= 0
          ? ''
          : unknown === 1
            ? '; 1 site has no record'
            : `; ${n(unknown)} sites have no record`;
      out.push({ key: k, text: `${w.label} — ${answer}${rest}.`, asOf: i.readAt });
    }
  }

  const s = i.surroundings;
  if (s.computedAt) {
    const computed = 'sites with computed surroundings';
    if (s.supermarket.known >= INSIGHT_MIN_KNOWN) {
      out.push({
        key: 'supermarket',
        text: `Supermarket within 2 km — ${n(s.supermarket.within)} of the ${n(
          s.supermarket.known,
        )} ${computed}.`,
        asOf: s.computedAt,
      });
    }
    if (s.station.known >= INSIGHT_MIN_KNOWN) {
      out.push({
        key: 'station',
        text: `Railway stop within 2 km — ${n(s.station.within)} of the ${n(
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
        text: `Nearest named water — ${top.name} for ${n(top.sites)} of the ${n(
          s.water.named,
        )} sites whose nearest water has a name, ${span}.`,
        asOf: s.computedAt,
      });
    }
  }

  return out;
}

/**
 * The one date line under the block. Two readings can stand behind it —
 * the OSM tags (`readAt`) and the computed surroundings (`computedAt`) —
 * and each is named only if a printed line rests on it. Review checked
 * that both are single per region, so this is at most two dates, once.
 */
export function regionInsightDates(lines: readonly InsightLine[]): string | null {
  const tags = lines.find((l) => !SURROUNDINGS_KEYS.has(l.key))?.asOf ?? null;
  const computed = lines.find((l) => SURROUNDINGS_KEYS.has(l.key))?.asOf ?? null;
  if (tags && computed && tags !== computed) {
    return `Counted as of ${formatInsightDay(tags)}; surroundings computed ${formatInsightDay(computed)}.`;
  }
  if (tags) return `Counted as of ${formatInsightDay(tags)}.`;
  if (computed) return `Surroundings computed ${formatInsightDay(computed)}.`;
  return null;
}

/** `2026-10-16` → "16 October 2026". */
export const formatInsightDay = formatOvernightDay;
