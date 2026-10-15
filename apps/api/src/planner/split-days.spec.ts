import { Placement, splitIntoDays, SplitRequest } from './split-days';

// CAMP-46 — the dynamic programme that cuts a corridor into day-runs.
//
// 🔴 EVERY EXPECTED CHAIN BELOW IS WRITTEN OUT, and was found by exhaustive
// search in a throwaway script (every way to choose the nights, the best kept)
// — not by calling `splitIntoDays`. The one property test at the end carries
// its own exhaustive search for the same reason: the oracle is not the code.
//
// Kilometres in the fixtures, metres in the calls: `km()` is the only
// conversion, so a figure reads as it would on a map.

const km = (n: number) => n * 1000;

interface Cand extends Placement {
  km: number;
}
const at = (n: number, slug = `s${String(n).padStart(3, '0')}`): Cand => ({
  slug,
  along: km(n),
  km: n,
});

/** A 600 km corridor with a campsite every 15 km, 15..585: 39 of them. */
const GRID: Cand[] = Array.from({ length: 39 }, (_, i) => at(15 * (i + 1)));
const L = km(600);
const BAND = { minM: km(60), maxM: km(120) };

/**
 * What night k is worth: nearer to where it would fall on an even split of
 * the 600 km into seven, better. Written here, in kilometres, on purpose.
 */
const nearEven =
  (days: number) =>
  (c: Cand, k: number): number =>
    -Math.abs(c.km - (k * 600) / days);

const ask = (
  days: number,
  value: SplitRequest<Cand>['value'] = nearEven(days),
  band = BAND,
): SplitRequest<Cand> => ({ days, metres: L, band, value });

const nightsKm = (r: ReturnType<typeof splitIntoDays<Cand>>): number[] => {
  if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
  return r.nights.map((c) => c.km);
};

/** The smallest distance between ANY two points of a list, in km. */
const minGap = (xs: number[]): number =>
  Math.min(
    ...xs.flatMap((a, i) => xs.slice(i + 1).map((b) => Math.abs(a - b))),
  );

describe('seven days over 600 km, runs of 60 to 120 km', () => {
  it('anchors: the fixture has 39 campsites and is 600 km long', () => {
    expect(GRID).toHaveLength(39);
    expect(GRID[0].km).toBe(15);
    expect(GRID[38].km).toBe(585);
    expect(L).toBe(600_000);
  });

  it('places six nights, at 90, 165, 255, 345, 435 and 510 km', () => {
    const r = splitIntoDays(GRID, ask(7));
    expect(nightsKm(r)).toEqual([90, 165, 255, 345, 435, 510]);
  });

  it('every one of the seven runs is inside the band (75..90 km here, none outside 60..120)', () => {
    const r = splitIntoDays(GRID, ask(7));
    const along = [0, ...nightsKm(r), 600];
    const runs = along.slice(1).map((x, i) => x - along[i]);
    expect(runs).toEqual([90, 75, 90, 90, 90, 75, 90]);
    for (const run of runs) {
      expect(run).toBeGreaterThanOrEqual(60);
      expect(run).toBeLessThanOrEqual(120);
    }
  });

  it('the total is what the nights are worth: 25.71 below an even split', () => {
    const r = splitIntoDays(GRID, ask(7));
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.total).toBeCloseTo(-25.714285714, 6);
  });

  it('two days over the same 600 km cannot be done: the longest run allowed is 120 km', () => {
    const r = splitIntoDays(GRID, ask(2));
    expect(r).toEqual({
      status: 'infeasible',
      reason: 'band',
      reach: { minM: km(120), maxM: km(240) },
    });
  });

  it('eleven days cannot either: eleven runs of at least 60 km are 660 km', () => {
    const r = splitIntoDays(GRID, ask(11));
    expect(r).toEqual({
      status: 'infeasible',
      reason: 'band',
      reach: { minM: km(660), maxM: km(1320) },
    });
  });
});

describe('the edges of the band are inside it', () => {
  it('a run exactly as long as the band allows: five days of 120 km', () => {
    // 5 × 120 = 600: the only way to do it is four nights at 120, 240, 360, 480.
    expect(nightsKm(splitIntoDays(GRID, ask(5)))).toEqual([120, 240, 360, 480]);
  });

  it('a run exactly as short as the band allows: ten days of 60 km', () => {
    const r = splitIntoDays(GRID, ask(10, nearEven(10)));
    expect(nightsKm(r)).toEqual([60, 120, 180, 240, 300, 360, 420, 480, 540]);
  });

  it('one day, no nights: it fits when the whole corridor is one run', () => {
    const r = splitIntoDays([], {
      days: 1,
      metres: km(100),
      band: BAND,
      value: nearEven(1),
    });
    expect(r).toEqual({ status: 'ok', nights: [], total: 0 });
  });

  it('one day does not fit 600 km', () => {
    expect(splitIntoDays(GRID, ask(1))).toEqual({
      status: 'infeasible',
      reason: 'band',
      reach: { minM: km(60), maxM: km(120) },
    });
  });
});

describe('the first and the last run keep to the band as well', () => {
  // Two days over 600 km, runs of 60 to 600 km: one night. A campsite worth
  // 100 stands 20 km from one end; the one worth 1 is in the middle.
  const wide = { minM: km(60), maxM: km(600) };
  const day2 = (value: SplitRequest<Cand>['value']) => ask(2, value, wide);
  const worth = (best: string) => (c: Cand) => (c.slug === best ? 100 : 1);

  it('20 km from A is closer than a 60 km run allows: not the night, however good', () => {
    const r = splitIntoDays(
      [at(20, 'by-A'), at(300, 'middle')],
      day2(worth('by-A')),
    );
    expect(nightsKm(r)).toEqual([300]);
  });

  it('20 km from B is closer than a 60 km run allows: not the night, however good', () => {
    const r = splitIntoDays(
      [at(580, 'by-B'), at(300, 'middle')],
      day2(worth('by-B')),
    );
    expect(nightsKm(r)).toEqual([300]);
  });

  it('anchors: each of the two is a night when the band lets it be', () => {
    const open = { minM: km(10), maxM: km(600) };
    const wideOpen = (best: string) => ask(2, worth(best), open);
    expect(
      nightsKm(
        splitIntoDays([at(20, 'by-A'), at(300, 'middle')], wideOpen('by-A')),
      ),
    ).toEqual([20]);
    expect(
      nightsKm(
        splitIntoDays([at(580, 'by-B'), at(300, 'middle')], wideOpen('by-B')),
      ),
    ).toEqual([580]);
  });
});

describe('seven days, six stops in one place', () => {
  // Eight campsites within 7 km of each other, 85..92 km out — exactly where
  // night 1 falls — each worth about 100 more than any grid campsite. They are
  // the best nights there are, and the programme may use ONE of them: the runs
  // between nights are at least 60 km.
  const TOWN: Cand[] = 'abcdefgh'
    .split('')
    .map((ch, i) => at(85 + i, `town-${ch}`));
  const WITH_TOWN = [...GRID, ...TOWN];
  // town-a is worth 100, town-b 99.5, ... town-h 96.5.
  const value = (c: Cand, k: number) =>
    c.slug.startsWith('town-')
      ? 100 - (c.slug.charCodeAt(5) - 'a'.charCodeAt(0)) * 0.5
      : nearEven(7)(c, k);

  it('anchors: all eight are candidates and are the best-valued there are', () => {
    expect(WITH_TOWN).toHaveLength(47);
    expect(TOWN).toHaveLength(8);
    expect(minGap(TOWN.map((c) => c.km))).toBe(1);
    for (const t of TOWN) expect(value(t, 1)).toBeGreaterThan(90);
  });

  it('uses exactly one of them, and the best of them', () => {
    const r = splitIntoDays(WITH_TOWN, ask(7, value));
    const chosen = nightsKm(r);
    const slugs = (r as { nights: Cand[] }).nights.map((c) => c.slug);
    expect(slugs.filter((s) => s.startsWith('town-'))).toEqual(['town-a']);
    expect(chosen[0]).toBe(85);
  });

  it('no two nights are closer than the band allows: 60 km', () => {
    const r = splitIntoDays(WITH_TOWN, ask(7, value));
    expect(minGap(nightsKm(r))).toBeGreaterThanOrEqual(60);
  });
});

describe('a refusal says where it ran out', () => {
  it('a 140 km hole in the middle: three nights placed, the fourth has nowhere to go', () => {
    // Nothing between 200 and 340 km; the longest run allowed is 120 km.
    const hole = GRID.filter((c) => c.km <= 200 || c.km >= 340);
    expect(hole).toHaveLength(30);
    expect(splitIntoDays(hole, ask(7))).toEqual({
      status: 'infeasible',
      reason: 'no-chain',
      reachedNights: 3,
    });
  });

  it('nothing near the end: all six nights placed, none can reach B', () => {
    // The last night must be at 480 km or beyond.
    const short = GRID.filter((c) => c.km <= 450);
    expect(splitIntoDays(short, ask(7))).toEqual({
      status: 'infeasible',
      reason: 'no-chain',
      reachedNights: 6,
    });
  });

  it('nothing within the first run: no night can be placed at all', () => {
    const late = GRID.filter((c) => c.km >= 130);
    expect(splitIntoDays(late, ask(7))).toEqual({
      status: 'infeasible',
      reason: 'no-chain',
      reachedNights: 0,
    });
  });

  it('no campsite at all is not a corridor', () => {
    expect(splitIntoDays([], ask(7))).toEqual({
      status: 'infeasible',
      reason: 'no-chain',
      reachedNights: 0,
    });
  });
});

describe('one input, one answer', () => {
  /** A small, fixed generator: a test must not be random. */
  const lcg = (seed: number) => () =>
    (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  const shuffled = <T>(xs: readonly T[], seed: number): T[] => {
    const next = lcg(seed);
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  it('the same input twice gives the same text', () => {
    const a = JSON.stringify(splitIntoDays(GRID, ask(7)));
    const b = JSON.stringify(splitIntoDays(GRID, ask(7)));
    expect(a).toBe(b);
  });

  it('the order the candidates arrive in changes nothing', () => {
    const want = [90, 165, 255, 345, 435, 510];
    expect(nightsKm(splitIntoDays([...GRID].reverse(), ask(7)))).toEqual(want);
    for (let seed = 1; seed <= 10; seed++) {
      expect(nightsKm(splitIntoDays(shuffled(GRID, seed), ask(7)))).toEqual(
        want,
      );
    }
  });

  it('the input is read, not rearranged', () => {
    const frozen = Object.freeze([...GRID].reverse());
    expect(() => splitIntoDays(frozen, ask(7))).not.toThrow();
    expect(frozen[0].km).toBe(585);
  });

  describe('a tie is decided by slug', () => {
    const flat = () => 5;

    it('between two predecessors: a-100 carries the chain on, though z-80 is earlier in line', () => {
      // 3 days over 300 km, runs 60..120: night 1 at 80 or 100, night 2 at 200
      // (200 − 80 = 120, the longest run allowed). 'z-80' and 'a-100' are worth
      // the same; 100 km is LATER along the line than 80, so a rule that took
      // "the first one in line" would pick z-80.
      const day3 = {
        days: 3,
        metres: km(300),
        band: BAND,
        value: flat,
      } as SplitRequest<Cand>;
      const only = [at(80, 'z-80'), at(100, 'a-100'), at(200, 'x-200')];
      for (let seed = 1; seed <= 30; seed++) {
        const r = splitIntoDays(shuffled(only, seed), day3);
        if (r.status !== 'ok') throw new Error('not ok');
        expect(r.nights.map((c) => c.slug)).toEqual(['a-100', 'x-200']);
      }
      // Anchor: both really were contenders — each alone gives a chain.
      for (const [keep, want] of [
        ['z-80', ['z-80', 'x-200']],
        ['a-100', ['a-100', 'x-200']],
      ] as const) {
        const alone = only.filter((c) => c.slug === keep || c.km === 200);
        const r = splitIntoDays(alone, day3);
        if (r.status !== 'ok') throw new Error('not ok');
        expect(r.nights.map((c) => c.slug)).toEqual(want);
      }
    });

    it('between two endings: a-320 is the last night, though z-280 is earlier in line', () => {
      const day2 = {
        days: 2,
        metres: km(600),
        band: { minM: km(60), maxM: km(540) },
        value: flat,
      } as SplitRequest<Cand>;
      const two = [at(280, 'z-280'), at(320, 'a-320')];
      for (let seed = 1; seed <= 30; seed++) {
        const r = splitIntoDays(shuffled(two, seed), day2);
        if (r.status !== 'ok') throw new Error('not ok');
        expect(r.nights.map((c) => c.slug)).toEqual(['a-320']);
      }
      // Anchor: each alone is a valid ending.
      for (const only of two) {
        const r = splitIntoDays([only], day2);
        expect(r.status).toBe('ok');
      }
    });
  });
});

describe('one bad record costs one record', () => {
  it('a night whose value is not a number cannot be that night; the rest chain on', () => {
    // 90 km is the best night 1; without it, 75 is.
    const nan = (c: Cand, k: number) =>
      c.km === 90 && k === 1 ? NaN : nearEven(7)(c, k);
    expect(nightsKm(splitIntoDays(GRID, ask(7, nan)))).toEqual([
      75, 165, 255, 345, 435, 510,
    ]);
  });

  it('nor can one whose value is infinite, at night 1', () => {
    // Infinity would be the best night there is, and is not a worth.
    const inf = (c: Cand, k: number) =>
      c.km === 90 && k === 1 ? Infinity : nearEven(7)(c, k);
    expect(nightsKm(splitIntoDays(GRID, ask(7, inf)))).toEqual([
      75, 165, 255, 345, 435, 510,
    ]);
  });

  it('nor at night 3: 255 km is the best night 3, without it 270 is', () => {
    const inf = (c: Cand, k: number) =>
      c.km === 255 && k === 3 ? Infinity : nearEven(7)(c, k);
    expect(nightsKm(splitIntoDays(GRID, ask(7, inf)))).toEqual([
      90, 165, 270, 345, 435, 510,
    ]);
  });

  it('a campsite that cannot be placed is left out, and the answer is the same as without it', () => {
    const bad: Cand = { slug: 'bad', along: NaN, km: NaN };
    const withBad = splitIntoDays(
      [...GRID, bad],
      ask(7, () => 1000),
    );
    const without = splitIntoDays(
      GRID,
      ask(7, () => 1000),
    );
    expect(withBad).toEqual(without);
    expect(withBad.status).toBe('ok');
  });
});

describe('a request that is not a question throws', () => {
  it.each([
    ['days 0', { days: 0 }, /days/],
    ['days 2.5', { days: 2.5 }, /days/],
    ['zero minM', { band: { minM: 0, maxM: km(120) } }, /minM/],
    ['negative minM', { band: { minM: -1, maxM: km(120) } }, /minM/],
    ['maxM below minM', { band: { minM: km(120), maxM: km(60) } }, /maxM/],
    ['NaN maxM', { band: { minM: km(60), maxM: NaN } }, /maxM/],
    ['zero length', { metres: 0 }, /metres/],
  ])('%s', (_, over, msg) => {
    expect(() => splitIntoDays(GRID, { ...ask(7), ...over })).toThrow(msg);
  });
});

describe('against an exhaustive search', () => {
  // The oracle is written here and shares nothing with the code: it tries
  // every way to choose the nights and keeps the best total.
  function exhaustive(
    cands: Cand[],
    days: number,
    metres: number,
    band: { minM: number; maxM: number },
    value: (c: Cand, k: number) => number,
  ): { total: number; slugs: string[] } | null {
    let best: { total: number; slugs: string[] } | null = null;
    const walk = (k: number, from: number, total: number, slugs: string[]) => {
      if (k === days) {
        const run = metres - from;
        if (
          run >= band.minM &&
          run <= band.maxM &&
          (!best || total > best.total)
        ) {
          best = { total, slugs };
        }
        return;
      }
      for (const c of cands) {
        const run = c.along - from;
        if (run >= band.minM && run <= band.maxM) {
          walk(k + 1, c.along, total + value(c, k), [...slugs, c.slug]);
        }
      }
    };
    walk(1, 0, 0, []);
    return best;
  }

  it('agrees on 300 random corridors: the same verdict, the same nights, the same total', () => {
    let seed = 12345;
    const next = () =>
      (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    let ok = 0;
    let refused = 0;
    for (let t = 0; t < 300; t++) {
      const days = 2 + Math.floor(next() * 4); // 2..5
      const metres = km(100 + Math.floor(next() * 400));
      // A band that brackets an even split, so the arithmetic allows it and
      // the candidates decide.
      const even = metres / days;
      const minM = Math.floor(even * (0.4 + next() * 0.5));
      const maxM = Math.ceil(even * (1.05 + next() * 0.8));
      const n = 8 + Math.floor(next() * 9);
      const cands: Cand[] = Array.from({ length: n }, (_, i) => {
        const along = Math.floor(next() * metres);
        return { slug: `r${i}`, along, km: along / 1000 };
      });
      // Distinct float values, so a tie is not what this checks.
      const worth = new Map<string, number>();
      const value = (c: Cand, k: number) => {
        const key = `${c.slug}/${k}`;
        if (!worth.has(key)) worth.set(key, next());
        return worth.get(key) as number;
      };
      const want = exhaustive(cands, days, metres, { minM, maxM }, value);
      const got = splitIntoDays(cands, {
        days,
        metres,
        band: { minM, maxM },
        value,
      });
      if (want) {
        ok++;
        if (got.status !== 'ok')
          throw new Error(`#${t}: refused, but a chain exists`);
        expect(got.nights.map((c) => c.slug)).toEqual(want.slugs);
        expect(got.total).toBeCloseTo(want.total, 9);
      } else {
        refused++;
        expect(got.status).toBe('infeasible');
      }
    }
    // The fixture reaches both branches; a run of one kind proves nothing.
    expect(ok).toBeGreaterThanOrEqual(60);
    expect(refused).toBeGreaterThanOrEqual(60);
  });
});
