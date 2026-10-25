import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_DAYS } from '../planner/itinerary';
import { parsePlanRequest, type PlanProblem } from './plan-request';

// CAMP-391 — what `POST /plan` accepts, driven as a pure function: every shape
// a stranger's client can send, with the answer written out.
//
// 🔴 THE ORACLE IS NOT THE CODE UNDER TEST. The bounds below are literals
// (60 days, ±90°, ±180°) written from the card and from what a degree is, not
// imported from plan-request.ts — the one number that IS imported
// (`MAX_DAYS`, from the algorithm) is compared with a literal first, so a
// change to it is a red test here and not a silent change to the public
// contract.

const GOOD = {
  from: { lat: 46.0569, lon: 14.5058 },
  to: { lat: 43.5081, lon: 16.4402 },
  days: 7,
};

/** The request with one key replaced; `undefined` removes it. */
const with_ = (over: Record<string, unknown>): unknown => {
  const o: Record<string, unknown> = { ...GOOD, ...over };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

const problemsOf = (body: unknown): PlanProblem[] => {
  const r = parsePlanRequest(body);
  if (r.ok === true) throw new Error(`accepted: ${JSON.stringify(r.request)}`);
  return r.problems;
};

/** `field:code` for each problem, in order — what a caller branches on. */
const codes = (body: unknown): string[] =>
  problemsOf(body).map((p) => `${p.field}:${p.code}`);

describe('a request that is a question', () => {
  it('is accepted, and handed on as it was written', () => {
    expect(parsePlanRequest(GOOD)).toEqual({ ok: true, request: GOOD });
  });

  it('accepts the edges: 1 and 60 days, the poles and the antimeridian', () => {
    for (const days of [1, 60]) {
      expect(parsePlanRequest(with_({ days })).ok).toBe(true);
    }
    expect(
      parsePlanRequest(
        with_({ from: { lat: -90, lon: -180 }, to: { lat: 90, lon: 180 } }),
      ).ok,
    ).toBe(true);
  });

  it('a round trip is a question: the planner answers it, this does not refuse it', () => {
    expect(parsePlanRequest(with_({ to: GOOD.from })).ok).toBe(true);
  });

  it("the day limit is the algorithm's and the page's, and it is 60", () => {
    expect(MAX_DAYS).toBe(60);
    // The page (apps/web/src/lib/plan.ts) checks the same number before it
    // sends; two copies of one limit are compared here, not trusted.
    const page = readFileSync(
      join(__dirname, '../../../web/src/lib/plan.ts'),
      'utf8',
    );
    expect(/export const MAX_DAYS = (\d+);/.exec(page)?.[1]).toBe('60');
  });
});

describe('🔴 the body is not an object', () => {
  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an array', [GOOD]],
    ['a string', '{"days":7}'],
    ['a number', 7],
    ['a boolean', true],
  ])('%s', (_name, body) => {
    expect(codes(body)).toEqual(['body:not_an_object']);
  });
});

describe('🔴 days', () => {
  it.each([
    ['0', 0, 'days_out_of_range'],
    ['61', 61, 'days_out_of_range'],
    ['99', 99, 'days_out_of_range'],
    ['-1', -1, 'days_out_of_range'],
    ['a fraction', 7.5, 'not_whole_days'],
    ['a text number', '7', 'not_a_number'],
    ['null', null, 'not_a_number'],
    ['a boolean', true, 'not_a_number'],
    ['an array', [7], 'not_a_number'],
    ['an object', { n: 7 }, 'not_a_number'],
  ])('%s is refused, with its own word', (_name, days, code) => {
    expect(codes(with_({ days }))).toEqual([`days:${code}`]);
  });

  it('absent is "missing", and says the range', () => {
    const [p] = problemsOf(with_({ days: undefined }));
    expect(p).toMatchObject({ field: 'days', code: 'missing' });
    expect(p.message).toContain('1 to 60');
  });

  it('the message for a wrong number says what would be right', () => {
    const [p] = problemsOf(with_({ days: 99 }));
    expect(p.message).toBe('`days` must be between 1 and 60.');
  });
});

describe('🔴 the points', () => {
  it.each([
    ['from', 'lat', 91],
    ['from', 'lat', -90.0001],
    ['from', 'lon', 180.5],
    ['to', 'lat', 120],
    ['to', 'lon', -181],
  ])('%s.%s = %s is outside the globe', (point, key, value) => {
    expect(codes(with_({ [point]: { ...GOOD.from, [key]: value } }))).toEqual([
      `${point}.${key}:out_of_range`,
    ]);
  });

  it('a latitude typed where a longitude belongs is caught by the range, not planned from elsewhere', () => {
    // Lisbon is lon −9.14, lat 38.72. Swapped, the "latitude" is −9.14 and the
    // "longitude" 38.72 — both in range, which is why a PAIR cannot carry the
    // order and this API names its keys. A "lat" of 120, though, is refused.
    expect(codes(with_({ from: { lat: 120, lon: 40 } }))).toEqual([
      'from.lat:out_of_range',
    ]);
  });

  it.each([
    ['a string', '46.05'],
    ['null', null],
    ['a boolean', false],
    ['an object', {}],
  ])('a latitude that is %s is not a number', (_name, lat) => {
    expect(codes(with_({ from: { lat, lon: 14 } }))).toEqual([
      'from.lat:not_a_number',
    ]);
  });

  it('a missing key is named, and so is a missing point', () => {
    expect(codes(with_({ from: { lat: 46 } }))).toEqual(['from.lon:missing']);
    expect(codes(with_({ to: undefined }))).toEqual(['to:missing']);
  });

  it.each([
    ['null', null],
    ['an array — a pair has no way to say which is which', [14.5, 46.05]],
    ['a string', '46.05,14.5'],
    ['a number', 46],
  ])('a point that is %s is not an object', (_name, from) => {
    expect(codes(with_({ from }))).toEqual(['from:not_an_object']);
  });

  it('an extra key on a point is refused: `lng` filters nothing and would look like it worked', () => {
    expect(codes(with_({ from: { lat: 46, lon: 14, lng: 14 } }))).toEqual([
      'from:unknown_field',
    ]);
    // …and the typo that leaves `lon` missing says both things.
    expect(codes(with_({ from: { lat: 46, lng: 14 } }))).toEqual([
      'from:unknown_field',
      'from.lon:missing',
    ]);
  });

  it('NaN and Infinity never arrive from JSON, but a caller in-process could', () => {
    expect(codes(with_({ from: { lat: NaN, lon: 14 } }))).toEqual([
      'from.lat:not_a_number',
    ]);
    expect(codes(with_({ from: { lat: 46, lon: Infinity } }))).toEqual([
      'from.lon:not_a_number',
    ]);
  });
});

describe('🔴 strict: a field the planner does not read is refused, not ignored', () => {
  it('a vehicle is the one the old form asked for', () => {
    const [p] = problemsOf(with_({ vehicleId: 'motorhome' }));
    expect(p).toMatchObject({ field: 'body', code: 'unknown_field' });
    expect(p.message).toContain('vehicleId');
  });

  it.each(['countries', 'needs', 'band', 'bufferM', 'measure', 'hours'])(
    '`%s` is not a thing the entry takes',
    (key) => {
      expect(codes(with_({ [key]: 1 }))).toEqual(['body:unknown_field']);
    },
  );

  it('and a prototype key is just another unknown key', () => {
    const body = JSON.parse(
      '{"from":{"lat":1,"lon":2},"to":{"lat":3,"lon":4},"days":2,"__proto__":{"x":1}}',
    );
    expect(codes(body)).toEqual(['body:unknown_field']);
  });
});

describe('🔴 every problem at once, in the order of the form', () => {
  it('an empty object has three', () => {
    expect(codes({})).toEqual(['from:missing', 'to:missing', 'days:missing']);
  });

  it('two bad points and a bad number are three problems, not one', () => {
    expect(codes({ from: { lat: 200, lon: 0 }, to: 'x', days: 0 })).toEqual([
      'from.lat:out_of_range',
      'to:not_an_object',
      'days:days_out_of_range',
    ]);
  });

  it('unknown keys come first, because they are about the body', () => {
    expect(codes({ ...GOOD, days: 0, extra: 1 })).toEqual([
      'body:unknown_field',
      'days:days_out_of_range',
    ]);
  });
});

describe('it never throws on what a stranger sends', () => {
  it.each([
    [{ from: { lat: {}, lon: [] }, to: { lat: () => 1 }, days: Symbol('x') }],
    [Object.create(null)],
    [{ from: Object.create(null), to: Object.create(null), days: 1n }],
  ])('%#', (body) => {
    expect(() => parsePlanRequest(body)).not.toThrow();
    expect(parsePlanRequest(body).ok).toBe(false);
  });
});
