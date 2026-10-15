// CAMP-262: the planner's scoring formula — the ONE file that holds it.
//
//   score = sum over COMPONENTS of weight · value, each value in 0..1:
//           distance_fit   how close to the stop the day's leg asks for
//           electricity    1 for a recorded `yes`, else 0
//           greyWater      1 for a recorded `yes`, else 0
//           stars          the official classification, 1-5, centred
//
// The weights live in COMPONENTS below and nowhere else — not in this
// comment either, because a copy of them here is a second list that no
// test reads.
//
// WHAT THIS RANKS BY, in the sentence the interface may say (CAMP-245):
// how close a campsite is to the stop the day's leg asks for, with a small
// lift for a recorded electric hook-up, a recorded dump point and an
// official star classification. It does NOT rank "by quality".
//
// 🔴 WHY THE FORMULA IS SMALL. The version in CAMP-6 and CAMP-46 weighed a
// rating at 0.4, a landscape score at 0.3, a visit-count figure at 0.2 and
// the distance fit at 0.1. Ninety per cent of that weight sat on inputs we
// do not have: the second and third exist nowhere in the database or the
// code, and the rating is known for a small fraction of the campsites. Run
// as written it ranks by distance alone while the page says "chosen for
// quality". Variant A (the owner's decision) rewrites the formula to what
// we can measure.
//
// 🔴 THE RULE, enforced when the API STARTS: an input known for fewer than
// COVERAGE_FLOOR of the campsites may not carry more than
// LOW_COVERAGE_MAX_WEIGHT. `loadMeasuredScoring()` throws, and app.module.ts
// calls it as it loads. A warning is a line in a log nobody reads while a
// weight of 0.4 on a 3% field ranks the other 97% by what we do not know
// about them.
//
// 🔴 WHY THE THROW IS NOT AT THE TOP OF THIS FILE. It was: `SCORING` was
// built at import, so a weight the data cannot carry stopped every suite that
// so much as imported the formula. Measured 15.10.2026, stars 0.05 -> 0.4:
// 3 suites and 60 of 1 925 tests never started, and the one real assertion
// left (startup.spec.ts) only checked that no error was thrown, not which.
// "Failed to run" prints the same as "caught", so nothing showed that the
// refusal was the one that was meant. Now this module only DEFINES the
// formula and the check; the specs call the check and read its message, and
// the rest of the suite runs on whatever weights it is given.
//
// 🔴 THE COVERAGE IS NOT TYPED HERE. Each weight below names the field it
// stands on, and the percentage next to it comes from coverage.snapshot.json
// — the output of measure-coverage.ts. `describeScoring()` prints the two
// side by side:
//
//   npx ts-node src/planner/scoring.ts
//
// A percentage typed into a comment becomes the specification and quietly
// ages; this one cannot, because there is nothing here to age.
//
// 🔴 ABSENT IS NOT BAD (the card's own words), and it is built in, not
// promised:
//
//   · an amenity bonus is for `yes` only. `no` and `unknown` score the
//     same, zero: a missing hook-up is not a defect unless the reader
//     asked for one, and that is a FILTER (CAMP-246), not a score.
//   · a missing star rating scores the MIDDLE of the scale, neither the
//     bottom nor the top. Zero for absent would sink every campsite we
//     simply know nothing about below every rated one. The middle is not
//     arbitrary: `evidence.starsMean` in the snapshot is the measured mean
//     of the ratings we do have, and a spec fails if it drifts away from
//     it — which is what keeps an unrated campsite level with the average
//     rated one instead of ahead or behind.
//
// 🔴 WHAT IS DELIBERATELY NOT HERE, and why (each of these was proposed):
//   · the landscape score and the visit-count figure — no column, and no
//     definition anywhere of what the number would be or where it would
//     come from. Not inventable.
//   · fit for the vehicle's size (CAMP-247/251) — no data on pitch sizes.
//   · freshness (CAMP-256) — `last_seen_at` is the stamp of the import
//     run, identical for every row that run touched. It says when WE
//     looked, not how old the OSM record is, so it cannot tell two
//     campsites apart. CAMP-256's field does not exist yet.
//   · price, elevation, record completeness — price and elevation are
//     known for a few per cent; "completeness" ranks by how much we know,
//     which is the thing this card forbids.
//
// 🔴 `stars` IS THE FRENCH OFFICIAL CLASSIFICATION (DATAtourisme), not a
// visitor rating, and the snapshot says where it exists
// (`evidence.starsKnownByCountry`). A bonus that nearly one country has
// would tilt every cross-border route toward it by the size of the bonus,
// unless a missing rating sits level with the average rated one — which is
// what centring on the measured mean does. At today's small weight the
// difference that makes to a border query's top twenty was measured (in the
// CAMP-262 pull request) at a campsite or none, so this guards the design
// against the day the weight is raised; it is not a visible correction now.

import * as measured from './coverage.snapshot.json';
import { AmenityKey, AmenityValue } from '../osm/tag-mapping';
import { COVERAGE_FLOOR, CoverageSnapshot, shareOf } from './coverage-snapshot';

/** An input known for less than COVERAGE_FLOOR may not weigh more than this. */
export const LOW_COVERAGE_MAX_WEIGHT = 0.1;

export type ComponentId =
  'distance_fit' | 'electricity' | 'greyWater' | 'stars';

export interface ComponentDef {
  id: ComponentId;
  weight: number;
  /** Key into the snapshot's `fields`: the input this weight stands on. */
  field: string;
}

/**
 * The weights. They sum to 1, so a score is 0..1 — but note that a
 * campsite we know nothing about, standing exactly on the target, scores
 * the distance weight alone. A score is a ranking key, not a percentage,
 * and must not be shown as one.
 */
export const COMPONENTS: readonly ComponentDef[] = Object.freeze([
  { id: 'distance_fit', weight: 0.75, field: 'location' },
  { id: 'electricity', weight: 0.1, field: 'electricity' },
  { id: 'greyWater', weight: 0.1, field: 'greyWater' },
  { id: 'stars', weight: 0.05, field: 'stars' },
]);

/**
 * Everything wrong with a set of weights against a measured table.
 * Empty means usable. Pure, so a spec can hand it any table it likes.
 */
export function checkScoring(
  components: readonly ComponentDef[],
  snapshot: CoverageSnapshot,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let sum = 0;
  for (const c of components) {
    if (seen.has(c.id)) problems.push(`${c.id}: listed twice`);
    seen.add(c.id);
    if (!Number.isFinite(c.weight) || c.weight < 0) {
      problems.push(`${c.id}: weight ${c.weight} is not a number >= 0`);
      continue;
    }
    sum += c.weight;
    const share = shareOf(snapshot, c.field);
    if (share === undefined) {
      // Not measured is NOT "fine". The only honest reading of a field
      // nobody counted is that we do not know how well we know it.
      problems.push(
        `${c.id}: field "${c.field}" is not in the coverage snapshot`,
      );
      continue;
    }
    if (share < COVERAGE_FLOOR && c.weight > LOW_COVERAGE_MAX_WEIGHT) {
      problems.push(
        `${c.id}: weight ${c.weight} on "${c.field}", known for only ` +
          `${(share * 100).toFixed(1)}% (< ${COVERAGE_FLOOR * 100}%), ` +
          `may not exceed ${LOW_COVERAGE_MAX_WEIGHT}`,
      );
    }
  }
  if (Math.abs(sum - 1) > 1e-9) {
    problems.push(`weights sum to ${sum}, not 1`);
  }
  return problems;
}

export interface MeasuredComponent extends ComponentDef {
  /** known / n, from the snapshot. */
  coverage: number;
  known: number;
  n: number;
}

export interface ScoringConfig {
  components: readonly MeasuredComponent[];
  measuredAt: string;
}

/** Throws when the weights and the measured table disagree. */
export function loadScoring(
  components: readonly ComponentDef[],
  snapshot: CoverageSnapshot,
): ScoringConfig {
  const problems = checkScoring(components, snapshot);
  if (problems.length) {
    throw new Error(
      `CAMP-262 scoring refuses to load:\n  ${problems.join('\n  ')}\n` +
        `(coverage measured ${snapshot.measuredAt}; re-measure with ` +
        `src/planner/measure-coverage.ts --write)`,
    );
  }
  return {
    measuredAt: snapshot.measuredAt,
    components: Object.freeze(
      components.map((c) => ({
        ...c,
        coverage: shareOf(snapshot, c.field),
        known: snapshot.fields[c.field].known,
        n: snapshot.population.n,
      })),
    ),
  };
}

/**
 * The shipped weights against the shipped table. Throws when they disagree.
 *
 * 🔴 Called by app.module.ts as it loads, not on first use: the API refuses
 * to START with a weight the data cannot carry, instead of ranking wrongly
 * until somebody looks. `startup.spec.ts` fails if that call is removed.
 */
export function loadMeasuredScoring(): ScoringConfig {
  return loadScoring(COMPONENTS, measured as unknown as CoverageSnapshot);
}

// ---------------------------------------------------------------------------
// The inputs, each mapped to 0..1
// ---------------------------------------------------------------------------

/** What a missing rating scores: the middle of the 1-5 scale. */
export const STARS_NEUTRAL = 0.5;

/**
 * 1 star -> 0, 3 -> 0.5, 5 -> 1; absent -> STARS_NEUTRAL.
 *
 * A value outside the scale is treated as ABSENT, not as an error: the
 * column has a CHECK for it, but a score that throws on one bad row costs
 * the whole ranking one campsite's mistake.
 */
export function starsValue(stars: number | null | undefined): number {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return STARS_NEUTRAL;
  }
  return (stars - 1) / 4;
}

/**
 * 1 on the target, falling in a straight line to 0 at `toleranceM`.
 * `distanceM` is METRES — straight-line from the target stop; the caller
 * measures it with `ST_Distance` on `geography`, which is metres, and not
 * on `geometry`, which is degrees.
 *
 * A distance that is not a number scores 0: a campsite we cannot place is
 * not one to suggest, and NaN would also make every comparison false and
 * the sort order undefined.
 */
export function distanceFit(distanceM: number, toleranceM: number): number {
  if (!(toleranceM > 0) || !Number.isFinite(toleranceM)) {
    throw new Error(`toleranceM must be a positive number, got ${toleranceM}`);
  }
  if (!Number.isFinite(distanceM) || distanceM < 0) return 0;
  return Math.max(0, 1 - distanceM / toleranceM);
}

/** `yes` is a bonus; `no` and `unknown` are the same nothing. */
const yes = (v: unknown): number => (v === AmenityValue.YES ? 1 : 0);

export interface Candidate {
  /** Tie-break, so one input always gives one order. */
  slug: string;
  distanceM: number;
  amenities?: Partial<Record<AmenityKey, string>>;
  /** As the PAGE reads it: through the link to the secondary row. */
  stars?: number | null;
}

const VALUE: Record<ComponentId, (c: Candidate, toleranceM: number) => number> =
  {
    distance_fit: (c, tol) => distanceFit(c.distanceM, tol),
    electricity: (c) => yes(c.amenities?.electricity),
    greyWater: (c) => yes(c.amenities?.greyWater),
    stars: (c) => starsValue(c.stars),
  };

/**
 * Each component's contribution, weight included. This is the shape
 * CAMP-245 ("why this one") reads: every reason is a term, and a term that
 * is zero is a reason that does not exist.
 */
export function scoreParts(
  c: Candidate,
  toleranceM: number,
): Record<ComponentId, number> {
  const out = {} as Record<ComponentId, number>;
  for (const comp of COMPONENTS) {
    out[comp.id] = comp.weight * VALUE[comp.id](c, toleranceM);
  }
  return out;
}

/**
 * The score. `without` switches components off, which exists for one
 * reason: the ablation that asks whether a component changes anything.
 */
export function score(
  c: Candidate,
  toleranceM: number,
  without: readonly ComponentId[] = [],
): number {
  const parts = scoreParts(c, toleranceM);
  let total = 0;
  for (const comp of COMPONENTS) {
    if (!without.includes(comp.id)) total += parts[comp.id];
  }
  return total;
}

/** Best first. Equal scores order by slug, so two runs give one answer. */
export function rank(
  candidates: readonly Candidate[],
  toleranceM: number,
  without: readonly ComponentId[] = [],
): Candidate[] {
  const keyed = candidates.map((c) => ({
    c,
    s: score(c, toleranceM, without),
  }));
  keyed.sort(
    (a, b) =>
      b.s - a.s || (a.c.slug < b.c.slug ? -1 : a.c.slug > b.c.slug ? 1 : 0),
  );
  return keyed.map((k) => k.c);
}

/** The weights beside the coverage of the field each one stands on. */
export function describeScoring(
  config: ScoringConfig = loadMeasuredScoring(),
): string {
  const rows = config.components.map(
    (c) =>
      c.id.padEnd(14) +
      c.weight.toFixed(2).padStart(6) +
      '   ' +
      c.field.padEnd(13) +
      `${(c.coverage * 100).toFixed(1)}%`.padStart(7) +
      `   (${c.known} of ${c.n})`,
  );
  return [
    `Scoring weights against coverage measured ${config.measuredAt}`,
    'component'.padEnd(14) +
      'weight'.padStart(6) +
      '   ' +
      'input'.padEnd(13) +
      'known'.padStart(7),
    ...rows,
  ].join('\n');
}

// Guarded like every other script here: an import must not print.
if (require.main === module) {
  console.log(describeScoring());
}
