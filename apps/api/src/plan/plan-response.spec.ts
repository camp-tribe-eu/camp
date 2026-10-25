import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AmenityValue } from '../osm/tag-mapping';
import type { ItineraryOutcome, Night } from '../planner/itinerary';
import { toPlanResponse, type Place } from './plan-response';

// CAMP-391 — what the API says, taken apart key by key.
//
// 🔴 THE ORACLE IS A LIST OF KEYS WRITTEN HERE. The mapper is a whitelist, and
// the way to test a whitelist is to feed it MORE than it should pass and read
// what is left: the algorithm's own fields that are not for the public (`score`,
// `needs`), and fields that do not exist today but are exactly what somebody
// will add (a driving time) — injected below through a cast, because the type
// would not let a careful programmer write them.

const NIGHT: Night = {
  slug: 'camp-a',
  country: 'HR',
  lon: 15.2,
  lat: 45.2,
  alongM: 107_823.4,
  offsetM: 5_481.1,
  targetAlongM: 91_969.8,
  fromTargetM: 16_774.4,
  score: 0.8421,
  amenities: { electricity: 'yes', water: 'no', wifi: 'unknown' },
  stars: 4,
  needs: [{ key: 'electricity', state: AmenityValue.YES }],
  reasons: [
    {
      field: 'electricity',
      value: 'yes',
      unit: null,
      weighed: true,
      text: 'Our database records electricity at this campsite',
    },
    {
      field: 'context.water',
      value: 174,
      unit: 'm',
      kind: 'reservoir',
      name: 'Jezero Sabljaci',
      weighed: false,
      text: 'Reservoir (Jezero Sabljaci) 174 m away in a straight line',
    },
  ],
};

const OK: ItineraryOutcome = {
  status: 'ok',
  measure: 'straight',
  lengthM: 321_894.3,
  candidates: 182,
  days: [
    { day: 1, runM: 107_823.4, measure: 'straight', night: NIGHT },
    { day: 2, runM: 214_070.9, measure: 'straight', night: null },
  ],
};

const PLACES = new Map<string, Place>([
  [
    'camp-a',
    {
      name: 'Camp A',
      path: '/camping/hr/karlovacka/camp-a',
      sources: [
        { id: 'osm', ref: 'n123', updatedAt: '2026-10-19', fields: ['name'] },
        {
          id: 'datatourisme',
          ref: 'https://data.datatourisme.fr/28/x',
          updatedAt: '2005-08-24',
          fields: ['stars'],
        },
      ],
    },
  ],
]);

const RANKING = [
  { id: 'distance_fit', weight: 0.75 },
  { id: 'stars', weight: 0.25 },
] as const;

/** Every key of every object under `v`, as dotted paths with arrays flattened. */
function keyPaths(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => keyPaths(x, path));
  if (typeof v !== 'object' || v === null) return [];
  return Object.entries(v).flatMap(([k, x]) => [
    `${path}${k}`,
    ...keyPaths(x, `${path}${k}.`),
  ]);
}

describe('the plan, as the page gets it', () => {
  it('carries the days, the nights and the reasons — and exactly these keys', () => {
    const r = toPlanResponse(OK, PLACES, RANKING);
    expect([...new Set(keyPaths(r))].sort()).toEqual(
      [
        'status',
        'measure',
        'lengthM',
        'candidates',
        'ranking',
        'ranking.id',
        'ranking.weight',
        'days',
        'days.day',
        'days.runM',
        'days.measure',
        'days.night',
        'days.night.slug',
        'days.night.name',
        'days.night.country',
        'days.night.path',
        'days.night.lat',
        'days.night.lon',
        'days.night.alongM',
        'days.night.offsetM',
        'days.night.targetAlongM',
        'days.night.fromTargetM',
        'days.night.amenities',
        'days.night.amenities.electricity',
        'days.night.amenities.water',
        'days.night.stars',
        'days.night.reasons',
        'days.night.reasons.field',
        'days.night.reasons.value',
        'days.night.reasons.unit',
        'days.night.reasons.kind',
        'days.night.reasons.name',
        'days.night.reasons.weighed',
        'days.night.reasons.text',
        'days.night.sources',
        'days.night.sources.id',
        'days.night.sources.updatedAt',
      ].sort(),
    );
  });

  it('puts the name and the page of the campsite on the night, from the table', () => {
    const r = toPlanResponse(OK, PLACES, RANKING);
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.days[0].night).toMatchObject({
      slug: 'camp-a',
      name: 'Camp A',
      path: '/camping/hr/karlovacka/camp-a',
    });
    expect(r.days[1].night).toBeNull();
  });

  it('🔴 carries the source and the date of the record — and nothing else the column holds', () => {
    const r = toPlanResponse(OK, PLACES, RANKING);
    if (r.status !== 'ok') throw new Error('not ok');
    // `ref` and `fields` are in the column and are not in the answer.
    expect(r.days[0].night.sources).toEqual([
      { id: 'osm', updatedAt: '2026-10-19' },
      { id: 'datatourisme', updatedAt: '2005-08-24' },
    ]);
  });

  it('🔴 one source entry that does not say who and when costs that entry, not the night', () => {
    const places = new Map<string, Place>([
      [
        'camp-a',
        {
          name: 'Camp A',
          path: null,
          sources: [
            null,
            'osm',
            7,
            { id: 'osm' },
            { updatedAt: '2026-01-01' },
            { id: '', updatedAt: '2026-01-01' },
            { id: 'osm', updatedAt: 20260101 },
            { id: 'datatourisme', updatedAt: '2005-08-24' },
          ],
        },
      ],
    ]);
    const r = toPlanResponse(OK, places, RANKING);
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.days[0].night.sources).toEqual([
      { id: 'datatourisme', updatedAt: '2005-08-24' },
    ]);
    expect(r.days[0].night.slug).toBe('camp-a');
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an object', { id: 'osm', updatedAt: '2026-01-01' }],
    ['text', 'osm'],
  ])('a sources column that is %s reads as no sources', (_n, sources) => {
    const r = toPlanResponse(
      OK,
      new Map([['camp-a', { name: 'A', path: null, sources }]]),
      RANKING,
    );
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.days[0].night.sources).toEqual([]);
  });

  it('🔴 a night the table gave no row for keeps its place in the plan, with no name and no link', () => {
    const r = toPlanResponse(OK, new Map(), RANKING);
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.days[0].night).toMatchObject({
      slug: 'camp-a',
      name: null,
      path: null,
    });
    expect(r.days).toHaveLength(2);
  });

  it('🔴 an amenity nobody recorded is absent — not "no", and not the word unknown', () => {
    const r = toPlanResponse(OK, PLACES, RANKING);
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.days[0].night.amenities).toEqual({
      electricity: 'yes',
      water: 'no',
    });
  });

  it.each([
    ['null', null],
    ['a string', 'electricity'],
    ['an array', ['yes']],
  ])('an amenity set that is %s reads as nothing recorded', (_n, bad) => {
    const outcome: ItineraryOutcome = {
      ...OK,
      days: [
        {
          day: 1,
          runM: 1,
          measure: 'straight',
          night: { ...NIGHT, amenities: bad as never },
        },
      ],
    } as ItineraryOutcome;
    const r = toPlanResponse(outcome, PLACES, RANKING);
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.days[0].night.amenities).toEqual({});
  });

  it('says what the ranking used, from the argument and not from a constant here', () => {
    const r = toPlanResponse(OK, PLACES, [{ id: 'stars', weight: 1 }]);
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.ranking).toEqual([{ id: 'stars', weight: 1 }]);
  });
});

describe('🔴 nothing reaches the public that nobody decided on', () => {
  // The algorithm's own fields that are not for the page, and the ones that
  // do not exist yet and are exactly what will be added next.
  const SMUGGLED = {
    score: 9,
    needs: ['x'],
    driveMinutes: 94,
    drivingSeconds: 5640,
    roadDistanceM: 123_456,
    hoursAtTheWheel: 1.6,
    durationS: 5640,
  };

  it('at every level: the outcome, a day, a night and a reason', () => {
    const dirty = {
      ...OK,
      ...SMUGGLED,
      days: [
        {
          day: 1,
          runM: 1,
          measure: 'straight',
          ...SMUGGLED,
          night: {
            ...NIGHT,
            ...SMUGGLED,
            reasons: [{ ...NIGHT.reasons[0], ...SMUGGLED }],
          },
        },
      ],
    } as unknown as ItineraryOutcome;
    const paths = keyPaths(toPlanResponse(dirty, PLACES, RANKING));
    for (const key of Object.keys(SMUGGLED)) {
      expect(paths.filter((p) => p.endsWith(key))).toEqual([]);
    }
    // `needs` and `score` are the algorithm's and are real; neither is here.
    expect(paths).not.toContain('days.night.score');
    expect(paths).not.toContain('days.night.needs');
  });

  it('and not in a refusal either', () => {
    const noChain = {
      status: 'infeasible',
      reason: 'no-chain',
      measure: 'straight',
      lengthM: 316_000,
      daysAsked: 7,
      candidates: 230,
      reachedNights: 2,
      ...SMUGGLED,
    } as unknown as ItineraryOutcome;
    expect(toPlanResponse(noChain, new Map(), RANKING)).toEqual({
      status: 'infeasible',
      reason: 'no-chain',
      measure: 'straight',
      lengthM: 316_000,
      daysAsked: 7,
      candidates: 230,
      reachedNights: 2,
    });
    expect(
      toPlanResponse(
        { status: 'unsupported', reason: 'round-trip', ...SMUGGLED } as never,
        new Map(),
        RANKING,
      ),
    ).toEqual({ status: 'unsupported', reason: 'round-trip' });
  });
});

describe('🔴 there is no road in it, and no time at the wheel', () => {
  const answers = [
    toPlanResponse(OK, PLACES, RANKING),
    toPlanResponse(
      {
        status: 'infeasible',
        reason: 'no-chain',
        measure: 'straight',
        lengthM: 1,
        daysAsked: 2,
        candidates: 3,
        reachedNights: 0,
      },
      new Map(),
      RANKING,
    ),
    toPlanResponse(
      { status: 'unsupported', reason: 'round-trip' },
      new Map(),
      RANKING,
    ),
  ];

  it('no key names a road, a drive, an hour, a minute, a duration or a speed', () => {
    const paths = answers.flatMap((a) => keyPaths(a));
    const bad = paths.filter((p) =>
      /road|driv|hour|minute|second|duration|speed|eta\b|travel/i.test(p),
    );
    expect(bad).toEqual([]);
  });

  /**
   * Every object that carries a figure in metres is the root or sits under an
   * object that says `measure: 'straight'`. Walked, not assumed.
   */
  function metresWithoutMeasure(
    v: unknown,
    covered: boolean,
    at = '$',
  ): string[] {
    if (Array.isArray(v)) {
      return v.flatMap((x, i) =>
        metresWithoutMeasure(x, covered, `${at}[${i}]`),
      );
    }
    if (typeof v !== 'object' || v === null) return [];
    const o = v as Record<string, unknown>;
    const here = covered || o.measure === 'straight';
    const out: string[] = [];
    for (const [k, x] of Object.entries(o)) {
      if (/M$/.test(k) && typeof x === 'number' && !here)
        out.push(`${at}.${k}`);
      out.push(...metresWithoutMeasure(x, here, `${at}.${k}`));
    }
    return out;
  }

  it('every figure in metres is read beside the word "straight"', () => {
    for (const a of answers) {
      expect(metresWithoutMeasure(a, false)).toEqual([]);
    }
    // The walker sees a lone figure for what it is, or it proves nothing.
    expect(metresWithoutMeasure({ days: [{ runM: 5 }] }, false)).toEqual([
      '$.days[0].runM',
    ]);
    expect(
      metresWithoutMeasure({ days: [{ runM: 5, measure: 'straight' }] }, false),
    ).toEqual([]);
  });

  it('and the word is "straight", the only value there is', () => {
    const measures = (v: unknown): unknown[] =>
      Array.isArray(v)
        ? v.flatMap(measures)
        : typeof v === 'object' && v !== null
          ? Object.entries(v).flatMap(([k, x]) =>
              k === 'measure' ? [x] : measures(x),
            )
          : [];
    const all = answers.flatMap(measures);
    // 1 on the root and 2 on the days of the plan, 1 on the refusal.
    expect(all).toEqual(Array(4).fill('straight'));
  });
});

describe('🔴 a refusal of the band is a bug here, not an answer', () => {
  it('throws instead of describing a limit the caller never set', () => {
    expect(() =>
      toPlanResponse(
        {
          status: 'infeasible',
          reason: 'band',
          measure: 'straight',
          lengthM: 1,
          daysAsked: 2,
          reachM: { minM: 1, maxM: 2 },
        },
        new Map(),
        RANKING,
      ),
    ).toThrow(/band/);
  });
});

// 🔴 THE PAGE AND THE API READ ONE SAMPLE OF THE ANSWER. The site's tests
// (apps/web/tests/unit/plan-source.spec.ts) feed `readPlan` a response captured
// from THIS endpoint over real data, and say so. A sample the page is tested
// against and the API no longer produces is a green page test over a contract
// that has gone, so the sample is held to the mapper here: the same key paths,
// both ways. Add a field to the answer without the sample and this is red; drop
// one and it is red; the page's parser then has to be told, in the same change.
describe('🔴 the answer the page is tested against is the answer this produces', () => {
  const sample = JSON.parse(
    readFileSync(
      join(__dirname, '../../../web/tests/unit/fixtures/plan-ok.json'),
      'utf8',
    ),
  ) as { status: number; body: unknown };

  /** Key paths, with the keys of `amenities` folded away: which are present is data. */
  const shape = (v: unknown): string[] => [
    ...new Set(
      keyPaths(v).map((p) => p.replace(/\.amenities\..+$/, '.amenities')),
    ),
  ];

  it('was captured from a 200', () => {
    expect(sample.status).toBe(200);
    expect((sample.body as { status: string }).status).toBe('ok');
  });

  it('has exactly the key paths the mapper writes', () => {
    const fromMapper = toPlanResponse(OK, PLACES, RANKING);
    expect(shape(sample.body).sort()).toEqual(shape(fromMapper).sort());
  });

  it('and is long enough to mean something: six nights, reasons, two sources somewhere', () => {
    const days = (sample.body as { days: Array<{ night: unknown }> }).days;
    expect(days.filter((d) => d.night)).toHaveLength(6);
    const sources = days.flatMap(
      (d) =>
        (d.night as { sources: Array<{ id: string }> } | null)?.sources ?? [],
    );
    expect(new Set(sources.map((x) => x.id))).toEqual(
      new Set(['osm', 'datatourisme']),
    );
  });
});
