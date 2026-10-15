import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AMENITY_KEYS } from '../osm/tag-mapping';
import { CoverageSnapshot } from './coverage-snapshot';
import {
  checkReasons,
  loadMeasuredReasons,
  loadReasons,
  NEAR_M,
  Reason,
  ReasonInput,
  REASON_SOURCES,
  reasonsOf,
  textOf,
} from './reasons';
import { COMPONENTS, ComponentDef, score } from './scoring';

// CAMP-245 — "why this one", taken apart. The card's own three sentences are
// the three blocks below it: a substituted value changes the text, a deleted
// field removes the reason (it does not leave one with an empty number), and
// a campsite we hold only coordinates for gets none.
//
// 🔴 EVERY EXPECTED STRING AND NUMBER IS WRITTEN OUT. None is built by
// `textOf`, `formatDistance` or `NEAR_M`: a spec that computed its expectation
// with the function under test would agree with a wrong one (and has, in this
// directory, four times).

const real = (): CoverageSnapshot =>
  JSON.parse(readFileSync(join(__dirname, 'coverage.snapshot.json'), 'utf8'));

const CONFIG = loadReasons(REASON_SOURCES, real());
const reasons = (input: ReasonInput, components = COMPONENTS): Reason[] =>
  reasonsOf(input, CONFIG, components);
const fieldsOf = (input: ReasonInput): string[] =>
  reasons(input).map((r) => r.field);

/**
 * One record that holds something for EVERY source — and for things that are
 * NOT sources: wifi and dogFriendly are recorded `yes`, and the context
 * carries an elevation, a terrain and the computation's own coordinates. None
 * of those may become a reason.
 */
const FULL: ReasonInput = {
  amenities: {
    electricity: 'yes',
    greyWater: 'yes',
    wifi: 'yes',
    dogFriendly: 'yes',
  },
  stars: 4,
  context: {
    water: { m: 346, kind: 'river', name: 'Le Loing' },
    supermarket: { m: 137, name: 'E.Leclerc' },
    station: { m: 948, name: 'Moret-sur-Loing' },
    town: { m: 640, name: 'Moret' },
    elevation: 85,
    terrain: { relief: 40, type: 'rolling' },
    at: { lat: 48.38, lon: 2.8 },
  },
};

const FULL_REASONS: Reason[] = [
  {
    field: 'electricity',
    value: 'yes',
    unit: null,
    weighed: true,
    text: 'Our database records electricity at this campsite',
  },
  {
    field: 'greyWater',
    value: 'yes',
    unit: null,
    weighed: true,
    text: 'Our database records grey-water disposal at this campsite',
  },
  {
    field: 'stars',
    value: 4,
    unit: 'stars',
    weighed: true,
    text: '4-star official classification',
  },
  {
    field: 'context.water',
    value: 346,
    unit: 'm',
    kind: 'river',
    name: 'Le Loing',
    weighed: false,
    text: 'River (Le Loing) 346 m away in a straight line',
  },
  {
    field: 'context.supermarket',
    value: 137,
    unit: 'm',
    name: 'E.Leclerc',
    weighed: false,
    text: 'Supermarket (E.Leclerc) 137 m away in a straight line',
  },
  {
    field: 'context.station',
    value: 948,
    unit: 'm',
    name: 'Moret-sur-Loing',
    weighed: false,
    text: 'Railway station (Moret-sur-Loing) 948 m away in a straight line',
  },
  {
    field: 'context.town',
    value: 640,
    unit: 'm',
    name: 'Moret',
    weighed: false,
    text: 'Town (Moret) 640 m away in a straight line',
  },
];

/** A copy of FULL with one thing changed — never the shared object. */
function withContext(key: string, value: unknown): ReasonInput {
  const context = { ...(FULL.context as Record<string, unknown>) };
  if (value === DELETE) delete context[key];
  else context[key] = value;
  return { ...FULL, context };
}
function withAmenity(key: string, value: unknown): ReasonInput {
  const amenities = { ...(FULL.amenities as Record<string, unknown>) };
  if (value === DELETE) delete amenities[key];
  else amenities[key] = value;
  return { ...FULL, amenities };
}
const DELETE = Symbol('delete the key');

const without = (field: string): Reason[] =>
  FULL_REASONS.filter((r) => r.field !== field);

describe('the anchor: a record that holds everything gives exactly these seven', () => {
  it('in this order, with the machine part and the sentence of each', () => {
    expect(reasons(FULL)).toEqual(FULL_REASONS);
  });

  it('and nothing for the things that are recorded and are not sources', () => {
    // wifi and dogFriendly are `yes`; elevation, terrain and `at` are in the
    // context. Seven reasons above, and not nine, ten or eleven.
    expect(reasons(FULL)).toHaveLength(7);
    for (const r of reasons(FULL)) {
      expect(r.text).not.toMatch(/wi-?fi|dog|elevation|terrain|relief/i);
    }
  });
});

describe('🔴 a substituted value changes the sentence — and the machine part with it', () => {
  // [field, input A, text A, input B, text B]
  const cases: Array<
    [string, ReasonInput, string, ReasonInput, string, number, number]
  > = [
    [
      'stars',
      { stars: 4 },
      '4-star official classification',
      { stars: 5 },
      '5-star official classification',
      4,
      5,
    ],
    [
      'context.water',
      { context: { water: { m: 800, kind: 'lake' } } },
      'Lake 800 m away in a straight line',
      { context: { water: { m: 640, kind: 'lake' } } },
      'Lake 640 m away in a straight line',
      800,
      640,
    ],
    [
      'context.supermarket',
      { context: { supermarket: { m: 137 } } },
      'Supermarket 137 m away in a straight line',
      { context: { supermarket: { m: 205 } } },
      'Supermarket 205 m away in a straight line',
      137,
      205,
    ],
    [
      'context.station',
      { context: { station: { m: 948 } } },
      'Railway station 948 m away in a straight line',
      { context: { station: { m: 1500 } } },
      'Railway station 1.5 km away in a straight line',
      948,
      1500,
    ],
    [
      'context.town',
      { context: { town: { m: 640 } } },
      'Town 640 m away in a straight line',
      { context: { town: { m: 90 } } },
      'Town 90 m away in a straight line',
      640,
      90,
    ],
  ];

  it.each(cases)(
    '%s: the text and the value follow the data',
    (field, a, textA, b, textB, valueA, valueB) => {
      const ra = reasons(a).find((r) => r.field === field);
      const rb = reasons(b).find((r) => r.field === field);
      expect(ra?.text).toBe(textA);
      expect(rb?.text).toBe(textB);
      expect(ra?.value).toBe(valueA);
      expect(rb?.value).toBe(valueB);
      expect(textA).not.toBe(textB);
    },
  );

  it('the kind of water is part of the sentence: a lake is not the sea', () => {
    const lake = reasons({ context: { water: { m: 800, kind: 'lake' } } });
    const sea = reasons({ context: { water: { m: 800, kind: 'sea' } } });
    const reservoir = reasons({
      context: { water: { m: 800, kind: 'reservoir' } },
    });
    expect(lake[0].text).toBe('Lake 800 m away in a straight line');
    expect(sea[0].text).toBe('Sea 800 m away in a straight line');
    expect(reservoir[0].text).toBe('Reservoir 800 m away in a straight line');
    expect(sea[0].kind).toBe('sea');
  });

  it('the name is part of the sentence when the record has one, and only then', () => {
    const named = reasons({
      context: { water: { m: 800, kind: 'lake', name: 'Bled' } },
    });
    const bare = reasons({ context: { water: { m: 800, kind: 'lake' } } });
    expect(named[0].text).toBe('Lake (Bled) 800 m away in a straight line');
    expect(named[0].name).toBe('Bled');
    expect(bare[0].text).toBe('Lake 800 m away in a straight line');
    expect(bare[0]).not.toHaveProperty('name');
  });

  it('a name that is only padding, or not a string, is no name — the reason stays', () => {
    for (const name of ['', '   ', 5, {}, [], null, true]) {
      const r = reasons({
        context: { town: { m: 640, name } },
      });
      expect(r).toHaveLength(1);
      expect(r[0].text).toBe('Town 640 m away in a straight line');
      expect(r[0]).not.toHaveProperty('name');
    }
    const padded = reasons({ context: { town: { m: 640, name: '  Moret ' } } });
    expect(padded[0].text).toBe('Town (Moret) 640 m away in a straight line');
  });

  it('electricity and grey water have one value that is a reason, `yes`: change it and the reason is gone', () => {
    expect(fieldsOf(withAmenity('electricity', 'yes'))).toContain(
      'electricity',
    );
    for (const v of ['no', 'unknown']) {
      expect(fieldsOf(withAmenity('electricity', v))).not.toContain(
        'electricity',
      );
      expect(fieldsOf(withAmenity('greyWater', v))).not.toContain('greyWater');
    }
  });

  it('every sentence that carries a distance says it is a straight line, and in metres', () => {
    const withDistance = reasons(FULL).filter((r) => r.unit === 'm');
    expect(withDistance).toHaveLength(4);
    for (const r of withDistance) {
      expect(r.text).toMatch(/ away in a straight line$/);
      expect(r.text).not.toMatch(/nearest|closest/i);
    }
  });
});

describe('🔴 a deleted field removes its reason — it does not leave one with an empty number', () => {
  const cases: Array<[string, ReasonInput]> = [
    ['electricity', withAmenity('electricity', DELETE)],
    ['greyWater', withAmenity('greyWater', DELETE)],
    ['stars', { ...FULL, stars: null }],
    ['context.water', withContext('water', DELETE)],
    ['context.supermarket', withContext('supermarket', DELETE)],
    ['context.station', withContext('station', DELETE)],
    ['context.town', withContext('town', DELETE)],
  ];

  it.each(cases)(
    '%s: gone from the list, and every other reason untouched',
    (field, input) => {
      expect(fieldsOf(input)).not.toContain(field);
      // The other six, exactly as they were: one missing field costs one
      // reason, never the rest.
      expect(reasons(input)).toEqual(without(field));
    },
  );

  it('the anchor for the block above: the same record with the field present has it', () => {
    // Silence satisfies "does not contain X": prove X was there to lose.
    for (const [field] of cases) {
      expect(fieldsOf(FULL)).toContain(field);
    }
  });

  // What a damaged feature looks like. None of them is a distance.
  const BROKEN: unknown[] = [
    {},
    { m: null },
    { m: undefined },
    { m: NaN },
    { m: Infinity },
    { m: -Infinity },
    { m: -1 },
    { m: '137' },
    { m: {} },
    { m: [137] },
    { m: true },
    { name: 'Moret' },
    null,
    'oops',
    137,
    [],
    [{ m: 137 }],
  ];

  /**
   * The feature as the column would hold it. For water, an object keeps a
   * valid kind, so the distance is the ONLY thing wrong with it: a broken
   * water feature that also lacked a kind would lose its reason for the
   * wrong reason and this block would agree with it.
   */
  const feature = (key: string, v: unknown): unknown =>
    key === 'water' && typeof v === 'object' && v !== null && !Array.isArray(v)
      ? { kind: 'lake', ...v }
      : v;

  describe.each(['water', 'supermarket', 'station', 'town'])(
    'context.%s',
    (key) => {
      it('the anchor: with a distance it is a reason', () => {
        const ok = withContext(key, feature(key, { m: 346 }));
        expect(fieldsOf(ok)).toContain(`context.${key}`);
      });

      it.each(BROKEN.map((b) => [b]))(
        'a feature that is %j gives no reason, and the rest are untouched',
        (broken) => {
          const input = withContext(key, feature(key, broken));
          expect(fieldsOf(input)).not.toContain(`context.${key}`);
          expect(reasons(input)).toEqual(without(`context.${key}`));
        },
      );
    },
  );

  it('a context that is not an object at all gives no surroundings and costs nothing else', () => {
    for (const context of [null, undefined, 'oops', 42, true, [], [FULL]]) {
      const got = reasons({ ...FULL, context });
      expect(got.map((r) => r.field)).toEqual([
        'electricity',
        'greyWater',
        'stars',
      ]);
    }
  });

  it('no reason in any of these outputs has an empty value or an empty word in its text', () => {
    const outputs: Reason[] = [reasons(FULL)].flat();
    for (const [, input] of cases) outputs.push(...reasons(input));
    for (const context of [null, 'oops', [], { water: {} }]) {
      outputs.push(...reasons({ ...FULL, context }));
    }
    expect(outputs.length).toBeGreaterThan(40);
    for (const r of outputs) {
      expect(r.value).not.toBeUndefined();
      expect(r.value).not.toBeNull();
      expect(r.value).not.toBe('');
      if (typeof r.value === 'number')
        expect(Number.isFinite(r.value)).toBe(true);
      expect(r.text).not.toMatch(/undefined|NaN|null|Infinity|\[object/);
      expect(r.text.trim()).toBe(r.text);
    }
  });

  it('water of a kind we do not know is no reason: we cannot say what is there', () => {
    for (const kind of [undefined, null, '', 'pond', 'Lake', 5, {}]) {
      expect(fieldsOf(withContext('water', { m: 346, kind }))).not.toContain(
        'context.water',
      );
    }
    // And the same distance with a kind we do know is one.
    expect(fieldsOf(withContext('water', { m: 346, kind: 'lake' }))).toContain(
      'context.water',
    );
  });
});

describe('🔴 a campsite we hold nothing but coordinates for gets no reasons', () => {
  it('as stage 1 reads it: no amenity keys, no rating, no surroundings', () => {
    expect(reasons({ amenities: {}, stars: null, context: {} })).toEqual([]);
    expect(reasons({ amenities: {}, stars: null })).toEqual([]);
    expect(reasons({})).toEqual([]);
  });

  it('every amenity written as `unknown` — the importer’s own spelling of "nobody said"', () => {
    const amenities = Object.fromEntries(
      AMENITY_KEYS.map((k) => [k, 'unknown']),
    );
    expect(AMENITY_KEYS).toHaveLength(10);
    expect(reasons({ amenities, stars: null, context: {} })).toEqual([]);
  });

  it('and not with a placeholder either: no "unknown", "not recorded" or "no data" line', () => {
    const all = reasons({ amenities: {}, stars: null, context: {} });
    expect(JSON.stringify(all)).not.toMatch(/unknown|not recorded|no data/i);
    expect(all).toHaveLength(0);
  });

  it('a recorded `no` is not a reason either: it scored nothing, and this list is why it was offered', () => {
    const amenities = Object.fromEntries(AMENITY_KEYS.map((k) => [k, 'no']));
    expect(reasons({ amenities, stars: null, context: {} })).toEqual([]);
  });

  it('the anchor: put one `yes` on it and exactly that reason appears', () => {
    expect(
      reasons({ amenities: { greyWater: 'yes' }, stars: null, context: {} }),
    ).toEqual([FULL_REASONS[1]]);
  });
});

describe('🔴 `unknown` is never a reason, in either direction', () => {
  it('only the string `yes` is a recorded yes: nothing else passes for it', () => {
    for (const v of [
      'unknown',
      'no',
      'YES',
      'Yes',
      'true',
      '1',
      true,
      1,
      null,
      undefined,
      {},
      [],
      '',
    ]) {
      expect(fieldsOf(withAmenity('electricity', v))).not.toContain(
        'electricity',
      );
      expect(fieldsOf(withAmenity('greyWater', v))).not.toContain('greyWater');
    }
  });

  it('an amenity set that is not an object reads as nothing known', () => {
    for (const amenities of [null, undefined, 'yes', 7, ['yes'], true]) {
      expect(fieldsOf({ ...FULL, amenities })).not.toContain('electricity');
    }
  });

  it('stars that are not a rating are not one: absent, zero, out of the scale, fractional, a string', () => {
    for (const stars of [null, undefined, 0, 6, -1, 3.5, 4.5, NaN, '4', 99]) {
      expect(fieldsOf({ ...FULL, stars: stars as number })).not.toContain(
        'stars',
      );
    }
  });
});

describe('the ranking and the reasons agree: a reason exists iff the field lifted the score above an unknown', () => {
  // The oracle is `score()`, the formula itself — not a number typed here and
  // not a threshold read out of reasons.ts.
  const at = (c: object) =>
    score({ slug: 'x', distanceM: 0, ...c }, 1000, [], COMPONENTS);

  it.each(['yes', 'no', 'unknown'])('electricity %s', (v) => {
    const lifted = at({ amenities: { electricity: v } }) > at({});
    expect(
      fieldsOf({ amenities: { electricity: v } }).includes('electricity'),
    ).toBe(lifted);
    expect(lifted).toBe(v === 'yes');
  });

  it.each(['yes', 'no', 'unknown'])('grey water %s', (v) => {
    const lifted = at({ amenities: { greyWater: v } }) > at({});
    expect(
      fieldsOf({ amenities: { greyWater: v } }).includes('greyWater'),
    ).toBe(lifted);
    expect(lifted).toBe(v === 'yes');
  });

  it.each([1, 2, 3, 4, 5])(
    'stars %i: a reason only above the middle of the scale, where an unrated campsite sits',
    (s) => {
      const lifted = at({ stars: s }) > at({});
      expect(fieldsOf({ stars: s }).includes('stars')).toBe(lifted);
      // Written out: 4 and 5 lift, 3 is level, 1 and 2 are BELOW an unrated one.
      expect(lifted).toBe(s >= 4);
    },
  );
});

describe('how close is close: the radius of each surrounding, pinned from both sides', () => {
  // [key, last metre that is a reason, first that is not, extra]
  const edges: Array<[string, number, number, object]> = [
    ['water', 999, 1000, { kind: 'lake' }],
    ['supermarket', 999, 1000, {}],
    ['station', 1999, 2000, {}],
    ['town', 999, 1000, {}],
  ];

  it.each(edges)(
    '%s: %i m is a reason, %i m is not',
    (key, inside, outside, extra) => {
      expect(fieldsOf({ context: { [key]: { m: inside, ...extra } } })).toEqual(
        [`context.${key}`],
      );
      expect(
        fieldsOf({ context: { [key]: { m: outside, ...extra } } }),
      ).toEqual([]);
      // Far past it, as the stored table has them (a station 1 887 km away is in it).
      expect(
        fieldsOf({ context: { [key]: { m: 1_887_707, ...extra } } }),
      ).toEqual([]);
    },
  );

  it('a distance with a fraction is said in whole metres, and the machine part keeps what the record holds', () => {
    // The stored distances are whole today (0 of 61 558 water distances have
    // a fraction); a record that ever carries one must not print "346.6 m".
    const got = reasons({ context: { supermarket: { m: 346.6 } } });
    expect(got[0].value).toBe(346.6);
    expect(got[0].text).toBe('Supermarket 347 m away in a straight line');
    const km = reasons({ context: { station: { m: 1500.4 } } });
    expect(km[0].text).toBe('Railway station 1.5 km away in a straight line');
  });

  it('a distance of zero is a distance: the feature is ON the campsite', () => {
    const got = reasons({ context: { supermarket: { m: 0 } } });
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe('Supermarket 0 m away in a straight line');
  });

  it('the table has the four, and nothing else is in it', () => {
    expect(Object.keys(NEAR_M).sort()).toEqual([
      'station',
      'supermarket',
      'town',
      'water',
    ]);
  });
});

describe('🔴 one input, one output', () => {
  it('twice over the same record: the same text, byte for byte', () => {
    expect(JSON.stringify(reasons(FULL))).toBe(JSON.stringify(reasons(FULL)));
    expect(reasons(FULL)).toHaveLength(7);
  });

  it('whatever order the record’s keys arrive in', () => {
    const reverse = <T extends object>(o: T): T =>
      Object.fromEntries(Object.entries(o).reverse()) as T;
    const shuffled: ReasonInput = {
      context: reverse(FULL.context as object),
      stars: FULL.stars,
      amenities: reverse(FULL.amenities as object),
    };
    // Anchor: the shuffle really did reorder the keys.
    expect(Object.keys(shuffled.context as object)).not.toEqual(
      Object.keys(FULL.context as object),
    );
    expect(JSON.stringify(reasons(shuffled))).toBe(
      JSON.stringify(reasons(FULL)),
    );
    expect(reasons(shuffled).map((r) => r.field)).toEqual(
      FULL_REASONS.map((r) => r.field),
    );
  });
});

describe('`weighed`: the ranking used it, or it did not', () => {
  const weighed = (components: readonly ComponentDef[]) =>
    Object.fromEntries(
      reasons(FULL, components).map((r) => [r.field, r.weighed]),
    );

  it('with the shipped weights: electricity, grey water and stars yes, the surroundings no', () => {
    expect(weighed(COMPONENTS)).toEqual({
      electricity: true,
      greyWater: true,
      stars: true,
      'context.water': false,
      'context.supermarket': false,
      'context.station': false,
      'context.town': false,
    });
  });

  it('follows the weights it is given: a weight of zero is not a weight', () => {
    const zeroed = COMPONENTS.map((c) =>
      c.id === 'electricity' ? { ...c, weight: 0 } : c,
    );
    expect(weighed(zeroed).electricity).toBe(false);
    expect(weighed(zeroed).greyWater).toBe(true);
  });

  it('and a component that is not in the formula at all is not weighed', () => {
    const noStars = COMPONENTS.filter((c) => c.id !== 'stars');
    expect(weighed(noStars).stars).toBe(false);
    expect(weighed(noStars).electricity).toBe(true);
  });
});

describe('🔴 the sources: exactly what scoring.ts reads, plus the surroundings', () => {
  const fields = REASON_SOURCES.map((s) => s.field);

  it('are these seven, in this order', () => {
    expect(fields).toEqual([
      'electricity',
      'greyWater',
      'stars',
      'context.water',
      'context.supermarket',
      'context.station',
      'context.town',
    ]);
  });

  it('every field scoring reads, except the position, is a source', () => {
    const scored = COMPONENTS.map((c) => c.field).filter(
      (f) => f !== 'location',
    );
    expect(scored.length).toBeGreaterThan(0);
    for (const f of scored) expect(fields).toContain(f);
  });

  it('and nothing else is, but the surroundings: a field the ranking does not read is not a reason', () => {
    const scored = COMPONENTS.map((c) => c.field);
    for (const f of fields) {
      if (!f.startsWith('context.')) expect(scored).toContain(f);
    }
    // dogFriendly is recorded and is not a reason: the ranking does not read it.
    expect(fields).not.toContain('dogFriendly');
  });

  it('the position is not a reason: every record has one, so it cannot tell a known campsite from an unknown one', () => {
    expect(fields).not.toContain('location');
    expect(COMPONENTS.map((c) => c.field)).toContain('location');
  });

  it('a surrounding is named for what it is: `context.water`, never `water`, which is the amenity', () => {
    expect(fields).not.toContain('water');
    expect(fields.filter((f) => f.startsWith('context.'))).toHaveLength(4);
  });

  it('every source has a sentence: the wording is written for the field, not for the record', () => {
    for (const r of reasons(FULL)) {
      expect(r.text.length).toBeGreaterThan(10);
    }
    expect(() => textOf({ field: 'wifi', value: 'yes', unit: null })).toThrow(
      /no wording for reason field "wifi"/,
    );
    expect(() =>
      textOf({ field: 'constructor', value: 'yes', unit: null }),
    ).toThrow(/no wording/);
  });
});

describe('🔴 a reason that stands on a field nobody measured refuses to load', () => {
  const snapshot = (fields: Record<string, number>): CoverageSnapshot => ({
    measuredAt: 'test',
    population: { n: 10_000 },
    queryHash: 'test',
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, { known: v }]),
    ),
    evidence: { starsMean: 3, starsOwnRow: 0, starsKnownByCountry: {} },
  });
  const source = (field: string) => ({ field, read: () => undefined });

  it('the shipped sources against the shipped table: nothing to say', () => {
    expect(checkReasons(REASON_SOURCES, real())).toEqual([]);
    expect(loadMeasuredReasons().sources.map((s) => s.field)).toEqual(
      REASON_SOURCES.map((s) => s.field),
    );
  });

  it('a field the table does not hold is named', () => {
    expect(
      checkReasons(
        [source('electricity'), source('rating')],
        snapshot({
          electricity: 1,
        }),
      ),
    ).toEqual(['rating: field is not in the coverage snapshot']);
  });

  it('refuses in the words of the others, and names the field', () => {
    expect(() =>
      loadReasons([source('rating')], snapshot({ electricity: 1 })),
    ).toThrow(/^CAMP-245 reasons refuse to load:\n {2}rating: field is not in/);
  });

  it('`context.water` is not satisfied by `water`: the amenity is a different number', () => {
    const s = real();
    expect(s.fields.water).toBeDefined();
    delete s.fields['context.water'];
    expect(checkReasons(REASON_SOURCES, s)).toEqual([
      'context.water: field is not in the coverage snapshot',
    ]);
  });

  it('a field listed twice is named', () => {
    expect(
      checkReasons([source('a'), source('a')], snapshot({ a: 1 })),
    ).toEqual(['a: listed twice']);
  });

  it('carries the coverage it was measured at, from the table and not typed here', () => {
    const cfg = loadReasons([source('a')], snapshot({ a: 2_500 }));
    expect(cfg.sources[0].coverage).toBe(0.25);
    expect(cfg.measuredAt).toBe('test');
  });

  it('a field measured at zero is measured: the table says how often, and it is never', () => {
    expect(checkReasons([source('a')], snapshot({ a: 0 }))).toEqual([]);
  });
});
