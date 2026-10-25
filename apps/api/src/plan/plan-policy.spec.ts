import {
  BAND_SHARE,
  BUFFER_M,
  SAME_PLACE_M,
  bandFor,
  metresBetween,
  samePlace,
} from './plan-policy';
import {
  BAND_SHARE as MEASURED_SHARE,
  BUFFER_M as MEASURED_BUFFER,
} from '../planner/measure-itinerary';
import { MAX_BUFFER_M } from '../planner/itinerary';

// CAMP-391 — the two numbers the entry chooses for the caller, written out.
//
// 🔴 THE ORACLE IS ARITHMETIC DONE HERE. 700 km in seven days is a hundred
// kilometres an even day; half of it is 50 and one and a half is 150. Nothing
// below takes its expectation from the function it checks.

describe('the band is a share of an even day', () => {
  it('700 km in seven days: 50 to 150 km a day', () => {
    expect(bandFor(700_000, 7)).toEqual({ minM: 50_000, maxM: 150_000 });
  });

  it('one day is the whole trip, from half of it to one and a half times it', () => {
    expect(bandFor(333_000, 1)).toEqual({ minM: 166_500, maxM: 499_500 });
  });

  it('🔴 fits ANY corridor in ANY number of days — which is why the `band` refusal cannot happen through the entry', () => {
    for (const lengthM of [1, 999, 40_000, 333_585.6, 9_425_000]) {
      for (const days of [1, 2, 7, 13, 60]) {
        const { minM, maxM } = bandFor(lengthM, days);
        // The condition `bandReach` checks, written out again: D runs of at
        // least `minM` and at most `maxM` can cover L.
        expect(days * minM).toBeLessThanOrEqual(lengthM * (1 + 1e-12));
        expect(days * maxM).toBeGreaterThanOrEqual(lengthM * (1 - 1e-12));
        expect(minM).toBeGreaterThan(0);
      }
    }
  });

  it('the share is half to one and a half', () => {
    expect(BAND_SHARE).toEqual({ min: 0.5, max: 1.5 });
  });
});

describe('the buffer', () => {
  it('is 30 km to either side, inside what the algorithm allows', () => {
    expect(BUFFER_M).toBe(30_000);
    expect(BUFFER_M).toBeLessThanOrEqual(MAX_BUFFER_M);
  });
});

describe('🔴 what is measured is what is asked', () => {
  // measure-itinerary.ts reports "the median call is 15 ms". That sentence is
  // about the requests the API answers only while the script asks with the same
  // band and buffer; it imports them, and this is the check it still does.
  it("the measuring script uses the entry's band share and buffer, not a copy", () => {
    expect(MEASURED_SHARE).toBe(BAND_SHARE);
    expect(MEASURED_BUFFER).toBe(BUFFER_M);
  });
});

describe('🔴 one place is one place, to the metre', () => {
  // 1° of latitude is 111 195 m on this sphere (R·π/180), so a hundred-thousandth
  // of a degree is 1.11 m — written out here, not read from the function.
  it('a metre is a metre: 1e-5° of latitude is 1.11 m, 4e-6° is 0.44 m', () => {
    expect(metresBetween([14.5, 46], [14.5, 46.00001])).toBeCloseTo(1.112, 2);
    expect(metresBetween([14.5, 46], [14.5, 46.000004])).toBeCloseTo(0.4448, 3);
  });

  it('1° of longitude shrinks with latitude: 77 km at 46°N, 111 km on the equator', () => {
    expect(metresBetween([14, 46], [15, 46]) / 1000).toBeCloseTo(77.2, 0);
    expect(metresBetween([14, 0], [15, 0]) / 1000).toBeCloseTo(111.2, 0);
  });

  it('is symmetric and zero for the same point', () => {
    expect(metresBetween([14.5, 46], [14.5, 46])).toBe(0);
    expect(metresBetween([14.5, 46], [16.4, 43.5])).toBeCloseTo(
      metresBetween([16.4, 43.5], [14.5, 46]),
      6,
    );
  });

  it('the same place: equal, a slip in the fifteenth digit, and under a metre', () => {
    expect(SAME_PLACE_M).toBe(1);
    expect(samePlace([14.5058, 46.0569], [14.5058, 46.0569])).toBe(true);
    expect(samePlace([14.5058, 46.0569], [14.5058, 46.0569000000001])).toBe(
      true,
    );
    expect(samePlace([14.5058, 46.0569], [14.5058, 46.056904])).toBe(true);
  });

  it('two metres apart is two places, the edge sitting at one metre', () => {
    expect(samePlace([14.5, 46], [14.5, 46.00002])).toBe(false);
    expect(samePlace([14.5, 46], [14.5, 46.000008])).toBe(true); // 0.89 m
    expect(samePlace([14.5, 46], [14.5, 46.00001])).toBe(false); // 1.11 m
  });
});
