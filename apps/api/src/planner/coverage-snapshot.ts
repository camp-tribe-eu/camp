// CAMP-262: the measured table of how much of each scoring input we
// actually know, and the arithmetic done on it.
//
// 🔴 THE NUMBERS IN `coverage.snapshot.json` ARE NEVER TYPED. The file is
// the output of `measure-coverage.ts --write`, and `queryHash` ties it to
// the exact SQL that produced it: edit the SQL without re-measuring and
// the spec fails; edit a number by hand and `measure-coverage.ts --check`
// (which re-measures a live database) fails.
//
// This module is pure — no database, no `pg` — so the scoring module can
// read the snapshot at start-up without dragging a driver in.

/** What one input looks like across the planner's population. */
export interface FieldCoverage {
  /** Rows where we know SOMETHING about this input (amenity: yes or no). */
  known: number;
  /** Amenities only: rows where the answer is `yes`. */
  yes?: number;
}

export interface CoverageSnapshot {
  /** The database's own clock, when the measurement ran. */
  measuredAt: string;
  population: { n: number };
  /** sha256 of every SQL text the measurement ran. See `measure-coverage.ts`. */
  queryHash: string;
  fields: Record<string, FieldCoverage>;
  /** Measured facts that are not coverage but that a design choice rests on. */
  evidence: {
    /** Mean of the star rating over the rows that have one. */
    starsMean: number;
    /** Rows whose OWN column holds a rating, before reading through links. */
    starsOwnRow: number;
    /** Rows with a star rating, per country code the source uses. */
    starsKnownByCountry: Record<string, number>;
  };
}

/**
 * CAMP-260's line: below this a field says nothing about most of the
 * population, so it may not carry a large weight (scoring.ts) or a hard
 * filter (CAMP-246).
 */
export const COVERAGE_FLOOR = 0.5;

/**
 * Share of the population we know this input for, 0..1.
 * `undefined` for an input nobody measured — NOT 0 and NOT 1, because both
 * would answer a question the table cannot.
 */
export function shareOf(
  snapshot: CoverageSnapshot,
  field: string,
): number | undefined {
  const f = snapshot.fields[field];
  const n = snapshot.population?.n;
  if (!f || !Number.isFinite(f.known) || !Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return f.known / n;
}

/** How far a live re-measurement may drift from the committed one. */
export const DRIFT = {
  /** Absolute share. Imports move the table by tenths of a point a week. */
  share: 0.01,
  /** Relative population size. */
  population: 0.1,
};

/**
 * What a live measurement says that the committed snapshot no longer does.
 * Empty means "still true". A field crossing COVERAGE_FLOOR is reported
 * whatever its distance, because that is the line the weights are held to.
 */
export function driftOf(
  saved: CoverageSnapshot,
  live: CoverageSnapshot,
): string[] {
  const out: string[] = [];
  const nSaved = saved.population.n;
  const nLive = live.population.n;
  if (Math.abs(nLive - nSaved) / nSaved > DRIFT.population) {
    out.push(`population ${nSaved} -> ${nLive}`);
  }
  for (const field of new Set([
    ...Object.keys(saved.fields),
    ...Object.keys(live.fields),
  ])) {
    const a = shareOf(saved, field);
    const b = shareOf(live, field);
    if (a === undefined || b === undefined) {
      out.push(`${field}: measured on one side only`);
      continue;
    }
    const crossed = a < COVERAGE_FLOOR !== b < COVERAGE_FLOOR;
    if (crossed || Math.abs(a - b) > DRIFT.share) {
      out.push(
        `${field}: ${(a * 100).toFixed(2)}% -> ${(b * 100).toFixed(2)}%` +
          (crossed ? ` (crossed ${COVERAGE_FLOOR * 100}%)` : ''),
      );
    }
  }
  return out;
}
