// CAMP-246 / CAMP-260: STAGE 1 of the planner — what a campsite may be
// REJECTED for, before any score exists.
//
// Two stages, in this order and no other (docs/trip-planner-design.md, Г.1):
//
//   1. HARD constraints (this file). A campsite that fails one is not in the
//      ranking at all — it does not sink in it. Otherwise a campsite that
//      cannot be used outranks one that can, on the strength of its view.
//   2. SOFT scoring (scoring.ts), on what is left.
//
// 🔴 THE RULE, and it runs against intuition: a hard constraint on an
// amenity rejects a RECORDED `no`, and never an `unknown`.
//
// "Must allow dogs" read as `dogFriendly = 'yes'` throws out every campsite
// nobody wrote the tag for: `fields.dogFriendly` in coverage.snapshot.json
// says how few that leaves. That is not choosy, it is an empty result that
// looks like a verdict on the campsites when it is a verdict on our data. So the
// constraint rejects the campsites that SAY they do not, keeps the ones we
// know nothing about, and the interface says "not recorded" beside them.
//
// 🔴 CAMP-260's line, held in code by `assertHardAllowed`: a rule that
// rejects BY VALUE — everything that is not X — may stand only on a field
// known for more than COVERAGE_FLOOR of the campsites. No amenity reaches
// it (the best, electricity, is known for about a third), so no amenity is a
// by-value rule; each is a `recorded-no` rule, which cannot reject what is
// not recorded and so needs no coverage.
//
// 🔴 WHAT IS DELIBERATELY NOT HERE, each of these was asked for:
//   · pitch or vehicle size — no data on pitch sizes exists (CAMP-247);
//   · time on the road — there is no router, and `days × 250 km` is an
//     estimate dressed as a calculation;
//   · budget — prices are known for a few per cent of the campsites, and
//     `type = 'paid'` is partly a default for "no fee tag" (tag-mapping.ts);
//   · stars — a French official classification, on a few per cent;
//   · season or opening dates — no column holds them, so there is nothing
//     known to reject on;
//   · overnight status — it reads the OSM `motorhome` tag only, so it is an
//     answer about one kind of vehicle, not about the campsite.
// Each would be a filter on our own blindness. Add one only with a measured
// field above the floor, and `assertHardAllowed` will say if it is not.

import * as measured from './coverage.snapshot.json';
import {
  EU_MEMBER_STATES_AND_SUBDIVISIONS,
  isEuMemberState,
  normaliseCountry,
} from '../osm/eu';
import { AMENITY_KEYS, AmenityKey, AmenityValue } from '../osm/tag-mapping';
import { COVERAGE_FLOOR, CoverageSnapshot, shareOf } from './coverage-snapshot';
import { plannerPopulationSql } from './population';

/** [longitude, latitude], degrees. GeoJSON's order, not the speech order. */
export type LonLat = readonly [lon: number, lat: number];

export interface HardRequest {
  /**
   * Where to look. One point is a disc of radius `bufferM` around it; two or
   * more are a corridor along the polyline, `bufferM` to either side. A
   * straight A→B line today; the road's geometry when a router exists —
   * nothing below changes when it does.
   */
  line: readonly LonLat[];
  /** Metres, to either side of the line (or the disc's radius). */
  bufferM: number;
  /**
   * Member states to stay in, as the EU spells them (`EL` for Greece is
   * accepted). Absent means the whole EU-27, which is the project's scope.
   */
  countries?: readonly string[];
  /**
   * Amenities the reader REQUIRES. Each rejects a recorded `no`; an
   * `unknown` passes and is marked as such in the result.
   */
  needs?: readonly AmenityKey[];
}

export interface SqlPart {
  /** A condition to AND onto a WHERE clause; empty when it asks nothing. */
  where: string;
  params: unknown[];
}

/**
 * What a rule may reject on:
 *  · `structural`  — a property of the row that is never unknown (a NOT NULL
 *                    column, a predicate over NOT NULL columns);
 *  · `recorded-no` — ONLY an explicit `no` of a three-state field;
 *  · `by-value`    — everything that is not X. Needs `field`, known for more
 *                    than COVERAGE_FLOOR of the campsites.
 */
export type RejectsOn = 'structural' | 'recorded-no' | 'by-value';

export interface HardRule {
  id: string;
  rejects: RejectsOn;
  /** `by-value` only: the key of the coverage snapshot it stands on. */
  field?: string;
  /** `next` is how many parameters the caller already holds. */
  sql(req: HardRequest, alias: string, next: number): SqlPart;
}

// ---------------------------------------------------------------------------
// The request, checked
// ---------------------------------------------------------------------------

const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Throws on a request that would make a rule quietly reject nothing or
 * everything: an amenity key that matches no column (`IS DISTINCT FROM 'no'`
 * is true for a key nobody has, so a typo would FILTER NOTHING and look like
 * a working filter), a country outside the scope, a line that is not a place.
 *
 * It throws because a request is not a record: it is one caller's mistake,
 * and answering it with an empty or unfiltered list would hide it.
 */
export function validateRequest(req: HardRequest): void {
  if (!Array.isArray(req.line) || req.line.length === 0) {
    throw new Error('line: at least one [lon, lat] point is needed');
  }
  for (const p of req.line) {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !finite(p[0]) ||
      !finite(p[1]) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) > 90
    ) {
      throw new Error(`line: ${JSON.stringify(p)} is not a [lon, lat] point`);
    }
  }
  if (!finite(req.bufferM) || req.bufferM <= 0) {
    throw new Error(`bufferM must be a positive number, got ${req.bufferM}`);
  }
  for (const k of req.needs ?? []) {
    if (!(AMENITY_KEYS as readonly string[]).includes(k)) {
      throw new Error(`needs: "${k}" is not an amenity we record`);
    }
  }
  for (const c of req.countries ?? []) {
    if (!isEuMemberState(c)) {
      throw new Error(`countries: "${c}" is not an EU member state`);
    }
  }
}

// ---------------------------------------------------------------------------
// page — the stop has to lead somewhere
// ---------------------------------------------------------------------------

const page: HardRule = {
  id: 'page',
  rejects: 'structural',
  // The one predicate the coverage table and the ablation already share.
  sql: (_req, alias) => ({ where: plannerPopulationSql(alias), params: [] }),
};

// ---------------------------------------------------------------------------
// country — the project's scope, or a narrower ask
// ---------------------------------------------------------------------------

/**
 * The codes the SOURCE writes for the countries asked for.
 *
 * 🔴 Not the member list alone. `camping_spots.country` carries 28 codes, not
 * 27: the 27 member states plus `AX` (Åland, which is Finland). A rule built
 * on the 27 rejects 19 Finnish campsites and exits 0 — a country that
 * disappears without a word. `EU_MEMBER_STATES_AND_SUBDIVISIONS` is the
 * list that has the 28th, and `normaliseCountry` is what says `ax` is `fi`
 * and `el` is `gr`.
 */
export function sourceCountryCodes(
  countries?: readonly string[],
): readonly string[] {
  if (!countries || countries.length === 0) {
    return EU_MEMBER_STATES_AND_SUBDIVISIONS;
  }
  const wanted = new Set(countries.map((c) => normaliseCountry(c)));
  return EU_MEMBER_STATES_AND_SUBDIVISIONS.filter((c) =>
    wanted.has(normaliseCountry(c)),
  );
}

const country: HardRule = {
  id: 'country',
  rejects: 'structural',
  sql: (req, alias, next) => ({
    // lower() on the column: the list is lower case, the table is not.
    where: `lower(${alias}.country) = ANY($${next + 1}::text[])`,
    params: [[...sourceCountryCodes(req.countries)]],
  }),
};

// ---------------------------------------------------------------------------
// corridor — geography
// ---------------------------------------------------------------------------

/**
 * Metres in a degree of latitude, rounded DOWN from the true 110 574 (at the
 * equator) .. 111 694 (at a pole). The box below is for the index only, and
 * a smaller figure makes a bigger box: the wrong direction to err in would
 * lose campsites the exact test would have kept.
 */
const M_PER_DEG = 110_000;

/**
 * A box that contains everything within `bufferM` of the line:
 * [xmin, ymin, xmax, ymax]. A prefilter for the gist index on `location`;
 * the exact distance is ST_DWithin's, and this must never be tighter than it.
 *
 * Longitude degrees shrink with latitude, so the width is taken at the
 * highest latitude the box reaches. Not meant for the antimeridian: the
 * scope is Europe.
 */
export function corridorBox(
  line: readonly LonLat[],
  bufferM: number,
): [number, number, number, number] {
  const lons = line.map((p) => p[0]);
  const lats = line.map((p) => p[1]);
  const dLat = bufferM / M_PER_DEG;
  const ymin = Math.max(-90, Math.min(...lats) - dLat);
  const ymax = Math.min(90, Math.max(...lats) + dLat);
  const worst = Math.min(89, Math.max(Math.abs(ymin), Math.abs(ymax)));
  const dLon = bufferM / (M_PER_DEG * Math.cos((worst * Math.PI) / 180));
  return [
    Math.max(-180, Math.min(...lons) - dLon),
    ymin,
    Math.min(180, Math.max(...lons) + dLon),
    ymax,
  ];
}

/**
 * The line as GeoJSON. Consecutive repeats are dropped, and a line that is
 * one place after that is a Point: a LineString of two equal points is a
 * degenerate shape that the geography functions treat as an error.
 */
export function lineGeoJson(line: readonly LonLat[]): string {
  const pts = line.filter(
    (p, i) => i === 0 || p[0] !== line[i - 1][0] || p[1] !== line[i - 1][1],
  );
  return JSON.stringify(
    pts.length === 1
      ? { type: 'Point', coordinates: pts[0] }
      : { type: 'LineString', coordinates: pts },
  );
}

const corridor: HardRule = {
  id: 'corridor',
  // Rejects by where the campsite IS, so it stands on `location`: the
  // snapshot says how well that is known, and `assertHardAllowed` asks.
  rejects: 'by-value',
  field: 'location',
  sql: (req, alias, next) => {
    const n = (i: number) => `$${next + i}`;
    return {
      // `&&` on the geometry column is what the gist index answers;
      // ST_DWithin on geography is the exact distance, in METRES.
      where:
        `${alias}.location && ST_MakeEnvelope(${n(1)}::float8, ${n(2)}::float8, ` +
        `${n(3)}::float8, ${n(4)}::float8, 4326) ` +
        `AND ST_DWithin(${alias}.location::geography, ` +
        `ST_SetSRID(ST_GeomFromGeoJSON(${n(5)}::text), 4326)::geography, ` +
        `${n(6)}::float8)`,
      params: [
        ...corridorBox(req.line, req.bufferM),
        lineGeoJson(req.line),
        req.bufferM,
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// needs — the amenities the reader requires. ONLY a recorded `no` rejects.
// ---------------------------------------------------------------------------

/**
 * The amenities as the reader sees them: the imported layer with the owner's
 * corrections on top (CAMP-28 — they win at read time). The two readers of
 * this — the rule and the candidate's own amenities — share this one
 * expression, so a campsite whose owner said "yes" is not rejected on an
 * imported "no" the owner has corrected.
 *
 * A correction that is not an object is ignored rather than trusted: one
 * malformed row costs that row its correction, never the query.
 */
export const effectiveAmenitiesSql = (alias: string): string =>
  `(CASE WHEN jsonb_typeof(${alias}.owner_overrides -> 'amenities') = 'object' ` +
  `THEN ${alias}.amenities || (${alias}.owner_overrides -> 'amenities') ` +
  `ELSE ${alias}.amenities END)`;

const needs: HardRule = {
  id: 'needs',
  rejects: 'recorded-no',
  sql: (req, alias, next) => {
    const keys = [...new Set(req.needs ?? [])];
    return {
      // 🔴 `IS DISTINCT FROM 'no'`, never `= 'yes'`. NULL (the key is not
      // there at all — a row written before the amenity existed, or a
      // French row that stores `{}`) IS DISTINCT FROM 'no', so it passes, as does
      // the word `unknown`. `= 'yes'` is the 96.7% empty result.
      where: keys
        .map(
          (_, i) =>
            `(${effectiveAmenitiesSql(alias)} ->> $${next + i + 1}) ` +
            `IS DISTINCT FROM '${AmenityValue.NO}'`,
        )
        .join(' AND '),
      params: keys,
    };
  },
};

/**
 * Everything that may reject a campsite, in one declared list. The order is
 * the order they are ANDed in, and a spec pins both the ids and the rule that
 * no rule rejects a campsite for being `unknown`.
 */
export const HARD: readonly HardRule[] = Object.freeze([
  page,
  country,
  corridor,
  needs,
]);

/** The rules ANDed into one WHERE fragment, parameters numbered from `next`+1. */
export function hardWhere(
  req: HardRequest,
  alias = 's',
  next = 0,
  rules: readonly HardRule[] = HARD,
): SqlPart {
  validateRequest(req);
  const wheres: string[] = [];
  const params: unknown[] = [];
  for (const rule of rules) {
    const part = rule.sql(req, alias, next + params.length);
    if (part.where) wheres.push(`(${part.where})`);
    params.push(...part.params);
  }
  return { where: wheres.length ? wheres.join(' AND ') : 'TRUE', params };
}

// ---------------------------------------------------------------------------
// The three states, read
// ---------------------------------------------------------------------------

/**
 * One amenity as the three-state value it is. A key that is missing, and a
 * value that is not one of the three words, are `unknown`: nobody recorded
 * an answer we can read, which is not the same as `no`.
 */
export function amenityState(
  amenities: unknown,
  key: AmenityKey,
): AmenityValue {
  if (typeof amenities !== 'object' || amenities === null) {
    return AmenityValue.UNKNOWN;
  }
  const v = (amenities as Record<string, unknown>)[key];
  return v === AmenityValue.YES || v === AmenityValue.NO
    ? v
    : AmenityValue.UNKNOWN;
}

/**
 * What a result says about each required amenity. `yes` or `unknown` is what
 * a result can carry: a `no` has already been rejected. The interface words
 * `unknown` as "not recorded" (CAMP-245); this is the fact it reads.
 */
export function needsOf(
  amenities: unknown,
  required: readonly AmenityKey[] = [],
): Array<{ key: AmenityKey; state: AmenityValue }> {
  return [...new Set(required)].map((key) => ({
    key,
    state: amenityState(amenities, key),
  }));
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/** Everything wrong with a list of rules against a measured table. Empty means usable. */
export function checkHard(
  rules: readonly HardRule[],
  snapshot: CoverageSnapshot,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.id)) problems.push(`${r.id}: listed twice`);
    seen.add(r.id);
    if (r.rejects !== 'by-value') continue;
    if (!r.field) {
      problems.push(`${r.id}: rejects by value but names no field`);
      continue;
    }
    const share = shareOf(snapshot, r.field);
    if (share === undefined) {
      // Not measured is NOT "fine": the only honest reading of a field
      // nobody counted is that we do not know how well we know it.
      problems.push(
        `${r.id}: field "${r.field}" is not in the coverage snapshot`,
      );
    } else if (share <= COVERAGE_FLOOR) {
      problems.push(
        `${r.id}: hard constraint on ${r.field}: known for only ` +
          `${(share * 100).toFixed(1)}% (<= ${COVERAGE_FLOOR * 100}%)`,
      );
    }
  }
  return problems;
}

/** Throws when a rule rejects by a value we mostly do not have. */
export function assertHardAllowed(
  snapshot: CoverageSnapshot,
  rules: readonly HardRule[] = HARD,
): void {
  const problems = checkHard(rules, snapshot);
  if (problems.length) {
    throw new Error(
      `CAMP-246 hard constraints refuse to load:\n  ${problems.join('\n  ')}\n` +
        `(coverage measured ${snapshot.measuredAt}). A rule that rejects by ` +
        `value may stand only on a field known for more than ` +
        `${COVERAGE_FLOOR * 100}% of the campsites (CAMP-260); an amenity is ` +
        `a recorded-no rule instead, and rejects only what says no.`,
    );
  }
}

/**
 * The shipped rules against the shipped table. Throws when they disagree.
 *
 * 🔴 Called by app.module.ts as it loads, like `loadMeasuredScoring`: the API
 * refuses to START with a rule the data cannot carry, instead of rejecting
 * most of the campsites until somebody looks. `startup.spec.ts` fails if
 * that call is removed.
 */
export function loadMeasuredHardConstraints(): readonly HardRule[] {
  assertHardAllowed(measured as unknown as CoverageSnapshot, HARD);
  return HARD;
}
