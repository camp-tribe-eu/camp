import {
  agrees,
  BAND_M,
  reconcile,
  stratumOf,
  summarise,
  type CountRow,
} from './agreement';

// CAMP-168: the arithmetic behind the radius argument, checked against a
// dataset small enough to do by hand. Every expected value below was
// worked out on paper from the rows, not by running the function.
//
//   band 500   sea 6 (5 agree)  lake 2 (2)  river 2 (1)     n 10  agree 8 = 80%
//   band 1000  sea 1 (1 agree)  lake 2 (1)  river 7 (2)     n 10  agree 4 = 40%
//              + 4 campsites whose water kind is none of the four
//   band 1500  sea 4 (4 agree), no lake, no river
//
// The band-1000 row is the one that matters: the RAW figure fell from 80%
// to 40%, and it fell because the mix moved from 60% sea to 10% sea and
// 70% river — not because any kind agrees less often than before. The
// standardised figure, 75.7%, says so.

const row = (
  band: number,
  kind: string | null,
  category: string,
  n: number,
): CountRow => ({ band, kind, category, n });

const ROWS: CountRow[] = [
  // band 500
  row(500, 'sea', 'Coastal', 5),
  row(500, 'sea', 'Lake', 1),
  row(500, 'lake', 'Lake', 1),
  row(500, 'reservoir', 'Lake', 1),
  row(500, 'river', 'River', 1),
  row(500, 'river', 'Lake', 1),
  // band 1000
  row(1000, 'sea', 'Coastal', 1),
  row(1000, 'lake', 'Lake', 1),
  row(1000, 'lake', 'River', 1),
  row(1000, 'river', 'River', 2),
  row(1000, 'river', 'Lake', 5),
  row(1000, 'glacier', 'Lake', 3),
  row(1000, null, 'Coastal', 1),
  // band 1500
  row(1500, 'sea', 'Coastal', 4),
];

describe('stratumOf', () => {
  it('folds a reservoir into lake and refuses what it does not know', () => {
    expect(stratumOf('sea')).toBe('sea');
    expect(stratumOf('lake')).toBe('lake');
    expect(stratumOf('reservoir')).toBe('lake');
    expect(stratumOf('river')).toBe('river');
    expect(stratumOf('glacier')).toBeNull();
    expect(stratumOf(null)).toBeNull();
    expect(stratumOf(undefined)).toBeNull();
  });
});

describe('agrees', () => {
  it('accepts a Transitional water for sea and river, not for lake', () => {
    expect(agrees('sea', 'Transitional')).toBe(true);
    expect(agrees('river', 'Transitional')).toBe(true);
    expect(agrees('lake', 'Transitional')).toBe(false);
  });

  it('matches each kind to its own category only', () => {
    expect(agrees('sea', 'Coastal')).toBe(true);
    expect(agrees('sea', 'Lake')).toBe(false);
    expect(agrees('lake', 'Lake')).toBe(true);
    expect(agrees('lake', 'River')).toBe(false);
    expect(agrees('river', 'River')).toBe(true);
    expect(agrees('river', 'Coastal')).toBe(false);
    expect(agrees('sea', 'Nonsense')).toBe(false);
  });
});

describe('summarise', () => {
  const { weights, lines } = summarise(ROWS);
  const [b500, b1000, b1500] = lines;

  it('reads its bands as (to − 500, to]', () => {
    expect(BAND_M).toBe(500);
    expect(lines.map((l) => [l.from, l.to])).toEqual([
      [0, 500],
      [500, 1000],
      [1000, 1500],
    ]);
  });

  it('counts each band on its own', () => {
    expect(b500.n).toBe(10);
    expect(b500.agree).toBe(8);
    expect(b500.pct).toBeCloseTo(80, 6);
    expect(b1000.n).toBe(10);
    expect(b1000.agree).toBe(4);
    expect(b1000.pct).toBeCloseTo(40, 6);
  });

  // 🔴 THE CONFUSION THIS FILE EXISTS TO PREVENT. The band's own figure
  // and the figure for everything up to it are different numbers; the
  // report used to print the first under the label of the second.
  it('keeps the band figure and the cumulative figure apart', () => {
    expect(b1000.pct).toBeCloseTo(40, 6);
    expect(b1000.cumulative.n).toBe(20);
    expect(b1000.cumulative.agree).toBe(12);
    expect(b1000.cumulative.pct).toBeCloseTo(60, 6);
    expect(b1000.cumulative.pct).not.toBeCloseTo(b1000.pct, 1);
    // and the first band's cumulative IS its own
    expect(b500.cumulative.pct).toBeCloseTo(b500.pct, 6);
  });

  it('accumulates in distance order however the rows arrive', () => {
    const shuffled = summarise([...ROWS].reverse());
    expect(shuffled.lines.map((l) => l.cumulative)).toEqual(
      lines.map((l) => l.cumulative),
    );
    expect(lines[2].cumulative.n).toBe(24);
    expect(lines[2].cumulative.agree).toBe(16);
  });

  it('measures agreement inside each kind, with a reservoir counted as a lake', () => {
    expect(b500.strata.sea).toMatchObject({ n: 6, agree: 5 });
    expect(b500.strata.lake).toMatchObject({ n: 2, agree: 2 });
    expect(b500.strata.river).toMatchObject({ n: 2, agree: 1 });
    expect(b500.strata.sea.pct).toBeCloseTo(100 * (5 / 6), 6);
    expect(b1000.strata.river).toMatchObject({ n: 7, agree: 2 });
    expect(b1000.strata.river.pct).toBeCloseTo(100 * (2 / 7), 6);
  });

  it('reports the mix of each band', () => {
    expect(b500.strata.sea.share).toBeCloseTo(0.6, 6);
    expect(b1000.strata.sea.share).toBeCloseTo(0.1, 6);
    expect(b1000.strata.river.share).toBeCloseTo(0.7, 6);
  });

  it('takes its fixed weights from the innermost band', () => {
    expect(weights.sea).toBeCloseTo(0.6, 6);
    expect(weights.lake).toBeCloseTo(0.2, 6);
    expect(weights.river).toBeCloseTo(0.2, 6);
  });

  // 🔴 THE POINT OF STANDARDISING. Raw agreement fell 80% → 40% between
  // these bands; every kind's own agreement moved much less, and the
  // rest of the fall is the mix moving from sea to river.
  it('standardises to the innermost mix, so the mix cannot move the curve', () => {
    expect(b500.standardised).toBeCloseTo(80, 6);
    // .6 × 1 + .2 × .5 + .2 × (2/7)
    expect(b1000.standardised).toBeCloseTo(75.7142857, 5);
    expect(b1000.pct - (b500.pct as number)).toBeLessThan(-30);
    expect(
      (b500.standardised as number) - (b1000.standardised as number),
    ).toBeLessThan(5);
  });

  it('computes what no signal at all would read, on the same weights', () => {
    // band 500: nearest waters Coastal 5, Lake 4, River 1 of 10
    //   .6 × .5 + .2 × .4 + .2 × .1
    expect(b500.chance).toBeCloseTo(40, 6);
    // band 1000: Coastal 1, Lake 6, River 3 of 10
    //   .6 × .1 + .2 × .6 + .2 × .3
    expect(b1000.chance).toBeCloseTo(24, 6);
  });

  it('says undefined, not zero, when a kind the mix needs is absent', () => {
    expect(b1500.n).toBe(4);
    expect(b1500.strata.lake.pct).toBeNull();
    expect(b1500.standardised).toBeNull();
    expect(b1500.chance).toBeNull();
  });

  // A kind we do not model is counted, on the line, never folded into
  // "disagrees".
  it('counts campsites of an unknown water kind as excluded', () => {
    expect(b1000.excluded).toBe(4);
    expect(b1000.n).toBe(10);
    expect(b1000.cumulative.excluded).toBe(4);
    expect(b500.excluded).toBe(0);
  });

  it('reads nothing out of nothing', () => {
    const empty = summarise([]);
    expect(empty.lines).toEqual([]);
    expect(empty.weights).toEqual({ sea: 0, lake: 0, river: 0 });
  });
});

describe('reconcile', () => {
  const { lines } = summarise(ROWS);

  // The sweep counts every campsite whose nearest water lies within r —
  // including the ones whose water kind we do not model.
  it('accepts a sweep whose counts are the bands accumulated', () => {
    const r = reconcile(lines, [
      { radius: 250, within: 3 },
      { radius: 500, within: 10 },
      { radius: 1000, within: 24 },
      { radius: 1500, within: 28 },
    ]);
    expect(r.compared).toBe(3); // 250 m is not a band edge
    expect(r.mismatches).toEqual([]);
  });

  it('names the radius where the two disagree', () => {
    const r = reconcile(lines, [
      { radius: 500, within: 10 },
      { radius: 1000, within: 20 }, // forgot the 4 excluded
    ]);
    expect(r.mismatches).toEqual([{ radius: 1000, sweep: 20, bands: 24 }]);
  });

  it('compares nothing when there is nothing to compare', () => {
    expect(reconcile([], [{ radius: 500, within: 1 }])).toEqual({
      compared: 0,
      mismatches: [],
    });
  });
});
