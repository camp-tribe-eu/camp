import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PlanRequest } from './plan-request';
import type { PlanResponse } from './plan-response';
import { PlanController } from './plan.controller';
import { PlanService, PlanTimedOut, type PlanResult } from './plan.service';

// CAMP-391 — `POST /plan` through a real Express server, with a stand-in for the
// one thing that needs Postgres.
//
// 🔴 WHAT THIS PROVES THAT plan-request.spec.ts CANNOT. The parser is a pure
// function; the failures a stranger actually causes happen BEFORE it — a body
// that is not JSON, a body that is not an object, a body that is too large, a
// content type that is not JSON at all. Those are Express's and Nest's, and the
// question is only what the caller sees: a 4xx with a reason, never a 500.
//
// 🔴 AND WHAT NEVER REACHES THE SERVICE. Every refused request is checked
// against the stand-in's call log: a request that is refused and still costs a
// connection and a transaction is a refusal that does not protect anything.
//
// The rate limit is NOT in this file (it would answer 429 to the eleventh case
// of an input table). `throttle.guard.spec.ts` has it, through the same
// controller.

const calls: PlanRequest[] = [];
let answer: () => Promise<PlanResult> = async () => {
  throw new Error('no answer set');
};

const OK: PlanResponse = {
  status: 'ok',
  measure: 'straight',
  lengthM: 1000,
  candidates: 3,
  ranking: [{ id: 'distance_fit', weight: 1 }],
  days: [{ day: 1, runM: 1000, measure: 'straight', night: null }],
};

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [PlanController],
    providers: [
      {
        provide: PlanService,
        useValue: {
          plan: async (req: PlanRequest) => {
            calls.push(req);
            return answer();
          },
        },
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  base = await app.getUrl();
});

afterAll(() => app?.close());

beforeEach(() => {
  calls.length = 0;
  answer = async () => ({ ok: true, response: OK });
});

const GOOD = {
  from: { lat: 46.0569, lon: 14.5058 },
  to: { lat: 43.5081, lon: 16.4402 },
  days: 7,
};

async function post(
  body: string | undefined,
  headers: Record<string, string> = { 'content-type': 'application/json' },
  path = '/plan',
) {
  const res = await fetch(base + path, { method: 'POST', headers, body });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* a body that is not JSON is reported by `text` */
  }
  return { status: res.status, json, text };
}

describe('the answer', () => {
  it('is 200 — nothing was created — and is what the planner said, unchanged', async () => {
    const r = await post(JSON.stringify(GOOD));
    expect(r.status).toBe(200);
    expect(r.json).toEqual(OK);
  });

  it('🔴 the planner is asked exactly what was sent, once', async () => {
    await post(JSON.stringify(GOOD));
    expect(calls).toEqual([GOOD]);
  });

  it('a refusal that is an answer (no chain across open water) is 200 too, not an error', async () => {
    const refusal: PlanResponse = {
      status: 'infeasible',
      reason: 'no-chain',
      measure: 'straight',
      lengthM: 316_000,
      daysAsked: 7,
      candidates: 230,
      reachedNights: 2,
    };
    answer = async () => ({ ok: true, response: refusal });
    const r = await post(JSON.stringify(GOOD));
    expect(r.status).toBe(200);
    expect(r.json).toEqual(refusal);
  });

  it('is the same bytes twice for the same question', async () => {
    const a = await post(JSON.stringify(GOOD));
    const b = await post(JSON.stringify(GOOD));
    expect(a.text).toBe(b.text);
  });
});

describe('🔴 a body that is not a question is a 400 with a reason, and costs the planner nothing', () => {
  interface Case {
    name: string;
    body: string | undefined;
    headers?: Record<string, string>;
  }
  const cases: Case[] = [
    { name: 'no body at all', body: undefined },
    { name: 'an empty JSON object', body: '{}' },
    { name: 'malformed JSON', body: '{"days":' },
    { name: 'JSON that is not an object (null)', body: 'null' },
    { name: 'JSON that is not an object (a number)', body: '7' },
    { name: 'an array', body: '[{"days":7}]' },
    {
      name: 'valid JSON sent as text/plain, which nothing parses',
      body: JSON.stringify(GOOD),
      headers: { 'content-type': 'text/plain' },
    },
    {
      name: 'a form post, whose values are strings',
      body: 'days=7&from=1&to=2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    },
    { name: 'days 0', body: JSON.stringify({ ...GOOD, days: 0 }) },
    { name: 'days 99', body: JSON.stringify({ ...GOOD, days: 99 }) },
    { name: 'days as text', body: JSON.stringify({ ...GOOD, days: '7' }) },
    {
      name: 'coordinates as text',
      body: JSON.stringify({ ...GOOD, from: { lat: '46', lon: '14' } }),
    },
    {
      name: 'a latitude of 120',
      body: JSON.stringify({ ...GOOD, from: { lat: 120, lon: 14 } }),
    },
    {
      name: 'a vehicle, which the planner does not read',
      body: JSON.stringify({ ...GOOD, vehicleId: 'motorhome' }),
    },
  ];

  it.each(cases)('$name', async ({ body, headers }) => {
    const r = await post(body, headers);
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
    // A reason a person can read, never a stack and never "Internal server error".
    expect(r.text).not.toMatch(/Internal server error|at .*\.(ts|js):\d+/);
    expect(typeof (r.json as { message?: unknown } | null)?.message).toBe(
      'string',
    );
  });

  it('a body over the size limit is a 413, not a 500', async () => {
    const r = await post(JSON.stringify({ ...GOOD, pad: 'x'.repeat(200_000) }));
    expect(r.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('every problem at once, in one body shape with a word for each', async () => {
    const r = await post(
      JSON.stringify({ from: { lat: 200, lon: 0 }, to: 'x', days: 0 }),
    );
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      code: 'invalid_plan_request',
      message: '3 things are wrong with this request; see `errors`.',
      errors: [
        {
          field: 'from.lat',
          code: 'out_of_range',
          message: '`from.lat` must be between -90 and 90 degrees.',
        },
        {
          field: 'to',
          code: 'not_an_object',
          message: '`to` must be an object { "lat": …, "lon": … } in degrees.',
        },
        {
          field: 'days',
          code: 'days_out_of_range',
          message: '`days` must be between 1 and 60.',
        },
      ],
    });
  });

  it('a single problem reads as itself, not as "1 things"', async () => {
    const r = await post(JSON.stringify({ ...GOOD, days: 99 }));
    expect((r.json as { message: string }).message).toBe(
      '`days` must be between 1 and 60.',
    );
  });
});

describe('what the planner refuses after the body is read', () => {
  it('a point outside the Union is the same 400, with the field and a word', async () => {
    answer = async () => ({
      ok: false,
      problems: [
        {
          field: 'to',
          code: 'outside_union',
          message: 'This point is outside the European Union.',
        },
      ],
    });
    const r = await post(JSON.stringify(GOOD));
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      code: 'invalid_plan_request',
      message: 'This point is outside the European Union.',
      errors: [
        {
          field: 'to',
          code: 'outside_union',
          message: 'This point is outside the European Union.',
        },
      ],
    });
  });

  it('a statement the database cancelled is a 503 that says to try again, not a 500', async () => {
    answer = async () => {
      throw new PlanTimedOut();
    };
    const r = await post(JSON.stringify(GOOD));
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'planner_busy' });
  });

  it('a bug is a 500 that carries no stack, no SQL and no message of ours', async () => {
    answer = async () => {
      throw new Error(
        'relation "camping_spots" does not exist at /srv/api/x.ts:12',
      );
    };
    const r = await post(JSON.stringify(GOOD));
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('camping_spots');
    expect(r.text).not.toContain('/srv/');
  });
});

describe('the route', () => {
  it('is a POST: the trip is in the body, never in a URL that is logged', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await fetch(base + '/plan', { method });
      await res.arrayBuffer();
      expect(res.status).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  it('ignores a query string: the trip is read from the body or not at all', async () => {
    const r = await post(
      JSON.stringify({}),
      { 'content-type': 'application/json' },
      '/plan?from=1,2&to=3,4&days=5',
    );
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
