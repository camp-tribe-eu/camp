import { JOURNEYS } from './measure-constraints';
import {
  DpTiming,
  format,
  median,
  Measurement,
  problemsOf,
  SPHEROID_SLACK,
  timeProgramme,
  TRIPS,
  TripResult,
} from './measure-itinerary';

// CAMP-46 — the measuring script's own checks. Its database half runs in
// itinerary.db.spec.ts, against a table with known rows; this is the part
// that decides, from a measurement, whether to exit 1.

const trip = (over: Partial<TripResult> = {}): TripResult => ({
  name: 'A → B',
  status: 'ok',
  lengthKm: 490,
  minM: 50_000,
  maxM: 100_000,
  candidates: 100,
  // Seven days: six nights and seven runs of 70 km.
  nights: ['a', 'b', 'c', 'd', 'e', 'f'],
  runsM: [70_000, 70_000, 70_000, 70_000, 70_000, 70_000, 70_000],
  minGapM: 80_000,
  ms: [10, 12],
  ...over,
});

const measurement = (
  trips: TripResult[],
  dp: DpTiming[] = [],
): Measurement => ({
  trips,
  dp,
});

describe('median', () => {
  it('the middle of an odd list, the mean of the middle two of an even one', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('of nothing is an error, not 0', () => {
    expect(() => median([])).toThrow(/nothing/);
  });
});

describe('problemsOf: when the script exits 1', () => {
  it('an itinerary whose nights are far enough apart is no problem', () => {
    expect(problemsOf(measurement([trip()]))).toEqual([]);
  });

  it('two nights 49.4 km apart under a 50 km floor are a problem, and it says how far', () => {
    const p = problemsOf(measurement([trip({ minGapM: 49_400 })]));
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('A → B');
    expect(p[0]).toContain('49.40 km');
    expect(p[0]).toContain('50.00 km');
  });

  it('49.5 km is the edge: 1% of 50 km is what the spheroid may take off, and no more', () => {
    expect(SPHEROID_SLACK).toBe(0.99);
    expect(problemsOf(measurement([trip({ minGapM: 49_500 })]))).toEqual([]);
    expect(problemsOf(measurement([trip({ minGapM: 49_499 })]))).toHaveLength(
      1,
    );
  });

  it('a refused trip alongside an itinerary is not a problem: refusing is an answer', () => {
    const refused = trip({
      name: 'sea',
      status: 'infeasible',
      reason: 'no-chain',
      nights: undefined,
      minGapM: undefined,
    });
    expect(problemsOf(measurement([trip(), refused]))).toEqual([]);
  });

  it('no itinerary at all is a failure: nothing was measured', () => {
    const refused = trip({
      status: 'infeasible',
      reason: 'no-chain',
      nights: undefined,
      minGapM: undefined,
    });
    const p = problemsOf(measurement([refused, refused]));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/nothing was measured/);
    expect(problemsOf(measurement([]))).toHaveLength(1);
  });

  it('an itinerary with no measured gap is a problem, not a pass', () => {
    const p = problemsOf(measurement([trip({ minGapM: undefined })]));
    expect(p).toEqual(['A → B: an itinerary with no measured gap']);
  });
});

describe('problemsOf: the whole band and the count, not only the lower bound', () => {
  const runs = (over: Record<number, number>) =>
    [70_000, 70_000, 70_000, 70_000, 70_000, 70_000, 70_000].map(
      (r, i) => over[i] ?? r,
    );

  it('a run of 100 001 m under a 100 000 m ceiling is a problem, 100 000 m is the edge', () => {
    expect(
      problemsOf(measurement([trip({ runsM: runs({ 3: 100_000 }) })])),
    ).toEqual([]);
    const p = problemsOf(measurement([trip({ runsM: runs({ 3: 100_001 }) })]));
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('100.00 km is outside');
    expect(p[0]).toContain('50.00 to 100.00 km');
  });

  it('a run of 49 999 m under a 50 000 m floor is a problem, 50 000 m is the edge', () => {
    expect(
      problemsOf(measurement([trip({ runsM: runs({ 0: 50_000 }) })])),
    ).toEqual([]);
    expect(
      problemsOf(measurement([trip({ runsM: runs({ 0: 49_999 }) })])),
    ).toHaveLength(1);
  });

  it('five nights for seven days, or seven, is a problem and says how many', () => {
    const five = problemsOf(
      measurement([trip({ nights: ['a', 'b', 'c', 'd', 'e'] })]),
    );
    expect(five).toEqual(['A → B: 5 nights, not 6 for 7 days']);
    const seven = problemsOf(
      measurement([trip({ nights: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })]),
    );
    expect(seven).toEqual(['A → B: 7 nights, not 6 for 7 days']);
  });

  it('six runs for seven days is a problem', () => {
    const p = problemsOf(
      measurement([
        trip({ runsM: [70_000, 70_000, 70_000, 70_000, 70_000, 70_000] }),
      ]),
    );
    expect(p).toEqual(['A → B: 6 day-runs, not 7']);
  });

  it('an itinerary that reports no nights and no runs is a problem, not a pass', () => {
    const p = problemsOf(
      measurement([trip({ nights: undefined, runsM: undefined })]),
    );
    expect(p).toEqual([
      'A → B: no nights, not 6 for 7 days',
      'A → B: no day-runs, not 7',
    ]);
  });
});

describe('the trips', () => {
  it('anchors: sixteen, the five of measure-constraints among them, none repeated', () => {
    expect(TRIPS).toHaveLength(16);
    expect(new Set(TRIPS.map((t) => t.name)).size).toBe(16);
    for (const j of JOURNEYS) {
      expect(TRIPS.map((t) => t.name)).toContain(j.name);
    }
  });

  it('every end is a [lon, lat] inside the Union’s bounding box', () => {
    for (const t of TRIPS) {
      for (const [lon, lat] of [t.from, t.to]) {
        expect(lon).toBeGreaterThan(-10);
        expect(lon).toBeLessThan(30);
        expect(lat).toBeGreaterThan(34);
        expect(lat).toBeLessThan(62);
      }
    }
  });
});

describe('the programme, timed on a synthetic corridor', () => {
  it('runs, and times each repetition', () => {
    const [t] = timeProgramme([{ n: 600, days: 7 }], 3);
    expect(t.candidates).toBe(600);
    expect(t.days).toBe(7);
    expect(t.ms).toHaveLength(3);
    for (const ms of t.ms) expect(ms).toBeGreaterThan(0);
  });
});

describe('the report', () => {
  const text = format(
    measurement(
      [trip(), trip({ name: 'C → D', ms: [20, 30] })],
      [{ candidates: 600, days: 7, ms: [1, 2, 3] }],
    ),
    'now',
  );

  it('says in its first lines that every distance is a straight line, not a road', () => {
    const head = text.split('\n').slice(0, 3).join('\n');
    expect(head).toContain('STRAIGHT LINE');
    expect(head).toContain('not a road');
  });

  it('names the median and the worst of the four calls, and which call was worst', () => {
    expect(text).toContain('median 16 ms');
    expect(text).toContain('worst 30 ms (C → D, call 2)');
  });
});
