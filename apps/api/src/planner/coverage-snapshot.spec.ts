import {
  COVERAGE_FLOOR,
  CoverageSnapshot,
  driftOf,
  shareOf,
} from './coverage-snapshot';

// CAMP-262 — the arithmetic on the measured table, and the drift check that
// is the only thing standing between a committed snapshot and a database
// that has moved on.

function snap(known: Record<string, number>, n = 10_000): CoverageSnapshot {
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

describe('shareOf', () => {
  it('is known divided by the population', () => {
    expect(shareOf(snap({ a: 2_500 }), 'a')).toBe(0.25);
  });

  it('is undefined for a field nobody measured — not 0, not 1', () => {
    expect(shareOf(snap({ a: 1 }), 'b')).toBeUndefined();
  });

  it('is undefined when there is no population to divide by', () => {
    expect(shareOf(snap({ a: 5 }, 0), 'a')).toBeUndefined();
  });

  it('is undefined for a count that is not a number', () => {
    expect(shareOf(snap({ a: NaN }), 'a')).toBeUndefined();
  });
});

describe('driftOf', () => {
  // 🔴 EVERY NUMBER IN THIS BLOCK IS WRITTEN OUT, AND NONE IS READ FROM
  // `DRIFT`. The first version built its fixtures from the constant it was
  // measuring (`Math.floor(DRIFT.share * 10_000) - 1`), so a mutated
  // constant carried its own fixture along and the test agreed with it.
  // Measured 15.10.2026, whole suite, 1 925 tests: DRIFT.share 0.01 -> 0.019,
  // DRIFT.population 0.1 -> 0.19 and 0.1 -> 0.0001 all stayed green.
  //
  // So each tolerance is pinned from BOTH sides by two fixtures one row
  // apart, in plain numbers: 99 rows of 10 000 is 0.99 percentage points and
  // must stay quiet, 101 rows is 1.01 and must be named. If the tolerance is
  // changed on purpose, these tests go red and the new figures are typed
  // here by hand, which is the point.
  const saved = snap({ a: 3_000, b: 4_999 });

  it('says nothing when nothing moved', () => {
    expect(driftOf(saved, snap({ a: 3_000, b: 4_999 }))).toEqual([]);
  });

  describe('a share', () => {
    it('stays quiet at 0.99 points, up or down', () => {
      expect(driftOf(saved, snap({ a: 3_099, b: 4_999 }))).toEqual([]);
      expect(driftOf(saved, snap({ a: 2_901, b: 4_999 }))).toEqual([]);
    });

    it('is named at 1.01 points, up or down, with both figures', () => {
      expect(driftOf(saved, snap({ a: 3_101, b: 4_999 }))).toEqual([
        'a: 30.00% -> 31.01%',
      ]);
      expect(driftOf(saved, snap({ a: 2_899, b: 4_999 }))).toEqual([
        'a: 30.00% -> 28.99%',
      ]);
    });

    it('names every field that moved, not the first one', () => {
      expect(driftOf(saved, snap({ a: 3_101, b: 4_897 }))).toEqual([
        'a: 30.00% -> 31.01%',
        'b: 49.99% -> 48.97%',
      ]);
    });
  });

  describe('the floor', () => {
    it('is named however little the field moved, going up', () => {
      // 49.99% -> 50.00%: one row, and exactly the line the weights answer to.
      const out = driftOf(saved, snap({ a: 3_000, b: 5_000 }));
      expect(COVERAGE_FLOOR).toBe(0.5);
      expect(out).toEqual(['b: 49.99% -> 50.00% (crossed 50%)']);
    });

    it('is named going down as well', () => {
      expect(
        driftOf(snap({ a: 3_000, b: 5_000 }), snap({ a: 3_000, b: 4_999 })),
      ).toEqual(['b: 50.00% -> 49.99% (crossed 50%)']);
    });
  });

  describe('the population', () => {
    // Shares are the same on both sides in every case below (30% and 40%),
    // so the only thing that can be reported is the size of the table.
    const base = snap({ a: 3_000, b: 4_000 });

    it('stays quiet at 9.9% more or fewer rows', () => {
      expect(driftOf(base, snap({ a: 3_297, b: 4_396 }, 10_990))).toEqual([]);
      expect(driftOf(base, snap({ a: 2_703, b: 3_604 }, 9_010))).toEqual([]);
    });

    it('is named at 10.1% more rows', () => {
      expect(driftOf(base, snap({ a: 3_303, b: 4_404 }, 11_010))).toEqual([
        'population 10000 -> 11010',
      ]);
    });

    it('is named at 10.1% fewer rows — a table that shrank is as stale as one that grew', () => {
      expect(driftOf(base, snap({ a: 2_697, b: 3_596 }, 8_990))).toEqual([
        'population 10000 -> 8990',
      ]);
    });
  });

  it('names a field measured on one side only', () => {
    expect(driftOf(saved, snap({ a: 3_000 }))).toEqual([
      'b: measured on one side only',
    ]);
    expect(driftOf(snap({ a: 3_000 }), snap({ a: 3_000, c: 1 }))).toEqual([
      'c: measured on one side only',
    ]);
  });
});
