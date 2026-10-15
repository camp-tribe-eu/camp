import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COVERAGE_FLOOR, CoverageSnapshot } from './coverage-snapshot';
import { queryHash } from './measure-coverage';
import {
  Candidate,
  checkScoring,
  COMPONENTS,
  ComponentDef,
  describeScoring,
  distanceFit,
  loadMeasuredScoring,
  loadScoring,
  LOW_COVERAGE_MAX_WEIGHT,
  rank,
  score,
  scoreParts,
  STARS_NEUTRAL,
  starsValue,
} from './scoring';

// CAMP-262 — the formula, its weights, and the rule that holds the weights
// to the measured coverage table.
//
// 🔴 THE TABLE THESE TESTS READ IS THE SCRIPT'S OUTPUT, not a constant in
// this file: coverage.snapshot.json is written by measure-coverage.ts, and
// `queryHash` ties it to the SQL that wrote it. A number typed here would be
// the same kind of number as the one the card replaces.

const SNAPSHOT_FILE = join(__dirname, 'coverage.snapshot.json');
const fileSnapshot = (): CoverageSnapshot =>
  JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));

/** A table of our own, for testing the rule at its edges. */
function table(known: Record<string, number>, n = 10_000): CoverageSnapshot {
  return {
    measuredAt: 'test',
    population: { n },
    queryHash: 'test',
    fields: Object.fromEntries(
      Object.entries(known).map(([k, v]) => [k, { known: v }]),
    ),
    evidence: { starsMean: 3, starsOwnRow: 0, starsKnownByCountry: {} },
  };
}

/** The real components with one weight replaced and another taking the slack. */
function reweigh(
  moves: Partial<Record<ComponentDef['id'], number>>,
): ComponentDef[] {
  return COMPONENTS.map((c) => ({ ...c, weight: moves[c.id] ?? c.weight }));
}

const TOL = 10_000;
/** The component carrying most of the weight — whatever the weights are. */
const heaviest = () =>
  COMPONENTS.reduce((a, b) => (b.weight > a.weight ? b : a));
const BARE: Candidate = {
  slug: 'bare',
  distanceM: 0,
  amenities: {},
  stars: null,
};
const at = (c: Partial<Candidate>): Candidate => ({ ...BARE, ...c });
const worth = (a: Candidate, b: Candidate) => score(a, TOL) - score(b, TOL);

describe('each weight, pinned by the one difference it prices', () => {
  // Every test changes exactly one input and asserts what that one input is
  // worth. Changing a weight therefore reddens ITS test; the others do not
  // care. (The weights must sum to 1, and that has its own test below.)

  it('distance_fit: on the target against at the tolerance edge', () => {
    expect(worth(at({ distanceM: 0 }), at({ distanceM: TOL }))).toBeCloseTo(
      0.75,
      12,
    );
  });

  it('electricity: a recorded yes against unknown', () => {
    const withIt = at({ amenities: { electricity: 'yes' } });
    expect(worth(withIt, BARE)).toBeCloseTo(0.1, 12);
    // Nothing else moved.
    expect(scoreParts(withIt, TOL).greyWater).toBe(
      scoreParts(BARE, TOL).greyWater,
    );
    expect(scoreParts(withIt, TOL).stars).toBe(scoreParts(BARE, TOL).stars);
  });

  it('greyWater: a recorded yes against unknown', () => {
    const withIt = at({ amenities: { greyWater: 'yes' } });
    expect(worth(withIt, BARE)).toBeCloseTo(0.1, 12);
    expect(scoreParts(withIt, TOL).electricity).toBe(
      scoreParts(BARE, TOL).electricity,
    );
    expect(scoreParts(withIt, TOL).stars).toBe(scoreParts(BARE, TOL).stars);
  });

  it('stars: five against one is the whole width of the bonus', () => {
    expect(worth(at({ stars: 5 }), at({ stars: 1 }))).toBeCloseTo(0.05, 12);
  });

  it('the weights add up to 1, so a score is a number from 0 to 1', () => {
    expect(COMPONENTS).toHaveLength(4);
    expect(COMPONENTS.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 12);
  });
});

describe('absent is not bad', () => {
  const s = (stars: number | null | undefined) => score(at({ stars }), TOL);

  it('a missing rating scores strictly between the worst rating and the best', () => {
    // Anchor: the scale has width, or "between" is vacuous.
    expect(s(5)).toBeGreaterThan(s(1));
    expect(s(null)).toBeGreaterThan(s(1));
    expect(s(null)).toBeLessThan(s(5));
  });

  it('undefined and null are the same absence', () => {
    expect(s(undefined)).toBe(s(null));
  });

  it('a value off the 1-5 scale is treated as absent, not trusted and not fatal', () => {
    for (const bad of [
      0,
      6,
      3.5,
      NaN,
      Infinity,
      -1,
      '4' as unknown as number,
    ]) {
      expect(s(bad)).toBe(s(null));
    }
  });

  it('the middle of the scale is where the measured mean of the ratings sits', () => {
    // A missing rating is centred on 3 stars. That is only fair while the
    // ratings we DO have average about 3: otherwise every unrated campsite
    // is either ahead of or behind the typical rated one by construction.
    const meanStars = fileSnapshot().evidence.starsMean;
    expect(meanStars).toBeGreaterThan(1); // anchor: it was measured
    expect(1 + 4 * STARS_NEUTRAL).toBe(3);
    expect(Math.abs(meanStars - (1 + 4 * STARS_NEUTRAL))).toBeLessThanOrEqual(
      0.25,
    );
  });

  it('no and unknown are the same nothing for an amenity, and so is a missing key', () => {
    const yes = score(at({ amenities: { electricity: 'yes' } }), TOL);
    const nothing = score(BARE, TOL);
    expect(yes).toBeGreaterThan(nothing); // anchor
    for (const v of ['no', 'unknown', 'maybe', '']) {
      expect(score(at({ amenities: { electricity: v } }), TOL)).toBe(nothing);
    }
    expect(score(at({ amenities: undefined }), TOL)).toBe(nothing);
  });
});

describe('distanceFit and starsValue', () => {
  it('falls in a straight line from 1 to 0 and never goes below', () => {
    expect(distanceFit(0, TOL)).toBe(1);
    expect(distanceFit(TOL / 2, TOL)).toBe(0.5);
    expect(distanceFit(TOL, TOL)).toBe(0);
    expect(distanceFit(TOL * 3, TOL)).toBe(0);
  });

  it('a distance that is not a distance scores 0 instead of poisoning the sort', () => {
    for (const d of [NaN, Infinity, -5]) expect(distanceFit(d, TOL)).toBe(0);
  });

  it('a tolerance that is not a tolerance is a bug, and says so', () => {
    for (const t of [0, -1, NaN, Infinity]) {
      expect(() => distanceFit(10, t)).toThrow(/toleranceM/);
    }
  });

  it('stars map 1..5 onto 0..1', () => {
    expect([1, 2, 3, 4, 5].map(starsValue)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('rank', () => {
  const pool: Candidate[] = [
    at({ slug: 'far', distanceM: 9_000 }),
    at({ slug: 'near', distanceM: 1_000 }),
    at({ slug: 'mid', distanceM: 5_000 }),
  ];

  it('puts the closest first', () => {
    expect(rank(pool, TOL).map((c) => c.slug)).toEqual(['near', 'mid', 'far']);
  });

  it('gives one answer for one input, whatever order it arrives in', () => {
    const twins = [
      at({ slug: 'b', distanceM: 2_000 }),
      at({ slug: 'a', distanceM: 2_000 }),
      at({ slug: 'c', distanceM: 2_000 }),
    ];
    // Anchor: they really do tie.
    expect(new Set(twins.map((c) => score(c, TOL))).size).toBe(1);
    const one = rank(twins, TOL).map((c) => c.slug);
    const two = rank([...twins].reverse(), TOL).map((c) => c.slug);
    expect(one).toEqual(['a', 'b', 'c']);
    expect(two).toEqual(one);
  });

  it('one corrupted record costs one record, never the ranking', () => {
    const bad = at({
      slug: 'bad',
      distanceM: NaN,
      stars: 99,
      amenities: { electricity: 42 as unknown as string },
    });
    const out = rank([pool[0], bad, pool[1], pool[2]], TOL).map((c) => c.slug);
    expect(out).toHaveLength(4);
    expect(out).toEqual(['near', 'mid', 'far', 'bad']);
  });

  it('without: a switched-off component stops counting', () => {
    const rated = [
      at({ slug: 'plain', distanceM: 1_000 }),
      at({
        slug: 'electric',
        distanceM: 1_500,
        amenities: { electricity: 'yes' },
      }),
    ];
    // Anchor: with it on, the bonus overtakes 500 m of distance.
    expect(rank(rated, TOL).map((c) => c.slug)).toEqual(['electric', 'plain']);
    expect(rank(rated, TOL, ['electricity']).map((c) => c.slug)).toEqual([
      'plain',
      'electric',
    ]);
  });
});

describe('the rule: an input known for under half may not weigh over 0.1', () => {
  const FULL = {
    location: 10_000,
    electricity: 3_000,
    greyWater: 3_000,
    stars: 3_000,
  };

  it('accepts the real weights against a table with every field measured', () => {
    expect(checkScoring(COMPONENTS, table(FULL))).toEqual([]);
  });

  it('refuses stars at 0.4 — the weight the old formula gave the rating — and says only that', () => {
    const problems = checkScoring(
      reweigh({ distance_fit: 0.4, stars: 0.4 }),
      table(FULL),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/stars: weight 0\.4 on "stars"/);
    expect(problems[0]).toMatch(/30\.0%/);
  });

  it('allows exactly 0.1 on a field known for 49.99%, and not a hair more', () => {
    const t = table({ ...FULL, electricity: 4_999 });
    expect(checkScoring(COMPONENTS, t)).toEqual([]);
    const over = checkScoring(
      reweigh({
        electricity: 0.1 + 1e-6,
        distance_fit: heaviest().weight - 1e-6,
      }),
      t,
    );
    expect(over).toHaveLength(1);
    expect(over[0]).toMatch(/electricity/);
  });

  it('lifts the limit at exactly half', () => {
    // 0.4 on an input known for exactly 50% is allowed; at 49.99% it is not.
    const heavy = reweigh({ distance_fit: 0.4, electricity: 0.4, stars: 0.1 });
    expect(COVERAGE_FLOOR).toBe(0.5);
    expect(checkScoring(heavy, table({ ...FULL, electricity: 5_000 }))).toEqual(
      [],
    );
    expect(
      checkScoring(heavy, table({ ...FULL, electricity: 4_999 })),
    ).toHaveLength(1);
  });

  it('a field nobody measured is a failure, never a pass', () => {
    const { stars: _dropped, ...withoutStars } = FULL;
    void _dropped;
    const problems = checkScoring(COMPONENTS, table(withoutStars));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/stars.*not in the coverage snapshot/);
  });

  it('an empty population measures nothing', () => {
    expect(checkScoring(COMPONENTS, table(FULL, 0)).length).toBeGreaterThan(0);
  });

  it('weights that do not add up to 1 are refused', () => {
    const problems = checkScoring(reweigh({ distance_fit: 0.7 }), table(FULL));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^weights sum to 0\.9\d*, not 1$/);
  });

  it('a negative, missing or repeated weight is refused', () => {
    expect(
      checkScoring(
        reweigh({ stars: -0.05, distance_fit: 0.85 }),
        table(FULL),
      ).join('\n'),
    ).toMatch(/stars: weight -0\.05/);
    expect(
      checkScoring(reweigh({ stars: NaN }), table(FULL)).join('\n'),
    ).toMatch(/stars: weight NaN/);
    expect(
      checkScoring([...COMPONENTS, COMPONENTS[0]], table(FULL)).join('\n'),
    ).toMatch(/distance_fit: listed twice/);
  });
});

describe('the real weights against the measured table', () => {
  const snap = fileSnapshot();

  it('anchors: the table has the population and the fields the formula stands on', () => {
    expect(snap.population.n).toBeGreaterThan(10_000);
    for (const c of COMPONENTS) {
      expect(snap.fields[c.field]).toBeDefined();
    }
  });

  it('the snapshot is the output of the CURRENT measuring SQL', () => {
    // Edit the SQL and this fails until measure-coverage.ts --write is run.
    expect(snap.queryHash).toBe(queryHash());
  });

  it('every weight above 0.1 stands on a field known for at least half', () => {
    // Read straight off the file, without going through scoring.ts's own
    // arithmetic: this is the weights compared with the script's output.
    let checked = 0;
    for (const c of COMPONENTS) {
      const share = snap.fields[c.field].known / snap.population.n;
      if (c.weight > LOW_COVERAGE_MAX_WEIGHT) {
        expect(share).toBeGreaterThanOrEqual(COVERAGE_FLOOR);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // the heavy weight was actually looked at
  });

  it('the coverage the config carries is the file’s, not a number typed into scoring.ts', () => {
    const config = loadMeasuredScoring();
    expect(config.components).toHaveLength(COMPONENTS.length);
    for (const c of config.components) {
      expect(c.coverage).toBe(snap.fields[c.field].known / snap.population.n);
      expect(c.known).toBe(snap.fields[c.field].known);
    }
  });

  it('the printed table shows each weight beside the file’s percentage', () => {
    const text = describeScoring();
    for (const c of COMPONENTS) {
      const pct = (
        (snap.fields[c.field].known / snap.population.n) *
        100
      ).toFixed(1);
      const row = text.split('\n').find((l) => l.startsWith(c.id));
      expect(row).toBeDefined();
      expect(row).toContain(c.weight.toFixed(2));
      expect(row).toContain(`${pct}%`);
    }
  });
});

describe('start-up: the check refuses a weight the data cannot carry', () => {
  // 🔴 THESE CALL THE CHECK AND READ WHAT IT SAYS. The check used to run when
  // scoring.ts was imported, so a bad weight stopped every suite that
  // imported the formula before it could assert anything: stars 0.05 -> 0.4
  // left 3 suites and 60 of 1 925 tests unstarted and one assertion that
  // never looked at the message. A suite that fails to run prints the same
  // as a mutation caught, so a refusal has to be an ASSERTION on its text.

  /** Runs the shipped check afresh against a snapshot we have altered. */
  function load(alter: (s: CoverageSnapshot) => void): {
    error?: Error;
    loaded: boolean;
  } {
    const altered = fileSnapshot();
    alter(altered);
    let error: Error | undefined;
    let loaded = false;
    jest.isolateModules(() => {
      jest.doMock('./coverage.snapshot.json', () => altered);
      try {
        // jest.isolateModules is synchronous, so it can only load by require.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./scoring').loadMeasuredScoring();
        loaded = true;
      } catch (e) {
        error = e as Error;
      }
    });
    jest.dontMock('./coverage.snapshot.json');
    return { error, loaded };
  }

  it('the shipped weights load against the shipped table; a refusal would be read here, in full', () => {
    // Not `expect(() => ...).not.toThrow()`: when this goes red, the
    // received value IS the refusal — the input, its weight and its measured
    // share — instead of "function threw".
    let refusal: string | undefined;
    try {
      loadMeasuredScoring();
    } catch (e) {
      refusal = (e as Error).message;
    }
    expect(refusal).toBeUndefined();
  });

  it('loads against the real table (so the failures below are about the table)', () => {
    expect(load(() => undefined)).toEqual({ error: undefined, loaded: true });
  });

  it('says exactly what the pull request quotes: stars at 0.4, known for only 8.0%', () => {
    // A table of our own, numbers written out: 800 of 10 000 is 8.0%.
    const eight = table({
      location: 10_000,
      electricity: 3_000,
      greyWater: 3_000,
      stars: 800,
    });
    let message = '';
    try {
      loadScoring(reweigh({ distance_fit: 0.4, stars: 0.4 }), eight);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(
      'CAMP-262 scoring refuses to load:\n' +
        '  stars: weight 0.4 on "stars", known for only 8.0% (< 50%), may not exceed 0.1\n' +
        '(coverage measured test; re-measure with src/planner/measure-coverage.ts --write)',
    );
  });

  it('says it of the REAL table too, with the share the snapshot file holds', () => {
    const snap = fileSnapshot();
    const share = ((snap.fields.stars.known / snap.population.n) * 100).toFixed(
      1,
    );
    expect(Number(share)).toBeLessThan(50); // anchor: stars is a low-coverage input
    let message = '';
    try {
      loadScoring(reweigh({ distance_fit: 0.4, stars: 0.4 }), snap);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(
      `stars: weight 0.4 on "stars", known for only ${share}% (< 50%), may not exceed 0.1`,
    );
    // …and only that: moving 0.35 from distance to stars keeps the sum at 1.
    expect(message.split('\n').filter((l) => l.startsWith('  '))).toHaveLength(
      1,
    );
  });

  it('says the sum, and only the sum, when the weights stop adding up to 1', () => {
    let message = '';
    try {
      loadScoring(reweigh({ distance_fit: 0.74 }), fileSnapshot());
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(
      /^CAMP-262 scoring refuses to load:\n {2}weights sum to 0\.9\d*, not 1\n/,
    );
    expect(message.split('\n').filter((l) => l.startsWith('  '))).toHaveLength(
      1,
    );
  });

  it('throws when the field the heavy weight stands on is known for 30%', () => {
    const { error, loaded } = load((s) => {
      s.fields.location.known = Math.floor(s.population.n * 0.3);
    });
    expect(loaded).toBe(false);
    expect(error?.message).toMatch(
      new RegExp(
        `distance_fit: weight ${heaviest().weight} on "location", known for only 30\\.0%`,
      ),
    );
    expect(error?.message).toMatch(/scoring refuses to load/);
  });

  it('throws when a weighted field is missing from the table', () => {
    const { error, loaded } = load((s) => {
      delete s.fields.stars;
    });
    expect(loaded).toBe(false);
    expect(error?.message).toMatch(/"stars" is not in the coverage snapshot/);
  });
});
