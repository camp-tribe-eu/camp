import {
  COVERAGE_FLOOR,
  CoverageSnapshot,
  DRIFT,
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
  const saved = snap({ a: 3_000, b: 4_999 });

  it('says nothing when nothing moved', () => {
    expect(driftOf(saved, snap({ a: 3_000, b: 4_999 }))).toEqual([]);
  });

  it('says nothing for movement inside the tolerance', () => {
    const wiggle = Math.floor(DRIFT.share * 10_000) - 1;
    expect(driftOf(saved, snap({ a: 3_000 + wiggle, b: 4_999 }))).toEqual([]);
  });

  it('names a field that moved further than the tolerance', () => {
    const wiggle = Math.ceil(DRIFT.share * 10_000) + 5;
    const out = driftOf(saved, snap({ a: 3_000 + wiggle, b: 4_999 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^a: 30\.00% -> 31\.\d\d%$/);
  });

  it('names a field that crossed the floor however little it moved', () => {
    // 49.99% -> 50.00%: one row, and exactly the line the weights answer to.
    const out = driftOf(saved, snap({ a: 3_000, b: 5_000 }));
    expect(COVERAGE_FLOOR).toBe(0.5);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^b: .*\(crossed 50%\)$/);
  });

  it('names a population that changed size by more than the tolerance', () => {
    // Same shares, 20% more rows.
    const out = driftOf(saved, snap({ a: 3_600, b: 5_998 }, 12_000));
    expect(out).toEqual(['population 10000 -> 12000']);
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
