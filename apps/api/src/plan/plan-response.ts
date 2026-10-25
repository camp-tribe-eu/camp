// CAMP-391: what `POST /plan` answers, built from what the algorithm returned
// and from NOTHING ELSE.
//
// 🔴 A WHITELIST, NOT A PASS-THROUGH. `planItinerary()` returns an
// `ItineraryOutcome` and the obvious controller would hand it to the client
// as it came. That makes the public contract "whatever the algorithm's types
// say today": the day somebody adds a field there — a driving time, a score
// meant as a percentage — it is on the wire before anyone has decided it
// should be. Every field below is named here, copied here, and read back by a
// spec that walks the answer and fails on a key it does not know.
//
// 🔴 WHAT IS NOT HERE, and it is not an oversight (the card's own limits):
//
//   · no road distance and no time at the wheel. There is no router
//     (corridor.ts): `corridor-source.ts` hands out the straight line from A
//     to B. Every metre in this answer is along or beside THAT line, and the
//     answer says so with `measure: 'straight'` on the object that carries
//     the metres — the root, and each day with the night inside it — so a
//     consumer cannot read "87 km" without reading the word beside it. When a
//     router exists `Measure` gains `'road'` and the compiler finds every
//     place that has to say so.
//   · no `score`. It is "a ranking key, not a percentage" (scoring.ts) and a
//     number on the wire is a number somebody will print as one. What the
//     ranking used is said by `ranking`, and why THIS night by `reasons`.
//   · no `needs`. The entry takes none, so there is nothing to report about
//     them; a field that is always empty is a promise that it is sometimes not.
//   · no `reachM` for a refused band: the band is the entry's own choice
//     (plan-policy.ts), not something the caller asked for, and that refusal
//     cannot happen through it. If it ever does, `toPlanResponse` throws —
//     the same decision itinerary.ts makes about its own impossible branch —
//     rather than describing a limit the caller never set.
//
// 🔴 A NIGHT THAT CANNOT BE NAMED IS STILL A NIGHT. `name` and `path` come from
// one read of the table (plan.service.ts); a campsite OSM gave no name — about
// one in nine — has `name: null`, and the page says "unnamed", it does not
// invent one. One slug with no row in that read costs that night its name and
// its link, never the plan (the rule the whole planner follows: one bad record
// is one record).

import { AMENITY_KEYS, AmenityValue } from '../osm/tag-mapping';
import type { Measure } from '../planner/corridor';
import { amenityState } from '../planner/hard-constraints';
import type { ItineraryOutcome, Night } from '../planner/itinerary';
import type { Reason } from '../planner/reasons';
import type { ComponentId } from '../planner/scoring';

/** One term of the ranking, and how much of it that term is. */
export interface PlanRankingTerm {
  id: ComponentId;
  /** 0..1; the terms sum to 1. */
  weight: number;
}

/**
 * Who gave us this record and when — only the two facts a licence asks us to
 * print beside it. `id` is a key of the web's source registry (`osm`,
 * `datatourisme`); `updatedAt` is that source's date, an ISO day.
 */
export interface PlanSource {
  id: string;
  updatedAt: string;
}

export interface PlanNight {
  slug: string;
  /** From the record; `null` when OSM has none. */
  name: string | null;
  country: string;
  /** The campsite's own page on this site; `null` when it has none to link. */
  path: string | null;
  lat: number;
  lon: number;
  /** Metres from A along the straight line to B. */
  alongM: number;
  /** Metres from that line, straight. */
  offsetM: number;
  /** Where day N was asked to end: metres from A along the line. */
  targetAlongM: number;
  /** Straight line from that point to this campsite: what the ranking mostly weighed. */
  fromTargetM: number;
  /** Recorded amenities only. A key is absent when nothing is recorded. */
  amenities: Record<string, string>;
  stars: number | null;
  reasons: Reason[];
  /**
   * 🔴 THE ATTRIBUTION OF THE RECORD. The official star classification is
   * DATAtourisme's (Licence Ouverte 2.0), which requires the source AND the
   * date the information was last updated to travel with it, and the route
   * pages already print both per record. A plan that shows a record's stars
   * and not where they came from would be the one page on the site that does
   * not.
   */
  sources: PlanSource[];
}

export interface PlanDay {
  /** 1..D. */
  day: number;
  /** Metres along the straight line, from where the day starts to where it ends. */
  runM: number;
  measure: Measure;
  /** Where the day ends; `null` on the last day, which ends at B. */
  night: PlanNight | null;
}

export type PlanResponse =
  | {
      status: 'ok';
      measure: Measure;
      /** A to B, in metres of `measure`. */
      lengthM: number;
      /** Campsites the corridor kept: what the nights were chosen from. */
      candidates: number;
      /** What a night was ranked by. */
      ranking: PlanRankingTerm[];
      days: PlanDay[];
    }
  | {
      /** The campsites do not chain across the corridor. Nothing is invented to fill the gap. */
      status: 'infeasible';
      reason: 'no-chain';
      measure: Measure;
      lengthM: number;
      daysAsked: number;
      candidates: number;
      /** Nights that could be placed from A before the chain ran out. */
      reachedNights: number;
    }
  | {
      /** A and B are one place: a round trip has no direction to cut. */
      status: 'unsupported';
      reason: 'round-trip';
    };

/** What the table says about a campsite the plan chose. */
export interface Place {
  name: string | null;
  path: string | null;
  /** The raw column. Untrusted: read by `sourcesOf`, one entry at a time. */
  sources?: unknown;
}

/**
 * Only what the record SAYS: a `yes` or a `no`. The stored set may also hold
 * the word `unknown` or a key nobody wrote, and both read as "nothing recorded"
 * (`amenityState`), which is the key being absent here — an absent key is not
 * a denial, and the page says "not recorded", never "no".
 */
function recorded(amenities: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of AMENITY_KEYS) {
    const state = amenityState(amenities, key);
    if (state !== AmenityValue.UNKNOWN) out[key] = state;
  }
  return out;
}

/**
 * The entries of the `sources` column that say who and when. One entry that
 * does not (an id that is not text, a date that is missing) costs that entry,
 * never the night or the plan.
 */
function sourcesOf(raw: unknown): PlanSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e: unknown) => {
    if (typeof e !== 'object' || e === null) return [];
    const { id, updatedAt } = e as Record<string, unknown>;
    return typeof id === 'string' &&
      id !== '' &&
      typeof updatedAt === 'string' &&
      updatedAt !== ''
      ? [{ id, updatedAt }]
      : [];
  });
}

const reasonOf = (r: Reason): Reason => ({
  field: r.field,
  value: r.value,
  unit: r.unit,
  ...(r.kind !== undefined ? { kind: r.kind } : {}),
  ...(r.name !== undefined ? { name: r.name } : {}),
  weighed: r.weighed,
  text: r.text,
});

function nightOf(n: Night, place: Place | undefined): PlanNight {
  return {
    slug: n.slug,
    name: place?.name ?? null,
    country: n.country,
    path: place?.path ?? null,
    lat: n.lat,
    lon: n.lon,
    alongM: n.alongM,
    offsetM: n.offsetM,
    targetAlongM: n.targetAlongM,
    fromTargetM: n.fromTargetM,
    amenities: recorded(n.amenities),
    stars: n.stars,
    reasons: n.reasons.map(reasonOf),
    sources: sourcesOf(place?.sources),
  };
}

export function toPlanResponse(
  outcome: ItineraryOutcome,
  places: ReadonlyMap<string, Place>,
  ranking: readonly PlanRankingTerm[],
): PlanResponse {
  switch (outcome.status) {
    case 'ok':
      return {
        status: 'ok',
        measure: outcome.measure,
        lengthM: outcome.lengthM,
        candidates: outcome.candidates,
        ranking: ranking.map((t) => ({ id: t.id, weight: t.weight })),
        days: outcome.days.map((d) => ({
          day: d.day,
          runM: d.runM,
          measure: d.measure,
          night: d.night ? nightOf(d.night, places.get(d.night.slug)) : null,
        })),
      };
    case 'infeasible':
      if (outcome.reason === 'band') {
        throw new Error(
          'plan: the band refused a corridor, but the entry derives the band from the corridor and it fits any',
        );
      }
      return {
        status: 'infeasible',
        reason: 'no-chain',
        measure: outcome.measure,
        lengthM: outcome.lengthM,
        daysAsked: outcome.daysAsked,
        candidates: outcome.candidates,
        reachedNights: outcome.reachedNights,
      };
    case 'unsupported':
      return { status: 'unsupported', reason: 'round-trip' };
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}
