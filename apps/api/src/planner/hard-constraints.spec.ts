import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EU_MEMBER_STATES } from '../osm/eu';
import { AMENITY_KEYS, AmenityValue } from '../osm/tag-mapping';
import { COVERAGE_FLOOR, CoverageSnapshot, shareOf } from './coverage-snapshot';
import {
  amenityState,
  assertHardAllowed,
  checkHard,
  corridorBox,
  HARD,
  HardRequest,
  HardRule,
  hardWhere,
  lineGeoJson,
  LonLat,
  loadMeasuredHardConstraints,
  needsOf,
  sourceCountryCodes,
  validateRequest,
} from './hard-constraints';

// CAMP-246 / CAMP-260 — the parts of stage 1 that need no database. What the
// rules DO to rows is in hard-constraints.db.spec.ts; this file holds the
// declared list, the guard on it, the request check and the arithmetic.

const fileSnapshot = (): CoverageSnapshot =>
  JSON.parse(
    readFileSync(join(__dirname, 'coverage.snapshot.json'), 'utf8'),
  ) as CoverageSnapshot;

/** A table of our own, to test the guard at its edge. */
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

const noSql = () => ({ where: '', params: [] });
const byValue = (field: string | undefined): HardRule => ({
  id: 'by-value-test',
  rejects: 'by-value',
  field,
  sql: noSql,
});

const REQ: HardRequest = {
  line: [
    [14, 45],
    [14, 46],
  ],
  bufferM: 30_000,
};

describe('the declared list', () => {
  it('is exactly these four rules, in this order — adding one is a decision', () => {
    expect(HARD.map((r) => r.id)).toEqual([
      'page',
      'country',
      'corridor',
      'needs',
    ]);
  });

  it('says for each what it may reject on', () => {
    expect(Object.fromEntries(HARD.map((r) => [r.id, r.rejects]))).toEqual({
      page: 'structural',
      country: 'structural',
      corridor: 'by-value',
      needs: 'recorded-no',
    });
  });

  it('holds no rule that rejects by the value of an amenity', () => {
    // The sentence of CAMP-260 as a property of the list: whatever is by
    // value stands on a field known for more than the floor, and no amenity
    // is.
    const snapshot = fileSnapshot();
    for (const r of HARD.filter((x) => x.rejects === 'by-value')) {
      expect((AMENITY_KEYS as readonly string[]).includes(r.field ?? '')).toBe(
        false,
      );
      expect(shareOf(snapshot, r.field ?? '')).toBeGreaterThan(COVERAGE_FLOOR);
    }
  });

  it('is frozen, so nothing adds a rule at run time and skips the guard', () => {
    expect(Object.isFrozen(HARD)).toBe(true);
  });
});

describe('assertHardAllowed: a rule by value stands only on a field known for over half', () => {
  it('accepts the shipped rules against the shipped table', () => {
    const snapshot = fileSnapshot();
    // Anchor: the table has the field the shipped rule stands on, and it is
    // not borderline — a pass at 51% would say little about the next import.
    expect(shareOf(snapshot, 'location')).toBeGreaterThan(0.9);
    expect(() => assertHardAllowed(snapshot)).not.toThrow();
    expect(loadMeasuredHardConstraints()).toBe(HARD);
  });

  it('refuses a rule by value on dogFriendly, and says the share the file holds', () => {
    const snapshot = fileSnapshot();
    const share = shareOf(snapshot, 'dogFriendly');
    // Anchor: the premise is that this field is below the floor.
    expect(share).toBeLessThan(COVERAGE_FLOOR);
    const rule: HardRule = { ...byValue('dogFriendly'), id: 'dog-by-value' };
    let message = '';
    try {
      assertHardAllowed(snapshot, [...HARD, rule]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^CAMP-246 hard constraints refuse to load:/);
    expect(message).toContain(
      `dog-by-value: hard constraint on dogFriendly: known for only ${(share! * 100).toFixed(1)}%`,
    );
  });

  it('refuses every amenity as a by-value field, not just the one that was tried', () => {
    const snapshot = fileSnapshot();
    for (const key of AMENITY_KEYS) {
      const problems = checkHard([byValue(key)], snapshot);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`on ${key}: known for only`);
    }
  });

  it('allows exactly the floor + a hair, and refuses the floor itself', () => {
    // known / n = 0.5 exactly is NOT "more than half".
    expect(checkHard([byValue('f')], table({ f: 5_000 }))).toHaveLength(1);
    expect(checkHard([byValue('f')], table({ f: 5_001 }))).toEqual([]);
    expect(checkHard([byValue('f')], table({ f: 4_999 }))).toHaveLength(1);
  });

  it('a field nobody measured is a failure, never a pass', () => {
    const problems = checkHard(
      [byValue('nobody-counted-this')],
      fileSnapshot(),
    );
    expect(problems).toEqual([
      'by-value-test: field "nobody-counted-this" is not in the coverage snapshot',
    ]);
  });

  it('a by-value rule that names no field is refused', () => {
    expect(checkHard([byValue(undefined)], fileSnapshot())).toEqual([
      'by-value-test: rejects by value but names no field',
    ]);
  });

  it('a recorded-no rule needs no coverage: it cannot reject what is not recorded', () => {
    const snapshot = fileSnapshot();
    // Anchor: the field really is below the floor, so a pass is the rule's
    // doing and not an accident of a well-covered field.
    expect(shareOf(snapshot, 'dogFriendly')).toBeLessThan(COVERAGE_FLOOR);
    const noOnly: HardRule = {
      id: 'dog-no',
      rejects: 'recorded-no',
      field: 'dogFriendly',
      sql: noSql,
    };
    expect(checkHard([noOnly], snapshot)).toEqual([]);
  });

  it('a rule listed twice is refused', () => {
    expect(checkHard([HARD[0], HARD[0]], fileSnapshot())).toEqual([
      'page: listed twice',
    ]);
  });
});

describe('validateRequest: a request that would filter nothing, or everything, throws', () => {
  it('accepts the plain request, and a one-point request (a disc)', () => {
    expect(() => validateRequest(REQ)).not.toThrow();
    expect(() =>
      validateRequest({ line: [[14, 45]], bufferM: 1000 }),
    ).not.toThrow();
  });

  it('refuses an amenity we do not record — `IS DISTINCT FROM no` would pass everyone', () => {
    expect(() =>
      validateRequest({ ...REQ, needs: ['electrcity' as never] }),
    ).toThrow(/"electrcity" is not an amenity we record/);
  });

  it('accepts every amenity we do record', () => {
    expect(() =>
      validateRequest({ ...REQ, needs: AMENITY_KEYS }),
    ).not.toThrow();
  });

  it('refuses a country outside the Union, instead of filtering everything', () => {
    expect(() => validateRequest({ ...REQ, countries: ['CH'] })).toThrow(
      /"CH" is not an EU member state/,
    );
    expect(() => validateRequest({ ...REQ, countries: ['UK'] })).toThrow(
      /not an EU member state/,
    );
  });

  it('refuses an EMPTY country list instead of reading it as "none" and rejecting everything', () => {
    expect(() => validateRequest({ ...REQ, countries: [] })).toThrow(
      /an empty list; omit it/,
    );
  });

  it('accepts Greece as EL, Åland as AX, and any case', () => {
    expect(() =>
      validateRequest({ ...REQ, countries: ['EL', 'ax', 'fr'] }),
    ).not.toThrow();
  });

  it.each([
    ['no line', { ...REQ, line: [] }],
    ['a point with one number', { ...REQ, line: [[14] as never] }],
    ['NaN', { ...REQ, line: [[NaN, 45] as LonLat] }],
    ['latitude 91', { ...REQ, line: [[14, 91] as LonLat] }],
    ['longitude -181', { ...REQ, line: [[-181, 45] as LonLat] }],
    ['a buffer of 0', { ...REQ, bufferM: 0 }],
    ['a negative buffer', { ...REQ, bufferM: -1 }],
    ['an infinite buffer', { ...REQ, bufferM: Infinity }],
    ['a buffer in a string', { ...REQ, bufferM: '30000' as never }],
  ])('refuses %s', (_name, req) => {
    expect(() => validateRequest(req as HardRequest)).toThrow();
  });
});

describe('sourceCountryCodes: the codes the SOURCE writes, not the 27', () => {
  it('is 28 codes by default: the 27 member states and Åland', () => {
    const codes = sourceCountryCodes();
    // Anchor on the member list, so "27 + 1" is about the Union and not
    // about whatever the list happens to hold.
    expect(EU_MEMBER_STATES).toHaveLength(27);
    expect(codes).toHaveLength(28);
    expect(codes).toContain('ax');
    for (const m of EU_MEMBER_STATES) expect(codes).toContain(m);
  });

  it('asking for Finland brings Åland with it, because the source codes it AX', () => {
    expect([...sourceCountryCodes(['FI'])].sort()).toEqual(['ax', 'fi']);
  });

  it('asking for Greece as EL or as GR is one answer, GR — the code the source uses', () => {
    expect(sourceCountryCodes(['EL'])).toEqual(['gr']);
    expect(sourceCountryCodes(['GR'])).toEqual(['gr']);
  });

  it('is case-blind and de-duplicates', () => {
    expect(sourceCountryCodes(['fr', 'FR', 'Fr'])).toEqual(['fr']);
  });

  it('asking for Sweden does not bring Finland', () => {
    expect(sourceCountryCodes(['SE'])).toEqual(['se']);
  });
});

describe('corridorBox: the index prefilter may never be tighter than the exact distance', () => {
  // The oracle is NOT the formula under test. It is the textbook spherical
  // destination point: from (lat, lon), going `d` metres on bearing `b`.
  const R = 6_371_008.8;
  const rad = (x: number) => (x * Math.PI) / 180;
  const deg = (x: number) => (x * 180) / Math.PI;
  function destination(p: LonLat, bearingDeg: number, d: number): LonLat {
    const φ1 = rad(p[1]);
    const λ1 = rad(p[0]);
    const θ = rad(bearingDeg);
    const δ = d / R;
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
    );
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
      );
    return [deg(λ2), deg(φ2)];
  }

  it.each([0, 30, 45, 60, 65, 70])(
    'holds every point exactly bufferM from a vertex, in every direction, at latitude %i',
    (lat) => {
      const buffer = 30_000;
      const line: LonLat[] = [
        [14, lat],
        [16, lat + 1],
      ];
      const [x0, y0, x1, y1] = corridorBox(line, buffer);
      for (const vertex of line) {
        for (let bearing = 0; bearing < 360; bearing += 7) {
          const [lon, la] = destination(vertex, bearing, buffer);
          expect(lon).toBeGreaterThanOrEqual(x0);
          expect(lon).toBeLessThanOrEqual(x1);
          expect(la).toBeGreaterThanOrEqual(y0);
          expect(la).toBeLessThanOrEqual(y1);
        }
      }
    },
  );

  // 🔴 THE VERTICES ARE NOT THE LINE. ST_DWithin on a `geography` measures to
  // the great-circle ARC between two vertices, and between two points at the
  // same latitude that arc bows toward the pole: Madrid (40.4°N) and
  // Thessaloniki (40.6°N) are joined by an arc that climbs to 41.5°N half-way.
  // The test above tries points `bufferM` from each VERTEX, which is where the
  // arc bows least; a box built from the vertices passes it, and cut 249 of
  // 370 campsites from the real route. So the oracle below walks the arc
  // itself: every 5 km along the great circle (spherical interpolation, not
  // the formula under test), and from each step every 10° of bearing.
  function greatCircle(a: LonLat, b: LonLat, stepM: number): LonLat[] {
    const v = ([lon, lat]: LonLat): [number, number, number] => [
      Math.cos(rad(lat)) * Math.cos(rad(lon)),
      Math.cos(rad(lat)) * Math.sin(rad(lon)),
      Math.sin(rad(lat)),
    ];
    const va = v(a);
    const vb = v(b);
    const w = Math.acos(
      Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]),
    );
    const steps = Math.max(1, Math.ceil((w * R) / stepM));
    const out: LonLat[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const k1 = w === 0 ? 1 : Math.sin((1 - t) * w) / Math.sin(w);
      const k2 = w === 0 ? 0 : Math.sin(t * w) / Math.sin(w);
      const x = va.map((c, j) => k1 * c + k2 * vb[j]);
      out.push([
        deg(Math.atan2(x[1], x[0])),
        deg(Math.atan2(x[2], Math.hypot(x[0], x[1]))),
      ]);
    }
    return out;
  }
  const arcOf = (line: readonly LonLat[]): LonLat[] =>
    line.slice(1).flatMap((p, i) => greatCircle(line[i], p, 5_000));

  // [name, line, which way the arc bows, and by how many degrees of latitude
  // at least, beyond the ends of its leg — the fixture must REACH the bow, or
  // this proves nothing about it. Measured with the same walk below.]
  const BOWS: Array<[string, LonLat[], 'north' | 'south' | 'none', number]> = [
    [
      'Madrid → Thessaloniki',
      [
        [-3.7038, 40.4168],
        [22.9444, 40.6401],
      ],
      'north',
      0.6,
    ],
    [
      'Dublin → Warsaw',
      [
        [-6.2603, 53.3498],
        [21.0122, 52.2297],
      ],
      'north',
      0.3,
    ],
    [
      'the same route in the southern hemisphere',
      [
        [-3.7038, -40.4168],
        [22.9444, -40.6401],
      ],
      'south',
      0.6,
    ],
    [
      'out and back: Madrid → Thessaloniki → Vinaròs, two bowing legs',
      [
        [-3.7038, 40.4168],
        [22.9444, 40.6401],
        [0.4753, 40.47],
      ],
      'north',
      0.4,
    ],
    [
      'Lyon → Barcelona, which runs almost along a meridian',
      [
        [4.8357, 45.764],
        [2.1734, 41.3851],
      ],
      'none',
      0,
    ],
  ];

  it.each(BOWS)(
    'holds every point bufferM from the arc itself, along its whole length: %s',
    (_name, line, direction, minBow) => {
      const buffer = 30_000;
      const [x0, y0, x1, y1] = corridorBox(line, buffer);
      const arc = arcOf(line);
      // The fixture reaches the bow: on some leg the arc's own extreme lies
      // beyond BOTH of that leg's ends by at least what the route is known
      // to bow. (Per leg: on a road the bow of one leg can sit inside the
      // box of the others, and then nothing about it is tested.)
      const lats = arc.map((p) => p[1]);
      let bowNorth = 0;
      let bowSouth = 0;
      for (let i = 1; i < line.length; i++) {
        const legLats = greatCircle(line[i - 1], line[i], 5_000).map(
          (p) => p[1],
        );
        const ends = [line[i - 1][1], line[i][1]];
        bowNorth = Math.max(bowNorth, Math.max(...legLats) - Math.max(...ends));
        bowSouth = Math.max(bowSouth, Math.min(...ends) - Math.min(...legLats));
      }
      if (direction === 'north') expect(bowNorth).toBeGreaterThan(minBow);
      if (direction === 'south') expect(bowSouth).toBeGreaterThan(minBow);
      if (direction === 'none') {
        expect(bowNorth).toBeLessThan(0.05);
        expect(bowSouth).toBeLessThan(0.05);
      }

      const outside: unknown[] = [];
      for (const p of arc) {
        for (let bearing = 0; bearing < 360; bearing += 10) {
          const [lon, la] = destination(p, bearing, buffer);
          if (lon < x0 || lon > x1 || la < y0 || la > y1) {
            if (outside.length < 3) outside.push({ from: p, bearing, lon, la });
          }
        }
      }
      // Read as: the first three points the box would have cut off.
      expect(outside).toEqual([]);

      // And it is the arc's box, not a pad: no more than 5% of a buffer's
      // width of latitude beyond the arc's own extremes.
      const trueLat = deg(buffer / R);
      expect(y1 - Math.max(...lats)).toBeLessThan(trueLat * 1.05);
      expect(Math.min(...lats) - y0).toBeLessThan(trueLat * 1.05);
    },
  );

  it('is wider in degrees of longitude the further north the line is', () => {
    const wide = (lat: number) => {
      const [x0, , x1] = corridorBox([[14, lat]], 30_000);
      return x1 - x0;
    };
    expect(wide(65)).toBeGreaterThan(wide(45) * 1.5);
    expect(wide(45)).toBeGreaterThan(wide(0) * 1.3);
  });

  it('is not absurdly loose: under 5% wider than the true extent at 45 degrees', () => {
    const buffer = 30_000;
    const [x0, y0, x1, y1] = corridorBox([[14, 45]], buffer);
    const trueLat = deg(buffer / R); // degrees of latitude
    expect((y1 - y0) / 2 / trueLat).toBeLessThan(1.05);
    expect((y1 - y0) / 2 / trueLat).toBeGreaterThan(1);
    // Longitude at 45°: the true half-width is trueLat / cos(45°).
    const trueLon = trueLat / Math.cos(rad(45));
    expect((x1 - x0) / 2 / trueLon).toBeLessThan(1.08);
    expect((x1 - x0) / 2 / trueLon).toBeGreaterThan(1);
  });

  it('takes a road-sized polyline: 300 000 vertices do not overflow the stack', () => {
    // `Math.min(...coords)` throws RangeError somewhere past ~120 000
    // arguments; a road's geometry is that long.
    const road: LonLat[] = Array.from({ length: 300_000 }, (_, i) => [
      i / 100_000,
      45 + i / 300_000,
    ]);
    const [x0, y0, x1, y1] = corridorBox(road, 30_000);
    expect(x0).toBeLessThan(0);
    expect(x1).toBeGreaterThan(2.99);
    expect(y0).toBeLessThan(45);
    expect(y1).toBeGreaterThan(45.99);
  });

  it('stays on the globe', () => {
    const [x0, y0, x1, y1] = corridorBox([[179.9, 89.9]], 500_000);
    expect(x0).toBeGreaterThanOrEqual(-180);
    expect(x1).toBeLessThanOrEqual(180);
    expect(y0).toBeGreaterThanOrEqual(-90);
    expect(y1).toBeLessThanOrEqual(90);
    expect([x0, y0, x1, y1].every(Number.isFinite)).toBe(true);
  });
});

describe('lineGeoJson', () => {
  it('a corridor is a LineString in lon, lat order', () => {
    expect(JSON.parse(lineGeoJson(REQ.line))).toEqual({
      type: 'LineString',
      coordinates: [
        [14, 45],
        [14, 46],
      ],
    });
  });

  it('one point is a Point', () => {
    expect(JSON.parse(lineGeoJson([[14, 45]]))).toEqual({
      type: 'Point',
      coordinates: [14, 45],
    });
  });

  it('two equal points are a Point, not a degenerate line', () => {
    expect(
      JSON.parse(
        lineGeoJson([
          [14, 45],
          [14, 45],
        ]),
      ).type,
    ).toBe('Point');
  });

  it('keeps a real repeat later in the line', () => {
    const out = JSON.parse(
      lineGeoJson([
        [14, 45],
        [14, 45],
        [15, 45],
        [14, 45],
      ]),
    );
    expect(out.coordinates).toEqual([
      [14, 45],
      [15, 45],
      [14, 45],
    ]);
  });
});

describe('hardWhere', () => {
  it('numbers its parameters from where the caller stopped, with no gaps', () => {
    const { where, params } = hardWhere(
      { ...REQ, needs: ['electricity', 'dogFriendly'] },
      's',
      3,
    );
    const used = [...where.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...used)).toBe(4);
    expect(Math.max(...used)).toBe(3 + params.length);
    expect(new Set(used).size).toBe(params.length);
  });

  it('puts the amenity KEYS in the parameters, never in the SQL text', () => {
    const { where, params } = hardWhere({
      ...REQ,
      needs: ['electricity', 'dogFriendly'],
    });
    expect(params).toContain('electricity');
    expect(params).toContain('dogFriendly');
    expect(where).not.toContain('electricity');
    expect(where).not.toContain('dogFriendly');
  });

  it('asks nothing for an amenity when none is required', () => {
    const none = hardWhere(REQ);
    const some = hardWhere({ ...REQ, needs: ['electricity'] });
    expect(some.params.length).toBe(none.params.length + 1);
    expect(none.where).not.toMatch(/DISTINCT FROM/);
  });

  it('asks about each required amenity once, however often it is named', () => {
    const once = hardWhere({ ...REQ, needs: ['electricity'] });
    const thrice = hardWhere({
      ...REQ,
      needs: ['electricity', 'electricity', 'electricity'],
    });
    expect(thrice.params).toEqual(once.params);
  });

  it('refuses an invalid request before it builds anything', () => {
    expect(() => hardWhere({ ...REQ, bufferM: 0 })).toThrow(/bufferM/);
  });
});

describe('amenityState and needsOf: three states, and nothing else', () => {
  it('reads yes, no and unknown as themselves', () => {
    const a = { electricity: 'yes', water: 'no', shower: 'unknown' };
    expect(amenityState(a, 'electricity')).toBe(AmenityValue.YES);
    expect(amenityState(a, 'water')).toBe(AmenityValue.NO);
    expect(amenityState(a, 'shower')).toBe(AmenityValue.UNKNOWN);
  });

  it.each([
    ['a missing key', {}],
    ['a word that is not one of the three', { electricity: 'maybe' }],
    ['a boolean', { electricity: true }],
    ['null', { electricity: null }],
    ['an empty string', { electricity: '' }],
    ['`YES` in capitals', { electricity: 'YES' }],
  ])('%s is unknown, never a no', (_name, amenities) => {
    expect(amenityState(amenities, 'electricity')).toBe(AmenityValue.UNKNOWN);
  });

  it.each([null, undefined, 'yes', 7, ['yes']])(
    'a stored value that is not an object (%p) knows nothing',
    (amenities) => {
      expect(amenityState(amenities, 'electricity')).toBe(AmenityValue.UNKNOWN);
    },
  );

  it('lists each required amenity once, in the order asked', () => {
    expect(
      needsOf({ electricity: 'yes', dogFriendly: 'unknown' }, [
        'dogFriendly',
        'electricity',
        'dogFriendly',
      ]),
    ).toEqual([
      { key: 'dogFriendly', state: 'unknown' },
      { key: 'electricity', state: 'yes' },
    ]);
  });

  it('says nothing when nothing was required', () => {
    expect(needsOf({ electricity: 'yes' })).toEqual([]);
  });
});
