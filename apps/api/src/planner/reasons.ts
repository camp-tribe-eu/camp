// CAMP-245: "why this one" — the reasons a campsite is offered for a night.
//
// A reason is NOT a sentence. It is a field, the value that field holds for
// THIS record, and the unit of the value; the sentence is built from those
// three by `textOf` and never the other way round. That is the format an
// assistant can quote ("river 346 m away") and a test can take apart
// (`field` + `value` + `unit` + `kind` + `name` are the machine part; `text`
// is a function of them, and a spec says so).
//
// 🔴 A REASON EXISTS ONLY FOR WHAT THIS RECORD HOLDS. An `unknown` is not a
// reason, positive ("allows dogs") or negative ("not recorded"): about the
// campsites where the field is blank we can say neither, and a list that
// printed the blank would be the explanation inventing a fact — worse than
// no explanation. A recorded `no` is not a reason either: it is what the
// ranking scored as nothing (scoring.ts: "a term that is zero is a reason
// that does not exist"), and this list says why a campsite was OFFERED. A
// campsite we hold only coordinates for therefore has NO reasons — the
// call returns an empty list, it does not make one up.
//
// 🔴 THE SOURCES ARE EXACTLY TWO, and a spec holds the line:
//   · the fields scoring.ts reads (electricity, greyWater, stars) —
//     `location` is the fourth and is NOT a reason: every record has it, so
//     it cannot tell a known campsite from one we know nothing about, and the
//     card says a coordinates-only record gets none. (How far a night lies
//     from the even split is already in the night, as `alongM` / `offsetM`.)
//   · the computed surroundings, `camping_spots.context`: water, supermarket,
//     railway station, town, each with its distance in metres.
// Nothing else. Weather, fires, drought and air are layers over an AREA, not
// fields of a record, and "less rain on day 3" said about a campsite would be
// a claim about the map. `dogFriendly` is in the data and is not here: the
// ranking does not read it, so "chosen because dogs are allowed" would not be
// true — it is a hard-constraint need (CAMP-246), reported in `Night.needs`.
//
// 🔴 `weighed` SAYS WHETHER THE RANKING USED IT. Electricity, grey water and
// stars are components of the score (when their weight is above zero);
// the surroundings are not read by scoring.ts at all. Both are facts about
// the campsite. Only the first kind is something the night was CHOSEN for, so
// an interface that writes "chosen because" may say it of `weighed: true`
// reasons alone, and must say "also nearby" of the rest.
//
// 🔴 EVERY SOURCE NAMES THE SNAPSHOT FIELD IT STANDS ON, and
// `loadMeasuredReasons()` — called by app.module.ts as it loads, like
// `loadMeasuredScoring()` — throws on one that coverage.snapshot.json does
// not hold. The context fields are measured there too (`context.water` …):
// NOT `water`, which in the snapshot is the amenity "drinking water at the
// campsite", a different thing with a different number.
//
// 🔴 WORDING. Distances are straight lines and say so, in the words
// route-services.tsx already uses ("180 m away in a straight line"). The
// text never says "nearest": for water the stored object is the planar-
// nearest one (context-sql.ts, CAMP-323), so "a lake 800 m away" is true and
// "the nearest lake" might not be.
//
// 🔴 A CONTEXT FACT IS A REASON ONLY WHEN IT IS CLOSE (NEAR_M). The context
// is stored for every campsite however far the feature is (a station 1 887 km
// off is in the table), so presence says nothing. The radii are a product
// choice, not a measurement, and sit in one table. They are NOT a copy of the
// campsite page's `setting.ts`, which scores "notable", not "close".
//
// 🔴 ONE BAD RECORD COSTS ONE REASON. A context that is not an object, a
// distance that is not a finite number, a kind we do not know: that feature
// gives no reason and the rest are untouched. Nothing here throws on data.

import * as measured from './coverage.snapshot.json';
import { AmenityKey, AmenityValue } from '../osm/tag-mapping';
import { formatDistance, WATER_LABEL, WaterKind } from '../osm/spot-context';
import { CoverageSnapshot, shareOf } from './coverage-snapshot';
import { amenityState } from './hard-constraints';
import { ComponentDef, STARS_NEUTRAL, starsValue } from './scoring';

export type ReasonUnit = 'm' | 'stars';

/** The machine part of a reason: everything the sentence is built from. */
export interface ReasonFacts {
  /** The record field it stands on: a key of coverage.snapshot.json. */
  field: string;
  /** What the record holds: `'yes'`, `4`, `346`. Never absent, never NaN. */
  value: string | number;
  /** The unit of `value`; null for a recorded state. */
  unit: ReasonUnit | null;
  /** Water only: the kind the record holds. */
  kind?: WaterKind;
  /** The feature's own name, when the record holds one. */
  name?: string;
}

export interface Reason extends ReasonFacts {
  /** Whether scoring.ts weighed this field in the ranking (see above). */
  weighed: boolean;
  /** Built from the facts by `textOf`. */
  text: string;
}

/** What a reason is read from. `context` is the raw column: untrusted. */
export interface ReasonInput {
  amenities?: unknown;
  stars?: number | null;
  context?: unknown;
}

export interface ReasonSource {
  /** Key into the snapshot's `fields`: the input this reason stands on. */
  field: string;
  /** The facts this record gives, or undefined when it gives none. */
  read(input: ReasonInput): ReasonFacts | undefined;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Only a recorded `yes`: `no` and `unknown` give nothing to say. */
function amenity(field: string, key: AmenityKey): ReasonSource {
  return {
    field,
    read: (input) =>
      amenityState(input.amenities, key) === AmenityValue.YES
        ? { field, value: AmenityValue.YES, unit: null }
        : undefined,
  };
}

/**
 * Only a rating that scored ABOVE an unrated campsite. A missing rating
 * scores the middle of the scale (scoring.ts), so a 2-star campsite scored
 * below one we know nothing about and a 3-star one level with it: neither is
 * a reason it was offered. A rating outside 1-5 reads as absent, as there.
 */
function stars(field: string): ReasonSource {
  return {
    field,
    read: (input) =>
      starsValue(input.stars) > STARS_NEUTRAL
        ? { field, value: input.stars as number, unit: 'stars' }
        : undefined,
  };
}

const WATER_KINDS = Object.keys(WATER_LABEL) as WaterKind[];

/** How close counts as close, in metres. A choice, kept in one place. */
export const NEAR_M = {
  water: 1000,
  supermarket: 1000,
  station: 2000,
  town: 1000,
} as const;

export type ContextKey = keyof typeof NEAR_M;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/**
 * A distance we can say: a number of metres, not negative. NaN fails `>= 0`;
 * Infinity is turned away by the radius below, which is why there is no
 * second check for it here — two guards for one case hold each other up, and
 * a mutation of either would not show.
 */
const isMetres = (v: unknown): v is number => typeof v === 'number' && v >= 0;

function surrounding(field: string, key: ContextKey): ReasonSource {
  return {
    field,
    read: (input) => {
      if (!isRecord(input.context)) return undefined;
      const f = input.context[key];
      if (!isRecord(f) || !isMetres(f.m) || !(f.m < NEAR_M[key])) {
        return undefined;
      }
      const facts: ReasonFacts = { field, value: f.m, unit: 'm' };
      if (key === 'water') {
        // Without a kind we cannot say what is there: no reason, not "water".
        if (!WATER_KINDS.includes(f.kind as WaterKind)) return undefined;
        facts.kind = f.kind as WaterKind;
      }
      if (typeof f.name === 'string' && f.name.trim() !== '') {
        facts.name = f.name.trim();
      }
      return facts;
    },
  };
}

/**
 * The list, in the order reasons are returned: what the ranking weighed
 * first, then the surroundings. A fixed order, not the order a record's keys
 * happen to arrive in — one input, one output.
 */
export const REASON_SOURCES: readonly ReasonSource[] = Object.freeze([
  amenity('electricity', 'electricity'),
  amenity('greyWater', 'greyWater'),
  stars('stars'),
  surrounding('context.water', 'water'),
  surrounding('context.supermarket', 'supermarket'),
  surrounding('context.station', 'station'),
  surrounding('context.town', 'town'),
]);

/** The context keys the sources read, for the measuring script to count. */
export const CONTEXT_KEYS = Object.keys(NEAR_M) as ContextKey[];

// ---------------------------------------------------------------------------
// The sentence — a function of the facts, and of nothing else
// ---------------------------------------------------------------------------

const AMENITY_PHRASE: Record<string, string> = {
  electricity: 'electricity',
  greyWater: 'grey-water disposal',
};

const SURROUNDING_LABEL: Record<Exclude<ContextKey, 'water'>, string> = {
  supermarket: 'Supermarket',
  station: 'Railway station',
  town: 'Town',
};

const upperFirst = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** Own keys only: `'constructor' in {}` is true, and a field name is a string. */
const has = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

export function textOf(f: ReasonFacts): string {
  if (f.field === 'stars') {
    return `${f.value}-star official classification`;
  }
  if (has(AMENITY_PHRASE, f.field)) {
    return `Our database records ${AMENITY_PHRASE[f.field]} at this campsite`;
  }
  const key = f.field.startsWith('context.') ? f.field.slice(8) : '';
  if (has(NEAR_M, key)) {
    const label =
      key === 'water'
        ? upperFirst(WATER_LABEL[f.kind as WaterKind])
        : SURROUNDING_LABEL[key as Exclude<ContextKey, 'water'>];
    return (
      label +
      (f.name ? ` (${f.name})` : '') +
      ` ${formatDistance(Math.round(f.value as number))}` +
      ' away in a straight line'
    );
  }
  // A source with no sentence is a programming error, not a record's.
  throw new Error(`CAMP-245: no wording for reason field "${f.field}"`);
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/** Everything wrong with a list of sources against a measured table. Empty means usable. */
export function checkReasons(
  sources: readonly ReasonSource[],
  snapshot: CoverageSnapshot,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.field)) problems.push(`${s.field}: listed twice`);
    seen.add(s.field);
    // Not measured is NOT "fine": a reason that stands on a field nobody
    // counted says nothing about how often it can be said.
    if (shareOf(snapshot, s.field) === undefined) {
      problems.push(`${s.field}: field is not in the coverage snapshot`);
    }
  }
  return problems;
}

export interface MeasuredReason extends ReasonSource {
  /** known / n, from the snapshot. */
  coverage: number;
}

export interface ReasonsConfig {
  sources: readonly MeasuredReason[];
  measuredAt: string;
}

/** Throws when a source stands on a field the measured table does not hold. */
export function loadReasons(
  sources: readonly ReasonSource[],
  snapshot: CoverageSnapshot,
): ReasonsConfig {
  const problems = checkReasons(sources, snapshot);
  if (problems.length) {
    throw new Error(
      `CAMP-245 reasons refuse to load:\n  ${problems.join('\n  ')}\n` +
        `(coverage measured ${snapshot.measuredAt}; re-measure with ` +
        `src/planner/measure-coverage.ts --write)`,
    );
  }
  return {
    measuredAt: snapshot.measuredAt,
    sources: Object.freeze(
      sources.map((s) => ({
        ...s,
        coverage: shareOf(snapshot, s.field) as number,
      })),
    ),
  };
}

/**
 * The shipped sources against the shipped table. Throws when they disagree.
 * Called by app.module.ts as it loads: the API refuses to START with a reason
 * that stands on a field nobody measured.
 */
export function loadMeasuredReasons(): ReasonsConfig {
  return loadReasons(REASON_SOURCES, measured as unknown as CoverageSnapshot);
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/**
 * The reasons for one record: empty when it holds nothing to say, never a
 * guess. `components` are the weights the ranking ran with, so `weighed`
 * follows the formula that was actually used.
 */
export function reasonsOf(
  input: ReasonInput,
  reasons: ReasonsConfig,
  components: readonly ComponentDef[],
): Reason[] {
  const out: Reason[] = [];
  for (const s of reasons.sources) {
    const facts = s.read(input);
    if (!facts) continue;
    out.push({
      ...facts,
      weighed: components.some((c) => c.field === s.field && c.weight > 0),
      text: textOf(facts),
    });
  }
  return out;
}
